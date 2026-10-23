# Creator plugin API — runtime ground truth

This document records what the Creator plugin API really does at runtime. The
published typings are `@lottiefiles/creator-api-types` 1.2.0. Version 1.0.1
fixed most of the omissions and dropped the members that never existed; 1.1.0
(2026-09-10) added null layers and `transformParent`; 1.2.0 (2026-10-08) added
audio layers, `TransformableLayer`, and the per-type `Scene.import` overloads.
Each member appears once below, under the one status that describes it:
verified live, typed but not verified yet, live but untyped, or absent from
the host altogether. **Runtime introspection inside real Creator** established the
findings — own and prototype property enumeration, stamped into traces —
together with live replay verification during 2026-08-21/22. Treat this file
as the authority over the typings. Introspect first when you add a
capability; the record-start debug probe dumps the surfaces into traces.

## Node types (runtime `type` strings)

The runtime `type` strings and 1.2.0 agree on every kind a trace has shown.
The two kinds 1.1.0 and 1.2.0 added are typed and not yet seen live:

| Runtime | 1.2.0 says | Notes |
|---|---|---|
| `SHAPE_LAYER` / `CONTAINER` | `SHAPE_LAYER` | layer holding `shapes` |
| `SCENE_LAYER` | `SCENE_LAYER` | content in `instance.scene.layers` (shared between instances) |
| `TEXT_LAYER` | `TEXT_LAYER` | see text section |
| image layers (from drops) | `IMAGE_LAYER` | generic layer surface works |
| not yet seen live | `NULL_LAYER` | 1.1.0 `NullLayer`: `LayerMixin` plus a read-only `layers` list |
| not yet seen live | `AUDIO_LAYER` | 1.2.0 `AudioLayer`: `BaseLayerMixin` plus `muted`, `volume`, `audio`; no transform |
| `RECTANGLE` `ELLIPSE` `POLYGON` `STAR` `PATH` `GROUP` | ✓ | shape stack members |


History: 0.0.2 said `Container` for a shape layer and `SCENE_INSTANCE` for a
scene layer, and it named no text or image layer type. 1.2.0 also declares
`AudioLayer`, which has no transform; the engine never reads one.

## `creator.timeline.currentFrame` — VERIFIED readable from the sandbox

Trace 2026-08-21T21-45-57-555 (rev .36): `playback.begin` with
`atPlayhead: true` returned `frameOffset: 16` with the playhead parked at
frame 16, and the keyframes landed at 16/63 (recorded 0/47). Stagger cascaded
per selected target (+10 each).

## Layer timing — `startFrame`, `endFrame`, `timelineOffset`

All three are mutable plain properties on `BaseLayerMixin` (1.2.0; 1.0.1 had
them on `LayerMixin`), so every layer kind carries them, the audio layer
included. The recorder reads them every tick (`engine/snapshot.ts` `PLAIN_PROPS`): readable live in
136 record traces; writes pending one live trace at rev `2026-09-04.1`. The
traced `timelineOffset` values include negatives, so its sign convention is
unverified.

1.0.1 also types `shiftTo(frame: number)` (on `BaseLayerMixin` in 1.2.0). It shifts the
layer's timeline window — a TIME shift, not a move in the layer stack. This
plugin never calls it live. The engine's earlier guessed calls —
`shiftTo(node)` and `shiftTo({to})` — threw, because neither argument is a
number. Both are gone: a coercible argument would have retimed the user's
layer instead of throwing.

`delayLayer` (`sandbox/applier.ts`) is the only writer. It moves `startFrame`
and `timelineOffset` by the same delta, reads both back, and reports a kept
value as a note. It never writes `endFrame`, and it notes an `endFrame` the
host moves on its own — that read is the evidence for the pending live check.

## Keyframe spatial tangents — NOT EXPOSED (verified 2026-08-22)

The live position-keyframe proxy surface (trace 2026-08-21T21-53-02-401, rev
.38) is `easing, frame, id, remove, value` — nothing else. The doc example in
0.0.2 that writes `positionKeyframe.inTangent`/`outTangent` does not reflect
the runtime, and 1.2.0's `Keyframe<T>` still has no tangent fields. See
`limitations.md`. The engine keeps its defensive read and write of
`KfSnap.inTangent`/`outTangent` so a future host lights it up automatically.

The same trace also verified `rect.roundness`. It IS a full Animatable
(`addKeyframes, clearKeyframes, getKeyframeAt, getValueAt, isAnimated,
keyframes, staticValue`), and no other rounding-shaped property (`radius`,
`cornerRadius`, `corners`, `modifiers`) exists on the rectangle or its layer.
1.0.1 types `Rectangle.roundness` as `Animatable<number>`, 1.2.0 keeps it so,
and that matches the live proxy. **But it is a dead proxy**: its `staticValue` is 0 on every
rectangle ever seen, rounded or not, and a corner-radius drag produces no
snapshot change (`limitations.md`, 2026-08-23).

## Typed since 1.0.1, live-verified

The typings have declared these members since 1.0.1, and runtime introspection
confirms each one:

- Every node/shape: `moveBefore(sib)`, `moveAfter(sib)`, `bringToFront()`,
  `sendToBack()`, `getMatrix()`, `clone()` (inserts copy after self, returns
  it — verified). 1.2.0 spreads them over three interfaces: the four reorder
  calls on `BaseLayerMixin` AND `ShapeMixin`, `clone()` on `BaseNodeMixin`,
  and `getMatrix(frame?)` on `TransformMixin`, which only transformable
  layers and groups extend.
- Every `Animatable`: `clearKeyframes()` (bulk animated→static),
  `getValueAt(frame)`.
- `node.data` (`PluginData`) — this plugin's OWN per-node storage:
  `get`/`set`/`delete`/`clear`, plus a `usedQuota` number. Live, and inert:
  the rev .51 token hunt read it on every touched node and found
  `usedQuota: 0` with null reads. It is storage, not a document surface, so
  no host value is ever readable through it (`limitations.md`).
- Shape container (a shape layer or a group): `createTrimPath()`, `trimPaths`
  list, `createMask`, `createFill`, `createStroke` (the specs are plain
  objects, and the API accepts gradient specs). 1.0.1 calls the interface
  `ShapeContainerMixin`; 0.0.2 called it `Container`.
- Scene: `createShapeLayer()`, `createSceneLayer()`, `createImageLayer()`,
  `createTextLayer()`, `isNestableScene`.
- Text layer: `text`, `fontFamily`, `fontStyle`, `alignment` (plain strings),
  `fontSize` (plain number), **singular** `fill` / `stroke` paints.
- Scene layer: `break()` (spills content into the parent scene — works).
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

## Typed since 1.0.1, live verification pending

The typings have declared these members since 1.0.1, the engine calls them,
and no trace confirms one yet. Every call stays feature-detected, and each one
has a fallback:

- `creator.utils.isLayer(node)`, and its sibling `isShape(node)`, on
  `UtilsAPI`. `sandbox/playback.ts#isLayerNode` asks `isLayer` second, after
  1.2.0's `isTransformableLayer` (next section), and only when it answers
  with a boolean. The last fallback reads `startFrame`, a `BaseLayerMixin`
  member that no shape carries.
- `Scene` settings writes: `name`, `size` (a `Size` — `{width, height}`),
  `backgroundColor` (`Color | null`, where `null` is a transparent scene),
  `framerate`, and `duration`. All five are plain mutable members.
  `sandbox/playback.ts#applySceneSetting` writes one per `set-scene` step and
  reads it back. It notes a value Creator keeps unchanged.
- `Animatable.getValueAt(frame)` as a playback baseline. The member is
  live-verified (see the list above); this use of it is not.
  `sandbox/applier.ts#readBaseline` reads the value at
  `creator.timeline.currentFrame` when the property has keyframes, because a
  keyframed property's `staticValue` is a stale leftover. It falls back to
  `staticValue`.
- `ShapeContainerMixin.createGroup(opts?: GroupOptions)` — an object with a
  `shapes` array, not a bare array. `sandbox/applier.ts` called
  `createGroup(created)`, which left `opts.shapes` undefined and built an
  EMPTY group on the real host. It calls `createGroup({ shapes: created })`
  since rev `2026-09-06.2`.
- `SceneLayer.scene` and its layer factories — `createShapeLayer`,
  `createTextLayer`, and `createSceneLayer`. `sandbox/playback.ts#nestByRebuild`
  builds each copy of a nested layer with them (route 1). The shell's
  `scene.layers` IS live-verified: traces
  `2026-09-06T17-13-19-190_playback-Macro-5.json` and
  `2026-09-06T17-13-38-332_playback-Macro-5.json` read it as an empty array
  (`content=0`). The factories on it are not verified. The fallback is route 2
  below; with neither route the step notes a skip and leaves the layers alone.
- `creator.createScene(opts)` and `Scene.createSceneLayer({ scene })` — route 2
  of the same function. It copies `name`, `size`, `framerate`, and `duration`
  from the active scene, omits every undefined key, and then requires the
  shell to reference the scene it passed. The fallback removes both the scene
  and the shell, and the step notes a skip.
- `Scene.isNestableScene` — read on the scene route 2 creates.
  `nestByRebuild` accepts any value except `false`, so a host that omits the
  member takes the route.
- `Scene.remove()` — the cleanup path of route 2. `nestByRebuild` calls it on
  a scene it created and could not attach. A throw is a `[nest] …` breadcrumb
  alone: the step reports its skip either way.
- `creator.clientStorage.usedQuota()` — typed as a METHOD returning
  `Promise<number>`. `sandbox/store.ts` accepts either the method or a
  number-valued property, caches the last reading, and reports it in the
  `hello` result. The host exposes the bytes USED and no maximum, so a
  plugin cannot measure the cap: `saveMacro` blames a full store only when
  the host's own message names the quota.

## Typed in 1.2.0, live verification pending

Versions 1.1.0 and 1.2.0 added these members. No trace has shown any of them.
The engine feature-detects each one it calls and has a fallback for it; a
member the engine does not call is listed so that a later feature starts from
the typed shape. Since rev `2026-10-23.2` the `record.start` debug probe
reports `parentingIntrospection` — whether `transformParent` is on the first
layer, by the `in` operator and by the own-and-prototype surface, whether the
scene has `createNullLayer`, and whether `utils.isTransformableLayer` exists —
so the first debug recording on a real host answers for the parenting members
at once:

- `creator.utils.isTransformableLayer(node)` on `UtilsAPI`: `true` for a
  `TransformableLayer`, which is every layer kind but `AudioLayer`.
  `sandbox/playback.ts#isLayerNode` asks it FIRST, then `isLayer`, then the
  `startFrame` fallback, and takes an answer only when it is a boolean. A
  selected audio layer therefore leaves the target list, with the note "1
  selected audio layer skipped — macros replay onto layers with a transform".
  The `startFrame` fallback cannot tell an audio layer from a shape layer,
  because `BaseLayerMixin` gives both a timeline window; a host that has
  audio layers also has the guard.
- `Scene.createNullLayer(opts?)`, from 1.1.0. `NullLayerCreateOptions` adds a
  `layers` list to `LayerCreateOptions`.
  `sandbox/applier.ts#createNullLayerFrom` calls it with `{ name, position,
  layers }` for an `add-controller` step (rev `2026-10-23.2`) and with no
  layers for an `add-layer` step whose spec is a `NULL_LAYER`, then verifies
  through `nullLayer.layers`. A host that ignores the `layers` option gets
  one `transformParent` write per layer; a host that rejects the option is
  retried without it, with an info note; a host without the factory skips
  with "this scene can't create null layers — skipped". It never falls back
  to `createShapeLayer`: a shape layer renders, a null layer does not.
- `NullLayer` (type `NULL_LAYER`): `LayerMixin` plus a read-only `layers`
  list, the layers whose transform parent it is. The recorder reads its
  transform through `TYPE_PROPS.NULL_LAYER` and does not read `layers`: a
  parent is recorded from each child's `transformParent`, and `layers` is
  the replay's witness that `createNullLayer` linked what it was given.
- `LayerMixin.transformParent`, readable and writable, typed
  `TransformableLayer | undefined`, from 1.1.0. Reading a transform parent
  from `parent` is deprecated since 1.1.0 (removal eligible after 2027-03-05);
  reading the containing `Scene` from `parent` stays, and the engine never
  read a parent from it. Since rev `2026-10-23.2`
  `sandbox/serialize.ts#readTransformParent` reads the member as a
  `{id, name}` identity on every top-level layer, and tells "no parent" from
  "member absent" with the `in` operator, because `undefined` is a legitimate
  value of the member; `sandbox/applier.ts#writeTransformParent` writes it for
  a `set-parent` step and reads it back. A kept value notes "Creator kept the
  parent as it was — the change didn't apply", an absent member notes
  "Creator doesn't expose transform parents here — skipped", and the debug
  probe of a `set-parent` step reports the target's parent identity as
  `parent`.
- `AudioLayer` (type `AUDIO_LAYER`): `BaseLayerMixin` plus `AudibleMixin`
  (`muted: boolean`, `volume: Animatable<number>`, 0 to 100) and a read-only
  `audio: AudioAsset`. It has NO transform: no `position`, `opacity`,
  `blendMode`, `matte`, or `masks`. `TYPE_PROPS.AUDIO_LAYER` is `["volume"]`
  and `PLAIN_PROPS` carries `muted`, so a volume or mute edit records through
  the ordinary channels, and an idle audio layer records nothing. No factory
  creates one — an audio layer arrives through `Scene.import` alone — so an
  `add-layer` step for one skips with "can't re-create an audio layer — the
  recording has no audio asset — skipped", and `nestByRebuild` holds an audio
  source back the way it holds an image source.
- `AudioAsset` (type `AUDIO`): `uri` (a `data:` URI or a URL, `null` while
  the data is unavailable), `getDuration(): Promise<number | null>`, and
  `remove()`, which removes every audio layer that plays it. `creator.assets`
  includes audio assets, and `change:audio` joins the typed events. The
  engine touches none of them.
- `BaseLayerMixin`: the members every layer has — `parent`, `locked`,
  `startFrame`, `endFrame`, `timelineOffset`, `shiftTo`, and the four reorder
  calls. `LayerMixin` extends it with `TransformMixin`, `visible`, `focused`,
  `transformParent`, `opacity`, `blendMode`, `isMatte`, `matte`, and masks.
  `TransformableLayer` is `Extract<Layer, TransformMixin>`.
- `Scene.import` overloads: `{ type: 'LOTTIE' | 'SVG' }` from content or a URL
  returns a `SceneLayer`; `{ type: 'IMAGE' }` from a URL ONLY returns an
  `ImageLayer`; `{ type: 'AUDIO' }` from base64 content or a URL returns an
  `AudioLayer`; a call typed at runtime returns the union. Every form returns
  a Promise, which an RPC answer in the no-job-pump sandbox cannot await
  (`architecture.md`). The engine does not call it.

## Still untyped in 1.2.0

These members are live on the runtime surface, and 1.2.0 omits them:

- Every node/shape: `toJSON()` (raw Lottie document — how the plugin reads
  fill and stroke opacity `o`) and `getBounds()`. Scene: `toJSON()` and
  `export()`.
  **Caveat (2026-08-26, rev .51 host):** on the live Creator build probed that
  day, `node.toJSON()` AND `scene.toJSON()` returned bare `{id, type}` stubs
  — no shapes, no fills, no document at all (traces 2026-08-26T07-39-25/-52,
  07-40-35, two independent sessions). The raw-document form is NOT
  guaranteed. Every reader of `toJSON()` must treat an id/type stub as a
  normal, empty outcome — which they do. The readers are the per-fill opacity
  recovery in `sandbox/serialize.ts#collectPaintOpacities` and the rev .51
  token hunt.
- Paint lists live at DIFFERENT DEPTHS per layer topology. A flat ellipse
  keeps `fills` at the layer root; a group-based layer keeps them inside
  `shapes[0]` (live: Circle 3 vs Ellipse 1, trace 2026-08-26T03-56-02).
  Pre-existing geometry shape nodes can lack `fills` AND `createFill`
  entirely. Check the capability before removal, and resolve a recorded fill
  path by role (the nearest paint list from the root), never verbatim.

## Absent from the runtime

Nothing below exists on the live host. Do not spend a call on any of it.

0.0.2 declared these members, the runtime never had them, and 1.0.1 and later
no longer declare them:

- `Scene.createSceneInstance(layers)` — **absent** from the runtime, and no
  substitute works: `createSceneLayer(layers)` → undefined, and the no-arg
  call creates an empty scene layer (it ignores the selection). CONFIRMED
  limitation (`limitations.md`).
- `container.addFill/removeFill/addStroke/removeStroke/addMask/removeMask` —
  **absent**. Create via `createFill`/`createStroke`/`createMask`; remove via
  the OBJECT's own `.remove()` (paints, strokes, masks, trims, keyframes,
  nodes all have it), which is how 1.0.1 and later type removal.
- `MoveOptions`/`move()` — gone; the real reorder methods are in the typed
  section above.

1.0.1 also drops the names `Container`, `SceneInstance`, `PluginAPI`, and
`PluginEvent*`.

These members no version ever declared, and the runtime does not have them
either (checked against 1.0.1 on 2026-09-06, and against 1.2.0 on 2026-10-23):

- Per-paint opacity, on both the read side and the create side. 1.2.0 types
  `SolidPaint` as `{type, color, remove}` and `GradientPaint` as
  `{start, end, stops, remove}`; `opacity` appears only on `ColorStops`
  entries, `Mask`, `LayerMixin`, and `Group`, and `PaintOptions` has no such
  key. `sandbox/applier.ts#paintSpec` does not emit it: an unknown key makes
  the host reject the whole `createFill` with `✗ Invalid input`, so the key
  lost the fill as well as the opacity. See `limitations.md`.
- `TrimPath.mode`. A 1.2.0 trim path is `start`, `end`, `offset`, and
  `remove`, and nothing else. `sandbox/serialize.ts` reads `mode` defensively
  and omits it when it is absent, so a host that adds the member starts
  recording it with no change here. The member is NEVER live-verified.
- Keyframe spatial tangents, effects, and ungroup. See the tangent section
  above, and `limitations.md` for the other two.

**Still wrong in 1.2.0:** `UIAPI.onMessage(pluginMessage: unknown): void`
declares a member that RECEIVES a message, but the runtime takes a callback.
`sandbox/plugin.ts` passes a function, and it compiles only because a function
is assignable to `unknown`.

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
   `o` exists in `toJSON()` and recording tries to recover it from there — on
   a host that returns the `{id, type}` stub (see the caveat above) it finds
   nothing. There is no write path either way.
7. **Duplicate detection must ignore the layer's own transform.** Creator
   offsets ⌘D copies, and the copies inherit live rotation.
8. **`createSceneLayer()` creates an EMPTY scene layer** and does not consume
   the selection. Since rev `2026-09-07.1` the engine rebuilds the selected
   layers inside the shell's own scene, and then removes the originals.
9. Fill and stroke on text layers are **singular objects**, not lists — the
   engine models them as one-item lists.
10. Host events: our introspection found only
    `selection:nodes`/`selection:keyframes`/`message`. 1.2.0 types those three
    plus `change:theme`, `change:scenes`, `change:images`, `change:fonts`,
    and `change:audio`. No node-change event exists, so polling plus diff is
    the only recording mechanism. `change:scenes`, `change:images`,
    `change:fonts`, and `change:audio` (1.2.0) are typed and not verified
    live. The theme route is under probe: the typings declare
    `creator.ui.theme` and the `change:theme` event, and the ui-library
    docs document the same pair (ThemeProvider sync). A `ThemeTokens` carries
    `tokens`, `themeName`, and `isLight`, and `sandbox/theme.ts` forwards all
    three to the panel. It implements that relay fully feature-detected —
    NEVER live-verified, because our introspection predates the probe. If a
    trace shows the frame matching Creator's theme, the event exists; move
    this note accordingly.
