/**
 * The maths behind spinning the reels by hand.
 *
 * Pure on purpose: the hook that owns the pointer is untestable without a
 * DOM, but everything that decides how far the reels turn, how fast they
 * coast, and what the counter reads is plain arithmetic and unit-tested.
 *
 * Angles are DEGREES throughout and velocities are DEGREES PER MILLISECOND —
 * the same units the reels' `rotate` property and `requestAnimationFrame`
 * timestamps already speak, so nothing converts at the boundary.
 */

export interface Point {
  x: number;
  y: number;
}

/** Coast half-life shape: `v` decays by `e` every TAU ms. */
export const COAST_TAU_MS = 650;
/** Below this the reels are visually still, so the coast ends. */
export const COAST_STOP_DEG_PER_MS = 0.02;
/** A flick can outrun the eye; past this it just reads as a blur. */
export const MAX_DEG_PER_MS = 2.5;
/** One dash cycle (`stroke-dasharray: 6 12` = 18 units) per 40 degrees. */
export const SHIMMER_PER_DEG = 18 / 40;
/** Degrees of reel per counter tick — a real tape counter is geared, too. */
export const COUNTER_DEG_PER_TICK = 6;

/** The pointer's angle around a reel centre, in degrees (atan2 convention). */
export function angleAround(center: Point, p: Point): number {
  return (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI;
}

/**
 * The shortest signed way from `prev` to `next`. Raw atan2 output jumps by
 * 360 when the pointer crosses the -x axis; unwrapped, dragging through that
 * seam is just another small step.
 */
export function unwrapDelta(prev: number, next: number): number {
  let d = (next - prev) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * Exponential decay over `dt` ms. Framed as a ratio rather than a subtraction
 * so a long frame decays exactly as much as the several short frames it
 * replaced — a dropped frame must not change where the reels stop.
 */
export function coastStep(v: number, dt: number, tau = COAST_TAU_MS): number {
  return v * Math.exp(-dt / tau);
}

/** Keep a flick inside what the eye can still read as a turning reel. */
export function clampVelocity(v: number, max = MAX_DEG_PER_MS): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(max, Math.max(-max, v));
}

/**
 * The four-digit mechanical readout, geared to the reels: it counts UP as
 * tape plays forward and down as it rewinds, and it wraps at both ends
 * rather than clamping, the way the real thing does. Forward is a negative
 * `rotate` on this deck (counter-clockwise), hence the sign flip.
 */
export function tapeCounter(angle: number): string {
  const ticks = Math.round(-angle / COUNTER_DEG_PER_TICK);
  const wrapped = ((ticks % 10000) + 10000) % 10000;
  return String(wrapped).padStart(4, "0");
}

/**
 * The dash offset that puts the shimmer where the hand left it.
 *
 * The sign is derived from the deck's two existing direction facts, not
 * chosen: forward is a NEGATIVE `rotate` (`reel-ccw` runs 0 → -360deg) and
 * forward tape is a DECREASING offset (`tape-run` runs 0 → -18). So a
 * forward — counter-clockwise, negative — angle must give a negative offset,
 * which makes the mapping a plain scale. Negate it and the shimmer travels
 * against the reels, which is exactly the direction cue it exists to give.
 */
export function shimmerOffset(angle: number): number {
  return angle * SHIMMER_PER_DEG;
}
