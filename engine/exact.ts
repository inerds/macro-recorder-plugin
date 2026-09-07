/**
 * "Record exact values" — the modifier the user holds when they press Record.
 *
 * A layer's own transform records as a RELATIVE step by default: a recorded
 * "position.x 100 → 160" replays as +60 onto whatever the target holds, which
 * is what a move macro means. It is the wrong default for a placement macro —
 * "put every icon at x 160" — so Record takes a modifier that stamps each
 * eligible step with the formula that says "set this value": one term per
 * component, `{ scale: 0, offset: after }`.
 *
 * The stamp is a pure rewrite of a recorded step, so the recorder and the
 * sandbox are untouched: what a modifier changes is how the panel STORES what
 * the host reported, never what the host is asked for.
 *
 * Pure: a step in, a step out.
 */
import { formulaEligible, isNumberRecord } from "./formula";
import type { Json } from "./json";
import { labelOf } from "./labels";
import type { MacroStep } from "./macro";
import { explicitFormulaOf } from "./operator";
import type { LinearTerm, StepFormula, StepPayload } from "./steps";

/** The formula that writes `after` whatever the target currently holds. */
function exactFormulaOf(after: Json): StepFormula | undefined {
  if (typeof after === "number") return { scale: 0, offset: after };
  if (isNumberRecord(after)) {
    const out: Record<string, LinearTerm> = {};
    for (const [key, value] of Object.entries(after)) {
      out[key] = { scale: 0, offset: value };
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return undefined;
}

/**
 * `step` with its replay pinned to the recorded end value, or `step` itself.
 *
 * Only a `set-static` on a layer's own transform (`formulaEligible`) takes the
 * stamp. Everything else — a paint, a deep path, a scene op — is returned as
 * the SAME object, so a caller can stamp a whole list without copying it.
 *
 * A keyframes step is left alone on purpose: its keyframes are the motion, and
 * "exact" has no meaning for a curve the replay retimes onto the target. A step
 * that already carries its own `apply` is left alone too — an explicit formula
 * is a decision, and this modifier does not overrule one.
 *
 * The label is rebuilt from the stamped payload, so the row reads in the arrow
 * form ("position.x 100 → 160") rather than the operator form ("position.x
 * +60") that the relative default prints.
 */
export function withExactApply(step: MacroStep): MacroStep {
  const payload = step.payload as StepPayload | undefined;
  if (!payload || typeof payload !== "object" || !("op" in payload)) return step;
  if (payload.op !== "set-static") return step;
  if (!formulaEligible(payload.path)) return step;
  if (explicitFormulaOf(payload) !== undefined) return step;
  const apply = exactFormulaOf(payload.after);
  if (!apply) return step;
  const stamped: StepPayload = { ...payload, apply };
  return { ...step, payload: stamped, label: labelOf(stamped) };
}
