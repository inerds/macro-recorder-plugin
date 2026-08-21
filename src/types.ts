export type { Macro, MacroStep } from "../shared/macro";
export type { StepKind } from "../shared/steps";

export type StepResult =
  | { kind: "progress"; stepIndex: number }
  | { kind: "step-done"; stepIndex: number; notes?: string[] }
  | { kind: "step-failed"; stepIndex: number; message: string }
  /** notes: everything deliberately not applied across the whole run. */
  | { kind: "done"; notes?: string[] };

export interface PlaybackHandle {
  /** Resolve the pending failure: continue with remaining steps or stop. */
  resolveFailure(action: "continue" | "stop"): void;
  cancel(): void;
}
