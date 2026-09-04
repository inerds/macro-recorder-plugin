import type { Json } from "./json";
import { labelOf } from "./labels";
import type { Macro, MacroStep } from "./macro";
import type { StepPayload } from "./steps";

/**
 * Step value editing — the part of a step a user may rewrite from the UI.
 * Pure data transforms so the review sheet, the macro detail and the
 * parameter form (feature 4) all share one notion of "editable".
 */
export type EditableValue =
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "text"; value: string }
  | { kind: "color"; value: { r: number; g: number; b: number } }
  /** Every key numeric, e.g. {x, y} or {x, y, z}. */
  | { kind: "vector"; value: Record<string, number> };

function isColor(v: Json): v is { r: number; g: number; b: number } {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    typeof v.r === "number" &&
    typeof v.g === "number" &&
    typeof v.b === "number" &&
    Object.keys(v).every((k) => k === "r" || k === "g" || k === "b" || k === "a")
  );
}

function isVector(v: Json): v is Record<string, number> {
  return (
    v !== null &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).length > 0 &&
    Object.values(v).every((n) => typeof n === "number")
  );
}

function classify(value: Json): EditableValue | null {
  if (typeof value === "number") return { kind: "number", value };
  if (typeof value === "boolean") return { kind: "boolean", value };
  if (typeof value === "string") return { kind: "text", value };
  if (isColor(value)) return { kind: "color", value: { r: value.r, g: value.g, b: value.b } };
  if (isVector(value)) return { kind: "vector", value: { ...value } };
  return null;
}

function payloadOf(step: MacroStep): StepPayload | null {
  const payload = step.payload;
  if (typeof payload !== "object" || payload === null) return null;
  if (typeof (payload as { op?: unknown }).op !== "string") return null;
  return payload as StepPayload;
}

/** The user-editable value of a step, or null when the step has none. */
export function editableValueOf(step: MacroStep): EditableValue | null {
  const payload = payloadOf(step);
  if (!payload) return null;
  switch (payload.op) {
    case "set-static":
    case "set-plain":
      // Path data is a whole point array — not something to type into a box.
      if (payload.path[payload.path.length - 1] === "pathData") return null;
      return classify(payload.after);
    case "add-layer":
      return payload.cloneOf || typeof payload.spec.nodeName !== "string"
        ? null
        : { kind: "text", value: payload.spec.nodeName };
    default:
      return null;
  }
}

/**
 * A copy of `step` with its editable value replaced and the label rebuilt.
 * Returns the step unchanged when it has no editable value or the kinds
 * don't match (a caller handing a color to a number step is a bug, not a
 * request).
 */
export function withEditedValue(step: MacroStep, next: EditableValue): MacroStep {
  const current = editableValueOf(step);
  const payload = payloadOf(step);
  if (!current || !payload || current.kind !== next.kind) return step;

  let edited: StepPayload;
  if (payload.op === "set-static" || payload.op === "set-plain") {
    const after: Json =
      next.kind === "color" || next.kind === "vector" ? { ...next.value } : next.value;
    edited = { ...payload, after };
  } else if (payload.op === "add-layer" && next.kind === "text") {
    edited = { ...payload, spec: { ...payload.spec, nodeName: next.value } };
  } else {
    return step;
  }
  return { ...step, payload: edited, label: labelOf(edited) };
}

/** Substitute parameter values into a macro's steps (feature 4). */
export function applyParamValues(
  macro: Macro,
  values: Record<string, EditableValue>,
): MacroStep[] {
  return macro.steps.map((step) => {
    const value = values[step.id];
    return value ? withEditedValue(step, value) : step;
  });
}
