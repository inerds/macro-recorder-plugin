import {
  applyFormula,
  formatFormula,
  isNumberRecord,
  isScalarFormula,
  parseFormula,
  termsOf,
} from "./formula";
import { jsonEqual, type Json } from "./json";
import { labelOf } from "./labels";
import type { Macro, MacroStep } from "./macro";
import type { LinearTerm, StepFormula, StepPayload } from "./steps";

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
  | { kind: "vector"; value: Record<string, number> }
  /**
   * A transform step's per-component arithmetic on the target's current
   * value, as the user types it: `{ value: "v + 10" }` for a scalar
   * property, one field per component (`{ x, y }`) for a vector. The text
   * is what `engine/formula.ts` parses, not a number — the box holds a
   * formula, and a plain number is the formula that sets a value.
   *
   * `at` is the RECORDED value each field's `v` stood for, keyed the way the
   * fields are (a scalar property under `value`). It is what the editor
   * converts an operand through when the user changes the operator, so
   * `v + 30` recorded from 100 becomes `130` and not `30` when they press
   * `=`. It is a HINT for the editor and nothing else: no step stores it,
   * and `withFormula` ignores it.
   */
  | { kind: "formula"; fields: Record<string, string>; at?: Record<string, number> };

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

/**
 * The value a step's formula fields are shaped by: a scalar property gets one
 * box, a vector one per component. For a set-static that is the recorded end
 * value; for a keyframes step it is any keyframe it writes.
 */
function shapeOf(payload: StepPayload): Json | undefined {
  if (payload.op === "set-static") return payload.after;
  if (payload.op !== "keyframes") return undefined;
  const snap =
    payload.added[0] ??
    payload.changed[0]?.after ??
    payload.changed[0]?.before ??
    payload.removed[0];
  return snap?.value;
}

/**
 * The recorded value each field's `v` stood for, keyed the way the fields
 * are — all of them or none, so the editor never converts one component
 * against a number and its neighbour against nothing.
 *
 * A keyframes step gets none: it records a RUN of values, and no single one
 * of them is what `v` holds when replay reaches the step. The editor then
 * converts against 0.
 */
function atOf(payload: StepPayload, keys: string[]): Record<string, number> | undefined {
  if (payload.op !== "set-static") return undefined;
  const before = payload.before;
  const out: Record<string, number> = {};
  for (const key of keys) {
    // A scalar `before` under per-component fields is the one-term-over-a-
    // vector case: every component started from the same number.
    const n =
      typeof before === "number" ? before : isNumberRecord(before) ? before[key] : undefined;
    if (typeof n !== "number") return undefined;
    out[key] = n;
  }
  return out;
}

/** A formula value with its recorded anchors, when the step has them. */
function formulaWith(payload: StepPayload, fields: Record<string, string>): EditableValue {
  const at = atOf(payload, Object.keys(fields));
  return at ? { kind: "formula", fields, at } : { kind: "formula", fields };
}

/**
 * The formula boxes for an eligible transform step, or null when the step
 * takes none (a deep path, a non-transform op, a recording with no numbers to
 * read). The text comes from `termsOf`, so a step following the path's
 * default shows the arithmetic that default performs — `v + 100` for a drag,
 * `0` for a recorded reset — and a step carrying its own formula shows that.
 */
function formulaValueOf(payload: StepPayload): EditableValue | null {
  const terms = termsOf(payload);
  if (terms === undefined) return null;
  if (!isScalarFormula(terms)) {
    const fields: Record<string, string> = {};
    for (const [key, term] of Object.entries(terms)) fields[key] = formatFormula(term);
    return formulaWith(payload, fields);
  }
  // One term over a vector property means the same arithmetic on every
  // component. The boxes still follow the property, so the user edits `x`
  // and `y`, not one unnamed field standing for both.
  const shape = shapeOf(payload);
  const text = formatFormula(terms);
  if (isVector(shape ?? null)) {
    const fields: Record<string, string> = {};
    for (const key of Object.keys(shape as Record<string, number>)) fields[key] = text;
    return formulaWith(payload, fields);
  }
  return formulaWith(payload, { value: text });
}

/**
 * The user-editable value of a step, or null when the step has none.
 *
 * A layer's own transform is edited as a FORMULA — the arithmetic the step
 * performs on whatever the target holds — because that is what replay does
 * with it. Everything else is edited as its plain end value.
 */
export function editableValueOf(step: MacroStep): EditableValue | null {
  const payload = payloadOf(step);
  if (!payload) return null;
  switch (payload.op) {
    case "keyframes":
      return formulaValueOf(payload);
    case "set-static":
    case "set-plain": {
      // Path data is a whole point array — not something to type into a box.
      if (payload.path[payload.path.length - 1] === "pathData") return null;
      if (payload.op === "set-static") {
        const formula = formulaValueOf(payload);
        if (formula) return formula;
      }
      return classify(payload.after);
    }
    case "add-layer":
      return payload.cloneOf || typeof payload.spec.nodeName !== "string"
        ? null
        : { kind: "text", value: payload.spec.nodeName };
    default:
      return null;
  }
}

/**
 * The formula a set of boxes spells, or null when any box is unreadable. One
 * box named `value` is a scalar property's single term; named boxes are one
 * term per component.
 */
function formulaFrom(fields: Record<string, string>): StepFormula | null {
  const keys = Object.keys(fields);
  if (keys.length === 0) return null;
  const terms: Record<string, LinearTerm> = {};
  for (const key of keys) {
    const parsed = parseFormula(fields[key] ?? "");
    if (!parsed.ok) return null;
    terms[key] = parsed.term;
  }
  return keys.length === 1 && keys[0] === "value" ? terms.value! : terms;
}

/**
 * A copy of `step` with the formula from its boxes written into `apply`.
 *
 * A set-static also gets a new `after`: the formula run over the RECORDED
 * start value. The step then still says something true about the recording —
 * the label reads from it, and a scene rebuild, which reproduces the
 * recording rather than reading a target, writes it.
 *
 * A keyframes step keeps its recorded keyframes: they are the motion, and the
 * formula only says where that motion lands.
 *
 * A box that does not parse leaves the step alone. The editor blocks the save
 * first; this is the belt.
 *
 * The value's `at` is not read here: it is the editor's anchor for converting
 * an operand between operators, and the step already holds the recorded
 * values it was derived from.
 */
function withFormula(
  step: MacroStep,
  payload: StepPayload,
  fields: Record<string, string>,
): MacroStep {
  if (payload.op !== "set-static" && payload.op !== "keyframes") return step;
  const apply = formulaFrom(fields);
  if (!apply) return step;
  const edited: StepPayload =
    payload.op === "set-static"
      ? { ...payload, apply, after: applyFormula(apply, payload.before) }
      : { ...payload, apply };
  return { ...step, payload: edited, label: labelOf(edited) };
}

/**
 * A copy of `step` with its editable value replaced and the label rebuilt.
 *
 * A transform step's value is a FORMULA, so the edit writes `apply` and the
 * step replays as arithmetic on whatever the target holds. Every other step
 * takes its new end value directly. The conversion lives here and nowhere
 * else: the row editor, the macro drawer and the pre-play parameter form all
 * reach the recorded value through this one function.
 *
 * Returns the step unchanged when it has no editable value or the kinds
 * don't match (a caller handing a color to a number step is a bug, not a
 * request).
 */
export function withEditedValue(step: MacroStep, next: EditableValue): MacroStep {
  const payload = payloadOf(step);
  if (!payload) return step;

  const current = editableValueOf(step);
  if (!current || current.kind !== next.kind) return step;

  if (next.kind === "formula") return withFormula(step, payload, next.fields);

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

/**
 * Substitute parameter values into a macro's steps (feature 4).
 *
 * A field the user did not touch still holds the text `editableValueOf`
 * produced, which is the step's own term ROUNDED for display. Writing it back
 * would re-parse that rounding into the payload and pin an `apply` on a step
 * that had none, so an untouched value leaves its step exactly as it is.
 */
export function applyParamValues(macro: Macro, values: Record<string, EditableValue>): MacroStep[] {
  return macro.steps.map((step) => {
    const value = values[step.id];
    if (!value) return step;
    const current = editableValueOf(step);
    if (current && jsonEqual(current as unknown as Json, value as unknown as Json)) return step;
    return withEditedValue(step, value);
  });
}
