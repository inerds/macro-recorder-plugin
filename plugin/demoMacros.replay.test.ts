/**
 * Every demo macro replays.
 *
 * The demo macros in `src/dev/demoMacros.ts` are seed DATA a dev session
 * records over, simplifies, pins and presses Play on — so each one is driven
 * here through the REAL playback orchestrator against the shared fake scene,
 * the same path Creator takes. A step that throws fails this suite.
 *
 * `StepOutcome` notes are expected and fine: they are the engine reporting a
 * deliberate adaptation ("this layer's fill was solid — converted it to a
 * gradient"). Only a FAILURE — a thrown error, which pauses playback for the
 * user — counts as broken.
 *
 * It lives here rather than beside its subject because it needs the `creator`
 * global, which only tsconfig.plugin.json knows about; the macros' shape is
 * asserted in `src/dev/demoMacros.test.ts`.
 */
import { afterEach, describe, expect, it } from "vitest";

import { describePlaybackMode } from "../shared/playbackMode";
import { makeIds, makeNode } from "../shared/testing/fakeScene";
import { enabledSteps } from "../src/gateways/types";
import { buildDemoMacros, DEMO_LAYERS } from "../src/dev/demoMacros";
import { playbackBegin, playbackEnd, playbackStep } from "./playback";

const macros = buildDemoMacros(1_700_000_000_000);

type Any = any;

/**
 * A scene holding the three layers the demo macros are written against,
 * plus the untyped layer factories a scene script needs. Layer ids are the
 * fake's own, so resolution runs through the recorded NAME (and, for the
 * caption, its `priorName`) exactly as it does on a real host replaying
 * someone else's macro.
 */
function makeDemoScene() {
  const nextId = makeIds();
  const scene: Any = { id: nextId("scene"), name: "Main Scene", layers: [] as Any[] };

  scene.addLayer = (layer: Any) => {
    layer.parent = { shapes: scene.layers, layers: scene.layers, type: "SCENE" };
    scene.layers.push(layer);
    return layer;
  };
  scene.createShapeLayer = () => scene.addLayer(makeNode("Shape Layer", {}, nextId));
  scene.createTextLayer = () =>
    scene.addLayer(makeNode("Text Layer", { type: "TEXT_LAYER" }, nextId));
  scene.createSceneLayer = () => {
    const empty = scene.addLayer(makeNode("Scene", { type: "SCENE_INSTANCE" }, nextId));
    empty.scene = { layers: [] as Any[] };
    return empty;
  };
  scene.createSceneInstance = (nodes: Any[]) => {
    for (const node of nodes) {
      const at = scene.layers.indexOf(node);
      if (at >= 0) scene.layers.splice(at, 1);
    }
    const instance = scene.addLayer(makeNode("Nested Scene", { type: "SCENE_INSTANCE" }, nextId));
    instance.scene = { layers: nodes };
    instance.__setSceneContents(nodes);
    return instance;
  };

  const hero = scene.addLayer(
    makeNode(
      DEMO_LAYERS.hero.name!,
      { props: { position: { x: 540, y: 560 } }, fills: [{ r: 200, g: 200, b: 200 }] },
      nextId,
    ),
  );
  hero.createRectangle({ size: { x: 160, y: 160 } });
  const orbit = scene.addLayer(
    makeNode(DEMO_LAYERS.orbit.name!, { props: { position: { x: 820, y: 300 } } }, nextId),
  );
  orbit.createEllipse({ size: { x: 48, y: 48 } });
  // named with its PRE-rename name on purpose: "Storyboard shuffle" is
  // recorded after the rename and must resolve through priorName
  const caption = scene.addLayer(
    makeNode(DEMO_LAYERS.caption.priorName!, { props: { position: { x: 120, y: 940 } } }, nextId),
  );

  return { scene, hero, orbit, caption };
}

function stubCreator(scene: Any, selection: Any[]) {
  (globalThis as Any).creator = {
    activeScene: scene,
    selection: { nodes: selection },
    timeline: { currentFrame: 0 },
    ui: { postMessage() {}, onMessage() {}, show() {} },
  };
}

afterEach(() => {
  playbackEnd();
  delete (globalThis as Any).creator;
});

/** Runs every enabled step, returning the failures and notes it produced. */
function replay(macro: (typeof macros)[number]) {
  const steps = enabledSteps(macro);
  const { scene, hero, orbit, caption } = makeDemoScene();
  // Targets mode is the selection-present case; a scene script must run
  // with nothing selected or it would retarget its structural ops.
  const mode = describePlaybackMode(macro).mode;
  stubCreator(scene, mode === "targets" ? [hero] : []);

  const begin = playbackBegin({
    steps,
    ...(macro.source ? { sourceNodeId: macro.source.nodeId } : {}),
    ...(macro.playOptions?.staggerFrames ? { staggerFrames: macro.playOptions.staggerFrames } : {}),
    ...(macro.playOptions?.atPlayhead ? { atPlayhead: true } : {}),
  });

  const failures: { target: string; message: string }[] = [];
  const notes: string[] = [];
  for (let index = 0; index < steps.length; index++) {
    const result = playbackStep({ index });
    failures.push(...result.failures);
    for (const note of result.notes ?? []) notes.push(note.message);
  }
  return { begin, failures, notes, scene, hero, orbit, caption, mode };
}

describe("every demo macro replays against the fake scene", () => {
  for (const macro of macros) {
    it(`replays "${macro.name}" with no failures`, () => {
      const { failures } = replay(macro);
      expect(failures).toEqual([]);
    });
  }
});

// The per-macro assertions below pin what each one is a demo OF — so a demo
// that silently degrades into a list of skips fails here, not in the panel.

describe("what each demo macro actually does", () => {
  it("Bounce & settle keyframes the position, moves one and drops one", () => {
    const macro = macros.find((m) => m.name === "Bounce & settle")!;
    const { hero, failures } = replay(macro);
    expect(failures).toEqual([]);
    // f0 + f18 survive: f12 moved to 18, f24 was removed
    expect(hero.position.keyframes.map((k: Any) => k.frame)).toEqual([0, 18]);
    // length-1 transforms are relative — the target started at 100/0
    expect(hero.scale.staticValue).toEqual({ x: 118, y: 118 });
    expect(hero.rotation.staticValue).toBe(-6);
  });

  it("Brand recolor pro swaps the fill for a gradient and strokes it", () => {
    const macro = macros.find((m) => m.name === "Brand recolor pro")!;
    const { hero, failures } = replay(macro);
    expect(failures).toEqual([]);
    expect(hero.fills).toHaveLength(1);
    expect(hero.fills[0].type).toBe("GRADIENT_LINEAR");
    expect(hero.fills[0].stops.staticValue).toHaveLength(3);
    expect(hero.strokes).toHaveLength(1);
    expect(hero.strokes[0].width.staticValue).toBe(8);
    expect(hero.strokes[0].fill.color.staticValue).toEqual({ r: 120, g: 52, b: 198 });
  });

  it("Cross-kind chaos converts the solid fill and creates the trim on demand", () => {
    const macro = macros.find((m) => m.name === "Cross-kind chaos")!;
    const { hero, failures, notes } = replay(macro);
    expect(failures).toEqual([]);
    expect(hero.fills[0].type).toBe("GRADIENT_LINEAR");
    // the solid recolor that followed tinted every stop of what it converted
    expect(
      hero.fills[0].stops.staticValue.map((s: Any) => s.color),
    ).toEqual([
      { r: 236, g: 79, b: 53 },
      { r: 236, g: 79, b: 53 },
      { r: 236, g: 79, b: 53 },
    ]);
    expect(hero.trimPaths).toHaveLength(1);
    expect(hero.trimPaths[0].end.staticValue).toBe(62);
    // nothing applied silently
    expect(notes.join(" | ")).toContain("converted it to a gradient");
  });

  it("Pop-in duplicates clones the SELECTED layer twice, chained", () => {
    const macro = macros.find((m) => m.name === "Pop-in duplicates")!;
    const { scene, failures } = replay(macro);
    expect(failures).toEqual([]);
    // hero, orbit, caption + two copies; clone() seats each copy right
    // after its source, so find them by the name the fake host gives them
    expect(scene.layers).toHaveLength(5);
    const byName = (name: string) => scene.layers.find((layer: Any) => layer.name === name);
    const first = byName("Hero Square copy");
    const second = byName("Hero Square copy copy");
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // the copy's own edit is retargeted: the recorded +120 x, from the
    // SELECTED layer's baseline (540,560)
    expect(first.position.staticValue).toEqual({ x: 660, y: 560 });
    // the chained duplicate cloned THAT copy and shifted by the recorded 48/48
    expect(second.position.staticValue).toEqual({ x: 708, y: 608 });
  });

  it("Storyboard shuffle renames through priorName, reorders and removes", () => {
    const macro = macros.find((m) => m.name === "Storyboard shuffle")!;
    const { scene, hero, orbit, failures } = replay(macro);
    expect(failures).toEqual([]);
    expect(hero.position.staticValue).toEqual({ x: 300, y: 420 });
    expect(orbit.opacity.staticValue).toBe(40);
    // the caption resolved by priorName, got renamed, then removed
    expect(scene.layers.map((layer: Any) => layer.name)).toEqual(["Hero Square", "Orbit Dot"]);
  });

  it("Nest & break nests two layers, moves the nest and breaks it open", () => {
    const macro = macros.find((m) => m.name === "Nest & break")!;
    const { scene, failures } = replay(macro);
    expect(failures).toEqual([]);
    // broken back open: the two layers are top-level again, the nest is gone
    expect(scene.layers.map((layer: Any) => layer.name)).toEqual([
      DEMO_LAYERS.caption.priorName,
      "Hero Square",
      "Orbit Dot",
    ]);
  });

  it("Type reveal builds a real text layer, not a shape shell", () => {
    const macro = macros.find((m) => m.name === "Type reveal")!;
    const { scene, failures } = replay(macro);
    expect(failures).toEqual([]);
    const title = scene.layers.find((layer: Any) => layer.name === "Title");
    expect(title).toBeDefined();
    expect(title.type).toBe("TEXT_LAYER");
    expect(title.text).toBe("Ship it, then polish.");
    expect(title.fontSize).toBe(88);
    expect(title.fills[0].color.staticValue).toEqual({ r: 255, g: 210, b: 92 });
    expect(title.opacity.keyframes.map((k: Any) => k.frame)).toEqual([0, 20]);
  });

  it("Masked spotlight keeps the mask its disabled step would remove", () => {
    const macro = macros.find((m) => m.name === "Masked spotlight")!;
    const { hero, failures } = replay(macro);
    expect(failures).toEqual([]);
    expect(hero.masks).toHaveLength(1);
    expect(hero.masks[0].opacity.keyframes.map((k: Any) => k.frame)).toEqual([0, 30]);
    // the path data survived the round trip as structure, not as {}
    expect(hero.masks[0].pathData.staticValue.points).toHaveLength(4);
  });

  it("Style stamp applies its captured state without teleporting the target", () => {
    const macro = macros.find((m) => m.name === "Style stamp")!;
    const { hero, failures } = replay(macro);
    expect(failures).toEqual([]);
    // before === after on a relative transform means NO movement, whatever
    // the target's own position is
    expect(hero.position.staticValue).toEqual({ x: 540, y: 560 });
    expect(hero.scale.staticValue).toEqual({ x: 100, y: 100 });
    expect(hero.fills[0].color.staticValue).toEqual({ r: 236, g: 79, b: 53 });
    // and the equal pairs read as values, not transitions
    expect(macro.steps[1]!.label).toContain("position = ");
  });

  // The real host's BlendMode is a lowercase string union (plugin-api.d.ts) —
  // assigning "NORMAL" throws "✗ Invalid input" on a live host (trace
  // 2026-08-26T08-15-55-277_playback-Style-stamp.json, rev .51). The applier
  // correctly catches that throw and turns it into a skip note rather than a
  // silent half-apply (see plugin/applier.test.ts), which is why this doesn't
  // show up in the "no failures" check above — but the demo's own seed data
  // (src/dev/demoMacros.ts:377) still sends the wrong-case "NORMAL", so the
  // step that's supposed to demonstrate "Add all" capture doesn't actually
  // apply. Currently FAILS: pins the desired behaviour (the seed step lands
  // cleanly), not what src/dev/demoMacros.ts currently does.
  it("Style stamp's blendMode step actually applies instead of being skipped for invalid input", () => {
    const macro = macros.find((m) => m.name === "Style stamp")!;
    const { hero, notes } = replay(macro);
    expect(notes.some((note) => /invalid input/i.test(note))).toBe(false);
    expect(hero.blendMode).toBe("normal");
  });

  it("Parametric slide moves and fades, but does not rotate (step disabled)", () => {
    const macro = macros.find((m) => m.name === "Parametric slide")!;
    const { hero, begin, failures } = replay(macro);
    expect(failures).toEqual([]);
    expect(begin.total).toBe(2);
    expect(hero.position.staticValue).toEqual({ x: 660, y: 560 });
    expect(hero.opacity.staticValue).toBe(30);
    expect(hero.rotation.staticValue).toBe(0);
    expect(macro.playOptions).toEqual({ staggerFrames: 5, repeat: 2 });
  });
});
