import type { Json } from "../shared/json";
import { toJson } from "../shared/json";
import type { MacroStep } from "../shared/macro";
import type { PlaybackStepDebug, TargetProbe } from "../shared/protocol";
import { RPC_ERRORS } from "../shared/protocol";
import type { NodeSnapshot, Path } from "../shared/snapshot";
import { pathKey, propClassOf } from "../shared/snapshot";
import { nodeTypeName } from "../shared/labels";
import type { LayerRef, StepPayload } from "../shared/steps";
import { resolvePaint,
  applyNodeSpec,
  applyStep,
  readBaseline,
  reorderChildren,
  resolvePath,
} from "./applier";
// (instance-content edits resolve strictly by index — user decision: layer
// order, not shape-type matching, maps recorded content onto nested content)
import { session } from "./session";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyProxy = any;

/**
 * Diagnostics for undocumented host calls, collected per step and attached
 * to the debug payload. Never notes: the user can't act on them.
 */
const breadcrumbs: string[] = [];

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
    payload.op === "reorder-layers"
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
 * a scene script: each step finds its own layer by recorded id, then by name,
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
  return referenced.size > 0 ? { mode: "scene" } : { mode: "targets" };
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
    base.value = toJson(prop.staticValue);
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
            value = toJson(kf.value);
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
 */
function sceneSummary(label: string): TargetProbe {
  const layers = sceneLayers();
  const entries: Json[] = [];
  for (const layer of layers) {
    if (entries.length >= SCENE_SUMMARY_CAP) break;
    const entry: Record<string, Json> = {};
    const id = tryRead(() => String(layer.id));
    if (id !== undefined) entry.id = id;
    const name = tryRead(() => toJson(layer.name));
    if (name !== undefined && name !== null) entry.name = name;
    const type = tryRead(() => String(layer.type));
    if (type !== undefined) entry.type = type;
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

// ---------------------------------------------------------------------------
// Scene-mode layer resolution & scene ops
// ---------------------------------------------------------------------------

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
function createLayerFromSpec(
  scene: AnyProxy,
  spec: NodeSnapshot,
  notes: string[],
): AnyProxy | undefined {
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
  applyNodeSpec(created, spec, notes);
  return created;
}

/**
 * Nests `layers` into a new scene layer, discovering the working call at
 * runtime and VERIFYING each guess (the typings promise createSceneInstance,
 * which doesn't exist; a live trace showed createSceneLayer() creates EMPTY).
 * Order of attempts:
 *   1. scene.createSceneInstance(layers) — the typed name, if it ever ships.
 *   2. scene.createSceneLayer(layers) — maybe it takes the layers.
 *   3. scene.createSceneLayer() + layer.shiftTo(created) / shiftTo({to}) —
 *      the untyped move method observed on every node.
 * A guess only counts if the created layer actually contains content (or the
 * top-level list shrank accordingly); an empty shell is removed.
 */
function nestIntoNewScene(
  scene: AnyProxy,
  layers: AnyProxy[],
  notes: string[],
): AnyProxy | undefined {
  const contentOf = (created: AnyProxy): AnyProxy[] => {
    const content = tryRead(() => created.scene?.layers);
    return Array.isArray(content) ? content : [];
  };
  const verified = (created: AnyProxy, topBefore: number): boolean =>
    contentOf(created).length > 0 || sceneLayers().length <= topBefore - layers.length + 1;

  const instanceFactory = tryRead(() => (scene as AnyProxy).createSceneInstance);
  if (typeof instanceFactory === "function") {
    const topBefore = sceneLayers().length;
    const created = tryRead(() => instanceFactory.call(scene, layers));
    if (created && verified(created, topBefore)) return created;
  }

  const layerFactory = tryRead(() => (scene as AnyProxy).createSceneLayer);
  if (typeof layerFactory !== "function") return undefined;

  const describe = (label: string, value: AnyProxy) => {
    // Debug breadcrumb: the host call semantics are undocumented; every
    // attempt reports what actually came back so traces pin the contract.
    // This is diagnostics, not a user-facing note — it goes to the trace.
    const kind =
      value === undefined
        ? "undefined"
        : typeof value?.then === "function"
          ? "promise"
          : typeof value;
    breadcrumbs.push(
      `[nest] ${label} -> ${kind}, content=${contentOf(value).length}, top=${sceneLayers().length}`,
    );
  };

  // Attempt A: createSceneLayer(layers) — maybe it takes them.
  {
    const topBefore = sceneLayers().length;
    const created = tryRead(() => layerFactory.call(scene, layers));
    describe("createSceneLayer(layers)", created);
    if (created && verified(created, topBefore)) return created;
    if (created) {
      try {
        created.remove();
      } catch {
        // leave it — attempt B may still supersede
      }
    }
  }

  // Attempt B: no-arg createSceneLayer() — observed to consume the current
  // selection on the real host; point the selection at our layers first.
  {
    try {
      (creator.selection as AnyProxy).nodes = layers;
    } catch {
      // selection may not be assignable; the outcome check below decides
    }
    const topBefore = sceneLayers().length;
    const created = tryRead(() => layerFactory.call(scene));
    describe("createSceneLayer()", created);
    if (created) {
      if (verified(created, topBefore)) return created;
      // Attempt C: move the layers in with the untyped shiftTo.
      let moved = 0;
      for (const layer of layers) {
        const shift = tryRead(() => layer.shiftTo);
        if (typeof shift !== "function") continue;
        const ok =
          tryRead(() => {
            shift.call(layer, created);
            return true;
          }) ??
          tryRead(() => {
            shift.call(layer, { to: created });
            return true;
          });
        if (ok) moved += 1;
      }
      describe(`shiftTo x${moved}`, created);
      if (contentOf(created).length > 0) return created;
      notes.push("the host created an empty scene layer and shiftTo didn't move content");
      try {
        created.remove();
      } catch {
        // leave the shell; the fallback note explains
      }
    }
  }
  return undefined;
}

function applySceneOp(
  payload: Extract<
    StepPayload,
    { op: "add-layer" | "remove-layer" | "break-scene" | "nest-layers" | "reorder-layers" }
  >,
  notes: string[],
): void {
  const scene = creator.activeScene;
  if (!scene) {
    notes.push("no active scene — skipped");
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
      notes.push(`couldn't duplicate ${layerLabel(payload.cloneOf)} — rebuilding from the recording`);
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
      notes.push(
        `couldn't break ${layerLabel(payload.layer)} — rebuilding its layers from the recording`,
      );
    } else if (missing.length > 0) {
      notes.push(
        `${layerLabel(payload.layer)} was already broken — rebuilding ${missing.length} ${
          missing.length === 1 ? "missing layer" : "missing layers"
        }`,
      );
    } else {
      notes.push(`${layerLabel(payload.layer)} was already broken — using its layers`);
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
    // that's what "run this on those two layers" means. Without one, replay
    // still means DO IT: nest the recorded sources when they can be found at
    // the top level, and only adopt the existing result when they can't
    // (same-scene replay — they already live inside the nest).
    const selection = ((): AnyProxy[] => {
      try {
        return Array.isArray(creator.selection.nodes) ? [...creator.selection.nodes] : [];
      } catch {
        return [];
      }
    })();
    const resolved =
      selection.length > 0
        ? selection
        : payload.layers
            .map((ref) => resolveLayer(ref))
            .filter((layer): layer is AnyProxy => layer !== undefined);
    if (selection.length > 0) {
      notes.push(
        `nesting the ${selection.length} selected ${
          selection.length === 1 ? "layer" : "layers"
        }`,
      );
    }
    if (resolved.length === 0) {
      const already = resolveLayer({ id: payload.spec.nodeId });
      if (already) {
        playback.layerByRecordedId.set(payload.spec.nodeId, already);
        notes.push(
          `${payload.spec.nodeName ?? "the nested scene"} already exists (its layers are inside) — using it`,
        );
        return;
      }
    }
    if (resolved.length > 0) {
      const created = nestIntoNewScene(scene, resolved, notes);
      if (created) {
        playback.layerByRecordedId.set(payload.spec.nodeId, created);
        if (payload.spec.nodeName) {
          try {
            created.name = payload.spec.nodeName;
          } catch {
            // cosmetic
          }
        }
        const nested = resolved.length === 1 ? "layer" : "layers";
        notes.push(
          selection.length > 0
            ? `nested the ${resolved.length} selected ${nested}`
            : `nested ${resolved.length} ${nested}`,
        );
        return;
      }
    }
    notes.push("couldn't nest the layers — rebuilding the scene layer from the recording");
    createLayerFromSpec(scene, payload.spec as NodeSnapshot, notes);
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
  notes: string[],
): void {
  const refs = payload.layers;
  if (!refs || refs.length === 0) {
    // Legacy payload (pre rev .52): no identities to check. Still reorders —
    // same-scene replays are the common case — but says so.
    reorderChildren(scene, "layers", payload.order, notes);
    notes.push(
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

export function playbackBegin(params: {
  steps: MacroStep[];
  sourceNodeId?: string;
  atPlayhead?: boolean;
  staggerFrames?: number;
  debug?: boolean;
}): { total: number; targetCount: number; frameOffset?: number } {
  const selection = ((): AnyProxy[] => {
    try {
      return Array.isArray(creator.selection.nodes) ? [...creator.selection.nodes] : [];
    } catch {
      return [];
    }
  })();

  const analysis = chooseMode(params.steps, selection.length);
  const mode = analysis.mode;

  // Apply at playhead: slide the recorded motion so its first keyframe
  // lands where the user parked the playhead. A macro without keyframes has
  // nothing to slide; a host without a readable timeline gets no shift.
  let frameOffsetBase = 0;
  if (params.atPlayhead) {
    const currentFrame = tryRead(() => creator.timeline.currentFrame);
    const earliest = earliestKeyframe(params.steps);
    if (typeof currentFrame === "number" && Number.isFinite(currentFrame) && earliest !== undefined) {
      frameOffsetBase = currentFrame - earliest;
    }
  }
  const staggerFrames =
    typeof params.staggerFrames === "number" && Number.isFinite(params.staggerFrames)
      ? params.staggerFrames
      : 0;
  const timing = { frameOffsetBase, staggerFrames };
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
    debug: params.debug === true,
  };
  session.recording = null;

  return { total: params.steps.length, targetCount: targets.length, ...frameOffsetResult };
}

export function playbackStep(params: { index: number }): {
  index: number;
  failures: { target: string; message: string }[];
  notes?: { target: string; message: string }[];
  debug?: PlaybackStepDebug;
} {
  const playback = session.playback;
  if (!playback) throw new Error("no active playback");
  const step = playback.steps[params.index];
  if (!step) throw new Error(`no step at index ${params.index}`);

  const payload = payloadOf(step);
  const path = pathOf(payload);

  const failures: { target: string; message: string }[] = [];
  const notes: { target: string; message: string }[] = [];
  breadcrumbs.length = 0;
  let before: TargetProbe[] = [];
  let after: TargetProbe[] = [];

  if (playback.mode === "scene") {
    const ref = payload ? layerRefOf(payload) : undefined;
    const label = payload && isSceneOp(payload) ? "scene" : layerLabel(ref);
    const stepNotes: string[] = [];

    if (payload && isSceneOp(payload)) {
      // Scene ops change the LAYER LIST, not a property — so their probe is
      // the list itself (rev .52). Without it add/remove/reorder/nest/break
      // were unauditable in traces.
      if (playback.debug) before = [sceneSummary(label)];
      try {
        applySceneOp(payload as Extract<StepPayload, { op: "add-layer" }>, stepNotes);
      } catch (error) {
        failures.push({
          target: label,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      if (playback.debug) after = [sceneSummary(label)];
    } else if (payload && ref) {
      const layer = resolveLayer(ref);
      if (!layer) {
        stepNotes.push(`couldn't find the layer "${layerLabel(ref)}" — skipped`);
      } else {
        if (playback.debug) before = [probe(layer, label, path)];
        try {
          // Scene scripts reproduce the recorded result exactly: no origins,
          // so values pass through verbatim.
          const outcome = applyStep(layer, step.payload, {
            origins: {},
            baselines: {},
            frameOffset: playback.frameOffsetBase,
          });
          stepNotes.push(...outcome.notes);
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
    for (const message of stepNotes) notes.push({ target: label, message });
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
            notes.push({ target: nameOf(i), message: "this layer can't be duplicated — skipped" });
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
            notes.push({ target: nameOf(i), message: "duplicate failed — skipped" });
          }
          return;
        }
        const outcome = applyStep(nodeFor(target, i), step.payload, {
          origins: playback.origins,
          baselines: playback.baselines[i] ?? {},
          // Cascade: each selected layer's motion starts later than the last.
          frameOffset: playback.frameOffsetBase + i * playback.staggerFrames,
        });
        for (const message of outcome.notes) {
          notes.push({ target: nameOf(i), message });
        }
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
