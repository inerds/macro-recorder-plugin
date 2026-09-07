import { captureKeyframePayloads, countKeyframes, countSelectedMatches, type SelectedKf } from "../engine/capture";
import { diffScene } from "../engine/diff";
import type { MacroStep } from "../engine/macro";
import type { CaptureOffer, RecordDebug, ScopeReport } from "../engine/protocol";
import { RPC_ERRORS } from "../engine/protocol";
import type { NodeTree, RecordScope } from "../engine/scope";
import { partitionByScope, resolveScope, scopeLayerRefs } from "../engine/scope";
import type { SceneSnapshot } from "../engine/snapshot";
import { buildStep } from "../engine/steps";
import { serializeScene, serializeSceneIndex } from "./serialize";
import type { RecordingSession } from "./session";
import { session } from "./session";
import type { Json } from "../engine/json";
import { toJson } from "../engine/json";

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
    result.events = {
      supported: selectionEvents.supported,
      fired: selectionEvents.fired,
      lastCount: selectionEvents.entries.length,
    };
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
 * home for corner rounding. 1.0.1 types `Rectangle.roundness` as a full
 * `Animatable<number>`, but the proxy stays dead at runtime — no trace has
 * ever seen `rect.roundness.staticValue` leave 0 — so this probe keeps
 * looking for the property's real home.
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
  // Token/slot hunt (rev .51): motion-token bindings are invisible on every
  // enumerated proxy surface (traces 2026-08-26T07-26-13/-32 — paint/color/
  // node/scene prototype walks all came back token-free, colorStaticKeys is
  // exactly ["b","g","r"]). Three routes were never read, so dump them all;
  // the next token-session trace then settles observability for good:
  //   (a) the untyped `data` property enumerated on node/shape proxies,
  //   (b) the node's raw document via toJSON() — the route that surfaced
  //       per-fill opacity — where a Lottie slot binding would ride as an
  //       `sid` key on the fl/st entry,
  //   (c) the scene document root, where the spec parks the `slots` map.
  try {
    out.nodeData = toJson(tryReadValue(() => node.data)) ?? "absent";
    const shapes: AnyProxy = tryReadValue(() => node.shapes);
    const firstShape: AnyProxy = Array.isArray(shapes) ? shapes[0] : undefined;
    if (firstShape) out.firstShapeData = toJson(tryReadValue(() => firstShape.data)) ?? "absent";

    const raw: AnyProxy = tryReadValue(() =>
      typeof node.toJSON === "function" ? node.toJSON() : undefined,
    );
    if (raw && typeof raw === "object") {
      out.nodeJsonKeys = Object.keys(raw).sort();
      // Full key set of every fl/st entry in the raw document, plus the
      // spec-named binding fields, plus the first fill entry whole — an
      // extra key of ANY name shows up here with its value shape.
      const paintEntries: Json[] = [];
      let firstFillJson: Json = "none";
      const walk = (value: AnyProxy, depth: number): void => {
        if (depth > 8 || value === null || typeof value !== "object") return;
        if (Array.isArray(value)) {
          for (const item of value) walk(item, depth + 1);
          return;
        }
        if (value.ty === "fl" || value.ty === "st") {
          paintEntries.push({
            ty: String(value.ty),
            keys: Object.keys(value).sort(),
            sid: toJson(value.sid),
          });
          if (value.ty === "fl" && firstFillJson === "none") firstFillJson = toJson(value);
        }
        for (const key of Object.keys(value)) walk(value[key], depth + 1);
      };
      walk(raw, 0);
      out.nodePaintJson = paintEntries;
      out.firstFillJson = firstFillJson;
    } else {
      out.nodeToJSON = raw === undefined ? "absent" : String(raw);
    }

    const sceneRaw: AnyProxy = tryReadValue(() => {
      const scene: AnyProxy = creator.activeScene;
      return scene && typeof scene.toJSON === "function" ? scene.toJSON() : undefined;
    });
    if (sceneRaw && typeof sceneRaw === "object" && !Array.isArray(sceneRaw)) {
      out.sceneJsonKeys = Object.keys(sceneRaw).sort();
      for (const key of ["slots", "tokens", "themes", "styles", "vars"]) {
        if (key in sceneRaw) out[`sceneJson_${key}`] = toJson(sceneRaw[key]);
      }
    } else {
      out.sceneToJSON = sceneRaw === undefined ? "absent" : String(sceneRaw);
    }
  } catch (error) {
    out.tokenHuntError = error instanceof Error ? error.message : String(error);
  }
  return out;
}

/** The scope as the panel reads it — layer identities, or why it is the scene. */
function scopeReport(
  layers: readonly NodeTree[],
  scope: RecordScope,
  fellBack: boolean,
): ScopeReport {
  if (scope.kind === "layers") return { kind: "layers", layers: scopeLayerRefs(layers, scope) };
  return fellBack ? { kind: "scene", fallback: "unresolved" } : { kind: "scene" };
}

export function recordStart(params: { debug?: boolean }): {
  nodeId: string;
  nodeName?: string;
  paintIntrospection?: Json;
  keyframeIntrospection?: Json;
  shapeIntrospection?: Json;
  selectionIntrospection?: Json;
  scope: ScopeReport;
  selectionCount?: number;
} {
  // No selection required: an empty selection is the whole-scene recording
  // this plugin has always done. A selection narrows it to those layers.
  const scene = creator.activeScene;
  if (!scene) {
    throw new Error(RPC_ERRORS.noSelection);
  }
  const snapshot = serializeScene(scene);
  const nodes = selectedNodes();
  const resolved = resolveScope(snapshot.layers, selectedIds(nodes));
  session.recording = {
    scene,
    lastSnapshot: snapshot,
    firstSnapshot: snapshot,
    debug: params?.debug === true,
    scope: resolved.scope,
    ignored: 0,
  };
  session.playback = null;
  const report = scopeReport(snapshot.layers, resolved.scope, resolved.fellBack);
  const result: {
    nodeId: string;
    nodeName?: string;
    paintIntrospection?: Json;
    keyframeIntrospection?: Json;
    shapeIntrospection?: Json;
    selectionIntrospection?: Json;
    scope: ScopeReport;
    selectionCount?: number;
  } = { nodeId: snapshot.sceneId ?? "scene", scope: report };
  const sceneName = ((): string | undefined => {
    try {
      return typeof scene.name === "string" ? scene.name : undefined;
    } catch {
      return undefined;
    }
  })();
  if (sceneName) result.nodeName = sceneName;
  // A single-layer scope names THAT layer as the macro's source: the saved
  // macro says what it was recorded from. Replay does not depend on it — a
  // layer-bound macro played with nothing selected takes scene mode and
  // resolves by recorded id and name; `sourceNodeId` is read only by the
  // targets-mode legacy fallback (sandbox/playback.ts), which this now
  // points at a layer instead of a scene.
  const scoped = resolved.scope;
  if (scoped.kind === "layers" && scoped.ids.length === 1) {
    const only = scoped.ids[0];
    const layer = snapshot.layers.find((l) => l.nodeId === only);
    if (layer) {
      result.nodeId = layer.nodeId;
      if (layer.nodeName === undefined) delete result.nodeName;
      else result.nodeName = layer.nodeName;
    }
  }
  result.selectionCount = nodes.length;
  // Debug introspection still favors the selected node's paints when present.
  if (params?.debug === true) {
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
  // Diff the WHOLE scene, then drop what the scope does not watch. The differ
  // needs every layer of both snapshots (clone detection, the reorder
  // survivors list, same-tick nest/break correlation), so the scope can only
  // be applied to its output.
  const partition = partitionByScope(diffScene(prev, next), recording.scope);
  recording.scope = partition.scope;
  recording.ignored += partition.ignored;
  recording.lastSnapshot = next;
  const payloads = partition.kept;
  const steps = payloads.map(buildStep);
  // Only KEPT steps count as productive: a session that ignored everything
  // recorded nothing, and recordStop's debug fallback must still say so.
  if (steps.length > 0) recording.stepped = true;
  // Only carry the (large) snapshot pair when it says something: a tick that
  // produced no steps and no diff is noise. An ignored payload is something —
  // the pair is the evidence for what the scope dropped.
  if (recording.debug && (steps.length > 0 || partition.ignored > 0)) {
    const debug: RecordDebug = { prev, next };
    if (partition.ignored > 0) debug.ignored = partition.ignored;
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
 * The selection as plain ids — all the scope resolver needs from it. Takes
 * an already-read node list so a caller that needs the proxies too (the
 * capture offer, the debug probes) does not read the selection twice.
 */
function selectedIds(nodes: AnyProxy[] = selectedNodes()): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    // A node whose id the host will not give up cannot be scoped at all —
    // it is skipped, not stringified into a literal "undefined" that would
    // then read as "selected in another scene".
    const raw = tryReadValue(() => node.id);
    if (raw !== undefined && raw !== null) ids.push(String(raw));
  }
  return ids;
}

/**
 * What `record.start` WOULD watch right now. Touches no session state and no
 * snapshot machinery: `serializeSceneIndex` reads identities only, because
 * the panel polls this once a second while idle and the sandbox has no
 * timers of its own to do it any other way.
 */
export function selectionPeek(): { scope: ScopeReport | null; sceneName?: string } {
  const scene = tryReadValue(() => creator.activeScene);
  if (scene === undefined || scene === null) return { scope: null };
  const index = serializeSceneIndex(scene);
  const resolved = resolveScope(index.layers, selectedIds());
  return {
    scope: scopeReport(index.layers, resolved.scope, resolved.fellBack),
    ...(index.sceneName === undefined ? {} : { sceneName: index.sceneName }),
  };
}

/** Reads a host keyframe list into {frame, value} pairs, defensively. */
function readSelectedList(list: AnyProxy[]): SelectedKf[] {
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
 * Latest `selection:keyframes` EVENT payload. Live sessions proved the
 * polled getter (`creator.selection.keyframes`) reads as a permanently
 * EMPTY array on the real host (docs/limitations.md, traces 2026-08-24/25) —
 * this typed event is the remaining route by which a host could deliver
 * the selection. The cache is replaced wholly per fire; `fired` counts
 * land in the selectionIntrospection probe so traces settle whether the
 * event exists in practice.
 */
const selectionEvents = {
  supported: false,
  fired: 0,
  entries: [] as SelectedKf[],
};

export function initSelectionEvents(): void {
  try {
    // Typed since 1.0.1, still feature-detected: a host that predates the
    // event bus has no `on` at all.
    if (typeof creator.on !== "function") return;
    creator.on("selection:keyframes", (event: AnyProxy) => {
      selectionEvents.fired += 1;
      // Typed as the bare Keyframe[] payload; the runtime shape is
      // unverified, so accept a {data} envelope defensively too.
      let data: AnyProxy;
      try {
        data = Array.isArray(event) ? event : event?.data;
      } catch {
        data = undefined;
      }
      selectionEvents.entries = readSelectedList(Array.isArray(data) ? data : []);
    });
    selectionEvents.supported = true;
  } catch {
    // host without an event bus — the getter path still runs
  }
}

/**
 * Defensive read of the SELECTED-KEYFRAMES surface. Returns undefined when
 * neither the getter nor the event bus exists (feature detection);
 * otherwise the entries' {frame, value} pairs — from the polled getter
 * when it has entries, else from the latest selection:keyframes event.
 */
function selectedKeyframes(): SelectedKf[] | undefined {
  let list: AnyProxy;
  let getterLive = false;
  try {
    list = (creator.selection as AnyProxy).keyframes;
    getterLive = Array.isArray(list);
  } catch {
    // fall through to the event cache
  }
  if (getterLive && (list as AnyProxy[]).length > 0) {
    return readSelectedList(list as AnyProxy[]);
  }
  if (selectionEvents.supported && selectionEvents.entries.length > 0) {
    return [...selectionEvents.entries];
  }
  if (getterLive || selectionEvents.supported) return [];
  return undefined;
}

/**
 * The standing capture offer, recomputed from the tick's OWN snapshot plus
 * one selection read: exactly one selected node, matching a top-level
 * non-SCENE layer of the snapshot, with >=1 keyframe in its subtree.
 * SCENE_INSTANCE layers are excluded — their shapes channel is the source
 * scene's shared content, and capturing it would edit every instance.
 *
 * A layer outside the recording's scope is excluded too: capturing it would
 * write steps for a layer whose ordinary edits this session drops.
 */
function computeCaptureOffer(
  next: SceneSnapshot,
  nodes: AnyProxy[],
  scope: RecordScope,
): CaptureOffer | undefined {
  if (nodes.length !== 1) return undefined;
  let selectedId: string;
  try {
    selectedId = String(nodes[0].id);
  } catch {
    return undefined;
  }
  if (scope.kind === "layers" && !scope.ids.includes(selectedId)) return undefined;
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

/**
 * The scene switched under the recording — said ONCE, as a step.
 *
 * `record.start` PINS `creator.activeScene` and every tick re-serializes that
 * same proxy, so switching scenes mid-recording silently records nothing the
 * user can see happening. Both reads here are live-verified surfaces
 * (`creator.activeScene`, `Scene.id`).
 *
 * The note rides the `not-replayable` step channel because `record.tick`'s
 * RPC result has NO notes field (engine/protocol.ts) and the debug channel is
 * opt-in, so a production session would never be told. A `not-replayable`
 * step is marked `replayable: false`, is visible in the review list, and the
 * user can delete it.
 */
function sceneSwitchStep(recording: RecordingSession): MacroStep | undefined {
  if (recording.sceneSwitchNoted) return undefined;
  const pinned = tryReadValue(() => String(recording.scene.id));
  const active = tryReadValue(() => String(creator.activeScene?.id));
  if (pinned === undefined || active === undefined || pinned === active) return undefined;
  recording.sceneSwitchNoted = true;
  const name = tryReadValue(() => recording.scene.name);
  const label = typeof name === "string" && name ? `"${name}"` : "the scene you started in";
  return buildStep({
    op: "not-replayable",
    description: `You switched scenes — still recording ${label}`,
  });
}

export function recordTick(seq: number): {
  seq: number;
  steps: MacroStep[];
  captureOffer?: CaptureOffer;
  ignored: number;
  scope?: ScopeReport;
  selectionCount?: number;
  debug?: RecordDebug;
} {
  const recording = session.recording;
  const scopeBefore = recording?.scope.kind === "layers" ? recording.scope.ids.length : -1;
  const delta = collectDelta();
  // collectDelta advanced lastSnapshot to this tick's serialization; the
  // offer is computed from that same snapshot — no second serialize. One
  // selection read serves both the offer and the diagnostic count.
  const nodes = selectedNodes();
  const offer = recording
    ? computeCaptureOffer(recording.lastSnapshot, nodes, recording.scope)
    : undefined;
  // The scope only ever GROWS (a layer this recording created joined it), so
  // a longer id list is the whole signal; the panel then names the scope as
  // it stands, not as it started.
  const grown =
    recording && recording.scope.kind === "layers" && recording.scope.ids.length > scopeBefore
      ? scopeReport(recording.lastSnapshot.layers, recording.scope, false)
      : undefined;
  // Appended AFTER collectDelta set `stepped`: the switch note is the
  // sandbox talking, not something the user recorded, so it must not make a
  // silent session look productive to recordStop's debug fallback.
  const switched = recording ? sceneSwitchStep(recording) : undefined;
  return {
    seq,
    steps: switched ? [...delta.steps, switched] : delta.steps,
    ...(offer ? { captureOffer: offer } : {}),
    // Cumulative, so the chip reads as a running count rather than a blip
    // that clears on the next quiet tick.
    ignored: recording?.ignored ?? 0,
    ...(grown ? { scope: grown } : {}),
    ...(recording ? { selectionCount: nodes.length } : {}),
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
  // The offer already withholds an out-of-scope layer; this keeps the
  // invariant local, so a caller other than the offer cannot capture a
  // layer the recording does not watch.
  if (recording.scope.kind === "layers" && !recording.scope.ids.includes(layer.nodeId)) {
    throw new Error("layer outside the recording scope");
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
  // Captured steps are session steps too: recordStop's "recorded nothing"
  // fallback must stay quiet after them (traces 2026-09-04T03-47-27 and
  // 03-51-20 stapled a whole-session pair onto capture-only sessions).
  if (payloads.length > 0) recording.stepped = true;
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
