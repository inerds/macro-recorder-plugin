/**
 * Fake Creator scene, shared by dev/harness/host-harness.html and vitest.
 *
 * This is the only test double for the live-proxy surface that
 * sandbox/serialize.ts and sandbox/applier.ts talk to. It is deliberately
 * STRICTER than a convenient mock: a friendlier fake hides the exact class of
 * bug this harness exists to catch. The model is
 * `@lottiefiles/creator-api-types` 1.0.1, corrected by `docs/runtime-api.md`
 * and `docs/limitations.md`, which win where the two disagree.
 *
 * What it deliberately REFUSES:
 *
 * - `addFill` / `addStroke` / `addMask` / `removeFill` / `removeStroke` /
 *   `removeMask` on a container. Those were a 0.0.2 typings promise, absent at
 *   runtime and gone from 1.0.1. Create through `createFill` / `createStroke`
 *   / `createMask`; remove through the ENTRY's own `remove()`.
 * - ShapeContainerMixin members (`shapes`, `fills`, `strokes`, `trimPaths`,
 *   `create*`) anywhere but a shape layer or a GROUP. Live geometry nodes
 *   (RECTANGLE / ELLIPSE / POLYGON / STAR / PATH) carry none of them.
 * - `masks` / `createMask` on a shape — masks are LayerMixin only.
 * - layer flags (`visible`, `locked`, `startFrame`, …) on a GROUP. 1.0.1 gives
 *   a group `opacity` and `blendMode`, and nothing else from LayerMixin.
 * - `createGroup(array)`. 1.0.1 takes `GroupOptions`, so a bare array leaves
 *   `opts.shapes` undefined and the group comes back EMPTY.
 * - `mode` on a trim path — 1.0.1 `TrimPath` is start / end / offset / remove.
 * - `opacity` on a paint — confirmed unreachable (`docs/limitations.md`).
 * - a keyframe `inTangent` / `outTangent` write. The live keyframe surface is
 *   exactly `easing, frame, id, remove, value`, so the write is discarded and
 *   the read stays undefined (`docs/limitations.md`).
 * - a `staticValue` write while keyframes exist (runtime-api quirk 4), and
 *   `addKeyframes` at frame 0 on a not-yet-animated property (quirk 2).
 * - the name `SCENE_INSTANCE`: 1.0.1 calls a scene layer `SCENE_LAYER`.
 * - invalid input, with the live host's `✗ Invalid input` message: blend
 *   modes, easings, colors, mask modes, text alignments, paint types, and any
 *   unknown key in a `create*` options object.
 *
 * It also models runtime-api quirk 5 for a PATH: `pathData` values are
 * getter-based host objects whose fields are invisible to `Object.keys`, so a
 * generic `toJson` sees `{}` and only a structural read recovers them.
 *
 * A SCENE_LAYER carries a real inner scene (`makeInnerScene`). That is NOT a
 * relaxation of the rule above: 1.0.1 types `SceneLayer.scene` as a `Scene`
 * with `layers`, `isNestableScene` and the three layer factories, and the live
 * shell a real `createSceneLayer()` returns already has `scene.layers` as an
 * array (trace 2026-09-07T01-13-19). The engine feature-detects every one of
 * those factories before it calls them, so a host that lacks them takes the
 * skip path, which the tests drive by deleting the member. What stays
 * host-faithful is the ROOT scene's `createSceneLayer()`: it creates an EMPTY
 * scene layer and never consumes the selection (quirk 8).
 *
 * Pure data only: no DOM, so it compiles under tsconfig.sandbox.json too.
 */
import type { Json } from "../json";
import { PLAIN_PROPS, propsForType } from "../snapshot";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** Deterministic ids — tests must not depend on Date.now/Math.random. */
export function makeIds(): (prefix: string) => string {
  let counter = 0;
  return (prefix: string) => `${prefix}-${++counter}`;
}

// ---------------------------------------------------------------------------
// Input validation — the live host's one error message
// ---------------------------------------------------------------------------

/**
 * The live host rejects a bad value with exactly this message (trace
 * 2026-08-26T08-15-55-277_playback-Style-stamp.json, rev .51, on a
 * wrongly-cased blend mode). Every validator below throws the same thing, so a
 * fixture that only ever "worked" in the fake fails here instead.
 */
function invalidInput(): never {
  throw new Error("✗ Invalid input");
}

function isPlainObject(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** `value` as a keyed bag, once isPlainObject has vouched for it. */
function fields(value: unknown): Record<string, Any> {
  return value as Record<string, Any>;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** A `create*` options object takes the keys 1.0.1 declares, and no others. */
function onlyKeys(opts: Record<string, Any>, allowed: readonly string[]): void {
  for (const key of Object.keys(opts)) {
    if (!allowed.includes(key)) invalidInput();
  }
}

/**
 * The real host's BlendMode is a LOWERCASE string union (the `BlendMode` type
 * in creator-api-types 1.0.1). Assigning anything outside this set —
 * including the differently-cased "NORMAL" — throws "✗ Invalid input" on a
 * live host. Validating it here is what lets a demo-macro / test-fixture
 * casing bug get caught instead of silently "working" only in the fake.
 */
const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
];

const MASK_MODES = ["add", "subtract"];
const TEXT_ALIGNMENTS = ["left", "center", "right"];
const PAINT_TYPES = ["SOLID", "GRADIENT_LINEAR", "GRADIENT_RADIAL"];

/** 1.0.1 `Color`: r/g/b numbers in [0, 255]. No alpha, no extra keys. */
function validateColor(value: Json): void {
  if (!isPlainObject(value)) invalidInput();
  const color = fields(value);
  if (Object.keys(color).length !== 3) invalidInput();
  for (const channel of ["r", "g", "b"]) {
    const channelValue = color[channel];
    if (!isFiniteNumber(channelValue) || channelValue < 0 || channelValue > 255) invalidInput();
  }
}

/** 1.0.1 `Easing`: `{type:'LINEAR'}` or `{type:'CUBIC_BEZIER',x1,y1,x2,y2}`. */
function validateEasing(value: unknown): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) invalidInput();
  const easing = fields(value);
  if (easing.type === "LINEAR") {
    onlyKeys(easing, ["type"]);
    return;
  }
  if (easing.type === "CUBIC_BEZIER") {
    onlyKeys(easing, ["type", "x1", "y1", "x2", "y2"]);
    for (const key of ["x1", "y1", "x2", "y2"]) {
      if (!isFiniteNumber(easing[key])) invalidInput();
    }
    return;
  }
  invalidInput();
}

/** 1.0.1 `PaintOptions`. `solidOnly` is the text-layer restriction. */
function validatePaintOptions(opts: unknown, solidOnly = false): Record<string, Any> {
  if (!isPlainObject(opts)) invalidInput();
  const paint = fields(opts);
  const type = paint.type;
  if (typeof type !== "string" || !PAINT_TYPES.includes(type)) invalidInput();
  if (type === "SOLID") {
    onlyKeys(paint, ["type", "color"]);
    validateColor(paint.color as Json);
    return paint;
  }
  // Text fills and strokes are solid only (1.0.1 TextLayer.createFill).
  if (solidOnly) invalidInput();
  onlyKeys(
    paint,
    type === "GRADIENT_RADIAL"
      ? ["type", "stops", "start", "end", "highlightAngle", "highlightLength"]
      : ["type", "stops", "start", "end"],
  );
  if (!Array.isArray(paint.stops)) invalidInput();
  return paint;
}

/** 1.0.1 `StrokeOptions` / `TextStrokeOptions`. */
function validateStrokeOptions(opts: unknown, solidOnly = false): Record<string, Any> {
  if (!isPlainObject(opts)) invalidInput();
  const stroke = fields(opts);
  onlyKeys(stroke, ["fill", "width"]);
  if (!isFiniteNumber(stroke.width)) invalidInput();
  validatePaintOptions(stroke.fill, solidOnly);
  return stroke;
}

// ---------------------------------------------------------------------------
// Animatables and keyframes
// ---------------------------------------------------------------------------

interface KfEntry {
  id: string;
  frame: number;
  value: Json;
  easing?: Json;
}

export interface FakeAnimatable {
  readonly isAnimated: boolean;
  staticValue: Json;
  readonly keyframes: Any[];
  addKeyframes(list: { frame: number; value: Json; easing?: Json }[]): void;
  getKeyframeAt(frame: number): Any | undefined;
  getValueAt(frame?: number): Json;
  /** Test control: make addKeyframes throw, as a real host does on bad input. */
  __failAdd(message: string | null): void;
  /** Test control: make writes to an existing keyframe's value throw. */
  __failWrite(message: string | null): void;
  /** Test control: make keyframe.remove() throw. */
  __failRemove(message: string | null): void;
  /**
   * Test control: emulate the host returning a truthy-but-inert occupant from
   * getKeyframeAt on a property that has no keyframes (observed at frame 0 in
   * a real trace — writes to it change nothing).
   */
  __phantomGetAt(enabled: boolean): void;
}

export interface FakeAnimatableOptions {
  /** Rejects a bad value the way the live host does. */
  validate?: (value: Json) => void;
  /** Wraps a stored value on the way OUT, to model a getter-based host object. */
  wrap?: (value: Json) => Json;
}

const EPSILON = 1e-6;

/**
 * A linear read between two keyframes. The host interpolates with the
 * keyframe's easing; this fake ignores easing on purpose, so a test that
 * depends on the exact shape of a curve has to pin an exact frame.
 */
function interpolate(from: Json, to: Json, t: number): Json {
  if (typeof from === "number" && typeof to === "number") return from + (to - from) * t;
  if (isPlainObject(from) && isPlainObject(to)) {
    const out: Record<string, Json> = {};
    for (const key of Object.keys(fields(from))) {
      const a = fields(from)[key];
      const b = fields(to)[key];
      out[key] = typeof a === "number" && typeof b === "number" ? a + (b - a) * t : a;
    }
    return out;
  }
  return from;
}

export function makeAnimatable(
  initial: Json,
  nextId: (prefix: string) => string,
  options: FakeAnimatableOptions = {},
): FakeAnimatable {
  const { validate, wrap } = options;
  let staticValue = clone(initial);
  let entries: KfEntry[] = [];
  // Sticky, like the real host: real traces show isAnimated staying true
  // after every keyframe is removed — it is a flag, not keyframes.length.
  let animatedFlag = false;
  let phantomGetAt = false;
  let addFailure: string | null = null;
  let writeFailure: string | null = null;
  let removeFailure: string | null = null;

  const out = (value: Json): Json => (wrap ? wrap(clone(value)) : clone(value));

  function handle(entry: KfEntry) {
    return {
      get id() {
        return entry.id;
      },
      get frame() {
        return entry.frame;
      },
      set frame(value: number) {
        entry.frame = value;
      },
      get value() {
        return out(entry.value);
      },
      set value(next: Json) {
        if (writeFailure !== null) throw new Error(writeFailure);
        validate?.(next);
        entry.value = clone(next);
      },
      get easing() {
        return clone(entry.easing);
      },
      set easing(next: Json | undefined) {
        validateEasing(next);
        entry.easing = clone(next);
      },
      /**
       * Spatial tangents are NOT on the live keyframe surface
       * (docs/limitations.md, verified 2026-08-22): the write is swallowed and
       * the read stays undefined, which is what makes the applier's refusal
       * path (`writeTangents`) testable.
       */
      get inTangent(): Json | undefined {
        return undefined;
      },
      set inTangent(_next: Json | undefined) {
        /* discarded */
      },
      get outTangent(): Json | undefined {
        return undefined;
      },
      set outTangent(_next: Json | undefined) {
        /* discarded */
      },
      remove() {
        if (removeFailure !== null) throw new Error(removeFailure);
        entries = entries.filter((candidate) => candidate !== entry);
      },
    };
  }

  return {
    get isAnimated() {
      return animatedFlag;
    },
    get staticValue() {
      return out(staticValue);
    },
    /**
     * Matches the real contract: "Setting staticValue when keyframes exist
     * will not affect the animation." Silently ignored, no throw.
     */
    set staticValue(value: Json) {
      if (entries.length > 0) return;
      validate?.(value);
      staticValue = clone(value);
    },
    get keyframes() {
      return entries.map(handle);
    },
    addKeyframes(list) {
      if (addFailure !== null) throw new Error(addFailure);
      for (const kf of list) {
        validate?.(kf.value);
        validateEasing(kf.easing);
      }
      for (const kf of list) {
        // Real-host quirk (observed in traces 2026-08-21): a keyframe at
        // frame 0 added to a not-yet-animated property is silently ignored.
        // Once animated, frame 0 inserts normally. Modelling it here is what
        // lets tests catch the class of bug it causes.
        if (!animatedFlag && kf.frame === 0) continue;
        entries.push({
          id: nextId("kf"),
          frame: kf.frame,
          value: clone(kf.value),
          easing: clone(kf.easing),
          // Like the real host's addKeyframes (typed KeyframeAdd = frame +
          // value + easing): tangents are not part of the entry at all.
        });
        animatedFlag = true;
      }
      entries.sort((a, b) => a.frame - b.frame);
    },
    getKeyframeAt(frame) {
      const entry = entries.find((candidate) => Math.abs(candidate.frame - frame) < EPSILON);
      if (entry) return handle(entry);
      if (phantomGetAt && entries.length === 0) {
        // Inert phantom: looks like a keyframe, absorbs writes, changes nothing.
        return {
          id: "phantom",
          frame,
          get value() {
            return out(staticValue);
          },
          set value(_next: Json) {
            /* discarded */
          },
          easing: undefined,
          remove() {
            /* discarded */
          },
        };
      }
      return undefined;
    },
    /**
     * 1.0.1 `Animatable.getValueAt(frame?)`, live-verified
     * (docs/runtime-api.md). A property with no keyframes reads its static
     * value; otherwise the value is read off the timeline.
     */
    getValueAt(frame?: number) {
      if (entries.length === 0) return out(staticValue);
      const at = isFiniteNumber(frame) ? frame : 0;
      const exact = entries.find((entry) => Math.abs(entry.frame - at) < EPSILON);
      if (exact) return out(exact.value);
      const first = entries[0]!;
      const last = entries[entries.length - 1]!;
      if (at <= first.frame) return out(first.value);
      if (at >= last.frame) return out(last.value);
      let before = first;
      let after = last;
      for (const entry of entries) {
        if (entry.frame <= at) before = entry;
        else {
          after = entry;
          break;
        }
      }
      const span = after.frame - before.frame;
      const t = span === 0 ? 0 : (at - before.frame) / span;
      return out(interpolate(clone(before.value), clone(after.value), t));
    },
    __failAdd(message) {
      addFailure = message;
    },
    __failWrite(message) {
      writeFailure = message;
    },
    __failRemove(message) {
      removeFailure = message;
    },
    __phantomGetAt(enabled) {
      phantomGetAt = enabled;
    },
  };
}

// ---------------------------------------------------------------------------
// Getter-based path data (docs/runtime-api.md quirk 5)
// ---------------------------------------------------------------------------

/** An object whose named fields are non-enumerable accessors, like the host's. */
function hiddenFields(source: Record<string, Any>, keys: readonly string[]): Any {
  const out: Any = {};
  for (const key of keys) {
    Object.defineProperty(out, key, {
      enumerable: false,
      configurable: true,
      get: () => source[key],
    });
  }
  return out;
}

/**
 * PathData and its points are getter-based on the host: their fields are
 * invisible to `Object.keys`, so the generic `toJson` reads `{}` and only the
 * structural reader in `sandbox/serialize.ts` recovers them. Wrapping the
 * value here is what keeps that fix from regressing unnoticed.
 */
export function wrapPathData(value: Json): Json {
  if (!isPlainObject(value)) return value;
  const path = fields(value);
  const points = Array.isArray(path.points)
    ? path.points.map((point: Any) =>
        isPlainObject(point) ? hiddenFields(point, ["vertex", "inTan", "outTan"]) : point,
      )
    : path.points;
  return hiddenFields({ points, closed: path.closed }, ["points", "closed"]) as Json;
}

// ---------------------------------------------------------------------------
// Paints, strokes, masks, trim paths
// ---------------------------------------------------------------------------

/**
 * 1.0.1 `SolidPaint` is exactly `{type, color, remove}` — there is no
 * `opacity` on any paint (docs/limitations.md, "Fill / stroke opacity").
 */
export function makeSolidFill(color: Json, nextId: (prefix: string) => string) {
  return {
    type: "SOLID",
    color: makeAnimatable(color, nextId, { validate: validateColor }),
  };
}

/** Gradient paint: `stops` is an Animatable whose staticValue is the array. */
export function makeGradientFill(
  stops: Json[],
  nextId: (prefix: string) => string,
  type: string = "GRADIENT_LINEAR",
) {
  return {
    type,
    stops: makeAnimatable(stops, nextId),
  };
}

function makePaint(opts: Record<string, Any>, nextId: (prefix: string) => string): Any {
  return opts.type === "SOLID"
    ? makeSolidFill(opts.color as Json, nextId)
    : makeGradientFill(opts.stops as Json[], nextId, String(opts.type));
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export interface FakeNodeOptions {
  type?: string;
  /** Initial values for any animatable prop of the node's type. */
  props?: Record<string, Json>;
  fills?: Json[];
}

const DEFAULTS: Record<string, Json> = {
  position: { x: 0, y: 0 },
  scale: { x: 100, y: 100 },
  rotation: 0,
  skew: 0,
  skewAxis: 0,
  opacity: 100,
  // 1.0.1 `Size` is {width, height} — NOT a Vector.
  size: { width: 100, height: 100 },
  roundness: 0,
  innerRadius: 0,
  outerRadius: 50,
  innerRoundness: 0,
  outerRoundness: 0,
  points: 5,
  pathData: { points: [], closed: true },
};

/** 1.0.1 LayerMixin's plain flags. Layers only — a GROUP carries none. */
const PLAIN_DEFAULTS: Record<string, Json> = {
  visible: true,
  locked: false,
  blendMode: "normal",
  startFrame: 0,
  endFrame: 150,
  timelineOffset: 0,
  isMatte: false,
};

/**
 * Text layers carry these as PLAIN writable properties, never animatables
 * (RUNTIME-API "Text layer": `text`/`fontFamily`/`fontStyle`/`alignment`
 * strings, `fontSize` a plain number) — which is why the serializer records
 * them through the plain channel. Note `fontSize` is also listed in
 * TYPE_PROPS.TEXT_LAYER; it stays plain here because DEFAULTS has no entry
 * for it, so no animatable is ever defined under the same name.
 */
const TEXT_PLAIN_DEFAULTS: Record<string, Json> = {
  text: "Text",
  fontFamily: "Inter",
  fontStyle: "Regular",
  fontSize: 32,
  alignment: "left",
};

/** 1.0.1 `Layer` = ShapeLayer | SceneLayer | TextLayer | ImageLayer. */
const LAYER_TYPES = ["SHAPE_LAYER", "CONTAINER", "SCENE_LAYER", "TEXT_LAYER", "IMAGE_LAYER"];

/** The only two carriers of ShapeContainerMixin in 1.0.1. */
const SHAPE_CONTAINER_TYPES = ["SHAPE_LAYER", "CONTAINER", "GROUP"];

const SHAPE_FACTORY_TYPES = ["RECTANGLE", "ELLIPSE", "POLYGON", "STAR", "PATH"];

/**
 * Animatable names for a node type, straight from the snapshot registry —
 * which names SCENE_LAYER and IMAGE_LAYER (LayerMixin plus TransformMixin,
 * the same set a shape layer has), so nothing is special-cased here.
 */
function animatableProps(nodeType: string): readonly string[] {
  return propsForType(nodeType);
}

/**
 * A fake node mirroring the 1.0.1 surface: per-type animatable props, plain
 * layer flags on layers only, ShapeContainerMixin on shape layers and groups
 * only, masks on layers only — plus the modelled host quirks.
 */
export function makeNode(
  name: string,
  options: FakeNodeOptions = {},
  nextId: (prefix: string) => string = makeIds(),
) {
  const nodeType = options.type ?? "CONTAINER";
  const isLayer = LAYER_TYPES.includes(nodeType);
  const isShapeContainer = SHAPE_CONTAINER_TYPES.includes(nodeType);
  const isTextLayer = nodeType === "TEXT_LAYER";
  let gone = false;
  const failingProps = new Set<string>();

  const node: Any = {
    get id() {
      if (gone) throw new Error("node has been deleted");
      return nodeId;
    },
    name,
    type: nodeType,
    parent: undefined as Any,
    remove() {
      const list = node.parent?.shapes;
      if (Array.isArray(list)) {
        const at = list.indexOf(node);
        if (at >= 0) list.splice(at, 1);
      }
      gone = true;
    },
    /**
     * SCENE_LAYER only: seats `contents` inside the layer's own scene, which
     * is where `break()` (installed below) reads them from.
     */
    __setSceneContents(contents: Any[]) {
      const inner = (node as Any).scene;
      if (inner && Array.isArray(inner.layers)) {
        // copy first: `contents` may BE `inner.layers`
        const next = [...contents];
        inner.layers.length = 0;
        inner.layers.push(...next);
        return;
      }
      (node as Any).scene = { layers: [...contents] };
    },
    /** Deep copy inserted after self in the owner list, like the host. */
    clone() {
      const copyProps: Record<string, Json> = {};
      for (const propName of animatableProps(nodeType)) {
        const prop = node[propName as string];
        if (prop && typeof prop === "object" && "staticValue" in prop) {
          copyProps[propName as string] = (prop as Any).staticValue;
        }
      }
      const copy = makeNode(`${name} copy`, { type: nodeType, props: copyProps }, nextId);
      if (Array.isArray(node.fills)) {
        for (const fill of node.fills) {
          copy.createFill({
            type: "SOLID",
            color: fill.color?.staticValue ?? { r: 0, g: 0, b: 0 },
          });
        }
      }
      if (Array.isArray(node.shapes)) {
        for (const child of node.shapes) {
          const childCopy = child.clone();
          // clone() inserted it next to the child inside THIS node; move it
          const at = node.shapes.indexOf(childCopy);
          if (at >= 0) node.shapes.splice(at, 1);
          childCopy.parent = copy;
          copy.shapes.push(childCopy);
        }
      }
      const list = node.parent?.shapes ?? node.parent?.layers;
      if (Array.isArray(list)) {
        const at = list.indexOf(node);
        list.splice(at >= 0 ? at + 1 : list.length, 0, copy);
        copy.parent = node.parent;
      }
      return copy;
    },
    // Untyped runtime reorder methods (discovered via introspection). The
    // host's exact placement semantics are unverified — this models the
    // straightforward reading: insert immediately before/after the sibling.
    moveBefore(other: Any) {
      const list = node.parent?.shapes;
      if (!Array.isArray(list)) throw new Error("no parent to move within");
      const from = list.indexOf(node);
      if (from >= 0) list.splice(from, 1);
      const at = list.indexOf(other);
      if (at < 0) throw new Error("sibling not found");
      list.splice(at, 0, node);
    },
    moveAfter(other: Any) {
      const list = node.parent?.shapes;
      if (!Array.isArray(list)) throw new Error("no parent to move within");
      const from = list.indexOf(node);
      if (from >= 0) list.splice(from, 1);
      const at = list.indexOf(other);
      if (at < 0) throw new Error("sibling not found");
      list.splice(at + 1, 0, node);
    },
    /** Test controls — not part of the real API surface. */
    __control: {
      setGone(value: boolean) {
        gone = value;
      },
      failProp(propName: string) {
        failingProps.add(propName);
      },
    },
  };
  const nodeId = nextId("node");

  // --- SceneLayer: a source scene plus break() -----------------------------
  // 1.0.1 `SceneLayer` is `{ type, scene, break }` on top of LayerMixin. The
  // scene is where the layer's content lives; `break()` spills that content
  // into the parent list and removes the layer, which is what the host's own
  // break does.
  if (nodeType === "SCENE_LAYER") {
    node.scene = makeInnerScene(name, nextId);
    node.break = () => {
      const list = node.parent?.shapes ?? node.parent?.layers;
      if (!Array.isArray(list)) throw new Error("no parent to break into");
      const contents: Any[] = Array.isArray(node.scene?.layers) ? [...node.scene.layers] : [];
      const at = list.indexOf(node);
      for (const content of contents) content.parent = node.parent;
      list.splice(at >= 0 ? at : list.length, 1, ...contents);
    };
  }

  // --- ShapeContainerMixin: shape layers and groups only -------------------
  if (isShapeContainer) {
    node.shapes = [] as Any[];
    node.fills = [] as Any[];
    node.strokes = [] as Any[];
    node.trimPaths = [] as Any[];

    node.createFill = (opts: Any) => {
      const paint: Any = makePaint(validatePaintOptions(opts), nextId);
      // real host: removal lives on the paint object, not the container
      paint.remove = () => {
        const at = node.fills.indexOf(paint);
        if (at >= 0) node.fills.splice(at, 1);
      };
      node.fills.push(paint);
      return paint;
    };

    node.createStroke = (opts: Any) => {
      const checked = validateStrokeOptions(opts);
      const stroke: Any = {
        width: makeAnimatable(checked.width as Json, nextId),
        fill: makePaint(checked.fill as Record<string, Any>, nextId),
      };
      stroke.remove = () => {
        const at = node.strokes.indexOf(stroke);
        if (at >= 0) node.strokes.splice(at, 1);
      };
      node.strokes.push(stroke);
      return stroke;
    };

    /** 1.0.1 `TrimPath` is start/end/offset/remove — there is no `mode`. */
    node.createTrimPath = (opts: Any = {}) => {
      if (!isPlainObject(opts)) invalidInput();
      onlyKeys(opts, ["start", "end", "offset"]);
      for (const key of ["start", "end", "offset"]) {
        if (opts[key] !== undefined && !isFiniteNumber(opts[key])) invalidInput();
      }
      const trim: Any = {
        start: makeAnimatable((opts.start ?? 0) as Json, nextId),
        end: makeAnimatable((opts.end ?? 100) as Json, nextId),
        offset: makeAnimatable((opts.offset ?? 0) as Json, nextId),
        remove() {
          const at = node.trimPaths.indexOf(trim);
          if (at >= 0) node.trimPaths.splice(at, 1);
        },
      };
      node.trimPaths.push(trim);
      return trim;
    };

    /**
     * 1.0.1 takes `GroupOptions` — `createGroup({ shapes })`. A bare array is
     * not a GroupOptions, so `opts.shapes` is undefined and the group is
     * created EMPTY, exactly as the host would leave it.
     */
    node.createGroup = (opts?: Any) => {
      const group = makeNode(`group ${node.shapes.length + 1}`, { type: "GROUP" }, nextId);
      group.parent = node;
      const children: Any[] =
        isPlainObject(opts) && Array.isArray(fields(opts).shapes) ? [...fields(opts).shapes] : [];
      for (const child of children) {
        const at = node.shapes.indexOf(child);
        if (at >= 0) node.shapes.splice(at, 1);
        child.parent = group;
        group.shapes.push(child);
      }
      node.shapes.push(group);
      return group;
    };

    const factory =
      (type: string) =>
      (opts: FakeNodeOptions["props"] = {}) => {
        const child = makeNode(
          `${type.toLowerCase()} ${node.shapes.length + 1}`,
          { type, props: opts },
          nextId,
        );
        child.parent = node;
        node.shapes.push(child);
        return child;
      };
    for (const shapeType of SHAPE_FACTORY_TYPES) {
      node[`create${shapeType.charAt(0)}${shapeType.slice(1).toLowerCase()}`] = factory(shapeType);
    }
  }

  // --- TextLayer: SINGULAR fill and stroke, solid only ---------------------
  if (isTextLayer) {
    let textFill: Any;
    let textStroke: Any;
    Object.defineProperty(node, "fill", {
      enumerable: true,
      configurable: true,
      get: () => textFill,
    });
    Object.defineProperty(node, "stroke", {
      enumerable: true,
      configurable: true,
      get: () => textStroke,
    });
    // "Calling this when a fill is already present updates the existing fill
    // instead of appending a second one" (1.0.1 TextLayer.createFill).
    node.createFill = (opts: Any) => {
      const checked = validatePaintOptions(opts, true);
      textFill = makeSolidFill(checked.color as Json, nextId);
      textFill.remove = () => {
        textFill = undefined;
      };
      return textFill;
    };
    node.createStroke = (opts: Any) => {
      const checked = validateStrokeOptions(opts, true);
      textStroke = {
        width: makeAnimatable(checked.width as Json, nextId),
        fill: makeSolidFill((checked.fill as Any).color as Json, nextId),
      };
      textStroke.remove = () => {
        textStroke = undefined;
      };
      return textStroke;
    };
  }

  // --- LayerMixin masks: layers only ---------------------------------------
  if (isLayer) {
    node.masks = [] as Any[];
    /**
     * Real host has no `addMask` — only `createMask` (docs/runtime-api.md,
     * live-verified). Modelling `addMask` here would hide an applier that only
     * checks for `addMask`.
     */
    node.createMask = (opts: Any = {}) => {
      if (!isPlainObject(opts)) invalidInput();
      onlyKeys(opts, ["mode", "pathData", "opacity"]);
      if (opts.mode !== undefined && !MASK_MODES.includes(opts.mode as string)) invalidInput();
      if (opts.opacity !== undefined && !isFiniteNumber(opts.opacity)) invalidInput();
      let mode = (opts.mode ?? "add") as string;
      const mask: Any = {
        pathData: makeAnimatable((opts.pathData ?? { points: [], closed: true }) as Json, nextId),
        opacity: makeAnimatable((opts.opacity ?? 100) as Json, nextId),
        remove() {
          const at = node.masks.indexOf(mask);
          if (at >= 0) node.masks.splice(at, 1);
        },
      };
      Object.defineProperty(mask, "mode", {
        enumerable: true,
        configurable: true,
        get: () => mode,
        set: (next: string) => {
          if (!MASK_MODES.includes(next)) invalidInput();
          mode = next;
        },
      });
      node.masks.push(mask);
      return mask;
    };
  }

  for (const color of options.fills ?? []) {
    if (typeof node.createFill !== "function") {
      throw new Error(`a ${nodeType} can't take fills`);
    }
    node.createFill({ type: "SOLID", color });
  }

  for (const propName of animatableProps(nodeType)) {
    const initial = options.props?.[propName] ?? DEFAULTS[propName];
    if (initial === undefined) continue;
    const animatable = makeAnimatable(
      initial,
      nextId,
      // runtime-api quirk 5: a PATH's pathData values are getter-based.
      nodeType === "PATH" && propName === "pathData" ? { wrap: wrapPathData } : {},
    );
    Object.defineProperty(node, propName, {
      enumerable: true,
      configurable: true,
      get() {
        if (gone) throw new Error("node has been deleted");
        if (failingProps.has(propName)) throw new Error(`${propName} is not readable`);
        return animatable;
      },
    });
  }

  // Plain flags. LayerMixin gives them to every LAYER type; 1.0.1 `Group` has
  // only blendMode (its opacity is the animatable above); geometry shapes have
  // neither.
  const flags: Record<string, Json> = isTextLayer
    ? { ...PLAIN_DEFAULTS, ...TEXT_PLAIN_DEFAULTS }
    : isLayer
      ? PLAIN_DEFAULTS
      : nodeType === "GROUP"
        ? { blendMode: PLAIN_DEFAULTS.blendMode! }
        : {};
  for (const [flag, initial] of Object.entries(flags)) {
    let value: Json = initial;
    Object.defineProperty(node, flag, {
      enumerable: true,
      configurable: true,
      get() {
        return value;
      },
      set(next: Json) {
        if (flag === "blendMode" && !BLEND_MODES.includes(next as string)) invalidInput();
        if (flag === "alignment" && !TEXT_ALIGNMENTS.includes(next as string)) invalidInput();
        value = next;
      },
    });
  }
  void PLAIN_PROPS; // keep registry import used; flags above mirror it

  return node;
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

/** 1.0.1 `LayerCreateOptions`, plus what each layer factory adds to it. */
const LAYER_CREATE_KEYS = ["name", "position", "opacity", "startFrame", "endFrame"];
const TEXT_LAYER_CREATE_KEYS = [
  ...LAYER_CREATE_KEYS,
  "text",
  "fontFamily",
  "fontStyle",
  "fontSize",
  "fill",
  "stroke",
  "alignment",
];
const SCENE_LAYER_CREATE_KEYS = [...LAYER_CREATE_KEYS, "scene"];

export interface FakeSceneOptions {
  /** 1.0.1 `Scene.isNestableScene` — false blocks use as a source scene. */
  nestable?: boolean;
  /** Called by `remove()` (BaseAssetMixin), so a test can watch cleanup. */
  onRemove?: () => void;
}

/**
 * A 1.0.1 `Scene`: a layer list, `isNestableScene`, the three layer factories
 * and `remove()`. It models BOTH ends of the nesting work — the active scene
 * the plugin runs against, and the source scene a SCENE_LAYER references.
 *
 * Scene SETTINGS (size / framerate / duration / backgroundColor) are
 * deliberately absent: the set-scene path must stay testable against a host
 * that does not carry a member, and a test that wants them adds them.
 */
export function makeInnerScene(
  name: string,
  nextId: (prefix: string) => string = makeIds(),
  options: FakeSceneOptions = {},
): Any {
  let removed = false;
  const scene: Any = {
    id: nextId("scene"),
    type: "SCENE",
    name,
    isNestableScene: options.nestable !== false,
    layers: [] as Any[],
    /** BaseAssetMixin.remove — "scenes that are not nestable cannot be removed". */
    remove() {
      if (scene.isNestableScene === false) throw new Error("✗ Invalid input");
      removed = true;
      scene.layers.length = 0;
      options.onRemove?.();
    },
    /** Test control — not part of the real API surface. */
    get __removed() {
      return removed;
    },
  };

  /** Seats a layer at the end of the list, with the parent link a node needs. */
  const seat = (layer: Any): Any => {
    layer.parent = { shapes: scene.layers, layers: scene.layers, type: "SCENE" };
    scene.layers.push(layer);
    return layer;
  };
  /** Test helper (no host equivalent): put an existing node in this scene. */
  scene.addLayer = seat;

  const applyOptions = (layer: Any, opts: Record<string, Any>) => {
    for (const [key, value] of Object.entries(opts)) {
      if (key === "scene") continue;
      if (key === "position" || key === "opacity") {
        const prop = layer[key];
        if (prop) prop.staticValue = value as Json;
        continue;
      }
      if (key === "fill") {
        layer.createFill(value);
        continue;
      }
      if (key === "stroke") {
        layer.createStroke(value);
        continue;
      }
      layer[key] = value;
    }
  };

  const factory =
    (type: string, allowed: readonly string[], label: string) =>
    (opts: Any = {}) => {
      if (!isPlainObject(opts)) invalidInput();
      onlyKeys(fields(opts), allowed);
      const layer = makeNode(`${label} ${scene.layers.length + 1}`, { type }, nextId);
      seat(layer);
      // A scene layer takes its source scene from the options when one is
      // given (1.0.1 SceneLayerCreateOptions.scene); otherwise it keeps the
      // empty scene of its own that makeNode gave it.
      if (type === "SCENE_LAYER" && fields(opts).scene !== undefined) {
        layer.scene = fields(opts).scene;
      }
      applyOptions(layer, fields(opts));
      return layer;
    };

  scene.createShapeLayer = factory("SHAPE_LAYER", LAYER_CREATE_KEYS, "Shape Layer");
  scene.createTextLayer = factory("TEXT_LAYER", TEXT_LAYER_CREATE_KEYS, "Text Layer");
  scene.createSceneLayer = factory("SCENE_LAYER", SCENE_LAYER_CREATE_KEYS, "Scene");
  return scene;
}

/**
 * The active scene the sandbox drives: one `makeInnerScene`, which is exactly
 * what the host hands back from `creator.activeScene`. Its
 * `createSceneLayer()` is the LIVE host's — an EMPTY scene layer that ignores
 * the selection (quirk 8) — so a test that wants the host to consume the
 * selection has to say so.
 */
export function makeFakeScene(nextId: (prefix: string) => string = makeIds()): Any {
  return makeInnerScene("Main Scene", nextId);
}

/** The four-node scene the host harness exposes as window.harness.nodes. */
export function makeScene() {
  const nextId = makeIds();
  const A = makeNode(
    "Layer A",
    { props: { position: { x: 100, y: 50 } }, fills: [{ r: 10, g: 20, b: 30 }] },
    nextId,
  );
  A.createRectangle({ size: { width: 80, height: 60 } });
  const B = makeNode("Layer B", { props: { position: { x: 400, y: 300 } } }, nextId);
  B.createStar({});
  const C = makeNode(
    "Layer C",
    { props: { position: { x: -50, y: 10 }, scale: { x: 200, y: 200 } } },
    nextId,
  );
  // no fills — exercises the resolvePath failure path
  const D = makeNode("Bare", { fills: [] }, nextId);
  return { nextId, A, B, C, D };
}
