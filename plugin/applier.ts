/**
 * Applies recorded step payloads onto a live target node proxy.
 * Second of the two proxy-touching files (see serialize.ts).
 *
 * Philosophy: a macro says "end up like this", not "apply these deltas".
 * Steps that don't fit the target become notes, not run-stopping failures;
 * only genuine errors (host refusals, exceptions) throw.
 */
import type { Json } from "../shared/json";
import { jsonEqual, toJson } from "../shared/json";
import { nodeTypeName } from "../shared/labels";
import type { KfSnap, NodeSnapshot, PaintSnapshot, Path } from "../shared/snapshot";
import { pathKey, propClassOf } from "../shared/snapshot";
import { computeTarget } from "../shared/relative";
import type { StepPayload } from "../shared/steps";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyProxy = any;

export interface ApplyContext {
  /** Recorded node's value when each layer-transform path was first touched. */
  origins: Record<string, Json>;
  /** This target's values at playback.begin, keyed by pathKey. */
  baselines: Record<string, Json>;
  /** Added to every recorded keyframe frame before matching or placing it
   *  (apply-at-playhead / stagger). Absent = 0. */
  frameOffset?: number;
}

/**
 * What one step did to one target. Failures still throw; `notes` carries the
 * deliberate non-failures — things the target didn't need, couldn't take, or
 * that were adapted to fit — so they are reported rather than silent.
 */
export interface StepOutcome {
  notes: string[];
}

const FRAME_EPSILON = 1e-6;

function tryRead<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/** "fills" -> "fill": how a list entry is named in a user-facing note. */
const ENTRY_LABELS: Record<string, string> = {
  fills: "fill",
  strokes: "stroke",
  masks: "mask",
  shapes: "shape",
  trimPaths: "trim path",
  layers: "layer",
};

function entryLabel(listKey: string): string {
  return ENTRY_LABELS[listKey] ?? listKey.replace(/s$/, "");
}

function describeSegment(path: Path, index: number): string {
  return path
    .slice(0, index + 1)
    .map((seg, i) => (typeof seg === "number" ? `[${seg}]` : i === 0 ? String(seg) : `.${seg}`))
    .join("");
}

/**
 * Resolves a recorded path on a target, tolerantly at `shapes` boundaries:
 * the recorded index is tried first; a missing or type-mismatched child falls
 * back to the first sibling of the recorded shape's type (per shapeHint), or
 * to the only child when there is exactly one. Adaptations are noted.
 */
export function resolvePath(
  node: AnyProxy,
  path: Path,
  shapeHint?: string,
  notes?: string[],
): AnyProxy {
  let current: AnyProxy = node;
  for (let i = 0; i < path.length; i++) {
    const segment = path[i]!;

    if (segment === "shapes" && typeof path[i + 1] === "number") {
      const index = path[i + 1] as number;
      let list = tryRead(() => current.shapes);
      let instanceContent = false;
      if (!Array.isArray(list)) {
        // scene-instance layers: the child channel is the source scene
        list = tryRead(() => current.scene?.layers);
        instanceContent = true;
      }
      if (!Array.isArray(list) || list.length === 0) {
        throw new Error(`${describeSegment(path, i)} not found on this layer`);
      }
      let child: AnyProxy = list[index];
      const childType = child === undefined ? undefined : tryRead(() => String(child.type));
      // Inside instance content, LAYER ORDER is the mapping (user decision):
      // the recorded index maps to the target's same position, never
      // redirected by shape type.
      if (child === undefined || (!instanceContent && shapeHint !== undefined && childType !== shapeHint)) {
        const byType =
          shapeHint === undefined
            ? undefined
            : list.find((candidate: AnyProxy) => tryRead(() => String(candidate.type)) === shapeHint);
        if (byType !== undefined && shapeHint !== undefined) {
          if (byType !== child) {
            notes?.push(`matched this layer's ${nodeTypeName(shapeHint)} shape`);
          }
          child = byType;
        } else if (child === undefined && list.length === 1) {
          child = list[0];
          notes?.push("applied to this layer's only shape");
        } else if (child === undefined) {
          throw new Error(`${describeSegment(path, i + 1)} not found on this layer`);
        }
        // type-mismatch with no better candidate: keep the index child (best effort)
      }
      current = child;
      i += 1;
      continue;
    }

    let next: AnyProxy;
    try {
      next = current[segment as keyof typeof current];
    } catch {
      next = undefined;
    }
    if (next === undefined || next === null) {
      const where = describeSegment(path, i);
      if (typeof segment === "number") {
        throw new Error(
          `${where} not found — this layer has no ${entryLabel(
            String(path[i - 1] ?? "entry"),
          )} ${segment + 1}`,
        );
      }
      throw new Error(`${where} not found on this layer`);
    }
    current = next;
  }
  return current;
}

function isStepPayload(value: unknown): value is StepPayload {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { op?: unknown }).op === "string"
  );
}

/**
 * The staticValue contract hinges on keyframes EXISTING, not on isAnimated:
 * Creator can report isAnimated=true with zero keyframes (seen in traces
 * after every keyframe was removed), and staticValue writes work there.
 */
function hasKeyframes(prop: AnyProxy): boolean {
  try {
    const list = prop.keyframes;
    return Array.isArray(list) && list.length > 0;
  } catch {
    return false;
  }
}

/**
 * Finds a target keyframe by FRAME only. Recorded keyframe ids are useless
 * here by construction: Keyframe.id is readonly, engine-assigned per node and
 * recycled — a recorded id can never identify another node's keyframe.
 *
 * A property with no keyframes has nothing to find. Guarding here matters:
 * a real trace showed the host's getKeyframeAt returning a truthy occupant
 * at frame 0 on a static property, which made playback "converge" a phantom
 * instead of creating the keyframe.
 */
function keyframeAt(prop: AnyProxy, frame: number): AnyProxy | undefined {
  if (!hasKeyframes(prop)) return undefined;
  try {
    if (typeof prop.getKeyframeAt === "function") {
      return prop.getKeyframeAt(frame) ?? undefined;
    }
  } catch {
    // fall through to the manual scan
  }
  const list: AnyProxy[] = Array.isArray(prop.keyframes) ? prop.keyframes : [];
  return list.find((kf) => {
    try {
      return Math.abs(Number(kf.frame) - frame) < FRAME_EPSILON;
    } catch {
      return false;
    }
  });
}

function keyframeEntry(snap: KfSnap): Record<string, unknown> {
  const entry: Record<string, unknown> = { frame: snap.frame, value: snap.value };
  if (snap.easing !== undefined) entry.easing = snap.easing;
  if (snap.inTangent !== undefined) entry.inTangent = snap.inTangent;
  if (snap.outTangent !== undefined) entry.outTangent = snap.outTangent;
  return entry;
}

/**
 * Writes the recorded motion-path handles onto a live keyframe and verifies
 * the host kept them. `inTangent`/`outTangent` are absent from the typed
 * Keyframe surface (documented only by example), so a host that ignores the
 * write is reported as a note rather than assumed to have worked.
 */
function writeTangents(kf: AnyProxy, snap: KfSnap, notes: string[]): void {
  for (const key of ["inTangent", "outTangent"] as const) {
    const wanted = snap[key];
    if (wanted === undefined) continue;
    let kept = false;
    try {
      kf[key] = wanted;
      kept = jsonEqual(toJson(kf[key]), wanted);
    } catch {
      kept = false;
    }
    if (!kept) notes.push(`motion-path handle (${key}) @ ${snap.frame} not supported by Creator`);
  }
}

/**
 * Adds a keyframe and verifies the host actually took it. Observed in real
 * Creator: addKeyframes at frame 0 on a not-yet-animated property is silently
 * ignored (and may write staticValue instead). Once animated, frame 0 inserts
 * fine — so seed animation with a sentinel keyframe, retry, drop the sentinel.
 */
function addVerified(prop: AnyProxy, snap: KfSnap, notes: string[] = []): void {
  prop.addKeyframes([keyframeEntry(snap)]);
  const direct = keyframeAt(prop, snap.frame);
  if (direct) {
    writeTangents(direct, snap, notes);
    return;
  }
  const sentinelFrame = snap.frame + 1;
  prop.addKeyframes([{ frame: sentinelFrame, value: snap.value }]);
  prop.addKeyframes([keyframeEntry(snap)]);
  const sentinel = keyframeAt(prop, sentinelFrame);
  if (sentinel) sentinel.remove();
  const added = keyframeAt(prop, snap.frame);
  if (!added) {
    throw new Error(`Creator refused a keyframe at ${snap.frame}`);
  }
  writeTangents(added, snap, notes);
}

/** Writes a recorded keyframe's values onto an existing target keyframe. */
function writeKeyframe(prop: AnyProxy, kf: AnyProxy, snap: KfSnap, notes: string[] = []): void {
  try {
    if (Math.abs(Number(kf.frame) - snap.frame) >= FRAME_EPSILON) {
      kf.frame = snap.frame;
    }
    kf.value = snap.value;
    if (snap.easing !== undefined) kf.easing = snap.easing;
    writeTangents(kf, snap, notes);
  } catch {
    // Fallback: recreate it. The removal must succeed first — otherwise we
    // would leave the original in place AND add a second one at the same
    // frame. A throw here propagates and is reported, which beats a silent
    // duplicate.
    kf.remove();
    addVerified(prop, snap);
  }
}

/** Updates the keyframe at snap.frame if one is there, otherwise creates it. */
function upsertKeyframe(prop: AnyProxy, snap: KfSnap, notes: string[] = []): void {
  const occupant = keyframeAt(prop, snap.frame);
  if (occupant) {
    writeKeyframe(prop, occupant, snap, notes);
    return;
  }
  addVerified(prop, snap, notes);
}

/**
 * Converges the target's timeline toward the recorded end state. Removing a
 * keyframe the target never had is a no-op, not a failure. Each entry is
 * applied independently so one bad keyframe can't drop the rest.
 */
function applyKeyframes(
  prop: AnyProxy,
  payload: Extract<StepPayload, { op: "keyframes" }>,
  notes: string[],
  context: ApplyContext,
): void {
  const failures: string[] = [];
  // Layer-transform keyframe values shift from the target's baseline like the
  // property's static form; origins are anchored to the recorded motion's
  // lowest-frame value per path. Untracked paths pass through verbatim.
  const key = pathKey(payload.path);
  const origin = context.origins[key];
  const baseline = context.baselines[key];
  const propClass = propClassOf(payload.path);
  const adjust = (snap: KfSnap): KfSnap =>
    origin === undefined
      ? snap
      : { ...snap, value: computeTarget(baseline, origin, snap.value, propClass) };

  // Apply-at-playhead: the whole recorded motion slides along the timeline,
  // so lookup AND placement use shifted frames. Shift the payload once, up
  // front, and the rest of this function never knows.
  const frameOffset = context.frameOffset ?? 0;
  if (frameOffset !== 0) {
    const shift = (snap: KfSnap): KfSnap => ({ ...snap, frame: snap.frame + frameOffset });
    payload = {
      ...payload,
      added: payload.added.map(shift),
      removed: payload.removed.map(shift),
      changed: payload.changed.map((c) => ({ before: shift(c.before), after: shift(c.after) })),
    };
  }

  // A macro recorded before the differ keyed keyframes by frame can carry the
  // SAME frame in both `added` and `removed` (Creator reassigns kf.id on
  // edit). Applying both would add the keyframe and then destroy it — the
  // addition describes the end state, so it wins.
  const addedFrames = payload.added.map((snap) => snap.frame);
  const alsoAdded = (frame: number) =>
    addedFrames.some((candidate) => Math.abs(candidate - frame) < FRAME_EPSILON);
  const fail = (frame: number, error: unknown) => {
    failures.push(
      `keyframe @ ${frame}: ${error instanceof Error ? error.message : String(error)}`,
    );
  };

  for (const snap of payload.added) {
    try {
      upsertKeyframe(prop, adjust(snap), notes);
    } catch (error) {
      fail(snap.frame, error);
    }
  }

  for (const snap of payload.removed) {
    try {
      if (alsoAdded(snap.frame)) continue;
      const existing = keyframeAt(prop, snap.frame);
      if (!existing) {
        notes.push(`couldn't find a keyframe at ${snap.frame} to remove`);
        continue;
      }
      existing.remove();
    } catch (error) {
      fail(snap.frame, error);
    }
  }

  for (const change of payload.changed) {
    try {
      const moving = Math.abs(change.after.frame - change.before.frame) >= FRAME_EPSILON;
      const existing = keyframeAt(prop, change.before.frame);

      if (!existing) {
        upsertKeyframe(prop, adjust(change.after), notes);
        notes.push(
          moving
            ? `no keyframe at ${change.before.frame} — created it at ${change.after.frame}`
            : `no keyframe at ${change.before.frame} — created it`,
        );
        continue;
      }

      // Dragging onto a frame the target already uses would leave two
      // keyframes sharing one frame; the occupant gives way.
      if (moving) {
        const occupant = keyframeAt(prop, change.after.frame);
        if (occupant) {
          occupant.remove();
          notes.push(`replaced the keyframe at ${change.after.frame}`);
        }
      }

      writeKeyframe(prop, existing, adjust(change.after), notes);
    } catch (error) {
      fail(change.before.frame, error);
    }
  }

  if (failures.length > 0) throw new Error(failures.join("; "));
}

// ---------------------------------------------------------------------------
// Paint construction & structural helpers
// ---------------------------------------------------------------------------

function staticOf(snap: { static?: Json } | undefined, fallback: Json = null): Json {
  return snap?.static ?? fallback;
}

/** PaintSnapshot -> the plain spec Creator's addFill/createFill accepts. */
function paintSpec(spec: PaintSnapshot): Record<string, Json> {
  if (spec.kind === "solid") {
    const out: Record<string, Json> = { type: "SOLID", color: staticOf(spec.color) };
    if (spec.opacity) out.opacity = staticOf(spec.opacity, 100);
    return out;
  }
  if (spec.kind === "gradient") {
    const out: Record<string, Json> = {
      type: spec.gradientType ?? "GRADIENT_LINEAR",
      stops: staticOf(spec.stops, []),
    };
    if (spec.start) out.start = staticOf(spec.start);
    if (spec.end) out.end = staticOf(spec.end);
    if (spec.highlightAngle) out.highlightAngle = staticOf(spec.highlightAngle);
    if (spec.highlightLength) out.highlightLength = staticOf(spec.highlightLength);
    if (spec.opacity) out.opacity = staticOf(spec.opacity, 100);
    return out;
  }
  throw new Error("this fill can't be re-created (unknown kind)");
}

/**
 * Removes an entry from fills/strokes/masks. The typings promise
 * container.removeFill(index) etc., but the real host has none of those —
 * removal lives on the object itself (paint.remove(), per introspection).
 * Try both; report whether anything was actually removed.
 */
function removeListEntry(container: AnyProxy, marker: string, index: number): boolean {
  const methodName =
    marker === "fills" ? "removeFill" : marker === "strokes" ? "removeStroke" : "removeMask";
  const byMethod = tryRead(() => container[methodName]);
  if (typeof byMethod === "function") {
    try {
      byMethod.call(container, index);
      return true;
    } catch {
      // fall through to the object's own remove()
    }
  }
  const list = tryRead(() => container[marker]);
  const entry = Array.isArray(list) ? list[index] : undefined;
  if (entry && typeof entry.remove === "function") {
    try {
      const before = Array.isArray(list) ? list.length : undefined;
      entry.remove();
      const after = tryRead(() => container[marker]);
      return !Array.isArray(after) || before === undefined || after.length < before;
    } catch {
      return false;
    }
  }
  return false;
}

function addPaintTo(container: AnyProxy, spec: PaintSnapshot): void {
  const plain = paintSpec(spec);
  if (typeof container.addFill === "function") {
    container.addFill(plain);
    return;
  }
  if (typeof container.createFill === "function") {
    container.createFill(plain);
    return;
  }
  throw new Error("this layer can't take fills");
}

function canCreatePaint(container: AnyProxy): boolean {
  return (
    typeof tryRead(() => container?.addFill) === "function" ||
    typeof tryRead(() => container?.createFill) === "function"
  );
}

/** One spec component written onto an existing paint prop's staticValue. */
function writeComponent(paint: AnyProxy, key: string, snap: { static?: Json } | undefined): boolean {
  if (!snap || snap.static === undefined) return false;
  const prop = tryRead(() => paint[key]);
  if (prop === undefined || prop === null || typeof prop !== "object") return false;
  try {
    (prop as AnyProxy).staticValue = snap.static;
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes a recorded PaintSnapshot onto an EXISTING paint in place — for
 * hosts whose containers expose readable fills but no addFill/createFill
 * (live: "Ellipse 1 can't take fills", trace 2026-08-26T03-56-02). Same
 * kind writes every component; cross-kind adapts (first stop's color /
 * tint every stop) since the kind can't change without re-creation.
 */
function applySpecInPlace(paint: AnyProxy, spec: PaintSnapshot, label: string, notes: string[]): void {
  if (spec.kind === "solid") {
    if (writeComponent(paint, "color", spec.color)) {
      writeComponent(paint, "opacity", spec.opacity);
      notes.push(`applied the recorded fill onto this layer's existing ${label} (it can't swap fills)`);
      return;
    }
    // solid spec onto a gradient paint: tint every stop
    const stopsProp = tryRead(() => paint.stops);
    const current = stopsProp ? toJson(tryRead(() => (stopsProp as AnyProxy).staticValue)) : null;
    if (Array.isArray(current) && current.length > 0 && spec.color.static !== undefined) {
      try {
        (stopsProp as AnyProxy).staticValue = current.map((stop) =>
          stop !== null && typeof stop === "object" && !Array.isArray(stop)
            ? { ...stop, color: spec.color.static as Json }
            : stop,
        );
        notes.push(`this layer's ${label} is a gradient — applied the recorded color to every stop`);
        return;
      } catch {
        // fall through
      }
    }
    notes.push(`couldn't apply the recorded fill to this layer's ${label}`);
    return;
  }
  if (spec.kind === "gradient") {
    if (writeComponent(paint, "stops", spec.stops)) {
      writeComponent(paint, "start", spec.start);
      writeComponent(paint, "end", spec.end);
      writeComponent(paint, "highlightAngle", spec.highlightAngle);
      writeComponent(paint, "highlightLength", spec.highlightLength);
      writeComponent(paint, "opacity", spec.opacity);
      notes.push(`applied the recorded fill onto this layer's existing ${label} (it can't swap fills)`);
      return;
    }
    // gradient spec onto a solid paint: first stop's color
    const color = firstStopColor(staticOf(spec.stops, []));
    if (color !== undefined && writeComponent(paint, "color", { static: color })) {
      notes.push(`this layer's ${label} is solid — applied the gradient's first color`);
      return;
    }
    notes.push(`couldn't apply the recorded fill to this layer's ${label}`);
    return;
  }
  notes.push(`couldn't apply the recorded fill to this layer's ${label}`);
}

/** Applies keyframes recorded on a spec's animatable onto a fresh property. */
function seedAnimatable(prop: AnyProxy, snap: { static?: Json; keyframes?: KfSnap[] } | undefined) {
  if (!prop || !snap) return;
  if (snap.static !== undefined) {
    try {
      prop.staticValue = snap.static;
    } catch {
      // best effort
    }
  }
  if (snap.keyframes && snap.keyframes.length > 0) {
    for (const kf of snap.keyframes) {
      try {
        upsertKeyframe(prop, kf);
      } catch {
        // best effort — creation continues
      }
    }
  }
}

const SHAPE_FACTORIES: Record<string, string> = {
  RECTANGLE: "createRectangle",
  ELLIPSE: "createEllipse",
  POLYGON: "createPolygon",
  STAR: "createStar",
  PATH: "createPath",
};

/** Seeds a live node with a recorded spec: name, props, paints, masks,
 *  trims, and child shapes. Used for created shapes AND created layers. */
export function applyNodeSpec(node: AnyProxy, spec: NodeSnapshot, notes: string[]): void {
  if (spec.nodeName) {
    try {
      node.name = spec.nodeName;
    } catch {
      // cosmetic
    }
  }
  for (const [name, snap] of Object.entries(spec.props)) {
    seedAnimatable(tryRead(() => node[name]), snap);
  }
  for (const [flag, value] of Object.entries(spec.plain ?? {})) {
    try {
      node[flag] = value;
    } catch {
      // flag not writable here
    }
  }
  for (const fill of spec.fills) {
    try {
      addPaintTo(node, fill);
    } catch {
      notes.push("the new layer couldn't take a recorded fill");
    }
  }
  for (const stroke of spec.strokes) {
    try {
      if (typeof node.addStroke === "function") {
        node.addStroke({ width: staticOf(stroke.width, 1), fill: paintSpec(stroke.fill) });
      } else if (typeof node.createStroke === "function") {
        node.createStroke({ width: staticOf(stroke.width, 1), fill: paintSpec(stroke.fill) });
      }
    } catch {
      notes.push("the new layer couldn't take a recorded stroke");
    }
  }
  for (const mask of spec.masks ?? []) {
    try {
      const maskSpec: Record<string, Json> = {
        pathData: staticOf(mask.pathData),
        opacity: staticOf(mask.opacity, 100),
      };
      if (mask.mode) maskSpec.mode = mask.mode;
      if (typeof node.addMask === "function") node.addMask(maskSpec);
      else if (typeof node.createMask === "function") node.createMask(maskSpec);
    } catch {
      notes.push("the new layer couldn't take a recorded mask");
    }
  }
  for (const trim of spec.trims ?? []) {
    try {
      if (typeof node.createTrimPath === "function") {
        const created = node.createTrimPath();
        for (const propName of ["start", "end", "offset"] as const) {
          seedAnimatable(tryRead(() => created[propName]), trim[propName]);
        }
      }
    } catch {
      notes.push("the new layer couldn't take a recorded trim path");
    }
  }
  for (const child of spec.shapes) {
    createShapeFrom(node, child, notes);
  }
}

/** Recreates a recorded shape subtree end-state under `parent`. */
export function createShapeFrom(parent: AnyProxy, spec: NodeSnapshot, notes: string[]): void {
  if (spec.nodeType === "GROUP") {
    // A group can't be created empty — create its children on the parent
    // first, then group them (ShapeContainerMixin.createGroup).
    if (typeof parent.createGroup !== "function") {
      notes.push("this layer can't take groups — skipped");
      return;
    }
    const before: AnyProxy[] = Array.isArray(tryRead(() => parent.shapes))
      ? [...parent.shapes]
      : [];
    for (const child of spec.shapes) {
      createShapeFrom(parent, child, notes);
    }
    const after: AnyProxy[] = Array.isArray(tryRead(() => parent.shapes))
      ? [...parent.shapes]
      : [];
    const created = after.filter((shape) => !before.includes(shape));
    if (created.length === 0) {
      notes.push("group had no re-creatable shapes — skipped");
      return;
    }
    const group = parent.createGroup(created);
    if (spec.nodeName) {
      try {
        group.name = spec.nodeName;
      } catch {
        // cosmetic
      }
    }
    for (const [name, snap] of Object.entries(spec.props)) {
      seedAnimatable(tryRead(() => group[name]), snap);
    }
    for (const fill of spec.fills) {
      try {
        addPaintTo(group, fill);
      } catch {
        notes.push("created group couldn't take a recorded fill");
      }
    }
    return;
  }
  const factoryName = SHAPE_FACTORIES[spec.nodeType];
  if (!factoryName) {
    notes.push(`can't re-create a ${nodeTypeName(spec.nodeType)} — skipped`);
    return;
  }
  if (typeof parent[factoryName] !== "function") {
    throw new Error(`this layer can't take a ${nodeTypeName(spec.nodeType)}`);
  }
  const created = parent[factoryName]();
  applyNodeSpec(created, spec, notes);
}

/** Container + list marker + index for structural paths like [...,'fills',2]. */
function splitStructural(
  target: AnyProxy,
  path: Path,
  notes: string[],
): { container: AnyProxy; marker: string; index: number } {
  const index = path[path.length - 1];
  const marker = path[path.length - 2];
  if (typeof index !== "number" || typeof marker !== "string") {
    throw new Error("this step can't be replayed (malformed path)");
  }
  const container =
    path.length > 2 ? resolvePath(target, path.slice(0, -2), undefined, notes) : target;
  return { container, marker, index };
}

// ---------------------------------------------------------------------------
// applyStep
// ---------------------------------------------------------------------------

function skipNote(notes: string[], error: unknown): StepOutcome {
  notes.push(`${error instanceof Error ? error.message : String(error)} — skipped`);
  return { notes };
}

/**
 * Applies one step to one target. Throws readable messages on genuine
 * failure; returns notes for everything deliberately adapted or not applied.
 */
export function applyStep(
  target: AnyProxy,
  rawPayload: unknown,
  context: ApplyContext,
): StepOutcome {
  const notes: string[] = [];
  if (!isStepPayload(rawPayload)) {
    throw new Error("this step can't be replayed (unrecognized format)");
  }
  const payload = rawPayload;

  switch (payload.op) {
    case "set-static": {
      let prop: AnyProxy;
      try {
        prop = resolvePath(target, payload.path, payload.shapeHint, notes);
      } catch (error) {
        try {
          if (applyPaintFallback(target, payload.path, payload.after, notes)) {
            return { notes };
          }
          const trimProp = resolveTrimProp(target, payload.path, notes);
          if (trimProp) {
            if (hasKeyframes(trimProp)) {
              notes.push(
                `${pathKey(payload.path)} has keyframes here — static value not applied`,
              );
            } else {
              trimProp.staticValue = payload.after;
            }
            return { notes };
          }
        } catch (fallbackError) {
          return skipNote(notes, fallbackError);
        }
        return skipNote(notes, error);
      }
      // Writing staticValue while keyframes exist is discarded by the host
      // without error — say so instead of reporting a phantom success.
      if (hasKeyframes(prop)) {
        notes.push(`${pathKey(payload.path)} has keyframes here — static value not applied`);
        return { notes };
      }
      const key = pathKey(payload.path);
      const origin = context.origins[key] ?? payload.before;
      prop.staticValue = computeTarget(
        context.baselines[key],
        origin,
        payload.after,
        propClassOf(payload.path),
      );
      return { notes };
    }

    case "keyframes": {
      let prop: AnyProxy;
      try {
        prop = resolvePath(target, payload.path, payload.shapeHint, notes);
      } catch (error) {
        try {
          if (applyPaintKeyframesFallback(target, payload, notes, context)) {
            return { notes };
          }
          const trimProp = resolveTrimProp(target, payload.path, notes);
          if (trimProp) {
            applyKeyframes(trimProp, payload, notes, context);
            return { notes };
          }
        } catch (fallbackError) {
          return skipNote(notes, fallbackError);
        }
        return skipNote(notes, error);
      }
      applyKeyframes(prop, payload, notes, context);
      return { notes };
    }

    case "set-plain": {
      const flag = payload.path[payload.path.length - 1];
      let owner: AnyProxy;
      try {
        owner =
          payload.path.length > 1
            ? resolvePath(target, payload.path.slice(0, -1), payload.shapeHint, notes)
            : target;
      } catch (error) {
        return skipNote(notes, error);
      }
      // A flag the owner doesn't carry is a skip, not a write: resolvePath's
      // best-effort shape fallback can hand back a node of a different type
      // (e.g. an ELLIPSE geometry for a GROUP's blendMode path), and a bare
      // assignment would CREATE a phantom property the read-back then
      // trivially "verifies" (live: trace 2026-08-26T04-04, idx 15).
      {
        // A THROWING getter means the flag exists but is unreadable
        // (write-only) — still write it. Only a clean `undefined` read
        // proves the node doesn't carry the flag.
        let missing = false;
        try {
          missing = owner[flag as string] === undefined;
        } catch {
          missing = false;
        }
        if (missing) {
          return skipNote(
            notes,
            new Error(`${String(flag)} not found on this layer`),
          );
        }
      }
      try {
        owner[flag as string] = payload.after;
      } catch (error) {
        return skipNote(notes, error);
      }
      // Hosts can accept an assignment and keep their own value (the same
      // trap fakeScene models for staticValue-with-keyframes). Read back
      // defensively: a mismatch means the host discarded the write, and the
      // user must see that — nothing applies silently. An unreadable flag
      // makes no claim either way.
      try {
        const seen = toJson(owner[flag as string]);
        if (!jsonEqual(seen, payload.after)) {
          notes.push(`the host kept ${String(flag)} unchanged — the write didn't take`);
        }
      } catch {
        // read-back unavailable: unverifiable is not a failure
      }
      return { notes };
    }

    case "add-paint": {
      const { container, marker } = splitStructural(target, payload.path, notes);
      if (marker !== "fills") throw new Error("this step can't be replayed (malformed path)");
      addPaintTo(container, payload.spec);
      return { notes };
    }

    case "add-fill": {
      // legacy v1 payload: same as add-paint at the target root
      addPaintTo(target, payload.spec);
      return { notes };
    }

    case "replace-paint": {
      const marker = payload.path[payload.path.length - 2];
      if (marker === "fills") {
        // Topology-aware: the recorded path says where the SOURCE kept its
        // fill; resolvePaint finds the TARGET's corresponding paint even
        // when its structure differs (group-nested vs flat — the live
        // "Ellipse 1: this layer can't take fills" failure). Capability is
        // checked BEFORE any removal, so a host whose containers can't
        // create fills degrades to writing the spec onto the existing
        // paint in place — never destroy-then-throw.
        const resolved = resolvePaint(target, [...payload.path, "color"]);
        if (!resolved) {
          // No existing fill anywhere — CREATE one where the host allows it
          // ("make it look like this" includes a layer that had no fill).
          const { container } = splitStructural(target, payload.path, notes);
          const creator_ = canCreatePaint(container)
            ? container
            : canCreatePaint(target)
              ? target
              : undefined;
          if (creator_) {
            addPaintTo(creator_, payload.spec);
            notes.push("this layer had no fill — added the recorded one");
          } else {
            notes.push("this layer can't hold a fill — skipped");
          }
          return { notes };
        }
        if (resolved.remapped) notes.push("applied to this layer's first fill");
        if (canCreatePaint(resolved.container)) {
          if (!removeListEntry(resolved.container, "fills", resolved.index)) {
            notes.push("couldn't remove the old fill — the new one was added alongside");
          }
          addPaintTo(resolved.container, payload.spec);
        } else {
          applySpecInPlace(resolved.paint, payload.spec, resolved.label, notes);
        }
        return { notes };
      }
      const { container, marker: m, index } = splitStructural(target, payload.path, notes);
      if (!removeListEntry(container, m, index)) {
        notes.push("couldn't remove the old fill — the new one was added alongside");
      }
      addPaintTo(container, payload.spec);
      return { notes };
    }

    case "remove-paint": {
      const { container, marker, index } = splitStructural(target, payload.path, notes);
      if (!removeListEntry(container, marker, index)) {
        notes.push(`couldn't find ${entryLabel(marker)} ${index + 1} to remove`);
      }
      return { notes };
    }

    case "add-stroke": {
      const container =
        payload.path.length > 2
          ? resolvePath(target, payload.path.slice(0, -2), undefined, notes)
          : target;
      const spec = { width: payload.spec.width, fill: paintSpec(payload.spec.fill) };
      if (typeof container.addStroke === "function") {
        container.addStroke(spec);
      } else if (typeof container.createStroke === "function") {
        container.createStroke(spec);
      } else {
        throw new Error("this layer can't take strokes");
      }
      return { notes };
    }

    case "add-mask": {
      const { container } = splitStructural(target, payload.path, notes);
      const spec: Record<string, Json> = {
        pathData: staticOf(payload.spec.pathData),
        opacity: staticOf(payload.spec.opacity, 100),
      };
      if (payload.spec.mode) spec.mode = payload.spec.mode;
      // The real host exposes createMask, NOT addMask (RUNTIME-API.md:103-106,
      // live trace 2026-08-26T08-15-40) — checking only addMask skipped every
      // mask step on a live host and cascaded into "masks[0] not found" on the
      // follow-on edits. Same addX→createX fallback as add-stroke above and
      // applyNodeSpec's mask loop.
      if (typeof container.addMask === "function") {
        container.addMask(spec);
      } else if (typeof container.createMask === "function") {
        container.createMask(spec);
      } else {
        notes.push("this layer can't take masks — skipped");
      }
      return { notes };
    }

    case "remove-mask": {
      const { container, index } = splitStructural(target, payload.path, notes);
      if (!removeListEntry(container, "masks", index)) {
        notes.push(`couldn't find mask ${index + 1} to remove`);
      }
      return { notes };
    }

    case "add-shape": {
      const parent =
        payload.parentPath.length > 0
          ? resolvePath(target, payload.parentPath, undefined, notes)
          : target;
      createShapeFrom(parent, payload.spec, notes);
      return { notes };
    }

    case "remove-shape": {
      let node: AnyProxy;
      try {
        node = resolvePath(target, payload.path, payload.shapeType, notes);
      } catch (error) {
        return skipNote(notes, error);
      }
      if (typeof node.remove !== "function") {
        notes.push("this shape can't be removed — skipped");
        return { notes };
      }
      node.remove();
      return { notes };
    }

    case "add-trim": {
      const { container } = splitStructural(target, payload.path, notes);
      if (typeof container.createTrimPath !== "function") {
        notes.push("this layer can't take trim paths — skipped");
        return { notes };
      }
      const created = container.createTrimPath();
      for (const propName of ["start", "end", "offset"] as const) {
        seedAnimatable(tryRead(() => created[propName]), payload.spec[propName]);
      }
      return { notes };
    }

    case "remove-trim": {
      const { container, index } = splitStructural(target, payload.path, notes);
      const trims = tryRead(() => container.trimPaths);
      const trim = Array.isArray(trims) ? trims[index] : undefined;
      if (!trim || typeof trim.remove !== "function") {
        notes.push(`couldn't find trim path ${index + 1} to remove`);
        return { notes };
      }
      trim.remove();
      return { notes };
    }

    case "reorder-shapes": {
      let container: AnyProxy;
      try {
        container =
          payload.path.length > 0
            ? resolvePath(target, payload.path, undefined, notes)
            : target;
      } catch (error) {
        return skipNote(notes, error);
      }
      reorderShapes(container, payload.order, notes);
      return { notes };
    }

    case "add-layer":
    case "remove-layer":
    case "break-scene":
    case "nest-layers":
    case "reorder-layers": {
      // Scene-level ops are applied by the playback orchestrator, which owns
      // the scene; reaching applyStep means a legacy selection-mode replay.
      notes.push("scene-level step doesn't apply to a single layer — skipped");
      return { notes };
    }

    case "not-replayable": {
      notes.push(`${payload.description} — skipped`);
      return { notes };
    }
  }
}

/**
 * Realizes a recorded shape order on the target via the host's untyped
 * moveBefore/moveAfter (runtime-discovered; absent from the typings). The
 * permutation maps new position -> previous index; target shapes beyond the
 * recorded range keep their relative order at the end. The result is
 * verified by re-reading the list — a partial apply is reported, not hidden.
 */
function reorderShapes(container: AnyProxy, order: number[], notes: string[]): void {
  reorderChildren(container, "shapes", order, notes);
}

/** Same permutation semantics over any child list (shapes, scene layers). */
export function reorderChildren(
  owner: AnyProxy,
  listKey: string,
  order: number[],
  notes: string[],
): void {
  const list = tryRead(() => owner[listKey]);
  if (!Array.isArray(list) || list.length < 2) {
    notes.push("nothing to reorder on this layer");
    return;
  }
  const current: AnyProxy[] = [...list];
  if (
    typeof current[0]?.moveBefore !== "function" ||
    typeof current[0]?.moveAfter !== "function"
  ) {
    notes.push("this layer can't reorder shapes — skipped");
    return;
  }

  const desired: AnyProxy[] = [];
  const used = new Set<number>();
  for (const prevIndex of order) {
    if (Number.isInteger(prevIndex) && prevIndex >= 0 && prevIndex < current.length && !used.has(prevIndex)) {
      desired.push(current[prevIndex]);
      used.add(prevIndex);
    }
  }
  current.forEach((shape, i) => {
    if (!used.has(i)) desired.push(shape);
  });
  if (desired.every((shape, i) => shape === current[i])) return; // already ordered

  try {
    if (desired[0] !== current[0]) desired[0].moveBefore(current[0]);
    for (let i = 1; i < desired.length; i++) {
      desired[i].moveAfter(desired[i - 1]);
    }
  } catch (error) {
    notes.push(
      `reorder partially applied — ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const after = tryRead(() => owner[listKey]);
  if (Array.isArray(after) && desired.some((shape, i) => after[i] !== shape)) {
    notes.push("reorder did not fully apply on this layer");
  }
}

// ---------------------------------------------------------------------------
// Adaptive paint fallback (recolor steps onto mismatched paint kinds)
// ---------------------------------------------------------------------------

interface ResolvedPaint {
  paint: AnyProxy;
  container: AnyProxy;
  index: number;
  leaf: string;
  label: string;
  remapped: boolean;
}

/** Finds the paint a fills/strokes color path refers to, remapping index. */
/**
 * Topology fallback: the recorded path said where the SOURCE kept its fill
 * (e.g. inside a GROUP at shapes[0]); the target may keep its own at the
 * layer root, or vice versa (live: Circle 3's group fill retargeted onto a
 * flat Ellipse 1 — trace 2026-08-26T03-56-02). A recolor is a recolor:
 * find the target's nearest paint list by descending the first-shape chain
 * from the root.
 */
function findNearestFills(
  target: AnyProxy,
): { container: AnyProxy; fills: AnyProxy[] } | undefined {
  let node: AnyProxy = target;
  for (let depth = 0; node && depth < 5; depth++) {
    const fills = tryRead(() => node.fills);
    if (Array.isArray(fills) && fills.length > 0) return { container: node, fills };
    const single = tryRead(() => node.fill);
    if (single !== undefined && single !== null) return { container: node, fills: [single] };
    const shapes = tryRead(() => node.shapes);
    if (!Array.isArray(shapes) || shapes.length === 0) return undefined;
    node = shapes[0];
  }
  return undefined;
}

export function resolvePaint(target: AnyProxy, path: Path): ResolvedPaint | undefined {
  // support deep paths: [...(shapes,i)*, 'fills', i, leaf]
  const fillsAt = path.lastIndexOf("fills");
  const strokesAt = path.lastIndexOf("strokes");
  if (fillsAt >= 0 && typeof path[fillsAt + 1] === "number" && path.length === fillsAt + 3) {
    const container =
      fillsAt > 0 ? tryRead(() => resolvePath(target, path.slice(0, fillsAt))) : target;
    let host = container;
    let fills = tryRead(() => host?.fills);
    if (!Array.isArray(fills)) {
      // text layers: singular fill
      const single = tryRead(() => host?.fill);
      fills = single !== undefined && single !== null ? [single] : undefined;
    }
    let topologyRemap = false;
    if (!Array.isArray(fills) || fills.length === 0) {
      // The recorded container has no paints on THIS target — different
      // topology (group-nested vs flat). Find the target's own fill.
      const nearest = findNearestFills(target);
      if (!nearest) return undefined;
      host = nearest.container;
      fills = nearest.fills;
      topologyRemap = true;
    }
    const index = path[fillsAt + 1] as number;
    const remapped = topologyRemap || fills[index] === undefined;
    return {
      paint: fills[index] ?? fills[0],
      container: host,
      index: fills[index] === undefined ? 0 : index,
      leaf: String(path[fillsAt + 2]),
      label: "fill",
      remapped,
    };
  }
  if (
    strokesAt >= 0 &&
    typeof path[strokesAt + 1] === "number" &&
    path[strokesAt + 2] === "fill" &&
    path.length === strokesAt + 4
  ) {
    const container =
      strokesAt > 0 ? tryRead(() => resolvePath(target, path.slice(0, strokesAt))) : target;
    let strokes = tryRead(() => container?.strokes);
    if (!Array.isArray(strokes)) {
      const single = tryRead(() => container?.stroke);
      strokes = single !== undefined && single !== null ? [single] : undefined;
    }
    if (!Array.isArray(strokes) || strokes.length === 0) return undefined;
    const index = path[strokesAt + 1] as number;
    const remapped = strokes[index] === undefined;
    const stroke = strokes[index] ?? strokes[0];
    const paint = tryRead(() => stroke.fill);
    if (!paint) return undefined;
    return {
      paint,
      container,
      index: remapped ? 0 : index,
      leaf: String(path[strokesAt + 3]),
      label: "stroke",
      remapped,
    };
  }
  return undefined;
}

function firstStopColor(stops: Json): Json | undefined {
  if (!Array.isArray(stops)) return undefined;
  const first = stops[0];
  if (first === null || typeof first !== "object" || Array.isArray(first)) return undefined;
  const color = (first as Record<string, Json>).color;
  return color === undefined ? undefined : color;
}

/**
 * Gradient stops landing on a solid LIST fill mean the macro wants a
 * GRADIENT there — convert the fill (remove + recreate, the replace-paint
 * mechanism) so the full stop values survive instead of collapsing to one
 * color. Only list fills: a singular text fill has no removal semantics
 * (adaptation stays), and strokes keep adaptation too. Returns the new
 * gradient paint, or undefined when conversion isn't possible.
 */
function convertFillToGradient(
  resolved: ResolvedPaint,
  stopsValue: Json,
  notes: string[],
): AnyProxy | undefined {
  if (resolved.label !== "fill") return undefined;
  const container = resolved.container;
  const list = tryRead(() => container?.fills);
  if (!Array.isArray(list)) return undefined; // singular fill — adapt instead
  const canAdd =
    typeof tryRead(() => container.addFill) === "function" ||
    typeof tryRead(() => container.createFill) === "function";
  if (!canAdd) return undefined;
  const spec: PaintSnapshot = {
    kind: "gradient",
    stops: { animated: false, static: Array.isArray(stopsValue) ? stopsValue : [] },
  };
  const removed = removeListEntry(container, "fills", resolved.index);
  let created: AnyProxy;
  try {
    const byAdd = tryRead(() => container.addFill);
    created =
      typeof byAdd === "function" ? byAdd.call(container, paintSpec(spec)) : container.createFill(paintSpec(spec));
  } catch {
    notes.push("couldn't convert this layer's solid fill to a gradient");
    return undefined;
  }
  if (!created) {
    const after = tryRead(() => container.fills);
    created = Array.isArray(after) ? after[after.length - 1] : undefined;
  }
  if (!created) return undefined;
  notes.push(
    removed
      ? `this layer's ${resolved.label} was solid — converted it to a gradient`
      : `this layer's ${resolved.label} was solid — added the gradient alongside (couldn't remove the old fill)`,
  );
  if (resolved.remapped) notes.push(`applied to this layer's first ${resolved.label}`);
  return created;
}

/**
 * A recolor is a recolor, whatever shape the target's paint takes. Solid
 * color onto a gradient tints every stop; gradient stops onto a solid
 * CONVERT the fill to a gradient (list fills) or apply the first stop's
 * color (singular fills, strokes); an out-of-range index remaps to paint 0.
 */
function applyPaintFallback(target: AnyProxy, path: Path, after: Json, notes: string[]): boolean {
  const resolved = resolvePaint(target, path);
  if (!resolved) return false;
  const { paint, leaf, label, remapped } = resolved;

  const direct = tryRead(() => paint[leaf]);
  if (direct !== undefined && direct !== null && typeof direct === "object") {
    (direct as AnyProxy).staticValue = after;
    if (remapped) notes.push(`applied to this layer's first ${label}`);
    return true;
  }

  if (leaf === "stops") {
    // The full gradient beats a one-color adaptation wherever the target's
    // fill can actually change kind.
    const converted = convertFillToGradient(resolved, after, notes);
    if (converted) return true; // the creation spec already carried the stops
    const color = firstStopColor(after);
    const solidColor = tryRead(() => paint.color);
    if (color !== undefined && solidColor !== undefined && solidColor !== null) {
      (solidColor as AnyProxy).staticValue = color;
      notes.push(`this layer's ${label} is solid — applied the gradient's first color`);
      return true;
    }
  }

  if (leaf === "color") {
    const stopsProp = tryRead(() => paint.stops);
    if (stopsProp !== undefined && stopsProp !== null) {
      const current = toJson((stopsProp as AnyProxy).staticValue);
      if (Array.isArray(current) && current.length > 0) {
        (stopsProp as AnyProxy).staticValue = current.map((stop) =>
          stop !== null && typeof stop === "object" && !Array.isArray(stop)
            ? { ...stop, color: after }
            : stop,
        );
        notes.push(`this layer's ${label} is a gradient — applied the color to every stop`);
        return true;
      }
    }
  }

  return false;
}

/**
 * A trim-path edit onto a target with no trim path creates one on demand —
 * the recorded end state wants a trimmed shape, so give the target the means.
 * Returns the addressed trim property (start/end/offset) or undefined when
 * the target genuinely can't hold a trim path.
 */
function resolveTrimProp(target: AnyProxy, path: Path, notes: string[]): AnyProxy | undefined {
  const at = path.lastIndexOf("trimPaths");
  if (at < 0 || typeof path[at + 1] !== "number" || path.length !== at + 3) return undefined;
  const container =
    at > 0 ? tryRead(() => resolvePath(target, path.slice(0, at))) : target;
  if (!container) return undefined;
  const index = path[at + 1] as number;
  const trims = tryRead(() => container.trimPaths);
  let trim: AnyProxy = Array.isArray(trims) ? trims[index] ?? trims[0] : undefined;
  if (trim && Array.isArray(trims) && trims[index] === undefined) {
    notes.push("applied to this layer's first trim path");
  }
  if (!trim) {
    if (typeof container.createTrimPath !== "function") return undefined;
    trim = container.createTrimPath();
    notes.push("added a trim path to this layer");
  }
  return tryRead(() => trim[path[at + 2] as string]);
}

/**
 * An animated recolor is still a recolor: keyframing a solid color onto a
 * gradient fill keyframes its stops (every stop tinted per keyframe), and
 * keyframed stops onto a solid fill keyframe its color (first stop's color).
 */
function applyPaintKeyframesFallback(
  target: AnyProxy,
  payload: Extract<StepPayload, { op: "keyframes" }>,
  notes: string[],
  context: ApplyContext,
): boolean {
  const resolved = resolvePaint(target, payload.path);
  if (!resolved) return false;
  const { paint, leaf, label } = resolved;

  const convert = (
    prop: AnyProxy,
    note: string,
    transform: (value: Json) => Json | undefined,
  ): boolean => {
    const map = (snap: KfSnap): KfSnap => {
      const value = transform(snap.value);
      return value === undefined ? snap : { ...snap, value };
    };
    applyKeyframes(
      prop,
      {
        ...payload,
        added: payload.added.map(map),
        removed: payload.removed.map(map),
        changed: payload.changed.map((change) => ({
          before: map(change.before),
          after: map(change.after),
        })),
      },
      notes,
      context,
    );
    notes.push(note);
    return true;
  };

  if (leaf === "color") {
    const stopsProp = tryRead(() => paint.stops);
    if (stopsProp !== undefined && stopsProp !== null) {
      const current = toJson((stopsProp as AnyProxy).staticValue);
      if (Array.isArray(current) && current.length > 0) {
        return convert(
          stopsProp,
          `this layer's ${label} is a gradient — animated the color onto every stop`,
          (color) =>
            current.map((stop) =>
              stop !== null && typeof stop === "object" && !Array.isArray(stop)
                ? { ...stop, color }
                : stop,
            ),
        );
      }
    }
  }

  if (leaf === "stops") {
    // Convert the solid fill to a gradient seeded with the earliest
    // keyframe's stops, then run the ordinary keyframe machinery on it.
    const earliest = [...payload.added, ...payload.changed.map((c) => c.after)].sort(
      (a, b) => a.frame - b.frame,
    )[0];
    const converted = convertFillToGradient(resolved, earliest?.value ?? [], notes);
    if (converted) {
      const stopsProp = tryRead(() => converted.stops);
      if (stopsProp !== undefined && stopsProp !== null) {
        applyKeyframes(stopsProp, payload, notes, context);
        return true;
      }
    }
    const solidColor = tryRead(() => paint.color);
    if (solidColor !== undefined && solidColor !== null) {
      return convert(
        solidColor,
        `this layer's ${label} is solid — animated the gradient's first color`,
        (stops) => firstStopColor(stops),
      );
    }
  }

  return false;
}

/** Reads this target's current value for a path (relative baselines). */
export function readBaseline(target: AnyProxy, path: Path): Json | undefined {
  try {
    const prop = resolvePath(target, path);
    return toJson(prop.staticValue);
  } catch {
    return undefined;
  }
}
