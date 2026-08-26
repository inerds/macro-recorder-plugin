/**
 * Which of the four playback states a row of the step list is in.
 *
 * Playback indices are ENABLED-space and climb across repeats (iteration ×
 * length + inner index), while the list renders every step of one iteration.
 * This is the mapping back: given a row's position among the enabled steps,
 * what it should show right now.
 */
export type PlayStepStatus = "pending" | "running" | "done" | "failed";

/** The `PlayingState` fields this needs — kept structural so it stays pure. */
export interface PlayStepProgress {
  currentStep: number;
  doneCount: number;
  failedSteps: readonly number[];
}

export function stepStatusFor(
  enabledIndex: number,
  playing: PlayStepProgress,
  enabledLen: number,
): PlayStepStatus {
  if (enabledLen <= 0) return "pending";
  // A step that failed stays marked for the rest of the run, in every
  // iteration — the mark is about the step, not about this pass over it.
  if (playing.failedSteps.some((failed) => failed % enabledLen === enabledIndex)) {
    return "failed";
  }
  const iteration = Math.floor(playing.currentStep / enabledLen);
  const raw = iteration * enabledLen + enabledIndex;
  if (raw < playing.doneCount) return "done";
  if (raw === playing.currentStep) return "running";
  return "pending";
}
