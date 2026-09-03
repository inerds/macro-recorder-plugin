import { describe, expect, it } from "vitest";

import {
  angleAround,
  clampVelocity,
  coastStep,
  COAST_STOP_DEG_PER_MS,
  MAX_DEG_PER_MS,
  shimmerOffset,
  SHIMMER_PER_DEG,
  tapeCounter,
  unwrapDelta,
} from "./spinPhysics";

const CENTER = { x: 100, y: 50 };

describe("angleAround", () => {
  it("uses screen coordinates: below the centre is +90 degrees", () => {
    // y grows downward, so atan2's positive direction is clockwise on
    // screen — which is also the sign the CSS `rotate` property uses.
    expect(angleAround(CENTER, { x: 100, y: 90 })).toBeCloseTo(90);
    expect(angleAround(CENTER, { x: 140, y: 50 })).toBeCloseTo(0);
    expect(angleAround(CENTER, { x: 100, y: 10 })).toBeCloseTo(-90);
  });

  it("is unaffected by distance from the centre", () => {
    expect(angleAround(CENTER, { x: 110, y: 60 })).toBeCloseTo(
      angleAround(CENTER, { x: 140, y: 90 }),
    );
  });
});

describe("unwrapDelta", () => {
  it("returns the plain difference well inside the seam", () => {
    expect(unwrapDelta(10, 25)).toBeCloseTo(15);
    expect(unwrapDelta(25, 10)).toBeCloseTo(-15);
  });

  it("takes the short way across +/-180", () => {
    expect(unwrapDelta(170, -170)).toBeCloseTo(20);
    expect(unwrapDelta(-170, 170)).toBeCloseTo(-20);
    expect(unwrapDelta(179.5, -179.5)).toBeCloseTo(1);
  });

  it("never returns more than half a turn", () => {
    const pairs: Array<[number, number]> = [
      [0, 359],
      [0, -359],
      [-1, 178],
      [90, -90],
      [-45, 200],
    ];
    for (const [prev, next] of pairs) {
      expect(Math.abs(unwrapDelta(prev, next))).toBeLessThanOrEqual(180);
    }
  });

  it("is stable across whole extra turns", () => {
    expect(unwrapDelta(10, 25 + 720)).toBeCloseTo(15);
    expect(unwrapDelta(10 - 360, 25)).toBeCloseTo(15);
  });
});

describe("dragging the left reel's bottom edge to the right", () => {
  it("turns the reels counter-clockwise, i.e. forward (negative)", () => {
    // The one direction fact the whole interaction rests on: this drag has
    // to move the reels the way playback does (`reel-ccw`: 0 -> -360deg).
    const from = angleAround(CENTER, { x: 100, y: 90 });
    const to = angleAround(CENTER, { x: 120, y: 90 });
    expect(unwrapDelta(from, to)).toBeLessThan(0);
  });
});

describe("coastStep", () => {
  it("decays monotonically toward zero and keeps its sign", () => {
    let v = 1.4;
    for (let i = 0; i < 200; i += 1) {
      const next = coastStep(v, 16);
      expect(Math.abs(next)).toBeLessThan(Math.abs(v));
      expect(Math.sign(next)).toBe(1);
      v = next;
    }
    expect(Math.abs(v)).toBeLessThan(COAST_STOP_DEG_PER_MS);
  });

  it("decays a backward spin the same way", () => {
    let v = -1.4;
    for (let i = 0; i < 200; i += 1) {
      v = coastStep(v, 16);
      expect(v).toBeLessThan(0);
    }
    expect(Math.abs(v)).toBeLessThan(COAST_STOP_DEG_PER_MS);
  });

  it("drops below the stop threshold from the fastest legal flick", () => {
    // 2.5 deg/ms with tau 650ms: ln(2.5/0.02) * 650 ~= 3.1s. The loop must
    // actually terminate, so pin the bound.
    let v = MAX_DEG_PER_MS;
    let elapsed = 0;
    while (Math.abs(v) >= COAST_STOP_DEG_PER_MS && elapsed < 10_000) {
      v = coastStep(v, 16);
      elapsed += 16;
    }
    expect(Math.abs(v)).toBeLessThan(COAST_STOP_DEG_PER_MS);
    expect(elapsed).toBeLessThan(4000);
  });

  it("is frame-rate independent: one long step equals many short ones", () => {
    const long = coastStep(1, 96);
    let short = 1;
    for (let i = 0; i < 6; i += 1) short = coastStep(short, 16);
    expect(long).toBeCloseTo(short, 10);
  });

  it("leaves the velocity alone across no time at all", () => {
    expect(coastStep(0.5, 0)).toBeCloseTo(0.5);
  });
});

describe("clampVelocity", () => {
  it("caps both directions at 2.5 deg/ms by default", () => {
    expect(clampVelocity(9)).toBe(2.5);
    expect(clampVelocity(-9)).toBe(-2.5);
    expect(clampVelocity(1.2)).toBe(1.2);
  });

  it("honours an explicit cap", () => {
    expect(clampVelocity(1.2, 0.5)).toBe(0.5);
  });

  it("treats a non-finite sample as a standstill", () => {
    // A pointermove in the same millisecond divides by zero; that must not
    // poison the coast loop with NaN or spin forever.
    expect(clampVelocity(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampVelocity(Number.NaN)).toBe(0);
  });
});

describe("tapeCounter", () => {
  it("is always four digits and counts up as tape plays forward (negative rotate)", () => {
    expect(tapeCounter(0)).toBe("0000");
    expect(tapeCounter(-6)).toBe("0001");
    expect(tapeCounter(-360)).toBe("0060");
  });

  it("counts down and wraps for a backward (clockwise) spin", () => {
    expect(tapeCounter(6)).toBe("9999");
    expect(tapeCounter(60)).toBe("9990");
    expect(tapeCounter(6 * 10001)).toBe("9999");
  });

  it("wraps rather than clamps at the top", () => {
    expect(tapeCounter(-6 * 9999)).toBe("9999");
    expect(tapeCounter(-6 * 10000)).toBe("0000");
    expect(tapeCounter(-6 * 10001)).toBe("0001");
  });

  it("does not render a negative zero", () => {
    expect(tapeCounter(0.4)).toBe("0000");
    expect(tapeCounter(1)).toBe("0000");
  });
});

describe("shimmerOffset", () => {
  it("runs the tape forward when the reels turn forward", () => {
    // Forward = negative rotate (`reel-ccw`) and forward tape = decreasing
    // dashoffset (`tape-run`: 0 -> -18). Same sign, so the shimmer travels
    // with the reels rather than against them.
    expect(shimmerOffset(-40)).toBeLessThan(0);
    expect(shimmerOffset(40)).toBeGreaterThan(0);
    expect(shimmerOffset(0)).toBe(0);
  });

  it("advances exactly one dash cycle per 40 degrees of reel", () => {
    expect(shimmerOffset(40)).toBeCloseTo(18);
    expect(shimmerOffset(-40)).toBeCloseTo(-18);
    expect(SHIMMER_PER_DEG).toBeCloseTo(0.45);
  });

  it("is linear, so a continuous drag never jumps the dashes", () => {
    expect(shimmerOffset(80) - shimmerOffset(40)).toBeCloseTo(
      shimmerOffset(40) - shimmerOffset(0),
    );
  });
});
