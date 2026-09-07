import { describe, expect, it } from "vitest";

import { withExactApply } from "./exact";
import { explicitFormulaOf } from "./operator";
import { buildStep, type StepPayload } from "./steps";

function stepFor(payload: StepPayload) {
  return buildStep(payload);
}

const LAYER = { id: "L1", name: "Layer A" } as const;

describe("withExactApply", () => {
  it("pins a scalar transform to its recorded end value", () => {
    const step = stepFor({
      op: "set-static",
      path: ["rotation"],
      before: 10,
      after: 45,
      layer: LAYER,
    });
    const exact = withExactApply(step);
    expect(exact).not.toBe(step);
    expect(explicitFormulaOf(exact.payload as StepPayload)).toEqual({ scale: 0, offset: 45 });
  });

  it("pins every component of a vector transform", () => {
    const step = stepFor({
      op: "set-static",
      path: ["position"],
      before: { x: 100, y: 20 },
      after: { x: 160, y: 20 },
      layer: LAYER,
    });
    const exact = withExactApply(step);
    expect(explicitFormulaOf(exact.payload as StepPayload)).toEqual({
      x: { scale: 0, offset: 160 },
      y: { scale: 0, offset: 20 },
    });
  });

  it("relabels the step in the arrow form the exact value replays as", () => {
    // The relative default prints the operator form ("position.x +60"), which
    // says the opposite of what an exact step does to its target.
    const step = stepFor({
      op: "set-static",
      path: ["position"],
      before: { x: 100, y: 20 },
      after: { x: 160, y: 20 },
      layer: LAYER,
    });
    expect(step.label).toContain("+60");
    const exact = withExactApply(step);
    expect(exact.label).toContain("→");
    expect(exact.label).not.toContain("+60");
  });

  it("returns the same object for a path a formula cannot reach", () => {
    // A fill is not a layer transform, so there is no "exact" to record.
    const step = stepFor({
      op: "set-static",
      path: ["fills", 0, "color"],
      before: { r: 0, g: 0, b: 0 },
      after: { r: 255, g: 0, b: 0 },
      layer: LAYER,
    });
    expect(withExactApply(step)).toBe(step);
  });

  it("returns the same object for an opacity step", () => {
    // Opacity is already absolute; only the five transform paths are eligible.
    const step = stepFor({
      op: "set-static",
      path: ["opacity"],
      before: 100,
      after: 50,
      layer: LAYER,
    });
    expect(withExactApply(step)).toBe(step);
  });

  it("leaves a keyframes step alone", () => {
    // The keyframes are the motion; "exact" says nothing about a curve.
    const step = stepFor({
      op: "keyframes",
      path: ["position"],
      added: [{ frame: 0, value: { x: 0, y: 0 } }],
      removed: [],
      changed: [],
      layer: LAYER,
    });
    expect(withExactApply(step)).toBe(step);
  });

  it("leaves a step that already carries its own formula alone", () => {
    const step = stepFor({
      op: "set-static",
      path: ["rotation"],
      before: 10,
      after: 45,
      apply: { scale: 2, offset: 0 },
      layer: LAYER,
    });
    expect(withExactApply(step)).toBe(step);
  });

  it("leaves a step whose end value is not numeric alone", () => {
    const step = stepFor({
      op: "set-static",
      path: ["position"],
      before: null,
      after: null,
      layer: LAYER,
    });
    expect(withExactApply(step)).toBe(step);
  });

  it("leaves a step with no payload op alone", () => {
    // Mock steps carry an opaque payload; the stamp must not throw on one.
    const step = { id: "s1", kind: "transform" as const, label: "Step", payload: {} };
    expect(withExactApply(step)).toBe(step);
  });
});
