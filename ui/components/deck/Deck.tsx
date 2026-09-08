import { useRef, useState } from "react";

import { useApp } from "../../state/AppContext";
import { DeckTransport } from "./DeckTransport";
import { ReelDeck } from "./ReelDeck";
import { useDeckState } from "./useDeckState";
import { useReelSpin } from "./useReelSpin";

/**
 * The deck is on EVERY screen: it is the panel's transport and its status
 * light at once, so recording never has to move its key somewhere else and
 * playback never has to borrow a row to say it is running.
 *
 * One chassis, not a card holding a plate. The hero element IS the dark
 * faceplate: the reel window is recessed into it and the transport row sits
 * on it. Two materials cost two paddings and a border each, and at a 300x520
 * Creator panel the hero cannot afford either.
 */
export function Deck() {
  const { state, actions } = useApp();
  const deckState = useDeckState({
    mode: state.mode,
    playbackError: state.mode === "playing" && state.playing.error !== null,
  });

  const stepCount =
    state.mode === "recording" || state.mode === "reviewing"
      ? state.steps.length
      : state.mode === "playing"
        ? Math.min(state.playing.currentStep + 1, state.playing.total)
        : 0;

  // The caption follows the APP mode, not the deck's: "done" is a decoration
  // that outlives a run by 900ms, and a scope caption under it would name
  // what Record will watch while the reels are still coasting.
  const scope =
    state.mode === "idle"
      ? (state.scopePreview?.scope ?? null)
      : state.mode === "recording"
        ? state.scope
        : null;

  // The reels can be spun by hand, but only while nothing else is turning
  // them: "idle" is the state whose word is "Ready", and "paused" holds the
  // reels still mid-run. Every other state animates `rotate` from CSS, and
  // two owners of one property is a fight, not a feature.
  const spinnable = deckState === "idle" || deckState === "paused";
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [spinCounter, setSpinCounter] = useState<string | null>(null);
  useReelSpin({ stageRef, enabled: spinnable, onCounter: setSpinCounter });

  return (
    <div className="deck-chassis" data-hero>
      <DeckTransport
        state={deckState}
        stepCount={stepCount}
        counterOverride={spinCounter}
        startedAt={state.mode === "recording" ? state.startedAt : null}
        scope={scope}
        scopePhase={
          state.mode === "idle" ? "idle" : state.mode === "recording" ? "recording" : null
        }
        stage={<ReelDeck state={deckState} stageRef={stageRef} interactive={spinnable} />}
        // One key, two jobs, and the mode decides which. A recording is only
        // reachable from rest, so mid-review or mid-playback the key is dead
        // rather than a second way to lose work; while a recording runs it is
        // live, because it IS the way out of one. A playback is stopped from
        // the row that plays it — the deck no longer carries a second Stop.
        toggleDisabled={state.mode !== "idle" && state.mode !== "recording"}
        // The Option/Alt modifier rides the press itself; the key that read
        // it is the key that starts the recording. A press that stops one
        // never asks.
        onToggle={(options) => {
          if (state.mode === "recording") actions.stopRecording();
          else actions.startRecording(options);
        }}
        recordingExact={state.mode === "recording" && state.exact}
      />
    </div>
  );
}
