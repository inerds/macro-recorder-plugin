import { captureKeyframePayloads, countKeyframes, countSelectedMatches, type SelectedKf } from "../shared/capture";
import { diffScene } from "../shared/diff";
import type { MacroStep } from "../shared/macro";
import type { CaptureOffer, RecordDebug } from "../shared/protocol";
import { RPC_ERRORS } from "../shared/protocol";
import type { SceneSnapshot } from "../shared/snapshot";
import { buildStep } from "../shared/steps";
import { serializeScene } from "./serialize";
import { session } from "./session";
import type { Json } from "../shared/json";
import { toJson } from "../shared/json";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyProxy = any;

/**
 * Debug-only: enumerate what a live paint proxy ACTUALLY exposes, walking the
 * prototype chain (host getters are often non-enumerable, so Object.keys and
 * toJson miss them). Exists to locate fill opacity, which the typings omit
 * and no probe has found under an expected name.
 */
/**
 * Dev-only: the real property surface of one keyframe proxy (own names up
 * the prototype chain), so a trace shows whether the host exposes spatial
 * tangents (`inTangent`/`outTangent`) the typings omit. Prefers a position
 * keyframe; falls back to the first keyframe of any animated property.
 */
function introspectKeyframe(node: AnyProxy): Json {
  const candidates = ["position", "scale", "rotation", "opacity"];
  for (const name of candidates) {
    try {
      const prop: AnyProxy = node[name];
      const list = prop?.keyframes;
      if (!Array.isArray(list) || list.length === 0) continue;
      const kf: AnyProxy = list[0];
      const names = new Set<string>();
      let obj: AnyProxy = kf;
      for (let depth = 0; obj && depth < 5; depth++) {
        for (const own of Object.getOwnPropertyNames(obj)) names.add(own);
        obj = Object.getPrototypeOf(obj);
      }
      const values: Record<string, Json> = {};
      for (const key of ["inTangent", "outTangent", "easing", "spatial", "tangents"]) {
        try {
          values[key] = toJson(kf[key]);
        } catch (error) {
          values[key] = `threw: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
      return { property: name, keyframeProps: [...names].sort(), values };
    } catch {
      // try the next property
    }
  }
  return "no animated property on the probe node";
}

/** Own property names up the prototype chain — host getters are often non-enumerable. */
function surfaceOf(obj: AnyProxy): string[] {
  const names = new Set<string>();
  let cursor: AnyProxy = obj;
  for (let depth = 0; cursor && depth < 5; depth++) {
    for (const name of Object.getOwnPropertyNames(cursor)) names.add(name);
    cursor = Object.getPrototypeOf(cursor);
  }
  return [...names].sort();
}

/**
 * Dev-only: creator.selection's REAL surface — above all whether
 * `.keyframes` is live. The typings promise `selection.keyframes` and a
 * `selection:keyframes` event, but no trace has ever verified either; this
 * probe turns the first debug recording into RUNTIME-API ground truth.
 */
function introspectSelection(): Json {
  try {
    const selection: AnyProxy = creator.selection;
    const result: Record<string, Json> = { surface: surfaceOf(selection) as unknown as Json };
    let keyframes: AnyProxy;
    try {
      keyframes = selection.keyframes;
      result.keyframesType = Array.isArray(keyframes)
        ? `array(${keyframes.length})`
        : typeof keyframes;
    } catch (error) {
      result.keyframesType = `threw: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (Array.isArray(keyframes) && keyframes.length > 0) {
      const first: AnyProxy = keyframes[0];
      result.firstEntrySurface = surfaceOf(first) as unknown as Json;
      const values: Record<string, Json> = {};
      for (const key of ["id", "frame", "value", "easing"]) {
        try {
          values[key] = toJson(first[key]);
        } catch (error) {
          values[key] = `threw: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
      result.firstEntryValues = values;
    }
    return result;
  } catch (error) {
    return `selection unreadable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Dev-only: the first RECTANGLE shape's real surface plus every plausible
 * home for corner rounding — the typings list `roundness` only as a creation
 * option, and no trace has ever seen `rect.roundness.staticValue` leave 0.
 */
function introspectRectangle(root: AnyProxy): Json {
  const find = (node: AnyProxy, depth: number): AnyProxy | undefined => {
    try {
      if (node.type === "RECTANGLE") return node;
      const shapes = node.shapes;
      if (Array.isArray(shapes) && depth < 6) {
        for (const child of shapes) {
          const hit = find(child, depth + 1);
          if (hit) return hit;
        }
      }
    } catch {
      // unreadable subtree
    }
    return undefined;
  };
  const layers = tryReadLayers(root) ?? [root];
  let rect: AnyProxy | undefined;
  for (const layer of layers) {
    rect = find(layer, 0);
    if (rect) break;
  }
  if (!rect) return "no rectangle in scene";
  const probes: Record<string, Json> = {};
  for (const key of ["roundness", "radius", "cornerRadius", "corners", "borderRadius", "modifiers", "effects"]) {
    try {
      const value: AnyProxy = rect[key];
      probes[key] =
        value === undefined
          ? "undefined"
          : value !== null && typeof value === "object"
            ? { surface: surfaceOf(value), staticValue: toJson(tryReadValue(() => value.staticValue)), value: toJson(tryReadValue(() => value.value)) }
            : toJson(value);
    } catch (error) {
      probes[key] = `threw: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  const parentSurface = (() => {
    try {
      return surfaceOf(rect.parent);
    } catch {
      return "unreadable";
    }
  })();
  return { rectProps: surfaceOf(rect), probes, parentSurface };
}

function tryReadValue<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function introspectPaint(node: AnyProxy): Json {
  const out: Record<string, Json> = {};
  try {
    const fills = node.fills;
    if (!Array.isArray(fills) || fills.length === 0) {
      out.fills = "none";
      throw null; // skip paint probes, keep the surface hunt below
    }
    const paint: AnyProxy = fills[0];
    const names = new Set<string>();
    let obj: AnyProxy = paint;
    for (let depth = 0; obj && depth < 5; depth++) {
      for (const name of Object.getOwnPropertyNames(obj)) names.add(name);
      obj = Object.getPrototypeOf(obj);
    }
    out.paintProps = [...names].sort();
    const probes: Record<string, Json> = {};
    for (const candidate of ["opacity", "alpha", "fillOpacity", "transparency", "a"]) {
      try {
        const value: AnyProxy = paint[candidate];
        probes[candidate] =
          value === undefined
            ? "undefined"
            : typeof value === "object" && value !== null
              ? `object(${typeof value.staticValue !== "undefined" ? "animatable" : Object.getOwnPropertyNames(value).slice(0, 6).join(",")})`
              : String(value);
      } catch (error) {
        probes[candidate] = `throws: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    out.probes = probes;
    try {
      const color = paint.color;
      if (color) {
        const value = color.staticValue;
        out.colorStaticKeys =
          value && typeof value === "object" ? Object.getOwnPropertyNames(value).sort() : String(value);
        out.colorStatic = toJson(value);
        const colorNames = new Set<string>();
        let cobj: AnyProxy = color;
        for (let depth = 0; cobj && depth < 5; depth++) {
          for (const name of Object.getOwnPropertyNames(cobj)) colorNames.add(name);
          cobj = Object.getPrototypeOf(cobj);
        }
        out.colorProps = [...colorNames].sort();
      }
    } catch {
      out.colorStaticKeys = "unreadable";
    }
  } catch (error) {
    out.error = error instanceof Error ? error.message : String(error);
  }
  // Hunt for untyped surface, guided by the Lottie spec: fill opacity is a
  // separate animatable `o` on fl/st shapes in the document. Two candidate
  // routes: (a) the node's real `shapes` stack may include fill/stroke
  // entries the typings omit; (b) node/scene proxies may expose raw-document
  // access (toJSON/export/…) like Animatable's untyped clearKeyframes.
  try {
    const protoNames = (obj: AnyProxy): string[] => {
      const names = new Set<string>();
      let cursor: AnyProxy = obj;
      for (let depth = 0; cursor && depth < 5; depth++) {
        for (const name of Object.getOwnPropertyNames(cursor)) names.add(name);
        cursor = Object.getPrototypeOf(cursor);
      }
      return [...names].filter((name) => !name.startsWith("__") && !/^(constructor|hasOwnProperty|isPrototypeOf|propertyIsEnumerable|toLocaleString|toString|valueOf)$/.test(name)).sort();
    };
    out.nodeProps = protoNames(node);
    const shapes = node.shapes;
    if (Array.isArray(shapes)) {
      out.shapeStackTypes = shapes.map((shape: AnyProxy) => {
        try {
          return String(shape.type);
        } catch {
          return "unreadable";
        }
      });
      if (shapes[0]) out.firstShapeProps = protoNames(shapes[0]);
    }
    try {
      out.sceneProps = protoNames(creator.activeScene);
    } catch {
      out.sceneProps = "unreadable";
    }
  } catch (error) {
    out.huntError = error instanceof Error ? error.message : String(error);
  }
  return out;
}

export function recordStart(params: { debug?: boolean }): {
  nodeId: string;
  nodeName?: string;
  paintIntrospection?: Json;
  keyframeIntrospection?: Json;
  shapeIntrospection?: Json;
  selectionIntrospection?: Json;
} {
  // Whole-scene recording: no selection required — every layer is watched.
  const scene = creator.activeScene;
  if (!scene) {
    throw new Error(RPC_ERRORS.noSelection);
  }
  const snapshot = serializeScene(scene);
  session.recording = {
    scene,
    lastSnapshot: snapshot,
    firstSnapshot: snapshot,
    debug: params?.debug === true,
  };
  session.playback = null;
  const result: {
    nodeId: string;
    nodeName?: string;
    paintIntrospection?: Json;
    keyframeIntrospection?: Json;
    shapeIntrospection?: Json;
    selectionIntrospection?: Json;
  } = { nodeId: snapshot.sceneId ?? "scene" };
  const sceneName = ((): string | undefined => {
    try {
      return typeof scene.name === "string" ? scene.name : undefined;
    } catch {
      return undefined;
    }
  })();
  if (sceneName) result.nodeName = sceneName;
  // Debug introspection still favors the selected node's paints when present.
  if (params?.debug === true) {
    const nodes = ((): AnyProxy[] => {
      try {
        return Array.isArray(creator.selection.nodes) ? [...creator.selection.nodes] : [];
      } catch {
        return [];
      }
    })();
    const probe = nodes[0] ?? (Array.isArray(snapshot.layers) ? scene.layers?.[0] : undefined);
    if (probe) {
      result.paintIntrospection = introspectPaint(probe);
      result.keyframeIntrospection = introspectKeyframe(probe);
      result.shapeIntrospection = introspectRectangle(scene);
    }
    result.selectionIntrospection = introspectSelection();
  }
  return result;
}

/**
 * Diffs the recorded node against its previous snapshot. Returns the snapshot
 * pair alongside the steps so a dev session can replay the exact input that
 * produced them through diffSnapshots() in a unit test.
 */
function collectDelta(): { steps: MacroStep[]; debug?: RecordDebug } {
  const recording = session.recording;
  if (!recording) return { steps: [] };
  let next: SceneSnapshot;
  try {
    next = serializeScene(recording.scene);
  } catch {
    session.recording = null;
    throw new Error(RPC_ERRORS.nodeGone);
  }
  const prev = recording.lastSnapshot;
  const payloads = diffScene(prev, next);
  recording.lastSnapshot = next;
  const steps = payloads.map(buildStep);
  if (steps.length > 0) recording.stepped = true;
  // Only carry the (large) snapshot pair when it says something: a tick that
  // produced no steps and no diff is noise.
  if (recording.debug && steps.length > 0) {
    const debug: RecordDebug = { prev, next };
    // The record.start probe only sees keyframes that already exist; the
    // first position keyframe this session creates is the better witness.
    if (!recording.keyframeProbed) {
      const kfStep = payloads.find(
        (p) => p.op === "keyframes" && p.path.length === 1 && p.path[0] === "position",
      );
      const layerId = kfStep && "layer" in kfStep ? kfStep.layer?.id : undefined;
      const layer = layerId
        ? (tryReadLayers(recording.scene) ?? []).find((l) => {
            try {
              return String(l.id) === layerId;
            } catch {
              return false;
            }
          })
        : undefined;
      if (layer) {
        debug.keyframeIntrospection = introspectKeyframe(layer);
        recording.keyframeProbed = true;
      }
    }
    return { steps, debug };
  }
  return { steps };
}

function tryReadLayers(scene: AnyProxy): AnyProxy[] | undefined {
  try {
    const layers = scene.layers;
    return Array.isArray(layers) ? layers : undefined;
  } catch {
    return undefined;
  }
}

/** Defensive read of the node selection (absent/throwing hosts -> []). */
function selectedNodes(): AnyProxy[] {
  try {
    return Array.isArray(creator.selection.nodes) ? [...creator.selection.nodes] : [];
  } catch {
    return [];
  }
}

/**
 * Defensive read of the SELECTED-KEYFRAMES surface. Returns undefined when
 * the surface is missing/non-array (feature detection — it is typed but has
 * never been live-verified); otherwise the entries' {frame, value} pairs,
 * value null when unreadable. Ids are useless (host recycles them).
 */
function selectedKeyframes(): SelectedKf[] | undefined {
  let list: AnyProxy;
  try {
    list = (creator.selection as AnyProxy).keyframes;
  } catch {
    return undefined;
  }
  if (!Array.isArray(list)) return undefined;
  const out: SelectedKf[] = [];
  for (const kf of list) {
    let frame: number;
    try {
      frame = Number(kf.frame);
    } catch {
      continue;
    }
    if (!Number.isFinite(frame)) continue;
    let value: Json | null = null;
    try {
      value = toJson(kf.value);
    } catch {
      // frame-only match downstream
    }
    out.push({ frame, value });
  }
  return out;
}

/**
 * The standing capture offer, recomputed from the tick's OWN snapshot plus
 * one selection read: exactly one selected node, matching a top-level
 * non-SCENE layer of the snapshot, with >=1 keyframe in its subtree.
 * SCENE_INSTANCE layers are excluded — their shapes channel is the source
 * scene's shared content, and capturing it would edit every instance.
 */
function computeCaptureOffer(next: SceneSnapshot): CaptureOffer | undefined {
  const nodes = selectedNodes();
  if (nodes.length !== 1) return undefined;
  let selectedId: string;
  try {
    selectedId = String(nodes[0].id);
  } catch {
    return undefined;
  }
  const layer = next.layers.find((l) => l.nodeId === selectedId);
  if (!layer || layer.nodeType.startsWith("SCENE")) return undefined;
  const { pathCount, keyframeCount } = countKeyframes(layer);
  if (keyframeCount === 0) return undefined;
  const offer: CaptureOffer = {
    layerId: layer.nodeId,
    ...(layer.nodeName ? { layerName: layer.nodeName } : {}),
    pathCount,
    keyframeCount,
  };
  const selected = selectedKeyframes();
  if (selected !== undefined) {
    offer.selectedCount = countSelectedMatches(layer, selected);
  }
  return offer;
}

export function recordTick(seq: number): {
  seq: number;
  steps: MacroStep[];
  captureOffer?: CaptureOffer;
  debug?: RecordDebug;
} {
  const recording = session.recording;
  const delta = collectDelta();
  // collectDelta advanced lastSnapshot to this tick's serialization; the
  // offer is computed from that same snapshot — no second serialize.
  const offer = recording ? computeCaptureOffer(recording.lastSnapshot) : undefined;
  return {
    seq,
    steps: delta.steps,
    ...(offer ? { captureOffer: offer } : {}),
    ...(delta.debug ? { debug: delta.debug } : {}),
  };
}

/**
 * Synthesize keyframe steps for a layer's EXISTING animation, from
 * lastSnapshot — never a fresh serialize. That keeps capture and the diff
 * stream disjoint by construction: an edit made after the last tick is not
 * in lastSnapshot, so it arrives as an ordinary diffed step on the next
 * tick; nothing can double-emit. (Capture is <=500ms stale; accepted.)
 * Capture touches no proxies, so the next tick's diff sees no change.
 */
export function recordCaptureKeyframes(params: {
  layerId: string;
  scope: "all" | "selected";
}): { steps: MacroStep[] } {
  const recording = session.recording;
  if (!recording) {
    throw new Error("not recording");
  }
  const layer = recording.lastSnapshot.layers.find((l) => l.nodeId === params.layerId);
  if (!layer) {
    throw new Error(RPC_ERRORS.nodeGone);
  }
  let selected: SelectedKf[] | undefined;
  if (params.scope === "selected") {
    selected = selectedKeyframes();
    if (selected === undefined || selected.length === 0) {
      throw new Error(RPC_ERRORS.noSelectedKeyframes);
    }
  }
  const payloads = captureKeyframePayloads(layer, {
    scope: params.scope,
    ...(selected ? { selected } : {}),
  });
  if (params.scope === "selected" && payloads.length === 0) {
    throw new Error(RPC_ERRORS.noSelectedKeyframes);
  }
  return { steps: payloads.map(buildStep) };
}

export function recordStop(): { steps: MacroStep[]; debug?: RecordDebug } {
  const recording = session.recording;
  const delta = recording ? collectDelta() : { steps: [] };
  // A debug session that recorded NOTHING is the hardest case to diagnose —
  // attach the whole-session snapshot pair so an offline diff can prove
  // whether the captured surface changed at all (if it didn't, the user's
  // edit lives outside it).
  // "Recorded nothing" means the whole SESSION, not just the final tick —
  // a session that emitted steps and then ended on a quiet tick must keep
  // its empty final delta empty, or the trace pairs a snapshot span with
  // steps it did not produce (the traced pair must be diffScene's exact
  // input, and this fallback pair is not).
  if (recording?.debug && !delta.debug && delta.steps.length === 0 && !recording.stepped) {
    delta.debug = { prev: recording.firstSnapshot, next: recording.lastSnapshot };
  }
  session.recording = null;
  return delta;
}

export function recordDiscard(): void {
  session.recording = null;
}
