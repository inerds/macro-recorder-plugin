import { describe, expect, it } from "vitest";

import { diffScene, diffSnapshots } from "./diff";
import type { Json } from "./json";
import type {
  AnimatableSnapshot,
  KfSnap,
  NodeSnapshot,
  PaintSnapshot,
  StrokeSnapshot,
} from "./snapshot";
import { kindOf, type StepPayload } from "./steps";

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

const RED: Json = { r: 255, g: 0, b: 0 };
const BLUE: Json = { r: 0, g: 0, b: 255 };
const BLACK: Json = { r: 0, g: 0, b: 0 };

function anim(staticValue?: Json, keyframes?: KfSnap[]): AnimatableSnapshot {
  const snap: AnimatableSnapshot = { animated: Boolean(keyframes && keyframes.length) };
  if (staticValue !== undefined) snap.static = staticValue;
  if (keyframes) snap.keyframes = keyframes;
  return snap;
}

function kf(frame: number, value: Json, id?: string, easing?: Json): KfSnap {
  const snap: KfSnap = { frame, value };
  if (id !== undefined) snap.id = id;
  if (easing !== undefined) snap.easing = easing;
  return snap;
}

function solid(color: Json): PaintSnapshot {
  return { kind: "solid", color: anim(color) };
}

function gradient(stops: Json): PaintSnapshot {
  return { kind: "gradient", stops: anim(stops) };
}

function stroke(width?: Json, fill: PaintSnapshot = solid(BLACK)): StrokeSnapshot {
  return { width: anim(width), fill };
}

function makeNode(overrides: Partial<NodeSnapshot> = {}): NodeSnapshot {
  return {
    nodeId: "node-1",
    nodeType: "CONTAINER",
    props: {},
    plain: {},
    fills: [],
    strokes: [],
    masks: [],
    shapes: [],
    ...overrides,
  };
}

function makeShape(id: string, type: string, overrides: Partial<NodeSnapshot> = {}): NodeSnapshot {
  return makeNode({ nodeId: id, nodeType: type, ...overrides });
}

/** Diffs two nodes that differ only in the given overrides. */
function diffProps(
  prevProps: Record<string, AnimatableSnapshot>,
  nextProps: Record<string, AnimatableSnapshot>,
): StepPayload[] {
  return diffSnapshots(makeNode({ props: prevProps }), makeNode({ props: nextProps }));
}

/* ------------------------------------------------------------------ */
/* static property changes                                             */
/* ------------------------------------------------------------------ */

describe("diffSnapshots — static props", () => {
  it("returns an empty array when nothing changed", () => {
    const node = makeNode({
      props: { position: anim({ x: 100, y: 50 }), opacity: anim(1) },
      fills: [solid(RED)],
      strokes: [stroke(2)],
      shapes: [makeShape("c1", "RECTANGLE")],
    });

    expect(diffSnapshots(node, node)).toEqual([]);
  });

  it("emits one set-static payload for a position change", () => {
    const payloads = diffProps(
      { position: anim({ x: 100, y: 50 }) },
      { position: anim({ x: 200, y: 50 }) },
    );

    expect(payloads).toEqual([
      {
        op: "set-static",
        path: ["position"],
        before: { x: 100, y: 50 },
        after: { x: 200, y: 50 },
      },
    ]);
    expect(kindOf(payloads[0]!)).toBe("transform");
  });

  it("ignores numeric changes below the 1e-6 epsilon", () => {
    expect(diffProps({ rotation: anim(10) }, { rotation: anim(10.0000005) })).toEqual([]);
  });

  it("emits a step for numeric changes at or above the epsilon", () => {
    const payloads = diffProps({ rotation: anim(10) }, { rotation: anim(10.00001) });

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ op: "set-static", path: ["rotation"] });
  });

  it("compares vector components with the epsilon too", () => {
    expect(
      diffProps({ position: anim({ x: 1, y: 2 }) }, { position: anim({ x: 1.0000001, y: 2 }) }),
    ).toEqual([]);
  });

  it("emits one step per changed prop, in prev.props key order", () => {
    // Order comes from Object.keys(prev.props) filtered to props shared with
    // next — NOT from CANDIDATE_PROPS — so the insertion order below wins.
    const payloads = diffProps(
      { opacity: anim(1), position: anim({ x: 0, y: 0 }) },
      { opacity: anim(0.5), position: anim({ x: 10, y: 0 }) },
    );

    expect(payloads.map((p) => (p.op === "set-static" ? p.path : null))).toEqual([
      ["opacity"],
      ["position"],
    ]);
  });

  it("classifies an opacity change as a transform step", () => {
    const payloads = diffProps({ opacity: anim(1) }, { opacity: anim(0.25) });

    expect(payloads).toEqual([
      { op: "set-static", path: ["opacity"], before: 1, after: 0.25 },
    ]);
    expect(kindOf(payloads[0]!)).toBe("transform");
  });

  it("classifies a non-transform prop change as 'other'", () => {
    const payloads = diffProps(
      { size: anim({ x: 10, y: 10 }) },
      { size: anim({ x: 20, y: 10 }) },
    );

    expect(kindOf(payloads[0]!)).toBe("other");
  });

  it("treats a missing static value as null on either side", () => {
    expect(diffProps({ rotation: anim() }, { rotation: anim(45) })).toEqual([
      { op: "set-static", path: ["rotation"], before: null, after: 45 },
    ]);
    expect(diffProps({ rotation: anim(45) }, { rotation: anim() })).toEqual([
      { op: "set-static", path: ["rotation"], before: 45, after: null },
    ]);
  });

  it("skips props that exist on only one side", () => {
    // present in prev, gone from next
    expect(
      diffProps(
        { position: anim({ x: 0, y: 0 }), rotation: anim(0) },
        { position: anim({ x: 0, y: 0 }) },
      ),
    ).toEqual([]);

    // present in next only — never visited, since iteration starts from prev
    expect(
      diffProps(
        { position: anim({ x: 0, y: 0 }) },
        { position: anim({ x: 0, y: 0 }), rotation: anim(90) },
      ),
    ).toEqual([]);
  });

  it("does not crash when both snapshots have no props at all", () => {
    expect(diffSnapshots(makeNode(), makeNode())).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* paints                                                              */
/* ------------------------------------------------------------------ */

describe("diffSnapshots — fills and strokes", () => {
  it("emits a set-static for a solid fill colour change", () => {
    const payloads = diffSnapshots(
      makeNode({ fills: [solid(RED)] }),
      makeNode({ fills: [solid(BLUE)] }),
    );

    expect(payloads).toEqual([
      { op: "set-static", path: ["fills", 0, "color"], before: RED, after: BLUE },
    ]);
    expect(kindOf(payloads[0]!)).toBe("fill");
  });

  it("indexes the path by fill slot", () => {
    const payloads = diffSnapshots(
      makeNode({ fills: [solid(RED), solid(RED)] }),
      makeNode({ fills: [solid(RED), solid(BLUE)] }),
    );

    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ path: ["fills", 1, "color"] });
  });

  it("emits a set-static for a stroke width change", () => {
    const payloads = diffSnapshots(
      makeNode({ strokes: [stroke(2)] }),
      makeNode({ strokes: [stroke(4)] }),
    );

    expect(payloads).toEqual([
      { op: "set-static", path: ["strokes", 0, "width"], before: 2, after: 4 },
    ]);
    expect(kindOf(payloads[0]!)).toBe("stroke");
  });

  it("diffs the paint behind a stroke", () => {
    const payloads = diffSnapshots(
      makeNode({ strokes: [stroke(2, solid(BLACK))] }),
      makeNode({ strokes: [stroke(2, solid(RED))] }),
    );

    expect(payloads).toEqual([
      { op: "set-static", path: ["strokes", 0, "fill", "color"], before: BLACK, after: RED },
    ]);
    expect(kindOf(payloads[0]!)).toBe("stroke");
  });

  it("emits a set-static on ['fills', i, 'stops'] when gradient stops change", () => {
    const before: Json = [{ offset: 0, color: RED }];
    const after: Json = [{ offset: 0, color: RED }, { offset: 1, color: BLUE }];
    const payloads = diffSnapshots(
      makeNode({ fills: [gradient(before)] }),
      makeNode({ fills: [gradient(after)] }),
    );

    expect(payloads).toEqual([
      { op: "set-static", path: ["fills", 0, "stops"], before, after },
    ]);
    expect(kindOf(payloads[0]!)).toBe("fill");
  });

  it("ignores identical gradient stops", () => {
    const stops: Json = [{ offset: 0, color: RED }];

    expect(
      diffSnapshots(makeNode({ fills: [gradient(stops)] }), makeNode({ fills: [gradient(stops)] })),
    ).toEqual([]);
  });

  it("records a gradient → solid flip as replace-paint with the end-state spec", () => {
    const after = solid(BLUE);
    const payloads = diffSnapshots(
      makeNode({ fills: [gradient([{ offset: 0, color: RED }])] }),
      makeNode({ fills: [after] }),
    );

    expect(payloads).toEqual([{ op: "replace-paint", path: ["fills", 0], spec: after }]);
  });

  it("records a solid → gradient flip as replace-paint with the end-state spec", () => {
    const after = gradient([{ offset: 0, color: BLUE }]);
    expect(
      diffSnapshots(makeNode({ fills: [solid(RED)] }), makeNode({ fills: [after] })),
    ).toEqual([{ op: "replace-paint", path: ["fills", 0], spec: after }]);
  });
});

/* ------------------------------------------------------------------ */
/* keyframes                                                           */
/* ------------------------------------------------------------------ */

describe("diffSnapshots — keyframes", () => {
  it("reports an added keyframe when both sides carry ids", () => {
    const payloads = diffProps(
      { position: anim(undefined, [kf(0, 0, "k1")]) },
      { position: anim(undefined, [kf(0, 0, "k1"), kf(60, 100, "k2")]) },
    );

    expect(payloads).toEqual([
      {
        op: "keyframes",
        path: ["position"],
        added: [kf(60, 100, "k2")],
        removed: [],
        changed: [],
      },
    ]);
    expect(kindOf(payloads[0]!)).toBe("keyframe");
  });

  it("reports a removed keyframe", () => {
    const payloads = diffProps(
      { position: anim(undefined, [kf(0, 0, "k1"), kf(60, 100, "k2")]) },
      { position: anim(undefined, [kf(0, 0, "k1")]) },
    );

    expect(payloads).toEqual([
      {
        op: "keyframes",
        path: ["position"],
        added: [],
        removed: [kf(60, 100, "k2")],
        changed: [],
      },
    ]);
  });

  it("reports a value edit on the same id as changed", () => {
    const payloads = diffProps(
      { position: anim(undefined, [kf(0, 0, "k1")]) },
      { position: anim(undefined, [kf(0, 5, "k1")]) },
    );

    expect(payloads).toEqual([
      {
        op: "keyframes",
        path: ["position"],
        added: [],
        removed: [],
        changed: [{ before: kf(0, 0, "k1"), after: kf(0, 5, "k1") }],
      },
    ]);
  });

  it("reports a moved keyframe as changed, not remove + add", () => {
    const payloads = diffProps(
      { position: anim(undefined, [kf(0, 0, "k1")]) },
      { position: anim(undefined, [kf(30, 0, "k1")]) },
    );

    expect(payloads).toEqual([
      {
        op: "keyframes",
        path: ["position"],
        added: [],
        removed: [],
        changed: [{ before: kf(0, 0, "k1"), after: kf(30, 0, "k1") }],
      },
    ]);
  });

  it("reports an easing edit as changed", () => {
    const payloads = diffProps(
      { position: anim(undefined, [kf(0, 0, "k1", { i: 0.1 })]) },
      { position: anim(undefined, [kf(0, 0, "k1", { i: 0.9 })]) },
    );

    expect(payloads).toEqual([
      {
        op: "keyframes",
        path: ["position"],
        added: [],
        removed: [],
        changed: [{ before: kf(0, 0, "k1", { i: 0.1 }), after: kf(0, 0, "k1", { i: 0.9 }) }],
      },
    ]);
  });

  it("matches on frame when neither side carries ids", () => {
    const payloads = diffProps(
      { position: anim(undefined, [kf(0, 0), kf(30, 10)]) },
      { position: anim(undefined, [kf(0, 0), kf(30, 99)]) },
    );

    expect(payloads).toEqual([
      {
        op: "keyframes",
        path: ["position"],
        added: [],
        removed: [],
        changed: [{ before: kf(30, 10), after: kf(30, 99) }],
      },
    ]);
  });

  it("represents a value edit as changed, not add+remove, when Creator reassigns the keyframe's id (trace: stroke width 10→20 @ frame 126, id 9aMFpZsFtP→N-i0KXFbuf) — currently splits into add+remove", () => {
    // shared/diff.ts:32-35 keys by id whenever both sides carry ids, which
    // plugin/serialize.ts always does. Creator reassigns ids on every value
    // edit (confirmed in a real trace), so this is the path production code
    // ALWAYS takes for a plain value edit — not an edge case.
    const prevKf = kf(126, 10, "9aMFpZsFtP");
    const nextKf = kf(126, 20, "N-i0KXFbuf");

    const payloads = diffSnapshots(
      makeNode({ strokes: [{ width: anim(undefined, [prevKf]), fill: solid(BLACK) }] }),
      makeNode({ strokes: [{ width: anim(undefined, [nextKf]), fill: solid(BLACK) }] }),
    );

    expect(payloads).toEqual([
      {
        op: "keyframes",
        path: ["strokes", 0, "width"],
        added: [],
        removed: [],
        changed: [{ before: prevKf, after: nextKf }],
      },
    ]);
  });

  it("represents a same-frame value edit on a plain prop as changed even when the id is reassigned — currently splits into add+remove", () => {
    const prevKf = kf(10, 5, "old-id");
    const nextKf = kf(10, 8, "new-id");

    const payloads = diffProps(
      { opacity: anim(undefined, [prevKf]) },
      { opacity: anim(undefined, [nextKf]) },
    );

    expect(payloads).toEqual([
      {
        op: "keyframes",
        path: ["opacity"],
        added: [],
        removed: [],
        changed: [{ before: prevKf, after: nextKf }],
      },
    ]);
  });

  it("represents a genuine move (frame changes, value identical) as changed even when the recycled id differs — currently splits into add+remove", () => {
    // Ids are pooled/recycled (confirmed in trace: they cycle back to a
    // previously-used value), so they cannot be assumed stable across a move
    // either. A real move should still collapse to one 'changed' entry.
    const prevKf = kf(100, 10, "id-A");
    const nextKf = kf(150, 10, "id-B");

    const payloads = diffProps(
      { position: anim(undefined, [prevKf]) },
      { position: anim(undefined, [nextKf]) },
    );

    expect(payloads).toEqual([
      {
        op: "keyframes",
        path: ["position"],
        added: [],
        removed: [],
        changed: [{ before: prevKf, after: nextKf }],
      },
    ]);
  });

  it("still ignores keyframe-count-preserving no-ops", () => {
    expect(
      diffProps(
        { position: anim(undefined, [kf(0, 0), kf(30, 10)]) },
        { position: anim(undefined, [kf(0, 0), kf(30, 10)]) },
      ),
    ).toEqual([]);
  });

  it("keys both sides by frame when only one side carries ids", () => {
    const payloads = diffProps(
      { position: anim(undefined, [kf(0, 0, "k1")]) },
      { position: anim(undefined, [kf(0, 5)]) },
    );

    expect(payloads).toEqual([
      {
        op: "keyframes",
        path: ["position"],
        added: [],
        removed: [],
        changed: [{ before: kf(0, 0, "k1"), after: kf(0, 5) }],
      },
    ]);
  });

  it("collapses duplicate frames when ids are missing", () => {
    // BUG-adjacent: two id-less keyframes on the same frame share the "f:0"
    // match key, so the Map keeps only the last one. Recorded here so a future
    // change to kfMatchKey is a deliberate one.
    const payloads = diffProps(
      { position: anim(undefined, [kf(0, 1), kf(0, 2)]) },
      { position: anim(undefined, [kf(0, 2)]) },
    );

    expect(payloads).toEqual([]);
  });

  it("emits both a static and a keyframe step when both changed", () => {
    const payloads = diffProps(
      { position: anim(0, [kf(0, 0, "k1")]) },
      { position: anim(5, [kf(0, 0, "k1"), kf(60, 10, "k2")]) },
    );

    expect(payloads.map((p) => p.op)).toEqual(["set-static", "keyframes"]);
  });

  it("does nothing when neither side has keyframes", () => {
    expect(diffProps({ position: anim(0) }, { position: anim(0) })).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* structure                                                           */
/* ------------------------------------------------------------------ */

describe("diffSnapshots — structure", () => {
  it("emits add-fill with the new paint spec when the fill list grows", () => {
    const added = solid(BLUE);
    const payloads = diffSnapshots(
      makeNode({ fills: [solid(RED)] }),
      makeNode({ fills: [solid(RED), added] }),
    );

    expect(payloads).toEqual([{ op: "add-paint", path: ["fills", 1], spec: added }]);
    expect(kindOf(payloads[0]!)).toBe("fill");
  });

  it("emits add-paint for every appended fill", () => {
    const payloads = diffSnapshots(
      makeNode({ fills: [] }),
      makeNode({ fills: [solid(RED), gradient([])] }),
    );

    expect(payloads).toEqual([
      { op: "add-paint", path: ["fills", 0], spec: solid(RED) },
      { op: "add-paint", path: ["fills", 1], spec: gradient([]) },
    ]);
  });

  it("emits remove-paint with the dropped index when the fill list shrinks", () => {
    const payloads = diffSnapshots(
      makeNode({ fills: [solid(RED), solid(BLUE)] }),
      makeNode({ fills: [solid(RED)] }),
    );

    expect(payloads).toEqual([{ op: "remove-paint", path: ["fills", 1] }]);
    expect(kindOf(payloads[0]!)).toBe("fill");
  });

  it("emits add-stroke with the static width when the stroke list grows", () => {
    const fill = solid(BLACK);
    const payloads = diffSnapshots(
      makeNode({ strokes: [] }),
      makeNode({ strokes: [{ width: anim(3), fill }] }),
    );

    expect(payloads).toEqual([{ op: "add-stroke", path: ["strokes", 0], spec: { width: 3, fill } }]);
    expect(kindOf(payloads[0]!)).toBe("stroke");
  });

  it("defaults an added stroke without a static width to 1", () => {
    const payloads = diffSnapshots(makeNode({ strokes: [] }), makeNode({ strokes: [stroke()] }));

    expect(payloads).toEqual([
      { op: "add-stroke", path: ["strokes", 0], spec: { width: 1, fill: solid(BLACK) } },
    ]);
  });

  it("emits remove-paint on ['strokes', i] when the stroke list shrinks", () => {
    const payloads = diffSnapshots(
      makeNode({ strokes: [stroke(2), stroke(4)] }),
      makeNode({ strokes: [stroke(2)] }),
    );

    expect(payloads).toEqual([{ op: "remove-paint", path: ["strokes", 1] }]);
    expect(kindOf(payloads[0]!)).toBe("stroke");
  });

  it("emits add-shape with the full subtree spec for a new child id", () => {
    const added = makeShape("c2", "ELLIPSE", { props: { size: anim({ x: 10, y: 10 }) } });
    const payloads = diffSnapshots(
      makeNode({ shapes: [makeShape("c1", "RECTANGLE")] }),
      makeNode({ shapes: [makeShape("c1", "RECTANGLE"), added] }),
    );

    expect(payloads).toEqual([{ op: "add-shape", parentPath: [], spec: added }]);
    expect(kindOf(payloads[0]!)).toBe("shape");
  });

  it("emits remove-shape at the previous index for a removed child", () => {
    const payloads = diffSnapshots(
      makeNode({ shapes: [makeShape("c1", "RECTANGLE"), makeShape("c2", "ELLIPSE")] }),
      makeNode({ shapes: [makeShape("c1", "RECTANGLE")] }),
    );

    expect(payloads).toEqual([
      { op: "remove-shape", path: ["shapes", 1], shapeType: "ELLIPSE" },
    ]);
    expect(kindOf(payloads[0]!)).toBe("shape");
  });

  it("orders payloads props → fills (edits then adds) → strokes → shapes", () => {
    const prev = makeNode({
      props: { position: anim({ x: 0, y: 0 }) },
      fills: [solid(RED)],
      strokes: [stroke(2)],
      shapes: [],
    });
    const next = makeNode({
      props: { position: anim({ x: 10, y: 0 }) },
      fills: [solid(BLUE), solid(RED)],
      strokes: [stroke(4)],
      shapes: [makeShape("c9", "GROUP")],
    });

    expect(diffSnapshots(prev, next).map((p) => p.op)).toEqual([
      "set-static", // position
      "set-static", // fills[0].color
      "add-paint", // fills[1]
      "set-static", // strokes[0].width
      "add-shape",
    ]);
  });
});

describe("diffSnapshots — v2 recursion", () => {
  it("emits a deep set-static with a shape-type hint for a child geometry edit", () => {
    const prev = makeNode({
      shapes: [makeShape("c1", "RECTANGLE", { props: { size: anim({ x: 80, y: 60 }) } })],
    });
    const next = makeNode({
      shapes: [makeShape("c1", "RECTANGLE", { props: { size: anim({ x: 200, y: 100 }) } })],
    });

    expect(diffSnapshots(prev, next)).toEqual([
      {
        op: "set-static",
        path: ["shapes", 0, "size"],
        before: { x: 80, y: 60 },
        after: { x: 200, y: 100 },
        shapeHint: "RECTANGLE",
      },
    ]);
  });

  it("recurses through nested groups with the leaf shape's hint", () => {
    const leaf = (v: number) =>
      makeShape("leaf", "STAR", { props: { innerRadius: anim(v) } });
    const prev = makeNode({ shapes: [makeShape("g1", "GROUP", { shapes: [leaf(10)] })] });
    const next = makeNode({ shapes: [makeShape("g1", "GROUP", { shapes: [leaf(25)] })] });

    expect(diffSnapshots(prev, next)).toEqual([
      {
        op: "set-static",
        path: ["shapes", 0, "shapes", 0, "innerRadius"],
        before: 10,
        after: 25,
        shapeHint: "STAR",
      },
    ]);
  });

  it("addresses edits by the CURRENT index when children were matched by id", () => {
    const rect = (v: number) =>
      makeShape("r1", "RECTANGLE", { props: { roundness: anim(v) } });
    // rectangle moved from index 0 to index 1 while its roundness changed
    const prev = makeNode({ shapes: [rect(0), makeShape("e1", "ELLIPSE")] });
    const next = makeNode({ shapes: [makeShape("e1", "ELLIPSE"), rect(8)] });

    const ops = diffSnapshots(prev, next);
    expect(ops).toContainEqual({
      op: "set-static",
      path: ["shapes", 1, "roundness"],
      before: 0,
      after: 8,
      shapeHint: "RECTANGLE",
    });
    expect(ops).toContainEqual({
      op: "reorder-shapes",
      path: [],
      order: [1, 0],
    });
  });

  it("diffs plain layer flags", () => {
    const prev = makeNode({ plain: { visible: true, blendMode: "NORMAL" } });
    const next = makeNode({ plain: { visible: false, blendMode: "NORMAL" } });

    expect(diffSnapshots(prev, next)).toEqual([
      { op: "set-plain", path: ["visible"], before: true, after: false },
    ]);
  });

  it("diffs mask opacity and emits add/remove-mask", () => {
    const mask = (opacity: number) => ({
      mode: "add",
      pathData: anim({ points: [], closed: true }),
      opacity: anim(opacity),
    });
    expect(
      diffSnapshots(makeNode({ masks: [mask(100)] }), makeNode({ masks: [mask(40)] })),
    ).toEqual([
      { op: "set-static", path: ["masks", 0, "opacity"], before: 100, after: 40 },
    ]);

    const added = mask(100);
    expect(diffSnapshots(makeNode({ masks: [] }), makeNode({ masks: [added] }))).toEqual([
      { op: "add-mask", path: ["masks", 0], spec: added },
    ]);
    expect(diffSnapshots(makeNode({ masks: [added] }), makeNode({ masks: [] }))).toEqual([
      { op: "remove-mask", path: ["masks", 0] },
    ]);
  });

  it("diffs a gradient's start point, not just its stops", () => {
    const grad = (x: number): PaintSnapshot => ({
      kind: "gradient",
      stops: anim([]),
      start: anim({ x, y: 0 }),
      end: anim({ x: 100, y: 0 }),
    });
    expect(
      diffSnapshots(makeNode({ fills: [grad(0)] }), makeNode({ fills: [grad(50)] })),
    ).toEqual([
      {
        op: "set-static",
        path: ["fills", 0, "start"],
        before: { x: 0, y: 0 },
        after: { x: 50, y: 0 },
      },
    ]);
  });
});

describe("diffSnapshots — paint opacity", () => {
  it("diffs a solid fill's opacity", () => {
    const paint = (o: number): PaintSnapshot => ({ kind: "solid", color: anim(RED), opacity: anim(o) });
    expect(
      diffSnapshots(makeNode({ fills: [paint(100)] }), makeNode({ fills: [paint(40)] })),
    ).toEqual([
      { op: "set-static", path: ["fills", 0, "opacity"], before: 100, after: 40 },
    ]);
  });
});

describe("diffScene — whole-scene recording", () => {
  const layer = (id: string, name: string, overrides: Partial<NodeSnapshot> = {}) =>
    makeNode({ nodeId: id, nodeName: name, ...overrides });
  const scene = (...layers: NodeSnapshot[]) => ({ layers });

  it("binds edits inside a surviving layer to that layer", () => {
    const prev = scene(layer("L1", "Star 1", { props: { rotation: anim(0) } }));
    const next = scene(layer("L1", "Star 1", { props: { rotation: anim(45) } }));

    expect(diffScene(prev, next)).toEqual([
      {
        op: "set-static",
        path: ["rotation"],
        before: 0,
        after: 45,
        layer: { id: "L1", name: "Star 1" },
      },
    ]);
  });

  it("detects a duplicate: a new layer structurally equal to an existing one", () => {
    const original = layer("L1", "star 6", { props: { position: anim({ x: 10, y: 10 }) } });
    const copy = layer("L2", "star 7", { props: { position: anim({ x: 10, y: 10 }) } });
    const ops = diffScene(scene(original), scene(original, copy));

    expect(ops).toEqual([{ op: "add-layer", spec: copy, cloneOf: { id: "L1", name: "star 6" } }]);
  });

  it("records a pasted layer with no structural twin as a full spec", () => {
    const existing = layer("L1", "Star 1");
    const pasted = layer("L9", "Pasted", { props: { rotation: anim(30) } });
    const ops = diffScene(scene(existing), scene(existing, pasted));

    expect(ops).toEqual([{ op: "add-layer", spec: pasted }]);
  });

  it("records layer deletion and reordering", () => {
    const a = layer("A", "a"), b = layer("B", "b"), c = layer("C", "c");
    expect(diffScene(scene(a, b), scene(a))).toEqual([
      { op: "remove-layer", layer: { id: "B", name: "b" } },
    ]);
    expect(diffScene(scene(a, b, c), scene(c, a, b))).toEqual([
      { op: "reorder-layers", order: [2, 0, 1] },
    ]);
  });

  it("a duplicate is matched even when only ids and names differ deep in the tree", () => {
    const inner = (id: string) =>
      makeShape(id, "RECTANGLE", { props: { size: anim({ x: 5, y: 5 }) } });
    const original = layer("L1", "group", { shapes: [inner("s1")] });
    const copy = layer("L2", "group copy", { shapes: [inner("s2")] });

    const ops = diffScene(scene(original), scene(original, copy));
    expect(ops).toEqual([{ op: "add-layer", spec: copy, cloneOf: { id: "L1", name: "group" } }]);
  });
});

describe("diffScene — duplicate detection with Creator's offset", () => {
  it("matches a copy whose position (and rotation) differ from the source", () => {
    const src = makeNode({
      nodeId: "L1", nodeName: "Polygon 1",
      nodeType: "CONTAINER",
      props: { position: anim({ x: 33, y: 52 }), rotation: anim(16) },
      shapes: [makeShape("s1", "POLYGON", { props: { points: anim(5) } })],
    });
    const copy = makeNode({
      nodeId: "L2", nodeName: "Polygon 2",
      nodeType: "CONTAINER",
      props: { position: anim({ x: 43, y: 62 }), rotation: anim(16) },
      shapes: [makeShape("s2", "POLYGON", { props: { points: anim(5) } })],
    });

    const ops = diffScene({ layers: [src] }, { layers: [src, copy] });
    expect(ops).toEqual([
      {
        op: "add-layer",
        spec: copy,
        cloneOf: { id: "L1", name: "Polygon 1" },
        offset: { x: 10, y: 10 },
      },
    ]);
  });

  it("still refuses to match layers with different content", () => {
    const src = makeNode({
      nodeId: "L1", nodeName: "Polygon 1", nodeType: "CONTAINER",
      shapes: [makeShape("s1", "POLYGON")],
    });
    const other = makeNode({
      nodeId: "L2", nodeName: "Ellipse 1", nodeType: "CONTAINER",
      shapes: [makeShape("s2", "ELLIPSE")],
    });
    const ops = diffScene({ layers: [src] }, { layers: [src, other] });
    expect(ops).toEqual([{ op: "add-layer", spec: other }]);
  });
});

describe("diffScene — break-scene detection and renames", () => {
  it("a vanished scene instance plus new layers in one tick records as break-scene", () => {
    const instance = makeNode({ nodeId: "I1", nodeName: "Fish", nodeType: "SCENE_LAYER" });
    const keep = makeNode({ nodeId: "K1", nodeName: "Outline", nodeType: "CONTAINER" });
    const outA = makeNode({ nodeId: "N1", nodeName: "Bubble", nodeType: "CONTAINER" });
    const outB = makeNode({
      nodeId: "N2", nodeName: "Fish", nodeType: "CONTAINER",
      shapes: [makeShape("s1", "PATH")],
    });

    const ops = diffScene({ layers: [keep, instance] }, { layers: [keep, outA, outB] });
    expect(ops).toEqual([
      {
        op: "break-scene",
        layer: { id: "I1", name: "Fish" },
        fallback: [outA, outB],
      },
    ]);
  });

  it("records a layer rename as set-plain on name", () => {
    const prev = makeNode({ nodeId: "L1", nodeName: "Text 1" });
    const next = makeNode({ nodeId: "L1", nodeName: "Text 1 (source text)" });
    expect(diffScene({ layers: [prev] }, { layers: [next] })).toEqual([
      {
        op: "set-plain",
        path: ["name"],
        before: "Text 1",
        after: "Text 1 (source text)",
        layer: { id: "L1", name: "Text 1 (source text)", priorName: "Text 1" },
      },
    ]);
  });
});

describe("text layer plain props", () => {
  it("diffs font changes as set-plain steps", () => {
    const prev = makeNode({
      nodeId: "T1", nodeName: "Text 1", nodeType: "TEXT_LAYER",
      plain: { text: "Hello", fontFamily: "Inter", fontSize: 24 },
    });
    const next = makeNode({
      nodeId: "T1", nodeName: "Text 1", nodeType: "TEXT_LAYER",
      plain: { text: "Hello!", fontFamily: "Archivo", fontSize: 24 },
    });
    const ops = diffScene({ layers: [prev] }, { layers: [next] });
    expect(ops).toContainEqual({
      op: "set-plain", path: ["text"], before: "Hello", after: "Hello!",
      layer: { id: "T1", name: "Text 1" },
    });
    expect(ops).toContainEqual({
      op: "set-plain", path: ["fontFamily"], before: "Inter", after: "Archivo",
      layer: { id: "T1", name: "Text 1" },
    });
  });
});

describe("diffScene — nest detection and instance content", () => {
  it("layers vanishing while one scene layer appears records as nest-layers", () => {
    const a = makeNode({ nodeId: "A", nodeName: "Ellipse 1", nodeType: "CONTAINER" });
    const b = makeNode({ nodeId: "B", nodeName: "Rectangle 1", nodeType: "CONTAINER" });
    const nested = makeNode({ nodeId: "N", nodeName: "Nested Scene 5", nodeType: "SCENE_LAYER" });

    const ops = diffScene({ layers: [a, b] }, { layers: [nested] });
    expect(ops).toEqual([
      {
        op: "nest-layers",
        layers: [
          { id: "A", name: "Ellipse 1" },
          { id: "B", name: "Rectangle 1" },
        ],
        spec: nested,
      },
    ]);
  });

  it("edits inside a scene instance's content diff as deep shape paths", () => {
    const content = (r: number) =>
      makeShape("inner1", "CONTAINER", { props: { rotation: anim(r) } });
    const prev = makeNode({ nodeId: "I", nodeName: "Meta Balls", nodeType: "SCENE_LAYER", shapes: [content(0)] });
    const next = makeNode({ nodeId: "I", nodeName: "Meta Balls", nodeType: "SCENE_LAYER", shapes: [content(30)] });

    expect(diffScene({ layers: [prev] }, { layers: [next] })).toEqual([
      {
        op: "set-static",
        path: ["shapes", 0, "rotation"],
        before: 0,
        after: 30,
        shapeHint: "CONTAINER",
        layer: { id: "I", name: "Meta Balls" },
      },
    ]);
  });
});
