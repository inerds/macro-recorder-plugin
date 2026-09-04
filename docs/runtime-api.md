# Creator plugin API — runtime ground truth

This document records what the Creator plugin API really does at runtime. The
published typings (`@lottiefiles/creator-plugin-types` v0.0.2) are wrong in
both directions. **Runtime introspection inside real Creator** established
everything below — own and prototype property enumeration, stamped into traces
— together with live replay verification during 2026-08-21/22. Treat this file
as the authority over the typings. Introspect first when you add a capability;
the record-start debug probe dumps the surfaces into traces.

## Node types (runtime `type` strings)

The runtime `type` strings do not match the typings:

| Runtime | Typings say | Notes |
|---|---|---|
| `SHAPE_LAYER` / `CONTAINER` | Container | layer holding `shapes` |
| `SCENE_LAYER` | `SCENE_INSTANCE` | content in `instance.scene.layers` (shared between instances) |
| `TEXT_LAYER` | *(absent)* | see text section |
| image layers (from drops) | *(absent)* | generic layer surface works |
| `RECTANGLE` `ELLIPSE` `POLYGON` `STAR` `PATH` `GROUP` | ✓ | shape stack members |

## `creator.timeline.currentFrame` — VERIFIED readable from the sandbox

Trace 2026-08-21T21-45-57-555 (rev .36): `playback.begin` with
`atPlayhead: true` returned `frameOffset: 16` with the playhead parked at
frame 16, and the keyframes landed at 16/63 (recorded 0/47). Stagger cascaded
per selected target (+10 each).

## Keyframe spatial tangents — NOT EXPOSED (verified 2026-08-22)

The live position-keyframe proxy surface (trace 2026-08-21T21-53-02-401, rev
.38) is `easing, frame, id, remove, value` — nothing else. The typings'
example that writes `positionKeyframe.inTangent`/`outTangent` does not reflect
the runtime. See `limitations.md`. The engine keeps its defensive read and
write of `KfSnap.inTangent`/`outTangent` so a future host lights it up
automatically.

The same trace also verified `rect.roundness`. It IS a full Animatable
(`addKeyframes, clearKeyframes, getKeyframeAt, getValueAt, isAnimated,
keyframes, staticValue`) despite the `Rectangle` typing omitting it, and no
other rounding-shaped property (`radius`, `cornerRadius`, `corners`,
`modifiers`) exists on the rectangle or its layer. **But it is a dead proxy**:
its `staticValue` is 0 on every rectangle ever seen, rounded or not, and a
corner-radius drag produces no snapshot change (`limitations.md`,
2026-08-23).

## Methods that EXIST but are untyped

These members are live on the runtime surface, and the typings omit them:

- Every node/shape: `toJSON()` (raw Lottie document — how the plugin reads
  fill and stroke opacity `o`), `moveBefore(sib)`, `moveAfter(sib)`,
  `bringToFront()`, `sendToBack()`, `shiftTo(?)`, `getBounds()`,
  `getMatrix()`, `clone()` (inserts copy after self, returns it — verified).
  `shiftTo(?)` exists, but BOTH guessed signatures — `(node)` and `({to})` —
  throw; the real signature is unknown.
  **Caveat (2026-08-26, rev .51 host):** on the live Creator build probed that
  day, `node.toJSON()` AND `scene.toJSON()` returned bare `{id, type}` stubs
  — no shapes, no fills, no document at all (traces 2026-08-26T07-39-25/-52,
  07-40-35, two independent sessions). The raw-document form is NOT
  guaranteed. Every reader of `toJSON()` must treat an id/type stub as a
  normal, empty outcome — which they do. The readers are the per-fill opacity
  recovery in `plugin/serialize.ts#collectPaintOpacities` and the rev .51
  token hunt.
- Every `Animatable`: `clearKeyframes()` (bulk animated→static),
  `getValueAt(frame)`.
- Container: `createTrimPath()`, `trimPaths` list, `createMask`, `createFill`,
  `createStroke` (the specs are plain objects, and the API accepts gradient
  specs).
- Scene: `toJSON()`, `export()`, `createShapeLayer()`, `createSceneLayer()`,
  `createImageLayer()`, `createTextLayer()`, `isNestableScene`.
- Paint lists live at DIFFERENT DEPTHS per layer topology. A flat ellipse
  keeps `fills` at the layer root; a group-based layer keeps them inside
  `shapes[0]` (live: Circle 3 vs Ellipse 1, trace 2026-08-26T03-56-02).
  Pre-existing geometry shape nodes can lack `fills` AND
  `addFill`/`createFill` entirely. Check the capability before removal, and
  resolve a recorded fill path by role (the nearest paint list from the root),
  never verbatim.
- `creator.selection.keyframes` — **live but EMPTY in practice**
  (2026-08-25/26). It is a real own-property array on `creator.selection` (the
  probe surface confirms it), but it reads `array(0)` at every
  `selectionIntrospection` probe, and `selectedCount` stayed 0 on every tick
  across five debug sessions. The getter never reflects the timeline
  selection, so the entry shape is still unknown. Rev .46 also listens for the
  typed `selection:keyframes` event (feature-detected) and reports
  `events: {supported, fired, lastCount}` in the probe. SETTLED 2026-08-26:
  the event DOES fire (`events.fired: 32`, trace 2026-08-26T03-55-48), but its
  payloads are as empty as the getter — `lastCount: 0` throughout. Both typed
  routes exist, and neither carries the timeline selection; the ask is
  upstream. See `limitations.md`.
- Text layer: `text`, `fontFamily`, `fontStyle`, `alignment` (plain strings),
  `fontSize` (plain number), **singular** `fill` / `stroke` paints.
- Scene-instance layer: `break()` (spills content into parent scene — works).

## Methods the typings PROMISE that DO NOT exist

The typings declare these members, and the runtime does not have them:

- `Scene.createSceneInstance(layers)` — **absent**, and no substitute works:
  `createSceneLayer(layers)` → undefined, no-arg creates empty (ignores
  selection), `shiftTo` throws. CONFIRMED limitation (`limitations.md`).
- `container.addFill/removeFill/addStroke/removeStroke/addMask/removeMask` —
  **absent**. Create via `createFill`/`createStroke`/`createMask`; remove via
  the OBJECT's own `.remove()` (paints, strokes, masks, trims, keyframes,
  nodes all have it).
- `MoveOptions`/`move()` — unused type; the real reorder methods are in the
  previous section.

## Behavioral quirks (all live-verified, all handled in the engine)

Other documents cite these items by number, so keep the numbering stable:

1. **Keyframe ids are not identity.** Creator reassigns `kf.id` on a value
   edit and recycles ids from a pool. Diff and apply strictly by frame.
2. **Creator silently ignores `addKeyframes` at frame 0 on a not-yet-animated
   property** (it may write `staticValue` instead). The engine verifies the
   add, seeds a sentinel at frame+1, retries, then removes the sentinel.
3. **`getKeyframeAt(0)` can return a truthy phantom** on a keyframe-less
   property. The engine never consults it when `keyframes.length === 0`.
4. **The host discards `staticValue` writes while keyframes EXIST** — not
   while `isAnimated` is true, because that flag can stay true with zero
   keyframes. Guard on `keyframes.length > 0`.
5. **`PathData` and its points are getter-based.** The fields are invisible to
   `Object.keys` and to the generic `toJson`, so read them structurally:
   `closed`, and the per-point `vertex`/`inTan`/`outTan` vectors.
6. **Per-fill opacity is unreachable** through paint proxies, which expose
   only `color`/`type`/`remove`; colors are RGB, with no alpha. The document
   `o` exists in `toJSON()` and recording recovers it; there is no write path.
7. **Duplicate detection must ignore the layer's own transform.** Creator
   offsets ⌘D copies, and the copies inherit live rotation.
8. **`createSceneLayer()` creates an EMPTY scene layer** and does not consume
   the selection.
9. Fill and stroke on text layers are **singular objects**, not lists — the
   engine models them as one-item lists.
10. Host events: only `selection:nodes`/`selection:keyframes`/`message`. No
    change events exist, so polling plus diff is the only recording mechanism.
    One exception is under probe: the ui-library docs document
    `creator.ui.theme` and a `change:theme` event (ThemeProvider sync).
    `plugin/theme.ts` implements that relay fully feature-detected — NEVER
    live-verified, because our introspection predates the probe. If a trace
    shows the frame matching Creator's theme, the event exists; move this note
    accordingly.
