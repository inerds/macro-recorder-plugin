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
}

export interface PlaybackRun {
  /** Resolve a pending step failure. */
  resolveFailure(action: "continue" | "stop"): void;
  cancel(): void;
}

/** Replays a macro against the current selection. */
export interface PlaybackGateway {
  run(macro: Macro, onEvent: (event: StepResult) => void): PlaybackRun;
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
