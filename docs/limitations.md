# Known limitations

This document lists the platform limits and the design limits that the Macro
Recorder has found, with the evidence that established each one. Add an entry
when you confirm a new limit. Move an entry to `history/improvements.md` if an API
change or a workaround ever lifts it.

**Convention:** each entry states what does not work, why (with evidence), what
the user sees instead, and any path that could lift it.

---

## Selected keyframes (`creator.selection.keyframes`) — empty in practice

**What does not work:** the capture offer's "Add selected keyframes", which
pulls only the keyframes that the user selected on the timeline into a
recording.

**Why (evidence):** 1.0.1 types the surface (`SelectionAPI.keyframes` and the
event `selection:keyframes`), and the surface IS live —
`introspectSelection` probes show a real own-property array, with no throw.
But it read `array(0)` at every probe, and `selectedCount` stayed 0 on every
tick across five debug sessions at revs .42/.43/.44 (traces
2026-08-24T17-50-25 / 18-18-05, 2026-08-25T03-47-55 / 03-49-39 / 05-27-04).
One of them, the "Pink Flower" session, held a layer under offer that carried
21 keyframes of its own. The polled getter never reflects the timeline
selection in this host build.

**What the user sees:** "Add selected keyframes (0)", off, with the reason
"Creator hasn't reported any selected keyframes to plugins" in its tooltip and
for a screen reader. "Add all keyframes" is unaffected and fully
live-verified.

**Path to lift:** rev .46 subscribes to the typed `selection:keyframes` event
(feature-detected) and feeds the capture offer from the latest event payload
when the getter polls empty. Verdict (trace 2026-08-26T03-55-48): the event
FIRES (`events: {supported: true, fired: 32}` — and `fired: 311` across a
longer session, trace 2026-08-26T06-03-22) but always with empty payloads
(`lastCount: 0`). Both typed routes exist, and neither carries the timeline
selection. Conclusive: the ask is upstream, for Creator to populate either
surface. The moment it does, "Add selected keyframes" starts to work with no
plugin changes.

---

## Motion-token (color token/slot) bindings — record captures only the resolved color

**What does not work:** the recorder captures a color *token* applied to a
fill as a plain resolved-RGB color edit, and replay applies that flat color to
the target. The plugin neither records nor re-applies the token binding (the
slot reference).

**Why (evidence, 2026-08-26, rev .50 traces):**
- The recorded step is already resolved at capture time. Trace
  `2026-08-26T07-26-32-741_record.json` shows the token application arriving
  as `set-static ["fills",0,"color"] {r:255,g:102,b:153} → {r:75,g:112,b:235}`
  — nothing token-shaped anywhere in the payload or the snapshots.
- The same trace's `record.start` introspection walked the full prototype
  chain (5 levels) of the touched Paint proxy, its `Animatable<Color>`, the
  layer node, and the scene. No `token`, `slot`, `variable`, `binding`,
  `alias`, `swatch`, or `sid`-shaped key exists on any of them.
  `colorStaticKeys` is exactly `["b","g","r"]`. A whole-trace grep for those
  terms returned zero hits.
- Replay is value-faithful and is not the culprit. Trace
  `2026-08-26T07-26-42-276_playback-Macro-43.json` shows the recorded RGB
  applied exactly (probe before ≠ after, `failures: []`, `notes: []`).
- Applying the token *before* you press Record records nothing at all. Trace
  `2026-08-26T07-26-13-866_record.json` shows every tick empty, and the fill
  already probed at the resolved value in `record.start`. This is consistent
  with a resolved-color-only surface.

**What the user sees:** the macro replays the token's color value as a plain
fill, and the target does not become bound to the token.

**Verdict (2026-08-26, rev .51 — CONCLUSIVE):** the rev .51 `record.start`
probe dumped the three routes never read before, across two independent token
sessions (traces `2026-08-26T07-39-25` / `07-39-52` / `07-40-35`), and all
came back empty:
- `node.data` / `shape.data` is the plugin's own per-node storage — an inert,
  empty quota map (`usedQuota: 0`, `get`/`set` null), not a document surface;
- `node.toJSON()` and `activeScene.toJSON()` return bare `{id, type}` stubs on
  this host — there is no raw-document route to carry an `sid` or a `slots`
  map (see the `toJSON()` caveat in `runtime-api.md`);
- the scene JSON root has no `slots`, `tokens`, `themes`, `styles`, or `vars`
  key, and a whole-trace search for token vocabulary is zero-hit in every
  session.

A token-driven fill edit is therefore indistinguishable at every readable
layer from a manual RGB edit: 07-40-35 captured one as a normal resolved
`set-static`, and 07-39-52 showed that re-applying a token whose color already
matched produces zero observable change at all.

**Path to lift:** entirely upstream. Creator must expose both a readable
binding (an `sid` on the paint surface or a document route) and a write path
before apply-by-reference could work — `paint.color` accepts only `{r,g,b}`
today. The rev .51 hunt stays in the debug probe, so a host that adds any of
it shows up in the next trace without code changes.

---

## Fill / stroke opacity (per-paint) — cannot record or replay

**What does not work:** a fill's own opacity slider (Appearance panel, under
the color — distinct from Layer opacity) is invisible to the plugin.
Recordings capture nothing, and no API sets the value on a target.

**Why (evidence, 2026-08-22):**
- The Lottie document *does* model it: `o` is a separate animatable scalar
  (100 = opaque) on every fill (`ty:"fl"`) and stroke (`ty:"st"`) shape, next
  to the RGB color `c` ([Lottie spec — Shapes](https://lottiefiles.github.io/lottie-spec/specs/shapes/)).
- Creator's plugin proxy for a paint exposes exactly `color`, `type`, and
  `remove`. Runtime introspection across the full prototype chain verified
  this (trace `2026-08-21T19-09-59-458_record.json`). Probes for `opacity`,
  `alpha`, `fillOpacity`, `transparency`, and `a` all return undefined. Color
  values are strictly `{r,g,b}` — no alpha channel.
- A drag of the fill-opacity slider during a recording produced **10/10 empty
  polling ticks** — zero observable change through the API.
- The typings agree with the proxy. 1.0.1 types `SolidPaint` as
  `{type, color, remove}` and `GradientPaint` as
  `{start, end, stops, remove}`. `opacity` appears only on `ColorStops`
  entries, `Mask`, `LayerMixin`, and `Group`, so the limit stands.
- 1.0.1's `PaintOptions` has no `opacity` either, so the create side is shut
  as well. `sandbox/applier.ts#paintSpec` no longer puts the key in a
  `createFill` spec (rev `2026-09-06.2`): an unknown key makes the host
  reject the whole create with `✗ Invalid input`, so the key lost the fill as
  well as the opacity.
- The user confirmed that it still does not work on engine rev 2026-08-22.12.

**What the user sees:** the recorder captures nothing for the edit, and no
step appears. Layer-level opacity (the one in the Layer section) records and
replays correctly, and it is the practical substitute.

**Path to lift:**
- A speculative document-level capture is in place. The untyped `node.toJSON()`
  is where the raw document `o` would live, and the serializer recovers fill
  and stroke opacities from it, matched by document order. On the host probed
  on 2026-08-26 it recovers nothing: `toJSON()` returns an `{id, type}` stub
  there (see the caveat in `runtime-api.md`). If a future trace shows
  fill-opacity steps being recorded, the capture side works. Replay stays
  limited to honest skip-notes, because no API sets paint opacity on a
  target.
- The clean fix is upstream: LottieFiles must expose `opacity` on the `Paint`
  plugin interface. The document already has the property, so this is purely a
  membrane gap. Worth filing.

---

## Rectangle corner roundness — CONFIRMED (dead proxy)

**What does not work:** a change to a rectangle's corner radius in Creator's
UI is invisible to the plugin. Recordings capture nothing, and the plugin
cannot read the value back to replay it.

**Why (evidence, 2026-08-22/23, engine rev 2026-08-22.39):**
- 1.0.1 types `Rectangle.roundness` as `Animatable<number>`, and the live
  proxy matches it. The typings are not the problem: the value itself is
  dead.
- Runtime introspection (trace `2026-08-21T21-53-02-401_record.json`,
  `shapeIntrospection`) shows that the live rectangle proxy DOES expose
  `roundness` as a full Animatable (`addKeyframes, clearKeyframes,
  getKeyframeAt, getValueAt, isAnimated, keyframes, staticValue`). But
  `staticValue` reads `0` on every rectangle in every one of 140+ traces,
  including rectangles that visibly have rounded corners. No other
  rounding-shaped property (`radius`, `cornerRadius`, `corners`, `modifiers`,
  `effects`) exists on the shape or its layer.
- Trace `2026-08-22T17-50-45-658_record.json`: an 8-second recording on a
  scene of three rectangles produced **16 empty polling ticks** — zero
  observable change through the API — while the user reported editing
  roundness. (Assumption to re-check: that this session was the roundness
  drag. Every other reported edit type has produced steps in the same setup.)

**What the user sees:** a drag of the corner radius during a recording adds no
step, and a macro cannot round corners on replay. The engine keeps `roundness`
in the RECTANGLE registry (`engine/snapshot.ts`), so a host that starts to
report it records automatically.

**Path to lift:** the host wires the rectangle's corner radius to the exposed
`roundness` Animatable, or exposes whichever property it really lives in. The
registry entry and the `shapeIntrospection` debug probe already exist to
confirm it the day it changes.

---

## Motion-path bezier handles (spatial tangents) — CONFIRMED

**What does not work:** a bend of a position keyframe's motion path on the
canvas (the curve handles between two position keyframes) is invisible to the
plugin. Recordings capture the keyframes' frames, values, and easing, but not
the curve, and replays produce straight-line motion between them.

**Why (evidence, 2026-08-22, engine rev 2026-08-22.38):**
- 1.0.1's `Keyframe<T>` interface has `id`, `frame`, `value`, `easing`, and
  `remove` — no tangent fields. `inTan` and `outTan` exist in 1.0.1 only on
  `PathPoint`, which is path geometry, not motion.
- Runtime introspection of a live **position** keyframe proxy across the full
  prototype chain (trace `2026-08-21T21-53-02-401_record.json`,
  `debug.keyframeIntrospection` on the first keyframe tick) found exactly
  `easing, frame, id, remove, value`. Probes for `inTangent`, `outTangent`,
  `spatial`, and `tangents` all return undefined.
- The Lottie document models them (`i` and `o` arrays on position keyframes,
  per the spec) — this is a proxy gap, not a format gap.

**What the user sees:** a recording of a curved motion replays as linear
motion between the same keyframes. No step and no note mentions the curve,
because there is nothing observable to report on.

**Path to lift:** the host exposes `inTangent` and `outTangent` on keyframe
proxies. The engine already reads and writes them defensively:
`sandbox/serialize.ts` records `KfSnap.inTangent`/`outTangent` when they
exist, and `sandbox/applier.ts#writeTangents` writes each handle, reads it
back, and turns every refusal into its own note ("motion-path handle
(`inTangent`) @ 12 not supported by Creator"). A host that adds the members
starts to record and replay curves with no code change.

---

## Nesting layers programmatically — CONFIRMED

**Lifted in part (2026-09-07, rev `2026-09-07.1`).** Replay now rebuilds the
layers inside the new scene, so the user-facing half of this limit is gone.
`nestByRebuild` (`sandbox/playback.ts`) serializes each source with
`serializeNode`, then builds a copy of each snapshot inside the shell's own
scene. Route 1 uses the shell's own factories —
`shell.scene.createShapeLayer`, `createTextLayer`, and `createSceneLayer`.
Route 2 runs only when route 1 is absent: it creates the scene first with
`creator.createScene({ name, size, framerate, duration })`, then places it
with `scene.createSceneLayer({ scene })`. `createLayerFromSpec` recurses into
layer-typed children, so the 2026-08-26 sub-finding no longer holds: that
replay (rev .52, traces 08-15-14 / 08-30-20 / 08-32-08) showed the rebuild
could only ever produce an empty shell, because the child recursion knew the
shape primitives in `SHAPE_FACTORIES` alone.

Five things stay:

- The copies are copies. Each one gets a new id, so later steps that name a
  recorded source resolve to the copy by index, not by identity.
- The nest takes the first source's slot through `moveBefore`. A host that
  refuses that move leaves the nest at the end of the layer list, with the
  note "the new scene landed at the end of the layer list".
- An image layer cannot be rebuilt: the recording holds no image asset. It
  stays where it is, with the note "an image layer can't be rebuilt inside the
  new scene — left it where it was".
- Undo is many steps. One rebuild is a scene layer, one layer per copy, and
  one removal per original.
- The inner-scene factories are typed in 1.0.1 and not live-verified. The
  17-13 traces prove only that the shell carries a `scene` whose `layers` is
  an array. See `runtime-api.md`.

**What does not work:** no API moves an existing layer into a scene. A "nest
layers into a new scene" macro cannot move the selected layers, and early
replays produced an empty nested scene.

**Why (evidence, 2026-08-22; typings re-checked against 1.0.1 on 2026-09-06):**
- 0.0.2 promised `Scene.createSceneInstance(layers)`. Runtime introspection
  shows **no such method exists** (the scene exposes `createSceneLayer`,
  `createShapeLayer`, `createImageLayer`, `createTextLayer`, `export`,
  `toJSON`, …), and 1.0.1 no longer declares it.
- 1.0.1 types `shiftTo(frame: number)` as a shift of the layer's timeline
  window. That explains both throws below: a node and a `{to}` object are not
  numbers.
- 1.0.1 offers `createSceneLayer({scene})` and `creator.createScene()`.
  Neither moves an existing layer into a scene.
- `createSceneLayer()` **creates an empty scene layer** and does not consume
  the selection. This is live-verified: replay traces of Macro 31/32 produced
  empty shells, and the user confirmed it visually.
- Creator's own UI nest action clearly has a path, but Creator does not expose
  it under any typed name.
- Adoption could report a false success. Traces
  `2026-09-06T17-13-00-849_record.json`,
  `2026-09-06T17-13-19-190_playback-Macro-5.json`, and
  `2026-09-06T17-13-38-332_playback-Macro-5.json` (rev `2026-09-06.4`) hold
  one correct recording and two replays, with 26 layers selected and then 1.
  Replay did use the selected layers. `createSceneLayer()` still returned an
  empty shell (`[nest] createSceneLayer() -> object, content=0, top=55`), so
  verification failed. The engine then adopted the still-live recorded nest,
  and the note read like success. The scene did not change.

**Current engine behavior (rev `2026-09-07.1`):** the step filters the live
selection through `isLayerNode` first, and then follows this table:

| Selection (layers only) | Recorded sources found | Recorded nest live | Action |
|---|---|---|---|
| Not empty | Ignored | Any | Rebuild-nest the selected layers — a new nest every time |
| Empty | Yes | Any | Rebuild-nest the recorded sources |
| Empty | No | Yes | Adopt it, with a note |
| Empty | No | No | Rebuild the recorded spec, now with its content |

The adoption note names the scene: "Nested Scene 5 already exists — using
it". The longer "(its layers are inside)" wording belongs to revs
`2026-09-06.2` and `2026-09-06.3`, where a selection could adopt as well.

`nestByRebuild` runs in this order:

1. Serialize each source, and hold the `IMAGE_LAYER` sources back.
2. Set the selection, and call `scene.createSceneLayer()`.
3. Return at once if the shell's inner `layers` is not empty: the host moved
   them, and no rebuild is necessary.
4. Build each copy through route 1, or through route 2 when the shell carries
   no factory.
5. Verify by reads: the copy count, `inner.layers`, and the shape count or
   the text of each copy.
6. Move the shell with `shell.moveBefore(sources[0])`, apply the spec's name
   and plain flags, and remove each rebuilt source.

Any miss in step 5 removes the shell, and the route-2 scene with it. The
originals stay where they are, and the step reports one skip note. Every host
call is a `tryRead` with a `[nest] …` breadcrumb, so a trace shows which route
ran.

**Status: CONFIRMED (instrumented trace, 2026-08-22, rev .34).** Breadcrumbs
from a live replay: `createSceneLayer(layers)` returned undefined;
`createSceneLayer()` returned an empty layer and did not consume the
selection, even when the engine set the selection programmatically;
`layer.shiftTo(created)` and `shiftTo({to})` both throw (0 of 2 layers moved).
No API route exists to move existing layers into a scene. **Upstream ask for
LottieFiles:** give Creator an API that moves existing layers into a scene, or
let `createSceneLayer` accept layers. The status covers the move API alone:
the engine reaches the other half without the ask, because a scene's own
`createShapeLayer` / `createTextLayer` fills it and
`scene.createSceneLayer({ scene })` places it. That route rebuilds nested
CONTENT; it still does not move the recorded layers. It ships in rev
`2026-09-07.1` — see the lift paragraph above.

**What replay does meanwhile:** a nest step rebuilds the layers inside the new
scene and removes the originals. A success reads "nested the 3 selected layers
(rebuilt inside the new scene — Creator can't move them)". A failure reads
"couldn't rebuild your 3 selected layers inside a new scene — left them where
they are". With nothing selected and no recorded source left, replay rebuilds
the recorded scene layer from its spec, with its content, and notes "couldn't
find the layers to nest — rebuilt Nested Scene 5 from the recording instead".
A same-scene replay with nothing selected adopts the original nest.

---

## Re-creating an image layer on replay — the recording has no asset

**What does not work:** an `add-layer` step for an `IMAGE_LAYER`. Replay
cannot rebuild the layer, because the macro carries no image.

**Why (evidence, 2026-09-06, against the 1.0.1 typings):**
- A recorded layer is a `NodeSnapshot` — transforms, plain flags, paints,
  masks, and child shapes. It has no channel for an image asset, so the macro
  carries nothing to draw.
- The only factory that builds one is `Scene.createImageLayer(opts)`, and
  `ImageLayerCreateOptions.image` requires an `Image` asset. That is exactly
  what the recording lacks.
- Building the layer with `createShapeLayer` instead would produce the
  dishonest empty shell that a rebuilt TEXT layer used to get, where every
  later write lands on nothing (taxonomy #12). The engine refuses to do that.

**What the user sees:** the step skips with the note *can't re-create an image
layer — the recording has no image asset — skipped*
(`sandbox/playback.ts#createLayerFromSpec`, rev `2026-09-06.3`). Every other
edit to that image layer — transform, opacity, timing, keyframes — replays
normally when the layer is already in the scene.

**Path to lift:** 1.0.1 types two routes, and neither is live-verified here.
Record the source asset's identity from `ImageLayer.image` and resolve it
against `creator.assets` on replay, then call `createImageLayer({ image })`.
Or record `Image.uri` — a base64 data URI, `null` until the host has loaded
the image — and rebuild through `Scene.import`. Weigh the second one against
the store: a data URI inside a macro makes the saved entry much larger, and
`clientStorage` reports the bytes used but no cap (`runtime-api.md`).

---

## Effects, ungroup — no API surface

No effect types, no effects list, and no ungroup operation exist anywhere in
the plugin API. They are absent from 1.0.1 as well, and from the runtime
surface that introspection found. Edits that use them are invisible to
the recorder, which reports nothing: there is no observable change to note.

1.0.1 does type a layer `matte` and an `isMatte` flag. That is track matting,
not an effect: the recorder reads `isMatte` with the other plain flags and
nothing else of it. The path to lift is upstream — Creator must give plugins
an effects surface first.

---

## File downloads inside Creator — blocked by the iframe sandbox (worked around)

**What does not work:** a programmatic download (blob URL plus
`<a download>.click()`, which is what Export JSON used) does nothing inside
Creator. The panel runs in a sandboxed iframe whose `sandbox` attribute does
not include the `allow-downloads` token, so the browser silently drops the
download.

**Why (evidence, 2026-08-23):**
- The user confirmed it inside Creator: Export JSON produced no file and no
  error.
- This is the documented Chrome behavior for sandboxed frames. Chrome blocks a
  download that starts in a frame sandboxed without `allow-downloads`, and it
  reports only a devtools message ("Download is disallowed. The frame
  initiating or instantiating the download is sandboxed, but the flag
  'allow-downloads' is not set."). A script can catch nothing:
  `anchor.click()` "succeeds".
- The known clipboard denial belongs to the same sandbox family: the panel's
  opaque-origin iframe also rejects `navigator.clipboard.writeText` (see
  `TraceStrip`'s copy fallback), which is why the workaround needs its own
  fallback chain.

**What the user sees:** nothing happened on Export — no file, no toast, no
error. We replaced the old flow rather than patched it.

**Workaround (shipped):** macros travel as copied JSON instead of files. ⋮ →
**Copy JSON** tries `navigator.clipboard.writeText`, then a hidden-textarea
`execCommand("copy")` inside the same gesture, and if the browser denies both
it opens a dialog with the JSON pre-selected for a manual ⌘C. **Import** opens
a paste-JSON dialog that feeds the existing `store.importMacro` path. This
works in all three runtimes (browser tab, Creator iframe, and the store side
is unchanged).

**Path to lift:** if LottieFiles adds `allow-downloads` to the plugin iframe's
sandbox attribute, real file export becomes possible again. The copy and paste
flow stays as the universal path.

---

## ~~Single-layer recording scope~~ — LIFTED (2026-08-22, engine v3)

The recorder can capture edits on any layer, layer duplication and copy-paste
(replayed as real `clone()` calls), new layers, deletions, and layer
reordering. See "Engine v3" in `history/improvements.md`. Since rev
`2026-09-07.2` the selection at Record chooses the scope — the selected
layers, or the whole scene when nothing is selected. That is a product
decision, not a host limit: the diff still runs on the whole scene, and
`engine/scope.ts` drops what the user did not ask for.

---

*Revised, no longer limitations:* shape **reorder**. Runtime introspection
found `moveBefore`, `moveAfter`, `bringToFront`, and `sendToBack`, which 0.0.2
omitted, and reorder replay now builds on them (rev 2026-08-22.14; the fake's
model of their placement semantics is unverified against the real host until a
reorder trace confirms it). The runtime surface also includes `toJSON()` on
nodes, shapes, and scenes (an `{id, type}` stub on the host probed on
2026-08-26 — see `runtime-api.md`); `clearKeyframes()` and `getValueAt()` on
animatables; `createTrimPath` and `trimPaths`; and scene-level `export`,
`createTextLayer`, and `createImageLayer`. 0.0.2 substantially undersold the
real API. 1.0.1 types all of those members except `toJSON()` and `export()`.

## Properties-panel values and API positions differ by the shape's own offset — host convention

**What does not work:** typing `150` into the X field of Creator's properties
panel can record as `position.x 150.5`. The recorder is not rounding or
adding anything: it stores the value the host API reports.

**Why (evidence):** trace `2026-09-08T02-24-47-365_record.json` (rev
`2026-09-07.8`). The raw `step-recorded` snapshot for "Ellipse 2"
(`yJ4U-6BILj`) reads `props.position.static.x: 150.5` after the edit, and
`132.5` before it, while the panel showed whole numbers both times. The
panel edits the layer's bounding box; the API's `position` is the transform
origin, and for this ellipse the two differ by half a pixel of shape
geometry. The same commit rounded the untouched Y from `118.36922…` to
`118.37`, which is the panel writing every field back at two decimals.

**What the user sees:** a recorded step that reads `→ 150.5` for a value
typed as `150`. Replay is unaffected: the step writes the API value the
host itself produced, so the layer lands where the panel put it.

**Path to lift:** none needed in the plugin. A recorder that showed the
panel's number would have to know each shape's geometry offset, which the
API does not expose. Read recorded transform values as API values.
