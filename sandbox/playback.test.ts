/**
 * Playback orchestration tests with a stubbed `creator` global — covers the
 * mode selection and retargeted duplication that applier tests can't reach.
 */
import { afterEach, describe, expect, it } from "vitest";

import { makeFakeScene, makeIds, makeInnerScene, makeNode } from "../engine/testing/fakeScene";
import { playbackBegin, playbackEnd, playbackStep } from "./playback";

type Any = any;

/** The shared root (`makeFakeScene`) under the name these tests grew up with. */
const makeSceneRoot = makeFakeScene;

/**
 * Opt-in stub: `createSceneLayer()` consumes `creator.selection.nodes` into
 * the new layer. This models the HOST-MOVED path only — the real host does
 * NOT do this (docs/runtime-api.md quirk 8: it creates an empty scene layer
 * and ignores the selection), which is why `makeFakeScene` keeps the empty
 * shell and the rebuild tests below cover the real shape.
 */
function consumeSelectionOnCreate(scene: Any) {
  const create = scene.createSceneLayer;
  scene.createSceneLayer = (opts?: Any) => {
    const selected: Any[] = [...((globalThis as Any).creator?.selection?.nodes ?? [])];
    const instance = create(opts);
    for (const node of selected) {
      const at = scene.layers.indexOf(node);
      if (at >= 0) scene.layers.splice(at, 1);
    }
    instance.__setSceneContents(selected);
    return instance;
  };
  return scene;
}

/**
 * Opt-in stub: the shell's own scene carries NO layer factory, which is the
 * pessimistic reading of the live evidence (the shell has `scene.layers`, but
 * the factories on it are typed-only). Route 2 — `creator.createScene` plus
 * `createSceneLayer({ scene })` — is what has to carry the nest then.
 */
function shellWithoutInnerFactories(scene: Any) {
  const create = scene.createSceneLayer;
  scene.createSceneLayer = (opts?: Any) => {
    const shell = create(opts);
    if (!opts?.scene) delete shell.scene.createShapeLayer;
    return shell;
  };
  return scene;
}

/** Builds an ALREADY-nested scene layer, the way a prior session left it. */
function nestExisting(scene: Any, nodes: Any[], name: string) {
  for (const node of nodes) {
    const at = scene.layers.indexOf(node);
    if (at >= 0) scene.layers.splice(at, 1);
  }
  const instance = scene.createSceneLayer();
  instance.name = name;
  instance.__setSceneContents(nodes);
  return instance;
}

function stubCreator(scene: Any, selection: Any[]) {
  (globalThis as Any).creator = {
    activeScene: scene,
    selection: { nodes: selection },
    ui: { postMessage() {}, onMessage() {}, show() {} },
  };
}

afterEach(() => {
  playbackEnd();
  delete (globalThis as Any).creator;
});

function step(payload: Any) {
  return { id: "s", kind: "layer" as const, label: "x", payload };
}

describe("retargeted duplication (targets mode)", () => {
  it("clones the SELECTED layer and routes the copy's edits to its clone", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const star = scene.addLayer(makeNode("star 6", { props: { position: { x: 10, y: 10 } } }, ids));
    const polygon = scene.addLayer(
      makeNode("Polygon 1", { props: { position: { x: 500, y: 500 } } }, ids),
    );
    stubCreator(scene, [polygon]);

    const steps = [
      step({
        op: "add-layer",
        cloneOf: { id: "REC_SRC", name: "star 6" },
        spec: {
          nodeId: "REC_COPY",
          nodeType: "CONTAINER",
          nodeName: "star 7",
          props: {},
          plain: {},
          fills: [],
          strokes: [],
          masks: [],
          shapes: [],
        },
      }),
      step({
        op: "set-static",
        path: ["position"],
        before: { x: 10, y: 10 },
        after: { x: 110, y: 10 },
        layer: { id: "REC_COPY", name: "star 7" },
      }),
    ];

    const begin = playbackBegin({ steps: steps as Any });
    expect(begin.targetCount).toBe(1);

    const r0 = playbackStep({ index: 0 });
    expect(r0.failures).toEqual([]);
    // the POLYGON was cloned — not the recorded star
    expect(scene.layers).toHaveLength(3);
    const copy = scene.layers[2];
    expect(copy.name).toBe("Polygon 1 copy");

    const r1 = playbackStep({ index: 1 });
    expect(r1.failures).toEqual([]);
    // the copy moved by the recorded delta (+100), from ITS OWN start (500)
    expect(copy.position.staticValue).toEqual({ x: 600, y: 500 });
    // the original selected layer did not move
    expect(polygon.position.staticValue).toEqual({ x: 500, y: 500 });
    // and the recorded source star was untouched
    expect(star.position.staticValue).toEqual({ x: 10, y: 10 });
  });

  it("falls back to scene mode with nothing selected: duplicates the original by name", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    scene.addLayer(makeNode("star 6", { props: { position: { x: 10, y: 10 } } }, ids));
    stubCreator(scene, []);

    const steps = [
      step({
        op: "add-layer",
        cloneOf: { id: "REC_SRC", name: "star 6" },
        spec: {
          nodeId: "REC_COPY",
          nodeType: "CONTAINER",
          nodeName: "star 7",
          props: {},
          plain: {},
          fills: [],
          strokes: [],
          masks: [],
          shapes: [],
        },
      }),
    ];

    playbackBegin({ steps: steps as Any });
    const r0 = playbackStep({ index: 0 });
    expect(r0.failures).toEqual([]);
    expect(scene.layers).toHaveLength(2);
    expect(scene.layers[1].name).toBe("star 7"); // scene mode applies recorded name
  });

  it("multi-source macros ignore selection and stay scene rebuilds", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const a = scene.addLayer(makeNode("A", { props: { rotation: 0 } }, ids));
    const b = scene.addLayer(makeNode("B", { props: { rotation: 0 } }, ids));
    const other = scene.addLayer(makeNode("Other", { props: { rotation: 0 } }, ids));
    stubCreator(scene, [other]);

    const steps = [
      step({
        op: "set-static",
        path: ["rotation"],
        before: 0,
        after: 45,
        layer: { id: String(a.id), name: "A" },
      }),
      step({
        op: "set-static",
        path: ["rotation"],
        before: 0,
        after: 90,
        layer: { id: String(b.id), name: "B" },
      }),
    ];

    playbackBegin({ steps: steps as Any });
    playbackStep({ index: 0 });
    playbackStep({ index: 1 });
    expect(a.rotation.staticValue).toBe(45);
    expect(b.rotation.staticValue).toBe(90);
    expect(other.rotation.staticValue).toBe(0);
  });
});

describe("retargeted duplication reproduces the duplicate offset", () => {
  it("shifts the clone from the TARGET's position by the recorded delta", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const ellipse = scene.addLayer(
      makeNode("Ellipse 1", { props: { position: { x: 200, y: 300 } } }, ids),
    );
    stubCreator(scene, [ellipse]);

    playbackBegin({
      steps: [
        step({
          op: "add-layer",
          cloneOf: { id: "SRC", name: "Polygon 1" },
          offset: { x: 10, y: 10 },
          spec: {
            nodeId: "COPY",
            nodeType: "CONTAINER",
            nodeName: "Polygon 2",
            props: {},
            plain: {},
            fills: [],
            strokes: [],
            masks: [],
            shapes: [],
          },
        }),
      ] as Any,
    });
    const result = playbackStep({ index: 0 });
    expect(result.failures).toEqual([]);
    expect(scene.layers).toHaveLength(2);
    const copy = scene.layers[1];
    // an ellipse clone (not a drawn polygon), offset from ITS OWN source
    expect(copy.name).toBe("Ellipse 1 copy");
    expect(copy.position.staticValue).toEqual({ x: 210, y: 310 });
  });
});

describe("chained retargeted duplication", () => {
  it("a duplicate of a copy clones the REPLAY's copy, not the base target", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const star = scene.addLayer(
      makeNode("Star 4", { props: { position: { x: 50, y: 50 }, rotation: 0 } }, ids),
    );
    stubCreator(scene, [star]);

    const spec = (id: string, name: string) => ({
      nodeId: id,
      nodeType: "CONTAINER",
      nodeName: name,
      props: {},
      plain: {},
      fills: [],
      strokes: [],
      masks: [],
      shapes: [],
    });
    playbackBegin({
      steps: [
        step({
          op: "add-layer",
          cloneOf: { id: "P1", name: "Polygon 1" },
          spec: spec("P2", "Polygon 2"),
        }),
        step({
          op: "set-static",
          path: ["rotation"],
          before: 0,
          after: 26,
          layer: { id: "P2", name: "Polygon 2" },
        }),
        step({
          op: "add-layer",
          cloneOf: { id: "P2", name: "Polygon 2" },
          spec: spec("P3", "Polygon 3"),
        }),
      ] as Any,
    });
    playbackStep({ index: 0 });
    playbackStep({ index: 1 });
    playbackStep({ index: 2 });

    expect(scene.layers).toHaveLength(3);
    const firstCopy = scene.layers[1];
    const secondCopy = scene.layers[2];
    expect(firstCopy.rotation.staticValue).toBe(26);
    // the chained duplicate inherits the FIRST COPY's state
    expect(secondCopy.rotation.staticValue).toBe(26);
    expect(star.rotation.staticValue).toBe(0);
  });
});

describe("break-scene replay", () => {
  it("calls the instance's break() when it exists", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const content1 = makeNode("Bubble", {}, ids);
    const content2 = makeNode("Fish body", {}, ids);
    const instance = scene.addLayer(makeNode("Fish", { type: "SCENE_LAYER" }, ids));
    instance.__setSceneContents([content1, content2]);
    stubCreator(scene, []);

    playbackBegin({
      steps: [
        step({
          op: "break-scene",
          layer: { id: String(instance.id), name: "Fish" },
          fallback: [],
        }),
      ] as Any,
    });
    const result = playbackStep({ index: 0 });
    expect(result.failures).toEqual([]);
    expect(scene.layers.map((l: Any) => l.name)).toEqual(["Bubble", "Fish body"]);
  });

  it("rebuilds from the fallback specs when the layer can't break", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    scene.createShapeLayer = () => scene.addLayer(makeNode("new layer", {}, ids));
    stubCreator(scene, []);

    playbackBegin({
      steps: [
        step({
          op: "break-scene",
          layer: { id: "GONE", name: "Fish" },
          fallback: [
            {
              nodeId: "F1",
              nodeType: "CONTAINER",
              nodeName: "Bubble",
              props: {},
              plain: {},
              fills: [],
              strokes: [],
              masks: [],
              shapes: [],
            },
          ],
        }),
      ] as Any,
    });
    const result = playbackStep({ index: 0 });
    expect(result.failures).toEqual([]);
    expect(scene.layers.map((l: Any) => l.name)).toEqual(["Bubble"]);
    expect((result.notes ?? []).some((n: Any) => n.message.includes("couldn't break"))).toBe(true);
  });
});

describe("reorder-layers replay checks layer identity before reindexing (trace 2026-08-26T08-15-02, rev .51)", () => {
  it("does NOT reindex a foreign scene whose layers don't match the recorded identities, and reports it instead of misapplying silently (BUG: today it blindly permutes by raw position — order:[] notes:[])", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const x = scene.addLayer(makeNode("X", {}, ids));
    const y = scene.addLayer(makeNode("Y", {}, ids));
    const z = scene.addLayer(makeNode("Z", {}, ids));
    stubCreator(scene, []);

    playbackBegin({
      steps: [
        step({
          op: "reorder-layers",
          order: [2, 0, 1],
          layers: [
            { id: "A", name: "a" },
            { id: "B", name: "b" },
            { id: "C", name: "c" },
          ],
        }),
      ] as Any,
    });
    const result = playbackStep({ index: 0 });

    expect(scene.layers).toEqual([x, y, z]);
    expect((result.notes ?? []).length).toBeGreaterThan(0);
  });

  it("reorders when the live scene's layers match the recorded identities (by name, since ids are host-assigned fresh on replay)", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const a = scene.addLayer(makeNode("a", {}, ids));
    const b = scene.addLayer(makeNode("b", {}, ids));
    const c = scene.addLayer(makeNode("c", {}, ids));
    stubCreator(scene, []);

    playbackBegin({
      steps: [
        step({
          op: "reorder-layers",
          order: [2, 0, 1],
          layers: [
            { id: "A", name: "a" },
            { id: "B", name: "b" },
            { id: "C", name: "c" },
          ],
        }),
      ] as Any,
    });
    const result = playbackStep({ index: 0 });

    expect(result.failures).toEqual([]);
    expect(scene.layers).toEqual([c, a, b]);
  });

  it("a legacy payload with no recorded identities still reorders (as today) but pushes a caution note that identity wasn't checked", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const a = scene.addLayer(makeNode("a", {}, ids));
    const b = scene.addLayer(makeNode("b", {}, ids));
    const c = scene.addLayer(makeNode("c", {}, ids));
    stubCreator(scene, []);

    playbackBegin({
      steps: [step({ op: "reorder-layers", order: [2, 0, 1] })] as Any,
    });
    const result = playbackStep({ index: 0 });

    expect(scene.layers).toEqual([c, a, b]);
    expect((result.notes ?? []).some((n: Any) => /identity|caution|verify/i.test(n.message))).toBe(
      true,
    );
  });
});

describe("layer resolution across renames", () => {
  it("finds a pre-rename layer via the recorded priorName", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const text = scene.addLayer(makeNode("Text 1", {}, ids));
    const other = scene.addLayer(makeNode("Rectangle 1", {}, ids));
    stubCreator(scene, []);

    // Two referenced layers, so the macro is a scene rebuild with nothing
    // selected — a solo-layer macro would refuse with `no-selection`. Only
    // step 0 runs; the second step is here to choose the mode.
    playbackBegin({
      steps: [
        step({
          op: "set-plain",
          path: ["visible"],
          before: true,
          after: false,
          layer: { id: "REC", name: "Text 1 (source text)", priorName: "Text 1" },
        }),
        step({
          op: "set-plain",
          path: ["visible"],
          before: true,
          after: false,
          layer: { id: String(other.id), name: "Rectangle 1" },
        }),
      ] as Any,
    });
    const result = playbackStep({ index: 0 });
    expect(result.failures).toEqual([]);
    expect(result.notes ?? []).toEqual([]);
    expect(text.visible).toBe(false);
  });
});

describe("nest-layers replay", () => {
  it("nests the resolved layers and resolves inside-edits by order", () => {
    const ids = makeIds();
    const scene = consumeSelectionOnCreate(makeSceneRoot(ids));
    const a = scene.addLayer(makeNode("Ellipse 1", {}, ids));
    const b = scene.addLayer(makeNode("Rectangle 1", {}, ids));
    scene.addLayer(makeNode("Keep", {}, ids));
    stubCreator(scene, []);

    playbackBegin({
      steps: [
        step({
          op: "nest-layers",
          layers: [
            { id: String(a.id), name: "Ellipse 1" },
            { id: String(b.id), name: "Rectangle 1" },
          ],
          spec: {
            nodeId: "NEST",
            nodeType: "SCENE_LAYER",
            nodeName: "Nested Scene 5",
            props: {},
            plain: {},
            fills: [],
            strokes: [],
            masks: [],
            shapes: [],
          },
        }),
        // recorded on the SECOND nested layer — must map by ORDER
        step({
          op: "set-static",
          path: ["shapes", 1, "rotation"],
          before: 0,
          after: -30,
          shapeHint: "POLYGON",
          layer: { id: "NEST", name: "Nested Scene 5" },
        }),
      ] as Any,
    });
    const r0 = playbackStep({ index: 0 });
    expect(r0.failures).toEqual([]);
    expect((r0.notes ?? []).map((n: Any) => n.message)).toEqual(["nested 2 layers"]);
    expect(scene.layers.map((l: Any) => l.name)).toEqual(["Keep", "Nested Scene 5"]);
    expect(scene.layers[1].scene.layers).toEqual([a, b]);

    const r1 = playbackStep({ index: 1 });
    expect(r1.failures).toEqual([]);
    // order-based: applied to the SECOND nested layer even though the
    // recorded hint said POLYGON and Rectangle 1 isn't one
    expect(b.rotation.staticValue).toBe(-30);
    expect(a.rotation.staticValue).toBe(0);
  });

  it("rebuilds a SCENE-type add-layer spec with createSceneLayer, not createShapeLayer", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    let shapeLayerCalls = 0;
    scene.createShapeLayer = () => {
      shapeLayerCalls += 1;
      return scene.addLayer(makeNode("wrong", {}, ids));
    };
    stubCreator(scene, []);

    playbackBegin({
      steps: [
        step({
          op: "add-layer",
          spec: {
            nodeId: "S1",
            nodeType: "SCENE_LAYER",
            nodeName: "Nested Scene 5",
            props: {},
            plain: {},
            fills: [],
            strokes: [],
            masks: [],
            shapes: [],
          },
        }),
      ] as Any,
    });
    const result = playbackStep({ index: 0 });
    expect(result.failures).toEqual([]);
    expect(shapeLayerCalls).toBe(0);
    expect(
      scene.layers.some((l: Any) => l.type === "SCENE_LAYER" && l.name === "Nested Scene 5"),
    ).toBe(true);
  });
});

describe("idempotent layer adoption (same-scene replays)", () => {
  it("break fallback adopts the already-broken result layers by id", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const rect = scene.addLayer(makeNode("Rectangle 1", { props: { rotation: 0 } }, ids));
    stubCreator(scene, []);

    playbackBegin({
      steps: [
        step({
          op: "break-scene",
          layer: { id: "GONE", name: "Nested Scene 5" },
          fallback: [
            {
              nodeId: String(rect.id),
              nodeType: "CONTAINER",
              nodeName: "Rectangle 1",
              props: {},
              plain: {},
              fills: [],
              strokes: [],
              masks: [],
              shapes: [],
            },
          ],
        }),
        step({
          op: "set-static",
          path: ["rotation"],
          before: 0,
          after: 45,
          layer: { id: String(rect.id), name: "Rectangle 1" },
        }),
      ] as Any,
    });
    const r0 = playbackStep({ index: 0 });
    expect(r0.failures).toEqual([]);
    // no duplicate created — the existing layer was adopted
    expect(scene.layers).toHaveLength(1);
    expect((r0.notes ?? []).some((n: Any) => n.message.includes("already broken"))).toBe(true);
    playbackStep({ index: 1 });
    expect(rect.rotation.staticValue).toBe(45);
  });

  it("an add-layer spec re-executes: replay creates the layer again", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const existing = scene.addLayer(makeNode("Rectangle 1", {}, ids));
    scene.createShapeLayer = () => scene.addLayer(makeNode("fresh", {}, ids));
    stubCreator(scene, []);

    playbackBegin({
      steps: [
        step({
          op: "add-layer",
          spec: {
            nodeId: String(existing.id),
            nodeType: "CONTAINER",
            nodeName: "Rectangle 1",
            props: {},
            plain: {},
            fills: [],
            strokes: [],
            masks: [],
            shapes: [],
          },
        }),
      ] as Any,
    });
    playbackStep({ index: 0 });
    expect(scene.layers).toHaveLength(2);
  });
});

describe("nest-layers same-scene idempotency", () => {
  it("adopts the existing nested scene instead of re-nesting", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const a = scene.addLayer(makeNode("Rectangle 1", {}, ids));
    const nested = nestExisting(scene, [a], "Nested Scene 6");
    stubCreator(scene, []);

    playbackBegin({
      steps: [
        step({
          op: "nest-layers",
          layers: [{ id: "OLD_A", name: "Rectangle 1" }],
          spec: {
            nodeId: String(nested.id),
            nodeType: "SCENE_LAYER",
            nodeName: "Nested Scene 6",
            props: {},
            plain: {},
            fills: [],
            strokes: [],
            masks: [],
            shapes: [],
          },
        }),
      ] as Any,
    });
    const result = playbackStep({ index: 0 });
    expect(result.failures).toEqual([]);
    expect((result.notes ?? []).some((n: Any) => n.message.includes("already exists"))).toBe(true);
    expect(scene.layers).toHaveLength(1); // nothing re-nested or rebuilt
  });
});

describe("nest-layers re-executes when sources are present", () => {
  it("nests again even though the recorded result also exists", () => {
    const ids = makeIds();
    const scene = consumeSelectionOnCreate(makeSceneRoot(ids));
    const a = scene.addLayer(makeNode("Ellipse 1", {}, ids));
    const prior = nestExisting(scene, [scene.addLayer(makeNode("old", {}, ids))], "Nested Scene 1");
    stubCreator(scene, []);

    playbackBegin({
      steps: [
        step({
          op: "nest-layers",
          layers: [{ id: String(a.id), name: "Ellipse 1" }],
          spec: {
            nodeId: String(prior.id),
            nodeType: "SCENE_LAYER",
            nodeName: "Nested Scene 1",
            props: {},
            plain: {},
            fills: [],
            strokes: [],
            masks: [],
            shapes: [],
          },
        }),
      ] as Any,
    });
    const result = playbackStep({ index: 0 });
    expect(result.failures).toEqual([]);
    // a NEW nest was created from the resolved source
    const instances = scene.layers.filter((l: Any) => l.type === "SCENE_LAYER");
    expect(instances).toHaveLength(2);
  });
});

describe("nest-layers follows the selection (tool semantics)", () => {
  it("nests the SELECTED layers, not the recorded sources", () => {
    const ids = makeIds();
    const scene = consumeSelectionOnCreate(makeSceneRoot(ids));
    scene.addLayer(makeNode("Ellipse 1", {}, ids)); // recorded source, untouched
    const x = scene.addLayer(makeNode("New A", { fills: [{ r: 0, g: 0, b: 0 }] }, ids));
    const y = scene.addLayer(makeNode("New B", {}, ids));
    stubCreator(scene, [x, y]);

    playbackBegin({
      steps: [
        step({
          op: "nest-layers",
          layers: [
            { id: "REC1", name: "Ellipse 1" },
            { id: "REC2", name: "Rectangle 1" },
          ],
          spec: {
            nodeId: "NEST",
            nodeType: "SCENE_LAYER",
            nodeName: "Nested Scene 1",
            props: {},
            plain: {},
            fills: [],
            strokes: [],
            masks: [],
            shapes: [],
          },
        }),
        step({
          op: "set-static",
          path: ["shapes", 0, "fills", 0, "color"],
          before: { r: 0, g: 0, b: 0 },
          after: { r: 9, g: 182, b: 225 },
          layer: { id: "NEST", name: "Nested Scene 1" },
        }),
      ] as Any,
    });
    const r0 = playbackStep({ index: 0 });
    expect(r0.failures).toEqual([]);
    // New A and New B were nested; Ellipse 1 stayed top-level
    const instance = scene.layers.find((l: Any) => l.type === "SCENE_LAYER");
    expect(instance.scene.layers.map((l: Any) => l.name)).toEqual(["New A", "New B"]);
    expect(scene.layers.map((l: Any) => l.name)).toContain("Ellipse 1");
    // and the inside-edit resolves through the created nest
    const r1 = playbackStep({ index: 1 });
    expect(r1.failures).toEqual([]);
    expect(instance.scene.layers[0].fills[0].color.staticValue).toEqual({ r: 9, g: 182, b: 225 });
  });
});

/* ------------------------------------------------------------------ */
/* nesting by rebuild                                                  */
/* ------------------------------------------------------------------ */

/**
 * Creator has no API that moves a layer into a scene layer (docs/limitations.md),
 * and `createSceneLayer()` returns an empty shell that ignores the selection
 * (runtime quirk 8) — traces 2026-09-07T01-13-19 / 01-13-38. So replay REBUILDS
 * copies of the source layers inside the new scene and removes the originals.
 * Everything below pins that route, its verification, and its honest failures.
 */
const NEST_SPEC = {
  nodeId: "NEST",
  nodeType: "SCENE_LAYER",
  nodeName: "Nested Scene 5",
  props: {},
  plain: {},
  fills: [],
  strokes: [],
  masks: [],
  shapes: [],
};

function nestStep(layers: Any[], spec: Any = NEST_SPEC) {
  return step({ op: "nest-layers", layers, spec });
}

/** A shape layer with a fill, a child shape, a keyframe and a plain flag. */
function richShape(scene: Any, ids: Any, name: string) {
  const layer = scene.addLayer(
    makeNode(
      name,
      {
        type: "SHAPE_LAYER",
        props: { position: { x: 120, y: 40 } },
        fills: [{ r: 9, g: 182, b: 225 }],
      },
      ids,
    ),
  );
  layer.createEllipse({ size: { width: 40, height: 40 } });
  layer.visible = false;
  layer.rotation.addKeyframes([
    { frame: 10, value: 0 },
    { frame: 30, value: 90 },
  ]);
  return layer;
}

describe("nest-layers rebuilds the sources inside the new scene", () => {
  it("copies a selected shape layer and text layer in, then removes the originals", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    scene.addLayer(makeNode("Keep", { type: "SHAPE_LAYER" }, ids));
    const shape = richShape(scene, ids, "Ellipse 1");
    const text = scene.addLayer(makeNode("Title", { type: "TEXT_LAYER" }, ids));
    text.text = "Ship it";
    text.fontSize = 44;
    const tail = scene.addLayer(makeNode("Tail", { type: "SHAPE_LAYER" }, ids));
    stubCreator(scene, [shape, text]);

    playbackBegin({
      steps: [
        nestStep([
          { id: "REC_A", name: "Ellipse 1" },
          { id: "REC_B", name: "Title" },
        ]),
        // a later inside-edit addresses the nest's content by order
        step({
          op: "set-static",
          path: ["shapes", 0, "position"],
          before: { x: 120, y: 40 },
          after: { x: 300, y: 40 },
          layer: { id: "NEST", name: "Nested Scene 5" },
        }),
      ] as Any,
    });
    const r0 = playbackStep({ index: 0 });

    expect(r0.failures).toEqual([]);
    expect((r0.notes ?? []).map((n: Any) => n.message)).toEqual([
      "nested the 2 selected layers (rebuilt inside the new scene — Creator can't move them)",
    ]);
    // the nest took the FIRST source's slot; the originals are gone
    expect(scene.layers.map((l: Any) => l.name)).toEqual(["Keep", "Nested Scene 5", "Tail"]);
    expect(scene.layers[2]).toBe(tail);
    const nest = scene.layers[1];
    expect(nest.type).toBe("SCENE_LAYER");

    const inside = nest.scene.layers;
    expect(inside.map((l: Any) => l.name)).toEqual(["Ellipse 1", "Title"]);
    // the copy carries what the serializer captured: paints, children,
    // keyframes and plain flags
    expect(inside[0].fills[0].color.staticValue).toEqual({ r: 9, g: 182, b: 225 });
    expect(inside[0].shapes).toHaveLength(1);
    expect(inside[0].rotation.keyframes.map((k: Any) => k.frame)).toEqual([10, 30]);
    expect(inside[0].visible).toBe(false);
    expect(inside[1].type).toBe("TEXT_LAYER");
    expect(inside[1].text).toBe("Ship it");
    expect(inside[1].fontSize).toBe(44);

    // and a later shapes.N step lands on the COPY, not on the vanished source
    const r1 = playbackStep({ index: 1 });
    expect(r1.failures).toEqual([]);
    expect(inside[0].position.staticValue).toEqual({ x: 300, y: 40 });
  });

  it("remaps the recorded source ids onto the copies for later steps", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const a = scene.addLayer(makeNode("Ellipse 1", { type: "SHAPE_LAYER" }, ids));
    stubCreator(scene, [a]);

    playbackBegin({
      steps: [
        nestStep([{ id: "REC_A", name: "Ellipse 1" }]),
        step({
          op: "set-static",
          path: ["rotation"],
          before: 0,
          after: 45,
          layer: { id: "REC_A", name: "Ellipse 1" },
        }),
      ] as Any,
    });
    expect(playbackStep({ index: 0 }).failures).toEqual([]);
    const copy = scene.layers[0].scene.layers[0];
    expect(playbackStep({ index: 1 }).failures).toEqual([]);
    expect(copy.rotation.staticValue).toBe(45);
  });

  it("nests the recorded sources when nothing is selected", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const a = scene.addLayer(makeNode("Ellipse 1", { type: "SHAPE_LAYER" }, ids));
    const b = scene.addLayer(makeNode("Rectangle 1", { type: "SHAPE_LAYER" }, ids));
    stubCreator(scene, []);

    playbackBegin({
      steps: [
        nestStep([
          { id: String(a.id), name: "Ellipse 1" },
          { id: String(b.id), name: "Rectangle 1" },
        ]),
      ] as Any,
    });
    const r0 = playbackStep({ index: 0 });

    expect(r0.failures).toEqual([]);
    expect((r0.notes ?? []).map((n: Any) => n.message)).toEqual([
      "nested 2 layers (rebuilt inside the new scene — Creator can't move them)",
    ]);
    expect(scene.layers.map((l: Any) => l.name)).toEqual(["Nested Scene 5"]);
    expect(scene.layers[0].scene.layers.map((l: Any) => l.name)).toEqual([
      "Ellipse 1",
      "Rectangle 1",
    ]);
  });

  it("leaves an image layer where it is, and says so", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const shape = scene.addLayer(makeNode("Ellipse 1", { type: "SHAPE_LAYER" }, ids));
    const image = scene.addLayer(makeNode("Logo.png", { type: "IMAGE_LAYER" }, ids));
    stubCreator(scene, [shape, image]);

    playbackBegin({
      steps: [
        nestStep([
          { id: "REC_A", name: "Ellipse 1" },
          { id: "REC_B", name: "Logo.png" },
        ]),
      ] as Any,
    });
    const r0 = playbackStep({ index: 0 });

    expect(r0.failures).toEqual([]);
    expect((r0.notes ?? []).map((n: Any) => n.message)).toEqual([
      "an image layer can't be rebuilt inside the new scene — left it where it was",
      "nested 1 of the 2 selected layers (rebuilt inside the new scene — Creator can't move them)",
    ]);
    // the image is untouched and still top-level
    expect(scene.layers.map((l: Any) => l.name)).toEqual(["Nested Scene 5", "Logo.png"]);
    expect(scene.layers[1]).toBe(image);
    expect(scene.layers[0].scene.layers.map((l: Any) => l.name)).toEqual(["Ellipse 1"]);
  });

  it("ignores selected SHAPES — a macro nests layers", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const layer = scene.addLayer(makeNode("Ellipse 1", { type: "SHAPE_LAYER" }, ids));
    const rect = layer.createRectangle({ size: { width: 10, height: 10 } });
    stubCreator(scene, [layer, rect]);

    playbackBegin({ steps: [nestStep([{ id: "REC_A", name: "Ellipse 1" }])] as Any });
    const r0 = playbackStep({ index: 0 });

    expect(r0.failures).toEqual([]);
    expect((r0.notes ?? []).map((n: Any) => n.message)).toContain(
      "nested the 1 selected layer (rebuilt inside the new scene — Creator can't move them)",
    );
    expect(scene.layers.map((l: Any) => l.name)).toEqual(["Nested Scene 5"]);
    // the rectangle went in as the copy's CHILD, never as a nested layer
    expect(scene.layers[0].scene.layers.map((l: Any) => l.name)).toEqual(["Ellipse 1"]);
    expect(scene.layers[0].scene.layers[0].shapes).toHaveLength(1);
  });

  it("nests the SELECTION even when the recorded nest is still live (tool semantics)", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const x = scene.addLayer(makeNode("Rectangle 1", { type: "SHAPE_LAYER" }, ids));
    const old = scene.addLayer(makeNode("Rectangle 2", { type: "SHAPE_LAYER" }, ids));
    const nested = nestExisting(scene, [old], "Nested Scene 5");
    stubCreator(scene, [x]);

    playbackBegin({
      steps: [
        nestStep([{ id: "REC1", name: "Rectangle 2" }], {
          ...NEST_SPEC,
          nodeId: String(nested.id),
        }),
      ] as Any,
    });
    const r0 = playbackStep({ index: 0 });

    expect(r0.failures).toEqual([]);
    // the selected layer got its OWN nest — the live one was not adopted
    expect((r0.notes ?? []).some((n: Any) => n.message.includes("already exists"))).toBe(false);
    const instances = scene.layers.filter((l: Any) => l.type === "SCENE_LAYER");
    expect(instances).toHaveLength(2);
    expect(
      instances.some((l: Any) => l.scene.layers.some((c: Any) => c.name === "Rectangle 1")),
    ).toBe(true);
  });

  it("keeps the host-moved path untouched when createSceneLayer consumes the selection", () => {
    const ids = makeIds();
    const scene = consumeSelectionOnCreate(makeSceneRoot(ids));
    const a = scene.addLayer(makeNode("New A", { type: "SHAPE_LAYER" }, ids));
    stubCreator(scene, [a]);

    playbackBegin({ steps: [nestStep([{ id: "REC_A", name: "Ellipse 1" }])] as Any });
    const r0 = playbackStep({ index: 0 });

    expect(r0.failures).toEqual([]);
    // no rebuild happened: the SAME node moved in, so the note says nothing
    // about rebuilding
    expect((r0.notes ?? []).map((n: Any) => n.message)).toEqual(["nested the 1 selected layer"]);
    expect(scene.layers[0].scene.layers[0]).toBe(a);
  });
});

describe("nest-layers rebuild failures leave the originals alone", () => {
  it("removes the shell and keeps the sources when the copies can't be verified", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const create = scene.createSceneLayer;
    scene.createSceneLayer = (opts?: Any) => {
      const shell = create(opts);
      // a factory that "creates" a layer the scene never takes
      shell.scene.createShapeLayer = () => makeNode("orphan", { type: "SHAPE_LAYER" }, ids);
      return shell;
    };
    const a = scene.addLayer(makeNode("Ellipse 1", { type: "SHAPE_LAYER" }, ids));
    stubCreator(scene, [a]);

    playbackBegin({ steps: [nestStep([{ id: "REC_A", name: "Ellipse 1" }])] as Any });
    const r0 = playbackStep({ index: 0 });

    expect(r0.failures).toEqual([]);
    expect((r0.notes ?? []).map((n: Any) => n.message)).toEqual([
      "couldn't rebuild your selected layer inside a new scene — left it where it is",
    ]);
    // the shell is gone and the original is exactly where it was
    expect(scene.layers).toEqual([a]);
  });

  it("skips honestly when neither the shell's scene nor creator.createScene can build", () => {
    const ids = makeIds();
    const scene = shellWithoutInnerFactories(makeSceneRoot(ids));
    const a = scene.addLayer(makeNode("Ellipse 1", { type: "SHAPE_LAYER" }, ids));
    const b = scene.addLayer(makeNode("Rectangle 1", { type: "SHAPE_LAYER" }, ids));
    stubCreator(scene, [a, b]); // no creator.createScene on this host

    playbackBegin({ steps: [nestStep([{ id: "REC_A" }, { id: "REC_B" }])] as Any });
    const r0 = playbackStep({ index: 0 });

    expect(r0.failures).toEqual([]);
    expect((r0.notes ?? []).map((n: Any) => n.message)).toEqual([
      "couldn't rebuild your 2 selected layers inside a new scene — left them where they are",
    ]);
    expect(scene.layers).toEqual([a, b]);
  });
});

describe("nest-layers route 2: creator.createScene + createSceneLayer({ scene })", () => {
  function withCreateScene(scene: Any, ids: Any, options: { attach?: boolean } = {}) {
    const created: Any[] = [];
    const calls: Any[] = [];
    (globalThis as Any).creator.createScene = (opts: Any) => {
      calls.push(opts);
      const made = makeInnerScene(String(opts?.name ?? "Scene"), ids);
      created.push(made);
      return made;
    };
    if (options.attach === false) {
      // a host that accepts the option object and ignores its `scene`
      const create = scene.createSceneLayer;
      scene.createSceneLayer = (opts?: Any) => create(opts?.scene ? {} : opts);
    }
    return { created, calls };
  }

  it("builds the copies into a scene it created, then attaches it", () => {
    const ids = makeIds();
    const scene = shellWithoutInnerFactories(makeSceneRoot(ids));
    scene.size = { width: 1080, height: 1080 };
    scene.framerate = 30;
    scene.duration = 5;
    const a = scene.addLayer(makeNode("Ellipse 1", { type: "SHAPE_LAYER" }, ids));
    stubCreator(scene, [a]);
    const { created, calls } = withCreateScene(scene, ids);

    playbackBegin({ steps: [nestStep([{ id: "REC_A", name: "Ellipse 1" }])] as Any });
    const r0 = playbackStep({ index: 0 });

    expect(r0.failures).toEqual([]);
    expect((r0.notes ?? []).map((n: Any) => n.message)).toEqual([
      "nested the 1 selected layer (rebuilt inside the new scene — Creator can't move them)",
    ]);
    // the new scene copied the active scene's settings, with the nest's name
    expect(calls).toEqual([
      { name: "Nested Scene 5", size: { width: 1080, height: 1080 }, framerate: 30, duration: 5 },
    ]);
    expect(created[0].__removed).toBe(false);
    const instances = scene.layers.filter((l: Any) => l.type === "SCENE_LAYER");
    expect(instances).toHaveLength(1);
    expect(instances[0].scene).toBe(created[0]);
    expect(created[0].layers.map((l: Any) => l.name)).toEqual(["Ellipse 1"]);
    expect(scene.layers.map((l: Any) => l.name)).toEqual(["Nested Scene 5"]);
  });

  it("removes the scene it created when the host ignores the { scene } option", () => {
    const ids = makeIds();
    const scene = shellWithoutInnerFactories(makeSceneRoot(ids));
    const a = scene.addLayer(makeNode("Ellipse 1", { type: "SHAPE_LAYER" }, ids));
    stubCreator(scene, [a]);
    const { created } = withCreateScene(scene, ids, { attach: false });

    playbackBegin({ steps: [nestStep([{ id: "REC_A", name: "Ellipse 1" }])] as Any });
    const r0 = playbackStep({ index: 0 });

    expect(r0.failures).toEqual([]);
    expect((r0.notes ?? []).map((n: Any) => n.message)).toEqual([
      "couldn't rebuild your selected layer inside a new scene — left it where it is",
    ]);
    // nothing left behind: no shell, no orphaned scene asset, source intact
    expect(scene.layers).toEqual([a]);
    expect(created[0].__removed).toBe(true);
  });
});

describe("nest-layers with no sources at all", () => {
  it("adopts the live nest from the recording", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const old = scene.addLayer(makeNode("Rectangle 1", { type: "SHAPE_LAYER" }, ids));
    const nested = nestExisting(scene, [old], "Nested Scene 5");
    stubCreator(scene, []);

    playbackBegin({
      steps: [
        nestStep([{ id: "REC_A", name: "Rectangle 1" }], {
          ...NEST_SPEC,
          nodeId: String(nested.id),
        }),
      ] as Any,
    });
    const r0 = playbackStep({ index: 0 });

    expect(r0.failures).toEqual([]);
    expect((r0.notes ?? []).map((n: Any) => n.message)).toEqual([
      "Nested Scene 5 already exists — using it",
    ]);
    expect(scene.layers).toHaveLength(1);
  });

  it("rebuilds the recorded spec WITH its content when no nest is live", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    stubCreator(scene, []);

    playbackBegin({
      steps: [
        nestStep([{ id: "GONE", name: "Ellipse 1" }], {
          ...NEST_SPEC,
          shapes: [
            {
              nodeId: "C1",
              nodeType: "SHAPE_LAYER",
              nodeName: "Ellipse 1",
              props: { position: { animated: false, static: { x: 30, y: 40 } } },
              plain: {},
              fills: [{ kind: "solid", color: { animated: false, static: { r: 1, g: 2, b: 3 } } }],
              strokes: [],
              masks: [],
              shapes: [],
            },
            {
              nodeId: "C2",
              nodeType: "TEXT_LAYER",
              nodeName: "Title",
              props: {},
              plain: { text: "Ship it" },
              fills: [],
              strokes: [],
              masks: [],
              shapes: [],
            },
          ],
        }),
      ] as Any,
    });
    const r0 = playbackStep({ index: 0 });

    expect(r0.failures).toEqual([]);
    expect((r0.notes ?? []).map((n: Any) => n.message)).toEqual([
      "couldn't find the layers to nest — rebuilt Nested Scene 5 from the recording instead",
    ]);
    const nest = scene.layers[0];
    expect(nest.type).toBe("SCENE_LAYER");
    // the fallback is no longer an empty shell: the recorded content is inside
    const inside = nest.scene.layers;
    expect(inside.map((l: Any) => l.name)).toEqual(["Ellipse 1", "Title"]);
    expect(inside[0].position.staticValue).toEqual({ x: 30, y: 40 });
    expect(inside[0].fills[0].color.staticValue).toEqual({ r: 1, g: 2, b: 3 });
    expect(inside[1].text).toBe("Ship it");
  });

  it("says so when the rebuilt scene layer has no scene to build into", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const create = scene.createSceneLayer;
    scene.createSceneLayer = (opts?: Any) => {
      const shell = create(opts);
      shell.scene = undefined;
      return shell;
    };
    stubCreator(scene, []);

    playbackBegin({
      steps: [
        nestStep([{ id: "GONE", name: "Ellipse 1" }], {
          ...NEST_SPEC,
          shapes: [
            {
              nodeId: "C1",
              nodeType: "SHAPE_LAYER",
              nodeName: "Ellipse 1",
              props: {},
              plain: {},
              fills: [],
              strokes: [],
              masks: [],
              shapes: [],
            },
          ],
        }),
      ] as Any,
    });
    const r0 = playbackStep({ index: 0 });

    expect(r0.failures).toEqual([]);
    expect((r0.notes ?? []).map((n: Any) => n.message)).toContain(
      "this scene layer has no scene to build into — its 1 layer was skipped",
    );
  });
});

describe("nest-layers diagnostics", () => {
  it("keeps the nest in the scene summary past the 25-layer cap", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const many: Any[] = [];
    for (let i = 0; i < 30; i++) {
      many.push(scene.addLayer(makeNode(`Layer ${i}`, { type: "SHAPE_LAYER" }, ids)));
    }
    // select the LAST two, so the nest lands well past the cap
    stubCreator(scene, [many[28], many[29]]);

    playbackBegin({
      debug: true,
      steps: [
        nestStep([
          { id: "REC_A", name: "Layer 28" },
          { id: "REC_B", name: "Layer 29" },
        ]),
      ] as Any,
    });
    const r0 = playbackStep({ index: 0 }) as Any;

    expect(r0.failures).toEqual([]);
    const after = r0.debug.after[0].value as Any[];
    const nest = after.find((entry: Any) => entry.name === "Nested Scene 5");
    expect(nest).toBeDefined();
    expect(nest.inner).toBe(2);
    // the cap still applies to everything that is not pinned
    expect(after.length).toBeLessThan(29);
    expect(r0.debug.breadcrumbs.join(" | ")).toContain("[nest]");
  });
});

describe("apply at playhead + stagger", () => {
  function kfStep(layer: Any) {
    return step({
      op: "keyframes",
      path: ["rotation"],
      added: [
        { frame: 10, value: 0 },
        { frame: 40, value: 90 },
      ],
      removed: [],
      changed: [],
      layer,
    });
  }

  it("slides the macro's earliest keyframe onto the playhead and cascades across targets", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const a = scene.addLayer(makeNode("A", {}, ids));
    const b = scene.addLayer(makeNode("B", {}, ids));
    const c = scene.addLayer(makeNode("C", {}, ids));
    stubCreator(scene, [a, b, c]);
    (globalThis as Any).creator.timeline = { currentFrame: 100 };

    const begin = playbackBegin({
      steps: [kfStep({ id: "REC", name: "Rec" })] as Any,
      atPlayhead: true,
      staggerFrames: 5,
    });
    expect(begin).toMatchObject({ total: 1, targetCount: 3, frameOffset: 90 });
    expect(playbackStep({ index: 0 }).failures).toEqual([]);
    expect(a.rotation.keyframes.map((k: Any) => k.frame)).toEqual([100, 130]);
    expect(b.rotation.keyframes.map((k: Any) => k.frame)).toEqual([105, 135]);
    expect(c.rotation.keyframes.map((k: Any) => k.frame)).toEqual([110, 140]);
    // A keyframed macro cascades keyframes, never the layers themselves —
    // the delay path is for keyframe-free macros only.
    expect([a.startFrame, b.startFrame, c.startFrame]).toEqual([0, 0, 0]);
  });

  it("applies the playhead shift in scene mode too, and none without a readable timeline", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const a = scene.addLayer(makeNode("A", {}, ids));
    const b = scene.addLayer(makeNode("B", {}, ids));
    stubCreator(scene, []);
    (globalThis as Any).creator.timeline = { currentFrame: 50 };
    // two pre-existing layers touched → scene rebuild
    const steps = [kfStep({ id: a.id, name: "A" }), kfStep({ id: b.id, name: "B" })] as Any;

    playbackBegin({ steps, atPlayhead: true });
    playbackStep({ index: 0 });
    playbackStep({ index: 1 });
    expect(a.rotation.keyframes.map((k: Any) => k.frame)).toEqual([50, 80]);
    expect(b.rotation.keyframes.map((k: Any) => k.frame)).toEqual([50, 80]);
    playbackEnd();

    delete (globalThis as Any).creator.timeline;
    const c = scene.addLayer(makeNode("C", {}, ids));
    stubCreator(scene, [c]);
    const begin = playbackBegin({ steps: [kfStep({ id: "REC" })] as Any, atPlayhead: true });
    expect(begin.frameOffset).toBeUndefined();
    playbackStep({ index: 0 });
    expect(c.rotation.keyframes.map((k: Any) => k.frame)).toEqual([10, 40]);
  });
});

describe("delay for keyframe-free macros", () => {
  function moveStep(layer: Any) {
    return step({
      op: "set-static",
      path: ["position"],
      before: { x: 0, y: 0 },
      after: { x: 10, y: 0 },
      layer,
    });
  }

  function kfStep(layer: Any) {
    return step({
      op: "keyframes",
      path: ["rotation"],
      added: [
        { frame: 10, value: 0 },
        { frame: 40, value: 90 },
      ],
      removed: [],
      changed: [],
      layer,
    });
  }

  function threeTargets() {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const a = scene.addLayer(makeNode("A", {}, ids));
    const b = scene.addLayer(makeNode("B", {}, ids));
    const c = scene.addLayer(makeNode("C", {}, ids));
    stubCreator(scene, [a, b, c]);
    return { scene, a, b, c };
  }

  it("delays each selected layer by the stagger and still applies the step", () => {
    const { a, b, c } = threeTargets();

    playbackBegin({ steps: [moveStep({ id: "REC", name: "Rec" })] as Any, staggerFrames: 10 });
    const result = playbackStep({ index: 0 });

    expect(result.failures).toEqual([]);
    expect([a.startFrame, b.startFrame, c.startFrame]).toEqual([0, 10, 20]);
    expect([a.timelineOffset, b.timelineOffset, c.timelineOffset]).toEqual([0, 10, 20]);
    expect((result.notes ?? []).map((n: Any) => `${n.target}: ${n.message}`)).toEqual([
      "A: in point already at 0 — nothing to shift",
      "B: delayed this layer by 10 frames — in point 0 → 10",
      "C: delayed this layer by 20 frames — in point 0 → 20",
    ]);
    expect(a.position.staticValue).toEqual({ x: 10, y: 0 });
    expect(c.position.staticValue).toEqual({ x: 10, y: 0 });
  });

  it("puts the first layer's in point on the playhead and staggers from there", () => {
    const { a, b, c } = threeTargets();
    (globalThis as Any).creator.timeline = { currentFrame: 100 };

    const begin = playbackBegin({
      steps: [moveStep({ id: "REC", name: "Rec" })] as Any,
      atPlayhead: true,
      staggerFrames: 10,
    });
    const result = playbackStep({ index: 0 });

    // No keyframes, so nothing slides along the timeline: the layers move.
    expect(begin.frameOffset).toBeUndefined();
    expect([a.startFrame, b.startFrame, c.startFrame]).toEqual([100, 110, 120]);
    expect([a.timelineOffset, b.timelineOffset, c.timelineOffset]).toEqual([100, 110, 120]);
    expect((result.notes ?? [])[0]).toEqual({
      target: "A",
      message: "delayed this layer by 100 frames — in point 0 → 100 (at playhead)",
      // The delay worked, so the panel must not count it as a skipped step.
      kind: "info",
    });
  });

  it("leaves a keyframed macro's layers alone — stagger stays a keyframe cascade", () => {
    const { a, b, c } = threeTargets();

    playbackBegin({ steps: [kfStep({ id: "REC", name: "Rec" })] as Any, staggerFrames: 10 });
    const result = playbackStep({ index: 0 });

    expect([a.startFrame, b.startFrame, c.startFrame]).toEqual([0, 0, 0]);
    expect(result.notes ?? []).toEqual([]);
    expect(a.rotation.keyframes.map((k: Any) => k.frame)).toEqual([10, 40]);
    expect(c.rotation.keyframes.map((k: Any) => k.frame)).toEqual([30, 60]);
  });

  it("delays once — a later Repeat pass moves nothing", () => {
    const { a, b, c } = threeTargets();

    playbackBegin({
      steps: [moveStep({ id: "REC", name: "Rec" })] as Any,
      staggerFrames: 10,
      iteration: 1,
    });
    const result = playbackStep({ index: 0 });

    expect([a.startFrame, b.startFrame, c.startFrame]).toEqual([0, 0, 0]);
    expect(result.notes ?? []).toEqual([]);
  });

  it("delays before step 0 only, not before every step", () => {
    const { a, b, c } = threeTargets();
    const layer = { id: "REC", name: "Rec" };

    playbackBegin({ steps: [moveStep(layer), moveStep(layer)] as Any, staggerFrames: 10 });
    playbackStep({ index: 0 });
    const second = playbackStep({ index: 1 });

    expect([a.startFrame, b.startFrame, c.startFrame]).toEqual([0, 10, 20]);
    expect(second.notes ?? []).toEqual([]);
  });

  it("says so when stagger has only one selected layer", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const a = scene.addLayer(makeNode("A", {}, ids));
    stubCreator(scene, [a]);

    playbackBegin({ steps: [moveStep({ id: "REC", name: "Rec" })] as Any, staggerFrames: 10 });
    const result = playbackStep({ index: 0 });

    expect((result.notes ?? []).map((n: Any) => n.message)).toContain(
      "stagger needs 2 or more selected layers — replayed without it",
    );
    expect(a.startFrame).toBe(0);
  });

  it("says so when stagger falls to a scene rebuild", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const a = scene.addLayer(makeNode("A", {}, ids));
    const b = scene.addLayer(makeNode("B", {}, ids));
    stubCreator(scene, []);

    playbackBegin({
      steps: [moveStep({ id: a.id, name: "A" }), moveStep({ id: b.id, name: "B" })] as Any,
      staggerFrames: 10,
    });
    const result = playbackStep({ index: 0 });

    expect((result.notes ?? []).map((n: Any) => n.message)).toContain(
      "stagger needs layers selected — replayed without it",
    );
    expect([a.startFrame, b.startFrame]).toEqual([0, 0]);
  });

  it("keeps the delay notes when step 0 fails on a target", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const a = scene.addLayer(makeNode("A", {}, ids));
    const b = scene.addLayer(makeNode("B", {}, ids));
    // A host that refuses this one write — the delay ran before the step, so
    // its notes must survive the failure.
    Object.defineProperty(b.position, "staticValue", {
      get: () => ({ x: 0, y: 0 }),
      set: () => {
        throw new Error("✗ Invalid input");
      },
      configurable: true,
    });
    stubCreator(scene, [a, b]);

    playbackBegin({ steps: [moveStep({ id: "REC", name: "Rec" })] as Any, staggerFrames: 10 });
    const result = playbackStep({ index: 0 });

    expect(result.failures).toEqual([{ target: "B", message: "✗ Invalid input" }]);
    expect((result.notes ?? []).map((n: Any) => n.message)).toContain(
      "delayed this layer by 10 frames — in point 0 → 10",
    );
    expect(b.startFrame).toBe(10);
  });
});

describe("add-layer replay picks the factory matching the recorded node type", () => {
  it("rebuilds a TEXT_LAYER add-layer spec with createTextLayer, not createShapeLayer (BUG: createLayerFromSpec only branches on nodeType.startsWith('SCENE'))", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    let shapeLayerCalls = 0;
    let textLayerCalls = 0;
    scene.createShapeLayer = () => {
      shapeLayerCalls += 1;
      return scene.addLayer(makeNode("wrong shell", {}, ids));
    };
    scene.createTextLayer = () => {
      textLayerCalls += 1;
      return scene.addLayer(makeNode("Text 1", { type: "TEXT_LAYER" }, ids));
    };
    stubCreator(scene, []);

    playbackBegin({
      steps: [
        step({
          op: "add-layer",
          spec: {
            nodeId: "T1",
            nodeType: "TEXT_LAYER",
            nodeName: "Text 1",
            props: {},
            plain: { text: "hello", fontFamily: "Inter" },
            fills: [],
            strokes: [],
            masks: [],
            shapes: [],
          },
        }),
      ] as Any,
    });
    const result = playbackStep({ index: 0 });
    expect(result.failures).toEqual([]);
    // real host exposes scene.createTextLayer() (docs/runtime-api.md:71-72) — that's
    // the factory a recorded TEXT_LAYER spec should be rebuilt with
    expect(textLayerCalls).toBe(1);
    expect(shapeLayerCalls).toBe(0);
    const created = scene.layers.find((l: Any) => l.name === "Text 1");
    expect(created.type).toBe("TEXT_LAYER");
    // the text surface only exists on a layer built by createTextLayer —
    // these plain writes are lost when the wrong factory runs
    expect(created.text).toBe("hello");
    expect(created.fontFamily).toBe("Inter");
  });

  it("still rebuilds a shape add-layer spec with createShapeLayer (no regression)", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    let shapeLayerCalls = 0;
    let textLayerCalls = 0;
    scene.createShapeLayer = () => {
      shapeLayerCalls += 1;
      return scene.addLayer(makeNode("Rectangle 1", {}, ids));
    };
    scene.createTextLayer = () => {
      textLayerCalls += 1;
      return scene.addLayer(makeNode("wrong", { type: "TEXT_LAYER" }, ids));
    };
    stubCreator(scene, []);

    playbackBegin({
      steps: [
        step({
          op: "add-layer",
          spec: {
            nodeId: "R1",
            nodeType: "RECTANGLE",
            nodeName: "Rectangle 1",
            props: {},
            plain: {},
            fills: [],
            strokes: [],
            masks: [],
            shapes: [],
          },
        }),
      ] as Any,
    });
    const result = playbackStep({ index: 0 });
    expect(result.failures).toEqual([]);
    expect(shapeLayerCalls).toBe(1);
    expect(textLayerCalls).toBe(0);
  });
});

describe("debug probes on a set-plain scalar path (probe() assumes an Animatable)", () => {
  it("reports the actual before/after text instead of null/null (BUG: probe() reads .staticValue on a raw scalar)", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    // A text-ish layer whose "text" is a plain scalar string, exactly like the
    // real host's LayerMixin.text — never an Animatable (engine/snapshot.ts's
    // PLAIN_PROPS comment: "never animatable, diffed by value").
    const caption = scene.addLayer(makeNode("Caption", {}, ids));
    caption.text = "hello";
    const other = scene.addLayer(makeNode("Rectangle 1", {}, ids));
    stubCreator(scene, []);

    // A second referenced layer makes this a scene rebuild, so it runs with
    // nothing selected; only step 0 is played.
    playbackBegin({
      steps: [
        step({
          op: "set-plain",
          path: ["text"],
          before: "hello",
          after: "world",
          layer: { id: "REC", name: "Caption", priorName: "Caption" },
        }),
        step({
          op: "set-plain",
          path: ["visible"],
          before: true,
          after: false,
          layer: { id: String(other.id), name: "Rectangle 1" },
        }),
      ] as Any,
      debug: true,
    });
    const result = playbackStep({ index: 0 });

    expect(result.failures).toEqual([]);
    // The write itself lands correctly — this is a diagnostics-only bug.
    expect(caption.text).toBe("world");
    // Desired: the probe reflects the real text value on both sides, so a
    // trace can tell a successful text write from a silently swallowed one.
    expect(result.debug?.before?.[0]?.value).toBe("hello");
    expect(result.debug?.after?.[0]?.value).toBe("world");
  });
});

describe("debug probes on paint paths (replace-paint verifiability)", () => {
  // Live gap (traces 2026-08-26T06-03-3x): replace-paint probes read
  // .staticValue off a Paint proxy -> null/null with no unreadable flag,
  // so a fill swap is indistinguishable from a silent failure. Contract:
  // a Paint-shaped resolved value probes as a summary {type, color, stops},
  // and a topology-remapped path (recorded deep, target flat) follows the
  // paint to where the write actually lands.
  it("reports a paint summary before and after a replace-paint", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const layer = scene.addLayer(makeNode("Ellipse 1", { fills: [{ r: 9, g: 9, b: 9 }] }, ids));
    stubCreator(scene, [layer]);
    const steps = [
      step({
        op: "replace-paint",
        path: ["fills", 0],
        spec: {
          kind: "gradient",
          gradientType: "GRADIENT_LINEAR",
          stops: { animated: false, static: [{ offset: 0, color: { r: 1, g: 2, b: 3 } }] },
        },
        layer: { id: "REC", name: "Circle 3" },
      }),
    ];
    playbackBegin({ steps: steps as Any, debug: true });
    const result = playbackStep({ index: 0 }) as Any;
    expect(result.failures).toEqual([]);
    const before = result.debug.before[0];
    const after = result.debug.after[0];
    expect(before.value).toMatchObject({ paintType: "SOLID" });
    expect(after.value).toMatchObject({ paintType: expect.stringContaining("GRADIENT") });
    expect(before.unreadable).toBeUndefined();
  });

  it("follows the paint on a topology-remapped path (recorded deep, target flat)", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const layer = scene.addLayer(makeNode("Ellipse 1", { fills: [{ r: 9, g: 9, b: 9 }] }, ids));
    stubCreator(scene, [layer]);
    const steps = [
      step({
        op: "replace-paint",
        path: ["shapes", 0, "fills", 0],
        spec: { kind: "solid", color: { animated: false, static: { r: 32, g: 106, b: 255 } } },
        layer: { id: "REC", name: "Circle 3" },
      }),
    ];
    playbackBegin({ steps: steps as Any, debug: true });
    const result = playbackStep({ index: 0 }) as Any;
    expect(result.failures).toEqual([]);
    const after = result.debug.after[0];
    expect(after.unreadable).toBeUndefined();
    expect(after.value).toMatchObject({ color: { r: 32, g: 106, b: 255 } });
  });
});

describe("debug probes on structural and scene ops (rev .52)", () => {
  // Live gap: a structural op's probe used the entry's own path, which has
  // no readable staticValue — so add-trim probed null/null (trace
  // 2026-08-26T08-13-16) and a creation was indistinguishable from a skip.
  // Contract: probe a MEMBER of the created entry, so BEFORE is unreadable
  // (nothing there yet) and AFTER carries the value.
  it("an add-mask probe distinguishes created from skipped (unreadable before, value after)", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const layer = scene.addLayer(makeNode("Ellipse 1", {}, ids));
    stubCreator(scene, [layer]);
    const steps = [
      step({
        op: "add-mask",
        path: ["masks", 0],
        spec: {
          mode: "add",
          pathData: { animated: false, static: { points: [], closed: true } },
          opacity: { animated: false, static: 100 },
        },
        layer: { id: "REC", name: "Ellipse 1" },
      }),
    ];
    playbackBegin({ steps: steps as Any, debug: true });
    const result = playbackStep({ index: 0 }) as Any;

    expect(result.failures).toEqual([]);
    expect(result.debug.path).toEqual(["masks", 0, "opacity"]);
    expect(result.debug.before[0].unreadable).toBeDefined();
    expect(result.debug.after[0].unreadable).toBeUndefined();
    expect(result.debug.after[0].value).toBe(100);
  });

  // Scene ops used to probe [] on both sides, leaving reorder / nest / break
  // structurally blind in traces (trace 2026-08-26T08-15-02).
  it("a scene op probes the ordered layer list before and after", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    scene.addLayer(makeNode("a", {}, ids));
    scene.addLayer(makeNode("b", {}, ids));
    scene.addLayer(makeNode("c", {}, ids));
    stubCreator(scene, []);

    playbackBegin({
      debug: true,
      steps: [
        step({
          op: "reorder-layers",
          order: [2, 0, 1],
          layers: [
            { id: "A", name: "a" },
            { id: "B", name: "b" },
            { id: "C", name: "c" },
          ],
        }),
      ] as Any,
    });
    const result = playbackStep({ index: 0 }) as Any;

    expect(result.failures).toEqual([]);
    expect(result.debug.before[0].value.map((entry: Any) => entry.name)).toEqual(["a", "b", "c"]);
    expect(result.debug.after[0].value.map((entry: Any) => entry.name)).toEqual(["c", "a", "b"]);
    // ids and types travel too, so a rename or a wrong-factory rebuild shows
    expect(result.debug.after[0].value[0]).toMatchObject({ type: expect.any(String) });
    expect(result.debug.after[0].value[0].id).toEqual(expect.any(String));
  });
});

/* ------------------------------------------------------------------ */
/* scene settings                                                      */
/* ------------------------------------------------------------------ */

/** A scene root that carries the plain settings 1.0.1 `Scene` declares. */
function withSettings(scene: Any) {
  scene.size = { width: 1920, height: 1080 };
  scene.backgroundColor = { r: 255, g: 255, b: 255 };
  scene.framerate = 30;
  scene.duration = 5;
  return scene;
}

describe("scene settings (set-scene)", () => {
  it("writes the setting onto the active scene, with nothing selected", () => {
    const ids = makeIds();
    const scene = withSettings(makeSceneRoot(ids));
    stubCreator(scene, []);

    const steps = [
      step({
        op: "set-scene",
        key: "size",
        before: { width: 1920, height: 1080 },
        after: { width: 1080, height: 1080 },
      }),
      step({ op: "set-scene", key: "framerate", before: 30, after: 60 }),
      step({
        op: "set-scene",
        key: "backgroundColor",
        before: { r: 255, g: 255, b: 255 },
        after: null,
      }),
    ];

    const begin = playbackBegin({ steps: steps as Any });
    expect(begin.total).toBe(3);
    for (let i = 0; i < steps.length; i++) {
      const result = playbackStep({ index: i });
      expect(result.failures).toEqual([]);
      expect(result.notes ?? []).toEqual([]);
    }
    expect(scene.size).toEqual({ width: 1080, height: 1080 });
    expect(scene.framerate).toBe(60);
    expect(scene.backgroundColor).toBe(null);
  });

  it("applies once — not once per selected layer — when a selection is present", () => {
    const ids = makeIds();
    const scene = withSettings(makeSceneRoot(ids));
    const a = scene.addLayer(makeNode("A", {}, ids));
    const b = scene.addLayer(makeNode("B", {}, ids));
    stubCreator(scene, [a, b]);

    playbackBegin({
      steps: [step({ op: "set-scene", key: "framerate", before: 30, after: 60 })] as Any,
    });
    const result = playbackStep({ index: 0 });
    expect(result.failures).toEqual([]);
    expect(result.notes ?? []).toEqual([]);
    expect(scene.framerate).toBe(60);
  });

  it("reports a host that keeps its own value instead of claiming success", () => {
    const ids = makeIds();
    const scene = withSettings(makeSceneRoot(ids));
    Object.defineProperty(scene, "framerate", {
      configurable: true,
      get: () => 30,
      set: () => {
        /* the host discards the write, like a locked scene */
      },
    });
    stubCreator(scene, []);

    playbackBegin({
      steps: [step({ op: "set-scene", key: "framerate", before: 30, after: 60 })] as Any,
    });
    const result = playbackStep({ index: 0 });
    expect(result.failures).toEqual([]);
    expect((result.notes ?? []).some((n: Any) => /didn't apply/.test(n.message))).toBe(true);
  });

  it("skips a setting the scene doesn't carry, rather than inventing the property", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids); // no settings at all
    stubCreator(scene, []);

    playbackBegin({
      steps: [step({ op: "set-scene", key: "framerate", before: 30, after: 60 })] as Any,
    });
    const result = playbackStep({ index: 0 });
    expect(result.failures).toEqual([]);
    expect((result.notes ?? []).some((n: Any) => /skipped/.test(n.message))).toBe(true);
    expect("framerate" in scene).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* image layers                                                        */
/* ------------------------------------------------------------------ */

describe("add-layer for an IMAGE_LAYER", () => {
  it("skips honestly instead of building an empty shape shell", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    scene.createShapeLayer = () => scene.addLayer(makeNode("Shape", {}, ids));
    stubCreator(scene, []);

    const spec = {
      nodeId: "IMG",
      nodeType: "IMAGE_LAYER",
      nodeName: "Logo.png",
      props: {},
      plain: {},
      fills: [],
      strokes: [],
      masks: [],
      shapes: [],
    };
    playbackBegin({ steps: [step({ op: "add-layer", spec })] as Any });
    const result = playbackStep({ index: 0 });

    expect(result.failures).toEqual([]);
    expect((result.notes ?? []).some((n: Any) => /image asset/.test(n.message))).toBe(true);
    expect(scene.layers).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* playback targets                                                    */
/* ------------------------------------------------------------------ */

describe("playbackBegin — selection filtering", () => {
  it("drops selected shapes from the target list and says so once", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const layer = scene.addLayer(makeNode("Layer A", { type: "SHAPE_LAYER" }, ids));
    const rect = layer.createRectangle({ size: { width: 10, height: 10 } });
    const ellipse = layer.createEllipse({});
    stubCreator(scene, [layer, rect, ellipse]);

    const begin = playbackBegin({
      steps: [step({ op: "set-static", path: ["opacity"], before: 100, after: 50 })] as Any,
    });
    expect(begin.targetCount).toBe(1);

    const result = playbackStep({ index: 0 });
    const messages = (result.notes ?? []).map((n: Any) => n.message);
    expect(messages.filter((m: string) => /selected shapes? skipped/.test(m))).toHaveLength(1);
    expect(layer.opacity.staticValue).toBe(50);
  });

  it("prefers creator.utils.isLayer over the startFrame fallback when the host exposes it", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const layer = scene.addLayer(makeNode("Layer A", { type: "SHAPE_LAYER" }, ids));
    // No startFrame — the fallback would call this a shape and drop it.
    const exotic: Any = { name: "Exotic layer", opacity: { staticValue: 100 } };
    stubCreator(scene, [layer, exotic]);
    // The typed 1.0.1 surface, never live-verified — feature-detected.
    (globalThis as Any).creator.utils = { isLayer: () => true };

    const begin = playbackBegin({
      steps: [step({ op: "set-static", path: ["opacity"], before: 100, after: 50 })] as Any,
    });
    expect(begin.targetCount).toBe(2);
    const result = playbackStep({ index: 0 });
    expect((result.notes ?? []).some((n: Any) => /skipped/.test(n.message))).toBe(false);
    expect(layer.opacity.staticValue).toBe(50);
  });

  it("falls through to the existing no-targets path when only shapes were selected", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const layer = scene.addLayer(makeNode("Layer A", { type: "SHAPE_LAYER" }, ids));
    const rect = layer.createRectangle({ size: { width: 10, height: 10 } });
    stubCreator(scene, [rect]);

    expect(() =>
      playbackBegin({
        steps: [step({ op: "set-static", path: ["opacity"], before: 100, after: 50 })] as Any,
      }),
    ).toThrow("no-selection");
  });
});

/* ------------------------------------------------------------------ */
/* diagnostics                                                         */
/* ------------------------------------------------------------------ */

describe("the playback probe reads path values structurally", () => {
  it("a pathData probe carries the points, not an empty object", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const layer = scene.addLayer(makeNode("Layer A", { type: "SHAPE_LAYER" }, ids));
    layer.createPath({
      pathData: { closed: true, points: [{ vertex: { x: 1, y: 2 } }, { vertex: { x: 3, y: 4 } }] },
    });
    stubCreator(scene, [layer]);

    const after = { closed: true, points: [{ vertex: { x: 5, y: 6 } }] };
    playbackBegin({
      debug: true,
      steps: [
        step({
          op: "set-static",
          path: ["shapes", 0, "pathData"],
          before: { closed: true, points: [] },
          after,
          shapeHint: "PATH",
        }),
      ] as Any,
    });
    const result = playbackStep({ index: 0 });
    expect(result.failures).toEqual([]);
    const beforeProbe = result.debug!.before[0]!.value as Any;
    expect(beforeProbe.points).toHaveLength(2);
    expect(beforeProbe.points[0].vertex).toEqual({ x: 1, y: 2 });
    expect((result.debug!.after[0]!.value as Any).points).toHaveLength(1);
  });
});

describe("mask mode replays through the set-plain channel", () => {
  it("writes Mask.mode on the target's mask", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const layer = scene.addLayer(makeNode("Layer A", { type: "SHAPE_LAYER" }, ids));
    layer.createMask({ mode: "add" });
    stubCreator(scene, [layer]);

    playbackBegin({
      steps: [
        step({ op: "set-plain", path: ["masks", 0, "mode"], before: "add", after: "subtract" }),
      ] as Any,
    });
    const result = playbackStep({ index: 0 });
    expect(result.failures).toEqual([]);
    expect(result.notes ?? []).toEqual([]);
    expect(layer.masks[0].mode).toBe("subtract");
  });
});

describe("relativePaths honours the per-step class", () => {
  it("skips a path whose only step carries a formula — it reads the target live", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const source = scene.addLayer(
      makeNode("star 6", { props: { position: { x: 10, y: 10 } } }, ids),
    );
    const target = scene.addLayer(
      makeNode("Polygon 1", { props: { position: { x: 500, y: 500 } } }, ids),
    );
    stubCreator(scene, [target]);

    const steps = [
      step({
        op: "set-static",
        path: ["position"],
        before: { x: 10, y: 10 },
        after: { x: 110, y: 10 },
        apply: { x: { scale: 0, offset: 110 }, y: { scale: 0, offset: 10 } },
        layer: { id: String(source.id), name: "star 6" },
      }),
    ];

    playbackBegin({ steps: steps as Any });
    expect(playbackStep({ index: 0 }).failures).toEqual([]);
    expect(target.position.staticValue).toEqual({ x: 110, y: 10 });
  });

  it("skips a path whose only step is a recorded reset — the target lands on the identity", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const source = scene.addLayer(makeNode("star 6", { props: { rotation: 45 } }, ids));
    const target = scene.addLayer(makeNode("Polygon 1", { props: { rotation: 30 } }, ids));
    stubCreator(scene, [target]);

    const steps = [
      step({
        op: "set-static",
        path: ["rotation"],
        before: 45,
        after: 0,
        layer: { id: String(source.id), name: "star 6" },
      }),
    ];

    playbackBegin({ steps: steps as Any });
    expect(playbackStep({ index: 0 }).failures).toEqual([]);
    expect(target.rotation.staticValue).toBe(0);
  });

  it("tracks a mixed path so the following default step still has an origin", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const source = scene.addLayer(
      makeNode("star 6", { props: { position: { x: 10, y: 10 } } }, ids),
    );
    const target = scene.addLayer(
      makeNode("Polygon 1", { props: { position: { x: 500, y: 500 } } }, ids),
    );
    stubCreator(scene, [target]);

    const layer = { id: String(source.id), name: "star 6" };
    const steps = [
      step({
        op: "set-static",
        path: ["position"],
        before: { x: 10, y: 10 },
        after: { x: 110, y: 10 },
        apply: { x: { scale: 0, offset: 110 }, y: { scale: 0, offset: 10 } },
        layer,
      }),
      step({
        op: "set-static",
        path: ["position"],
        before: { x: 110, y: 10 },
        after: { x: 160, y: 10 },
        layer,
      }),
    ];

    playbackBegin({ steps: steps as Any });
    expect(playbackStep({ index: 0 }).failures).toEqual([]);
    expect(target.position.staticValue).toEqual({ x: 110, y: 10 });

    // The formula write re-anchors the path: the target IS at 110 now, so the
    // recorded +50 lands on 160 — not on baseline (500) + 50, which is where a
    // baseline frozen at playback.begin would have put it.
    expect(playbackStep({ index: 1 }).failures).toEqual([]);
    expect(target.position.staticValue).toEqual({ x: 160, y: 10 });
  });

  it("ignores a formula in scene mode: a rebuild reproduces the recording", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const source = scene.addLayer(
      makeNode("star 6", { props: { position: { x: 310, y: 20 } } }, ids),
    );
    const other = scene.addLayer(makeNode("star 7", { props: { position: { x: 5, y: 5 } } }, ids));
    // Nothing selected and TWO recorded layers: a scene rebuild. (One
    // recorded layer with nothing selected now replays onto that layer in
    // targets mode, formula and all — see "a solo-layer macro replayed with
    // nothing selected".)
    stubCreator(scene, []);

    const steps = [
      step({
        op: "set-static",
        path: ["position"],
        before: { x: 10, y: 10 },
        after: { x: 160, y: 50 },
        apply: { x: { scale: 1, offset: 10 }, y: { scale: 0, offset: 5 } },
        layer: { id: String(source.id), name: "star 6" },
      }),
      step({
        op: "set-static",
        path: ["position"],
        before: { x: 5, y: 5 },
        after: { x: 6, y: 6 },
        layer: { id: String(other.id), name: "star 7" },
      }),
    ];

    playbackBegin({ steps: steps as Any });
    expect(playbackStep({ index: 0 }).failures).toEqual([]);
    expect(source.position.staticValue).toEqual({ x: 160, y: 50 });
  });

  it("composes chained formula steps on the value each one left", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const source = scene.addLayer(
      makeNode("star 6", { props: { position: { x: 10, y: 10 } } }, ids),
    );
    const target = scene.addLayer(
      makeNode("Polygon 1", { props: { position: { x: 500, y: 500 } } }, ids),
    );
    stubCreator(scene, [target]);

    const layer = { id: String(source.id), name: "star 6" };
    const steps = [
      step({
        op: "set-static",
        path: ["position"],
        before: { x: 10, y: 10 },
        after: { x: 20, y: 10 },
        apply: { x: { scale: 1, offset: 10 }, y: { scale: 1, offset: 0 } },
        layer,
      }),
      step({
        op: "set-static",
        path: ["position"],
        before: { x: 20, y: 10 },
        after: { x: 40, y: 10 },
        apply: { x: { scale: 2, offset: 0 }, y: { scale: 1, offset: 0 } },
        layer,
      }),
    ];

    playbackBegin({ steps: steps as Any });
    expect(playbackStep({ index: 0 }).failures).toEqual([]);
    expect(target.position.staticValue).toEqual({ x: 510, y: 500 });
    // The second formula reads what the first one left, not the baseline.
    expect(playbackStep({ index: 1 }).failures).toEqual([]);
    expect(target.position.staticValue).toEqual({ x: 1020, y: 500 });
  });

  it("rebases each target on its OWN formula result, not on the recording", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const source = scene.addLayer(
      makeNode("star 6", { props: { position: { x: 10, y: 10 } } }, ids),
    );
    const one = scene.addLayer(
      makeNode("Polygon 1", { props: { position: { x: 500, y: 500 } } }, ids),
    );
    const two = scene.addLayer(
      makeNode("Polygon 2", { props: { position: { x: 800, y: 500 } } }, ids),
    );
    stubCreator(scene, [one, two]);

    const layer = { id: String(source.id), name: "star 6" };
    const steps = [
      step({
        op: "set-static",
        path: ["position"],
        before: { x: 10, y: 10 },
        after: { x: 20, y: 10 },
        apply: { x: { scale: 1, offset: 10 }, y: { scale: 1, offset: 0 } },
        layer,
      }),
      step({
        op: "set-static",
        path: ["position"],
        before: { x: 20, y: 10 },
        after: { x: 70, y: 10 },
        layer,
      }),
    ];

    playbackBegin({ steps: steps as Any });
    expect(playbackStep({ index: 0 }).failures).toEqual([]);
    expect(playbackStep({ index: 1 }).failures).toEqual([]);
    // Each target moved +10 and then the recorded +50, from where IT was.
    expect(one.position.staticValue).toEqual({ x: 560, y: 500 });
    expect(two.position.staticValue).toEqual({ x: 860, y: 500 });
  });
});

describe("a SKIPPED absolute step does not re-anchor the target", () => {
  it("leaves a keyframed target's later add step on its own baseline", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const source = scene.addLayer(
      makeNode("star 6", { props: { position: { x: 10, y: 10 } } }, ids),
    );
    const still = scene.addLayer(
      makeNode("Polygon 1", { props: { position: { x: 500, y: 500 } } }, ids),
    );
    const animated = scene.addLayer(
      makeNode("Polygon 2", { props: { position: { x: 500, y: 500 } } }, ids),
    );
    // This target's position is on the timeline, so the host discards a
    // staticValue write — the applier reports it as a skip, not a failure.
    animated.position.addKeyframes([{ frame: 10, value: { x: 500, y: 500 } }]);
    stubCreator(scene, [still, animated]);

    const layer = { id: String(source.id), name: "star 6" };
    const steps = [
      step({
        op: "set-static",
        path: ["position"],
        before: { x: 10, y: 10 },
        after: { x: 110, y: 10 },
        apply: { x: { scale: 0, offset: 110 }, y: { scale: 0, offset: 10 } },
        layer,
      }),
      step({
        op: "keyframes",
        path: ["position"],
        added: [
          { frame: 30, value: { x: 160, y: 10 } },
          { frame: 60, value: { x: 200, y: 10 } },
        ],
        removed: [],
        changed: [],
        layer,
      }),
    ];

    playbackBegin({ steps: steps as Any });

    const placed = playbackStep({ index: 0 });
    expect(placed.failures).toEqual([]);
    expect(still.position.staticValue).toEqual({ x: 110, y: 10 });
    // The keyframed target took nothing: it is still where it started.
    expect((placed.notes ?? []).map((note: Any) => note.target)).toEqual(["Polygon 2"]);
    expect(animated.position.getValueAt(10)).toEqual({ x: 500, y: 500 });

    expect(playbackStep({ index: 1 }).failures).toEqual([]);
    // The write landed here, so this target was re-anchored on it and the
    // recorded motion replays from the recorded values.
    expect(still.position.keyframes.map((k: Any) => k.value)).toEqual([
      { x: 160, y: 10 },
      { x: 200, y: 10 },
    ]);
    // It did NOT land here, so this target keeps the SHARED recorded origin
    // (the motion's own first value, x 160) and its own baseline: the motion
    // replays from where the target already was, 500 then 540. The re-anchor
    // the other target earned belongs to that target alone — sharing it would
    // have pushed this one to 550 and 590, a place nothing here ever reached.
    expect(animated.position.getValueAt(30)).toEqual({ x: 500, y: 500 });
    expect(animated.position.getValueAt(60)).toEqual({ x: 540, y: 500 });
  });
});

describe(
  "a solo-layer macro replayed with nothing selected (rev 2026-09-08.2, " +
    "traces 2026-09-08T02-19-34-375 / 02-19-41-998)",
  () => {
    it("refuses with no-selection, even when the macro carries its sourceNodeId", () => {
      const ids = makeIds();
      const scene = makeSceneRoot(ids);
      // The layer sits at the RECORDED END STATE, exactly as it does right
      // after recording a single set-static position step.
      const ellipse = scene.addLayer(
        makeNode("Ellipse 1", { props: { position: { x: 87.5, y: 45 } } }, ids),
      );
      stubCreator(scene, []);

      const steps = [
        step({
          op: "set-static",
          path: ["position"],
          before: { x: 42.5, y: 45 },
          after: { x: 87.5, y: 45 },
          layer: { id: String(ellipse.id), name: "Ellipse 1" },
        }),
      ];

      expect(() =>
        playbackBegin({ steps: steps as Any, sourceNodeId: String(ellipse.id) }),
      ).toThrow("no-selection");
      // The recorded layer is a hidden target: nothing is written to it.
      expect(ellipse.position.staticValue).toEqual({ x: 87.5, y: 45 });
    });

    it("refuses with no-selection when the steps name their layer and no source is saved", () => {
      const ids = makeIds();
      const scene = makeSceneRoot(ids);
      const ellipse = scene.addLayer(
        makeNode("Ellipse 1", { props: { position: { x: 87.5, y: 45 } } }, ids),
      );
      stubCreator(scene, []);

      const steps = [
        step({
          op: "set-static",
          path: ["position"],
          before: { x: 42.5, y: 45 },
          after: { x: 87.5, y: 45 },
          layer: { id: String(ellipse.id), name: "Ellipse 1" },
        }),
      ];

      expect(() => playbackBegin({ steps: steps as Any })).toThrow("no-selection");
      expect(ellipse.position.staticValue).toEqual({ x: 87.5, y: 45 });
    });
  },
);

describe(
  "verbatim scene-mode write when the live value already matches the recording " +
    "(rev 2026-09-07.8, trace 2026-09-08T02-19-34-375)",
  () => {
    it(
      "reports an info note 'already at this value — nothing changed' on that target " +
        "instead of silently reporting success with no notes " +
        "(BUG: applyStep's scene-mode set-static write has no such check today)",
      () => {
        const ids = makeIds();
        const scene = makeSceneRoot(ids);
        // Two pre-existing layers referenced by name+id forces scene mode
        // (chooseMode: preExisting.size > 1) regardless of selection.
        const layerA = scene.addLayer(
          makeNode("Layer A", { props: { position: { x: 100, y: 50 } } }, ids),
        );
        const layerB = scene.addLayer(
          makeNode("Layer B", { props: { position: { x: 10, y: 10 } } }, ids),
        );
        stubCreator(scene, []);

        const steps = [
          step({
            op: "set-static",
            path: ["position"],
            before: { x: 0, y: 0 },
            after: { x: 100, y: 50 },
            layer: { id: String(layerA.id), name: "Layer A" },
          }),
          step({
            op: "set-static",
            path: ["position"],
            before: { x: 10, y: 10 },
            after: { x: 200, y: 20 },
            layer: { id: String(layerB.id), name: "Layer B" },
          }),
        ];

        playbackBegin({ steps: steps as Any });

        const r0 = playbackStep({ index: 0 });
        expect(r0.failures).toEqual([]);
        // Layer A was already at the recorded `after` before this step ran.
        expect(r0.notes ?? []).toContainEqual({
          target: "Layer A",
          message: "already at this value — nothing changed",
          kind: "info",
        });

        const r1 = playbackStep({ index: 1 });
        expect(r1.failures).toEqual([]);
        // Layer B was NOT already at its recorded `after` — no such note, and
        // the value actually changed.
        expect(
          (r1.notes ?? []).some(
            (note: Any) => note.message === "already at this value — nothing changed",
          ),
        ).toBe(false);
        expect(layerB.position.staticValue).toEqual({ x: 200, y: 20 });
      },
    );
  },
);
