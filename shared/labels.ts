import type { Json } from "./json";
import type { Path } from "./snapshot";
import type { StepPayload } from "./steps";

function round2(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function isColor(v: Json): v is { r: number; g: number; b: number } {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    typeof v.r === "number" &&
    typeof v.g === "number" &&
    typeof v.b === "number"
  );
}

function hex(v: { r: number; g: number; b: number }): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(v.r)}${c(v.g)}${c(v.b)}`.toUpperCase();
}

function fmt(v: Json): string {
  if (v === null) return "–";
  if (typeof v === "number") return round2(v);
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return String(v);
  if (isColor(v)) return hex(v);
  if (Array.isArray(v)) return `[${v.map(fmt).join(", ")}]`;
  const parts = Object.entries(v).map(([k, val]) => `${k}: ${fmt(val)}`);
  return `(${parts.join(", ")})`;
}

/**
 * When a vector value changed in exactly one component, name that component
 * ("position.x 100 → 200"); otherwise show the whole value.
 */
function changedComponent(
  before: Json,
  after: Json,
): { key: string; before: Json; after: Json } | null {
  if (
    before === null ||
    after === null ||
    typeof before !== "object" ||
    typeof after !== "object" ||
    Array.isArray(before) ||
    Array.isArray(after)
  ) {
    return null;
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const diffs: string[] = [];
  for (const key of keys) {
    const b = before[key] ?? null;
    const a = after[key] ?? null;
    const equal =
      typeof b === "number" && typeof a === "number"
        ? Math.abs(b - a) < 1e-6
        : JSON.stringify(b) === JSON.stringify(a);
    if (!equal) diffs.push(key);
  }
  if (diffs.length === 1) {
    const key = diffs[0]!;
    return { key, before: before[key] ?? null, after: after[key] ?? null };
  }
  return null;
}

function propName(path: Path): string {
  // Deep shape paths: "shapes.1.size" -> "Shape 2 · size";
  // nested groups flatten to the leaf shape.
  let path0 = path;
  let shapePrefix = "";
  let i = 0;
  while (path0[i] === "shapes" && typeof path0[i + 1] === "number") {
    shapePrefix = `Shape ${(path0[i + 1] as number) + 1} · `;
    i += 2;
  }
  if (i > 0) {
    const inner = propNameFlat(path0.slice(i));
    return `${shapePrefix}${inner}`;
  }
  return propNameFlat(path);
}

function propNameFlat(path: Path): string {
  const root = path[0];
  if (root === "trimPaths") {
    const index = typeof path[1] === "number" && path[1] > 0 ? ` ${(path[1] as number) + 1}` : "";
    const rest = path.slice(2).join(".");
    return `Trim path${index}${rest ? ` · ${rest}` : ""}`;
  }
  if (root === "masks") {
    const index = typeof path[1] === "number" && path[1] > 0 ? ` ${(path[1] as number) + 1}` : "";
    const rest = path.slice(2).join(".");
    return `Mask${index}${rest ? ` · ${rest}` : ""}`;
  }
  if (root === "fills") {
    const rest = path.slice(2).join(".");
    const index = typeof path[1] === "number" && path[1] > 0 ? ` ${(path[1] as number) + 1}` : "";
    return `Fill${index}${rest && rest !== "color" ? ` ${rest}` : ""}`;
  }
  if (root === "strokes") {
    const index = typeof path[1] === "number" && path[1] > 0 ? ` ${(path[1] as number) + 1}` : "";
    let rest = path.slice(2).join(".");
    if (rest === "fill.color") rest = "color";
    return `Stroke${index}${rest ? ` · ${rest}` : ""}`;
  }
  return String(root);
}

const TRANSFORM_SET = new Set(["position", "scale", "rotation", "skew", "skewAxis", "opacity"]);

export function labelOf(payload: StepPayload): string {
  // Scene-level ops already name their layer in the label itself.
  const isSceneOp =
    payload.op === "add-layer" ||
    payload.op === "remove-layer" ||
    payload.op === "break-scene" ||
    payload.op === "nest-layers" ||
    payload.op === "reorder-layers";
  const layerName =
    !isSceneOp && "layer" in payload && payload.layer?.name ? payload.layer.name : null;
  const prefix = layerName ? `${layerName} · ` : "";
  return `${prefix}${bareLabelOf(payload)}`;
}

function bareLabelOf(payload: StepPayload): string {
  switch (payload.op) {
    case "set-static": {
      const root = payload.path[0];
      if (root === "fills") {
        const rest = payload.path.slice(2);
        if (rest.length === 0 || rest[0] === "color" || rest[rest.length - 1] === "stops") {
          return `${propName(payload.path)} → ${fmt(payload.after)}`;
        }
        return `${propName(payload.path)} ${fmt(payload.before)} → ${fmt(payload.after)}`;
      }
      if (root === "strokes") {
        return `${propName(payload.path)} ${fmt(payload.before)} → ${fmt(payload.after)}`;
      }
      const prefix =
        payload.path.length === 1 && typeof root === "string" && TRANSFORM_SET.has(root)
          ? "Transform · "
          : "";
      const display = propName(payload.path);
      // A path edit's value is a whole point array — summarize, don't dump.
      if (payload.path[payload.path.length - 1] === "pathData") {
        const count =
          payload.after !== null &&
          typeof payload.after === "object" &&
          !Array.isArray(payload.after) &&
          Array.isArray(payload.after.points)
            ? payload.after.points.length
            : null;
        return `${display} edited${count !== null ? ` (${count} points)` : ""}`;
      }
      const component = changedComponent(payload.before, payload.after);
      if (component) {
        return `${prefix}${display}.${component.key} ${fmt(component.before)} → ${fmt(component.after)}`;
      }
      return `${prefix}${display} ${fmt(payload.before)} → ${fmt(payload.after)}`;
    }
    case "keyframes": {
      const prop = propName(payload.path);
      const single =
        payload.added.length === 1 && payload.removed.length === 0 && payload.changed.length === 0
          ? payload.added[0]
          : null;
      if (single) return `Keyframe · ${prop} @ ${round2(single.frame)}`;
      const parts: string[] = [];
      if (payload.added.length) parts.push(`+${payload.added.length}`);
      if (payload.removed.length) parts.push(`−${payload.removed.length}`);
      if (payload.changed.length) parts.push(`~${payload.changed.length}`);
      return `Keyframes · ${prop} (${parts.join(", ")})`;
    }
    case "set-plain": {
      const flag = String(payload.path[payload.path.length - 1]);
      if (typeof payload.after === "boolean") {
        return `Layer · ${flag} ${payload.after ? "on" : "off"}`;
      }
      return `Layer · ${flag} ${fmt(payload.before)} → ${fmt(payload.after)}`;
    }
    case "add-fill":
    case "add-paint":
      return payload.spec.kind === "solid"
        ? `Add fill ${fmt(payload.spec.color.static ?? null)}`
        : "Add fill (gradient)";
    case "replace-paint":
      return payload.spec.kind === "solid"
        ? `Fill becomes solid ${fmt(payload.spec.color.static ?? null)}`
        : "Fill becomes gradient";
    case "add-stroke":
      return `Add stroke ${fmt(payload.spec.width)}px`;
    case "remove-paint": {
      const last = payload.path;
      const index = typeof last[last.length - 1] === "number" ? (last[last.length - 1] as number) : 0;
      const suffix = index > 0 ? ` ${index + 1}` : "";
      return last.includes("strokes") ? `Remove stroke${suffix}` : `Remove fill${suffix}`;
    }
    case "add-trim":
      return "Add trim path";
    case "remove-trim":
      return "Remove trim path";
    case "add-mask":
      return "Add mask";
    case "remove-mask":
      return "Remove mask";
    case "add-shape":
      return `Add ${payload.spec.nodeType.toLowerCase()}`;
    case "remove-shape":
      return `Remove ${payload.shapeType ? payload.shapeType.toLowerCase() : "shape"}`;
    case "reorder-shapes":
      return "Reorder shapes";
    case "add-layer":
      return payload.cloneOf
        ? `Duplicate ${payload.cloneOf.name ?? "layer"}`
        : `Add layer${payload.spec.nodeName ? ` "${payload.spec.nodeName}"` : ""}`;
    case "remove-layer":
      return `Remove ${payload.layer.name ?? "layer"}`;
    case "break-scene":
      return `Break ${payload.layer.name ?? "scene layer"} into layers`;
    case "nest-layers": {
      const names = payload.layers.map((l) => l.name ?? "layer").join(", ");
      return `Nest ${names || "layers"} into ${payload.spec.nodeName ?? "a scene"}`;
    }
    case "reorder-layers":
      return "Reorder layers";
    case "not-replayable":
      return payload.description;
  }
}
