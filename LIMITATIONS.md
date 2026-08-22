# Known limitations

Platform and design limits the Macro Recorder has hit, with the evidence that
established them. Add an entry whenever a new one is confirmed; move an entry
to IMPROVEMENTS.md if it is ever lifted (API change, workaround found).

**Convention:** each entry states what doesn't work, why (with evidence), what
the user sees instead, and any path that could lift it.

---

## Fill / stroke opacity (per-paint) — cannot record or replay

**What:** Changing a fill's own opacity slider (Appearance panel, under the
color — distinct from Layer opacity) is invisible to the plugin: recordings
capture nothing, and there is no API to set it on a target.

**Why (evidence, 2026-08-22):**
- The Lottie document *does* model it: `o` is a separate animatable scalar
  (100 = opaque) on every fill (`ty:"fl"`) and stroke (`ty:"st"`) shape, next
  to the RGB color `c` ([Lottie spec — Shapes](https://lottiefiles.github.io/lottie-spec/specs/shapes/)).
- Creator's plugin proxy for a paint exposes exactly `color`, `type`,
  `remove` — verified by runtime introspection across the full prototype
  chain (trace `2026-08-21T19-09-59-458_record.json`). Probes for `opacity`,
  `alpha`, `fillOpacity`, `transparency`, `a` all return undefined. Color
  values are strictly `{r,g,b}` — no alpha channel.
- Dragging the fill-opacity slider during a recording produced **10/10 empty
  polling ticks** — zero observable change through the API.
- User-confirmed still not working on engine rev 2026-08-22.12.

**What the user sees:** nothing is recorded for the edit; no step appears.
Layer-level opacity (the one in the Layer section) records and replays fine
and is the practical substitute.

**Possible lift:**
- A speculative document-level capture is in place (untyped `node.toJSON()`
  exposes the raw document where `o` lives; the serializer recovers fill/
  stroke opacities from it, matched by document order). If a future trace
  shows fill-opacity steps being recorded, the capture side works — replay
  would still be limited to honest skip-notes, since no API sets paint
  opacity on a target.
- The clean fix is upstream: LottieFiles exposing `opacity` on the `Paint`
  plugin interface. The document already has the property; this is purely a
  membrane gap. Worth filing.

## Rectangle corner roundness — CONFIRMED (dead proxy)

**What:** Changing a rectangle's corner radius in Creator's UI is invisible
to the plugin: recordings capture nothing, and the value cannot be read
back to replay it.

**Why (evidence, 2026-08-22/23, engine rev 2026-08-22.39):**
- The `Rectangle` typing lists `roundness` only as a *creation option*
  (`RectangleOptions.roundness`, `plugin-api-ref.d.ts:1276`), not as a
  property of a live rectangle.
- Runtime introspection (trace `2026-08-21T21-53-02-401_record.json`,
  `shapeIntrospection`): the live rectangle proxy DOES expose `roundness`
  as a full Animatable (`addKeyframes, clearKeyframes, getKeyframeAt,
  getValueAt, isAnimated, keyframes, staticValue`) — but `staticValue` reads
  `0` on every rectangle in every one of 140+ traces, including rectangles
  that visibly have rounded corners. No other rounding-shaped property
  (`radius`, `cornerRadius`, `corners`, `modifiers`, `effects`) exists on the
  shape or its layer.
- Trace `2026-08-22T17-50-45-658_record.json`: an 8-second recording on a
  scene of three rectangles produced **16 empty polling ticks** — zero
  observable change through the API — while the user reported editing
  roundness. (Assumption to re-check: that this session was the roundness
  drag; every other reported edit type has produced steps in the same setup.)

**What the user sees:** dragging a corner radius during a recording adds no
step; a macro can't round corners on replay. The engine keeps `roundness`
in the RECTANGLE registry (`shared/snapshot.ts`) so a host that starts
reporting it records automatically.

**Path to lift:** host wires the rectangle's corner radius to the exposed
`roundness` Animatable (or exposes whichever property it really lives in).
The registry entry and the `shapeIntrospection` debug probe already exist
to confirm it the day it changes.

## Motion-path bezier handles (spatial tangents) — CONFIRMED

**What:** Bending a position keyframe's motion path on the canvas (the
curve handles between two position keyframes) is invisible to the plugin:
recordings capture the keyframes' frames/values/easing but not the curve,
and replays produce straight-line motion between them.

**Why (evidence, 2026-08-22, engine rev 2026-08-22.38):**
- The typings' `Keyframe<T>` interface has `id/frame/value/easing/remove`;
  `inTangent`/`outTangent` appear only in a doc example
  (`plugin-api-ref.d.ts:496-497`).
- Runtime introspection of a live **position** keyframe proxy, full
  prototype chain (trace `2026-08-21T21-53-02-401_record.json`,
  `debug.keyframeIntrospection` on the first keyframe tick): surface is
  exactly `easing, frame, id, remove, value`. Probes for `inTangent`,
  `outTangent`, `spatial`, `tangents` all return undefined.
- The Lottie document models them (`i`/`o` arrays on position keyframes per
  the spec) — this is a proxy gap, not a format gap.

**What the user sees:** a recording of a curved motion replays as linear
motion between the same keyframes; no step or note mentions the curve
(nothing observable to report on).

**Path to lift:** host exposes `inTangent`/`outTangent` on keyframe proxies.
The engine already reads and writes them defensively (`KfSnap.inTangent/
outTangent`, applier read-back verification with a note on refusal), so a
host that adds them starts recording/replaying curves with no code change.

## Nesting layers programmatically — CONFIRMED

**What:** Replaying a "nest layers into a new scene" macro onto a selection
may be unable to actually move the layers into the created scene — early
replays produced an empty nested scene.

**Why (evidence, 2026-08-22):**
- The typings promise `Scene.createSceneInstance(layers)`; runtime
  introspection shows **no such method exists** (the scene exposes
  `createSceneLayer`, `createShapeLayer`, `createImageLayer`,
  `createTextLayer`, `export`, `toJSON`, …).
- `createSceneLayer()` **creates an empty scene layer** and does not consume
  the selection (live-verified: replay traces of Macro 31/32 produced empty
  shells; the user confirmed visually).
- Creator's own UI nest action clearly has a path, but it is not exposed
  under any typed name.

**Current engine behavior (rev 2026-08-22.33):** a verified guess-chain —
`createSceneInstance(layers)` → `createSceneLayer(layers)` →
`createSceneLayer()` + per-layer `shiftTo(created)` (the untyped move method
present on every node) — each attempt checked by whether the created scene
actually contains the layers. If no rung works, the empty shell is removed
and the macro falls back to rebuilding the recorded scene layer, with notes.

**Status: CONFIRMED (instrumented trace, 2026-08-22, rev .34).** Breadcrumbs
from a live replay: `createSceneLayer(layers)` → undefined;
`createSceneLayer()` → empty layer, selection not consumed even when set
programmatically; `layer.shiftTo(created)` and `shiftTo({to})` both throw
(0 of 2 layers moved). No API route exists to move existing layers into a
scene. **Upstream ask for LottieFiles:** ship `createSceneInstance(layers)`
as the typings already promise (or let `createSceneLayer` accept layers, or
give `shiftTo` a scene-layer destination).

**What replay does meanwhile:** nest steps fall back to rebuilding the
recorded scene layer from spec (content that is layer-typed can't be rebuilt
either — noted honestly), and same-scene replays adopt the original nest.

## Effects, ungroup — no API surface

No effect types, no effects list, and no ungroup operation exist anywhere in
the plugin API — neither in the published typings nor in the runtime surface
found by introspection. Edits involving them are invisible to the recorder.

## ~~Single-layer recording scope~~ — LIFTED (2026-08-22, engine v3)

Recording is now whole-scene: edits on any layer, layer duplication/copy-paste
(replayed as real `clone()` calls), new layers, deletions, and layer
reordering are all captured. See IMPROVEMENTS.md "Engine v3".

---

*Revised, no longer limitations:* shape **reorder** — runtime introspection
found untyped `moveBefore` / `moveAfter` / `bringToFront` / `sendToBack`, and
reorder replay is now implemented on top of them (rev 2026-08-22.14; the
fake's model of their placement semantics is unverified against the real host
until a reorder trace confirms it). Untyped runtime surface also includes
`toJSON()` on nodes/shapes/scenes, `clearKeyframes()` / `getValueAt()` on
animatables, `createTrimPath` / `trimPaths`, and scene-level `export` /
`createTextLayer` / `createImageLayer` — the published typings substantially
undersell the real API.
