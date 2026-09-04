import { describe, expect, it } from "vitest";

import { buildStep, hasKeyframes, keyframeSpan, type StepPayload } from "./steps";

const LAYER = { id: "l1", name: "Layer 1" };

describe("keyframeSpan", () => {
  it("returns null when the macro has no keyframe payloads", () => {
    const steps = [
      buildStep({ op: "set-static", path: ["position"], before: { x: 0, y: 0 }, after: { x: 10, y: 0 }, layer: LAYER } as StepPayload),
    ];
    expect(keyframeSpan(steps)).toBeNull();
  });

  it("spans added, removed and changed frames across steps", () => {
    const steps = [
      buildStep({ op: "keyframes", path: ["position"], added: [{ frame: 12, value: 1 }], removed: [], changed: [], layer: LAYER } as unknown as StepPayload),
      buildStep({ op: "keyframes", path: ["opacity"], added: [], removed: [{ frame: 4, value: 0 }], changed: [{ before: { frame: 30, value: 0 }, after: { frame: 60, value: 1 } }], layer: LAYER } as unknown as StepPayload),
    ];
    expect(keyframeSpan(steps)).toEqual({ first: 4, last: 60 });
  });

  it("ignores opaque non-payload steps (mocks, imports)", () => {
    const steps = [{ id: "x", kind: "other" as const, label: "opaque", payload: {} }];
    expect(keyframeSpan(steps)).toBeNull();
  });
});

describe("hasKeyframes", () => {
  it("is true when any step carries a keyframe payload", () => {
    const steps = [
      buildStep({ op: "set-static", path: ["position"], before: { x: 0, y: 0 }, after: { x: 10, y: 0 }, layer: LAYER } as StepPayload),
      buildStep({ op: "keyframes", path: ["rotation"], added: [{ frame: 0, value: 0 }], removed: [], changed: [], layer: LAYER } as unknown as StepPayload),
    ];
    expect(hasKeyframes(steps)).toBe(true);
  });

  it("is false for a macro of static and plain edits", () => {
    const steps = [
      buildStep({ op: "set-static", path: ["position"], before: { x: 0, y: 0 }, after: { x: 10, y: 0 }, layer: LAYER } as StepPayload),
      buildStep({ op: "set-plain", path: ["visible"], before: true, after: false, layer: LAYER } as StepPayload),
    ];
    expect(hasKeyframes(steps)).toBe(false);
  });

  it("is false for an empty macro and for opaque payloads", () => {
    expect(hasKeyframes([])).toBe(false);
    expect(hasKeyframes([{ id: "x", kind: "other" as const, label: "opaque", payload: {} }])).toBe(false);
  });
});
