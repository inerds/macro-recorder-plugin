import type { Macro, StepResult } from "../types";
import { paceDelayMs, SETTLE_MS } from "./pacing";
import {
  enabledSteps,
  repeatCount,
  type PlaybackGateway,
  type PlaybackRun,
  type PlayOptions,
} from "./types";

export type PlaybackScenario = "pass" | "fail-step-3" | "no-selection";

/**
 * Replays a macro with scripted timing and failure scenarios so playback
 * states are demonstrable without the Creator API.
 */
export class MockPlaybackGateway implements PlaybackGateway {
  private scenario: PlaybackScenario;
  /** Explicit per-step timing; unset means the real run's pacing budget. */
  private stepMs?: number;

  constructor(scenario: PlaybackScenario = "pass", stepMs?: number) {
    this.scenario = scenario;
    this.stepMs = stepMs;
  }

  setScenario(scenario: PlaybackScenario) {
    this.scenario = scenario;
  }

  run(macro: Macro, onEvent: (event: StepResult) => void, options?: PlayOptions): PlaybackRun {
    const steps = enabledSteps(macro);
    const total = steps.length * repeatCount(options);
    let cancelled = false;
    let pendingFailure: ((action: "continue" | "stop") => void) | null = null;
    const scenario = this.scenario;
    // Demo mode must feel like Creator, so it walks on the same budget
    // (keyed on the ENABLED count, not the repeat-multiplied total, exactly
    // as the RPC gateway does). A constructor override still wins.
    const stepMs = this.stepMs ?? paceDelayMs(steps.length);

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    async function execute() {
      if (scenario === "no-selection") {
        onEvent({
          kind: "step-failed",
          stepIndex: 0,
          message: "Select a layer first",
        });
        // A pre-run failure can only be stopped.
        await new Promise<"continue" | "stop">((resolve) => {
          pendingFailure = resolve;
        });
        return;
      }

      for (let i = 0; i < total; i++) {
        if (cancelled) return;
        onEvent({ kind: "progress", stepIndex: i });
        await sleep(stepMs);
        if (cancelled) return;

        if (scenario === "fail-step-3" && i === 2) {
          onEvent({
            kind: "step-failed",
            stepIndex: i,
            message: "Property not available on this layer",
          });
          const action = await new Promise<"continue" | "stop">((resolve) => {
            pendingFailure = resolve;
          });
          pendingFailure = null;
          if (action === "stop" || cancelled) return;
          continue;
        }

        onEvent({ kind: "step-done", stepIndex: i });
      }
      if (cancelled) return;
      // Same settle beat as the real gateway — the last row reads as done
      // before the run does.
      await sleep(SETTLE_MS);
      if (!cancelled) onEvent({ kind: "done" });
    }

    void execute();

    return {
      resolveFailure(action) {
        pendingFailure?.(action);
      },
      cancel() {
        cancelled = true;
        pendingFailure?.("stop");
      },
    };
  }
}
