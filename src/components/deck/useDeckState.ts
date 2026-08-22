import { useEffect, useReducer, useRef } from "react";

import {
  deriveDeckState,
  DONE_MS,
  REWIND_MS,
  type DeckFlags,
  type DeckInput,
  type DeckState,
} from "./deckState";

/**
 * Adds the two transient flags `deriveDeckState` needs.
 *
 * They live in a ref, not state: they are read at render time against
 * `Date.now()`, and the only reason a re-render is needed is the timeout that
 * ends the window. Keyed on the single boolean "is playing" rather than a
 * previous-mode ref, so React's double-invoked mount effects can't swallow an
 * edge.
 */
export function useDeckState(input: DeckInput): DeckState {
  const flags = useRef<DeckFlags>({ rewindUntil: 0, doneUntil: 0 });
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const played = useRef(false);
  const playing = input.mode === "playing";

  useEffect(() => {
    if (playing) {
      played.current = true;
      flags.current.rewindUntil = Date.now() + REWIND_MS;
      // The render that turned `playing` on had not seen the flag yet.
      bump();
      const timer = setTimeout(bump, REWIND_MS);
      return () => clearTimeout(timer);
    }
    // Not playing and never was in this mount: nothing to wind down.
    if (!played.current) return;
    played.current = false;
    flags.current.doneUntil = Date.now() + DONE_MS;
    bump();
    const timer = setTimeout(bump, DONE_MS);
    return () => clearTimeout(timer);
  }, [playing]);

  return deriveDeckState(input, flags.current, Date.now());
}
