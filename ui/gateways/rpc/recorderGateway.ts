import { RPC_ERRORS, type CaptureOffer } from "../../../engine/protocol";
import { trace } from "../../dev/trace";
import type { MacroStep } from "../../types";
import type { RecorderGateway, RecordingSource } from "../types";
import type { RpcClient } from "./bridge";

const TICK_MS = 500;

export class RpcRecorderGateway implements RecorderGateway {
  private rpc: RpcClient;
  private stepListeners = new Set<(step: MacroStep) => void>();
  private endedListeners = new Set<(message: string) => void>();
  private offerListeners = new Set<(offer: CaptureOffer | null) => void>();
  private selectionListeners = new Set<(count: number) => void>();
  private lastSelectionCount: number | null = null;
  /** JSON of the last emitted offer — the tick recomputes a structurally
   *  identical offer every 500ms and re-emitting would re-render at 2Hz. */
  private lastOfferJson: string | null = null;
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
      source = {
        nodeId: result.nodeId,
        ...(result.nodeName ? { nodeName: result.nodeName } : {}),
        ...(typeof result.selectionCount === "number"
          ? { selectionCount: result.selectionCount }
          : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        message === RPC_ERRORS.noSelection
          ? "Open a scene first — recording needs an active scene."
          : message,
      );
    }
    this.active = true;
    this.seq = 0;
    // A stale in-flight tick can emit past stop()'s null; without this
    // reset the dedupe would swallow an identical offer next session.
    this.lastOfferJson = null;
    this.lastSelectionCount = null;
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
      this.emitOffer(result.captureOffer ?? null);
      if (typeof result.selectionCount === "number" && result.selectionCount !== this.lastSelectionCount) {
        this.lastSelectionCount = result.selectionCount;
        this.selectionListeners.forEach((cb) => cb(result.selectionCount as number));
      }
      if (this.active) this.scheduleTick();
    } catch (error) {
      if (!this.active) return;
      this.active = false;
      this.clearTimer();
      const raw = error instanceof Error ? error.message : String(error);
      const message =
        raw === RPC_ERRORS.nodeGone
          ? "Recording stopped — the scene is no longer available."
          : `Recording stopped — ${raw}`;
      this.endedListeners.forEach((cb) => cb(message));
    }
  }

  async stop(): Promise<MacroStep[]> {
    this.active = false;
    this.clearTimer();
    this.emitOffer(null);
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
    this.emitOffer(null);
    void this.rpc.call("record.discard", {}).catch(() => {});
  }

  async captureKeyframes(layerId: string, scope: "all" | "selected"): Promise<MacroStep[]> {
    const result = await this.rpc.call("record.captureKeyframes", { layerId, scope });
    return result.steps;
  }

  onStep(callback: (step: MacroStep) => void): () => void {
    this.stepListeners.add(callback);
    return () => this.stepListeners.delete(callback);
  }

  onEnded(callback: (message: string) => void): () => void {
    this.endedListeners.add(callback);
    return () => this.endedListeners.delete(callback);
  }

  onSelectionCount(callback: (count: number) => void): () => void {
    this.selectionListeners.add(callback);
    return () => this.selectionListeners.delete(callback);
  }

  onCaptureOffer(callback: (offer: CaptureOffer | null) => void): () => void {
    this.offerListeners.add(callback);
    return () => this.offerListeners.delete(callback);
  }

  private emitOffer(offer: CaptureOffer | null): void {
    const json = offer === null ? null : JSON.stringify(offer);
    if (json === this.lastOfferJson) return;
    this.lastOfferJson = json;
    this.offerListeners.forEach((cb) => cb(offer));
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
