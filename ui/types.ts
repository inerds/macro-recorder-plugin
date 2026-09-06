export type { Macro, MacroStep } from "../engine/macro";
export type { StepKind } from "../engine/steps";
import type { NoteKind } from "../engine/protocol";
export type { NoteKind };

export type StepResult =
  | { kind: "progress"; stepIndex: number }
  | { kind: "step-done"; stepIndex: number; notes?: string[] }
  | { kind: "step-failed"; stepIndex: number; message: string }
  /**
   * notes: everything the run adapted or did not apply. `noteKinds` is
   * parallel to it — the panel counts the skips alone, so an adaptation that
   * worked is never reported as a skipped step.
   */
  | { kind: "done"; notes?: string[]; noteKinds?: NoteKind[] };

export interface PlaybackHandle {
  /** Resolve the pending failure: continue with remaining steps or stop. */
  resolveFailure(action: "continue" | "stop"): void;
  cancel(): void;
}
