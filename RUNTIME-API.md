# Creator plugin API — runtime ground truth

The published typings (`@lottiefiles/creator-plugin-types` v0.0.2) are wrong
in both directions. Everything below was established by **runtime
introspection inside real Creator** (own+prototype property enumeration,
stamped into traces) and by live replay verification during 2026-08-21/22.
Treat this file as the authority over the typings; when adding capability,
introspect first (the record-start debug probe dumps surfaces into traces).

## Node types (runtime `type` strings)

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
frame 16, and the keyframes landed at 16/63 (recorded 0/47). Stagger
cascaded per selected target (+10 each).

## Keyframe spatial tangents — NOT EXPOSED (verified 2026-08-22)

Live position-keyframe proxy surface (trace 2026-08-21T21-53-02-401, rev
.38): `easing, frame, id, remove, value` — nothing else. The typings' example
writing `positionKeyframe.inTangent/outTangent` does not reflect the runtime.
See LIMITATIONS.md. The engine's defensive read/write of `KfSnap.inTangent/
outTangent` stays so a future host lights it up automatically.

Also verified there: `rect.roundness` IS a full Animatable (`addKeyframes,
clearKeyframes, getKeyframeAt, getValueAt, isAnimated, keyframes,
staticValue`) despite the `Rectangle` typing omitting it; no other
rounding-shaped property (`radius`, `cornerRadius`, `corners`, `modifiers`)
exists on the rectangle or its layer. **But it is a dead proxy**: its
`staticValue` is 0 on every rectangle ever seen, rounded or not, and a
corner-radius drag produces no snapshot change (LIMITATIONS.md, 2026-08-23).

## Methods that EXIST but are untyped

- Every node/shape: `toJSON()` (raw Lottie document — how fill/stroke opacity
  `o` is read), `moveBefore(sib)`, `moveAfter(sib)`, `bringToFront()`,
  `sendToBack()`, `shiftTo(?)` (exists, but BOTH guessed signatures — `(node)` and `({to})` — throw; real signature unknown), `getBounds()`,
  `getMatrix()`, `clone()` (inserts copy after self, returns it — verified).
- Every `Animatable`: `clearKeyframes()` (bulk animated→static),
  `getValueAt(frame)`.
- Container: `createTrimPath()`, `trimPaths` list, `createMask`, `createFill`,
  `createStroke` (specs are plain objects, gradient specs accepted).
- Scene: `toJSON()`, `export()`, `createShapeLayer()`, `createSceneLayer()`,
  `createImageLayer()`, `createTextLayer()`, `isNestableScene`.
- Text layer: `text`, `fontFamily`, `fontStyle`, `alignment` (plain strings),
  `fontSize` (plain number), **singular** `fill` / `stroke` paints.
- Scene-instance layer: `break()` (spills content into parent scene — works).

## Methods the typings PROMISE that DON'T exist

- `Scene.createSceneInstance(layers)` — **absent**, and no substitute works:
  `createSceneLayer(layers)` → undefined, no-arg creates empty (ignores
  selection), `shiftTo` throws. CONFIRMED limitation (LIMITATIONS.md).
- `container.addFill/removeFill/addStroke/removeStroke/addMask/removeMask` —
  **absent**. Create via `createFill`/`createStroke`/`createMask`; remove via
  the OBJECT's own `.remove()` (paints, strokes, masks, trims, keyframes,
  nodes all have it).
- `MoveOptions`/`move()` — unused type; the real reorder methods are above.

## Behavioural quirks (all live-verified, all handled in the engine)

1. **Keyframe ids are not identity**: Creator reassigns `kf.id` on value edit
   and recycles ids from a pool. Diff/apply strictly by frame.
2. **`addKeyframes` at frame 0 on a not-yet-animated property is silently
   ignored** (may write staticValue instead). Engine: verified adds + sentinel
   seed at frame+1, retry, remove sentinel.
3. **`getKeyframeAt(0)` can return a truthy phantom** on a keyframe-less
   property. Engine: never consult it when `keyframes.length === 0`.
4. **`staticValue` writes are discarded while keyframes EXIST** (not while
   `isAnimated` — that flag can stay true with zero keyframes). Guard on
   `keyframes.length > 0`.
5. **`PathData` and its points are getter-based**: fields invisible to
   `Object.keys`/generic toJson → read structurally (`closed`, per-point
   `vertex/inTan/outTan` vectors).
6. **Per-fill opacity is unreachable** through paint proxies (only
   `color`/`type`/`remove`; colors are RGB, no alpha). Document `o` exists in
   `toJSON()` (recording recovers it); no write path.
7. **Duplicate detection must ignore the layer's own transform** — Creator
   offsets ⌘D copies (and copies inherit live rotation).
8. **`createSceneLayer()` creates an EMPTY scene layer** and does not consume
   the selection.
9. Fill/stroke on text layers are **singular objects**, not lists — the
   engine models them as one-item lists.
10. Host events: only `selection:nodes`/`selection:keyframes`/`message`. No
    change events → polling + diff is the only recording mechanism.
