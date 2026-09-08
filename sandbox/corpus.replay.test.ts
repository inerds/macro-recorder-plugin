/**
 * Every macro shape this plugin has ever saved still REPLAYS.
 *
 * The companion to `engine/corpus.test.ts`, which covers validation, import,
 * labels, editing, Simplify, and parameter pinning. Playback lives here
 * because it needs the `creator` global, which only `tsconfig.sandbox.json`
 * knows about — the same split `ui/dev/demoMacros.test.ts` and
 * `sandbox/demoMacros.replay.test.ts` already use.
 *
 * Each fixture is driven through the REAL playback orchestrator against the
 * fake scene, and each one carries at least one assertion on what the scene
 * ends up holding. Notes are expected: they are the engine reporting an
 * adaptation or a skip. Only a FAILURE counts as broken, and a fixture whose
 * shape the engine cannot replay declares its failures in `_corpus.replay`.
 */
import { afterEach, describe, expect, it } from "vitest";

import { describePlaybackMode } from "../engine/playbackMode";
import { makeFakeScene, makeIds, makeNode } from "../engine/testing/fakeScene";
import { CORPUS, corpusFixture, type CorpusFixture } from "../engine/testing/corpus";
import { enabledSteps } from "../ui/gateways/types";
import { endReplay, runSteps, stubCreator } from "./testing/replay";

type Any = any;

const INK = { r: 26, g: 26, b: 32 };
const EMBER = { r: 236, g: 79, b: 53 };

/**
 * The scene the corpus is written against: the three layers the demo macros
 * use, by the same names, plus the structure the older eras' paint, mask,
 * trim, and shape steps address. Layer ids are the fake's own, so every
 * recorded reference resolves through the NAME — and, for the caption,
 * through its `priorName` — exactly as it does on a real host.
 */
function makeCorpusScene() {
  const nextId = makeIds();
  const scene: Any = makeFakeScene(nextId);

  const hero = scene.addLayer(
    makeNode(
      "Hero Square",
      {
        props: { position: { x: 540, y: 560 }, rotation: 10 },
        fills: [INK, EMBER],
      },
      nextId,
    ),
  );
  hero.createRectangle({ size: { width: 160, height: 160 } });
  hero.createEllipse({ size: { width: 48, height: 48 } });

  const orbit = scene.addLayer(
    makeNode("Orbit Dot", { props: { position: { x: 820, y: 300 } } }, nextId),
  );
  orbit.createEllipse({ size: { width: 48, height: 48 } });

  // Named with its PRE-rename name: the corpus refers to it as "Old Caption"
  // with `priorName: "Caption"`, which is the resolution path a rename leaves.
  const caption = scene.addLayer(
    makeNode("Caption", { props: { position: { x: 120, y: 940 } } }, nextId),
  );

  return { scene, hero, orbit, caption };
}

afterEach(endReplay);

/** Runs one fixture the way the RPC server runs a macro. */
function replay(fixture: CorpusFixture) {
  const macro = fixture.macro;
  const steps = enabledSteps(macro);
  const world = makeCorpusScene();
  const mode = describePlaybackMode(macro).mode;
  // Targets mode is the selection-present case; a scene rebuild must run with
  // nothing selected or it would retarget its structural ops.
  stubCreator(world.scene, mode === "targets" ? [world.hero] : []);
  const outcome = runSteps(steps, {
    ...(macro.source ? { sourceNodeId: macro.source.nodeId } : {}),
    ...(macro.playOptions?.staggerFrames ? { staggerFrames: macro.playOptions.staggerFrames } : {}),
    ...(macro.playOptions?.atPlayhead ? { atPlayhead: true } : {}),
  });
  return { ...world, ...outcome, mode, steps };
}

describe("every corpus macro replays", () => {
  for (const fixture of CORPUS) {
    it(`replays the "${fixture.meta.era}" shape as its fixture declares`, () => {
      const { failures } = replay(fixture);
      expect(failures.map((failure) => failure.message)).toEqual(
        fixture.meta.replay?.failures ?? [],
      );
    });
  }
});

// One assertion per era on what the scene ends up holding — so a shape that
// degrades into a list of skips fails here rather than in the panel.

describe("what each corpus macro does to the scene", () => {
  it("v1-legacy nudges the target and adds the legacy fill", () => {
    const { hero } = replay(corpusFixture("v1-legacy"));
    // A layer's own position is relative: the recorded +60 x, from the
    // TARGET's own start.
    expect(hero.position.staticValue).toEqual({ x: 600, y: 560 });
    expect(hero.fills).toHaveLength(3);
    expect(hero.fills[2].color.staticValue).toEqual(EMBER);
  });

  it("v1-legacy reports the mock payload instead of crashing on it", () => {
    const { failures, notes } = replay(corpusFixture("v1-legacy"));
    expect(failures).toHaveLength(1);
    expect(failures[0]!.message).toContain("unrecognized format");
    // The not-replayable step is a noted skip, not a failure.
    expect(notes.join(" | ")).toContain("Reordered layers — skipped");
  });

  it("v3-launch restyles the paints, mask, trim, and shapes", () => {
    const { hero, failures } = replay(corpusFixture("v3-launch"));
    expect(failures).toEqual([]);
    expect(hero.timelineOffset).toBe(6);
    expect(hero.fills).toHaveLength(2);
    expect(hero.fills[0].color.staticValue).toEqual({ r: 120, g: 52, b: 198 });
    expect(hero.fills[1].type).toBe("GRADIENT_LINEAR");
    expect(hero.strokes).toHaveLength(1);
    expect(hero.strokes[0].width.staticValue).toBe(8);
    expect(hero.masks).toHaveLength(1);
    expect(hero.masks[0].opacity.staticValue).toBe(80);
    expect(hero.masks[0].pathData.staticValue.points).toHaveLength(4);
    expect(hero.trimPaths).toHaveLength(1);
    expect(hero.trimPaths[0].end.staticValue).toBe(62);
    // add-shape then remove-shape then reorder: the new ellipse leads.
    expect(hero.shapes.map((shape: Any) => shape.type)).toEqual(["ELLIPSE", "RECTANGLE"]);
    expect(hero.shapes[1].size.staticValue).toEqual({ width: 200, height: 120 });
    expect(hero.opacity.keyframes.map((kf: Any) => kf.frame)).toEqual([0, 24]);
  });

  it("kf-tangents keyframes the position and reports the handles Creator drops", () => {
    const { hero, failures, notes } = replay(corpusFixture("kf-tangents"));
    expect(failures).toEqual([]);
    // f24 moved to f30.
    expect(hero.position.keyframes.map((kf: Any) => kf.frame)).toEqual([0, 30]);
    expect(hero.scale.staticValue).toEqual({ x: 118, y: 118 });
    expect(notes.join(" | ")).toContain("motion-path handle");
  });

  it("params-disabled skips the disabled step", () => {
    const { hero, begin, failures } = replay(corpusFixture("params-disabled"));
    expect(failures).toEqual([]);
    expect(begin.total).toBe(2);
    expect(hero.position.staticValue).toEqual({ x: 660, y: 560 });
    expect(hero.opacity.staticValue).toBe(30);
    // The rotation step is off, so the target keeps the 10 it started at.
    expect(hero.rotation.staticValue).toBe(10);
  });

  it("play-options reorders by position and says it could not verify", () => {
    const { scene, hero, orbit, failures, notes } = replay(corpusFixture("play-options"));
    expect(failures).toEqual([]);
    // A scene rebuild writes the recorded values verbatim.
    expect(hero.position.staticValue).toEqual({ x: 300, y: 420 });
    expect(orbit.opacity.staticValue).toBe(40);
    expect(scene.layers.map((layer: Any) => layer.name)).toEqual([
      "Caption",
      "Hero Square",
      "Orbit Dot",
    ]);
    expect(notes.join(" | ")).toContain("didn't capture layer identities");
  });

  it("reorder-verified permutes the named layers, adds one and removes one", () => {
    const { scene, failures, notes } = replay(corpusFixture("reorder-verified"));
    expect(failures).toEqual([]);
    expect(scene.layers.map((layer: Any) => layer.name)).toEqual([
      "Caption",
      "Hero Square",
      "Badge",
    ]);
    // The verified route says nothing about unidentified layers.
    expect(notes.join(" | ")).not.toContain("didn't capture layer identities");
  });

  it("scene-settings renames the scene, nests two layers and breaks them out", () => {
    const { scene, failures, notes } = replay(corpusFixture("scene-settings"));
    expect(failures).toEqual([]);
    expect(scene.name).toBe("Corpus Scene");
    // The fake scene carries no framerate, which is a noted skip, not a
    // failure — a host that will not give a setting up is a normal outcome.
    expect(notes.join(" | ")).toContain("this scene has no framerate to set");
    expect(scene.layers.some((layer: Any) => layer.type === "SCENE_LAYER")).toBe(false);
    expect(scene.layers.map((layer: Any) => layer.name)).toEqual([
      "Hero Square",
      "Orbit Dot",
      "Caption",
    ]);
  });

  it("formula-strings replays the first cut's strings as set, multiply and add", () => {
    const { hero, failures } = replay(corpusFixture("formula-strings"));
    expect(failures).toEqual([]);
    // "exact" writes the recorded end value whatever the target held —
    // the additive default would have put the target at 540 + 540.
    expect(hero.position.staticValue).toEqual({ x: 640, y: 480 });
    // "multiply" from 5 → 15 is ×3, on the target's own 10 (a delta of +10
    // is what the default would have given).
    expect(hero.rotation.staticValue).toBe(30);
    // "add" from 120 → 150 is +30, on the target's own 100 (the default on
    // scale is a ratio, which would have given 125).
    expect(hero.scale.staticValue).toEqual({ x: 130, y: 130 });
    expect(hero.opacity.keyframes.map((kf: Any) => kf.frame)).toEqual([0, 20]);
  });

  it("formula-terms replays one term per component and one scalar term", () => {
    const { hero, failures } = replay(corpusFixture("formula-terms"));
    expect(failures).toEqual([]);
    // x doubles the target's own 540; y takes the recorded −60 off its 560.
    expect(hero.position.staticValue).toEqual({ x: 1080, y: 500 });
    // A scalar term over a scalar property: the target's own 10, doubled.
    expect(hero.rotation.staticValue).toBe(20);
  });

  it("current places the target exactly and keeps the relative steps relative", () => {
    const { hero, failures } = replay(corpusFixture("current"));
    expect(failures).toEqual([]);
    // The exact-values formula ignores where the target started.
    expect(hero.position.staticValue).toEqual({ x: 640, y: 480 });
    // The rotation step carries no formula, so it stays a delta: 10 + (−6).
    expect(hero.rotation.staticValue).toBe(4);
    expect(hero.opacity.staticValue).toBe(55);
    expect(hero.locked).toBe(true);
    expect(hero.fills).toHaveLength(3);
    expect(hero.scale.keyframes.map((kf: Any) => kf.frame)).toEqual([0, 18]);
  });
});
