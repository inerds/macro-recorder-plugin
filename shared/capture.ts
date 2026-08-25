/**
 * Capture a layer's EXISTING state as replayable steps — the diff-free
 * sibling of `diff.ts`. Where the differ compares two snapshots and emits
 * what changed, capture walks ONE snapshot and emits:
 * - every animated path as an `op:"keyframes"` payload (all keyframes in
 *   `added`), so replay's frame-keyed upsert recreates the motion anywhere;
 * - scope "all" also emits every static animatable as `set-static` and the
 *   CONTENT plain flags as `set-plain`, both with before === after — a
 *   captured state is a value, not a transition. Replay semantics fall out
 *   of the existing engine: deep paths (colors, geometry, text) apply
 *   exactly ("make it look like this"), while length-1 transform statics
 *   are additive with a zero delta, so a retargeted style capture does not
 *   teleport the target.
 *
 * Pure and snapshot-driven on purpose (see CLAUDE.md layering): the sandbox
 * hands this the layer's `NodeSnapshot` from `lastSnapshot`; no proxies here.
 *
 * Path addressing MUST mirror `diffNodeInner` exactly — props, then fills
 * (`fills.i.color|opacity` solid / `stops|start|end|highlightAngle|
 * highlightLength|opacity` gradient), strokes (`strokes.i.width` + the
 * stroke's fill), trims (`trimPaths.i.start|end|offset`), masks
 * (`masks.i.pathData|opacity`), then `shapes.i` recursion — so the applier
 * resolves captured paths identically to recorded ones.
 */
import { jsonEqual, type Json } from "./json";
import type {
  AnimatableSnapshot,
  KfSnap,
  NodeSnapshot,
  PaintSnapshot,
  Path,
} from "./snapshot";
import type { LayerRef, StepPayload } from "./steps";

/** A selected keyframe as read (defensively) off the host's selection list. */
export interface SelectedKf {
  frame: number;
  /** null when the host value was unreadable — then the frame alone matches. */
  value: Json | null;
}

const FRAME_EPSILON = 1e-6;

/**
 * Plain flags that are CONTENT — worth carrying in a full-state capture.
 * Deliberately excludes visible/locked/startFrame/endFrame/timelineOffset/
 * isMatte (structural and timeline noise) and name (renaming a replay
 * target would be hostile).
 */
const CONTENT_PLAIN_FLAGS: readonly string[] = [
  "text",
  "fontFamily",
  "fontStyle",
  "fontSize",
  "alignment",
  "blendMode",
];

interface AnimatedPath {
  path: Path;
  keyframes: KfSnap[];
  /** Deepest shape node the path passes through (diffNode's shapeHint rule). */
  shapeHint?: string;
}

interface StaticPath {
  path: Path;
  value: Json;
  shapeHint?: string;
}

interface PaintPath {
  /** Path to the fill itself, e.g. ["fills", 0] or ["shapes", 0, "fills", 0]. */
  path: Path;
  spec: PaintSnapshot;
}

interface Collected {
  animated: AnimatedPath[];
  /** Animatables holding only a static value (scope "all" captures these). */
  statics: StaticPath[];
  /** Content plain flags (scope "all" captures these). */
  plain: StaticPath[];
  /** Whole fills, captured as replace-paint so the paint KIND (solid vs
   *  linear vs radial gradient) survives replay — component steps alone
   *  cannot change or create a fill's type on the target. */
  paints: PaintPath[];
}

function pushAnimatable(
  out: Collected,
  path: Path,
  snap: AnimatableSnapshot | undefined,
  shapeHint: string | undefined,
) {
  if (!snap) return;
  if (snap.keyframes && snap.keyframes.length > 0) {
    out.animated.push({ path, keyframes: snap.keyframes, ...(shapeHint ? { shapeHint } : {}) });
    return;
  }
  if (snap.static !== undefined) {
    out.statics.push({ path, value: snap.static, ...(shapeHint ? { shapeHint } : {}) });
  }
}

/**
 * @param coveredBySpec the paint is also captured whole as a replace-paint
 *   spec — its STATIC components are already in the spec, so only animated
 *   components need their own steps.
 */
function walkPaint(
  out: Collected,
  basePath: Path,
  paint: PaintSnapshot,
  shapeHint: string | undefined,
  coveredBySpec = false,
) {
  const push = (path: Path, snap: AnimatableSnapshot | undefined) => {
    if (coveredBySpec && !(snap?.keyframes && snap.keyframes.length > 0)) return;
    pushAnimatable(out, path, snap, shapeHint);
  };
  if (paint.kind === "solid") {
    push([...basePath, "color"], paint.color);
    push([...basePath, "opacity"], paint.opacity);
    return;
  }
  if (paint.kind === "gradient") {
    push([...basePath, "stops"], paint.stops);
    push([...basePath, "start"], paint.start);
    push([...basePath, "end"], paint.end);
    push([...basePath, "highlightAngle"], paint.highlightAngle);
    push([...basePath, "highlightLength"], paint.highlightLength);
    push([...basePath, "opacity"], paint.opacity);
  }
}

/** Static value of a component, falling back to its earliest keyframe —
 *  a spec must carry a usable static seed even for animated-only paints. */
function seededSnap(snap: AnimatableSnapshot | undefined): AnimatableSnapshot | undefined {
  if (!snap) return undefined;
  if (snap.static !== undefined || !snap.keyframes || snap.keyframes.length === 0) return snap;
  const earliest = [...snap.keyframes].sort((a, b) => a.frame - b.frame)[0];
  return earliest ? { ...snap, static: earliest.value } : snap;
}

/** A PaintSnapshot whose every component carries a static (see seededSnap). */
function seededPaint(paint: PaintSnapshot): PaintSnapshot {
  if (paint.kind === "solid") {
    return {
      ...paint,
      color: seededSnap(paint.color) ?? paint.color,
      ...(paint.opacity ? { opacity: seededSnap(paint.opacity) } : {}),
    };
  }
  if (paint.kind === "gradient") {
    return {
      ...paint,
      stops: seededSnap(paint.stops) ?? paint.stops,
      ...(paint.start ? { start: seededSnap(paint.start) } : {}),
      ...(paint.end ? { end: seededSnap(paint.end) } : {}),
      ...(paint.highlightAngle ? { highlightAngle: seededSnap(paint.highlightAngle) } : {}),
      ...(paint.highlightLength ? { highlightLength: seededSnap(paint.highlightLength) } : {}),
      ...(paint.opacity ? { opacity: seededSnap(paint.opacity) } : {}),
    };
  }
  return paint;
}

/** Differ-order walk of one node level, recursing into shapes. */
function walkNode(
  out: Collected,
  basePath: Path,
  node: NodeSnapshot,
  shapeHint: string | undefined,
) {
  // Inside the shape subtree the hint is the DEEPEST shape node's type —
  // same result diffNode's post-annotation produces.
  const hint = basePath.includes("shapes") ? node.nodeType : shapeHint;

  for (const name of Object.keys(node.props)) {
    pushAnimatable(out, [...basePath, name], node.props[name], hint);
  }
  for (const flag of CONTENT_PLAIN_FLAGS) {
    const value = node.plain[flag];
    if (value !== undefined) {
      out.plain.push({ path: [...basePath, flag], value, ...(hint ? { shapeHint: hint } : {}) });
    }
  }
  // Text layers carry a SINGULAR fill modeled as a one-item list — there is
  // no removal/creation surface to replace into, so their fills stay
  // component-captured. Everything else captures the whole paint (kind and
  // gradientType included) as replace-paint, plus its animated components.
  const wholePaints = node.nodeType !== "TEXT_LAYER";
  node.fills.forEach((fill, i) => {
    const covered = wholePaints && fill.kind !== "unknown";
    if (covered) out.paints.push({ path: [...basePath, "fills", i], spec: seededPaint(fill) });
    walkPaint(out, [...basePath, "fills", i], fill, hint, covered);
  });
  node.strokes.forEach((stroke, i) => {
    pushAnimatable(out, [...basePath, "strokes", i, "width"], stroke.width, hint);
    walkPaint(out, [...basePath, "strokes", i, "fill"], stroke.fill, hint);
  });
  (node.trims ?? []).forEach((trim, i) => {
    pushAnimatable(out, [...basePath, "trimPaths", i, "start"], trim.start, hint);
    pushAnimatable(out, [...basePath, "trimPaths", i, "end"], trim.end, hint);
    pushAnimatable(out, [...basePath, "trimPaths", i, "offset"], trim.offset, hint);
  });
  node.masks.forEach((mask, i) => {
    pushAnimatable(out, [...basePath, "masks", i, "pathData"], mask.pathData, hint);
    pushAnimatable(out, [...basePath, "masks", i, "opacity"], mask.opacity, hint);
  });
  node.shapes.forEach((shape, i) => walkNode(out, [...basePath, "shapes", i], shape, hint));
}

function collect(layer: NodeSnapshot): Collected {
  const out: Collected = { animated: [], statics: [], plain: [], paints: [] };
  walkNode(out, [], layer, undefined);
  return out;
}

function animatedPathsOf(layer: NodeSnapshot): AnimatedPath[] {
  return collect(layer).animated;
}

/** Offer numbers: animated paths and total keyframes in the layer's subtree. */
export function countKeyframes(layer: NodeSnapshot): {
  pathCount: number;
  keyframeCount: number;
} {
  const paths = animatedPathsOf(layer);
  return {
    pathCount: paths.length,
    keyframeCount: paths.reduce((sum, p) => sum + p.keyframes.length, 0),
  };
}

/**
 * Does a layer keyframe match a selected entry? Frame within epsilon, and
 * either the values agree or the selected value was unreadable (frame-only
 * fallback). Ids are useless here — the host recycles them (RUNTIME-API).
 */
function matchesSelection(kf: KfSnap, selected: SelectedKf[]): boolean {
  return selected.some(
    (sel) =>
      Math.abs(sel.frame - kf.frame) < FRAME_EPSILON &&
      (sel.value === null || jsonEqual(sel.value, kf.value)),
  );
}

/** Count of selected entries that match at least one keyframe of the layer. */
export function countSelectedMatches(layer: NodeSnapshot, selected: SelectedKf[]): number {
  const paths = animatedPathsOf(layer);
  return selected.filter((sel) =>
    paths.some((p) =>
      p.keyframes.some(
        (kf) =>
          Math.abs(sel.frame - kf.frame) < FRAME_EPSILON &&
          (sel.value === null || jsonEqual(sel.value, kf.value)),
      ),
    ),
  ).length;
}

/** KfSnap copy without the host id — ids are recycled and would be noise
 *  in a saved macro; the applier matches by frame anyway. */
function stripId(kf: KfSnap): KfSnap {
  const copy: KfSnap = { frame: kf.frame, value: kf.value };
  if (kf.easing !== undefined) copy.easing = kf.easing;
  if (kf.inTangent !== undefined) copy.inTangent = kf.inTangent;
  if (kf.outTangent !== undefined) copy.outTangent = kf.outTangent;
  return copy;
}

/**
 * Synthesize the payloads for a layer's existing state.
 *
 * scope "all" — the FULL capture: every animated path as a keyframes op,
 * then every static animatable as `set-static` and every content plain
 * flag as `set-plain` (before === after — a captured state, not a
 * transition). Motion first, then look: reads naturally in the feed and
 * each step is independent at replay.
 *
 * scope "selected" — keyframes only, filtered to the entries matching the
 * selection (ambiguous matches on several paths are ALL included — visible
 * and deletable beats silently dropped); paths that filter to empty are
 * skipped. Returns [] when nothing qualifies — the caller decides whether
 * that is an error (RPC maps it to noSelectedKeyframes).
 */
export function captureKeyframePayloads(
  layer: NodeSnapshot,
  opts: { scope: "all" | "selected"; selected?: SelectedKf[] },
): StepPayload[] {
  const ref: LayerRef = {
    id: layer.nodeId,
    ...(layer.nodeName ? { name: layer.nodeName } : {}),
  };
  const collected = collect(layer);
  const out: StepPayload[] = [];
  if (opts.scope === "all") {
    // Whole fills first: replace-paint recreates the paint with its KIND
    // (solid / linear / radial) and static look; the keyframes ops that
    // follow re-animate its components on the fresh paint.
    for (const { path, spec } of collected.paints) {
      out.push({ op: "replace-paint", path, spec, layer: ref });
    }
  }
  for (const { path, keyframes, shapeHint } of collected.animated) {
    const kept =
      opts.scope === "all"
        ? keyframes
        : keyframes.filter((kf) => matchesSelection(kf, opts.selected ?? []));
    if (kept.length === 0) continue;
    out.push({
      op: "keyframes",
      path,
      added: kept.map(stripId),
      removed: [],
      changed: [],
      layer: ref,
      ...(shapeHint ? { shapeHint } : {}),
    });
  }
  if (opts.scope === "all") {
    for (const { path, value, shapeHint } of collected.statics) {
      out.push({
        op: "set-static",
        path,
        before: value,
        after: value,
        layer: ref,
        ...(shapeHint ? { shapeHint } : {}),
      });
    }
    for (const { path, value, shapeHint } of collected.plain) {
      out.push({
        op: "set-plain",
        path,
        before: value,
        after: value,
        layer: ref,
        ...(shapeHint ? { shapeHint } : {}),
      });
    }
  }
  return out;
}
