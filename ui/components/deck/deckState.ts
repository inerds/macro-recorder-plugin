/**
 * What the deck is doing, derived from the app mode plus two transient flags.
 *
 * Deliberately NOT part of the reducer: `rewind` and `done` are decorations
 * with a stopwatch, and putting them in app state would mean the reducer had
 * modes that mean nothing to the rest of the panel.
 */
export type DeckState = "idle" | "recording" | "rewind" | "playing" | "paused" | "done";

/** The app modes the deck can see (mirrors AppState["mode"]). */
export type DeckMode = "idle" | "recording" | "reviewing" | "configuring" | "playing";

export interface DeckInput {
  mode: DeckMode;
  /** A step failed and playback is waiting for a Continue/Stop decision. */
  playbackError?: boolean;
}

export interface DeckFlags {
  /** Timestamp until which the reels spin backwards after a play starts. */
  rewindUntil: number;
  /** Timestamp until which the reels coast to a stop after a play ends. */
  doneUntil: number;
}

/**
 * Both windows are long enough to actually register — and both match the
 * `[data-deck]` animation durations in `index.css` exactly, or the reels stop
 * mid-turn. Rewind is two fast backwards revolutions (350ms x 2).
 */
export const REWIND_MS = 700;
export const DONE_MS = 900;

export function deriveDeckState(input: DeckInput, flags: DeckFlags, now: number): DeckState {
  if (input.mode === "recording") return "recording";
  if (input.mode === "playing") {
    // A paused run is not a stopped one: amber, and the reels hold still.
    if (input.playbackError === true) return "paused";
    if (now < flags.rewindUntil) return "rewind";
    return "playing";
  }
  if (now < flags.doneUntil) return "done";
  return "idle";
}

/** Which lamp is lit, or none. Red means the deck is moving tape. */
export function deckLamp(state: DeckState): "red" | "amber" | null {
  switch (state) {
    case "recording":
    case "rewind":
    case "playing":
      return "red";
    case "paused":
      return "amber";
    default:
      return null;
  }
}

/**
 * What the counter's four digits mean right now, in words. The digits are a
 * readout with no label of their own, and the one they used to carry said
 * "Steps captured" through a playback that captures nothing.
 */
export function deckCountLabel(state: DeckState, count: number): string {
  const steps = count === 1 ? "1 step" : `${count} steps`;
  switch (state) {
    case "recording":
      return `${steps} captured`;
    case "playing":
    case "rewind":
    case "paused":
      return `${steps} played`;
    default:
      return steps;
  }
}

/** The word on the panel. Under reduced motion this is the whole story. */
export function deckLabel(state: DeckState): string {
  switch (state) {
    case "recording":
      return "Recording";
    case "rewind":
      return "Rewind";
    case "playing":
      return "Playing";
    case "paused":
      return "Paused";
    case "done":
      return "Done";
    case "idle":
      return "Ready";
  }
}

/**
 * The word on the transport key. The key is ONE toggle: at rest it starts a
 * recording, and while a recording runs it is the way out of it. Every other
 * state reads "Record" behind a dead key — the deck is busy, and a key that
 * changed its word there would offer an action it does not have.
 */
export function deckToggleLabel(state: DeckState): "Record" | "Stop" {
  return state === "recording" ? "Stop" : "Record";
}
