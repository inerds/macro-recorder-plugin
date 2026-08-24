import type { CaptureOffer } from "../../shared/protocol";
import type { Macro, MacroStep, StepResult } from "../types";

/** The layer a recording session captured. */
export interface RecordingSource {
  nodeId: string;
  nodeName?: string;
}

/** Emits recorded steps while the user edits the animation. */
export interface RecorderGateway {
  /**
   * Rejects with a user-facing message (e.g. nothing selected). Resolves the
   * recorded layer's identity (null in mock mode) so replay can fall back to
   * it when nothing is selected.
   */
  start(): Promise<RecordingSource | null>;
  /**
   * Stops recording and returns the FINAL DELTA — steps captured since the
   * last onStep emission (already-emitted steps are not repeated).
   */
  stop(): Promise<MacroStep[]>;
  discard(): void;
  onStep(callback: (step: MacroStep) => void): () => void;
  /** Fired when recording ends on its own (e.g. the node was deleted). */
  onEnded?(callback: (message: string) => void): () => void;
  /**
   * The standing offer to capture the selected layer's existing timeline
   * keyframes, re-evaluated per tick; null when it goes away. Emissions are
   * deduped by the gateway.
   */
  onCaptureOffer?(callback: (offer: CaptureOffer | null) => void): () => void;
  /** Synthesize keyframe steps from a layer's existing animation. */
  captureKeyframes?(layerId: string, scope: "all" | "selected"): Promise<MacroStep[]>;
}

export interface PlaybackRun {
  /** Resolve a pending step failure. */
  resolveFailure(action: "continue" | "stop"): void;
  cancel(): void;
}

/** Per-run choices made in the play-options popover. */
export interface PlayOptions {
  /** Slide keyframes so the macro's first one lands on the playhead. */
  atPlayhead?: boolean;
  /** Frames added per selected layer (cascade). */
  staggerFrames?: number;
  /** Run the whole macro this many times; offsets compound. */
  repeat?: number;
}

/**
 * Replays a macro against the current selection. Disabled steps are skipped
 * here (the sandbox only sees enabled ones) and `repeat` loops the run; the
 * events report indices into the ENABLED steps, offset by iteration.
 */
export interface PlaybackGateway {
  run(macro: Macro, onEvent: (event: StepResult) => void, options?: PlayOptions): PlaybackRun;
}

/** The steps a run actually sends to the engine. */
export function enabledSteps(macro: Macro): MacroStep[] {
  return macro.steps.filter((step) => step.disabled !== true);
}

/** Iterations a run performs for the given options (≥ 1). */
export function repeatCount(options?: PlayOptions): number {
  const n = options?.repeat;
  return typeof n === "number" && Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** Persists saved macros. localStorage standalone, creator.clientStorage in Creator. */
export interface MacroStore {
  list(): Promise<Macro[]>;
  save(macro: Macro): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Returns the imported macro (with regenerated ids). */
  importMacro(json: string): Promise<Macro>;
  exportMacro(macro: Macro): string;
}
