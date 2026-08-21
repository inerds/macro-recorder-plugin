import { describe, expect, it } from "vitest";

import type { Json } from "./json";
import { labelOf } from "./labels";
import type { AnimatableSnapshot, KfSnap, PaintSnapshot, Path } from "./snapshot";
import { buildStep, kindOf, type StepPayload } from "./steps";

/*
 * Exact-string assertions below. Three of the characters labels.ts emits are
 * not ASCII and are easy to mistype, so they are named here:
 *   "·" MIDDLE DOT      — the "Transform · " separator
 *   "→" RIGHTWARDS ARROW — the before → after arrow
 *   "−" MINUS SIGN       — the removed-keyframe count prefix (not "-")
 *   "–" EN DASH          — how fmt() renders null (not "-")
 */
const DOT = "·";
const ARROW = "→";
const MINUS = "−";
const EN_DASH = "–";

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
    expect(labelOf(setStatic(["position"], { x: 100, y: 50 }, { x: 200, y: 50 }))).toBe(
      `Transform ${DOT} position.x 100 ${ARROW} 200`,
    );
  });

  it("shows the whole vector when more than one component changed", () => {
    expect(labelOf(setStatic(["position"], { x: 100, y: 50 }, { x: 200, y: 80 }))).toBe(
      `Transform ${DOT} position (x: 100, y: 50) ${ARROW} (x: 200, y: 80)`,
    );
  });

  it("labels a scalar transform prop", () => {
    expect(labelOf(setStatic(["rotation"], 0, 45))).toBe(`Transform ${DOT} rotation 0 ${ARROW} 45`);
    expect(labelOf(setStatic(["opacity"], 1, 0.5))).toBe(`Transform ${DOT} opacity 1 ${ARROW} 0.5`);
  });

  it("names the changed component for scale too", () => {
    expect(labelOf(setStatic(["scale"], { x: 1, y: 1 }, { x: 2, y: 1 }))).toBe(
      `Transform ${DOT} scale.x 1 ${ARROW} 2`,
    );
  });

  it("rounds numbers to two decimals", () => {
    expect(labelOf(setStatic(["rotation"], 0, 45.6789))).toBe(
      `Transform ${DOT} rotation 0 ${ARROW} 45.68`,
    );
  });

  it("renders a null side as an en dash", () => {
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
    expect(
      labelOf(setStatic(["fills", 0, "stops"], [], [{ offset: 0, color: RED }])),
    ).toBe(`Fill stops ${ARROW} [(offset: 0, color: #FF0000)]`);
  });

  it("labels a stroke width change", () => {
    expect(labelOf(setStatic(["strokes", 0, "width"], 2, 4))).toBe(`Stroke ${DOT} width 2 ${ARROW} 4`);
  });

  it("labels a stroke paint change as color, with 1-based index past the first", () => {
    expect(labelOf(setStatic(["strokes", 0, "fill", "color"], BLACK, RED))).toBe(
      `Stroke ${DOT} color #000000 ${ARROW} #FF0000`,
    );
    expect(labelOf(setStatic(["strokes", 1, "width"], 2, 4))).toBe(`Stroke 2 ${DOT} width 2 ${ARROW} 4`);
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
      labelOf({ op: "keyframes", path: ["position"], added: [kf(12.345)], removed: [], changed: [] }),
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
      labelOf({ op: "keyframes", path: ["position"], added: [], removed: [kf(0), kf(30)], changed: [] }),
    ).toBe(`Keyframes ${DOT} position (${MINUS}2)`);
    expect(
      labelOf({ op: "keyframes", path: ["opacity"], added: [kf(0), kf(30)], removed: [], changed: [] }),
    ).toBe(`Keyframes ${DOT} opacity (+2)`);
  });

  it("uses the paint prop name for keyframes on a fill", () => {
    expect(
      labelOf({ op: "keyframes", path: ["fills", 0, "color"], added: [kf(12)], removed: [], changed: [] }),
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
      labelOf({ op: "add-fill", spec: { kind: "gradient", stops: { animated: false, static: [] } } }),
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
      [{ op: "add-stroke", path: ["strokes", 0], spec: { width: 2, fill: solid(BLACK) } }, "stroke"],
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
