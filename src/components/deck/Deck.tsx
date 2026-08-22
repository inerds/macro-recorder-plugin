import { useApp } from "../../state/AppContext";
import { DeckTransport } from "./DeckTransport";
import { ReelDeck } from "./ReelDeck";
import { useDeckState } from "./useDeckState";

/**
 * The deck is on EVERY screen: it is the panel's transport and its status
 * light at once, so recording never has to move the Stop key somewhere else
 * and playback never has to borrow a row to say it is running.
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

  return (
    <div className="deck-chassis" data-hero>
      <DeckTransport
        state={deckState}
        stepCount={stepCount}
        startedAt={state.mode === "recording" ? state.startedAt : null}
        stage={<ReelDeck state={deckState} />}
        // Recording is only reachable from rest: mid-review or mid-playback
        // the key is dead, not a second way to lose work.
        recordDisabled={state.mode !== "idle"}
        stopDisabled={state.mode !== "recording"}
        onRecord={actions.startRecording}
        onStop={actions.stopRecording}
      />
    </div>
  );
}
