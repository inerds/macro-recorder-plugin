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

interface Collected {
  animated: AnimatedPath[];
  /** Animatables holding only a static value (scope "all" captures these). */
  statics: StaticPath[];
  /** Content plain flags (scope "all" captures these). */
  plain: StaticPath[];
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

function walkPaint(
  out: Collected,
  basePath: Path,
  paint: PaintSnapshot,
  shapeHint: string | undefined,
) {
  if (paint.kind === "solid") {
    pushAnimatable(out, [...basePath, "color"], paint.color, shapeHint);
    pushAnimatable(out, [...basePath, "opacity"], paint.opacity, shapeHint);
    return;
  }
  if (paint.kind === "gradient") {
    pushAnimatable(out, [...basePath, "stops"], paint.stops, shapeHint);
    pushAnimatable(out, [...basePath, "start"], paint.start, shapeHint);
    pushAnimatable(out, [...basePath, "end"], paint.end, shapeHint);
    pushAnimatable(out, [...basePath, "highlightAngle"], paint.highlightAngle, shapeHint);
    pushAnimatable(out, [...basePath, "highlightLength"], paint.highlightLength, shapeHint);
    pushAnimatable(out, [...basePath, "opacity"], paint.opacity, shapeHint);
  }
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
  node.fills.forEach((fill, i) => walkPaint(out, [...basePath, "fills", i], fill, hint));
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
  const out: Collected = { animated: [], statics: [], plain: [] };
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
