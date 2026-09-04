import { useEffect, useRef, type RefObject } from "react";

import {
  angleAround,
  clampVelocity,
  coastStep,
  COAST_STOP_DEG_PER_MS,
  shimmerOffset,
  tapeCounter,
  unwrapDelta,
  type Point,
} from "./spinPhysics";

export interface ReelSpinOptions {
  /** The `.deck-stage` element. The gesture lives on the whole stage. */
  stageRef: RefObject<HTMLDivElement | null>;
  /** Only while the reels are at rest — see `Deck.tsx`. */
  enabled: boolean;
  /**
   * The tape-counter digits while the reels are spinning, `null` when the
   * real step count owns the readout again. Called only when the digits
   * change, so React never re-renders per frame.
   */
  onCounter: (text: string | null) => void;
}

/** How much of a new velocity sample to believe. Low = smooth, laggy flick. */
const EMA_ALPHA = 0.4;

/**
 * Spin the reels by hand.
 *
 * A decorative easter egg, so it obeys the deck's own rules rather than
 * inventing new ones: it only runs while the CSS is NOT animating the reels
 * (idle or paused), it writes the same `rotate` property the keyframes write,
 * and it leaves through the same door — clearing its inline styles the moment
 * the deck starts moving tape again, so the animation resumes from 0.
 *
 * No React state per frame. The angle, the velocity and the rAF handle live
 * in refs and the reels are written to directly: at 60fps a re-render per
 * frame would repaint the whole panel to move two `rotate` values.
 */
export function useReelSpin({ stageRef, enabled, onCounter }: ReelSpinOptions): void {
  const angle = useRef(0);
  const velocity = useRef(0);
  const lastAngle = useRef(0);
  const lastTime = useRef(0);
  const center = useRef<Point>({ x: 0, y: 0 });
  const pointerId = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  const reels = useRef<SVGElement[]>([]);
  const shimmers = useRef<SVGElement[]>([]);
  const counter = useRef<string | null>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null || !enabled) return;

    const now = (): number => performance.now();

    const reduced = (): boolean =>
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const setCounter = (text: string | null): void => {
      if (counter.current === text) return;
      counter.current = text;
      onCounter(text);
    };

    /** Write the frame. The only place that touches the DOM per frame. */
    const paint = (): void => {
      const rotate = `${angle.current.toFixed(2)}deg`;
      for (const reel of reels.current) reel.style.rotate = rotate;
      const offset = String(shimmerOffset(angle.current).toFixed(2));
      for (const tape of shimmers.current) tape.style.strokeDashoffset = offset;
      setCounter(tapeCounter(angle.current));
    };

    const cancelCoast = (): void => {
      if (raf.current === null) return;
      cancelAnimationFrame(raf.current);
      raf.current = null;
    };

    /**
     * Hands the readout back and lets the shimmer fade out through its own
     * transition. The reels KEEP their angle: nothing is animating them, so
     * they stay where the hand left them, which is the whole reward.
     */
    const settle = (): void => {
      cancelCoast();
      velocity.current = 0;
      stage.removeAttribute("data-spinning");
      setCounter(null);
    };

    /**
     * Full reset, for when the deck takes the reels back (REC pressed
     * mid-coast) or the panel unmounts. The inline `rotate` has to go or the
     * CSS animation would start from wherever the spin stopped and the
     * keyframes' `from { rotate: 0deg }` would snap the reels.
     */
    const reset = (): void => {
      settle();
      angle.current = 0;
      pointerId.current = null;
      for (const reel of stage.querySelectorAll<SVGElement>(".reel")) {
        reel.style.removeProperty("rotate");
      }
      for (const tape of stage.querySelectorAll<SVGElement>(".tape-shimmer")) {
        tape.style.removeProperty("stroke-dashoffset");
      }
    };

    const coast = (): void => {
      const t = now();
      const dt = Math.min(64, Math.max(0, t - lastTime.current));
      lastTime.current = t;
      angle.current += velocity.current * dt;
      velocity.current = coastStep(velocity.current, dt);
      paint();
      if (Math.abs(velocity.current) < COAST_STOP_DEG_PER_MS) {
        settle();
        return;
      }
      raf.current = requestAnimationFrame(coast);
    };

    const stagePoint = (event: PointerEvent): Point => {
      const box = stage.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };

    const onPointerDown = (event: PointerEvent): void => {
      // Mouse: primary button only. Pen and touch report button 0 too.
      if (event.button !== 0) return;
      cancelCoast();

      // The reel elements and their centres are measured HERE, not at mount:
      // the stage rescales with the panel (and halves at the collapse
      // breakpoint), so a cached centre would be wrong by the first drag.
      reels.current = Array.from(stage.querySelectorAll<SVGElement>(".reel"));
      shimmers.current = Array.from(stage.querySelectorAll<SVGElement>(".tape-shimmer"));
      if (reels.current.length === 0) return;

      const box = stage.getBoundingClientRect();
      const p = stagePoint(event);
      let best: Point | null = null;
      let bestDist = Infinity;
      for (const reel of reels.current) {
        const r = reel.getBoundingClientRect();
        const c = {
          x: r.left + r.width / 2 - box.left,
          y: r.top + r.height / 2 - box.top,
        };
        const dist = Math.hypot(c.x - p.x, c.y - p.y);
        if (dist < bestDist) {
          bestDist = dist;
          best = c;
        }
      }
      if (best === null) return;

      // Both reels take the same delta — they are laced together by tape, so
      // turning one has to turn the other. Only the CENTRE the pointer's
      // angle is measured around is the nearest reel's.
      center.current = best;
      lastAngle.current = angleAround(best, p);
      lastTime.current = now();
      velocity.current = 0;
      pointerId.current = event.pointerId;
      stage.setPointerCapture(event.pointerId);
      stage.setAttribute("data-spinning", "true");
      paint();
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (pointerId.current !== event.pointerId) return;
      const p = stagePoint(event);
      const a = angleAround(center.current, p);
      const delta = unwrapDelta(lastAngle.current, a);
      lastAngle.current = a;
      angle.current += delta;

      const t = now();
      const dt = t - lastTime.current;
      if (dt > 0) {
        lastTime.current = t;
        const sample = clampVelocity(delta / dt);
        velocity.current = clampVelocity(
          velocity.current + EMA_ALPHA * (sample - velocity.current),
        );
      }
      paint();
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (pointerId.current !== event.pointerId) return;
      pointerId.current = null;
      if (stage.hasPointerCapture(event.pointerId)) {
        stage.releasePointerCapture(event.pointerId);
      }
      // Reduced motion: the reels follow the hand and stop with it. There is
      // no coast to watch, so there is nothing to suppress afterwards.
      if (reduced() || Math.abs(velocity.current) < COAST_STOP_DEG_PER_MS) {
        settle();
        return;
      }
      lastTime.current = now();
      raf.current = requestAnimationFrame(coast);
    };

    stage.addEventListener("pointerdown", onPointerDown);
    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerup", onPointerUp);
    stage.addEventListener("pointercancel", onPointerUp);

    return () => {
      stage.removeEventListener("pointerdown", onPointerDown);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerup", onPointerUp);
      stage.removeEventListener("pointercancel", onPointerUp);
      reset();
    };
  }, [stageRef, enabled, onCounter]);
}
