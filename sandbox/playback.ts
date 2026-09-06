import type { Json } from "../engine/json";
import { jsonEqual, toJson } from "../engine/json";
import type { MacroStep } from "../engine/macro";
import type { PlaybackStepDebug, TargetProbe } from "../engine/protocol";
import { RPC_ERRORS, type NoteKind } from "../engine/protocol";
import type { NodeSnapshot, Path } from "../engine/snapshot";
import { pathKey, propClassOf } from "../engine/snapshot";
import { nodeTypeName } from "../engine/labels";
import type { LayerRef, StepPayload } from "../engine/steps";
import { hasKeyframes } from "../engine/steps";
import { resolvePaint,
  applyNodeSpec,
  applyStep,
  delayLayer,
  NoteList,
  readBaseline,
  reorderChildren,
  resolvePath,
} from "./applier";
// (instance-content edits resolve strictly by index — user decision: layer
// order, not shape-type matching, maps recorded content onto nested content)
import { serializeNode, valueToJson } from "./serialize";
import { session } from "./session";

type AnyProxy = any;

/**
 * Diagnostics for undocumented host calls, collected per step and attached
 * to the debug payload. Never notes: the user can't act on them.
 */
const breadcrumbs: string[] = [];

/**
 * Layer ids the current step's scene summary must report whatever the cap
 * says. A nest step touches a handful of layers in a scene that can hold
 * hundreds, and those are exactly the ones a trace needs to see.
 */
const pinned = new Set<string>();

function tryRead<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Step analysis
// ---------------------------------------------------------------------------

function payloadOf(step: MacroStep): StepPayload | undefined {
  const payload = step.payload as StepPayload | undefined;
  return payload && typeof payload === "object" && "op" in payload ? payload : undefined;
}

function isSceneOp(payload: StepPayload): boolean {
  return (
    payload.op === "add-layer" ||
    payload.op === "remove-layer" ||
    payload.op === "break-scene" ||
    payload.op === "nest-layers" ||
    payload.op === "reorder-layers" ||
    payload.op === "set-scene"
  );
}

function layerRefOf(payload: StepPayload): LayerRef | undefined {
  return "layer" in payload ? payload.layer : undefined;
}

interface StepAnalysis {
  mode: "targets" | "scene";
  /** Targets-mode: the recorded layer id playing the "source" role. */
  sourceRoleId?: string;
}

/**
 * A macro that touches several layers (or restructures the scene) replays as
 * a scene rebuild: each step finds its own layer by recorded id, then by name,
 * then skips. A macro that touches at most one PRE-EXISTING layer keeps the
 * selection semantics — apply to every selected layer, offsets from each
 * one's start. That includes duplication: "duplicate the layer, edit the
 * copy" is a reusable tool, so with a selection the duplicate clones each
 * SELECTED layer and the copy's edits follow the clone.
 */
function chooseMode(steps: MacroStep[], selectionCount: number): StepAnalysis {
  const referenced = new Set<string>();
  const createdIds = new Set<string>();
  const cloneSources = new Set<string>();
  let unretargetableSceneOps = false;
  let sceneSettings = false;
  for (const step of steps) {
    const payload = payloadOf(step);
    if (!payload) continue;
    if (payload.op === "add-layer") {
      createdIds.add(payload.spec.nodeId);
      if (payload.cloneOf) cloneSources.add(payload.cloneOf.id);
      else unretargetableSceneOps = true; // fresh layers are scene structure
    } else if (
      payload.op === "remove-layer" ||
      payload.op === "break-scene" ||
      payload.op === "nest-layers" ||
      payload.op === "reorder-layers"
    ) {
      unretargetableSceneOps = true;
    } else if (payload.op === "set-scene") {
      // NOT unretargetable: a scene setting is applied once either way, so it
      // must not cost a mixed macro its per-selection retargeting.
      sceneSettings = true;
    }
    const ref = layerRefOf(payload);
    if (ref) referenced.add(ref.id);
  }
  // Layers that must already exist when the macro starts: referenced or
  // clone-source ids that the macro itself did not create.
  const preExisting = new Set<string>();
  for (const id of [...referenced, ...cloneSources]) {
    if (!createdIds.has(id)) preExisting.add(id);
  }

  if (!unretargetableSceneOps && preExisting.size <= 1 && selectionCount > 0) {
    const analysis: StepAnalysis = { mode: "targets" };
    const first = [...preExisting][0];
    if (first !== undefined) analysis.sourceRoleId = first;
    return analysis;
  }
  if (unretargetableSceneOps || preExisting.size > 1 || createdIds.size > 0) {
    return { mode: "scene" };
  }
  if (selectionCount > 0) return { mode: "targets" };
  // Nothing selected and nothing layer-bound: a settings-only macro is still
  // a scene rebuild, and must not fail the targets path's no-selection gate.
  return referenced.size > 0 || sceneSettings ? { mode: "scene" } : { mode: "targets" };
}

/**
 * The path a payload touches, when it has a single one.
 *
 * Structural ops (add-mask / add-trim / add-stroke) get a path one segment
 * DEEPER than the entry they create, at a member `probe()` can actually read:
 * probing the bare `masks[0]` reads no staticValue, so before and after both
 * came back null and traces couldn't tell "created" from "silently skipped"
 * (traces 2026-08-26T08-13-16, add-trim null/null). With a sub-path the
 * BEFORE is unreadable (the entry doesn't exist yet) and the AFTER carries a
 * value — that asymmetry IS the creation signal. Removals probe the entry
 * itself, so the signal runs the other way.
 */
function pathOf(payload: StepPayload | undefined): Path | undefined {
  if (!payload) return undefined;
  switch (payload.op) {
    case "set-static":
    case "keyframes":
    case "set-plain":
    case "remove-paint":
    case "replace-paint":
    case "add-paint":
    case "remove-shape":
      return payload.path;
    case "add-mask":
      return [...payload.path, "opacity"];
    case "add-trim":
      return [...payload.path, "end"];
    case "add-stroke":
      return [...payload.path, "width"];
    case "remove-mask":
    case "remove-trim":
      return payload.path;
    default:
      return undefined;
  }
}

/** Paths whose values shift per-target in targets mode (smart offsets). */
function relativePaths(steps: MacroStep[]): { path: Path; origin: Json }[] {
  const seen = new Set<string>();
  const out: { path: Path; origin: Json }[] = [];
  for (const step of steps) {
    const payload = payloadOf(step);
    if (!payload) continue;
    if (payload.op !== "set-static" && payload.op !== "keyframes") continue;
    if (propClassOf(payload.path) === "absolute") continue;
    const key = pathKey(payload.path);
    if (seen.has(key)) continue;

    if (payload.op === "set-static") {
      seen.add(key);
      out.push({ path: payload.path, origin: payload.before });
      continue;
    }

    const candidates = [
      ...payload.added,
      ...payload.changed.map((change) => change.before),
      ...payload.removed,
    ];
    if (candidates.length === 0) continue;
    let first = candidates[0]!;
    for (const kf of candidates) {
      if (kf.frame < first.frame) first = kf;
    }
    seen.add(key);
    out.push({ path: payload.path, origin: first.value });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Probes (dev diagnostics)
// ---------------------------------------------------------------------------

function countOf(target: AnyProxy, key: "fills" | "strokes"): number {
  try {
    const list = target[key];
    return Array.isArray(list) ? list.length : 0;
  } catch {
    return 0;
  }
}

/** A Paint proxy has no staticValue — summarize what it IS so paint swaps
 *  (replace-paint) are verifiable in traces instead of probing null/null. */
function paintSummary(paint: AnyProxy): Json {
  const out: Record<string, Json> = {};
  const t = tryRead(() => toJson(paint.type));
  if (t !== undefined && t !== null) out.paintType = t;
  const color = tryRead(() => toJson(paint.color?.staticValue));
  if (color !== undefined && color !== null) out.color = color;
  const stops = tryRead(() => toJson(paint.stops?.staticValue));
  if (stops !== undefined && stops !== null) out.stops = stops;
  return out;
}

function isPaintShaped(prop: AnyProxy): boolean {
  return (
    tryRead(() => prop.staticValue) === undefined &&
    tryRead(() => prop.type) !== undefined &&
    (tryRead(() => prop.color) !== undefined || tryRead(() => prop.stops) !== undefined)
  );
}

function probe(target: AnyProxy, name: string, path: Path | undefined): TargetProbe {
  const base: TargetProbe = {
    target: name,
    value: null,
    animated: false,
    keyframes: [],
    fills: countOf(target, "fills"),
    strokes: countOf(target, "strokes"),
  };
  if (!path) return base;
  let prop: AnyProxy;
  try {
    prop = resolvePath(target, path);
  } catch (error) {
    // Topology fallback: the RECORDED path may not exist on this target
    // even though the write itself remapped to the target's own paint
    // (resolvePaint's role-based descent). Follow it so the trace shows
    // the paint that was actually written, not "unreadable".
    if (path.lastIndexOf("fills") >= 0) {
      const probePath =
        typeof path[path.length - 1] === "number" ? [...path, "color"] : path;
      const resolved = tryRead(() => resolvePaint(target, probePath));
      if (resolved) {
        base.value = paintSummary(resolved.paint);
        return base;
      }
    }
    return { ...base, unreadable: error instanceof Error ? error.message : String(error) };
  }
  // A paint itself (replace-paint's path) — report what it is.
  if (prop !== null && typeof prop === "object" && isPaintShaped(prop)) {
    base.value = paintSummary(prop);
    return base;
  }
  // set-plain paths terminate at a raw scalar (text, fontSize, visible, …),
  // not an Animatable proxy — report the value itself; probing .staticValue
  // off a string yields null on both sides and hides real writes.
  if (prop === null || (typeof prop !== "object" && typeof prop !== "function")) {
    try {
      base.value = toJson(prop);
    } catch {
      // leave null
    }
    return base;
  }
  try {
    // valueToJson, not toJson: PathData is getter-based on the host, so a
    // generic read probes `{}` on BOTH sides and hides every path write.
    base.value = valueToJson(prop.staticValue);
  } catch {
    // leave null — an unreadable value is itself a finding
  }
  try {
    base.animated = prop.isAnimated === true;
  } catch {
    // leave false
  }
  try {
    const list = prop.keyframes;
    if (Array.isArray(list)) {
      base.keyframes = list
        .map((kf: AnyProxy) => {
          let frame = NaN;
          let value: Json = null;
          let easing: Json = null;
          try {
            frame = Number(kf.frame);
          } catch {
            // unreadable frame drops the entry below
          }
          try {
            value = valueToJson(kf.value);
          } catch {
            // keep null — the frame is still worth reporting
          }
          try {
            easing = toJson(kf.easing);
          } catch {
            // easing stays null — value/frame still probe
          }
          return easing === null ? { frame, value } : { frame, value, easing };
        })
        .filter((entry: { frame: number }) => Number.isFinite(entry.frame))
        .sort((a: { frame: number }, b: { frame: number }) => a.frame - b.frame);
    }
  } catch {
    // leave empty
  }
  return base;
}

/** How many layers a scene summary reports before it stops counting. */
const SCENE_SUMMARY_CAP = 25;

/**
 * A scene op's observable state: the top-level layer list, in order.
 *
 * Scene ops used to probe `[]` on both sides, which made reorder / nest /
 * break structurally BLIND in traces — trace 2026-08-26T08-15-02 shows a
 * reorder executing with no way to tell what the scene looked like before or
 * after. An ordered {id, name, type} list makes every one of them auditable.
 * Every read is guarded: a scene op often runs while nodes are being created
 * or destroyed, and any getter can throw.
 *
 * A scene layer also reports `inner`, the number of layers inside it — the
 * one number that tells a nest from an empty shell. Layers the step itself
 * touched are PINNED: they are reported even past the cap, because a 26-layer
 * scene would otherwise hide the very layer the step created (traces
 * 2026-09-07T01-13-19, 26 layers selected).
 */
function sceneSummary(label: string): TargetProbe {
  const layers = sceneLayers();
  const entries: Json[] = [];
  for (const layer of layers) {
    const id = tryRead(() => String(layer.id));
    if (entries.length >= SCENE_SUMMARY_CAP && !(id !== undefined && pinned.has(id))) continue;
    const entry: Record<string, Json> = {};
    if (id !== undefined) entry.id = id;
    const name = tryRead(() => toJson(layer.name));
    if (name !== undefined && name !== null) entry.name = name;
    const type = tryRead(() => String(layer.type));
    if (type !== undefined) entry.type = type;
    const inside = tryRead(() => (layer as AnyProxy).scene?.layers);
    if (Array.isArray(inside)) entry.inner = inside.length;
    entries.push(entry);
  }
  const probe: TargetProbe = {
    target: label,
    value: entries,
    animated: false,
    keyframes: [],
    fills: 0,
    strokes: 0,
  };
  if (layers.length > entries.length) {
    probe.unreadable = `${layers.length} layers — summary capped at ${SCENE_SUMMARY_CAP}`;
  }
  return probe;
}

/** A scene SETTING's observable state — the value itself, so a trace can tell
 *  a taken write from a discarded one. */
function sceneSettingProbe(key: string, label: string): TargetProbe {
  const value = tryRead(() => toJson((creator.activeScene as AnyProxy)?.[key]));
  return {
    target: label,
    value: value === undefined ? null : value,
    animated: false,
    keyframes: [],
    fills: 0,
    strokes: 0,
  };
}

// ---------------------------------------------------------------------------
// Scene-mode layer resolution & scene ops
// ---------------------------------------------------------------------------

/** The current selection, defensively — the host may refuse the read. */
function selectedNodes(): AnyProxy[] {
  try {
    return Array.isArray(creator.selection.nodes) ? [...creator.selection.nodes] : [];
  } catch {
    return [];
  }
}

function sceneLayers(): AnyProxy[] {
  const layers = tryRead(() => creator.activeScene?.layers);
  return Array.isArray(layers) ? [...layers] : [];
}

function findNodeById(id: string): AnyProxy | undefined {
  const stack: AnyProxy[] = sceneLayers();
  while (stack.length > 0) {
    const node = stack.pop();
    try {
      if (String(node.id) === id) return node;
    } catch {
      // unreadable node — keep looking
    }
    try {
      const shapes = node.shapes;
      if (Array.isArray(shapes)) stack.push(...shapes);
    } catch {
      // leaf
    }
  }
  return undefined;
}

/** id -> name -> miss, caching hits (including replay-created layers). */
function resolveLayer(ref: LayerRef): AnyProxy | undefined {
  const playback = session.playback!;
  const cached = playback.layerByRecordedId.get(ref.id);
  if (cached) return cached;
  let found: AnyProxy | undefined;
  for (const layer of sceneLayers()) {
    if (tryRead(() => String(layer.id)) === ref.id) {
      found = layer;
      break;
    }
  }
  for (const name of [ref.name, ref.priorName]) {
    if (found || !name) continue;
    for (const layer of sceneLayers()) {
      if (tryRead(() => layer.name) === name) {
        found = layer;
        break;
      }
    }
  }
  if (found) playback.layerByRecordedId.set(ref.id, found);
  return found;
}

function layerLabel(ref: LayerRef | undefined): string {
  return ref?.name ?? ref?.id ?? "layer";
}

/**
 * Rebuilds a recorded layer from its spec, using the factory that matches its
 * type: scene-instance layers need createSceneLayer — building them with
 * createShapeLayer produced the wrong kind of layer entirely ("create scene
 * is not working").
 */
export function createLayerFromSpec(
  scene: AnyProxy,
  spec: NodeSnapshot,
  notes: NoteList,
): AnyProxy | undefined {
  // An image layer's content is an ASSET the recording never captured, so no
  // factory can rebuild it: createShapeLayer gives the same dishonest empty
  // shell TEXT_LAYER used to get (below), and createImageLayer would need an
  // asset there is none of. Say what happened instead of building one.
  if (spec.nodeType === "IMAGE_LAYER") {
    notes.push("can't re-create an image layer — the recording has no image asset — skipped");
    return undefined;
  }
  // Factory must match the recorded type: a TEXT_LAYER rebuilt with
  // createShapeLayer is a shape shell with no text surface — every later
  // set-plain text/font write lands on nothing (live evidence: trace
  // 2026-08-24T07-49-36-061, "Text 1" with runtime type SHAPE_LAYER). A
  // host without createTextLayer skips with the note below rather than
  // silently building a fake.
  const factoryName = spec.nodeType.startsWith("SCENE")
    ? "createSceneLayer"
    : spec.nodeType === "TEXT_LAYER"
      ? "createTextLayer"
      : "createShapeLayer";
  const factory = tryRead(() => (scene as AnyProxy)[factoryName]);
  if (typeof factory !== "function") {
    notes.push(`this scene can't create ${nodeTypeName(spec.nodeType)} layers — skipped`);
    return undefined;
  }
  const created = factory.call(scene);
  // A scene layer's children are LAYERS, not shapes, so they cannot travel
  // through applyNodeSpec's shape channel — that is what made every rebuilt
  // nest an empty shell (docs/limitations.md, sub-finding of the 08-32-08
  // replay). Build them with this same function, one level down, inside the
  // new layer's own scene.
  if (spec.nodeType.startsWith("SCENE")) {
    applyNodeSpec(created, { ...spec, shapes: [] }, notes);
    buildIntoSceneLayer(created, spec.shapes as NodeSnapshot[], notes);
    return created;
  }
  applyNodeSpec(created, spec, notes);
  return created;
}

/**
 * Builds `children` as layers inside `sceneLayer`'s own scene.
 *
 * The inner scene and its factories are typed on 1.0.1 but not yet
 * live-verified (docs/runtime-api.md), so the factory is feature-detected and
 * a host without it gets a note instead of a silent empty nest.
 */
function buildIntoSceneLayer(
  sceneLayer: AnyProxy,
  children: NodeSnapshot[],
  notes: NoteList,
): AnyProxy[] {
  if (children.length === 0) return [];
  const inner = tryRead(() => sceneLayer.scene);
  if (typeof tryRead(() => inner?.createShapeLayer) !== "function") {
    notes.push(
      `this scene layer has no scene to build into — its ${children.length} ${
        children.length === 1 ? "layer was" : "layers were"
      } skipped`,
    );
    return [];
  }
  const built: AnyProxy[] = [];
  for (const child of children) {
    const layer = createLayerFromSpec(inner, child, notes);
    if (layer) built.push(layer);
  }
  return built;
}

/** What a successful `nestByRebuild` produced. */
interface NestOutcome {
  /** The new scene layer. */
  shell: AnyProxy;
  /** The host consumed the selection itself — nothing was copied or removed. */
  moved: boolean;
  /** Source index -> the layer that now stands for it inside the nest. */
  nested: Map<number, AnyProxy>;
  /** Sources that could not be rebuilt (image layers) and stayed put. */
  skipped: number;
}

/** The layers inside a scene layer's own scene, or an empty list. */
function innerLayers(sceneLayer: AnyProxy): AnyProxy[] {
  const content = tryRead(() => sceneLayer?.scene?.layers);
  return Array.isArray(content) ? [...content] : [];
}

/**
 * Debug breadcrumb for one undocumented host call: these semantics are typed
 * but not live-verified, so the attempt reports what actually came back and
 * the trace pins the contract. Diagnostics, never a user-facing note.
 */
function describeNestCall(label: string, value: AnyProxy): void {
  const kind =
    value === undefined
      ? "undefined"
      : value === null
        ? "null"
        : typeof (value as { then?: unknown })?.then === "function"
          ? "promise"
          : typeof value;
  breadcrumbs.push(
    `[nest] ${label} -> ${kind}, content=${innerLayers(value).length}, top=${sceneLayers().length}`,
  );
}

/** Keeps a live node in the scene summary past the cap, when it has an id. */
function pinNode(node: AnyProxy): void {
  const id = tryRead(() => String(node.id));
  if (id !== undefined) pinned.add(id);
}

function removeQuietly(node: AnyProxy): void {
  try {
    node?.remove();
  } catch {
    // nothing else to try; the caller's note explains the result
  }
}

/**
 * Nests `sources` by REBUILDING them inside a new scene layer.
 *
 * There is no API that moves an existing layer into a scene layer (confirmed
 * limitation, docs/limitations.md): `createSceneLayer()` creates an EMPTY
 * scene layer and does not consume the selection (docs/runtime-api.md quirk 8,
 * live-verified), and the three older guesses — `createSceneInstance(layers)`,
 * `createSceneLayer(layers)`, `shiftTo(node)` — are settled by 1.0.1 as
 * non-existent, mistyped, or (for `shiftTo(frame: number)`) a HAZARD that
 * would silently retime the user's layer.
 *
 * What IS available is the documented way to fill a nestable scene: build the
 * layers inside it with the ordinary factories. So this reads each source with
 * `serializeNode`, creates the shell, rebuilds a copy of each source inside
 * it, verifies the copies by reading them back, and only then removes the
 * originals. Any failure removes what it created and returns undefined, with
 * the originals untouched.
 *
 * Two routes to a scene to build into, in this order:
 *   1. the shell's own `scene` (1.0.1 `SceneLayer.scene: Scene`);
 *   2. `creator.createScene()` plus `createSceneLayer({ scene })`.
 * Both are feature-detected: 1.0.1 types them, no trace confirms them yet.
 */
function nestByRebuild(
  scene: AnyProxy,
  sources: AnyProxy[],
  spec: NodeSnapshot,
  notes: NoteList,
): NestOutcome | undefined {
  const layerFactory = tryRead(() => (scene as AnyProxy).createSceneLayer);
  if (typeof layerFactory !== "function") return undefined;

  // 1. Read the sources BEFORE anything changes. An image layer's content is
  //    an asset the recording never captured, so no factory can rebuild it.
  const buildable: { index: number; node: AnyProxy; snapshot: NodeSnapshot }[] = [];
  let skipped = 0;
  sources.forEach((node, index) => {
    const snapshot = tryRead(() => serializeNode(node));
    if (!snapshot || snapshot.nodeType === "IMAGE_LAYER") {
      skipped += 1;
      notes.push(
        snapshot
          ? "an image layer can't be rebuilt inside the new scene — left it where it was"
          : `couldn't read ${tryRead(() => String(node.name)) ?? "a layer"} — left it where it was`,
      );
      return;
    }
    buildable.push({ index, node, snapshot });
  });
  // Nothing rebuildable means nothing to nest: do not leave an empty shell
  // behind and call it a nest.
  if (buildable.length === 0) return undefined;

  // 2. Point the selection at the sources first: a host that ever starts
  //    consuming it does the whole job for us, and this is the call.
  try {
    (creator.selection as AnyProxy).nodes = sources;
  } catch {
    // selection may not be assignable; the reads below decide the outcome
  }
  let shell = tryRead(() => layerFactory.call(scene));
  describeNestCall("createSceneLayer()", shell);
  if (!shell) return undefined;
  pinNode(shell);

  // The spec's TRANSFORM is deliberately withheld: it belongs to the nest the
  // recording made, over different layers, and applying it here would move the
  // user's content. Only the name and the plain flags carry over. (The
  // spec-rebuild path in `createLayerFromSpec` applies everything, because
  // there the spec IS the layer being reproduced.)
  const dressShell = () =>
    applyNodeSpec(
      shell,
      { ...spec, props: {}, fills: [], strokes: [], masks: [], trims: [], shapes: [] },
      notes,
    );

  const moved = innerLayers(shell);
  if (moved.length > 0) {
    // The host moved them. Nothing to rebuild, nothing to remove.
    dressShell();
    const nested = new Map<number, AnyProxy>();
    moved.forEach((layer, i) => nested.set(i, layer));
    return { shell, moved: true, nested, skipped: 0 };
  }

  // 3. Route 1: the shell's own scene.
  let inner = tryRead(() => shell.scene);
  let ownScene: AnyProxy | undefined;
  describeNestCall("shell.scene.createShapeLayer", tryRead(() => inner?.createShapeLayer));
  if (typeof tryRead(() => inner?.createShapeLayer) !== "function") {
    // 4. Route 2: a scene of our own, attached through the create options.
    removeQuietly(shell);
    const opts: Record<string, Json> = {};
    if (spec.nodeName) opts.name = spec.nodeName;
    for (const key of ["size", "framerate", "duration"] as const) {
      const value = tryRead(() => toJson((scene as AnyProxy)[key]));
      if (value !== undefined && value !== null) opts[key] = value;
    }
    const factory = tryRead(() => (creator as AnyProxy).createScene);
    if (typeof factory !== "function") return undefined;
    ownScene = tryRead(() => factory.call(creator, opts));
    describeNestCall("creator.createScene()", ownScene);
    if (
      !ownScene ||
      typeof tryRead(() => ownScene!.createShapeLayer) !== "function" ||
      tryRead(() => ownScene!.isNestableScene) === false
    ) {
      removeQuietly(ownScene);
      return undefined;
    }
    shell = tryRead(() => layerFactory.call(scene, { scene: ownScene }));
    describeNestCall("createSceneLayer({ scene })", shell);
    if (!shell || tryRead(() => shell.scene) !== ownScene) {
      removeQuietly(shell);
      removeQuietly(ownScene);
      return undefined;
    }
    pinNode(shell);
    inner = ownScene;
  }

  const abandon = (): undefined => {
    removeQuietly(shell);
    if (ownScene) removeQuietly(ownScene);
    return undefined;
  };

  // 5. Rebuild each source inside the new scene.
  const copies: AnyProxy[] = [];
  for (const entry of buildable) {
    const copy = createLayerFromSpec(inner, entry.snapshot, notes);
    if (!copy) return abandon();
    copies.push(copy);
  }

  // 6. Verify by READS, the same rule the rest of playback follows: a nest
  //    that cannot be read back did not happen.
  const inside = tryRead(() => inner?.layers);
  if (!Array.isArray(inside) || inside.length < copies.length) return abandon();
  // Membership by id first: a live host may hand out a fresh proxy on every
  // read, so object identity is the fallback, not the rule.
  const insideIds = new Set(
    inside.map((layer: AnyProxy) => tryRead(() => String(layer.id))).filter(Boolean),
  );
  for (let i = 0; i < copies.length; i++) {
    const snapshot = buildable[i]!.snapshot;
    const copy = copies[i]!;
    const copyId = tryRead(() => String(copy.id));
    const present = copyId !== undefined ? insideIds.has(copyId) : inside.includes(copy);
    if (!present) return abandon();
    const shapes = tryRead(() => copy.shapes);
    if (Array.isArray(shapes) && shapes.length !== snapshot.shapes.length) return abandon();
    const text = snapshot.plain?.text;
    if (typeof text === "string" && tryRead(() => copy.text) !== text) return abandon();
  }

  // 7. The nest takes the first source's slot, carries the recorded name and
  //    flags, and the originals go.
  const anchor = sources[0];
  const moveBefore = tryRead(() => shell.moveBefore);
  let placed = false;
  if (typeof moveBefore === "function" && anchor !== undefined) {
    try {
      moveBefore.call(shell, anchor);
      placed = true;
    } catch (error) {
      breadcrumbs.push(
        `[nest] shell.moveBefore threw -> ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (!placed) notes.info("the new scene landed at the end of the layer list");
  dressShell();

  const nested = new Map<number, AnyProxy>();
  buildable.forEach((entry, i) => {
    nested.set(entry.index, copies[i]!);
    const name = tryRead(() => String(entry.node.name)) ?? "a layer";
    try {
      entry.node.remove();
    } catch {
      notes.push(`couldn't remove ${name} after rebuilding it — you now have both`);
    }
  });
  return { shell, moved: false, nested, skipped };
}

/**
 * What the user is told a nest did.
 *
 * The parenthesis is not decoration: a rebuilt layer is a new layer with a new
 * id, so a user who later looks for "the same layer" has to know that Creator
 * would not move it and the plugin made a copy.
 */
function nestedNote(total: number, outcome: NestOutcome, fromSelection: boolean): string {
  const built = total - outcome.skipped;
  const suffix = outcome.moved ? "" : " (rebuilt inside the new scene — Creator can't move them)";
  if (outcome.skipped > 0) {
    const all = total === 1 ? "layer" : "layers";
    return fromSelection
      ? `nested ${built} of the ${total} selected ${all}${suffix}`
      : `nested ${built} of ${total} ${all}${suffix}`;
  }
  const plural = built === 1 ? "layer" : "layers";
  return fromSelection
    ? `nested the ${built} selected ${plural}${suffix}`
    : `nested ${built} ${plural}${suffix}`;
}

/** What the user is told when nothing could be rebuilt. The originals stayed. */
function nestFailureNote(total: number, fromSelection: boolean): string {
  if (fromSelection) {
    return total === 1
      ? "couldn't rebuild your selected layer inside a new scene — left it where it is"
      : `couldn't rebuild your ${total} selected layers inside a new scene — left them where they are`;
  }
  return total === 1
    ? "couldn't rebuild the layer inside a new scene — left it where it is"
    : `couldn't rebuild the ${total} layers inside a new scene — left them where they are`;
}

/** Scene settings as a note says them — the API's camelCase is not English. */
const SCENE_SETTING_LABELS: Record<string, string> = {
  name: "name",
  size: "size",
  backgroundColor: "background",
  framerate: "framerate",
  duration: "duration",
};

/**
 * Writes ONE scene setting on `creator.activeScene`, then reads it back.
 *
 * Absolute by construction: the recorded `after` goes on as-is, with none of
 * the origin/baseline math layer transforms get. Two guards, both mirroring
 * the set-plain path in applier.ts: a clean `undefined` read means this scene
 * does not carry the member at all (never CREATE it — a phantom property
 * read-back "verifies" trivially), and a read-back that disagrees means the
 * host took the assignment and kept its own value.
 */
function applySceneSetting(
  scene: AnyProxy,
  payload: Extract<StepPayload, { op: "set-scene" }>,
  notes: NoteList,
): void {
  const key = payload.key;
  const label = SCENE_SETTING_LABELS[key] ?? key;
  let missing = false;
  try {
    missing = scene[key] === undefined;
  } catch {
    // a THROWING getter means the member exists but is unreadable — write it
    missing = false;
  }
  if (missing) {
    notes.push(`this scene has no ${label} to set — skipped`);
    return;
  }
  try {
    scene[key] = payload.after;
  } catch (error) {
    notes.push(
      `couldn't set the scene ${label} — ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  try {
    if (!jsonEqual(toJson(scene[key]), payload.after)) {
      notes.push(`Creator kept the scene ${label} as it was — the change didn't apply`);
    }
  } catch {
    // read-back unavailable: unverifiable is not a failure
  }
}

function applySceneOp(
  payload: Extract<
    StepPayload,
    {
      op:
        | "add-layer"
        | "remove-layer"
        | "break-scene"
        | "nest-layers"
        | "reorder-layers"
        | "set-scene";
    }
  >,
  notes: NoteList,
): void {
  const scene = creator.activeScene;
  if (!scene) {
    notes.push("no active scene — skipped");
    return;
  }

  if (payload.op === "set-scene") {
    applySceneSetting(scene, payload, notes);
    return;
  }

  if (payload.op === "add-layer") {
    const playback = session.playback!;
    if (payload.cloneOf) {
      const source = resolveLayer(payload.cloneOf);
      if (source && typeof source.clone === "function") {
        const created = source.clone();
        if (created) {
          playback.layerByRecordedId.set(payload.spec.nodeId, created);
          // The duplicate's own subsequent edits arrive as separate steps
          // bound to the recorded new-layer id — now resolvable via the map.
          if (payload.spec.nodeName) {
            try {
              created.name = payload.spec.nodeName;
            } catch {
              // cosmetic
            }
          }
          // Same-scene replay reproduces the copy exactly, including the
          // duplicate offset: seed the spec's root transform statics.
          for (const propName of ["position", "rotation", "scale", "skew", "skewAxis"]) {
            const snap = payload.spec.props[propName];
            if (snap && !snap.animated && snap.static !== undefined) {
              const prop = tryRead(() => created[propName]);
              if (prop) {
                try {
                  prop.staticValue = snap.static;
                } catch {
                  // best effort
                }
              }
            }
          }
          return;
        }
      }
      notes.info(`couldn't duplicate ${layerLabel(payload.cloneOf)} — rebuilding from the recording`);
    }
    // Untyped runtime factory (introspection-discovered).
    const created = createLayerFromSpec(scene, payload.spec as NodeSnapshot, notes);
    if (created) playback.layerByRecordedId.set(payload.spec.nodeId, created);
    return;
  }

  if (payload.op === "break-scene") {
    const instance = resolveLayer(payload.layer);
    const breakFn = instance ? tryRead(() => (instance as AnyProxy).break) : undefined;
    if (instance && typeof breakFn === "function") {
      breakFn.call(instance);
      return;
    }
    const playback = session.playback!;
    // Converge, don't duplicate: when the break already happened (same-scene
    // replay), its result layers exist — adopt them instead of rebuilding.
    const missing: NodeSnapshot[] = [];
    for (const spec of payload.fallback) {
      // id-only match: adoption is for same-scene replays; a same-named layer
      // in another scene is a different layer and must not be hijacked.
      const existing = resolveLayer({ id: spec.nodeId });
      if (existing) playback.layerByRecordedId.set(spec.nodeId, existing);
      else missing.push(spec as NodeSnapshot);
    }
    if (missing.length === payload.fallback.length) {
      notes.info(
        `couldn't break ${layerLabel(payload.layer)} — rebuilding its layers from the recording`,
      );
    } else if (missing.length > 0) {
      notes.info(
        `${layerLabel(payload.layer)} was already broken — rebuilding ${missing.length} ${
          missing.length === 1 ? "missing layer" : "missing layers"
        }`,
      );
    } else {
      notes.info(`${layerLabel(payload.layer)} was already broken — using its layers`);
    }
    for (const spec of missing) {
      const created = createLayerFromSpec(scene, spec, notes);
      if (created) playback.layerByRecordedId.set(spec.nodeId, created);
    }
    return;
  }

  if (payload.op === "nest-layers") {
    const playback = session.playback!;
    // The macro is a tool: with a selection, nest the SELECTED layers —
    // that's what "run this on those two layers" means. Shapes are dropped
    // for the same reason `playbackBegin` drops them from its targets: a
    // macro nests LAYERS. Without a selection, replay still means DO IT —
    // nest the recorded sources when they can be found at the top level, and
    // only adopt the existing result when they can't (same-scene replay: they
    // already live inside the nest).
    const selection = selectedNodes().filter((node) => isLayerNode(node));
    const sources =
      selection.length > 0
        ? selection
        : payload.layers
            .map((ref) => resolveLayer(ref))
            .filter((layer): layer is AnyProxy => layer !== undefined);
    // Everything this step touches stays in the scene summary past the cap.
    pinned.add(payload.spec.nodeId);
    for (const ref of payload.layers) pinned.add(ref.id);
    for (const node of sources) pinNode(node);

    const nestName = payload.spec.nodeName ?? "the nested scene";
    // The nest from the recording may still be live (same-scene replay).
    const already = resolveLayer({ id: payload.spec.nodeId });

    if (sources.length > 0) {
      const outcome = nestByRebuild(scene, sources, payload.spec as NodeSnapshot, notes);
      if (outcome) {
        playback.layerByRecordedId.set(payload.spec.nodeId, outcome.shell);
        // A copy is a NEW layer with a new id, so every later step recorded
        // against a source has to be pointed at the copy that replaced it.
        payload.layers.forEach((ref, i) => {
          const copy = outcome.nested.get(i);
          if (copy) playback.layerByRecordedId.set(ref.id, copy);
        });
        notes.info(nestedNote(sources.length, outcome, selection.length > 0));
        return;
      }
      notes.push(nestFailureNote(sources.length, selection.length > 0));
      // A live recorded nest still resolves the later steps. Silently: the
      // note above already said the nest itself did not happen.
      if (already) playback.layerByRecordedId.set(payload.spec.nodeId, already);
      return;
    }

    if (already) {
      playback.layerByRecordedId.set(payload.spec.nodeId, already);
      notes.info(`${nestName} already exists — using it`);
      return;
    }
    notes.push(`couldn't find the layers to nest — rebuilt ${nestName} from the recording instead`);
    const rebuilt = createLayerFromSpec(scene, payload.spec as NodeSnapshot, notes);
    if (rebuilt) playback.layerByRecordedId.set(payload.spec.nodeId, rebuilt);
    return;
  }

  if (payload.op === "remove-layer") {
    const layer = resolveLayer(payload.layer);
    if (!layer || typeof layer.remove !== "function") {
      notes.push(`couldn't find ${layerLabel(payload.layer)} to remove`);
      return;
    }
    layer.remove();
    return;
  }

  applyReorderLayers(scene, payload, notes);
}

/**
 * Reorders the scene's top-level layers.
 *
 * A reorder payload used to be pure POSITIONS, which meant replaying it into
 * any other scene blindly permuted whatever layers happened to sit there
 * (trace 2026-08-26T08-15-02: order [1,0] applied to a scene that shared
 * nothing with the recording, notes empty). Since rev .52 the payload also
 * carries the recorded layers' identities in their new order, and this route
 * is a GATE: every ref must resolve (id → name → priorName, the same chain
 * every other scene op uses) or nothing moves at all — a partial reorder is
 * worse than none, because the user can't tell which half is theirs.
 *
 * Layers the recording never saw keep their absolute positions: the recorded
 * layers are redistributed across the slots they already occupy, in the
 * recorded relative order, and everything else stays where it is. That is
 * the most the moveBefore/moveAfter mechanism can promise — it can only
 * express "this node goes next to that node".
 */
function applyReorderLayers(
  scene: AnyProxy,
  payload: Extract<StepPayload, { op: "reorder-layers" }>,
  notes: NoteList,
): void {
  const refs = payload.layers;
  if (!refs || refs.length === 0) {
    // Legacy payload (pre rev .52): no identities to check. Still reorders —
    // same-scene replays are the common case — but says so.
    reorderChildren(scene, "layers", payload.order, notes);
    notes.info(
      "this recording didn't capture layer identities — reordered by position without verifying the layers match; check the result",
    );
    return;
  }

  const current = sceneLayers();
  const slots: number[] = [];
  const missing: string[] = [];
  for (const ref of refs) {
    const layer = resolveLayer(ref);
    const at = layer === undefined ? -1 : current.indexOf(layer);
    if (at < 0 || slots.includes(at)) {
      missing.push(layerLabel(ref));
      continue;
    }
    slots.push(at);
  }
  if (missing.length > 0) {
    notes.push(
      `couldn't find ${missing.join(", ")} in this scene — left the layer order untouched`,
    );
    return;
  }

  // Every identity checked out. `order` indexes into the RECORDED list, so
  // read the recorded layers off the live scene in their current relative
  // order and permute that sub-list; the slots they occupy stay the slots,
  // which is how unrecorded layers keep their absolute positions (the
  // moveBefore/moveAfter mechanism can only say "next to this one", so
  // holding the slots is the strongest promise available here).
  const targetSlots = [...slots].sort((a, b) => a - b);
  const recorded = targetSlots.map((slot) => current[slot]);
  const permuted: AnyProxy[] = [];
  const used = new Set<number>();
  for (const from of payload.order) {
    if (Number.isInteger(from) && from >= 0 && from < recorded.length && !used.has(from)) {
      permuted.push(recorded[from]);
      used.add(from);
    }
  }
  recorded.forEach((layer, i) => {
    if (!used.has(i)) permuted.push(layer);
  });

  const desired = [...current];
  targetSlots.forEach((slot, i) => {
    desired[slot] = permuted[i]!;
  });
  reorderChildren(
    scene,
    "layers",
    desired.map((layer) => current.indexOf(layer)),
    notes,
  );
}

// ---------------------------------------------------------------------------
// RPC surface
// ---------------------------------------------------------------------------

/** The lowest frame any keyframe payload in the macro touches. */
export function earliestKeyframe(steps: MacroStep[]): number | undefined {
  let min: number | undefined;
  const see = (frame: number) => {
    if (typeof frame === "number" && Number.isFinite(frame) && (min === undefined || frame < min)) {
      min = frame;
    }
  };
  for (const step of steps) {
    const payload = payloadOf(step);
    if (!payload || payload.op !== "keyframes") continue;
    for (const snap of payload.added) see(snap.frame);
    for (const snap of payload.removed) see(snap.frame);
    for (const change of payload.changed) {
      see(change.before.frame);
      see(change.after.frame);
    }
  }
  return min;
}

/**
 * Is this selected node a LAYER?
 *
 * `creator.utils.isLayer` is typed on 1.0.1 but has never been live-verified
 * here, so it is feature-detected and its answer only used when it comes back
 * a boolean. The fallback is `startFrame`: a timeline in point is LayerMixin's
 * and no shape carries one.
 */
function isLayerNode(node: AnyProxy): boolean {
  const utils = tryRead(() => (creator as AnyProxy).utils);
  if (utils && typeof utils.isLayer === "function") {
    const verdict = tryRead(() => utils.isLayer(node));
    if (typeof verdict === "boolean") return verdict;
  }
  return typeof tryRead(() => node.startFrame) === "number";
}

export function playbackBegin(params: {
  steps: MacroStep[];
  sourceNodeId?: string;
  atPlayhead?: boolean;
  staggerFrames?: number;
  /** 0-based Repeat pass; absent = 0. Only pass 0 delays layers. */
  iteration?: number;
  debug?: boolean;
}): { total: number; targetCount: number; frameOffset?: number } {
  const rawSelection = selectedNodes();
  // A macro's steps are recorded against LAYERS and address them by layer
  // paths, so a selected shape is not a target — applied to one, every step
  // resolves against the wrong node or fails. Drop them, say so once, and let
  // an emptied list fall through to the existing no-targets path.
  const selection = rawSelection.filter((node) => isLayerNode(node));
  const droppedShapes = rawSelection.length - selection.length;
  const selectionNote =
    droppedShapes > 0
      ? `${droppedShapes} selected ${
          droppedShapes === 1 ? "shape" : "shapes"
        } skipped — macros replay onto layers`
      : undefined;

  const analysis = chooseMode(params.steps, selection.length);
  const mode = analysis.mode;

  // Apply at playhead: slide the recorded motion so its first keyframe
  // lands where the user parked the playhead. A macro without keyframes has
  // no keyframe to slide — it moves its layers instead (delayBase below).
  // A host without a readable timeline gets neither.
  const keyframed = hasKeyframes(params.steps);
  let frameOffsetBase = 0;
  let delayBase: number | undefined;
  if (params.atPlayhead) {
    const currentFrame = tryRead(() => creator.timeline.currentFrame);
    if (typeof currentFrame === "number" && Number.isFinite(currentFrame)) {
      const earliest = earliestKeyframe(params.steps);
      if (keyframed && earliest !== undefined) {
        frameOffsetBase = currentFrame - earliest;
      } else if (!keyframed) {
        delayBase = currentFrame;
      }
    }
  }
  const staggerFrames =
    typeof params.staggerFrames === "number" && Number.isFinite(params.staggerFrames)
      ? params.staggerFrames
      : 0;
  // Repeat ×N is N begin/steps/end passes. The delay happens once, on the
  // first, so repeats do not push the layers further out every time.
  const firstPass = !(
    typeof params.iteration === "number" && Number.isFinite(params.iteration) && params.iteration > 0
  );
  const timing = { frameOffsetBase, staggerFrames, firstPass };
  const frameOffsetResult = frameOffsetBase !== 0 ? { frameOffset: frameOffsetBase } : {};

  if (mode === "scene") {
    session.playback = {
      mode,
      targets: [],
      targetNames: [],
      layerByRecordedId: new Map(),
      steps: params.steps,
      origins: {},
      baselines: [],
      ...timing,
      delay: null,
      // A scene rebuild binds each step to its own recorded layer, so there is
      // no target order to cascade. Say so rather than doing nothing.
      ...(staggerFrames > 0
        ? {
            staggerNote: "stagger needs layers selected — replayed without it",
          }
        : {}),
      ...(selectionNote !== undefined ? { selectionNote } : {}),
      debug: params.debug === true,
    };
    session.recording = null;
    return { total: params.steps.length, targetCount: 1, ...frameOffsetResult };
  }

  let targets = selection;
  if (targets.length === 0) {
    // Legacy fallback: the originally recorded layer, if it still exists.
    const source = params.sourceNodeId ? findNodeById(params.sourceNodeId) : undefined;
    if (!source) throw new Error(RPC_ERRORS.noSelection);
    targets = [source];
  }

  const tracked = relativePaths(params.steps);
  const origins: Record<string, Json> = {};
  for (const { path, origin } of tracked) {
    origins[pathKey(path)] = origin;
  }
  const baselines = targets.map((target) => {
    const perTarget: Record<string, Json> = {};
    for (const { path } of tracked) {
      const value = readBaseline(target, path);
      if (value !== undefined) perTarget[pathKey(path)] = value;
    }
    return perTarget;
  });
  const targetNames = targets.map((target, index) => {
    try {
      return typeof target.name === "string" && target.name ? target.name : `layer ${index + 1}`;
    } catch {
      return `layer ${index + 1}`;
    }
  });

  // A keyframe-free macro has no motion to cascade, so stagger delays the
  // layer instead: in point and the layer's own animation together. Only on
  // the first Repeat pass, and only when there is something to move.
  const delay =
    !keyframed && firstPass && (staggerFrames > 0 || delayBase !== undefined)
      ? {
          ...(delayBase !== undefined ? { base: delayBase } : {}),
          perTarget: staggerFrames,
        }
      : null;
  const staggerNote =
    staggerFrames > 0 && targets.length < 2
      ? "stagger needs 2 or more selected layers — replayed without it"
      : undefined;

  session.playback = {
    mode,
    targets: [...targets],
    targetNames,
    layerByRecordedId: new Map(),
    ...(analysis.sourceRoleId !== undefined ? { sourceRoleId: analysis.sourceRoleId } : {}),
    targetMaps: targets.map(() => new Map<string, AnyProxy>()),
    steps: params.steps,
    origins,
    baselines,
    ...timing,
    delay,
    ...(staggerNote !== undefined ? { staggerNote } : {}),
    ...(selectionNote !== undefined ? { selectionNote } : {}),
    debug: params.debug === true,
  };
  session.recording = null;

  return { total: params.steps.length, targetCount: targets.length, ...frameOffsetResult };
}

export function playbackStep(params: { index: number }): {
  index: number;
  failures: { target: string; message: string }[];
  notes?: { target: string; message: string; kind: NoteKind }[];
  debug?: PlaybackStepDebug;
} {
  const playback = session.playback;
  if (!playback) throw new Error("no active playback");
  const step = playback.steps[params.index];
  if (!step) throw new Error(`no step at index ${params.index}`);

  const payload = payloadOf(step);
  const path = pathOf(payload);

  const failures: { target: string; message: string }[] = [];
  const notes: { target: string; message: string; kind: NoteKind }[] = [];
  breadcrumbs.length = 0;
  pinned.clear();
  let before: TargetProbe[] = [];
  let after: TargetProbe[] = [];

  // Once per run, before step 0 applies: `playbackBegin` decided what stagger
  // means for this macro, and this is where it acts. It sits OUTSIDE the
  // per-target try below, so a failing step 0 never hides these notes — the
  // notes channel is how the delay reaches the toast and the trace.
  if (params.index === 0 && playback.firstPass && !playback.onceDone) {
    playback.onceDone = true;
    const label = playback.targetNames[0] ?? "scene";
    if (playback.selectionNote) {
      notes.push({ target: label, message: playback.selectionNote, kind: "skip" });
    }
    if (playback.staggerNote) {
      notes.push({ target: label, message: playback.staggerNote, kind: "skip" });
    }
    if (playback.delay) {
      const { base, perTarget } = playback.delay;
      playback.targets.forEach((target, i) => {
        const delayNotes = new NoteList();
        // The SELECTED layer moves, so a duplicate that step 0 makes from it
        // inherits the delay.
        delayLayer(
          target,
          { ...(base !== undefined ? { base } : {}), delta: i * perTarget },
          delayNotes,
        );
        const name = playback.targetNames[i] ?? `layer ${i + 1}`;
        delayNotes.forEach((message, kind) => notes.push({ target: name, message, kind }));
      });
    }
  }

  // A scene op is scene-level in EITHER mode: with a selection, a set-scene
  // step still applies once to the scene, never once per selected layer.
  if (playback.mode === "scene" || payload?.op === "set-scene") {
    const ref = payload ? layerRefOf(payload) : undefined;
    const label = payload && isSceneOp(payload) ? "scene" : layerLabel(ref);
    const stepNotes = new NoteList();

    if (payload && isSceneOp(payload)) {
      // Scene ops change the LAYER LIST, not a property — so their probe is
      // the list itself (rev .52). Without it add/remove/reorder/nest/break
      // were unauditable in traces. A settings op probes its own value.
      const sceneProbe = () =>
        payload.op === "set-scene" ? sceneSettingProbe(payload.key, label) : sceneSummary(label);
      if (playback.debug) before = [sceneProbe()];
      try {
        applySceneOp(payload as Extract<StepPayload, { op: "add-layer" }>, stepNotes);
      } catch (error) {
        failures.push({
          target: label,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      if (playback.debug) after = [sceneProbe()];
    } else if (payload && ref) {
      const layer = resolveLayer(ref);
      if (!layer) {
        stepNotes.push(`couldn't find the layer "${layerLabel(ref)}" — skipped`);
      } else {
        if (playback.debug) before = [probe(layer, label, path)];
        try {
          // A scene rebuild reproduces the recorded result exactly: no origins,
          // so values pass through verbatim.
          const outcome = applyStep(layer, step.payload, {
            origins: {},
            baselines: {},
            frameOffset: playback.frameOffsetBase,
          });
          outcome.notes.forEach((message, i) =>
            stepNotes.add(message, outcome.noteKinds[i] ?? "skip"),
          );
        } catch (error) {
          failures.push({
            target: label,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        if (playback.debug) after = [probe(layer, label, path)];
      }
    } else {
      stepNotes.push("this step can't be replayed (unrecognized format) — skipped");
    }
    stepNotes.forEach((message, kind) => notes.push({ target: label, message, kind }));
  } else {
    const nameOf = (i: number) => playback.targetNames[i] ?? `layer ${i + 1}`;
    // A step bound to a recorded layer applies to: the target itself when it
    // is the source role, or the clone this replay created for that target.
    const nodeFor = (target: AnyProxy, i: number): AnyProxy => {
      const ref = payload ? layerRefOf(payload) : undefined;
      if (!ref) return target;
      if (ref.id === playback.sourceRoleId) return target;
      return playback.targetMaps?.[i]?.get(ref.id) ?? target;
    };
    if (playback.debug) {
      before = playback.targets.map((target, i) => probe(nodeFor(target, i), nameOf(i), path));
    }
    playback.targets.forEach((target, i) => {
      try {
        if (payload?.op === "add-layer" && payload.cloneOf) {
          // Retargeted duplication: clone the SELECTED layer — or, for a
          // chained duplicate (copy of a copy), the clone this replay made
          // for that recorded source.
          const cloneSource =
            payload.cloneOf.id === playback.sourceRoleId
              ? target
              : playback.targetMaps?.[i]?.get(payload.cloneOf.id) ?? target;
          if (typeof cloneSource.clone !== "function") {
            notes.push({
              target: nameOf(i),
              message: "this layer can't be duplicated — skipped",
              kind: "skip",
            });
            return;
          }
          const created = cloneSource.clone();
          if (created) {
            playback.targetMaps?.[i]?.set(payload.spec.nodeId, created);
            // Reproduce the duplicate offset relative to THIS target.
            if (payload.offset && typeof payload.offset === "object" && !Array.isArray(payload.offset)) {
              const prop = ((): AnyProxy => {
                try {
                  return created.position;
                } catch {
                  return undefined;
                }
              })();
              const base = prop ? toJson(tryRead(() => prop.staticValue) ?? null) : null;
              if (prop && base !== null && typeof base === "object" && !Array.isArray(base)) {
                const shifted: Record<string, Json> = { ...base };
                for (const [key, delta] of Object.entries(payload.offset)) {
                  const current = (base as Record<string, Json>)[key];
                  if (typeof current === "number" && typeof delta === "number") {
                    shifted[key] = current + delta;
                  }
                }
                try {
                  prop.staticValue = shifted;
                } catch {
                  // best effort
                }
              }
            }
          } else {
            notes.push({ target: nameOf(i), message: "duplicate failed — skipped", kind: "skip" });
          }
          return;
        }
        const outcome = applyStep(nodeFor(target, i), step.payload, {
          origins: playback.origins,
          baselines: playback.baselines[i] ?? {},
          // Cascade: each selected layer's motion starts later than the last.
          frameOffset: playback.frameOffsetBase + i * playback.staggerFrames,
        });
        outcome.notes.forEach((message, at) => {
          notes.push({ target: nameOf(i), message, kind: outcome.noteKinds[at] ?? "skip" });
        });
      } catch (error) {
        failures.push({
          target: nameOf(i),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });
    if (playback.debug) {
      after = playback.targets.map((target, i) => probe(nodeFor(target, i), nameOf(i), path));
    }
  }

  if (!playback.debug) {
    return notes.length > 0
      ? { index: params.index, failures, notes }
      : { index: params.index, failures };
  }

  const debug: PlaybackStepDebug = {
    op: payload?.op ?? "unknown",
    before,
    after,
  };
  if (path) debug.path = path;
  if (breadcrumbs.length > 0) debug.breadcrumbs = [...breadcrumbs];
  return { index: params.index, failures, notes, debug };
}

export function playbackEnd(): void {
  session.playback = null;
}
