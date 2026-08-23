import { Button } from "@lottiefiles/creator-plugins-ui";
import { Square } from "lucide-react";
import type { ReactNode } from "react";

import { deckLabel, deckLamp, type DeckState } from "./deckState";
import { useElapsed } from "./useElapsed";

export interface DeckTransportProps {
  state: DeckState;
  /** Steps on the counter right now (captured, or played so far). */
  stepCount: number;
  /** Set only while recording — the clock runs from here. */
  startedAt: number | null;
  /** The reel stage, recessed into the chassis above the transport row. */
  stage: ReactNode;
  recordDisabled: boolean;
  stopDisabled: boolean;
  onRecord: () => void;
  onStop: () => void;
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
  startedAt,
  stage,
  recordDisabled,
  stopDisabled,
  onRecord,
  onStop,
}: DeckTransportProps) {
  const elapsed = useElapsed(startedAt);
  const lamp = deckLamp(state);

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
            className="key-plate key-plate-red"
            aria-label="Record"
            data-testid="record-button"
            disabled={recordDisabled}
            onClick={onRecord}
          >
            <span className="key-dot" aria-hidden>
              <span />
            </span>
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
            <Square className="fill-current" strokeWidth={2.5} aria-hidden />
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
          <span className="lcd-count" aria-label="Steps captured">
            {counterText(stepCount)}
          </span>
        </span>
      </div>
    </>
  );
}
