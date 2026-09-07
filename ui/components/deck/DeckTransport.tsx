import { Button, cn } from "@lottiefiles/creator-plugins-ui";
import type { ReactNode } from "react";

import type { ScopeReport } from "../../../engine/protocol";
import { isExactActivation, isExactModifier, useExactModifierHover } from "../recordModifier";
import { scopeName } from "../scopeText";
import { deckCountLabel, deckLabel, deckLamp, type DeckState } from "./deckState";
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
  recordDisabled: boolean;
  stopDisabled: boolean;
  /**
   * `exact` reports the Option/Alt modifier the press carried — the key that
   * reads the modifier is the key that starts the recording, so the two can
   * never disagree.
   */
  onRecord: (options: { exact: boolean }) => void;
  onStop: () => void;
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
 * Everything lives on the dark chassis: lamp + state word, the two keys, and
 * a recessed readout. There is no second strip above the window — the word it
 * used to carry now sits beside the keys, where it costs no extra row.
 */
export function DeckTransport({
  state,
  stepCount,
  counterOverride = null,
  startedAt,
  scope = null,
  scopePhase = null,
  stage,
  recordDisabled,
  stopDisabled,
  onRecord,
  onStop,
  recordingExact = false,
}: DeckTransportProps) {
  const elapsed = useElapsed(startedAt);
  // Blue under the modifier, and blue for the whole session once an exact
  // recording runs: the key says what the next press will do, then what the
  // running recording IS doing.
  const exactModifier = useExactModifierHover();
  const exact = recordingExact || exactModifier.held;
  const lamp = deckLamp(state);
  // Blank on every other screen: a review sheet and a running macro have no
  // scope to state, and a caption that keeps the last one would be a lie.
  const readout = scope && scopePhase ? scopeCaption(scope, scopePhase) : null;

  return (
    <>
      {/* The window is cut INTO the faceplate: the bezel is the chassis
          material, so there is no second card edge to pay for. */}
      <div className="deck-window">
        {stage}
        {/* The clock is mounted on the faceplate between the reels, where a
            deck's counter actually lives. It is the one readout that only
            exists while tape runs, and it is the reason the row would not
            fit: "RECORDING" and a running clock cannot share 274px with two
            keys and a counter. Outside the stage, so never aria-hidden. */}
      </div>

      <div className="deck-row">
        {/* Status sits in the row's first track and the clock in its third,
            both 1fr, so the key pair in the middle `auto` track stays centred
            on the chassis no matter how wide either readout gets. Not a live
            region: the state label repeats what the toasts already say. It
            is, however, the whole story under prefers-reduced-motion —
            never aria-hidden. */}
        <span className="deck-status">
          <span className="lamp" data-on={lamp ?? "off"} aria-hidden />
          <span className="deck-word">{deckLabel(state)}</span>
        </span>

        {/* Both keys in one grid so they are exactly equal width whatever
            their labels say. */}
        <span className="deck-keys">
          <Button
            size="sm"
            className={cn("key-plate", exact ? "key-plate-blue" : "key-plate-red")}
            aria-label="Record"
            data-testid="record-button"
            data-exact={exact ? "true" : undefined}
            disabled={recordDisabled}
            {...exactModifier.handlers}
            onClick={(event) => onRecord({ exact: isExactModifier(event) })}
            // A keyboard press has to carry the modifier too. The default
            // activation would fire its own click, so an exact activation
            // takes the press here and cancels it.
            onKeyDown={(event) => {
              if (!isExactActivation(event)) return;
              event.preventDefault();
              onRecord({ exact: true });
            }}
          >
            {/* The faceplate legend is the abbreviation a deck actually
                wears. The accessible name stays the full word via
                aria-label, so screen readers still hear "Record". */}
            REC
          </Button>
          <Button
            size="sm"
            className="key-plate"
            aria-label="Stop"
            data-testid="stop-button"
            disabled={stopDisabled}
            onClick={onStop}
          >
            Stop
          </Button>
        </span>

        {/* One recessed window for both readouts, the way a deck's counter
            pane carries time and count together. Sits in the row's trailing
            track so it lines up with the keys instead of floating in a
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
          docs/design-system.md): the legend holds its width and the layer
          name ellipsises, and the row keeps its 13px whether or not it has
          anything to say. */}
      <p className="deck-scope" {...(readout?.title ? { title: readout.title } : {})}>
        {readout && (
          <>
            <span className="deck-word deck-scope-legend" aria-hidden>
              {readout.legend} ·
            </span>
            <span className="deck-word deck-scope-value" aria-hidden>
              {readout.value}
            </span>
            {/* The two spans above are a caption abbreviated to fit a
                faceplate; this is the sentence they abbreviate. */}
            <span className="sr-only">{readout.label}</span>
          </>
        )}
      </p>
    </>
  );
}

/** The caption's three strings: the legend, the value, and what it says. */
function scopeCaption(
  scope: ScopeReport,
  phase: "idle" | "recording",
): { legend: string; value: string; label: string; title?: string } {
  const value = scopeName(scope);
  // "whole scene" is a noun phrase on the faceplate and a sentence to a
  // screen reader, which needs the article the legend has no room for.
  const spoken = scope.kind === "scene" ? "the whole scene" : value;
  return {
    legend: phase === "idle" ? "Records" : "Recording",
    value,
    label: phase === "idle" ? `Record will watch ${spoken}` : `Recording ${spoken}`,
    ...(scope.kind === "scene" && scope.fallback === "unresolved" ? { title: FALLBACK_TITLE } : {}),
  };
}
