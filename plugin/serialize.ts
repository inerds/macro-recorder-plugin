/**
 * Live-proxy → plain-data snapshots. This file (and applier.ts) are the only
 * places that touch Creator proxies; everything downstream is pure.
 *
 * All reads are defensive: proxies vary by node type and any getter may
 * throw, so unreadable properties are simply omitted.
 */
import type { Json } from "../shared/json";
import { toJson } from "../shared/json";
import type {
  AnimatableSnapshot,
  KfSnap,
  MaskSnapshot,
  NodeSnapshot,
  PaintSnapshot,
  SceneSnapshot,
  StrokeSnapshot,
  TrimSnapshot,
} from "../shared/snapshot";

import { PLAIN_PROPS, propsForType } from "../shared/snapshot";

type AnyProxy = any;

/** Groups nest; a runaway/cyclic tree must not hang the sandbox. Imported
 * artwork nests deep (a real file showed 14 top-level groups), so the cap is
 * generous but finite. */
const MAX_DEPTH = 10;

function tryRead<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function readVector(value: AnyProxy): Json | undefined {
  const x = tryRead(() => Number(value.x));
  const y = tryRead(() => Number(value.y));
  if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
    return undefined;
  }
  return { x, y };
}

/**
 * PathData (and its points) are getter-based host objects: their fields are
 * readonly accessors, invisible to Object.keys and therefore to toJson —
 * which made every path edit serialize as {} on both sides of a diff and
 * vanish. Read the structure explicitly.
 */
function readPathData(value: AnyProxy): Json | undefined {
  const points = tryRead(() => value.points);
  const closed = tryRead(() => value.closed);
  if (!Array.isArray(points) && closed === undefined) return undefined;
  const list = Array.isArray(points) ? points : [];
  return {
    closed: closed === true,
    points: list.map((pt: AnyProxy) => {
      const out: Record<string, Json> = {};
      const vertex = readVector(tryRead(() => pt.vertex));
      const inTan = readVector(tryRead(() => pt.inTan));
      const outTan = readVector(tryRead(() => pt.outTan));
      if (vertex) out.vertex = vertex;
      if (inTan) out.inTan = inTan;
      if (outTan) out.outTan = outTan;
      return out;
    }),
  };
}

/** toJson, with a structural reader for path-shaped values. */
function valueToJson(value: AnyProxy): Json {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const looksLikePath =
      tryRead(() => value.points) !== undefined || tryRead(() => value.closed) !== undefined;
    if (looksLikePath) {
      const path = readPathData(value);
      if (path !== undefined) return path;
    }
  }
  return toJson(value);
}

function isAnimatableLike(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  return typeof (value as AnyProxy).addKeyframes === "function";
}

export function serializeAnimatable(prop: AnyProxy): AnimatableSnapshot {
  const snapshot: AnimatableSnapshot = {
    animated: tryRead(() => prop.isAnimated === true) ?? false,
  };
  const staticValue = tryRead(() => valueToJson(prop.staticValue));
  if (staticValue !== undefined) snapshot.static = staticValue;

  const keyframes = tryRead(() => {
    const list = prop.keyframes;
    if (!Array.isArray(list)) return undefined;
    return list.map((kf: AnyProxy): KfSnap => {
      const snap: KfSnap = {
        frame: tryRead(() => Number(kf.frame)) ?? 0,
        value: tryRead(() => valueToJson(kf.value)) ?? null,
      };
      const id = tryRead(() => kf.id);
      if (typeof id === "string") snap.id = id;
      const easing = tryRead(() => toJson(kf.easing));
      if (easing !== undefined && easing !== null) snap.easing = easing;
      // Motion-path handles: present only on spatial (position) keyframes.
      const inTangent = tryRead(() => toJson(kf.inTangent));
      if (inTangent !== undefined && inTangent !== null) snap.inTangent = inTangent;
      const outTangent = tryRead(() => toJson(kf.outTangent));
      if (outTangent !== undefined && outTangent !== null) snap.outTangent = outTangent;
      return snap;
    });
  });
  if (keyframes) snapshot.keyframes = keyframes;
  return snapshot;
}

export function serializePaint(paint: AnyProxy): PaintSnapshot {
  const type = tryRead(() => String(paint.type));
  // Per-paint opacity exists in Creator's UI even though the published
  // typings omit it — probe defensively.
  const opacity = tryRead(() => paint.opacity);
  const opacitySnap =
    opacity !== undefined && isAnimatableLike(opacity)
      ? serializeAnimatable(opacity)
      : undefined;
  if (type === "SOLID") {
    const snapshot: PaintSnapshot = { kind: "solid", color: serializeAnimatable(paint.color) };
    if (opacitySnap) snapshot.opacity = opacitySnap;
    return snapshot;
  }
  if (type === "GRADIENT_LINEAR" || type === "GRADIENT_RADIAL") {
    const snapshot: PaintSnapshot = {
      kind: "gradient",
      gradientType: type,
      stops: serializeAnimatable(paint.stops),
    };
    if (opacitySnap) snapshot.opacity = opacitySnap;
    const start = tryRead(() => paint.start);
    if (start !== undefined && isAnimatableLike(start)) snapshot.start = serializeAnimatable(start);
    const end = tryRead(() => paint.end);
    if (end !== undefined && isAnimatableLike(end)) snapshot.end = serializeAnimatable(end);
    if (type === "GRADIENT_RADIAL") {
      const angle = tryRead(() => paint.highlightAngle);
      if (angle !== undefined && isAnimatableLike(angle)) {
        snapshot.highlightAngle = serializeAnimatable(angle);
      }
      const length = tryRead(() => paint.highlightLength);
      if (length !== undefined && isAnimatableLike(length)) {
        snapshot.highlightLength = serializeAnimatable(length);
      }
    }
    return snapshot;
  }
  return { kind: "unknown" };
}

function serializeMask(mask: AnyProxy): MaskSnapshot {
  const snapshot: MaskSnapshot = {
    pathData: serializeAnimatable(tryRead(() => mask.pathData)),
    opacity: serializeAnimatable(tryRead(() => mask.opacity)),
  };
  const mode = tryRead(() => mask.mode);
  if (typeof mode === "string") snapshot.mode = mode;
  return snapshot;
}

/** Lottie animatable value ({a:0,k:v} | {a:1,k:[{t,s},...]}) -> snapshot. */
function lottieAnimatable(raw: AnyProxy): AnimatableSnapshot | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const animated = raw.a === 1;
  if (!animated) {
    const value = toJson(raw.k);
    return value === null ? undefined : { animated: false, static: value };
  }
  const keyframes = Array.isArray(raw.k)
    ? raw.k
        .map((kf: AnyProxy): KfSnap | null => {
          const frame = Number(kf?.t);
          if (!Number.isFinite(frame)) return null;
          const s = kf?.s;
          const value = Array.isArray(s) && s.length === 1 ? toJson(s[0]) : toJson(s);
          return { frame, value };
        })
        .filter((kf: KfSnap | null): kf is KfSnap => kf !== null)
    : [];
  return { animated: true, keyframes };
}

/**
 * Fill/stroke opacity is animatable in the Lottie document (`o` on fl/st
 * shapes) but the paint proxies never wrap it. node.toJSON() — an untyped
 * runtime method — exposes the raw document, so opacities are recovered from
 * there, matched to the paint lists by document order.
 */
function collectPaintOpacities(node: AnyProxy): { fills: AnimatableSnapshot[]; strokes: AnimatableSnapshot[] } {
  const out = { fills: [] as AnimatableSnapshot[], strokes: [] as AnimatableSnapshot[] };
  const raw = tryRead(() => (typeof node.toJSON === "function" ? node.toJSON() : undefined));
  if (raw === undefined || raw === null) return out;
  const walk = (value: AnyProxy, depth: number): void => {
    if (depth > 8 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (value.ty === "fl" || value.ty === "st") {
      const opacity = lottieAnimatable(value.o);
      if (opacity) (value.ty === "fl" ? out.fills : out.strokes).push(opacity);
    }
    for (const key of Object.keys(value)) {
      try {
        walk(value[key], depth + 1);
      } catch {
        // unreadable branch — skip
      }
    }
  };
  try {
    walk(raw, 0);
  } catch {
    // malformed document — no opacities
  }
  return out;
}

export function serializeNode(node: AnyProxy, depth = 0): NodeSnapshot {
  const nodeType = tryRead(() => String(node.type)) ?? "UNKNOWN";
  const snapshot: NodeSnapshot = {
    nodeId: tryRead(() => String(node.id)) ?? "unknown",
    nodeType,
    props: {},
    plain: {},
    fills: [],
    strokes: [],
    masks: [],
    trims: [],
    shapes: [],
  };
  const name = tryRead(() => node.name);
  if (typeof name === "string") snapshot.nodeName = name;

  for (const propName of propsForType(nodeType)) {
    const prop = tryRead(() => node[propName]);
    if (prop !== undefined && isAnimatableLike(prop)) {
      snapshot.props[propName] = serializeAnimatable(prop);
    }
  }

  for (const flag of PLAIN_PROPS) {
    const value = tryRead(() => toJson(node[flag]));
    // isMatte etc. are booleans/numbers/strings; objects (like matte refs)
    // are not diffable by value and are skipped.
    if (value !== undefined && value !== null && typeof value !== "object") {
      snapshot.plain[flag] = value;
    }
  }

  const fills = tryRead(() => node.fills);
  if (Array.isArray(fills)) {
    snapshot.fills = fills.map((fill: AnyProxy) => serializePaint(fill));
  } else {
    // Text layers carry a SINGULAR fill/stroke — model as a one-item list so
    // the whole paint pipeline (diff, recolor, keyframes) applies unchanged.
    const single = tryRead(() => node.fill);
    if (single !== undefined && single !== null && typeof single === "object") {
      snapshot.fills = [serializePaint(single)];
    }
  }

  const strokes = tryRead(() => node.strokes);
  if (Array.isArray(strokes)) {
    snapshot.strokes = strokes.map(
      (stroke: AnyProxy): StrokeSnapshot => ({
        width: serializeAnimatable(stroke.width),
        fill: serializePaint(tryRead(() => stroke.fill)),
      }),
    );
  } else {
    const single = tryRead(() => node.stroke);
    if (single !== undefined && single !== null && typeof single === "object") {
      snapshot.strokes = [
        {
          width: serializeAnimatable(tryRead(() => single.width)),
          fill: serializePaint(tryRead(() => single.fill) ?? single),
        },
      ];
    }
  }

  // Paint opacity is only reachable through the raw document (see above).
  if (snapshot.fills.length > 0 || snapshot.strokes.length > 0) {
    const opacities = collectPaintOpacities(node);
    opacities.fills.forEach((opacity, i) => {
      const paint = snapshot.fills[i];
      if (paint && paint.kind !== "unknown" && !paint.opacity) paint.opacity = opacity;
    });
    opacities.strokes.forEach((opacity, i) => {
      const stroke = snapshot.strokes[i];
      if (stroke && stroke.fill.kind !== "unknown" && !stroke.fill.opacity) {
        stroke.fill.opacity = opacity;
      }
    });
  }

  const masks = tryRead(() => node.masks);
  if (Array.isArray(masks)) {
    snapshot.masks = masks.map((mask: AnyProxy) => serializeMask(mask));
  }

  // Trim paths — untyped runtime surface (node.trimPaths / createTrimPath).
  const trims = tryRead(() => node.trimPaths);
  if (Array.isArray(trims)) {
    snapshot.trims = trims.map((trim: AnyProxy): TrimSnapshot => {
      const out: TrimSnapshot = {};
      for (const propName of ["start", "end", "offset"] as const) {
        const prop = tryRead(() => trim[propName]);
        if (prop !== undefined && isAnimatableLike(prop)) {
          out[propName] = serializeAnimatable(prop);
        }
      }
      const mode = tryRead(() => trim.mode);
      if (typeof mode === "string") out.mode = mode;
      return out;
    });
  }

  if (depth < MAX_DEPTH) {
    const shapes = tryRead(() => node.shapes);
    if (Array.isArray(shapes)) {
      snapshot.shapes = shapes.map((shape: AnyProxy) => serializeNode(shape, depth + 1));
    } else {
      // Scene-instance layers hold their content in the SOURCE scene. Model
      // it as the child channel so edits inside instances record and deep
      // paths resolve; note the content is shared between all instances of
      // that scene.
      const sceneLayers = tryRead(() => node.scene?.layers);
      if (Array.isArray(sceneLayers)) {
        snapshot.shapes = sceneLayers.map((layer: AnyProxy) => serializeNode(layer, depth + 1));
      }
    }
  }

  return snapshot;
}

/** Whole-scene snapshot: every top-level layer's subtree. */
export function serializeScene(scene: AnyProxy): SceneSnapshot {
  const snapshot: SceneSnapshot = { layers: [] };
  const id = tryRead(() => String(scene.id));
  if (id !== undefined) snapshot.sceneId = id;
  const layers = tryRead(() => scene.layers);
  if (Array.isArray(layers)) {
    snapshot.layers = layers.map((layer: AnyProxy) => serializeNode(layer));
  }
  return snapshot;
}
