import { useEffect, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";

/**
 * The modifier that turns a recording into an exact-values recording: Option
 * on macOS, Alt on Windows and Linux. Both arrive as `altKey`.
 *
 * The pure test is one line on purpose — every entry point (a click, a
 * keypress, a hover) asks the same question of whatever event it holds, so a
 * key that lights blue and a recording that stamps exact values can never
 * disagree about what the user was holding.
 */
export function isExactModifier(event: { altKey: boolean }): boolean {
  return event.altKey === true;
}

/** Handlers a key spreads to report whether the modifier is held over it. */
export interface ExactModifierHandlers {
  onMouseEnter: (event: ReactMouseEvent<HTMLElement>) => void;
  onMouseMove: (event: ReactMouseEvent<HTMLElement>) => void;
  onMouseLeave: () => void;
}

export interface ExactModifierHover {
  /** The pointer is over the key AND the modifier is down. */
  held: boolean;
  handlers: ExactModifierHandlers;
}

/**
 * Whether the exact-values modifier is held over a key, for the key that
 * changes colour under it.
 *
 * Two sources, because neither is enough on its own. A plugin runs in an
 * iframe, and an iframe gets key events only while it has focus — a user who
 * has just clicked in Creator's canvas and then presses Option sends this
 * panel nothing. Every pointer event carries `altKey` whatever has focus, so
 * the pointer is the reliable source and the `keydown`/`keyup` pair is what
 * catches a modifier pressed while the pointer already rests on the key.
 *
 * The key listeners are bound only while the pointer is over the key: a
 * window-wide listener that runs all the time would re-render the deck on
 * every Option press anywhere in the panel.
 */
export function useExactModifierHover(): ExactModifierHover {
  const [hovering, setHovering] = useState(false);
  const [down, setDown] = useState(false);

  useEffect(() => {
    if (!hovering) return;
    const read = (event: globalThis.KeyboardEvent) => setDown(isExactModifier(event));
    // A window that loses focus never sends the keyup, so the key would stay
    // blue with nothing held.
    const clear = () => setDown(false);
    window.addEventListener("keydown", read);
    window.addEventListener("keyup", read);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", read);
      window.removeEventListener("keyup", read);
      window.removeEventListener("blur", clear);
    };
  }, [hovering]);

  return {
    held: hovering && down,
    handlers: {
      onMouseEnter: (event) => {
        setHovering(true);
        setDown(isExactModifier(event));
      },
      onMouseMove: (event) => setDown(isExactModifier(event)),
      onMouseLeave: () => {
        setHovering(false);
        setDown(false);
      },
    },
  };
}

/** True when a key's Enter or Space should start an exact recording. */
export function isExactActivation(event: ReactKeyboardEvent<HTMLElement>): boolean {
  return (event.key === "Enter" || event.key === " ") && isExactModifier(event);
}
