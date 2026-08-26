/**
 * Playback orchestration tests with a stubbed `creator` global — covers the
 * mode selection and retargeted duplication that applier tests can't reach.
 */
import { afterEach, describe, expect, it } from "vitest";

import { makeIds, makeNode } from "../shared/testing/fakeScene";
import { playbackBegin, playbackEnd, playbackStep } from "./playback";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

function makeSceneRoot(nextId: (p: string) => string) {
  const scene: Any = {
    id: nextId("scene"),
    name: "Main Scene",
    layers: [] as Any[],
  };
  scene.addLayer = (layer: Any) => {
    layer.parent = { shapes: scene.layers, layers: scene.layers, type: "SCENE" };
    scene.layers.push(layer);
    return layer;
  };
  scene.createSceneInstance = (nodes: Any[]) => {
    for (const node of nodes) {
      const at = scene.layers.indexOf(node);
      if (at >= 0) scene.layers.splice(at, 1);
    }
    const instance: Any = {
      id: `inst-${scene.layers.length}`,
      name: "Nested Scene",
      type: "SCENE_LAYER",
      scene: { layers: nodes },
      remove() {
        const at = scene.layers.indexOf(instance);
        if (at >= 0) scene.layers.splice(at, 1);
      },
    };
    scene.layers.push(instance);
    return instance;
  };
  scene.createSceneLayer = () => {
    // mirrors the real host: creates an EMPTY scene layer (live-verified)
    const instance: Any = {
      id: `scene-layer-${scene.layers.length}`,
      name: "Scene",
      type: "SCENE_LAYER",
      scene: { layers: [] as Any[] },
      props: {},
      remove() {
        const at = scene.layers.indexOf(instance);
        if (at >= 0) scene.layers.splice(at, 1);
      },
    };
    scene.layers.push(instance);
    return instance;
  };
  scene.giveShiftTo = (layer: Any) => {
    layer.shiftTo = (dest: Any) => {
      const at = scene.layers.indexOf(layer);
      if (at >= 0) scene.layers.splice(at, 1);
      dest.scene.layers.push(layer);
    };
    return layer;
  };
  return scene;
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
          nodeId: "REC_COPY", nodeType: "CONTAINER", nodeName: "star 7",
          props: {}, plain: {}, fills: [], strokes: [], masks: [], shapes: [],
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
          nodeId: "REC_COPY", nodeType: "CONTAINER", nodeName: "star 7",
          props: {}, plain: {}, fills: [], strokes: [], masks: [], shapes: [],
        },
      }),
    ];

    playbackBegin({ steps: steps as Any });
    const r0 = playbackStep({ index: 0 });
    expect(r0.failures).toEqual([]);
    expect(scene.layers).toHaveLength(2);
    expect(scene.layers[1].name).toBe("star 7"); // scene mode applies recorded name
  });

  it("multi-source macros ignore selection and stay scene scripts", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const a = scene.addLayer(makeNode("A", { props: { rotation: 0 } }, ids));
    const b = scene.addLayer(makeNode("B", { props: { rotation: 0 } }, ids));
    const other = scene.addLayer(makeNode("Other", { props: { rotation: 0 } }, ids));
    stubCreator(scene, [other]);

    const steps = [
      step({ op: "set-static", path: ["rotation"], before: 0, after: 45, layer: { id: String(a.id), name: "A" } }),
      step({ op: "set-static", path: ["rotation"], before: 0, after: 90, layer: { id: String(b.id), name: "B" } }),
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
            nodeId: "COPY", nodeType: "CONTAINER", nodeName: "Polygon 2",
            props: {}, plain: {}, fills: [], strokes: [], masks: [], shapes: [],
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
      nodeId: id, nodeType: "CONTAINER", nodeName: name,
      props: {}, plain: {}, fills: [], strokes: [], masks: [], shapes: [],
    });
    playbackBegin({
      steps: [
        step({ op: "add-layer", cloneOf: { id: "P1", name: "Polygon 1" }, spec: spec("P2", "Polygon 2") }),
        step({ op: "set-static", path: ["rotation"], before: 0, after: 26, layer: { id: "P2", name: "Polygon 2" } }),
        step({ op: "add-layer", cloneOf: { id: "P2", name: "Polygon 2" }, spec: spec("P3", "Polygon 3") }),
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
              nodeId: "F1", nodeType: "CONTAINER", nodeName: "Bubble",
              props: {}, plain: {}, fills: [], strokes: [], masks: [], shapes: [],
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
    expect(
      (result.notes ?? []).some((n: Any) => /identity|caution|verify/i.test(n.message)),
    ).toBe(true);
  });
});

describe("layer resolution across renames", () => {
  it("finds a pre-rename layer via the recorded priorName", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const text = scene.addLayer(makeNode("Text 1", {}, ids));
    stubCreator(scene, []);

    playbackBegin({
      steps: [
        step({
          op: "set-plain",
          path: ["visible"],
          before: true,
          after: false,
          layer: { id: "REC", name: "Text 1 (source text)", priorName: "Text 1" },
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
  it("nests the resolved layers via createSceneInstance", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
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
            nodeId: "NEW", nodeType: "SCENE_LAYER", nodeName: "Nested Scene 5",
            props: {}, plain: {}, fills: [], strokes: [], masks: [], shapes: [],
          },
        }),
      ] as Any,
    });
    const result = playbackStep({ index: 0 });
    expect(result.failures).toEqual([]);
    expect((result.notes ?? []).map((n: Any) => n.message)).toEqual(["nested 2 layers"]);
    expect(scene.layers.map((l: Any) => l.name)).toEqual(["Keep", "Nested Scene 5"]);
    expect(scene.layers[1].scene.layers).toEqual([a, b]);
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
            nodeId: "S1", nodeType: "SCENE_LAYER", nodeName: "Nested Scene 5",
            props: {}, plain: {}, fills: [], strokes: [], masks: [], shapes: [],
          },
        }),
      ] as Any,
    });
    const result = playbackStep({ index: 0 });
    expect(result.failures).toEqual([]);
    expect(shapeLayerCalls).toBe(0);
    expect(scene.layers.some((l: Any) => l.type === "SCENE_LAYER" && l.name === "Nested Scene 5")).toBe(true);
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
              nodeId: String(rect.id), nodeType: "CONTAINER", nodeName: "Rectangle 1",
              props: {}, plain: {}, fills: [], strokes: [], masks: [], shapes: [],
            },
          ],
        }),
        step({
          op: "set-static", path: ["rotation"], before: 0, after: 45,
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
            nodeId: String(existing.id), nodeType: "CONTAINER", nodeName: "Rectangle 1",
            props: {}, plain: {}, fills: [], strokes: [], masks: [], shapes: [],
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
    const nested = scene.createSceneInstance([a]);
    stubCreator(scene, []);

    playbackBegin({
      steps: [
        step({
          op: "nest-layers",
          layers: [{ id: "OLD_A", name: "Rectangle 1" }],
          spec: {
            nodeId: String(nested.id), nodeType: "SCENE_LAYER", nodeName: "Nested Scene 6",
            props: {}, plain: {}, fills: [], strokes: [], masks: [], shapes: [],
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
    const scene = makeSceneRoot(ids);
    const a = scene.addLayer(makeNode("Ellipse 1", {}, ids));
    const prior = scene.createSceneInstance([scene.addLayer(makeNode("old", {}, ids))]);
    stubCreator(scene, []);

    playbackBegin({
      steps: [
        step({
          op: "nest-layers",
          layers: [{ id: String(a.id), name: "Ellipse 1" }],
          spec: {
            nodeId: String(prior.id), nodeType: "SCENE_LAYER", nodeName: "Nested Scene 1",
            props: {}, plain: {}, fills: [], strokes: [], masks: [], shapes: [],
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
    const scene = makeSceneRoot(ids);
    scene.addLayer(makeNode("Ellipse 1", {}, ids)); // recorded source, untouched
    const x = scene.addLayer(makeNode("New A", { fills: [{ r: 0, g: 0, b: 0 }] }, ids));
    const y = scene.addLayer(makeNode("New B", {}, ids));
    stubCreator(scene, [x, y]);

    playbackBegin({
      steps: [
        step({
          op: "nest-layers",
          layers: [{ id: "REC1", name: "Ellipse 1" }, { id: "REC2", name: "Rectangle 1" }],
          spec: {
            nodeId: "NEST", nodeType: "SCENE_LAYER", nodeName: "Nested Scene 1",
            props: {}, plain: {}, fills: [], strokes: [], masks: [], shapes: [],
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

describe("nest via createSceneLayer + shiftTo (real-host shape)", () => {
  it("creates the scene layer and moves the selected layers in, in order", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    delete scene.createSceneInstance; // real host has no such method
    const x = scene.giveShiftTo(scene.addLayer(makeNode("New A", { fills: [{ r: 0, g: 0, b: 0 }] }, ids)));
    const y = scene.giveShiftTo(scene.addLayer(makeNode("New B", {}, ids)));
    stubCreator(scene, [x, y]);

    playbackBegin({
      steps: [
        step({
          op: "nest-layers",
          layers: [{ id: "R1", name: "Ellipse 1" }, { id: "R2", name: "Polygon 1" }],
          spec: {
            nodeId: "NEST", nodeType: "SCENE_LAYER", nodeName: "Nested Scene 2",
            props: {}, plain: {}, fills: [], strokes: [], masks: [], shapes: [],
          },
        }),
        // recorded on the SECOND nested layer — must map by ORDER
        step({
          op: "set-static",
          path: ["shapes", 1, "rotation"],
          before: 0,
          after: -30,
          shapeHint: "POLYGON",
          layer: { id: "NEST", name: "Nested Scene 2" },
        }),
      ] as Any,
    });
    const r0 = playbackStep({ index: 0 });
    expect(r0.failures).toEqual([]);
    const instance = scene.layers.find((l: Any) => l.type === "SCENE_LAYER");
    expect(instance.scene.layers.map((l: Any) => l.name)).toEqual(["New A", "New B"]);
    expect(instance.name).toBe("Nested Scene 2");

    const r1 = playbackStep({ index: 1 });
    expect(r1.failures).toEqual([]);
    // order-based: applied to the SECOND layer (New B) even though the
    // recorded hint said POLYGON and New B isn't one
    expect(y.rotation.staticValue).toBe(-30);
    expect(x.rotation.staticValue).toBe(0);
  });

  it("removes the empty shell and falls back when nothing can move layers", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    delete scene.createSceneInstance;
    const x = scene.addLayer(makeNode("New A", {}, ids)); // no shiftTo
    stubCreator(scene, [x]);

    playbackBegin({
      steps: [
        step({
          op: "nest-layers",
          layers: [{ id: "R1", name: "Ellipse 1" }],
          spec: {
            nodeId: "NEST", nodeType: "SCENE_LAYER", nodeName: "Nested Scene 2",
            props: {}, plain: {}, fills: [], strokes: [], masks: [], shapes: [],
          },
        }),
      ] as Any,
    });
    const r0 = playbackStep({ index: 0 });
    expect((r0.notes ?? []).some((n: Any) => n.message.includes("rebuilding the scene layer"))).toBe(true);
  });
});

describe("apply at playhead + stagger", () => {
  function kfStep(layer: Any) {
    return step({
      op: "keyframes",
      path: ["rotation"],
      added: [{ frame: 10, value: 0 }, { frame: 40, value: 90 }],
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
  });

  it("applies the playhead shift in scene mode too, and none without a readable timeline", () => {
    const ids = makeIds();
    const scene = makeSceneRoot(ids);
    const a = scene.addLayer(makeNode("A", {}, ids));
    const b = scene.addLayer(makeNode("B", {}, ids));
    stubCreator(scene, []);
    (globalThis as Any).creator.timeline = { currentFrame: 50 };
    // two pre-existing layers touched → scene script
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
            nodeId: "T1", nodeType: "TEXT_LAYER", nodeName: "Text 1",
            props: {}, plain: { text: "hello", fontFamily: "Inter" },
            fills: [], strokes: [], masks: [], shapes: [],
          },
        }),
      ] as Any,
    });
    const result = playbackStep({ index: 0 });
    expect(result.failures).toEqual([]);
    // real host exposes scene.createTextLayer() (RUNTIME-API.md:54) — that's
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
            nodeId: "R1", nodeType: "RECTANGLE", nodeName: "Rectangle 1",
            props: {}, plain: {}, fills: [], strokes: [], masks: [], shapes: [],
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
    // real host's LayerMixin.text — never an Animatable (shared/snapshot.ts's
    // PLAIN_PROPS comment: "never animatable, diffed by value").
    const caption = scene.addLayer(makeNode("Caption", {}, ids));
    caption.text = "hello";
    stubCreator(scene, []);

    playbackBegin({
      steps: [
        step({
          op: "set-plain",
          path: ["text"],
          before: "hello",
          after: "world",
          layer: { id: "REC", name: "Caption", priorName: "Caption" },
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
    const layer = scene.addLayer(
      makeNode("Ellipse 1", { fills: [{ r: 9, g: 9, b: 9 }] }, ids),
    );
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
    const layer = scene.addLayer(
      makeNode("Ellipse 1", { fills: [{ r: 9, g: 9, b: 9 }] }, ids),
    );
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
