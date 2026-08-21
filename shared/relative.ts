import type { Json } from "./json";
import type { PropClass } from "./snapshot";

/**
 * Computes the value to write to a playback target. One semantics, no modes:
 *
 * - absolute class: the recorded `after` verbatim (colors, geometry, child
 *   values, keyframe timing — "exact looks").
 * - additive (layer position/rotation/skew): baseline + (after − origin), per
 *   numeric component — "relative motion".
 * - multiplicative (layer scale): baseline × (after ÷ origin); an origin
 *   component of 0 falls back to absolute for that component.
 *
 * `origin` is the recorded node's value when the path was FIRST touched
 * (anchoring to record-start keeps steps independent of skipped ones);
 * `baseline` is the target node's value at playback.begin.
 * Non-numeric or shape-mismatched values fall back to absolute.
 */
export function computeTarget(
  baseline: Json | undefined,
  origin: Json,
  after: Json,
  propClass: PropClass,
): Json {
  if (propClass === "absolute" || baseline === undefined) {
    return after;
  }

  if (typeof after === "number") {
    if (typeof origin !== "number" || typeof baseline !== "number") return after;
    return combine(baseline, origin, after, propClass);
  }

  if (
    after !== null &&
    typeof after === "object" &&
    !Array.isArray(after) &&
    origin !== null &&
    typeof origin === "object" &&
    !Array.isArray(origin) &&
    baseline !== null &&
    typeof baseline === "object" &&
    !Array.isArray(baseline)
  ) {
    const out: { [key: string]: Json } = { ...after };
    for (const key of Object.keys(after)) {
      const a = after[key];
      const o = (origin as Record<string, Json>)[key];
      const b = (baseline as Record<string, Json>)[key];
      if (typeof a === "number" && typeof o === "number" && typeof b === "number") {
        out[key] = combine(b, o, a, propClass);
      }
    }
    return out;
  }

  return after;
}

function combine(baseline: number, origin: number, after: number, propClass: PropClass): number {
  if (propClass === "additive") return baseline + (after - origin);
  // multiplicative — origin 0 makes the ratio undefined: absolute fallback
  if (origin === 0) return after;
  return baseline * (after / origin);
}
