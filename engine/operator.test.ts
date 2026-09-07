import { describe, expect, it } from "vitest";

import { explicitFormulaOf, hasZeroComponent, operatorEligible, payloadClass } from "./operator";
import type { StepFormula, StepPayload } from "./steps";

const layer = { id: "L1", name: "Rect" };

function setStatic(
  path: (string | number)[],
  before: unknown,
  after: unknown,
  apply?: StepFormula,
): StepPayload {
  return {
    op: "set-static",
    path,
    before: before as never,
    after: after as never,
    layer,
    ...(apply ? { apply } : {}),
  };
}

describe("operatorEligible", () => {
  it("covers a layer's own transform paths and nothing deeper", () => {
    for (const p of ["position", "rotation", "skew", "skewAxis", "scale"]) {
      expect(operatorEligible([p])).toBe(true);
    }
    expect(operatorEligible(["opacity"])).toBe(false);
    expect(operatorEligible(["shapes", 0, "position"])).toBe(false);
    expect(operatorEligible(["fills", 0, "color"])).toBe(false);
    expect(operatorEligible([])).toBe(false);
  });
});

describe("payloadClass", () => {
  it("keeps the path's class by default: position shifts, scale scales", () => {
    expect(payloadClass(setStatic(["position"], { x: 0, y: 0 }, { x: 10, y: 0 }))).toBe("additive");
    expect(payloadClass(setStatic(["rotation"], 0, 45))).toBe("additive");
    expect(payloadClass(setStatic(["skew"], 0, 12))).toBe("additive");
    expect(payloadClass(setStatic(["scale"], { x: 100, y: 100 }, { x: 200, y: 200 }))).toBe(
      "multiplicative",
    );
  });

  it("reads a recorded identity as a reset — absolute", () => {
    expect(payloadClass(setStatic(["rotation"], 45, 0))).toBe("absolute");
    expect(payloadClass(setStatic(["skew"], 12, 0))).toBe("absolute");
    expect(payloadClass(setStatic(["skewAxis"], 30, 0))).toBe("absolute");
    expect(payloadClass(setStatic(["scale"], { x: 50, y: 50 }, { x: 100, y: 100 }))).toBe(
      "absolute",
    );
  });

  it("does not treat a partial identity, a position, or a keyframe pose as a reset", () => {
    expect(payloadClass(setStatic(["scale"], { x: 50, y: 50 }, { x: 100, y: 50 }))).toBe(
      "multiplicative",
    );
    expect(payloadClass(setStatic(["position"], { x: 5, y: 5 }, { x: 0, y: 0 }))).toBe("additive");
    const kf: StepPayload = {
      op: "keyframes",
      path: ["rotation"],
      added: [{ frame: 0, value: 0 }],
      removed: [],
      changed: [],
      layer,
    };
    expect(payloadClass(kf)).toBe("additive");
  });

  it("makes an explicit formula absolute — it reads the live value itself", () => {
    // Nothing to track: the applier evaluates the formula against whatever
    // the target holds at apply time, so a frozen origin would be noise.
    expect(
      payloadClass(
        setStatic(
          ["position"],
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: { scale: 1, offset: 10 }, y: { scale: 1, offset: 0 } },
        ),
      ),
    ).toBe("absolute");
    expect(payloadClass(setStatic(["rotation"], 45, 0, { scale: 1, offset: -45 }))).toBe(
      "absolute",
    );
    expect(
      payloadClass(
        setStatic(["scale"], { x: 100, y: 100 }, { x: 200, y: 200 }, { scale: 2, offset: 0 }),
      ),
    ).toBe("absolute");
    const kf: StepPayload = {
      op: "keyframes",
      path: ["rotation"],
      added: [{ frame: 0, value: 0 }],
      removed: [],
      changed: [],
      layer,
      apply: { scale: 1, offset: 10 },
    };
    expect(payloadClass(kf)).toBe("absolute");
  });

  it("resolves a multiply from a 0 start to absolute", () => {
    // No ratio exists from 0, and `computeTarget` writes the recorded value
    // for a zero origin — so absolute is what the step actually replays with.
    expect(payloadClass(setStatic(["scale"], { x: 0, y: 100 }, { x: 50, y: 200 }))).toBe(
      "absolute",
    );
    // A start with no zero component keeps its ratio.
    expect(payloadClass(setStatic(["scale"], { x: 50, y: 100 }, { x: 50, y: 200 }))).toBe(
      "multiplicative",
    );
    // The zero-start rule belongs to scale: a position still shifts.
    expect(payloadClass(setStatic(["position"], { x: 0, y: 0 }, { x: 9, y: 9 }))).toBe("additive");
  });

  it("falls back to the path's class outside a layer's own transform", () => {
    expect(payloadClass(setStatic(["opacity"], 100, 50))).toBe("absolute");
    expect(payloadClass(setStatic(["shapes", 0, "size"], { x: 1 }, { x: 2 }))).toBe("absolute");
    expect(
      payloadClass({ op: "set-plain", path: ["visible"], before: true, after: false, layer }),
    ).toBe("absolute");
    expect(payloadClass({ op: "remove-layer", layer })).toBe("absolute");
  });
});

describe("hasZeroComponent", () => {
  it("flags a ratio that would be undefined", () => {
    expect(hasZeroComponent(0)).toBe(true);
    expect(hasZeroComponent(45)).toBe(false);
    expect(hasZeroComponent({ x: 100, y: 0 })).toBe(true);
    expect(hasZeroComponent({ x: 100, y: 100 })).toBe(false);
    expect(hasZeroComponent("n/a")).toBe(false);
  });
});

describe("explicitFormulaOf", () => {
  const layer = { id: "L1", name: "Rect" };
  const step = (apply: unknown, before: unknown = 45, after: unknown = 0): StepPayload =>
    ({ op: "set-static", path: ["rotation"], before, after, layer, apply }) as StepPayload;

  it("passes a term or a per-component record through, and drops junk", () => {
    expect(explicitFormulaOf(step({ scale: 2, offset: 1 }))).toEqual({ scale: 2, offset: 1 });
    expect(explicitFormulaOf(step({ x: { scale: 1, offset: 5 } }))).toEqual({
      x: { scale: 1, offset: 5 },
    });
    expect(explicitFormulaOf(step(undefined))).toBeUndefined();
    expect(explicitFormulaOf(step(null))).toBeUndefined();
    expect(explicitFormulaOf(step(42))).toBeUndefined();
    expect(explicitFormulaOf(step({ scale: "2" }))).toBeUndefined();
    expect(explicitFormulaOf(step("nonsense"))).toBeUndefined();
  });

  it("reads the first cut's strings as the formula they meant", () => {
    expect(explicitFormulaOf(step("exact"))).toEqual({ scale: 0, offset: 0 });
    expect(explicitFormulaOf(step("add"))).toEqual({ scale: 1, offset: -45 });
    expect(explicitFormulaOf(step("multiply", 50, 100))).toEqual({ scale: 2, offset: 0 });
    expect(explicitFormulaOf(step("multiply", 0, 100))).toEqual({ scale: 0, offset: 100 });
    expect(explicitFormulaOf(step("add", { x: 10, y: 20 }, { x: 30, y: 20 }))).toEqual({
      x: { scale: 1, offset: 20 },
      y: { scale: 1, offset: 0 },
    });
    // A keyframes step never carried a meaningful string; it replays by class.
    expect(
      explicitFormulaOf({
        op: "keyframes",
        path: ["rotation"],
        added: [],
        removed: [],
        changed: [],
        layer,
        apply: "exact" as never,
      }),
    ).toBeUndefined();
    expect(payloadClass(step("add"))).toBe("absolute");
  });
});
