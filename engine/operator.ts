/**
 * The replay class of one step — whether it SETS, SHIFTS, or SCALES.
 *
 * Targets-mode replay has always applied a layer's own position, rotation,
 * skew, and skewAxis as deltas and scale as a ratio (`propClassOf`). That is
 * the right default and it stays. It is wrong for a reset or a placement: a
 * recorded "rotation 45 → 0" is a delta of −45, so a target at 30 ends at
 * −15. This module makes the class a per-step answer, so the label, the
 * editor and the applier all read one decision. `computeTarget` itself is
 * untouched; the class only chooses which arm of it runs.
 *
 * A step that carries its own formula (`engine/formula.ts`) answers
 * "absolute" here: the formula reads the target's live value itself, so
 * playback tracks no origin for it and the applier writes what the formula
 * says.
 *
 * Pure: payloads in, decisions out.
 */
import type { Json } from "./json";
import { type Path, type PropClass, propClassOf } from "./snapshot";
import type { LinearTerm, StepFormula, StepPayload } from "./steps";

/** The paths a formula applies to: a layer's own transform, nothing deeper. */
const ELIGIBLE = new Set(["position", "rotation", "skew", "skewAxis", "scale"]);

/** Identity value per path: a recorded end value equal to it reads as a reset. */
const IDENTITY: Record<string, number> = {
  rotation: 0,
  skew: 0,
  skewAxis: 0,
  scale: 100,
};

export function operatorEligible(path: Path): boolean {
  return path.length === 1 && typeof path[0] === "string" && ELIGIBLE.has(path[0]);
}

/** Every numeric component of `value` equals `n` (a bare number counts as one component). */
function everyComponentIs(value: Json, n: number): boolean {
  if (typeof value === "number") return value === n;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const numbers = Object.values(value).filter((v) => typeof v === "number");
  return numbers.length > 0 && numbers.every((v) => v === n);
}

/** Any numeric component of `value` is 0 — a ratio from it is undefined. */
export function hasZeroComponent(value: Json): boolean {
  if (typeof value === "number") return value === 0;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).some((v) => typeof v === "number" && v === 0);
}

/**
 * The class a payload replays with — the one thing the applier and the origin
 * tracker ask.
 *
 * On a layer's own transform, in this order:
 *
 * 1. An explicit formula is absolute. The formula reads the target's live
 *    value at apply time, so there is nothing for playback to track and no
 *    frozen origin to measure against.
 * 2. A set-static whose recorded end value is the path's identity — rotation
 *    0, skew 0, scale 100/100 — is a reset, and a reset is exact: a delta to
 *    zero is never what anyone meant. Keyframe steps never take this
 *    heuristic; a keyframe AT the identity is a pose, not a reset.
 * 3. A multiply over a recorded start with a 0 component is absolute. No
 *    ratio exists from 0, so there is nothing to show, nothing to type and
 *    nothing to scale — and absolute is what `computeTarget`'s zero-origin
 *    fallback already writes for that component.
 * 4. Otherwise the path's own class.
 *
 * Everything outside a layer's transform keeps the path's class, so nothing
 * deeper in the tree changes behaviour.
 */
function isTerm(value: unknown): value is LinearTerm {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as LinearTerm).scale === "number" &&
    typeof (value as LinearTerm).offset === "number"
  );
}

/**
 * The formula a step explicitly carries, or undefined. This is the ONLY
 * reader of `payload.apply`: every other module asks here, so a value the
 * store hands back in a shape this build does not write can never reach a
 * label or an editor and throw mid-render. Two shapes are honoured — one
 * term, or one term per component. The strings "exact" / "add" /
 * "multiply" are what the first cut of this feature saved (never released,
 * but the user's own dev store holds them); they are read back as the
 * formula they meant on a set-static step, and dropped on a keyframes step,
 * which then replays by its class as it always did. Anything else is
 * treated as absent.
 */
export function explicitFormulaOf(payload: StepPayload): StepFormula | undefined {
  if (payload.op !== "set-static" && payload.op !== "keyframes") return undefined;
  const raw: unknown = payload.apply;
  if (raw === undefined || raw === null) return undefined;
  if (isTerm(raw)) return raw;
  if (typeof raw === "object") {
    const all = Object.entries(raw as Record<string, unknown>);
    const terms = all.filter((entry): entry is [string, LinearTerm] => isTerm(entry[1]));
    if (terms.length === 0) return undefined;
    // The stored object itself when it is clean, so callers can compare by
    // identity; a filtered copy only when something in it was not a term.
    if (terms.length === all.length) return raw as Record<string, LinearTerm>;
    return Object.fromEntries(terms);
  }
  if (typeof raw !== "string" || payload.op !== "set-static") return undefined;
  const legacy = (before: number, after: number): LinearTerm | undefined => {
    if (raw === "exact") return { scale: 0, offset: after };
    if (raw === "add") return { scale: 1, offset: after - before };
    if (raw === "multiply")
      return before === 0 ? { scale: 0, offset: after } : { scale: after / before, offset: 0 };
    return undefined;
  };
  const { before, after } = payload;
  if (typeof before === "number" && typeof after === "number") return legacy(before, after);
  if (
    before !== null &&
    after !== null &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const out: Record<string, LinearTerm> = {};
    for (const [key, a] of Object.entries(after)) {
      const b = (before as Record<string, unknown>)[key];
      if (typeof a !== "number") continue;
      const term = typeof b === "number" ? legacy(b, a) : { scale: 0, offset: a };
      if (term) out[key] = term;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return undefined;
}

export function payloadClass(payload: StepPayload): PropClass {
  if (
    (payload.op === "set-static" || payload.op === "keyframes") &&
    operatorEligible(payload.path)
  ) {
    if (explicitFormulaOf(payload) !== undefined) return "absolute";
    if (payload.op === "set-static") {
      const identity = IDENTITY[String(payload.path[0])];
      if (identity !== undefined && everyComponentIs(payload.after, identity)) return "absolute";
      if (propClassOf(payload.path) === "multiplicative" && hasZeroComponent(payload.before)) {
        return "absolute";
      }
    }
    return propClassOf(payload.path);
  }
  return "path" in payload ? propClassOf(payload.path) : "absolute";
}
