/**
 * Recording scope — which layers a recording watches.
 *
 * Recording stays WHOLE-SCENE underneath: `diffScene` needs every layer of
 * both snapshots for clone detection, for the reorder survivors list, and for
 * same-tick nest/break correlation, so filtering the snapshots would break the
 * differ. The scope is applied AFTER the diff instead — the tick's payloads
 * are partitioned into the ones the user asked for and the ones to drop.
 *
 * Pure: snapshots and payloads in, decisions out. No proxies, no host.
 */
import type { LayerRef, StepPayload } from "./steps";

/**
 * What the session records. `ids` are top-level layer ids in snapshot order,
 * fixed at `record.start` and grown by the layers the recording itself
 * creates (duplicates, new layers, a nest's scene layer, a break's contents).
 */
export type RecordScope = { kind: "scene" } | { kind: "layers"; ids: string[] };

/**
 * The shape both readers of a scene give this module: the full
 * `NodeSnapshot` from `serializeScene`, and the light `serializeSceneIndex`
 * the idle peek uses. Only identity and the child channel matter here.
 */
export interface NodeTree {
  nodeId: string;
  nodeName?: string;
  nodeType?: string;
  shapes: NodeTree[];
}

/** True when `id` is this layer or anything in its subtree. */
function ownsId(layer: NodeTree, id: string): boolean {
  if (layer.nodeId === id) return true;
  for (const shape of layer.shapes) {
    if (ownsId(shape, id)) return true;
  }
  return false;
}

/**
 * The scope a selection implies. A selected shape, group, or a node inside a
 * scene layer's child channel resolves to its owning TOP-LEVEL layer, because
 * that is the unit `diffScene` binds payloads to. Masks and paints carry no
 * id and never appear in `selection.nodes`, so they resolve through whatever
 * node the user actually had selected.
 *
 * Nothing selected is not a failure: it is the whole-scene recording this
 * plugin has always done. A non-empty selection that matches no layer of the
 * active scene IS worth saying out loud — the user selected something in
 * another scene — so it falls back with `fellBack: true`.
 */
export function resolveScope(
  layers: readonly NodeTree[],
  selectedIds: readonly string[],
): { scope: RecordScope; unresolved: string[]; fellBack: boolean } {
  const owners = new Set<string>();
  const unresolved: string[] = [];
  for (const selected of selectedIds) {
    // Two instances of one scene share their children's ids, so a node
    // inside the second instance resolves to the first. The host's selection
    // cannot tell the two apart either; the first is the honest answer.
    const owner = layers.find((layer) => ownsId(layer, selected));
    if (owner) owners.add(owner.nodeId);
    else unresolved.push(selected);
  }
  if (owners.size === 0) {
    return { scope: { kind: "scene" }, unresolved, fellBack: selectedIds.length > 0 };
  }
  // Snapshot order, deduped: two shapes of one layer are one scope entry.
  const ids = layers.filter((layer) => owners.has(layer.nodeId)).map((layer) => layer.nodeId);
  return { scope: { kind: "layers", ids }, unresolved, fellBack: false };
}

/**
 * The scope's layers as the panel names them. An id with no layer in the
 * snapshot still gets a ref: the scope grew with a layer this tick created,
 * and the caller's snapshot may predate it.
 */
export function scopeLayerRefs(layers: readonly NodeTree[], scope: RecordScope): LayerRef[] {
  if (scope.kind === "scene") return [];
  return scope.ids.map((id) => {
    const layer = layers.find((candidate) => candidate.nodeId === id);
    const name = layer?.nodeName;
    return name === undefined ? { id } : { id, name };
  });
}

/** Does this payload bind to a layer the scope watches? */
function layerOf(payload: StepPayload): LayerRef | undefined {
  return "layer" in payload ? payload.layer : undefined;
}

/**
 * Split a tick's payloads into the ones inside the scope and a count of the
 * ones dropped, and report the scope the tick grew into.
 *
 * Growth is collected in a FIRST PASS, to a fixed point, before anything is
 * partitioned: `diffScene` makes no promise about payload order within a
 * tick, so "the layer was added in this same tick" must hold whether the
 * add-layer comes before or after the edits to it.
 *
 * Scene scope keeps everything — the tick is what it always was.
 */
export function partitionByScope(
  payloads: readonly StepPayload[],
  scope: RecordScope,
): { kept: StepPayload[]; ignored: number; scope: RecordScope } {
  if (scope.kind === "scene") {
    return { kept: [...payloads], ignored: 0, scope };
  }

  const ids = new Set(scope.ids);
  const grow = (id: string): boolean => {
    if (ids.has(id)) return false;
    ids.add(id);
    return true;
  };
  for (let grew = true; grew;) {
    grew = false;
    for (const payload of payloads) {
      if (payload.op === "add-layer") {
        // Anything the recording creates joins the scope: a duplicate of the
        // scoped layer, a duplicate of another layer, a layer drawn from
        // scratch. The user made it during THIS recording, so they meant it.
        if (grow(payload.spec.nodeId)) grew = true;
      } else if (payload.op === "nest-layers") {
        if (payload.layers.some((ref) => ids.has(ref.id)) && grow(payload.spec.nodeId)) grew = true;
      } else if (payload.op === "break-scene" && ids.has(payload.layer.id)) {
        for (const spec of payload.fallback) {
          if (grow(spec.nodeId)) grew = true;
        }
      }
    }
  }

  const kept: StepPayload[] = [];
  for (const payload of payloads) {
    let keep: boolean;
    switch (payload.op) {
      case "add-layer":
        keep = true;
        break;
      case "remove-layer":
      case "break-scene":
        keep = ids.has(payload.layer.id);
        break;
      case "nest-layers":
        // Nesting a scoped layer with unscoped ones is still the user acting
        // on their layer, and replay rebuilds the whole nest from `spec`.
        keep = payload.layers.some((ref) => ids.has(ref.id));
        break;
      case "reorder-layers":
        // A permutation of layers the user never touched is not their edit.
        // `order[i] !== i` is what makes a scoped layer's position change;
        // a legacy payload carries no identities, so it cannot be judged.
        keep =
          payload.layers === undefined ||
          payload.layers.some((ref, i) => ids.has(ref.id) && payload.order[i] !== i);
        break;
      case "set-scene":
        // Scene settings belong to the scene, not to any layer — recorded in
        // whole-scene mode only.
        keep = false;
        break;
      case "not-replayable":
        keep = true;
        break;
      default: {
        const layer = layerOf(payload);
        // A legacy payload with no layer binding predates whole-scene
        // recording and can only mean "the recorded node".
        keep = layer === undefined || ids.has(layer.id);
      }
    }
    if (keep) kept.push(payload);
  }

  return {
    kept,
    ignored: payloads.length - kept.length,
    scope: { kind: "layers", ids: [...ids] },
  };
}
