import { describe, expect, it } from "vitest";

import { paceDelayMs, SETTLE_MS } from "./pacing";

describe("paceDelayMs", () => {
  it("holds the slowest dwell for short macros", () => {
    expect(paceDelayMs(1)).toBe(300);
    expect(paceDelayMs(3)).toBe(300);
    expect(paceDelayMs(5)).toBe(300);
    // 1500 / 5 === 300 exactly — the last count before the budget bites;
    // 15 steps now walk in 1.5s at 100ms each.
    expect(paceDelayMs(15)).toBe(100);
  });

  it("spends the run budget once the macro is long enough", () => {
    expect(paceDelayMs(10)).toBe(150);
    expect(paceDelayMs(30)).toBe(50);
    expect(paceDelayMs(60)).toBe(25);
  });

  it("floors at 20ms so a capture-sized macro stays watchable", () => {
    expect(paceDelayMs(75)).toBe(20);
    expect(paceDelayMs(198)).toBe(20);
    expect(paceDelayMs(1000)).toBe(20);
  });

  it("is zero when there is nothing to play", () => {
    expect(paceDelayMs(0)).toBe(0);
    expect(paceDelayMs(-3)).toBe(0);
  });

  it("never speeds up as the macro gets shorter", () => {
    let previous = paceDelayMs(1);
    for (let n = 2; n <= 400; n++) {
      const delay = paceDelayMs(n);
      expect(delay).toBeLessThanOrEqual(previous);
      previous = delay;
    }
  });

  it("exports a settle beat longer than the fastest dwell", () => {
    expect(SETTLE_MS).toBeGreaterThan(paceDelayMs(198));
  });
});
