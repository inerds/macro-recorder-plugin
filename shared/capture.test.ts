import { describe, expect, it } from "vitest";

import {
  captureKeyframePayloads,
  countKeyframes,
  countSelectedMatches,
  type SelectedKf,
} from "./capture";
import type { Json } from "./json";
import type {
  AnimatableSnapshot,
  KfSnap,
  NodeSnapshot,
  PaintSnapshot,
} from "./snapshot";

/* fixtures — same conventions as diff.test.ts */

const RED: Json = { r: 255, g: 0, b: 0 };
const BLUE: Json = { r: 0, g: 0, b: 255 };

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

function solid(color: AnimatableSnapshot): PaintSnapshot {
  return { kind: "solid", color };
}

function pathsOf(payloads: ReturnType<typeof captureKeyframePayloads>) {
  return payloads.map((p) => ("path" in p ? p.path : []));
}

function makeNode(overrides: Partial<NodeSnapshot> = {}): NodeSnapshot {
  return {
    nodeId: "layer-1",
    nodeType: "CONTAINER",
    nodeName: "Text 1",
    props: {},
    plain: {},
    fills: [],
    strokes: [],
    masks: [],
    shapes: [],
    ...overrides,
  };
}

/** A layer animated at every level the differ can address. */
function richLayer(): NodeSnapshot {
  return makeNode({
    props: {
      position: anim(undefined, [kf(0, { x: 0, y: 0 }, "id-a", "LINEAR"), kf(30, { x: 5, y: 5 }, "id-b")]),
      rotation: anim(0), // static — no keyframes, must be skipped
    },
    fills: [solid(anim(undefined, [kf(10, RED), kf(40, BLUE)]))],
    strokes: [
      {
        width: anim(undefined, [kf(12, 2)]),
        fill: solid(anim(undefined, [kf(14, RED)])),
      },
    ],
    trims: [{ start: anim(undefined, [kf(20, 0)]), end: anim(0.5), offset: anim(0) }],
    masks: [{ pathData: anim(undefined, [kf(22, "M0 0")]), opacity: anim(1) }],
    shapes: [
      makeNode({
        nodeId: "shape-1",
        nodeType: "GROUP",
        nodeName: "Group 1",
        shapes: [
          makeNode({
            nodeId: "shape-2",
            nodeType: "RECTANGLE",
            nodeName: "Rect",
            props: { size: anim(undefined, [kf(5, { x: 80, y: 60 })]) },
          }),
        ],
      }),
    ],
  });
}

describe("countKeyframes", () => {
  it("counts animated paths and total keyframes across the subtree", () => {
    expect(countKeyframes(richLayer())).toEqual({ pathCount: 7, keyframeCount: 9 });
  });

  it("reports zero for a static layer", () => {
    expect(countKeyframes(makeNode({ props: { position: anim({ x: 0, y: 0 }) } }))).toEqual({
      pathCount: 0,
      keyframeCount: 0,
    });
  });
});

describe("captureKeyframePayloads — scope all", () => {
  it("emits one keyframes payload per animated path, differ-addressed", () => {
    const payloads = captureKeyframePayloads(richLayer(), { scope: "all" });
    expect(pathsOf(payloads)).toEqual([
      ["position"],
      ["fills", 0, "color"],
      ["strokes", 0, "width"],
      ["strokes", 0, "fill", "color"],
      ["trimPaths", 0, "start"],
      ["masks", 0, "pathData"],
      ["shapes", 0, "shapes", 0, "size"],
    ]);
    for (const p of payloads) {
      expect(p.op).toBe("keyframes");
      if (p.op !== "keyframes") continue;
      expect(p.removed).toEqual([]);
      expect(p.changed).toEqual([]);
      expect(p.added.length).toBeGreaterThan(0);
      expect(p.layer).toEqual({ id: "layer-1", name: "Text 1" });
    }
  });

  it("strips host keyframe ids but keeps easing", () => {
    const payloads = captureKeyframePayloads(richLayer(), { scope: "all" });
    const position = payloads.find((p) => "path" in p && p.path.join(".") === "position");
    expect(position && position.op === "keyframes" ? position.added : []).toEqual([
      { frame: 0, value: { x: 0, y: 0 }, easing: "LINEAR" },
      { frame: 30, value: { x: 5, y: 5 } },
    ]);
  });

  it("annotates deep-shape paths with the DEEPEST shape's type", () => {
    const payloads = captureKeyframePayloads(richLayer(), { scope: "all" });
    const size = payloads.find((p) => "path" in p && p.path.includes("size"));
    expect(size && "shapeHint" in size ? size.shapeHint : undefined).toBe("RECTANGLE");
    const position = payloads.find((p) => "path" in p && p.path.join(".") === "position");
    expect(position && "shapeHint" in position ? position.shapeHint : undefined).toBeUndefined();
  });

  it("returns [] for a layer with no keyframes", () => {
    expect(captureKeyframePayloads(makeNode(), { scope: "all" })).toEqual([]);
  });
});

describe("captureKeyframePayloads — scope selected", () => {
  const layer = makeNode({
    props: {
      position: anim(undefined, [kf(0, { x: 0, y: 0 }), kf(30, { x: 5, y: 5 })]),
      scale: anim(undefined, [kf(30, { x: 5, y: 5 }), kf(60, { x: 2, y: 2 })]),
    },
  });

  it("keeps only frame+value matches", () => {
    const selected: SelectedKf[] = [{ frame: 30, value: { x: 5, y: 5 } }];
    const payloads = captureKeyframePayloads(layer, { scope: "selected", selected });
    // frame 30 with equal values exists on BOTH paths — ambiguity includes all
    expect(pathsOf(payloads)).toEqual([["position"], ["scale"]]);
    for (const p of payloads) {
      if (p.op === "keyframes") expect(p.added).toEqual([{ frame: 30, value: { x: 5, y: 5 } }]);
    }
  });

  it("matches by frame alone when the selected value was unreadable", () => {
    const payloads = captureKeyframePayloads(layer, {
      scope: "selected",
      selected: [{ frame: 60, value: null }],
    });
    expect(pathsOf(payloads)).toEqual([["scale"]]);
  });

  it("tolerates float frame jitter within epsilon", () => {
    const payloads = captureKeyframePayloads(layer, {
      scope: "selected",
      selected: [{ frame: 30 + 1e-9, value: { x: 5, y: 5 } }],
    });
    expect(payloads.length).toBe(2);
  });

  it("returns [] when nothing matches (caller maps to an error)", () => {
    expect(
      captureKeyframePayloads(layer, { scope: "selected", selected: [{ frame: 999, value: null }] }),
    ).toEqual([]);
  });
});

describe("countSelectedMatches", () => {
  it("counts selected entries that belong to this layer", () => {
    const layer = makeNode({
      props: { position: anim(undefined, [kf(0, { x: 0, y: 0 }), kf(30, { x: 5, y: 5 })]) },
    });
    const selected: SelectedKf[] = [
      { frame: 0, value: { x: 0, y: 0 } }, // match
      { frame: 30, value: { x: 99, y: 99 } }, // frame hit, value miss
      { frame: 7, value: null }, // no such frame
    ];
    expect(countSelectedMatches(layer, selected)).toBe(1);
  });
});
