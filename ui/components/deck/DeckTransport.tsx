import { Button, cn } from "@lottiefiles/creator-plugins-ui";
import type { ReactNode } from "react";

import type { ScopeReport } from "../../../engine/protocol";
import { isExactActivation, isExactModifier, useExactModifierHover } from "../recordModifier";
import { scopeName } from "../scopeText";
import { deckCountLabel, deckLabel, deckLamp, deckToggleLabel, type DeckState } from "./deckState";
import { useElapsed } from "./useElapsed";

/** Said once, on the caption, when the selection resolved to nothing. */
const FALLBACK_TITLE =
  "The selection isn't in the active scene, so Record watches the whole scene.";

export interface DeckTransportProps {
  state: DeckState;
  /** Steps on the counter right now (captured, or played so far). */
  stepCount: number;
  /**
   * Four digits to show INSTEAD of the step count, set only while the reels
   * are being spun by hand. Decoration: the real count stays in the
   * accessible text, so the readout never lies to a screen reader.
   */
  counterOverride?: string | null;
  /** Set only while recording — the clock runs from here. */
  startedAt: number | null;
  /**
   * What Record will watch (idle) or is watching (recording), and which of
   * the two it is. Null in either place leaves the caption blank — the row
   * keeps its height, so nothing below it moves when the answer arrives.
   */
  scope?: ScopeReport | null;
  scopePhase?: "idle" | "recording" | null;
  /** The reel stage, recessed into the chassis above the transport row. */
  stage: ReactNode;
  /**
   * The deck is busy with something that is not a recording, so the one
   * transport key is dead. A running recording never sets this: the key is
   * the way out of it.
   */
  toggleDisabled: boolean;
  /**
   * The one transport key was pressed: start a recording at rest, stop the
   * one that runs. `exact` reports the Option/Alt modifier the press carried
   * — the key that reads the modifier is the key that starts the recording,
   * so the two can never disagree. A press that stops ignores it.
   */
  onToggle: (options: { exact: boolean }) => void;
  /** An exact-values recording is running: the key stays blue for the session. */
  recordingExact?: boolean;
}

/** The counter is a four-digit mechanical readout: it never changes width. */
function counterText(count: number): string {
  return String(Math.min(9999, Math.max(0, count))).padStart(4, "0");
}

/**
 * The window and the one row of controls under it.
 *
 * Everything lives on the dark chassis: lamp + state word, ONE transport key,
 * and a recessed readout. There is no second strip above the window — the
 * word it used to carry now sits beside the key, where it costs no extra row.
 */
export function DeckTransport({
  state,
  stepCount,
  counterOverride = null,
  startedAt,
  scope = null,
  scopePhase = null,
  stage,
  toggleDisabled,
  onToggle,
  recordingExact = false,
}: DeckTransportProps) {
  const elapsed = useElapsed(startedAt);
  // The one transport key is a toggle, so its word is the state's: "Record"
  // at rest, "Stop" while tape runs.
  const recording = state === "recording";
  const label = deckToggleLabel(state);
  // Blue under the modifier, and blue for the whole session once an exact
  // recording runs: the key says what the next press will do, then what the
  // running recording IS doing. The hover is read only while the key still
  // offers a recording — blue over a key that says Stop would promise exact
  // values to a press that only stops.
  const exactModifier = useExactModifierHover();
  const exact = recordingExact || (!recording && exactModifier.held);
  const lamp = deckLamp(state);
  // Blank on every other screen: a review sheet and a running macro have no
  // scope to state, and a caption that keeps the last one would be a lie.
  const readout = scope && scopePhase ? scopeCaption(scope, scopePhase, recordingExact) : null;

  return (
    <>
      {/* The window is cut INTO the faceplate: the bezel is the chassis
          material, so there is no second card edge to pay for. */}
      <div className="deck-window">
        {stage}
        {/* The clock is mounted on the faceplate between the reels, where a
            deck's counter actually lives. It is the one readout that only
            exists while tape runs, and it is the reason the row would not
            fit: "RECORDING" and a running clock cannot share 274px with a
            key and a counter. Outside the stage, so never aria-hidden. */}
      </div>

      <div className="deck-row">
        {/* Status sits in the row's first track and the clock in its third,
            both 1fr, so the one key in the middle `auto` track stays centred
            on the chassis no matter how wide either readout gets. Not a live
            region: the state label repeats what the toasts already say. It
            is, however, the whole story under prefers-reduced-motion —
            never aria-hidden. */}
        <span className="deck-status">
          <span className="lamp" data-on={lamp ?? "off"} aria-hidden />
          <span className="deck-word">{deckLabel(state)}</span>
        </span>

        {/* ONE key in the middle track, so the transport is centred on the
            chassis whatever the readouts beside it say. It is a toggle: the
            word, the accessible name, and what the press does all come from
            the same state, so the key can never say one thing and do
            another. The width is fixed (`.deck-toggle`) — a key that
            resized between "Record" and "Stop" would jump the moment it is
            pressed. */}
        <Button
          size="sm"
          className={cn("key-plate deck-toggle", exact ? "key-plate-blue" : "key-plate-red")}
          aria-label={label}
          data-testid="record-button"
          data-exact={exact ? "true" : undefined}
          disabled={toggleDisabled}
          {...exactModifier.handlers}
          onClick={(event) => onToggle({ exact: isExactModifier(event) })}
          // A keyboard press has to carry the modifier too. The default
          // activation would fire its own click, so an exact activation
          // takes the press here and cancels it. A key that says Stop has
          // no exact mode, so it keeps the default activation.
          onKeyDown={(event) => {
            if (recording || !isExactActivation(event)) return;
            event.preventDefault();
            onToggle({ exact: true });
          }}
        >
          {label}
        </Button>

        {/* One recessed window for both readouts, the way a deck's counter
            pane carries time and count together. Sits in the row's trailing
            track so it lines up with the key instead of floating in a
            corner of the faceplate. */}
        <span className="lcd">
          {startedAt !== null && (
            <span className="deck-clock" role="timer" aria-label="Recording time">
              {elapsed}
            </span>
          )}
          {/* The digits are decoration in both states — spinning the reels
              runs the counter like tape footage — so they are hidden and the
              adjacent text carries the count. An `aria-label` on this bare
              span named nothing: a span has no role to name, and the name it
              tried to give said "captured" all through playback. */}
          <span className="lcd-count">
            <span aria-hidden="true">
              {counterOverride === null ? counterText(stepCount) : counterOverride}
            </span>
            <span className="sr-only">{deckCountLabel(state, stepCount)}</span>
          </span>
        </span>
      </div>

      {/* What the key will do, before it is pressed. One real element in the
          silkscreen idiom (the hero's pseudo-element budget is spent — see
          docs/design-system.md): the name alone, centred under the key it
          belongs to, and the row keeps its 13px whether or not it has
          anything to say. The RECORDS · legend is gone — the key above it
          already says Record, and a word repeated under it read as a second
          control. */}
      <p className="deck-scope" {...(readout?.title ? { title: readout.title } : {})}>
        {readout && (
          <>
            <span className="deck-word deck-scope-value" aria-hidden>
              {readout.value}
            </span>
            {/* The span above is a name abbreviated to fit a faceplate; this
                is the sentence it abbreviates. */}
            <span className="sr-only">{readout.label}</span>
          </>
        )}
      </p>
    </>
  );
}

/** The caption's two strings: the name on the faceplate, and what it says. */
function scopeCaption(
  scope: ScopeReport,
  phase: "idle" | "recording",
  exact: boolean,
): { value: string; label: string; title?: string } {
  const value = scopeName(scope);
  // "whole scene" is a noun phrase on the faceplate and a sentence to a
  // screen reader, which needs the article the caption has no room for.
  const spoken = scope.kind === "scene" ? "the whole scene" : value;
  // The blue key is the only other place an exact recording says so on the
  // deck, and a colour says nothing out loud.
  const recording = exact ? `Recording ${spoken}, exact values` : `Recording ${spoken}`;
  return {
    value,
    label: phase === "idle" ? `Record will watch ${spoken}` : recording,
    ...(scope.kind === "scene" && scope.fallback === "unresolved" ? { title: FALLBACK_TITLE } : {}),
  };
}
