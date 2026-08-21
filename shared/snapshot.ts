import type { Json } from "./json";

/** Property path into a node, e.g. ['shapes', 0, 'size'] or ['position']. */
export type Path = (string | number)[];

export function pathKey(path: Path): string {
  return path.join(".");
}

export interface KfSnap {
  id?: string;
  frame: number;
  value: Json;
  easing?: Json;
  /** Spatial (motion-path) bezier handles on position keyframes. Untyped on
   *  the host's Keyframe interface but shown in its docs; read and written
   *  defensively, absent when the host doesn't expose them. */
  inTangent?: Json;
  outTangent?: Json;
}

export interface AnimatableSnapshot {
  animated: boolean;
  static?: Json;
  keyframes?: KfSnap[];
}

/**
 * Paints are captured fully so a replay can recreate one from scratch
 * (replace-paint / add-paint): solid = color; gradient = start/end/stops and,
 * for radials, the highlight pair.
 */
export type PaintSnapshot =
  | { kind: "solid"; color: AnimatableSnapshot; opacity?: AnimatableSnapshot }
  | {
      kind: "gradient";
      gradientType?: string;
      start?: AnimatableSnapshot;
      end?: AnimatableSnapshot;
      stops: AnimatableSnapshot;
      highlightAngle?: AnimatableSnapshot;
      highlightLength?: AnimatableSnapshot;
      opacity?: AnimatableSnapshot;
    }
  | { kind: "unknown" };

export interface StrokeSnapshot {
  width: AnimatableSnapshot;
  fill: PaintSnapshot;
}

/** Trim path (untyped runtime surface: node.trimPaths / createTrimPath). */
export interface TrimSnapshot {
  start?: AnimatableSnapshot;
  end?: AnimatableSnapshot;
  offset?: AnimatableSnapshot;
  mode?: string;
}

export interface MaskSnapshot {
  mode?: string;
  pathData: AnimatableSnapshot;
  opacity: AnimatableSnapshot;
}

/**
 * Recursive snapshot of a node and its whole shape subtree. `shapes` recurses
 * through Groups; fills/strokes/masks are captured at every level they exist.
 */
export interface NodeSnapshot {
  nodeId: string;
  nodeType: string;
  nodeName?: string;
  /** Animatable properties, keyed by name from the per-type registry. */
  props: Record<string, AnimatableSnapshot>;
  /** Plain writable flags (LayerMixin): visible, locked, blendMode, … */
  plain: Record<string, Json>;
  fills: PaintSnapshot[];
  strokes: StrokeSnapshot[];
  masks: MaskSnapshot[];
  /** Optional: absent in snapshots recorded before trim support. */
  trims?: TrimSnapshot[];
  shapes: NodeSnapshot[];
}

/** Whole-scene snapshot: every top-level layer's subtree. */
export interface SceneSnapshot {
  sceneId?: string;
  layers: NodeSnapshot[];
}

/** Transform + opacity — present on layers and groups. */
const TRANSFORM_PROPS = [
  "position",
  "scale",
  "rotation",
  "skew",
  "skewAxis",
  "opacity",
] as const;

/**
 * Animatable property names per node type (plugin-api.d.ts). Unknown types
 * fall back to probing the union of everything — reads are defensive, absent
 * properties are simply omitted.
 */
export const TYPE_PROPS: Record<string, readonly string[]> = {
  CONTAINER: TRANSFORM_PROPS,
  SCENE_INSTANCE: TRANSFORM_PROPS,
  GROUP: TRANSFORM_PROPS,
  SHAPE_LAYER: TRANSFORM_PROPS, // legacy/fake type name
  RECTANGLE: ["size", "position", "roundness"],
  ELLIPSE: ["size", "position"],
  POLYGON: ["points", "position", "rotation", "outerRadius", "outerRoundness"],
  STAR: [
    "points",
    "position",
    "rotation",
    "innerRadius",
    "outerRadius",
    "innerRoundness",
    "outerRoundness",
  ],
  PATH: ["pathData"],
  // Untyped runtime surface: text layers exist despite the typings.
  // fontSize may be animatable; if the host serves it as a plain number the
  // serializer records it via the plain channel instead.
  TEXT_LAYER: [...TRANSFORM_PROPS, "fontSize"],
};

export const ALL_CANDIDATE_PROPS: readonly string[] = [
  ...new Set(Object.values(TYPE_PROPS).flat()),
];

export function propsForType(nodeType: string): readonly string[] {
  return TYPE_PROPS[nodeType] ?? ALL_CANDIDATE_PROPS;
}

/** Plain writable LayerMixin flags — never animatable, diffed by value. */
export const PLAIN_PROPS: readonly string[] = [
  "visible",
  "locked",
  "blendMode",
  "startFrame",
  "endFrame",
  "timelineOffset",
  "isMatte",
  // text layers (probed defensively; absent elsewhere)
  "text",
  "fontFamily",
  "fontStyle",
  "fontSize",
  "alignment",
];

/** Property classes that drive relative playback math for layer transforms. */
export type PropClass = "additive" | "multiplicative" | "absolute";

/**
 * Only the recorded layer's OWN transform is relative — child-shape values,
 * paints, masks and geometry apply exactly. That single rule is the whole
 * "smart" semantics.
 */
export function propClassOf(path: Path): PropClass {
  if (path.length !== 1) return "absolute";
  switch (path[0]) {
    case "position":
    case "rotation":
    case "skew":
    case "skewAxis":
      return "additive";
    case "scale":
      return "multiplicative";
    default:
      return "absolute";
  }
}
