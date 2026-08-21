import { RPC_ERRORS } from "../../../shared/protocol";
import { trace } from "../../dev/trace";
import type { MacroStep } from "../../types";
import type { RecorderGateway, RecordingSource } from "../types";
import type { RpcClient } from "./bridge";

const TICK_MS = 500;

export class RpcRecorderGateway implements RecorderGateway {
  private rpc: RpcClient;
  private stepListeners = new Set<(step: MacroStep) => void>();
  private endedListeners = new Set<(message: string) => void>();
  private active = false;
  private seq = 0;
  private timer: number | null = null;
  private inFlightTick: Promise<void> | null = null;

  constructor(rpc: RpcClient) {
    this.rpc = rpc;
  }

  async start(): Promise<RecordingSource | null> {
    let source: RecordingSource;
    try {
      const result = await this.rpc.call("record.start", { debug: trace.enabled });
      if (result.paintIntrospection) {
        trace.event("note", { paintIntrospection: result.paintIntrospection });
        console.info(
          "[macro-recorder] paint introspection:",
          JSON.stringify(result.paintIntrospection, null, 2),
        );
      }
      source = result.nodeName
        ? { nodeId: result.nodeId, nodeName: result.nodeName }
        : { nodeId: result.nodeId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        message === RPC_ERRORS.noSelection ? "Select a layer first" : message,
      );
    }
    this.active = true;
    this.seq = 0;
    this.scheduleTick();
    return source;
  }

  private scheduleTick(): void {
    this.clearTimer();
    this.timer = window.setTimeout(() => {
      this.inFlightTick = this.tick().finally(() => {
        this.inFlightTick = null;
      });
    }, TICK_MS);
  }

  private async tick(): Promise<void> {
    if (!this.active) return;
    const seq = ++this.seq;
    try {
      const result = await this.rpc.call("record.tick", { seq });
      if (result.seq !== this.seq) return;
      if (result.debug) {
        trace.event("step-recorded", {
          seq: result.seq,
          steps: result.steps,
          snapshots: result.debug,
        });
      }
      // Deliver even when stop() raced this tick: the sandbox has already
      // advanced its snapshot past these steps, so record.stop's final delta
      // will not repeat them — dropping them here would lose them for good.
      result.steps.forEach((step) => this.stepListeners.forEach((cb) => cb(step)));
      if (this.active) this.scheduleTick();
    } catch (error) {
      if (!this.active) return;
      this.active = false;
      this.clearTimer();
      const raw = error instanceof Error ? error.message : String(error);
      const message =
        raw === RPC_ERRORS.nodeGone
          ? "The recorded layer was deleted — recording stopped"
          : `Recording stopped — ${raw}`;
      this.endedListeners.forEach((cb) => cb(message));
    }
  }

  async stop(): Promise<MacroStep[]> {
    this.active = false;
    this.clearTimer();
    if (this.inFlightTick) await this.inFlightTick;
    try {
      const result = await this.rpc.call("record.stop", {});
      if (result.debug) {
        trace.event("step-recorded", {
          final: true,
          steps: result.steps,
          snapshots: result.debug,
        });
      }
      void trace.flush("record");
      return result.steps;
    } catch {
      void trace.flush("record-failed");
      return [];
    }
  }

  discard(): void {
    this.active = false;
    this.clearTimer();
    void this.rpc.call("record.discard", {}).catch(() => {});
  }

  onStep(callback: (step: MacroStep) => void): () => void {
    this.stepListeners.add(callback);
    return () => this.stepListeners.delete(callback);
  }

  onEnded(callback: (message: string) => void): () => void {
    this.endedListeners.add(callback);
    return () => this.endedListeners.delete(callback);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
