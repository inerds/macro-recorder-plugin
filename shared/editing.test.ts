import { describe, expect, it } from "vitest";

import { applyParamValues, editableValueOf, withEditedValue } from "./editing";
import type { Macro, MacroStep } from "./macro";
import { buildStep, type StepPayload } from "./steps";

const layer = { id: "L1", name: "Rect" };
const make = (payload: StepPayload): MacroStep => buildStep(payload);

describe("editableValueOf", () => {
  it("classifies number, boolean, text, color and vector values", () => {
    expect(editableValueOf(make({ op: "set-static", path: ["rotation"], before: 0, after: 45, layer })))
      .toEqual({ kind: "number", value: 45 });
    expect(editableValueOf(make({ op: "set-plain", path: ["visible"], before: true, after: false, layer })))
      .toEqual({ kind: "boolean", value: false });
    expect(editableValueOf(make({ op: "set-plain", path: ["blendMode"], before: "NORMAL", after: "SCREEN", layer })))
      .toEqual({ kind: "text", value: "SCREEN" });
    expect(
      editableValueOf(make({ op: "set-static", path: ["fills", 0, "color"], before: { r: 0, g: 0, b: 0 }, after: { r: 255, g: 0, b: 10 }, layer })),
    ).toEqual({ kind: "color", value: { r: 255, g: 0, b: 10 } });
    expect(editableValueOf(make({ op: "set-static", path: ["position"], before: { x: 0, y: 0 }, after: { x: 3, y: 4 }, layer })))
      .toEqual({ kind: "vector", value: { x: 3, y: 4 } });
  });

  it("offers a fresh add-layer's name but not a duplicate's, and never path data", () => {
    const spec = { nodeId: "n", nodeType: "CONTAINER", nodeName: "Star", props: {}, plain: {}, fills: [], strokes: [], masks: [], shapes: [] };
    expect(editableValueOf(make({ op: "add-layer", spec }))).toEqual({ kind: "text", value: "Star" });
    expect(editableValueOf(make({ op: "add-layer", spec, cloneOf: layer }))).toBeNull();
    expect(
      editableValueOf(make({ op: "set-static", path: ["shapes", 0, "pathData"], before: null, after: { points: [], closed: true }, layer })),
    ).toBeNull();
    expect(editableValueOf(make({ op: "keyframes", path: ["rotation"], added: [], removed: [], changed: [], layer }))).toBeNull();
    expect(editableValueOf({ id: "m", kind: "other", label: "mock", payload: "opaque" })).toBeNull();
  });
});

describe("withEditedValue", () => {
  it("replaces `after` and rebuilds the label", () => {
    const step = make({ op: "set-static", path: ["position"], before: { x: 0, y: 0 }, after: { x: 3, y: 0 }, layer });
    const edited = withEditedValue(step, { kind: "vector", value: { x: 50, y: 0 } });
    expect(edited.id).toBe(step.id);
    expect(edited.payload).toMatchObject({ after: { x: 50, y: 0 }, before: { x: 0, y: 0 } });
    expect(edited.label).toBe("Rect · Transform · position.x 0 → 50");
    expect(step.payload).toMatchObject({ after: { x: 3, y: 0 } });
  });

  it("renames an add-layer spec", () => {
    const spec = { nodeId: "n", nodeType: "CONTAINER", nodeName: "Star", props: {}, plain: {}, fills: [], strokes: [], masks: [], shapes: [] };
    const edited = withEditedValue(make({ op: "add-layer", spec }), { kind: "text", value: "Moon" });
    expect(edited.payload).toMatchObject({ spec: { nodeName: "Moon" } });
    expect(edited.label).toBe('Add group "Moon"');
  });

  it("ignores a kind mismatch", () => {
    const step = make({ op: "set-static", path: ["rotation"], before: 0, after: 45, layer });
    expect(withEditedValue(step, { kind: "text", value: "x" })).toBe(step);
  });
});

describe("applyParamValues", () => {
  it("substitutes only pinned steps, leaving the macro untouched", () => {
    const a = make({ op: "set-static", path: ["rotation"], before: 0, after: 45, layer });
    const b = make({ op: "set-static", path: ["opacity"], before: 100, after: 50, layer });
    const macro: Macro = { id: "m", name: "M", createdAt: 0, steps: [a, b], params: [{ stepId: a.id, label: a.label }] };
    const steps = applyParamValues(macro, { [a.id]: { kind: "number", value: 90 } });
    expect(steps[0]!.payload).toMatchObject({ after: 90 });
    expect(steps[1]).toBe(b);
    expect(macro.steps[0]!.payload).toMatchObject({ after: 45 });
  });
});
