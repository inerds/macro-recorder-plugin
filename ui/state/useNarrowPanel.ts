import { useEffect, useState } from "react";

/**
 * The width the rows' `@container panel (max-width: 262px)` rule fires at —
 * NOT the deck's 286px breakpoint, which is always on at Creator's 300px
 * window (the panel sits inside an 8px gutter, so it measures 284px there).
 * Kept in step with index.css: a menu item that stands in for a hidden
 * control has to appear exactly when the control disappears.
 */
const NARROW_PANEL_PX = 262;

/**
 * True while the panel is narrow enough that the closed rows drop their
 * play-options key. Menus render in a portal outside `.panel-root`, so a
 * container query can't reach them — the item that replaces the key has to
 * be gated in JS instead.
 */
export function useNarrowPanel(): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined" || typeof ResizeObserver !== "function") return;
    const root = document.querySelector<HTMLElement>(".panel-root");
    if (!root) return;
    const measure = () => setNarrow(root.getBoundingClientRect().width <= NARROW_PANEL_PX);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  return narrow;
}
