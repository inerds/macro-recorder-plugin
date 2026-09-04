import { RPC_ERRORS } from "../../../engine/protocol";
import { trace } from "../../dev/trace";
import type { Macro, StepResult } from "../../types";
import { paceDelayMs, SETTLE_MS } from "../pacing";
import {
  enabledSteps,
  repeatCount,
  type PlaybackGateway,
  type PlaybackRun,
  type PlayOptions,
} from "../types";
import type { RpcClient } from "./bridge";

export class RpcPlaybackGateway implements PlaybackGateway {
  private rpc: RpcClient;

  constructor(rpc: RpcClient) {
    this.rpc = rpc;
  }

  run(macro: Macro, onEvent: (event: StepResult) => void, options?: PlayOptions): PlaybackRun {
    const rpc = this.rpc;
    const steps = enabledSteps(macro);
    const repeats = repeatCount(options);
    // One budget for the whole run — see gateways/pacing.ts.
    const delay = paceDelayMs(steps.length);
    let cancelled = false;
    let failureResolver: ((action: "continue" | "stop") => void) | null = null;

    const sleep = (ms: number) =>
      ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

    const awaitDecision = () =>
      new Promise<"continue" | "stop">((resolve) => {
        failureResolver = resolve;
      }).finally(() => {
        failureResolver = null;
      });

    /** One begin/steps/end pass. Returns false when the run should stop. */
    async function pass(iteration: number, allNotes: string[]): Promise<boolean> {
      let begun = false;
      const offset = iteration * steps.length;
      try {
        const begin = await rpc.call("playback.begin", {
          steps,
          ...(macro.source ? { sourceNodeId: macro.source.nodeId } : {}),
          ...(options?.atPlayhead ? { atPlayhead: true } : {}),
          ...(options?.staggerFrames ? { staggerFrames: options.staggerFrames } : {}),
          // The sandbox delays a keyframe-free macro's layers on the first
          // pass only; absent means pass 0, so legacy payloads stay identical.
          ...(iteration > 0 ? { iteration } : {}),
          debug: trace.enabled,
        });
        trace.setContext({
          macro: { id: macro.id, name: macro.name },
          ...(repeats > 1 ? { iteration, repeats } : {}),
          ...(options ? { options } : {}),
        });
        begun = true;

        for (let index = 0; index < begin.total; index++) {
          if (cancelled) return false;
          onEvent({ kind: "progress", stepIndex: offset + index });
          // The dwell is "step selected, about to execute" — it belongs
          // BETWEEN the progress event and the call, so the row is lit while
          // the step runs. A sleep is an await like any other: Stop during it
          // must not fire the step it was waiting on.
          await sleep(delay);
          if (cancelled) return false;
          const result = await rpc.call("playback.step", { index });
          if (cancelled) return false;
          const stepNotes = (result.notes ?? []).map(
            (note) => `Step ${index + 1} · ${note.target}: ${note.message}`,
          );
          allNotes.push(...stepNotes);
          if (result.debug) {
            trace.event("playback-event", {
              index,
              iteration,
              step: steps[index],
              failures: result.failures,
              notes: result.notes ?? [],
              targets: result.debug,
            });
          }

          if (result.failures.length > 0) {
            const first = result.failures[0]!;
            const message =
              result.failures.length === 1
                ? `${first.target}: ${first.message}`
                : `${result.failures.length} of ${begin.targetCount} layers failed — ${first.message}`;
            onEvent({ kind: "step-failed", stepIndex: offset + index, message });
            // Flush before parking on the decision: an un-dismissed failure
            // banner must not hold the whole run's evidence hostage (the
            // buffered events would otherwise ride along into the NEXT
            // trace, or be lost with the panel).
            void trace.flush(`playback-${macro.name}`);
            const action = await awaitDecision();
            if (action === "stop" || cancelled) return false;
          } else {
            onEvent({ kind: "step-done", stepIndex: offset + index, notes: stepNotes });
          }
        }
        return !cancelled;
      } catch (error) {
        if (cancelled) return false;
        const raw = error instanceof Error ? error.message : String(error);
        const message = raw === RPC_ERRORS.noSelection ? "Select a layer first" : raw;
        // Pre-run/hard failure: surface as a step-0 failure (the UI offers
        // only "OK" for step 0 before progress) and wait for dismissal.
        onEvent({ kind: "step-failed", stepIndex: offset, message });
        // Same rule as mid-run failures: evidence lands before the wait.
        void trace.flush(`playback-${macro.name}`);
        await awaitDecision();
        return false;
      } finally {
        if (begun) await rpc.call("playback.end", {}).catch(() => {});
      }
    }

    async function loop(): Promise<void> {
      const allNotes: string[] = [];
      try {
        for (let iteration = 0; iteration < repeats; iteration++) {
          if (!(await pass(iteration, allNotes))) return;
        }
        if (cancelled) return;
        // The settle beat: the last row shows done before the run does.
        await sleep(SETTLE_MS);
        if (!cancelled) onEvent({ kind: "done", notes: allNotes });
      } finally {
        void trace.flush(`playback-${macro.name}`);
      }
    }

    void loop();

    return {
      resolveFailure(action) {
        failureResolver?.(action);
      },
      cancel() {
        cancelled = true;
        failureResolver?.("stop");
        void rpc.call("playback.end", {}).catch(() => {});
      },
    };
  }
}
