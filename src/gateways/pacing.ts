/**
 * Playback pacing — UI-side only.
 *
 * Playback used to apply every step as fast as the RPC round-trips allowed,
 * so a macro landed as one indivisible jump. Photoshop's actions palette
 * walks its list instead: the step lights up, then it runs. That dwell is
 * what makes a macro legible as a sequence, so it lives here rather than in
 * the sandbox (the engine must stay as fast as it can be — pacing is a
 * presentation choice and the panel is the only thing that owns timing).
 *
 * The budget is per RUN, not per step: a 3-step macro can afford 300ms a
 * step, a 200-step capture cannot. `4500 / n` spends about four and a half
 * seconds walking the list, clamped so short macros never crawl and long
 * ones stay perceptible (45ms is still one distinct frame of feedback).
 */

/** The whole-run walk budget, in ms, before clamping. */
const RUN_BUDGET_MS = 4500;
/** Slowest dwell — a 15-step macro and anything shorter. */
const MAX_DELAY_MS = 300;
/** Fastest dwell — still long enough to see a row light up. */
const MIN_DELAY_MS = 45;

/**
 * The beat held between "this step is selected" and executing it, for a run
 * of `enabledCount` steps. Non-increasing in the count; 0 when there is
 * nothing to play.
 */
export function paceDelayMs(enabledCount: number): number {
  if (enabledCount <= 0) return 0;
  return Math.round(
    Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, RUN_BUDGET_MS / enabledCount)),
  );
}

/**
 * The beat after the last step and before the run reports done — without it
 * the final row's checkmark and the run's completion land in the same paint
 * and the last step never reads as having happened.
 */
export const SETTLE_MS = 350;
