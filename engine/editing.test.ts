import { describe, expect, it } from "vitest";

import { applyParamValues, editableValueOf, withEditedValue } from "./editing";
import type { Macro, MacroStep } from "./macro";
import { payloadClass } from "./operator";
import { buildStep, type StepPayload } from "./steps";

const layer = { id: "L1", name: "Rect" };
const make = (payload: StepPayload): MacroStep => buildStep(payload);

describe("editableValueOf", () => {
  it("classifies number, boolean, text, color and vector values", () => {
    expect(
      editableValueOf(make({ op: "set-static", path: ["opacity"], before: 0, after: 45, layer })),
    ).toEqual({ kind: "number", value: 45 });
    expect(
      editableValueOf(
        make({ op: "set-plain", path: ["visible"], before: true, after: false, layer }),
      ),
    ).toEqual({ kind: "boolean", value: false });
    expect(
      editableValueOf(
        make({ op: "set-plain", path: ["blendMode"], before: "NORMAL", after: "SCREEN", layer }),
      ),
    ).toEqual({ kind: "text", value: "SCREEN" });
    expect(
      editableValueOf(
        make({
          op: "set-static",
          path: ["fills", 0, "color"],
          before: { r: 0, g: 0, b: 0 },
          after: { r: 255, g: 0, b: 10 },
          layer,
        }),
      ),
    ).toEqual({ kind: "color", value: { r: 255, g: 0, b: 10 } });
    expect(
      editableValueOf(
        make({
          op: "set-static",
          path: ["shapes", 0, "size"],
          before: { x: 0, y: 0 },
          after: { x: 3, y: 4 },
          layer,
        }),
      ),
    ).toEqual({ kind: "vector", value: { x: 3, y: 4 } });
  });

  it("offers a fresh add-layer's name but not a duplicate's, and never path data", () => {
    const spec = {
      nodeId: "n",
      nodeType: "CONTAINER",
      nodeName: "Star",
      props: {},
      plain: {},
      fills: [],
      strokes: [],
      masks: [],
      shapes: [],
    };
    expect(editableValueOf(make({ op: "add-layer", spec }))).toEqual({
      kind: "text",
      value: "Star",
    });
    expect(editableValueOf(make({ op: "add-layer", spec, cloneOf: layer }))).toBeNull();
    expect(
      editableValueOf(
        make({
          op: "set-static",
          path: ["shapes", 0, "pathData"],
          before: null,
          after: { points: [], closed: true },
          layer,
        }),
      ),
    ).toBeNull();
    // A keyframe step outside a layer's own transform has nothing to type.
    expect(
      editableValueOf(
        make({
          op: "keyframes",
          path: ["fills", 0, "color"],
          added: [],
          removed: [],
          changed: [],
          layer,
        }),
      ),
    ).toBeNull();
    expect(
      editableValueOf({ id: "m", kind: "other", label: "mock", payload: "opaque" }),
    ).toBeNull();
  });
});

describe("withEditedValue", () => {
  it("replaces `after` and rebuilds the label", () => {
    const step = make({
      op: "set-static",
      path: ["shapes", 0, "size"],
      before: { x: 0, y: 0 },
      after: { x: 3, y: 0 },
      layer,
    });
    const edited = withEditedValue(step, { kind: "vector", value: { x: 50, y: 0 } });
    expect(edited.id).toBe(step.id);
    expect(edited.payload).toMatchObject({ after: { x: 50, y: 0 }, before: { x: 0, y: 0 } });
    expect(edited.label).toBe("Rect · Shape 1 · size.x 0 → 50");
    expect(step.payload).toMatchObject({ after: { x: 3, y: 0 } });
  });

  it("renames an add-layer spec", () => {
    const spec = {
      nodeId: "n",
      nodeType: "CONTAINER",
      nodeName: "Star",
      props: {},
      plain: {},
      fills: [],
      strokes: [],
      masks: [],
      shapes: [],
    };
    const edited = withEditedValue(make({ op: "add-layer", spec }), {
      kind: "text",
      value: "Moon",
    });
    expect(edited.payload).toMatchObject({ spec: { nodeName: "Moon" } });
    expect(edited.label).toBe('Add group "Moon"');
  });

  it("ignores a kind mismatch", () => {
    const step = make({ op: "set-static", path: ["opacity"], before: 0, after: 45, layer });
    expect(withEditedValue(step, { kind: "text", value: "x" })).toBe(step);
    const transform = make({ op: "set-static", path: ["rotation"], before: 0, after: 45, layer });
    expect(withEditedValue(transform, { kind: "number", value: 90 })).toBe(transform);
  });
});

describe("applyParamValues", () => {
  it("substitutes only pinned steps, leaving the macro untouched", () => {
    const a = make({ op: "set-static", path: ["opacity"], before: 0, after: 45, layer });
    const b = make({ op: "set-static", path: ["fontSize"], before: 100, after: 50, layer });
    const macro: Macro = {
      id: "m",
      name: "M",
      createdAt: 0,
      steps: [a, b],
      params: [{ stepId: a.id, label: a.label }],
    };
    const steps = applyParamValues(macro, { [a.id]: { kind: "number", value: 90 } });
    expect(steps[0]!.payload).toMatchObject({ after: 90 });
    expect(steps[1]).toBe(b);
    expect(macro.steps[0]!.payload).toMatchObject({ after: 45 });
  });

  it("leaves a step whose field still holds its own default alone", () => {
    // The pre-play form opens with `formatFormula(termsOf(step))` — the
    // step's own term, ROUNDED for display. Writing that back would re-parse
    // the rounding into the payload and pin an `apply` on a step that had
    // none, so a run with nothing typed would not replay like a run with no
    // form at all.
    const drag = make({
      op: "set-static",
      path: ["position"],
      before: { x: 0, y: 0 },
      after: { x: 19.500049, y: 0 },
      layer,
    });
    const macro: Macro = {
      id: "m",
      name: "M",
      createdAt: 0,
      steps: [drag],
      params: [{ stepId: drag.id, label: drag.label }],
    };
    const untouched = editableValueOf(drag)!;
    expect(untouched).toEqual({
      kind: "formula",
      fields: { x: "v + 19.5", y: "v" },
      at: { x: 0, y: 0 },
    });

    const steps = applyParamValues(macro, { [drag.id]: untouched });
    expect(steps[0]).toBe(drag);
    expect(steps[0]!.payload).not.toHaveProperty("apply");
    expect(steps[0]!.payload).toMatchObject({ after: { x: 19.500049, y: 0 } });

    // A field the user DID change still goes through.
    const typed = applyParamValues(macro, {
      [drag.id]: { kind: "formula", fields: { x: "v + 25", y: "v" } },
    });
    expect(typed[0]).not.toBe(drag);
    expect(typed[0]!.payload).toMatchObject({
      apply: { x: { scale: 1, offset: 25 }, y: { scale: 1, offset: 0 } },
      after: { x: 25, y: 0 },
    });
  });
});

/* ------------------------------------------------------------------ */
/* formulas — the box holds arithmetic on the target's current value   */
/* ------------------------------------------------------------------ */

describe("editableValueOf — formulas", () => {
  it("gives a scalar transform step one box, spelling what the step does", () => {
    expect(
      editableValueOf(make({ op: "set-static", path: ["rotation"], before: 10, after: 55, layer })),
    ).toEqual({ kind: "formula", fields: { value: "v + 45" }, at: { value: 10 } });
    // A recorded reset sets a value: the box holds the number, not `v`.
    expect(
      editableValueOf(make({ op: "set-static", path: ["rotation"], before: 45, after: 0, layer })),
    ).toEqual({ kind: "formula", fields: { value: "0" }, at: { value: 45 } });
  });

  it("gives a vector transform step one box per component", () => {
    expect(
      editableValueOf(
        make({
          op: "set-static",
          path: ["position"],
          before: { x: 80.5, y: 50 },
          after: { x: 100, y: 203.1 },
          layer,
        }),
      ),
    ).toEqual({
      kind: "formula",
      fields: { x: "v + 19.5", y: "v + 153.1" },
      at: { x: 80.5, y: 50 },
    });
    expect(
      editableValueOf(
        make({
          op: "set-static",
          path: ["scale"],
          before: { x: 100, y: 100 },
          after: { x: 200, y: 150 },
          layer,
        }),
      ),
    ).toEqual({
      kind: "formula",
      fields: { x: "v * 2", y: "v * 1.5" },
      at: { x: 100, y: 100 },
    });
    // No ratio starts at 0, so that recording sets values instead.
    expect(
      editableValueOf(
        make({
          op: "set-static",
          path: ["scale"],
          before: { x: 0, y: 100 },
          after: { x: 50, y: 200 },
          layer,
        }),
      ),
    ).toEqual({ kind: "formula", fields: { x: "50", y: "200" }, at: { x: 0, y: 100 } });
  });

  it("shows an explicit formula rather than re-deriving one", () => {
    expect(
      editableValueOf(
        make({
          op: "set-static",
          path: ["rotation"],
          before: 10,
          after: 30,
          apply: { scale: 2, offset: 10 },
          layer,
        }),
      ),
    ).toEqual({ kind: "formula", fields: { value: "v * 2 + 10" }, at: { value: 10 } });
  });

  it("makes a keyframe step editable, its default box the unchanged `v`", () => {
    expect(
      editableValueOf(
        make({
          op: "keyframes",
          path: ["position"],
          added: [{ frame: 60, value: { x: 10, y: 20 } }],
          removed: [],
          changed: [],
          layer,
        }),
      ),
    ).toEqual({ kind: "formula", fields: { x: "v", y: "v" } });
    expect(
      editableValueOf(
        make({
          op: "keyframes",
          path: ["rotation"],
          added: [{ frame: 60, value: 90 }],
          removed: [],
          changed: [],
          layer,
        }),
      ),
    ).toEqual({ kind: "formula", fields: { value: "v" } });
  });
});

describe("editableValueOf — the recorded anchor the editor converts through", () => {
  it("carries the recorded start value, keyed the way the boxes are", () => {
    // The editor needs it to turn `v + 30` into `130` when the user presses
    // `=`: the number in the box has to keep meaning the same edit.
    const scalar = editableValueOf(
      make({ op: "set-static", path: ["rotation"], before: 10, after: 55, layer }),
    );
    expect(scalar).toMatchObject({ at: { value: 10 } });
    const vector = editableValueOf(
      make({
        op: "set-static",
        path: ["position"],
        before: { x: 80.5, y: 50 },
        after: { x: 100, y: 203.1 },
        layer,
      }),
    );
    expect(vector).toMatchObject({ at: { x: 80.5, y: 50 } });
  });

  it("gives a keyframes step no anchor at all", () => {
    // A keyframes step records a RUN of values, and no single one of them is
    // what `v` holds when replay reaches the step.
    const step = editableValueOf(
      make({
        op: "keyframes",
        path: ["position"],
        added: [{ frame: 60, value: { x: 10, y: 20 } }],
        removed: [],
        changed: [],
        layer,
      }),
    );
    expect(step).not.toHaveProperty("at");
  });

  it("gives no anchor when the recording has no number for every box", () => {
    // All of them or none: converting one component against a number and its
    // neighbour against nothing would move the two apart.
    const step = editableValueOf(
      make({
        op: "set-static",
        path: ["position"],
        before: { x: 10 },
        after: { x: 30, y: 40 },
        layer,
      }),
    );
    expect(step).not.toHaveProperty("at");
  });

  it("is ignored by the write back: no step stores it", () => {
    const step = make({ op: "set-static", path: ["rotation"], before: 10, after: 55, layer });
    const withAnchor = withEditedValue(step, {
      kind: "formula",
      fields: { value: "v - 45" },
      at: { value: 10 },
    });
    const without = withEditedValue(step, { kind: "formula", fields: { value: "v - 45" } });
    expect(withAnchor.payload).toEqual(without.payload);
    expect(withAnchor.payload).not.toHaveProperty("at");
  });
});

describe("withEditedValue — formulas", () => {
  it("writes `apply` and recomputes `after` from the recorded start", () => {
    const step = make({ op: "set-static", path: ["rotation"], before: 10, after: 55, layer });
    const edited = withEditedValue(step, { kind: "formula", fields: { value: "v - 45" } });
    expect(edited.payload).toMatchObject({
      apply: { scale: 1, offset: -45 },
      before: 10,
      after: -35,
    });
    expect(edited.label).toBe("Rect · Transform · rotation −45");
    expect(payloadClass(edited.payload as StepPayload)).toBe("absolute");
    // The recorded step is untouched.
    expect(step.payload).toMatchObject({ after: 55 });
  });

  it("takes one formula per component, mixing set and shift", () => {
    const step = make({
      op: "set-static",
      path: ["position"],
      before: { x: 80.5, y: 50 },
      after: { x: 100, y: 60 },
      layer,
    });
    const edited = withEditedValue(step, {
      kind: "formula",
      fields: { x: "250", y: "v + 10" },
    });
    expect(edited.payload).toMatchObject({
      apply: { x: { scale: 0, offset: 250 }, y: { scale: 1, offset: 10 } },
      after: { x: 250, y: 60 },
    });
  });

  it("round-trips the box it was given", () => {
    for (const step of [
      make({ op: "set-static", path: ["rotation"], before: 10, after: 55, layer }),
      make({
        op: "set-static",
        path: ["scale"],
        before: { x: 100, y: 100 },
        after: { x: 200, y: 150 },
        layer,
      }),
    ]) {
      const edited = withEditedValue(step, editableValueOf(step)!);
      expect(edited.payload).toMatchObject({
        after: (step.payload as StepPayload & { after: unknown }).after,
      });
      expect(edited.label).toBe(step.label);
    }
  });

  it("leaves the step alone when a box does not parse", () => {
    const step = make({ op: "set-static", path: ["rotation"], before: 10, after: 55, layer });
    for (const text of ["v * v", "10 / v", "v / 0", "abc", ""]) {
      const edited = withEditedValue(step, { kind: "formula", fields: { value: text } });
      expect(edited).toBe(step);
      expect(edited.payload).not.toHaveProperty("apply");
    }
    // One bad component refuses the whole edit — a half-written formula would
    // move the target in a way nobody asked for.
    const vector = make({
      op: "set-static",
      path: ["position"],
      before: { x: 0, y: 0 },
      after: { x: 10, y: 0 },
      layer,
    });
    expect(withEditedValue(vector, { kind: "formula", fields: { x: "v + 1", y: "v * v" } })).toBe(
      vector,
    );
  });

  it("gives a keyframe step a formula and keeps its recorded keyframes", () => {
    const step = make({
      op: "keyframes",
      path: ["position"],
      added: [
        { frame: 0, value: { x: 10, y: 20 } },
        { frame: 60, value: { x: 110, y: 20 } },
      ],
      removed: [],
      changed: [],
      layer,
    });
    const edited = withEditedValue(step, { kind: "formula", fields: { x: "v + 10", y: "v" } });
    expect(edited.payload).toMatchObject({
      apply: { x: { scale: 1, offset: 10 }, y: { scale: 1, offset: 0 } },
      added: [
        { frame: 0, value: { x: 10, y: 20 } },
        { frame: 60, value: { x: 110, y: 20 } },
      ],
    });
    expect(edited.label).toBe("Rect · Keyframes · position (+2) · x: v + 10, y: v");
  });

  it("ignores a formula handed to a step that takes none", () => {
    const step = make({ op: "set-static", path: ["opacity"], before: 100, after: 50, layer });
    expect(withEditedValue(step, { kind: "formula", fields: { value: "v + 10" } })).toBe(step);
  });
});

describe("applyParamValues — formulas", () => {
  it("plays a pinned step with the formula typed into the form", () => {
    const drag = make({
      op: "set-static",
      path: ["position"],
      before: { x: 0, y: 0 },
      after: { x: 100, y: 0 },
      layer,
    });
    const macro: Macro = {
      id: "m",
      name: "M",
      createdAt: 0,
      steps: [drag],
      params: [{ stepId: drag.id, label: drag.label }],
    };
    const steps = applyParamValues(macro, {
      [drag.id]: { kind: "formula", fields: { x: "250", y: "v" } },
    });
    expect(steps[0]!.payload).toMatchObject({
      apply: { x: { scale: 0, offset: 250 }, y: { scale: 1, offset: 0 } },
      after: { x: 250, y: 0 },
    });
    expect(payloadClass(steps[0]!.payload as StepPayload)).toBe("absolute");
    // The saved macro keeps its recording.
    expect(macro.steps[0]!.payload).not.toHaveProperty("apply");
  });
});

describe("a step saved by the first cut of formulas (string apply)", () => {
  it("opens in the box as the formula it meant instead of throwing mid-render", () => {
    const legacy = buildStep({
      op: "set-static",
      path: ["rotation"],
      before: 45,
      after: 0,
      layer: { id: "L1", name: "Rect" },
      apply: "add" as never,
    });
    expect(editableValueOf(legacy)).toEqual({
      kind: "formula",
      fields: { value: "v - 45" },
      at: { value: 45 },
    });
    expect(legacy.label).toBe("Rect · Transform · rotation −45");
  });
});
