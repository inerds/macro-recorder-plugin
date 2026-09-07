/**
 * Recording scope: which selection means which layers, and which of a tick's
 * payloads survive that decision.
 */
import { describe, expect, it } from "vitest";

import {
  partitionByScope,
  resolveScope,
  scopeLayerRefs,
  type NodeTree,
  type RecordScope,
} from "./scope";
import type { NodeSnapshot } from "./snapshot";
import type { LayerRef, StepPayload } from "./steps";

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

function tree(nodeId: string, overrides: Partial<NodeTree> = {}): NodeTree {
  return { nodeId, shapes: [], ...overrides };
}

/**
 * A (a shape layer holding a rect and a group holding a second rect),
 * B (a plain layer) and S (a scene layer whose CHILD CHANNEL is the source
 * scene's layers — the same channel serialize.ts models).
 */
const LAYERS: NodeTree[] = [
  tree("a", {
    nodeName: "Layer A",
    nodeType: "SHAPE_LAYER",
    shapes: [tree("rect-1"), tree("group-1", { shapes: [tree("rect-2")] })],
  }),
  tree("b", { nodeName: "Layer B", nodeType: "SHAPE_LAYER" }),
  tree("s", { nodeName: "Nested", nodeType: "SCENE_LAYER", shapes: [tree("inner-1")] }),
];

const SCENE: RecordScope = { kind: "scene" };
const onlyA: RecordScope = { kind: "layers", ids: ["a"] };

function spec(nodeId: string): NodeSnapshot {
  return {
    nodeId,
    nodeType: "SHAPE_LAYER",
    props: {},
    plain: {},
    fills: [],
    strokes: [],
    masks: [],
    shapes: [],
  };
}

function ref(id: string): LayerRef {
  return { id };
}

/** A path op bound to a layer — the shape most payloads take. */
function edit(layerId: string): StepPayload {
  return { op: "set-static", path: ["position"], before: 0, after: 1, layer: ref(layerId) };
}

function partition(payloads: StepPayload[], scope: RecordScope = onlyA) {
  return partitionByScope(payloads, scope);
}

/* ------------------------------------------------------------------ */
/* resolveScope                                                        */
/* ------------------------------------------------------------------ */

describe("resolveScope", () => {
  it("resolves a selected shape to its owning top-level layer", () => {
    expect(resolveScope(LAYERS, ["rect-1"])).toEqual({
      scope: { kind: "layers", ids: ["a"] },
      unresolved: [],
      fellBack: false,
    });
  });

  it("resolves a shape nested inside a group to the same layer", () => {
    expect(resolveScope(LAYERS, ["rect-2"]).scope).toEqual({ kind: "layers", ids: ["a"] });
  });

  it("resolves a node inside a scene layer's child channel to the scene layer", () => {
    expect(resolveScope(LAYERS, ["inner-1"]).scope).toEqual({ kind: "layers", ids: ["s"] });
  });

  it("records the whole scene when nothing is selected, and does not call that a fallback", () => {
    expect(resolveScope(LAYERS, [])).toEqual({
      scope: { kind: "scene" },
      unresolved: [],
      fellBack: false,
    });
  });

  it("falls back to the whole scene, and says so, when no selected id is in this scene", () => {
    expect(resolveScope(LAYERS, ["ghost"])).toEqual({
      scope: { kind: "scene" },
      unresolved: ["ghost"],
      fellBack: true,
    });
  });

  it("keeps the layers it did resolve when only some ids are unknown", () => {
    expect(resolveScope(LAYERS, ["ghost", "b"])).toEqual({
      scope: { kind: "layers", ids: ["b"] },
      unresolved: ["ghost"],
      fellBack: false,
    });
  });

  it("keeps snapshot order and counts one layer once, however the shapes were picked", () => {
    expect(resolveScope(LAYERS, ["b", "rect-2", "rect-1"]).scope).toEqual({
      kind: "layers",
      ids: ["a", "b"],
    });
  });
});

describe("scopeLayerRefs", () => {
  it("names the scoped layers", () => {
    expect(scopeLayerRefs(LAYERS, { kind: "layers", ids: ["a", "s"] })).toEqual([
      { id: "a", name: "Layer A" },
      { id: "s", name: "Nested" },
    ]);
  });

  it("still refs a grown id the snapshot does not know yet", () => {
    expect(scopeLayerRefs(LAYERS, { kind: "layers", ids: ["fresh"] })).toEqual([{ id: "fresh" }]);
  });

  it("has nothing to name in scene scope", () => {
    expect(scopeLayerRefs(LAYERS, SCENE)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* partitionByScope — scene scope                                      */
/* ------------------------------------------------------------------ */

describe("partitionByScope — scene scope", () => {
  it("keeps every payload and ignores nothing", () => {
    const payloads: StepPayload[] = [
      edit("a"),
      edit("b"),
      { op: "set-scene", key: "name", before: "Old", after: "New" },
      { op: "reorder-layers", order: [1, 0], layers: [ref("b"), ref("a")] },
    ];
    const result = partition(payloads, SCENE);
    expect(result.kept).toEqual(payloads);
    expect(result.ignored).toBe(0);
    expect(result.scope).toEqual(SCENE);
  });
});

/* ------------------------------------------------------------------ */
/* partitionByScope — layer scope, one table row at a time             */
/* ------------------------------------------------------------------ */

describe("partitionByScope — layer scope", () => {
  it("keeps a path op on a scoped layer and drops one on any other", () => {
    const result = partition([edit("a"), edit("b")]);
    expect(result.kept).toEqual([edit("a")]);
    expect(result.ignored).toBe(1);
  });

  it("keeps every op that carries a scoped layer binding, whatever the op", () => {
    const payloads: StepPayload[] = [
      { op: "add-paint", path: ["fills", 0], spec: { kind: "unknown" }, layer: ref("a") },
      { op: "remove-shape", path: ["shapes", 0], layer: ref("a") },
      { op: "reorder-shapes", path: [], order: [1, 0], layer: ref("a") },
    ];
    expect(partition(payloads).kept).toEqual(payloads);
  });

  it("keeps a legacy payload that carries no layer binding at all", () => {
    const legacy: StepPayload[] = [
      { op: "add-fill", spec: { kind: "unknown" } },
      { op: "set-static", path: ["position"], before: 0, after: 1 },
      { op: "not-replayable", description: "you switched scenes" },
    ];
    const result = partition(legacy);
    expect(result.kept).toEqual(legacy);
    expect(result.ignored).toBe(0);
  });

  it("always keeps add-layer and grows the scope with the new layer", () => {
    const result = partition([{ op: "add-layer", spec: spec("c") }, edit("c")]);
    expect(result.kept).toHaveLength(2);
    expect(result.ignored).toBe(0);
    expect(result.scope).toEqual({ kind: "layers", ids: ["a", "c"] });
  });

  it("keeps an edit to a layer added in the SAME tick whichever order the payloads arrive in", () => {
    const added: StepPayload = { op: "add-layer", spec: spec("c") };
    expect(partition([added, edit("c")]).ignored).toBe(0);
    expect(partition([edit("c"), added]).ignored).toBe(0);
  });

  it("keeps a clone of an UNSCOPED layer, cloneOf intact, and records edits to the copy", () => {
    const cloned: StepPayload = { op: "add-layer", spec: spec("b-copy"), cloneOf: ref("b") };
    const result = partition([cloned, edit("b-copy"), edit("b")]);
    // The copy is the user's own new layer; the original is still not watched.
    expect(result.kept).toEqual([cloned, edit("b-copy")]);
    expect(result.ignored).toBe(1);
    expect((result.kept[0] as { cloneOf?: LayerRef }).cloneOf).toEqual(ref("b"));
  });

  it("keeps remove-layer for a scoped layer only", () => {
    const result = partition([
      { op: "remove-layer", layer: ref("a") },
      { op: "remove-layer", layer: ref("b") },
    ]);
    expect(result.kept).toEqual([{ op: "remove-layer", layer: ref("a") }]);
    expect(result.ignored).toBe(1);
  });

  it("keeps nest-layers when ANY nested layer is scoped, and grows with the new scene layer", () => {
    const nest: StepPayload = {
      op: "nest-layers",
      layers: [ref("a"), ref("b")],
      spec: spec("nested"),
    };
    const result = partition([nest, edit("nested")]);
    expect(result.kept).toEqual([nest, edit("nested")]);
    expect(result.scope).toEqual({ kind: "layers", ids: ["a", "nested"] });
  });

  it("drops a nest of layers the recording does not watch", () => {
    const nest: StepPayload = {
      op: "nest-layers",
      layers: [ref("b"), ref("c")],
      spec: spec("nested"),
    };
    const result = partition([nest]);
    expect(result.kept).toEqual([]);
    expect(result.ignored).toBe(1);
    expect(result.scope).toEqual(onlyA);
  });

  it("keeps break-scene for a scoped layer and grows with everything it spilled", () => {
    const broken: StepPayload = {
      op: "break-scene",
      layer: ref("a"),
      fallback: [spec("piece-1"), spec("piece-2")],
    };
    const result = partition([broken, edit("piece-2")]);
    expect(result.kept).toEqual([broken, edit("piece-2")]);
    expect(result.scope).toEqual({ kind: "layers", ids: ["a", "piece-1", "piece-2"] });
  });

  it("drops break-scene on an unscoped layer, and does not adopt its contents", () => {
    const broken: StepPayload = {
      op: "break-scene",
      layer: ref("b"),
      fallback: [spec("piece-1")],
    };
    const result = partition([broken, edit("piece-1")]);
    expect(result.kept).toEqual([]);
    expect(result.ignored).toBe(2);
    expect(result.scope).toEqual(onlyA);
  });

  it("keeps a reorder that moved a scoped layer", () => {
    // [a, b, c] → [b, c, a]: a is at index 2 and came from index 0.
    const reorder: StepPayload = {
      op: "reorder-layers",
      order: [1, 2, 0],
      layers: [ref("b"), ref("c"), ref("a")],
    };
    expect(partition([reorder]).kept).toEqual([reorder]);
  });

  it("drops a reorder that only swapped layers the recording does not watch", () => {
    // [a, b, c] → [a, c, b]: a never moved, so nothing the user asked for did.
    const reorder: StepPayload = {
      op: "reorder-layers",
      order: [0, 2, 1],
      layers: [ref("a"), ref("c"), ref("b")],
    };
    const result = partition([reorder]);
    expect(result.kept).toEqual([]);
    expect(result.ignored).toBe(1);
  });

  it("keeps a legacy reorder payload that carries no identities to judge", () => {
    const reorder: StepPayload = { op: "reorder-layers", order: [1, 0] };
    expect(partition([reorder]).kept).toEqual([reorder]);
  });

  it("ignores scene settings in layer scope and keeps them in scene scope", () => {
    const setScene: StepPayload = {
      op: "set-scene",
      key: "backgroundColor",
      before: null,
      after: { r: 1, g: 1, b: 1 },
    };
    expect(partition([setScene]).kept).toEqual([]);
    expect(partition([setScene]).ignored).toBe(1);
    expect(partition([setScene], SCENE).kept).toEqual([setScene]);
  });
});
