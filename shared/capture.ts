/**
 * Capture a layer's EXISTING timeline keyframes as replayable steps — the
 * diff-free sibling of `diff.ts`. Where the differ compares two snapshots
 * and emits what changed, capture walks ONE snapshot and emits every
 * animated path as an `op:"keyframes"` payload with all keyframes in
 * `added`, so replay (frame-keyed upsert) recreates the motion anywhere.
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

interface AnimatedPath {
  path: Path;
  keyframes: KfSnap[];
  /** Deepest shape node the path passes through (diffNode's shapeHint rule). */
  shapeHint?: string;
}

function pushIfAnimated(
  out: AnimatedPath[],
  path: Path,
  snap: AnimatableSnapshot | undefined,
  shapeHint: string | undefined,
) {
  if (!snap?.keyframes || snap.keyframes.length === 0) return;
  out.push({ path, keyframes: snap.keyframes, ...(shapeHint ? { shapeHint } : {}) });
}

function walkPaint(
  out: AnimatedPath[],
  basePath: Path,
  paint: PaintSnapshot,
  shapeHint: string | undefined,
) {
  if (paint.kind === "solid") {
    pushIfAnimated(out, [...basePath, "color"], paint.color, shapeHint);
    pushIfAnimated(out, [...basePath, "opacity"], paint.opacity, shapeHint);
    return;
  }
  if (paint.kind === "gradient") {
    pushIfAnimated(out, [...basePath, "stops"], paint.stops, shapeHint);
    pushIfAnimated(out, [...basePath, "start"], paint.start, shapeHint);
    pushIfAnimated(out, [...basePath, "end"], paint.end, shapeHint);
    pushIfAnimated(out, [...basePath, "highlightAngle"], paint.highlightAngle, shapeHint);
    pushIfAnimated(out, [...basePath, "highlightLength"], paint.highlightLength, shapeHint);
    pushIfAnimated(out, [...basePath, "opacity"], paint.opacity, shapeHint);
  }
}

/** Differ-order walk of one node level, recursing into shapes. */
function walkNode(
  out: AnimatedPath[],
  basePath: Path,
  node: NodeSnapshot,
  shapeHint: string | undefined,
) {
  // Inside the shape subtree the hint is the DEEPEST shape node's type —
  // same result diffNode's post-annotation produces.
  const hint = basePath.includes("shapes") ? node.nodeType : shapeHint;

  for (const name of Object.keys(node.props)) {
    pushIfAnimated(out, [...basePath, name], node.props[name], hint);
  }
  node.fills.forEach((fill, i) => walkPaint(out, [...basePath, "fills", i], fill, hint));
  node.strokes.forEach((stroke, i) => {
    pushIfAnimated(out, [...basePath, "strokes", i, "width"], stroke.width, hint);
    walkPaint(out, [...basePath, "strokes", i, "fill"], stroke.fill, hint);
  });
  (node.trims ?? []).forEach((trim, i) => {
    pushIfAnimated(out, [...basePath, "trimPaths", i, "start"], trim.start, hint);
    pushIfAnimated(out, [...basePath, "trimPaths", i, "end"], trim.end, hint);
    pushIfAnimated(out, [...basePath, "trimPaths", i, "offset"], trim.offset, hint);
  });
  node.masks.forEach((mask, i) => {
    pushIfAnimated(out, [...basePath, "masks", i, "pathData"], mask.pathData, hint);
    pushIfAnimated(out, [...basePath, "masks", i, "opacity"], mask.opacity, hint);
  });
  node.shapes.forEach((shape, i) => walkNode(out, [...basePath, "shapes", i], shape, hint));
}

function animatedPathsOf(layer: NodeSnapshot): AnimatedPath[] {
  const out: AnimatedPath[] = [];
  walkNode(out, [], layer, undefined);
  return out;
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
 * Synthesize `op:"keyframes"` payloads for a layer's existing animation.
 * scope "selected" filters each path's keyframes to those matching the
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
  const out: StepPayload[] = [];
  for (const { path, keyframes, shapeHint } of animatedPathsOf(layer)) {
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
  return out;
}
