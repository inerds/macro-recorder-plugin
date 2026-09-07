import { describe, expect, it } from "vitest";

import type { Json } from "./json";
import type { MacroStep } from "./macro";
import { joinLabelParts, labelOf, labelPartsOf, propDisplayName, sharedLayerName } from "./labels";
import type { AnimatableSnapshot, KfSnap, PaintSnapshot, Path } from "./snapshot";
import { buildStep, kindOf, type StepPayload } from "./steps";

/*
 * Exact-string assertions below. Three of the characters labels.ts emits are
 * not ASCII and are easy to mistype, so they are named here:
 *   "·" MIDDLE DOT      — the "Transform · " separator
 *   "→" RIGHTWARDS ARROW — the before → after arrow
 *   "−" MINUS SIGN       — the removed-keyframe count and negative deltas (not "-")
 *   "×" MULTIPLICATION SIGN — the ratio prefix on a multiply step (not "x")
 *   "–" EN DASH          — how fmt() renders null (not "-")
 */
const DOT = "·";
const ARROW = "→";
const MINUS = "−";
const EN_DASH = "–";
const TIMES = "×";

const RED: Json = { r: 255, g: 0, b: 0 };
const GREEN: Json = { r: 0, g: 255, b: 0 };
const BLACK: Json = { r: 0, g: 0, b: 0 };

function anim(staticValue?: Json): AnimatableSnapshot {
  const snap: AnimatableSnapshot = { animated: false };
  if (staticValue !== undefined) snap.static = staticValue;
  return snap;
}

function solid(color?: Json): PaintSnapshot {
  return { kind: "solid", color: anim(color) };
}

function shapeSpec(nodeType: string) {
  return {
    nodeId: "spec-1",
    nodeType,
    props: {},
    plain: {},
    fills: [],
    strokes: [],
    masks: [],
    shapes: [],
  };
}

function maskSpec() {
  return {
    pathData: { animated: false },
    opacity: { animated: false, static: 100 },
  };
}

function kf(frame: number, value: Json = 0): KfSnap {
  return { frame, value };
}

function setStatic(path: Path, before: Json, after: Json): StepPayload {
  return { op: "set-static", path, before, after };
}

/* ------------------------------------------------------------------ */
/* transform props                                                     */
/* ------------------------------------------------------------------ */

describe("labelOf — set-static on transform props", () => {
  it("names the single changed component of a vector", () => {
    // `size` is not a layer transform, so it keeps the plain arrow form.
    expect(labelOf(setStatic(["shapes", 0, "size"], { x: 100, y: 50 }, { x: 200, y: 50 }))).toBe(
      `Shape 1 ${DOT} size.x 100 ${ARROW} 200`,
    );
  });

  it("shows the whole vector when more than one component changed", () => {
    expect(labelOf(setStatic(["shapes", 0, "size"], { x: 100, y: 50 }, { x: 200, y: 80 }))).toBe(
      `Shape 1 ${DOT} size (x: 100, y: 50) ${ARROW} (x: 200, y: 80)`,
    );
  });

  it("labels a scalar transform prop", () => {
    expect(labelOf(setStatic(["opacity"], 1, 0.5))).toBe(`Transform ${DOT} opacity 1 ${ARROW} 0.5`);
  });

  it("rounds numbers to two decimals", () => {
    expect(labelOf(setStatic(["opacity"], 1, 0.56789))).toBe(
      `Transform ${DOT} opacity 1 ${ARROW} 0.57`,
    );
  });

  it("renders a null side as an en dash", () => {
    // A null start has no delta, so the step falls back to the arrow form.
    expect(labelOf(setStatic(["rotation"], null, 45))).toBe(
      `Transform ${DOT} rotation ${EN_DASH} ${ARROW} 45`,
    );
  });

  it("omits the Transform prefix for non-transform props", () => {
    // ODDITY: geometry props such as `size` get no category prefix at all, so
    // the label starts with a bare lowercase property name.
    expect(labelOf(setStatic(["size"], { x: 10, y: 10 }, { x: 20, y: 10 }))).toBe(
      `size.x 10 ${ARROW} 20`,
    );
  });
});

/* ------------------------------------------------------------------ */
/* operators — the label says whether a step sets, adds or multiplies  */
/* ------------------------------------------------------------------ */

describe("labelOf — set / add / multiply", () => {
  it("reads an add as a signed delta on the changed component", () => {
    expect(labelOf(setStatic(["position"], { x: 80.5, y: 50 }, { x: 100, y: 50 }))).toBe(
      `Transform ${DOT} position.x +19.5`,
    );
    expect(labelOf(setStatic(["rotation"], 10, 55))).toBe(`Transform ${DOT} rotation +45`);
  });

  it("uses a MINUS SIGN for a negative delta, never a hyphen", () => {
    expect(labelOf(setStatic(["rotation"], 45, 20))).toBe(`Transform ${DOT} rotation ${MINUS}25`);
  });

  it("reads a multi-component add per component", () => {
    expect(labelOf(setStatic(["position"], { x: 80.5, y: 50 }, { x: 100, y: 203.1 }))).toBe(
      `Transform ${DOT} position +19.5, +153.1`,
    );
  });

  it("reads a scale as a ratio", () => {
    expect(labelOf(setStatic(["scale"], { x: 100, y: 100 }, { x: 200, y: 200 }))).toBe(
      `Transform ${DOT} scale ${TIMES}2, ${TIMES}2`,
    );
    expect(labelOf(setStatic(["scale"], { x: 100, y: 100 }, { x: 200, y: 150 }))).toBe(
      `Transform ${DOT} scale ${TIMES}2, ${TIMES}1.5`,
    );
    expect(labelOf(setStatic(["scale"], { x: 100, y: 100 }, { x: 200, y: 100 }))).toBe(
      `Transform ${DOT} scale.x ${TIMES}2`,
    );
  });

  it("keeps the arrow form for a reset, which sets an exact value", () => {
    expect(labelOf(setStatic(["rotation"], 45, 0))).toBe(`Transform ${DOT} rotation 45 ${ARROW} 0`);
    expect(labelOf(setStatic(["scale"], { x: 50, y: 50 }, { x: 100, y: 100 }))).toBe(
      `Transform ${DOT} scale (x: 50, y: 50) ${ARROW} (x: 100, y: 100)`,
    );
  });

  it("keeps the arrow form for a formula that SETS a value", () => {
    const forced: StepPayload = {
      op: "set-static",
      path: ["position"],
      before: { x: 0, y: 0 },
      after: { x: 40, y: 0 },
      apply: { x: { scale: 0, offset: 40 }, y: { scale: 0, offset: 0 } },
    };
    expect(labelOf(forced)).toBe(`Transform ${DOT} position.x 0 ${ARROW} 40`);
  });

  it("reads a formula's shift, ratio, and both together", () => {
    expect(
      labelOf({
        op: "set-static",
        path: ["position"],
        before: { x: 0, y: 0 },
        after: { x: 10, y: 0 },
        apply: { x: { scale: 1, offset: 10 }, y: { scale: 1, offset: 0 } },
      }),
    ).toBe(`Transform ${DOT} position.x +10`);
    expect(
      labelOf({
        op: "set-static",
        path: ["rotation"],
        before: 20,
        after: 40,
        apply: { scale: 2, offset: 0 },
      }),
    ).toBe(`Transform ${DOT} rotation ${TIMES}2`);
    expect(
      labelOf({
        op: "set-static",
        path: ["scale"],
        before: { x: 100, y: 100 },
        after: { x: 200, y: 200 },
        apply: { x: { scale: 2, offset: 0 }, y: { scale: 2, offset: 0 } },
      }),
    ).toBe(`Transform ${DOT} scale ${TIMES}2, ${TIMES}2`);
    expect(
      labelOf({
        op: "set-static",
        path: ["position"],
        before: { x: 0, y: 0 },
        after: { x: 10, y: 0 },
        apply: { x: { scale: 2, offset: 10 }, y: { scale: 1, offset: 0 } },
      }),
    ).toBe(`Transform ${DOT} position.x ${TIMES}2 +10`);
  });

  it("labels from the formula even when the recorded pair no longer moves", () => {
    // "rotation 0 → 45" edited to `v * 2` recomputes `after` back onto
    // `before` — 2 × 0 is 0 — and a captured-state label ("rotation = 0")
    // would then hide the multiply every target is about to get.
    expect(
      labelOf({
        op: "set-static",
        path: ["rotation"],
        before: 0,
        after: 0,
        apply: { scale: 2, offset: 0 },
      }),
    ).toBe(`Transform ${DOT} rotation ${TIMES}2`);
    expect(
      labelOf({
        op: "set-static",
        path: ["position"],
        before: { x: 0, y: 0 },
        after: { x: 0, y: 0 },
        apply: { x: { scale: 2, offset: 0 }, y: { scale: 3, offset: 0 } },
      }),
    ).toBe(`Transform ${DOT} position ${TIMES}2, ${TIMES}3`);
    // Plain `v` writes the value back: nothing to announce, so the captured
    // state is still the honest label.
    expect(
      labelOf({
        op: "set-static",
        path: ["rotation"],
        before: 0,
        after: 0,
        apply: { scale: 1, offset: 0 },
      }),
    ).toBe(`Transform ${DOT} rotation = 0`);
  });

  it("keeps the arrow form when no ratio exists from 0", () => {
    // A multiply from 0 resolves to absolute (`payloadClass`), which is what
    // the applier does for the zero component — so the label sets a value too.
    expect(labelOf(setStatic(["scale"], { x: 0, y: 100 }, { x: 50, y: 200 }))).toBe(
      `Transform ${DOT} scale (x: 0, y: 100) ${ARROW} (x: 50, y: 200)`,
    );
  });

  it("keeps the arrow form for a delta the operand form would print as +0", () => {
    // "+0" reads as a step that does nothing. The arrow form still says
    // something true about a move smaller than the label's own precision.
    expect(labelOf(setStatic(["rotation"], 45, 45.001))).toBe(
      `Transform ${DOT} rotation 45 ${ARROW} 45`,
    );
    expect(labelOf(setStatic(["position"], { x: 10, y: 20 }, { x: 10.002, y: 20.003 }))).toBe(
      `Transform ${DOT} position (x: 10, y: 20) ${ARROW} (x: 10, y: 20)`,
    );
  });

  it("keeps the arrow form for a ratio the operand form would print as ×1", () => {
    expect(labelOf(setStatic(["scale"], { x: 100, y: 100 }, { x: 100.2, y: 100.3 }))).toBe(
      `Transform ${DOT} scale (x: 100, y: 100) ${ARROW} (x: 100.2, y: 100.3)`,
    );
  });

  it("still prints the operand when one component moved past the precision", () => {
    expect(labelOf(setStatic(["position"], { x: 10, y: 20 }, { x: 60, y: 20.001 }))).toBe(
      `Transform ${DOT} position +50, +0`,
    );
  });

  it("spells a keyframe step's formula, and says nothing for the default", () => {
    const kfStep: StepPayload = {
      op: "keyframes",
      path: ["position"],
      added: [kf(60)],
      removed: [],
      changed: [],
    };
    expect(labelOf(kfStep)).toBe(`Keyframe ${DOT} position @ 60`);
    expect(labelOf({ ...kfStep, apply: { scale: 2, offset: 10 } })).toBe(
      `Keyframe ${DOT} position @ 60 ${DOT} v * 2 + 10`,
    );
    expect(
      labelOf({
        ...kfStep,
        apply: { x: { scale: 1, offset: 10 }, y: { scale: 0, offset: 5 } },
      }),
    ).toBe(`Keyframe ${DOT} position @ 60 ${DOT} x: v + 10, y: 5`);
    expect(
      labelOf({
        op: "keyframes",
        path: ["position"],
        added: [kf(0), kf(30)],
        removed: [],
        changed: [],
        apply: { x: { scale: 1, offset: 10 }, y: { scale: 1, offset: 0 } },
      }),
    ).toBe(`Keyframes ${DOT} position (+2) ${DOT} x: v + 10, y: v`);
  });
});

/* ------------------------------------------------------------------ */
/* paints                                                              */
/* ------------------------------------------------------------------ */

describe("labelOf — set-static on paints", () => {
  it("labels the first fill colour without an index and hides the before value", () => {
    expect(labelOf(setStatic(["fills", 0, "color"], BLACK, RED))).toBe(`Fill ${ARROW} #FF0000`);
  });

  it("numbers fills from 2 upwards", () => {
    expect(labelOf(setStatic(["fills", 1, "color"], BLACK, GREEN))).toBe(`Fill 2 ${ARROW} #00FF00`);
    expect(labelOf(setStatic(["fills", 2, "color"], BLACK, GREEN))).toBe(`Fill 3 ${ARROW} #00FF00`);
  });

  it("clamps and rounds colour channels when hexing", () => {
    expect(labelOf(setStatic(["fills", 0, "color"], BLACK, { r: 300, g: -5, b: 127.6 }))).toBe(
      `Fill ${ARROW} #FF0080`,
    );
  });

  it("labels a gradient stops change with the stops array", () => {
    expect(labelOf(setStatic(["fills", 0, "stops"], [], [{ offset: 0, color: RED }]))).toBe(
      `Fill stops ${ARROW} [(offset: 0, color: #FF0000)]`,
    );
  });

  it("labels a stroke width change", () => {
    expect(labelOf(setStatic(["strokes", 0, "width"], 2, 4))).toBe(
      `Stroke ${DOT} width 2 ${ARROW} 4`,
    );
  });

  it("labels a stroke paint change as color, with 1-based index past the first", () => {
    expect(labelOf(setStatic(["strokes", 0, "fill", "color"], BLACK, RED))).toBe(
      `Stroke ${DOT} color #000000 ${ARROW} #FF0000`,
    );
    expect(labelOf(setStatic(["strokes", 1, "width"], 2, 4))).toBe(
      `Stroke 2 ${DOT} width 2 ${ARROW} 4`,
    );
  });
});

/* ------------------------------------------------------------------ */
/* keyframes                                                           */
/* ------------------------------------------------------------------ */

describe("labelOf — keyframes", () => {
  it("uses the singular form for exactly one added keyframe", () => {
    expect(
      labelOf({
        op: "keyframes",
        path: ["position"],
        added: [kf(60, { x: 10, y: 0 })],
        removed: [],
        changed: [],
      }),
    ).toBe(`Keyframe ${DOT} position @ 60`);
  });

  it("rounds the frame number in the singular form", () => {
    expect(
      labelOf({
        op: "keyframes",
        path: ["position"],
        added: [kf(12.345)],
        removed: [],
        changed: [],
      }),
    ).toBe(`Keyframe ${DOT} position @ 12.35`);
  });

  it("summarises a mixed keyframe change with counts", () => {
    expect(
      labelOf({
        op: "keyframes",
        path: ["position"],
        added: [kf(60)],
        removed: [kf(0)],
        changed: [{ before: kf(30, 1), after: kf(30, 2) }],
      }),
    ).toBe(`Keyframes ${DOT} position (+1, ${MINUS}1, ~1)`);
  });

  it("omits empty buckets from the summary", () => {
    expect(
      labelOf({
        op: "keyframes",
        path: ["position"],
        added: [],
        removed: [kf(0), kf(30)],
        changed: [],
      }),
    ).toBe(`Keyframes ${DOT} position (${MINUS}2)`);
    expect(
      labelOf({
        op: "keyframes",
        path: ["opacity"],
        added: [kf(0), kf(30)],
        removed: [],
        changed: [],
      }),
    ).toBe(`Keyframes ${DOT} opacity (+2)`);
  });

  it("uses the paint prop name for keyframes on a fill", () => {
    expect(
      labelOf({
        op: "keyframes",
        path: ["fills", 0, "color"],
        added: [kf(12)],
        removed: [],
        changed: [],
      }),
    ).toBe(`Keyframe ${DOT} Fill @ 12`);
  });

  it("renders an all-empty keyframe payload with empty parens", () => {
    // Defensive: diffSnapshots never emits this, but labelOf must not throw.
    expect(
      labelOf({ op: "keyframes", path: ["position"], added: [], removed: [], changed: [] }),
    ).toBe(`Keyframes ${DOT} position ()`);
  });
});

/* ------------------------------------------------------------------ */
/* structure                                                           */
/* ------------------------------------------------------------------ */

describe("labelOf — structure", () => {
  it("labels an added solid fill with its hex colour", () => {
    expect(labelOf({ op: "add-fill", spec: solid(RED) })).toBe("Add fill #FF0000");
  });

  it("labels an added gradient fill", () => {
    expect(
      labelOf({
        op: "add-fill",
        spec: { kind: "gradient", stops: { animated: false, static: [] } },
      }),
    ).toBe("Add fill (gradient)");
  });

  it("renders an added solid fill with no static colour as an en dash", () => {
    expect(labelOf({ op: "add-fill", spec: solid() })).toBe(`Add fill ${EN_DASH}`);
  });

  it("labels an added stroke with its width in px", () => {
    expect(
      labelOf({ op: "add-stroke", path: ["strokes", 0], spec: { width: 2, fill: solid(BLACK) } }),
    ).toBe("Add stroke 2px");
  });

  it("labels an added shape by lowercased type", () => {
    expect(labelOf({ op: "add-shape", parentPath: [], spec: shapeSpec("RECTANGLE") })).toBe(
      "Add rectangle",
    );
    expect(labelOf({ op: "add-shape", parentPath: [], spec: shapeSpec("ELLIPSE") })).toBe(
      "Add ellipse",
    );
  });

  it("says node types the way a user would (SCENE_LAYER is a scene)", () => {
    expect(
      labelOf({
        op: "add-layer",
        spec: { ...shapeSpec("SCENE_LAYER"), nodeName: "Intro" },
      }),
    ).toBe('Add scene "Intro"');
    expect(labelOf({ op: "add-shape", parentPath: [], spec: shapeSpec("CONTAINER") })).toBe(
      "Add group",
    );
    // Unknown types still read as English rather than SCREAMING_SNAKE.
    expect(labelOf({ op: "add-shape", parentPath: [], spec: shapeSpec("SOME_NEW_THING") })).toBe(
      "Add some new thing",
    );
  });

  it("says property names the way a user would (blendMode is a blend mode)", () => {
    expect(
      labelOf({ op: "set-plain", path: ["blendMode"], before: "NORMAL", after: "MULTIPLY" }),
    ).toBe("Layer · blend mode NORMAL → MULTIPLY");
    expect(
      labelOf({
        op: "set-static",
        path: ["fontSize"],
        before: 12,
        after: 18,
      }),
    ).toBe("font size 12 → 18");
  });

  it("labels a removed shape and a plain-flag change", () => {
    expect(labelOf({ op: "remove-shape", path: ["shapes", 0], shapeType: "STAR" })).toBe(
      "Remove star",
    );
    expect(labelOf({ op: "set-plain", path: ["visible"], before: true, after: false })).toBe(
      "Layer · visible off",
    );
  });

  it("labels removed fills consistently with edits (first unnumbered)", () => {
    expect(labelOf({ op: "remove-paint", path: ["fills", 0] })).toBe("Remove fill");
    expect(labelOf({ op: "remove-paint", path: ["fills", 1] })).toBe("Remove fill 2");
  });

  it("labels a removed stroke with a 1-based index past the first", () => {
    expect(labelOf({ op: "remove-paint", path: ["strokes", 0] })).toBe("Remove stroke");
    expect(labelOf({ op: "remove-paint", path: ["strokes", 3] })).toBe("Remove stroke 4");
  });
});

/* ------------------------------------------------------------------ */
/* buildStep                                                           */
/* ------------------------------------------------------------------ */

describe("buildStep", () => {
  it("materialises a payload into a step whose kind and label match the helpers", () => {
    const payload = setStatic(["position"], { x: 100, y: 50 }, { x: 200, y: 50 });
    const step = buildStep(payload);

    expect(step.kind).toBe(kindOf(payload));
    expect(step.label).toBe(labelOf(payload));
    expect(step.payload).toBe(payload);
    expect(step.id).toBeTypeOf("string");
    expect(step.id.length).toBeGreaterThan(0);
  });

  it("gives every step a unique id, even for identical payloads", () => {
    const payload = setStatic(["opacity"], 1, 0.5);
    const ids = new Set(Array.from({ length: 50 }, () => buildStep(payload).id));

    expect(ids.size).toBe(50);
  });

  it("carries the right kind for each payload op", () => {
    const cases: [StepPayload, string][] = [
      [setStatic(["position"], 0, 1), "transform"],
      [setStatic(["fills", 0, "color"], BLACK, RED), "fill"],
      [setStatic(["strokes", 0, "width"], 2, 4), "stroke"],
      [setStatic(["size"], 0, 1), "other"],
      [
        { op: "keyframes", path: ["position"], added: [kf(0)], removed: [], changed: [] },
        "keyframe",
      ],
      [{ op: "add-fill", spec: solid(RED) }, "fill"],
      [{ op: "add-paint", path: ["fills", 0], spec: solid(RED) }, "fill"],
      [{ op: "replace-paint", path: ["fills", 0], spec: solid(RED) }, "fill"],
      [
        { op: "add-stroke", path: ["strokes", 0], spec: { width: 2, fill: solid(BLACK) } },
        "stroke",
      ],
      [{ op: "add-shape", parentPath: [], spec: shapeSpec("RECTANGLE") }, "shape"],
      [{ op: "remove-shape", path: ["shapes", 0] }, "shape"],
      [{ op: "set-plain", path: ["visible"], before: true, after: false }, "layer"],
      [{ op: "add-mask", path: ["masks", 0], spec: maskSpec() }, "mask"],
      [{ op: "remove-mask", path: ["masks", 0] }, "mask"],
      [{ op: "remove-paint", path: ["fills", 0] }, "fill"],
      [{ op: "remove-paint", path: ["strokes", 0] }, "stroke"],
    ];

    for (const [payload, kind] of cases) {
      expect(buildStep(payload).kind).toBe(kind);
    }
  });
});

describe("sharedLayerName", () => {
  const bound = (id: string, name?: string): MacroStep =>
    buildStep({
      op: "set-static",
      path: ["opacity"],
      before: 1,
      after: 0.5,
      ...(name === undefined ? { layer: { id } } : { layer: { id, name } }),
    });
  const unbound = (): MacroStep =>
    buildStep({ op: "set-static", path: ["opacity"], before: 1, after: 0.5 });
  const sceneOp = (): MacroStep =>
    buildStep({ op: "remove-layer", layer: { id: "l1", name: "Rect" } });

  it("returns the one layer name every bound step shares", () => {
    expect(sharedLayerName([bound("l1", "Rect"), bound("l1", "Rect")])).toBe("Rect");
  });

  it("returns '' when the bound steps name different layers", () => {
    expect(sharedLayerName([bound("l1", "Rect"), bound("l2", "Star")])).toBe("");
  });

  it("returns '' when no step carries a layer binding", () => {
    expect(sharedLayerName([])).toBe("");
    expect(sharedLayerName([unbound(), unbound()])).toBe("");
  });

  it("ignores scene ops, which name their layer inside the label", () => {
    expect(sharedLayerName([bound("l1", "Rect"), sceneOp()])).toBe("Rect");
    expect(sharedLayerName([sceneOp()])).toBe("");
  });

  it("ignores steps with no binding, but not bound steps with no name", () => {
    expect(sharedLayerName([bound("l1", "Rect"), unbound()])).toBe("Rect");
    expect(sharedLayerName([bound("l1", "Rect"), bound("l1")])).toBe("");
  });

  it("matches the prefix labelOf actually emits", () => {
    const step = bound("l1", "Rect");
    expect(step.label.startsWith(`${sharedLayerName([step])} ${DOT} `)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* labelPartsOf — the three pieces a row lays out separately            */
/* ------------------------------------------------------------------ */

describe("labelPartsOf", () => {
  it("splits property, before and after on a shape component edit", () => {
    expect(
      labelPartsOf(setStatic(["shapes", 0, "size"], { x: 100, y: 50 }, { x: 160, y: 50 })),
    ).toEqual({
      path: `Shape 1 ${DOT} size.x`,
      before: "100",
      after: "160",
    });
  });

  it("gives an add step the operand as its value and the recording as its before", () => {
    expect(labelPartsOf(setStatic(["position"], { x: 100, y: 50 }, { x: 160, y: 50 }))).toEqual({
      path: `Transform ${DOT} position.x`,
      before: `100 ${ARROW} 160`,
      after: "+60",
      seam: "operator",
    });
  });

  it("gives a multiply step the ratio as its value", () => {
    expect(labelPartsOf(setStatic(["scale"], { x: 100, y: 100 }, { x: 200, y: 100 }))).toEqual({
      path: `Transform ${DOT} scale.x`,
      before: `100 ${ARROW} 200`,
      after: `${TIMES}2`,
      seam: "operator",
    });
  });

  it("splits a stroke width edit", () => {
    expect(labelPartsOf(setStatic(["strokes", 0, "width"], 2, 4))).toEqual({
      path: `Stroke ${DOT} width`,
      before: "2",
      after: "4",
    });
  });

  it("gives a paint recolour an after with no before", () => {
    expect(labelPartsOf(setStatic(["fills", 0, "color"], BLACK, RED))).toEqual({
      path: "Fill",
      after: "#FF0000",
    });
  });

  it("keeps an arrowless label whole", () => {
    const captured = setStatic(["opacity"], 0.5, 0.5);
    expect(labelPartsOf(captured)).toEqual({ path: `Transform ${DOT} opacity = 0.5` });
    expect(
      labelPartsOf({ op: "set-plain", path: ["visible"], before: true, after: false }),
    ).toEqual({ path: `Layer ${DOT} visible off` });
  });

  it("splits a plain-flag change", () => {
    expect(
      labelPartsOf({ op: "set-plain", path: ["blendMode"], before: "NORMAL", after: "MULTIPLY" }),
    ).toEqual({ path: `Layer ${DOT} blend mode`, before: "NORMAL", after: "MULTIPLY" });
  });

  it("keeps the layer prefix on the property, never on the value", () => {
    const parts = labelPartsOf({
      op: "set-static",
      path: ["rotation"],
      before: 0,
      after: 45,
      layer: { id: "l1", name: "Rect" },
    });
    expect(parts).toEqual({
      path: `Rect ${DOT} Transform ${DOT} rotation`,
      before: `0 ${ARROW} 45`,
      after: "+45",
      seam: "operator",
    });
  });

  it("rebuilds exactly what labelOf emits", () => {
    const payloads: StepPayload[] = [
      setStatic(["position"], { x: 100, y: 50 }, { x: 160, y: 50 }),
      setStatic(["position"], { x: 100, y: 50 }, { x: 160, y: 80 }),
      setStatic(["rotation"], 0, 45),
      setStatic(["rotation"], 45, 0),
      setStatic(["scale"], { x: 100, y: 100 }, { x: 200, y: 150 }),
      setStatic(["scale"], { x: 0, y: 100 }, { x: 50, y: 200 }),
      setStatic(["shapes", 0, "size"], { x: 100, y: 50 }, { x: 160, y: 50 }),
      setStatic(["opacity"], 0.5, 0.5),
      setStatic(["fills", 0, "color"], BLACK, RED),
      setStatic(["fills", 1, "color"], BLACK, GREEN),
      setStatic(["strokes", 0, "width"], 2, 4),
      setStatic(["strokes", 0, "fill", "color"], BLACK, RED),
      setStatic(["shapes", 1, "size"], { x: 10, y: 10 }, { x: 20, y: 10 }),
      { op: "set-plain", path: ["blendMode"], before: "NORMAL", after: "MULTIPLY" },
      { op: "set-plain", path: ["visible"], before: true, after: false },
      { op: "keyframes", path: ["position"], added: [kf(12)], removed: [], changed: [] },
      {
        op: "keyframes",
        path: ["position"],
        added: [kf(12)],
        removed: [],
        changed: [],
        apply: { x: { scale: 1, offset: 10 }, y: { scale: 1, offset: 0 } },
      },
      {
        op: "set-static",
        path: ["position"],
        before: { x: 100, y: 50 },
        after: { x: 210, y: 50 },
        apply: { x: { scale: 2, offset: 10 }, y: { scale: 1, offset: 0 } },
      },
      {
        op: "set-static",
        path: ["rotation"],
        before: 45,
        after: 0,
        apply: { scale: 0, offset: 0 },
      },
      { op: "add-fill", spec: solid(RED) },
      { op: "remove-paint", path: ["fills", 1] },
      { op: "add-shape", parentPath: [], spec: shapeSpec("RECTANGLE") },
    ];
    for (const payload of payloads) {
      expect(joinLabelParts(labelPartsOf(payload))).toBe(labelOf(payload));
    }
  });
});

describe("labelOf — scene settings", () => {
  it("says a size change in pixels, not as an object dump", () => {
    expect(
      labelOf({
        op: "set-scene",
        key: "size",
        before: { width: 1920, height: 1080 },
        after: { width: 1080, height: 1080 },
      }),
    ).toBe("Scene · size 1920×1080 → 1080×1080");
  });

  it("names the units for framerate and duration, and transparency for a null background", () => {
    expect(labelOf({ op: "set-scene", key: "framerate", before: 30, after: 60 })).toBe(
      "Scene · framerate 30fps → 60fps",
    );
    expect(labelOf({ op: "set-scene", key: "duration", before: 5, after: 7.5 })).toBe(
      "Scene · duration 5s → 7.5s",
    );
    expect(
      labelOf({
        op: "set-scene",
        key: "backgroundColor",
        before: { r: 255, g: 255, b: 255 },
        after: null,
      }),
    ).toBe("Scene · background #FFFFFF → transparent");
  });

  it("splits at the arrow seam like every other label", () => {
    const payload: StepPayload = {
      op: "set-scene",
      key: "size",
      before: { width: 1920, height: 1080 },
      after: { width: 1080, height: 1080 },
    };
    expect(labelPartsOf(payload)).toEqual({
      path: "Scene · size",
      before: "1920×1080",
      after: "1080×1080",
    });
    expect(joinLabelParts(labelPartsOf(payload))).toBe(labelOf(payload));
  });

  it("rides the layer icon lane — no new StepKind reaches the UI's icon map", () => {
    expect(kindOf({ op: "set-scene", key: "framerate", before: 30, after: 60 })).toBe("layer");
  });
});

describe("labelOf — a flag on a mask names the mask", () => {
  it("says 'Mask · mode', not 'Layer · mode'", () => {
    expect(
      labelOf({ op: "set-plain", path: ["masks", 0, "mode"], before: "add", after: "subtract" }),
    ).toBe("Mask · mode add → subtract");
    expect(
      labelOf({ op: "set-plain", path: ["masks", 1, "mode"], before: "add", after: "intersect" }),
    ).toBe("Mask 2 · mode add → intersect");
    // ...and it rides the mask icon lane, not the layer one.
    expect(
      kindOf({ op: "set-plain", path: ["masks", 0, "mode"], before: "add", after: "subtract" }),
    ).toBe("mask");
    expect(kindOf({ op: "set-plain", path: ["visible"], before: true, after: false })).toBe(
      "layer",
    );
  });
});

describe("propDisplayName", () => {
  it("says a layer's timeline window the way Creator says it", () => {
    // Notes and step labels read these words to the user, so "startFrame"
    // never reaches a note (docs/contributing/writing-style.md).
    expect(propDisplayName("startFrame")).toBe("in point");
    expect(propDisplayName("endFrame")).toBe("out point");
    expect(propDisplayName("timelineOffset")).toBe("timeline offset");
  });

  it("passes an unmapped name through unchanged", () => {
    expect(propDisplayName("opacity")).toBe("opacity");
  });
});
