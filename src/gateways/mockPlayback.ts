import type { Macro, StepResult } from "../types";
import type { PlaybackGateway, PlaybackRun } from "./types";

export type PlaybackScenario = "pass" | "fail-step-3" | "no-selection";

/**
 * Replays a macro with scripted timing and failure scenarios so playback
 * states are demonstrable without the Creator API.
 */
export class MockPlaybackGateway implements PlaybackGateway {
  private scenario: PlaybackScenario;
  private stepMs: number;

  constructor(scenario: PlaybackScenario = "pass", stepMs = 500) {
    this.scenario = scenario;
    this.stepMs = stepMs;
  }

  setScenario(scenario: PlaybackScenario) {
    this.scenario = scenario;
  }

  run(macro: Macro, onEvent: (event: StepResult) => void): PlaybackRun {
    let cancelled = false;
    let pendingFailure: ((action: "continue" | "stop") => void) | null = null;
    const scenario = this.scenario;
    const stepMs = this.stepMs;

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

      for (let i = 0; i < macro.steps.length; i++) {
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
