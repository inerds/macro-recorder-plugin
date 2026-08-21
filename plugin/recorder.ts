import { diffScene } from "../shared/diff";
import type { MacroStep } from "../shared/macro";
import type { RecordDebug } from "../shared/protocol";
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
    }
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
  // Only carry the (large) snapshot pair when it says something: a tick that
  // produced no steps and no diff is noise.
  if (recording.debug && steps.length > 0) {
    return { steps, debug: { prev, next } };
  }
  return { steps };
}

export function recordTick(seq: number): {
  seq: number;
  steps: MacroStep[];
  debug?: RecordDebug;
} {
  const delta = collectDelta();
  return delta.debug
    ? { seq, steps: delta.steps, debug: delta.debug }
    : { seq, steps: delta.steps };
}

export function recordStop(): { steps: MacroStep[]; debug?: RecordDebug } {
  const recording = session.recording;
  const delta = recording ? collectDelta() : { steps: [] };
  // A debug session that recorded NOTHING is the hardest case to diagnose —
  // attach the whole-session snapshot pair so an offline diff can prove
  // whether the captured surface changed at all (if it didn't, the user's
  // edit lives outside it).
  if (recording?.debug && !delta.debug && delta.steps.length === 0) {
    delta.debug = { prev: recording.firstSnapshot, next: recording.lastSnapshot };
  }
  session.recording = null;
  return delta;
}

export function recordDiscard(): void {
  session.recording = null;
}
