import { describe, expect, it } from "vitest";

import type { Json } from "./json";
import { computeTarget } from "./relative";
import { propClassOf } from "./snapshot";


describe("computeTarget — absolute short-circuits", () => {
  it("returns `after` verbatim for the absolute prop class", () => {
    {
      const propClass = "absolute" as const;
      expect(computeTarget(10, 100, 150, propClass)).toBe(150);
      expect(computeTarget({ x: 10, y: 20 }, { x: 100, y: 200 }, { x: 150, y: 260 }, propClass)).toEqual({
        x: 150,
        y: 260,
      });
    }
  });

  it("returns `after` for an absolute prop class even in relative mode", () => {
    expect(computeTarget(10, 100, 150, "absolute")).toBe(150);
    expect(
      computeTarget({ r: 0, g: 0, b: 0 }, { r: 1, g: 1, b: 1 }, { r: 255, g: 0, b: 0 }, "absolute"),
    ).toEqual({ r: 255, g: 0, b: 0 });
  });

  it("returns `after` when there is no baseline", () => {
    expect(computeTarget(undefined, 100, 150, "additive")).toBe(150);
    expect(computeTarget(undefined, 1, 1.5, "multiplicative")).toBe(1.5);
  });

  it("agrees with propClassOf for the paths that drive playback", () => {
    // Sanity check that the classes exercised here are the ones diff paths map to.
    expect(propClassOf(["position"])).toBe("additive");
    expect(propClassOf(["scale"])).toBe("multiplicative");
    expect(propClassOf(["opacity"])).toBe("absolute");
    expect(propClassOf(["fills", 0, "color"])).toBe("absolute");
  });
});

describe("computeTarget — additive", () => {
  it("applies the recorded delta to a scalar baseline", () => {
    expect(computeTarget(10, 100, 150, "additive")).toBe(60);
  });

  it("applies a negative delta", () => {
    expect(computeTarget(10, 100, 80, "additive")).toBe(-10);
  });

  it("applies the delta per component for a vector", () => {
    expect(
      computeTarget({ x: 10, y: 20 }, { x: 100, y: 200 }, { x: 150, y: 260 }, "additive"),
    ).toEqual({ x: 60, y: 80 });
  });

  it("does not mutate the recorded `after` value", () => {
    const after: Json = { x: 150, y: 260 };
    computeTarget({ x: 10, y: 20 }, { x: 100, y: 200 }, after, "additive");
    expect(after).toEqual({ x: 150, y: 260 });
  });
});

describe("computeTarget — multiplicative", () => {
  it("applies the recorded ratio to a scalar baseline", () => {
    expect(computeTarget(2, 1, 1.5, "multiplicative")).toBe(3);
  });

  it("applies the ratio per component for a vector", () => {
    expect(
      computeTarget({ x: 2, y: 4 }, { x: 1, y: 2 }, { x: 1.5, y: 1 }, "multiplicative"),
    ).toEqual({ x: 3, y: 2 });
  });

  it("falls back to `after` for a scalar origin of 0", () => {
    expect(computeTarget(2, 0, 5, "multiplicative")).toBe(5);
  });

  it("falls back to `after` only for the zero component of a vector", () => {
    expect(
      computeTarget({ x: 2, y: 2 }, { x: 0, y: 1 }, { x: 5, y: 1.5 }, "multiplicative"),
    ).toEqual({ x: 5, y: 3 });
  });
});

describe("computeTarget — fallbacks", () => {
  it("returns `after` when after is numeric but origin is not", () => {
    expect(computeTarget(10, { x: 1 }, 50, "additive")).toBe(50);
  });

  it("returns `after` when after is numeric but baseline is not", () => {
    expect(computeTarget({ x: 10 }, 100, 150, "additive")).toBe(150);
  });

  it("returns `after` when after is an object but origin is a number", () => {
    expect(computeTarget({ x: 10 }, 100, { x: 150 }, "additive")).toEqual({ x: 150 });
  });

  it("returns `after` when after is an object but baseline is a number", () => {
    expect(computeTarget(10, { x: 100 }, { x: 150 }, "additive")).toEqual({ x: 150 });
  });

  it("returns `after` verbatim for arrays and strings", () => {
    expect(computeTarget([1, 2], [0, 0], [3, 4], "additive")).toEqual([3, 4]);
    expect(computeTarget("a", "b", "c", "additive")).toBe("c");
    expect(computeTarget(null, null, null, "additive")).toBeNull();
  });

  it("passes non-numeric vector components through from `after`", () => {
    expect(
      computeTarget(
        { x: 10, y: 20 },
        { x: 100, y: "a" },
        { x: 150, y: "z" },
        "additive",
      ),
    ).toEqual({ x: 60, y: "z" });
  });

  it("passes through components missing from origin or baseline", () => {
    expect(
      computeTarget({ x: 10 }, { x: 100 }, { x: 150, y: 7 }, "additive"),
    ).toEqual({ x: 60, y: 7 });
  });

  it("ignores baseline components that `after` does not carry", () => {
    expect(
      computeTarget({ x: 10, y: 99 }, { x: 100, y: 99 }, { x: 150 }, "additive"),
    ).toEqual({ x: 60 });
  });
});
