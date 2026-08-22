import type { Json } from "../shared/json";
import { toJson } from "../shared/json";
import type { MacroStep } from "../shared/macro";
import type { PlaybackStepDebug, TargetProbe } from "../shared/protocol";
import { RPC_ERRORS } from "../shared/protocol";
import type { NodeSnapshot, Path } from "../shared/snapshot";
import { pathKey, propClassOf } from "../shared/snapshot";
import { nodeTypeName } from "../shared/labels";
import type { LayerRef, StepPayload } from "../shared/steps";
import {
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

/** The path a payload touches, when it has a single one. */
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
    return { ...base, unreadable: error instanceof Error ? error.message : String(error) };
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
          return { frame, value };
        })
        .filter((entry: { frame: number }) => Number.isFinite(entry.frame))
        .sort((a: { frame: number }, b: { frame: number }) => a.frame - b.frame);
    }
  } catch {
    // leave empty
  }
  return base;
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
  const factoryName = spec.nodeType.startsWith("SCENE") ? "createSceneLayer" : "createShapeLayer";
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

  reorderChildren(scene, "layers", payload.order, notes);
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
      try {
        applySceneOp(payload as Extract<StepPayload, { op: "add-layer" }>, stepNotes);
      } catch (error) {
        failures.push({
          target: label,
          message: error instanceof Error ? error.message : String(error),
        });
      }
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
