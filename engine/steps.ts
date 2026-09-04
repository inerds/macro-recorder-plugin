import { newId } from "./id";
import type { Json } from "./json";
import { labelOf } from "./labels";
import type { MacroStep } from "./macro";
import type { KfSnap, MaskSnapshot, NodeSnapshot, PaintSnapshot, Path, TrimSnapshot } from "./snapshot";

/** Which layer a step belongs to (whole-scene recording). */
export interface LayerRef {
  id: string;
  name?: string;
  /** The layer's name before this tick renamed it — an extra resolution key
   *  so steps recorded after a rename still find pre-rename targets. */
  priorName?: string;
}

export type StepPayload =
  /** shapeHint = the node type of the shape the path passes through, so a
   *  replay can re-find "the rectangle" when the target's indices differ. */
  | { op: "set-static"; path: Path; before: Json; after: Json; shapeHint?: string; layer?: LayerRef }
  | {
      op: "keyframes";
      path: Path;
      added: KfSnap[];
      removed: KfSnap[];
      changed: { before: KfSnap; after: KfSnap }[];
      shapeHint?: string;
      layer?: LayerRef;
    }
  /** Plain writable layer flag (visible, locked, blendMode, …). */
  | { op: "set-plain"; path: Path; before: Json; after: Json; shapeHint?: string; layer?: LayerRef }
  /** container path + which list + full end-state spec */
  | { op: "add-paint"; path: Path; spec: PaintSnapshot; layer?: LayerRef }
  | { op: "remove-paint"; path: Path; layer?: LayerRef }
  /** paint kind changed in place (solid<->gradient): remove + recreate */
  | { op: "replace-paint"; path: Path; spec: PaintSnapshot; layer?: LayerRef }
  | { op: "add-stroke"; path: Path; spec: { width: Json; fill: PaintSnapshot }; layer?: LayerRef }
  | { op: "add-mask"; path: Path; spec: MaskSnapshot; layer?: LayerRef }
  | { op: "remove-mask"; path: Path; layer?: LayerRef }
  | { op: "add-trim"; path: Path; spec: TrimSnapshot; layer?: LayerRef }
  | { op: "remove-trim"; path: Path; layer?: LayerRef }
  /** parentPath addresses the shape container; spec is the subtree end-state */
  | { op: "add-shape"; parentPath: Path; spec: NodeSnapshot; layer?: LayerRef }
  | { op: "remove-shape"; path: Path; shapeType?: string; layer?: LayerRef }
  /**
   * Surviving shapes changed order. `order[newPos]` = the shape's previous
   * index among survivors; replayed with the host's untyped moveBefore/
   * moveAfter methods.
   */
  | { op: "reorder-shapes"; path: Path; order: number[]; layer?: LayerRef }
  /** Scene-level structure (whole-scene recording). */
  | {
      op: "add-layer";
      spec: NodeSnapshot;
      /** Set when the new layer is structurally a copy of an existing one:
       *  replay duplicates that source (node.clone()) instead of rebuilding. */
      cloneOf?: LayerRef;
      /** Position delta copy − source at record time (Creator's duplicate
       *  offsets the copy); retargeted clones shift by this from their own
       *  source. */
      offset?: Json;
    }
  | { op: "remove-layer"; layer: LayerRef }
  /** A scene instance was broken into its content layers. Replay calls the
   *  instance's break(); `fallback` rebuilds the results if it can't. */
  | { op: "break-scene"; layer: LayerRef; fallback: NodeSnapshot[] }
  /** Layers were nested into a new scene instance. Replay resolves the
   *  layers and calls createSceneInstance(them); spec is the fallback. */
  | { op: "nest-layers"; layers: LayerRef[]; spec: NodeSnapshot }
  /** Scene layers were reordered. `order[newPos]` is the layer's previous
   *  index; `layers` (rev .52+) names those same layers IN THE NEW ORDER so
   *  replay can VERIFY it is looking at the recorded layers before permuting
   *  anything — a positional-only payload silently reshuffled a foreign
   *  scene's real layers (trace 2026-08-26T08-15-02). Absent on legacy
   *  payloads, which replay positionally with a caution note. */
  | { op: "reorder-layers"; order: number[]; layers?: LayerRef[] }
  /** observable but not replayable via the plugin API (e.g. reorder) */
  | { op: "not-replayable"; description: string }
  /** legacy v1 payloads still found in saved macros */
  | { op: "add-fill"; spec: PaintSnapshot };

export type StepKind =
  | "transform"
  | "fill"
  | "stroke"
  | "keyframe"
  | "layer"
  | "shape"
  | "mask"
  | "other";

const TRANSFORM_PROPS = new Set([
  "position",
  "scale",
  "rotation",
  "skew",
  "skewAxis",
  "opacity",
]);

function rootOf(path: Path): string | number | undefined {
  // deep paths: classify by the LAST structural marker before the leaf
  for (let i = path.length - 1; i >= 0; i--) {
    const seg = path[i];
    if (seg === "fills" || seg === "strokes" || seg === "masks" || seg === "shapes" || seg === "trimPaths") return seg;
  }
  return path[0];
}

export function kindOf(payload: StepPayload): StepKind {
  switch (payload.op) {
    case "set-static":
    case "keyframes": {
      const root = rootOf(payload.path);
      if (payload.op === "keyframes") return "keyframe";
      if (root === "fills") return "fill";
      if (root === "strokes") return "stroke";
      if (root === "masks") return "mask";
      if (root === "shapes") return "shape";
      if (typeof root === "string" && TRANSFORM_PROPS.has(root)) return "transform";
      return "other";
    }
    case "set-plain":
      return "layer";
    case "add-paint":
    case "replace-paint":
    case "add-fill":
      return "fill";
    case "remove-paint":
      return rootOf(payload.path) === "strokes" ? "stroke" : "fill";
    case "add-stroke":
      return "stroke";
    case "add-mask":
    case "remove-mask":
      return "mask";
    case "add-trim":
    case "remove-trim":
      return "other";
    case "add-layer":
    case "remove-layer":
    case "break-scene":
    case "nest-layers":
    case "reorder-layers":
      return "layer";
    case "add-shape":
    case "remove-shape":
    case "reorder-shapes":
      return "shape";
    case "not-replayable":
      return "other";
  }
}

/** Materializes a diff payload into a UI-ready MacroStep. */
export function buildStep(payload: StepPayload): MacroStep {
  const step: MacroStep = {
    id: newId(),
    kind: kindOf(payload),
    label: labelOf(payload),
    payload,
  };
  if (payload.op === "not-replayable") step.replayable = false;
  return step;
}

/**
 * The frame range the macro's keyframe payloads touch (enabled or not), or
 * null when it has no keyframes. Pure — the UI's duration readout; playback's
 * own frame math lives sandbox-side (sandbox/playback.ts#earliestKeyframe).
 */
export function keyframeSpan(
  steps: MacroStep[],
): { first: number; last: number } | null {
  let first: number | null = null;
  let last: number | null = null;
  const see = (frame: unknown) => {
    if (typeof frame !== "number" || !Number.isFinite(frame)) return;
    if (first === null || frame < first) first = frame;
    if (last === null || frame > last) last = frame;
  };
  for (const step of steps) {
    const payload = step.payload as StepPayload | undefined;
    if (!payload || typeof payload !== "object" || !("op" in payload)) continue;
    if (payload.op !== "keyframes") continue;
    for (const snap of payload.added) see(snap.frame);
    for (const snap of payload.removed) see(snap.frame);
    for (const change of payload.changed) {
      see(change.before.frame);
      see(change.after.frame);
    }
  }
  return first === null || last === null ? null : { first, last };
}
