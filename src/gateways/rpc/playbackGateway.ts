import { RPC_ERRORS } from "../../../shared/protocol";
import { trace } from "../../dev/trace";
import type { Macro, StepResult } from "../../types";
import type { PlaybackGateway, PlaybackRun } from "../types";
import type { RpcClient } from "./bridge";

export class RpcPlaybackGateway implements PlaybackGateway {
  private rpc: RpcClient;

  constructor(rpc: RpcClient) {
    this.rpc = rpc;
  }

  run(macro: Macro, onEvent: (event: StepResult) => void): PlaybackRun {
    const rpc = this.rpc;
    let cancelled = false;
    let failureResolver: ((action: "continue" | "stop") => void) | null = null;

    const awaitDecision = () =>
      new Promise<"continue" | "stop">((resolve) => {
        failureResolver = resolve;
      }).finally(() => {
        failureResolver = null;
      });

    async function loop(): Promise<void> {
      let begun = false;
      const allNotes: string[] = [];
      try {
        const begin = await rpc.call("playback.begin", {
          steps: macro.steps,
          ...(macro.source ? { sourceNodeId: macro.source.nodeId } : {}),
          debug: trace.enabled,
        });
        trace.setContext({ macro: { id: macro.id, name: macro.name } });
        begun = true;

        for (let index = 0; index < begin.total; index++) {
          if (cancelled) return;
          onEvent({ kind: "progress", stepIndex: index });
          const result = await rpc.call("playback.step", { index });
          if (cancelled) return;
          const stepNotes = (result.notes ?? []).map(
            (note) => `Step ${index + 1} · ${note.target}: ${note.message}`,
          );
          allNotes.push(...stepNotes);
          if (result.debug) {
            trace.event("playback-event", {
              index,
              step: macro.steps[index],
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
            onEvent({ kind: "step-failed", stepIndex: index, message });
            const action = await awaitDecision();
            if (action === "stop" || cancelled) return;
          } else {
            onEvent({ kind: "step-done", stepIndex: index, notes: stepNotes });
          }
        }
        if (!cancelled) onEvent({ kind: "done", notes: allNotes });
      } catch (error) {
        if (cancelled) return;
        const raw = error instanceof Error ? error.message : String(error);
        const message = raw === RPC_ERRORS.noSelection ? "Select a layer first" : raw;
        // Pre-run/hard failure: surface as a step-0 failure (the UI offers
        // only "OK" for step 0 before progress) and wait for dismissal.
        onEvent({ kind: "step-failed", stepIndex: 0, message });
        await awaitDecision();
      } finally {
        if (begun) void rpc.call("playback.end", {}).catch(() => {});
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
