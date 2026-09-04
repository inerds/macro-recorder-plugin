import type { Json } from "../../engine/json";
import type { Macro, MacroStep } from "../../engine/macro";
import type { AnimatableSnapshot, NodeSnapshot } from "../../engine/snapshot";
import { buildStep, type LayerRef, type StepPayload } from "../../engine/steps";
import { newId } from "../utils/id";

/**
 * Demo macros for dev sessions. Built from REAL StepPayloads through the same
 * `buildStep` a recording uses, so they replay, simplify, edit and pin exactly
 * like captured macros do. Keep them on `buildStep`: hand-written labels with
 * empty payloads only look right until someone presses Play.
 *
 * The set is deliberately a feature MATRIX, not three pretty rows — between
 * them the ten macros exercise both playback modes, every scene op, the
 * cross-kind paint adaptations, masks, trims, text layers, capture-shaped
 * (before === after) steps, disabled steps, pinned parameters and play
 * options. `demoMacros.test.ts` replays every one of them against the shared
 * fake scene, so a demo macro that stops applying is a failing test rather
 * than a surprise in the panel.
 */

// ---------------------------------------------------------------------------
// The demo scene: three layers every macro is written against.
// ---------------------------------------------------------------------------

const HERO: LayerRef = { id: "demo-hero", name: "Hero Square" };
const ORBIT: LayerRef = { id: "demo-orbit", name: "Orbit Dot" };
/** Recorded after a rename, so replay resolves it through `priorName`. */
const CAPTION: LayerRef = { id: "demo-caption", name: "Old Caption", priorName: "Caption" };

/** Exported so tests can build a scene these macros actually resolve against. */
export const DEMO_LAYERS = { hero: HERO, orbit: ORBIT, caption: CAPTION } as const;

// Distinct enough to tell apart at a glance in the review rows.
const INK = { r: 26, g: 26, b: 32 };
const EMBER = { r: 236, g: 79, b: 53 };
const AMBER = { r: 255, g: 186, b: 73 };
const VIOLET = { r: 120, g: 52, b: 198 };
const CREAM = { r: 250, g: 246, b: 238 };
const TEAL = { r: 32, g: 148, b: 150 };
const SUN = { r: 255, g: 210, b: 92 };

const HERO_REST = { x: 540, y: 560 };

/** A non-animated AnimatableSnapshot — what a serialized static prop looks like. */
function stat(value: Json): AnimatableSnapshot {
  return { animated: false, static: value };
}

function stop(offset: number, color: Json): Json {
  return { color, offset, opacity: 1 };
}

/** A NodeSnapshot with every list present, the way serialize.ts emits one. */
function spec(
  nodeId: string,
  nodeType: string,
  nodeName: string,
  extra: Partial<NodeSnapshot> = {},
): NodeSnapshot {
  return {
    nodeId,
    nodeType,
    nodeName,
    props: {},
    plain: {},
    fills: [],
    strokes: [],
    masks: [],
    shapes: [],
    ...extra,
  };
}

const WARM_STOPS = [stop(0, EMBER), stop(0.5, AMBER), stop(1, VIOLET)];
const COOL_STOPS = [stop(0, TEAL), stop(0.55, CREAM), stop(1, VIOLET)];

/** A four-point square path, in the structural shape serialize.ts reads. */
function squarePath(size: number): Json {
  const points = [
    { x: 0, y: 0 },
    { x: size, y: 0 },
    { x: size, y: size },
    { x: 0, y: size },
  ];
  return {
    closed: true,
    points: points.map((vertex) => ({
      vertex,
      inTan: { x: 0, y: 0 },
      outTan: { x: 0, y: 0 },
    })),
  };
}

// ---------------------------------------------------------------------------
// The scripts
// ---------------------------------------------------------------------------

interface DemoScript {
  name: string;
  steps: StepPayload[];
  /** Steps pinned as parameters, by index — resolved to real ids on build. */
  params?: { stepIndex: number; label: string }[];
  /** Steps that start switched off (playback skips them). */
  disabledIndices?: number[];
  playOptions?: Macro["playOptions"];
  /** The layer replay falls back to when nothing is selected. */
  source?: { nodeId: string; nodeName?: string };
}

const DEMO_SCRIPTS: DemoScript[] = [
  {
    // Targets mode: keyframe add / move / drop, then two relative statics.
    name: "Bounce & settle",
    source: { nodeId: HERO.id, nodeName: HERO.name },
    steps: [
      {
        op: "keyframes",
        path: ["position"],
        added: [
          { frame: 0, value: { x: 540, y: 80 } },
          { frame: 12, value: { x: 540, y: 620 } },
          { frame: 24, value: HERO_REST },
        ],
        removed: [],
        changed: [],
        layer: HERO,
      },
      {
        // the overshoot slides later — a move, re-paired by the differ
        op: "keyframes",
        path: ["position"],
        added: [],
        removed: [],
        changed: [
          {
            before: { frame: 12, value: { x: 540, y: 620 } },
            after: { frame: 18, value: { x: 540, y: 620 } },
          },
        ],
        layer: HERO,
      },
      {
        op: "keyframes",
        path: ["position"],
        added: [],
        removed: [{ frame: 24, value: HERO_REST }],
        changed: [],
        layer: HERO,
      },
      // length-1 transform paths: scale is multiplicative, rotation additive
      { op: "set-static", path: ["scale"], before: { x: 100, y: 100 }, after: { x: 118, y: 118 }, layer: HERO },
      { op: "set-static", path: ["rotation"], before: 0, after: -6, layer: HERO },
    ],
  },
  {
    // Targets mode: a whole-fill swap, then edits on top of what it created.
    name: "Brand recolor pro",
    source: { nodeId: HERO.id, nodeName: HERO.name },
    steps: [
      {
        op: "replace-paint",
        path: ["fills", 0],
        spec: {
          kind: "gradient",
          gradientType: "GRADIENT_LINEAR",
          start: stat({ x: 0, y: 0 }),
          end: stat({ x: 240, y: 240 }),
          stops: stat(WARM_STOPS),
        },
        layer: HERO,
      },
      { op: "set-static", path: ["fills", 0, "stops"], before: WARM_STOPS, after: COOL_STOPS, layer: HERO },
      {
        op: "add-stroke",
        path: ["strokes", 0],
        spec: { width: 4, fill: { kind: "solid", color: stat(INK) } },
        layer: HERO,
      },
      { op: "set-static", path: ["strokes", 0, "width"], before: 4, after: 8, layer: HERO },
      { op: "set-static", path: ["strokes", 0, "fill", "color"], before: INK, after: VIOLET, layer: HERO },
    ],
  },
  {
    // Targets mode: every recolor lands, whatever kind the target's paint is.
    name: "Cross-kind chaos",
    source: { nodeId: HERO.id, nodeName: HERO.name },
    steps: [
      // gradient stops onto a solid fill -> the fill CONVERTS to a gradient
      { op: "set-static", path: ["fills", 0, "stops"], before: WARM_STOPS, after: COOL_STOPS, layer: HERO },
      // ...and a solid color onto that gradient tints every stop
      { op: "set-static", path: ["fills", 0, "color"], before: CREAM, after: EMBER, layer: HERO },
      {
        op: "add-trim",
        path: ["trimPaths", 0],
        spec: { mode: "simultaneously", start: stat(0), end: stat(100), offset: stat(0) },
        layer: HERO,
      },
      { op: "set-static", path: ["trimPaths", 0, "end"], before: 100, after: 62, layer: HERO },
    ],
  },
  {
    // Targets mode: duplication is retargetable, so this stays a tool —
    // with a selection it clones the SELECTED layer, twice, chained.
    name: "Pop-in duplicates",
    source: { nodeId: HERO.id, nodeName: HERO.name },
    steps: [
      {
        op: "add-layer",
        cloneOf: HERO,
        offset: { x: 48, y: 48 },
        spec: spec("demo-copy-1", "CONTAINER", "Hero Square copy", {
          props: { position: stat({ x: 588, y: 608 }), opacity: stat(100) },
          shapes: [
            spec("demo-copy-1-rect", "RECTANGLE", "Rectangle 1", {
              props: { size: stat({ x: 160, y: 160 }), position: stat({ x: 0, y: 0 }) },
              fills: [{ kind: "solid", color: stat(EMBER) }],
            }),
          ],
        }),
      },
      {
        // bound to the recorded COPY: replay routes it to the clone it made
        op: "set-static",
        path: ["position"],
        before: { x: 588, y: 608 },
        after: { x: 708, y: 608 },
        layer: { id: "demo-copy-1", name: "Hero Square copy" },
      },
      {
        op: "add-layer",
        cloneOf: { id: "demo-copy-1", name: "Hero Square copy" },
        offset: { x: 48, y: 48 },
        spec: spec("demo-copy-2", "CONTAINER", "Hero Square copy 2", {
          props: { position: stat({ x: 756, y: 656 }), opacity: stat(100) },
        }),
      },
    ],
  },
  {
    // Scene script: several layers, a rename resolved by priorName, a
    // reorder and a removal.
    name: "Storyboard shuffle",
    source: { nodeId: HERO.id, nodeName: HERO.name },
    steps: [
      { op: "set-static", path: ["position"], before: HERO_REST, after: { x: 300, y: 420 }, layer: HERO },
      { op: "set-plain", path: ["name"], before: "Caption", after: "Old Caption", layer: CAPTION },
      // order[newPos] = the layer's previous index
      { op: "reorder-layers", order: [2, 0, 1] },
      { op: "set-static", path: ["opacity"], before: 100, after: 40, layer: ORBIT },
      { op: "remove-layer", layer: CAPTION },
    ],
  },
  {
    // Scene script: build a nest, move it, then break it apart again.
    name: "Nest & break",
    source: { nodeId: HERO.id, nodeName: HERO.name },
    steps: [
      {
        op: "nest-layers",
        layers: [HERO, ORBIT],
        spec: spec("demo-nest", "SCENE_LAYER", "Hero Group", {
          props: { position: stat({ x: 0, y: 0 }), opacity: stat(100) },
        }),
      },
      {
        op: "set-static",
        path: ["position"],
        before: { x: 0, y: 0 },
        after: { x: 120, y: 60 },
        layer: { id: "demo-nest", name: "Hero Group" },
      },
      {
        op: "break-scene",
        layer: { id: "demo-nest", name: "Hero Group" },
        fallback: [
          spec(HERO.id, "CONTAINER", HERO.name!, { props: { position: stat(HERO_REST) } }),
          spec(ORBIT.id, "CONTAINER", ORBIT.name!, { props: { position: stat({ x: 820, y: 300 }) } }),
        ],
      },
    ],
  },
  {
    // Scene script: a fresh layer of a type only createTextLayer can build.
    // fontSize/text/fontFamily are PLAIN on the host (RUNTIME-API "Text
    // layer"), so they ride the set-plain channel, not set-static.
    name: "Type reveal",
    source: { nodeId: "demo-title", nodeName: "Title" },
    steps: [
      {
        op: "add-layer",
        spec: spec("demo-title", "TEXT_LAYER", "Title", {
          props: { position: stat({ x: 120, y: 200 }), opacity: stat(100) },
          plain: { text: "Ship it.", fontFamily: "Inter", fontStyle: "Regular", fontSize: 64, alignment: "left" },
          fills: [{ kind: "solid", color: stat(CREAM) }],
        }),
      },
      {
        op: "set-plain",
        path: ["text"],
        before: "Ship it.",
        after: "Ship it, then polish.",
        layer: { id: "demo-title", name: "Title" },
      },
      {
        op: "set-plain",
        path: ["fontSize"],
        before: 64,
        after: 88,
        layer: { id: "demo-title", name: "Title" },
      },
      {
        // singular text fills are recorded as a one-item list and remapped
        op: "set-static",
        path: ["fills", 0, "color"],
        before: CREAM,
        after: SUN,
        layer: { id: "demo-title", name: "Title" },
      },
      {
        op: "keyframes",
        path: ["opacity"],
        added: [
          { frame: 0, value: 0 },
          { frame: 20, value: 100 },
        ],
        removed: [],
        changed: [],
        layer: { id: "demo-title", name: "Title" },
      },
    ],
  },
  {
    // Targets mode: mask structure, then a static and a keyframed edit on
    // it. The removal is switched OFF, so the mask survives a play.
    name: "Masked spotlight",
    source: { nodeId: HERO.id, nodeName: HERO.name },
    disabledIndices: [3],
    steps: [
      {
        op: "add-mask",
        path: ["masks", 0],
        spec: { mode: "add", pathData: stat(squarePath(220)), opacity: stat(100) },
        layer: HERO,
      },
      { op: "set-static", path: ["masks", 0, "opacity"], before: 100, after: 55, layer: HERO },
      {
        op: "keyframes",
        path: ["masks", 0, "opacity"],
        added: [
          { frame: 0, value: 55 },
          { frame: 30, value: 90 },
        ],
        removed: [],
        changed: [],
        layer: HERO,
      },
      { op: "remove-mask", path: ["masks", 0], layer: HERO },
    ],
  },
  {
    // Capture-shaped: what "Add all" synthesizes — a full-state stamp whose
    // statics and flags carry before === after, so nothing teleports and
    // the labels read "prop = value".
    name: "Style stamp",
    source: { nodeId: HERO.id, nodeName: HERO.name },
    steps: [
      {
        op: "replace-paint",
        path: ["fills", 0],
        spec: { kind: "solid", color: stat(EMBER), opacity: stat(100) },
        layer: HERO,
      },
      { op: "set-static", path: ["position"], before: HERO_REST, after: HERO_REST, layer: HERO },
      { op: "set-static", path: ["scale"], before: { x: 100, y: 100 }, after: { x: 100, y: 100 }, layer: HERO },
      { op: "set-plain", path: ["blendMode"], before: "normal", after: "normal", layer: HERO },
      {
        op: "keyframes",
        path: ["opacity"],
        added: [
          { frame: 0, value: 60 },
          { frame: 24, value: 100 },
        ],
        removed: [],
        changed: [],
        layer: HERO,
      },
    ],
  },
  {
    // Targets mode, with the v3.1 layer switched on: two pinned parameters,
    // one step switched off, stagger and repeat preset.
    name: "Parametric slide",
    source: { nodeId: HERO.id, nodeName: HERO.name },
    params: [
      { stepIndex: 0, label: "Slide offset" },
      { stepIndex: 1, label: "Fade to" },
    ],
    disabledIndices: [2],
    playOptions: { staggerFrames: 5, repeat: 2 },
    steps: [
      { op: "set-static", path: ["position"], before: HERO_REST, after: { x: 660, y: 560 }, layer: HERO },
      { op: "set-static", path: ["opacity"], before: 100, after: 30, layer: HERO },
      { op: "set-static", path: ["rotation"], before: 0, after: 15, layer: HERO },
    ],
  },
];

/** Fresh ids on every call so repeated loads never collide in the store. */
export function buildDemoMacros(now = Date.now()): Macro[] {
  return DEMO_SCRIPTS.map((script, index) => {
    const disabled = new Set(script.disabledIndices ?? []);
    const steps: MacroStep[] = script.steps.map((payload, at) => {
      const step = buildStep(payload);
      if (disabled.has(at)) step.disabled = true;
      return step;
    });
    const macro: Macro = {
      id: newId(),
      name: script.name,
      // Staggered so the list's newest-first order is stable.
      createdAt: now - (DEMO_SCRIPTS.length - index) * 60_000,
      steps,
      ...(script.source ? { source: { ...script.source } } : {}),
    };
    // Params reference REAL built step ids — the same contract import and
    // duplicate have to honour.
    const params = (script.params ?? [])
      .map(({ stepIndex, label }) => ({ stepId: steps[stepIndex]?.id, label }))
      .filter((param): param is { stepId: string; label: string } => param.stepId !== undefined);
    if (params.length > 0) macro.params = params;
    if (script.playOptions) macro.playOptions = { ...script.playOptions };
    return macro;
  });
}
