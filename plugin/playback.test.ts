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
    expect((result.notes ?? []).map((n: Any) => n.message)).toEqual(["nested 2 layer(s)"]);
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
