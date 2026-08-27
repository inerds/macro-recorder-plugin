/**
 * Fake Creator scene, shared by public/host-harness.html and vitest.
 *
 * This is the only test double for the live-proxy surface that
 * plugin/serialize.ts and plugin/applier.ts talk to. It deliberately mirrors
 * the real API's awkward parts — notably that writing `staticValue` while
 * keyframes exist does nothing (plugin-api.d.ts:17-18). A friendlier fake
 * would hide the exact class of bug this harness exists to catch.
 *
 * Pure data only: no DOM, so it compiles under tsconfig.plugin.json too.
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

interface KfEntry {
  id: string;
  frame: number;
  value: Json;
  easing?: Json;
  inTangent?: Json;
  outTangent?: Json;
}

export interface FakeAnimatable {
  readonly isAnimated: boolean;
  staticValue: Json;
  readonly keyframes: Any[];
  addKeyframes(
    list: { frame: number; value: Json; easing?: Json; inTangent?: Json; outTangent?: Json }[],
  ): void;
  getKeyframeAt(frame: number): Any | undefined;
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

const EPSILON = 1e-6;

export function makeAnimatable(initial: Json, nextId: (prefix: string) => string): FakeAnimatable {
  let staticValue = clone(initial);
  let entries: KfEntry[] = [];
  // Sticky, like the real host: real traces show isAnimated staying true
  // after every keyframe is removed — it is a flag, not keyframes.length.
  let animatedFlag = false;
  let phantomGetAt = false;
  let addFailure: string | null = null;
  let writeFailure: string | null = null;
  let removeFailure: string | null = null;

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
        return clone(entry.value);
      },
      set value(next: Json) {
        if (writeFailure !== null) throw new Error(writeFailure);
        entry.value = clone(next);
      },
      get easing() {
        return clone(entry.easing);
      },
      set easing(next: Json | undefined) {
        entry.easing = clone(next);
      },
      get inTangent() {
        return clone(entry.inTangent);
      },
      set inTangent(next: Json | undefined) {
        entry.inTangent = clone(next);
      },
      get outTangent() {
        return clone(entry.outTangent);
      },
      set outTangent(next: Json | undefined) {
        entry.outTangent = clone(next);
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
      return clone(staticValue);
    },
    /**
     * Matches the real contract: "Setting staticValue when keyframes exist
     * will not affect the animation." Silently ignored, no throw.
     */
    set staticValue(value: Json) {
      if (entries.length > 0) return;
      staticValue = clone(value);
    },
    get keyframes() {
      return entries.map(handle);
    },
    addKeyframes(list) {
      if (addFailure !== null) throw new Error(addFailure);
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
          // value + easing): handles are NOT taken on creation, only by
          // writing the created keyframe afterwards.
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
            return clone(staticValue);
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

export function makeSolidFill(
  color: Json,
  nextId: (prefix: string) => string,
  opacity: Json = 100,
) {
  return {
    type: "SOLID",
    color: makeAnimatable(color, nextId),
    opacity: makeAnimatable(opacity, nextId),
  };
}

/** Gradient paint: `stops` is an Animatable whose staticValue is the array. */
export function makeGradientFill(
  stops: Json[],
  nextId: (prefix: string) => string,
) {
  return {
    type: "GRADIENT_LINEAR",
    stops: makeAnimatable(stops, nextId),
    opacity: makeAnimatable(100, nextId),
  };
}

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
  size: { x: 100, y: 100 },
  roundness: 0,
  innerRadius: 0,
  outerRadius: 50,
  innerRoundness: 0,
  outerRoundness: 0,
  points: 5,
  pathData: { points: [], closed: true },
};

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
 * The real host's BlendMode is a LOWERCASE string union
 * (plugin-api.d.ts's `BlendMode` type). Assigning anything outside this set —
 * including the differently-cased "NORMAL" — throws "✗ Invalid input" on a
 * live host (trace 2026-08-26T08-15-55-277_playback-Style-stamp.json, rev
 * .51). Validating it here is what lets a demo-macro / test-fixture casing
 * bug get caught instead of silently "working" only in the fake.
 */
const BLEND_MODES = new Set([
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
]);

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

/**
 * A fake node mirroring the v2 surface: per-type animatable props, plain
 * layer flags, fills/strokes/masks with add/remove, and a recursive `shapes`
 * tree with create* factories — plus the modelled host quirks.
 */
export function makeNode(
  name: string,
  options: FakeNodeOptions = {},
  nextId: (prefix: string) => string = makeIds(),
) {
  const nodeType = options.type ?? "CONTAINER";
  let gone = false;
  const failingProps = new Set<string>();

  const node: Any = {
    get id() {
      if (gone) throw new Error("node has been deleted");
      return nodeId;
    },
    name,
    type: nodeType,
    fills: [] as Any[],
    strokes: [] as Any[],
    masks: [] as Any[],
    shapes: [] as Any[],
    parent: undefined as Any,
    remove() {
      const list = node.parent?.shapes;
      if (Array.isArray(list)) {
        const at = list.indexOf(node);
        if (at >= 0) list.splice(at, 1);
      }
      gone = true;
    },
    /** SCENE_LAYER only: contents spill into the parent list, self removed. */
    __setSceneContents(contents: Any[]) {
      (node as Any).__sceneContents = contents;
      (node as Any).break = () => {
        const list = node.parent?.shapes ?? node.parent?.layers;
        if (!Array.isArray(list)) throw new Error("no parent to break into");
        const at = list.indexOf(node);
        for (const content of (node as Any).__sceneContents) {
          content.parent = node.parent;
        }
        list.splice(at >= 0 ? at : list.length, 1, ...(node as Any).__sceneContents);
      };
    },
    /** Deep copy inserted after self in the owner list, like the host. */
    clone() {
      const copyProps: Record<string, Json> = {};
      for (const propName of propsForType(nodeType)) {
        const prop = node[propName as string];
        if (prop && typeof prop === "object" && "staticValue" in prop) {
          copyProps[propName as string] = (prop as Any).staticValue;
        }
      }
      const copy = makeNode(`${name} copy`, { type: nodeType, props: copyProps }, nextId);
      for (const fill of node.fills) {
        copy.addFill({ type: "SOLID", color: fill.color?.staticValue ?? { r: 0, g: 0, b: 0 } });
      }
      for (const child of node.shapes) {
        const childCopy = child.clone();
        // clone() inserted it next to the child inside THIS node; move it
        const at = node.shapes.indexOf(childCopy);
        if (at >= 0) node.shapes.splice(at, 1);
        childCopy.parent = copy;
        copy.shapes.push(childCopy);
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
    // paint / stroke / mask structure
    addFill(spec: Any) {
      const paint: Any =
        spec?.type === "SOLID"
          ? makeSolidFill(spec.color, nextId)
          : makeGradientFill(Array.isArray(spec?.stops) ? spec.stops : [], nextId);
      // real host: removal lives on the paint object, not the container
      paint.remove = () => {
        const at = node.fills.indexOf(paint);
        if (at >= 0) node.fills.splice(at, 1);
      };
      node.fills.push(paint);
      return paint;
    },
    removeFill(index: number) {
      if (node.fills[index] === undefined) throw new Error(`no fill at ${index}`);
      node.fills.splice(index, 1);
    },
    createFill(spec: Any) {
      return node.addFill(spec);
    },
    addStroke(spec: Any) {
      const stroke = {
        width: makeAnimatable(spec?.width ?? 1, nextId),
        fill:
          spec?.fill?.type === "SOLID" || spec?.fill?.color !== undefined
            ? makeSolidFill(spec.fill.color ?? { r: 0, g: 0, b: 0 }, nextId)
            : makeGradientFill(Array.isArray(spec?.fill?.stops) ? spec.fill.stops : [], nextId),
      };
      (stroke as Any).remove = () => {
        const at = node.strokes.indexOf(stroke);
        if (at >= 0) node.strokes.splice(at, 1);
      };
      node.strokes.push(stroke);
      return stroke;
    },
    removeStroke(index: number) {
      if (node.strokes[index] === undefined) throw new Error(`no stroke at ${index}`);
      node.strokes.splice(index, 1);
    },
    createStroke(spec: Any) {
      return node.addStroke(spec);
    },
    trimPaths: [] as Any[],
    createTrimPath(spec: Any = {}) {
      const trim: Any = {
        mode: spec?.mode ?? "simultaneously",
        start: makeAnimatable(spec?.start ?? 0, nextId),
        end: makeAnimatable(spec?.end ?? 100, nextId),
        offset: makeAnimatable(spec?.offset ?? 0, nextId),
        remove() {
          const at = node.trimPaths.indexOf(trim);
          if (at >= 0) node.trimPaths.splice(at, 1);
        },
      };
      node.trimPaths.push(trim);
      return trim;
    },
    /**
     * Real host has no `addMask` — only `createMask` (docs/RUNTIME-API.md:103-106,
     * live-verified). Modelling `addMask` here would hide the applier's
     * add-mask case (plugin/applier.ts) only checking for `addMask`.
     */
    createMask(spec: Any) {
      const mask = {
        mode: spec?.mode ?? "add",
        pathData: makeAnimatable(spec?.pathData ?? { points: [], closed: true }, nextId),
        opacity: makeAnimatable(spec?.opacity ?? 100, nextId),
      };
      (mask as Any).remove = () => {
        const at = node.masks.indexOf(mask);
        if (at >= 0) node.masks.splice(at, 1);
      };
      node.masks.push(mask);
      return mask;
    },
    removeMask(index: number) {
      if (node.masks[index] === undefined) throw new Error(`no mask at ${index}`);
      node.masks.splice(index, 1);
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

  for (const color of options.fills ?? []) {
    node.addFill({ type: "SOLID", color });
  }

  // shape factories (ShapeContainerMixin)
  const factory = (type: string) => (opts: FakeNodeOptions["props"] = {}) => {
    const child = makeNode(`${type.toLowerCase()} ${node.shapes.length + 1}`, { type, props: opts }, nextId);
    child.parent = node;
    node.shapes.push(child);
    return child;
  };
  node.createGroup = (children: Any[]) => {
    const group = makeNode(`group ${node.shapes.length + 1}`, { type: "GROUP" }, nextId);
    group.parent = node;
    for (const child of children) {
      const at = node.shapes.indexOf(child);
      if (at >= 0) node.shapes.splice(at, 1);
      child.parent = group;
      group.shapes.push(child);
    }
    node.shapes.push(group);
    return group;
  };
  node.createRectangle = factory("RECTANGLE");
  node.createEllipse = factory("ELLIPSE");
  node.createPolygon = factory("POLYGON");
  node.createStar = factory("STAR");
  node.createPath = factory("PATH");

  for (const propName of propsForType(nodeType)) {
    const initial = options.props?.[propName] ?? DEFAULTS[propName];
    if (initial === undefined) continue;
    const animatable = makeAnimatable(initial, nextId);
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

  // plain layer flags — layers only, like the real API (text layers add the
  // text/font group on top; geometry shape nodes carry none of them)
  if (
    nodeType === "CONTAINER" ||
    nodeType === "SHAPE_LAYER" ||
    nodeType === "SCENE_INSTANCE" ||
    nodeType === "TEXT_LAYER"
  ) {
    const flags =
      nodeType === "TEXT_LAYER"
        ? { ...PLAIN_DEFAULTS, ...TEXT_PLAIN_DEFAULTS }
        : PLAIN_DEFAULTS;
    for (const [flag, initial] of Object.entries(flags)) {
      let value: Json = initial;
      Object.defineProperty(node, flag, {
        enumerable: true,
        configurable: true,
        get() {
          return value;
        },
        set(next: Json) {
          if (flag === "blendMode" && !BLEND_MODES.has(next as string)) {
            throw new Error("✗ Invalid input");
          }
          value = next;
        },
      });
    }
  }
  void PLAIN_PROPS; // keep registry import used; flags above mirror it

  return node;
}

/** The four-node scene the host harness exposes as window.harness.nodes. */
export function makeScene() {
  const nextId = makeIds();
  const A = makeNode("Layer A", { props: { position: { x: 100, y: 50 } }, fills: [{ r: 10, g: 20, b: 30 }] }, nextId);
  A.createRectangle({ size: { x: 80, y: 60 } });
  const B = makeNode("Layer B", { props: { position: { x: 400, y: 300 } } }, nextId);
  B.createStar({});
  const C = makeNode("Layer C", { props: { position: { x: -50, y: 10 }, scale: { x: 200, y: 200 } } }, nextId);
  // no fills — exercises the resolvePath failure path
  const D = makeNode("Bare", { fills: [] }, nextId);
  return { nextId, A, B, C, D };
}
