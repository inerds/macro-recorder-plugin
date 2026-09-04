import { describe, expect, it } from "vitest";

import { stepStatusFor, type PlayStepProgress, type PlayStepStatus } from "./stepStatus";

/** The whole strip's statuses, so a case reads as the picture it describes. */
function strip(playing: PlayStepProgress, len: number): PlayStepStatus[] {
  return Array.from({ length: len }, (_, i) => stepStatusFor(i, playing, len));
}

const run = (over: Partial<PlayStepProgress> = {}): PlayStepProgress => ({
  currentStep: 0,
  doneCount: 0,
  failedSteps: [],
  ...over,
});

describe("stepStatusFor", () => {
  it("marks everything pending at the start of a run", () => {
    expect(strip(run(), 4)).toEqual(["running", "pending", "pending", "pending"]);
  });

  it("walks the strip mid-run", () => {
    expect(strip(run({ currentStep: 2, doneCount: 2 }), 4)).toEqual([
      "done",
      "done",
      "running",
      "pending",
    ]);
  });

  it("shows every row done during the settle beat", () => {
    // The last step-done lands before `done` does — nothing is running then.
    expect(strip(run({ currentStep: 3, doneCount: 4 }), 4)).toEqual([
      "done",
      "done",
      "done",
      "done",
    ]);
  });

  it("resets the strip on the next repeat iteration", () => {
    // Iteration 2 of a 3-step macro: raw indices 3,4,5 — the first row is
    // running again and the rest are pending, even though doneCount is 3.
    expect(strip(run({ currentStep: 3, doneCount: 3 }), 3)).toEqual([
      "running",
      "pending",
      "pending",
    ]);
    expect(strip(run({ currentStep: 5, doneCount: 5 }), 3)).toEqual([
      "done",
      "done",
      "running",
    ]);
  });

  it("keeps a failed step marked after Continue, and into later iterations", () => {
    expect(strip(run({ currentStep: 3, doneCount: 3, failedSteps: [1] }), 4)).toEqual([
      "done",
      "failed",
      "done",
      "running",
    ]);
    // Same step, second pass: raw 5 ≡ index 1 (mod 4).
    expect(strip(run({ currentStep: 6, doneCount: 6, failedSteps: [1] }), 4)).toEqual([
      "done",
      "failed",
      "running",
      "pending",
    ]);
  });

  it("failure outranks running — a failed row is not the current one", () => {
    expect(stepStatusFor(2, run({ currentStep: 2, failedSteps: [2] }), 4)).toBe("failed");
  });

  it("is pending for an empty run rather than dividing by zero", () => {
    expect(stepStatusFor(0, run(), 0)).toBe("pending");
  });
});
