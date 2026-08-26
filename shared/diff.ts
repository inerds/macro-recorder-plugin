import { jsonEqual, type Json } from "./json";
import type {
  AnimatableSnapshot,
  KfSnap,
  MaskSnapshot,
  NodeSnapshot,
  PaintSnapshot,
  Path,
  SceneSnapshot,
  StrokeSnapshot,
  TrimSnapshot,
} from "./snapshot";
import type { LayerRef, StepPayload } from "./steps";

function diffStatic(path: Path, prev: AnimatableSnapshot, next: AnimatableSnapshot, out: StepPayload[]) {
  const before = prev.static ?? null;
  const after = next.static ?? null;
  if (!jsonEqual(before, after)) {
    out.push({ op: "set-static", path, before, after });
  }
}

/** Everything about a keyframe except where it sits on the timeline. */
function kfAttrsEqual(a: KfSnap, b: KfSnap): boolean {
  return (
    jsonEqual(a.value, b.value) &&
    jsonEqual(a.easing ?? null, b.easing ?? null) &&
    jsonEqual(a.inTangent ?? null, b.inTangent ?? null) &&
    jsonEqual(a.outTangent ?? null, b.outTangent ?? null)
  );
}

function kfEqual(a: KfSnap, b: KfSnap): boolean {
  return Math.abs(a.frame - b.frame) < 1e-6 && kfAttrsEqual(a, b);
}

function diffKeyframes(path: Path, prev: AnimatableSnapshot, next: AnimatableSnapshot, out: StepPayload[]) {
  const prevKfs = prev.keyframes ?? [];
  const nextKfs = next.keyframes ?? [];
  if (prevKfs.length === 0 && nextKfs.length === 0) return;

  // Key strictly by frame. Keyframe ids look like identity but aren't:
  // Creator reassigns kf.id when a keyframe's value is edited, and recycles
  // ids from a pool. Keying by id turned an ordinary value edit into
  // "removed one, added one" at the SAME frame, which replays as a net
  // deletion. A property cannot hold two keyframes at one frame, so frame is
  // the only stable identity a recorded keyframe can carry.
  const keyOf = (k: KfSnap) => `f:${k.frame}`;

  const prevByKey = new Map(prevKfs.map((k) => [keyOf(k), k]));
  const nextByKey = new Map(nextKfs.map((k) => [keyOf(k), k]));

  const added: KfSnap[] = [];
  const removed: KfSnap[] = [];
  const changed: { before: KfSnap; after: KfSnap }[] = [];

  for (const [key, kf] of nextByKey) {
    const prevKf = prevByKey.get(key);
    if (!prevKf) added.push(kf);
    else if (!kfEqual(prevKf, kf)) changed.push({ before: prevKf, after: kf });
  }
  for (const [key, kf] of prevByKey) {
    if (!nextByKey.has(key)) removed.push(kf);
  }

  // A keyframe dragged along the timeline leaves one unmatched removal and
  // one unmatched addition holding the same value. Re-pair them so the step
  // reads (and replays) as a move rather than a delete-plus-add.
  if (added.length === 1 && removed.length === 1) {
    const before = removed[0]!;
    const after = added[0]!;
    if (kfAttrsEqual(before, after)) {
      changed.push({ before, after });
      added.length = 0;
      removed.length = 0;
    }
  }

  if (added.length || removed.length || changed.length) {
    out.push({ op: "keyframes", path, added, removed, changed });
  }
}

function diffAnimatable(path: Path, prev: AnimatableSnapshot | undefined, next: AnimatableSnapshot | undefined, out: StepPayload[]) {
  if (!prev || !next) return; // property appeared/disappeared — structural noise, skip
  diffStatic(path, prev, next, out);
  diffKeyframes(path, prev, next, out);
}

function diffPaint(basePath: Path, prev: PaintSnapshot, next: PaintSnapshot, out: StepPayload[]) {
  if (prev.kind === "solid" && next.kind === "solid") {
    diffAnimatable([...basePath, "color"], prev.color, next.color, out);
    diffAnimatable([...basePath, "opacity"], prev.opacity, next.opacity, out);
    return;
  }
  if (prev.kind === "gradient" && next.kind === "gradient") {
    diffAnimatable([...basePath, "stops"], prev.stops, next.stops, out);
    diffAnimatable([...basePath, "start"], prev.start, next.start, out);
    diffAnimatable([...basePath, "end"], prev.end, next.end, out);
    diffAnimatable([...basePath, "highlightAngle"], prev.highlightAngle, next.highlightAngle, out);
    diffAnimatable([...basePath, "highlightLength"], prev.highlightLength, next.highlightLength, out);
    diffAnimatable([...basePath, "opacity"], prev.opacity, next.opacity, out);
    return;
  }
  if (prev.kind !== next.kind && next.kind !== "unknown") {
    // paint type changed (solid <-> gradient): replay by remove + recreate
    out.push({ op: "replace-paint", path: basePath, spec: next });
  }
}

function diffStroke(basePath: Path, prev: StrokeSnapshot, next: StrokeSnapshot, out: StepPayload[]) {
  diffAnimatable([...basePath, "width"], prev.width, next.width, out);
  diffPaint([...basePath, "fill"], prev.fill, next.fill, out);
}

function diffMask(basePath: Path, prev: MaskSnapshot, next: MaskSnapshot, out: StepPayload[]) {
  diffAnimatable([...basePath, "pathData"], prev.pathData, next.pathData, out);
  diffAnimatable([...basePath, "opacity"], prev.opacity, next.opacity, out);
}

function diffTrim(basePath: Path, prev: TrimSnapshot, next: TrimSnapshot, out: StepPayload[]) {
  diffAnimatable([...basePath, "start"], prev.start, next.start, out);
  diffAnimatable([...basePath, "end"], prev.end, next.end, out);
  diffAnimatable([...basePath, "offset"], prev.offset, next.offset, out);
}

function diffPlain(basePath: Path, prev: Record<string, Json>, next: Record<string, Json>, out: StepPayload[]) {
  const names = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const name of names) {
    const before = prev[name] ?? null;
    const after = next[name] ?? null;
    if (before === null || after === null) continue; // appeared/disappeared — noise
    if (!jsonEqual(before, after)) {
      out.push({ op: "set-plain", path: [...basePath, name], before, after });
    }
  }
}

/**
 * Diffs one node level: animatable props, plain flags, paints, strokes,
 * masks, then recurses into child shapes matched by node id.
 */
function diffNode(basePath: Path, prev: NodeSnapshot, next: NodeSnapshot, out: StepPayload[]) {
  const mine: StepPayload[] = [];
  const sink = basePath.includes("shapes") ? mine : out;
  diffNodeInner(basePath, prev, next, sink);
  if (sink === mine) {
    // annotate value ops with the shape's type so replay can re-find "the
    // rectangle" on targets whose shape indices differ
    for (const payload of mine) {
      if (
        (payload.op === "set-static" ||
          payload.op === "keyframes" ||
          payload.op === "set-plain") &&
        payload.shapeHint === undefined
      ) {
        payload.shapeHint = next.nodeType;
      }
      out.push(payload);
    }
  }
}

function diffNodeInner(basePath: Path, prev: NodeSnapshot, next: NodeSnapshot, out: StepPayload[]) {
  if (
    prev.nodeName !== undefined &&
    next.nodeName !== undefined &&
    prev.nodeName !== next.nodeName
  ) {
    out.push({ op: "set-plain", path: [...basePath, "name"], before: prev.nodeName, after: next.nodeName });
  }
  const propNames = Object.keys(prev.props).filter((name) => name in next.props);
  for (const name of propNames) {
    diffAnimatable([...basePath, name], prev.props[name], next.props[name], out);
  }

  diffPlain(basePath, prev.plain, next.plain, out);

  const sharedFills = Math.min(prev.fills.length, next.fills.length);
  for (let i = 0; i < sharedFills; i++) {
    diffPaint([...basePath, "fills", i], prev.fills[i]!, next.fills[i]!, out);
  }
  // structure: fills added/removed (index-tail assumption)
  for (let i = sharedFills; i < next.fills.length; i++) {
    out.push({ op: "add-paint", path: [...basePath, "fills", i], spec: next.fills[i]! });
  }
  for (let i = prev.fills.length - 1; i >= sharedFills; i--) {
    out.push({ op: "remove-paint", path: [...basePath, "fills", i] });
  }

  const sharedStrokes = Math.min(prev.strokes.length, next.strokes.length);
  for (let i = 0; i < sharedStrokes; i++) {
    diffStroke([...basePath, "strokes", i], prev.strokes[i]!, next.strokes[i]!, out);
  }
  for (let i = sharedStrokes; i < next.strokes.length; i++) {
    const stroke = next.strokes[i]!;
    out.push({
      op: "add-stroke",
      path: [...basePath, "strokes", i],
      spec: { width: stroke.width.static ?? (1 as Json), fill: stroke.fill },
    });
  }
  for (let i = prev.strokes.length - 1; i >= sharedStrokes; i--) {
    out.push({ op: "remove-paint", path: [...basePath, "strokes", i] });
  }

  const prevTrims = prev.trims ?? [];
  const nextTrims = next.trims ?? [];
  const sharedTrims = Math.min(prevTrims.length, nextTrims.length);
  for (let i = 0; i < sharedTrims; i++) {
    diffTrim([...basePath, "trimPaths", i], prevTrims[i]!, nextTrims[i]!, out);
  }
  for (let i = sharedTrims; i < nextTrims.length; i++) {
    out.push({ op: "add-trim", path: [...basePath, "trimPaths", i], spec: nextTrims[i]! });
  }
  for (let i = prevTrims.length - 1; i >= sharedTrims; i--) {
    out.push({ op: "remove-trim", path: [...basePath, "trimPaths", i] });
  }

  const sharedMasks = Math.min(prev.masks.length, next.masks.length);
  for (let i = 0; i < sharedMasks; i++) {
    diffMask([...basePath, "masks", i], prev.masks[i]!, next.masks[i]!, out);
  }
  for (let i = sharedMasks; i < next.masks.length; i++) {
    out.push({ op: "add-mask", path: [...basePath, "masks", i], spec: next.masks[i]! });
  }
  for (let i = prev.masks.length - 1; i >= sharedMasks; i--) {
    out.push({ op: "remove-mask", path: [...basePath, "masks", i] });
  }

  diffShapes(basePath, prev, next, out);
}

/** Child shapes matched by node id (stable within a session). */
function diffShapes(basePath: Path, prev: NodeSnapshot, next: NodeSnapshot, out: StepPayload[]) {
  const prevById = new Map(prev.shapes.map((shape, i) => [shape.nodeId, { shape, i }]));
  const nextById = new Map(next.shapes.map((shape, i) => [shape.nodeId, { shape, i }]));

  // edits + recursion, addressed by the CURRENT (next) index
  for (const [id, { shape: nextShape, i }] of nextById) {
    const prevEntry = prevById.get(id);
    if (prevEntry) {
      diffNode([...basePath, "shapes", i], prevEntry.shape, nextShape, out);
    } else {
      out.push({ op: "add-shape", parentPath: basePath, spec: nextShape });
    }
  }
  // removals, addressed by the PREVIOUS index (that's where the target has it)
  for (const [id, { shape, i }] of prevById) {
    if (!nextById.has(id)) {
      out.push({
        op: "remove-shape",
        path: [...basePath, "shapes", i],
        shapeType: shape.nodeType,
      });
    }
  }

  // Reorder of surviving shapes — replayable via the host's untyped
  // moveBefore/moveAfter (runtime-discovered; the typings omit them). The
  // permutation is expressed over survivors: by the time it replays, the
  // step sequence has already applied this tick's removals, and additions
  // land after it at the end of the list.
  const survivorsPrev = prev.shapes.filter((s) => nextById.has(s.nodeId)).map((s) => s.nodeId);
  const survivorsNext = next.shapes.filter((s) => prevById.has(s.nodeId)).map((s) => s.nodeId);
  if (
    survivorsPrev.length === survivorsNext.length &&
    survivorsPrev.some((id, i) => survivorsNext[i] !== id)
  ) {
    out.push({
      op: "reorder-shapes",
      path: basePath,
      order: survivorsNext.map((id) => survivorsPrev.indexOf(id)),
    });
  }
}

/**
 * Pure structural diff between two snapshots of the same node tree.
 * Deterministic order per level: props, plain flags, fills, strokes, masks,
 * then child shapes.
 */
export function diffSnapshots(prev: NodeSnapshot, next: NodeSnapshot): StepPayload[] {
  const out: StepPayload[] = [];
  diffNode([], prev, next, out);
  return out;
}

const ROOT_TRANSFORMS = ["position", "rotation", "scale", "skew", "skewAxis"] as const;

/** Structural identity, ignoring per-node/keyframe ids, names, AND the
 *  layer's own transform statics — Creator's duplicate offsets the copy, so
 *  a copy must match its source by content, not by where it sits. */
function structuralKey(node: NodeSnapshot): string {
  const props: NodeSnapshot["props"] = {};
  for (const [name, snap] of Object.entries(node.props)) {
    props[name] = (ROOT_TRANSFORMS as readonly string[]).includes(name)
      ? { ...snap, static: undefined }
      : snap;
  }
  const normalized: NodeSnapshot = { ...node, props };
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value !== null && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        if (key === "nodeId" || key === "nodeName" || key === "id") continue;
        out[key] = strip(inner);
      }
      return out;
    }
    return value;
  };
  return JSON.stringify(strip(normalized));
}

/** copy.position − source.position, per numeric component. */
function positionDelta(source: NodeSnapshot, copy: NodeSnapshot): Json | undefined {
  const a = source.props.position?.static;
  const b = copy.props.position?.static;
  if (
    a === null || b === null ||
    typeof a !== "object" || typeof b !== "object" ||
    Array.isArray(a) || Array.isArray(b) ||
    a === undefined || b === undefined
  ) {
    return undefined;
  }
  const out: Record<string, Json> = {};
  let any = false;
  for (const key of Object.keys(b)) {
    const from = (a as Record<string, Json>)[key];
    const to = (b as Record<string, Json>)[key];
    if (typeof from === "number" && typeof to === "number") {
      out[key] = to - from;
      if (Math.abs(to - from) > 1e-6) any = true;
    }
  }
  return any ? out : undefined;
}

function layerRefOf(layer: NodeSnapshot): LayerRef {
  const ref: LayerRef = { id: layer.nodeId };
  if (layer.nodeName) ref.name = layer.nodeName;
  return ref;
}

/**
 * Whole-scene diff: layers matched by id. Edits inside a surviving layer come
 * from diffSnapshots, each payload bound to its layer. New layers that are
 * structural copies of an existing one become clone-based add-layer steps
 * (duplicate / copy-paste); the rest carry their full spec. Removed layers
 * and layer reordering are captured like their shape-level counterparts.
 */
export function diffScene(prev: SceneSnapshot, next: SceneSnapshot): StepPayload[] {
  const out: StepPayload[] = [];
  const prevById = new Map(prev.layers.map((layer, i) => [layer.nodeId, { layer, i }]));
  const nextById = new Map(next.layers.map((layer, i) => [layer.nodeId, { layer, i }]));

  const prevKeys = new Map<string, NodeSnapshot>();
  for (const layer of prev.layers) {
    const key = structuralKey(layer);
    if (!prevKeys.has(key)) prevKeys.set(key, layer);
  }

  for (const [id, { layer: nextLayer }] of nextById) {
    const prevEntry = prevById.get(id);
    if (prevEntry) {
      const payloads = diffSnapshots(prevEntry.layer, nextLayer);
      const ref = layerRefOf(nextLayer);
      if (
        prevEntry.layer.nodeName !== undefined &&
        prevEntry.layer.nodeName !== nextLayer.nodeName
      ) {
        ref.priorName = prevEntry.layer.nodeName;
      }
      for (const payload of payloads) {
        if ("path" in payload || payload.op === "add-shape") {
          (payload as { layer?: LayerRef }).layer = ref;
        }
        out.push(payload);
      }
    } else {
      const source = prevKeys.get(structuralKey(nextLayer));
      if (source) {
        const payload: Extract<StepPayload, { op: "add-layer" }> = {
          op: "add-layer",
          spec: nextLayer,
          cloneOf: layerRefOf(source),
        };
        const offset = positionDelta(source, nextLayer);
        if (offset) payload.offset = offset;
        out.push(payload);
      } else {
        out.push({ op: "add-layer", spec: nextLayer });
      }
    }
  }

  // Break detection: exactly one SCENE-instance layer vanished while new
  // layers appeared in the same tick — that's SceneInstance.break() spilling
  // its contents. Record the semantic op; the freshly added specs become the
  // fallback for hosts/targets where break() can't run.
  const removedLayers = [...prevById.values()]
    .filter(({ layer }) => !nextById.has(layer.nodeId))
    .map(({ layer }) => layer);
  const addedPayloads = out.filter(
    (payload): payload is Extract<StepPayload, { op: "add-layer" }> => payload.op === "add-layer",
  );
  const removedSceneInstances = removedLayers.filter((layer) =>
    layer.nodeType.startsWith("SCENE"),
  );
  const addedSceneLayers = addedPayloads.filter(
    (payload) => !payload.cloneOf && payload.spec.nodeType.startsWith("SCENE"),
  );
  const removedPlainLayers = removedLayers.filter(
    (layer) => !layer.nodeType.startsWith("SCENE"),
  );
  if (
    addedSceneLayers.length === 1 &&
    removedPlainLayers.length > 0 &&
    removedSceneInstances.length === 0
  ) {
    // Creator's "nest into scene": the removed layers became the new scene
    // instance's content.
    const nested = addedSceneLayers[0]!;
    const at = out.indexOf(nested);
    if (at >= 0) out.splice(at, 1);
    out.push({
      op: "nest-layers",
      layers: removedLayers.map((layer) => layerRefOf(layer)),
      spec: nested.spec,
    });
    return out;
  }
  if (removedSceneInstances.length === 1 && addedPayloads.length > 0) {
    const broken = removedSceneInstances[0]!;
    for (const added of addedPayloads) {
      const at = out.indexOf(added);
      if (at >= 0) out.splice(at, 1);
    }
    out.push({
      op: "break-scene",
      layer: layerRefOf(broken),
      fallback: addedPayloads.map((payload) => payload.spec),
    });
    for (const layer of removedLayers) {
      if (layer !== broken) out.push({ op: "remove-layer", layer: layerRefOf(layer) });
    }
  } else {
    for (const layer of removedLayers) {
      out.push({ op: "remove-layer", layer: layerRefOf(layer) });
    }
  }

  const survivorsPrev = prev.layers.filter((l) => nextById.has(l.nodeId)).map((l) => l.nodeId);
  const survivorsNext = next.layers.filter((l) => prevById.has(l.nodeId)).map((l) => l.nodeId);
  if (
    survivorsPrev.length === survivorsNext.length &&
    survivorsPrev.some((id, i) => survivorsNext[i] !== id)
  ) {
    // Identities travel WITH the order (rev .52): `layers[i]` is the layer
    // that ends up at position i, so replay can resolve each one against the
    // live scene and refuse to permute a scene that isn't the recorded one.
    out.push({
      op: "reorder-layers",
      order: survivorsNext.map((id) => survivorsPrev.indexOf(id)),
      layers: survivorsNext.map((id) => {
        const nextLayer = nextById.get(id)!.layer;
        const ref = layerRefOf(nextLayer);
        const prevName = prevById.get(id)?.layer.nodeName;
        if (prevName !== undefined && prevName !== nextLayer.nodeName) ref.priorName = prevName;
        return ref;
      }),
    });
  }

  return out;
}
