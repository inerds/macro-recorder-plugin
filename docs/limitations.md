# Known limitations

This document lists the platform limits and the design limits that the Macro
Recorder has found, with the evidence that established each one. Add an entry
when you confirm a new limit. Move an entry to `history/improvements.md` if an API
change or a workaround ever lifts it.

**Convention:** each entry states what does not work, why (with evidence), what
the user sees instead, and any path that could lift it.

---

## Selected keyframes (`creator.selection.keyframes`) — empty in practice

**What does not work:** the capture offer's "Add selected", which pulls only
the keyframes that the user selected on the timeline into a recording.

**Why (evidence):** the typings declare the surface (`SelectionAPI.keyframes`
and the event `selection:keyframes`), and the surface IS live —
`introspectSelection` probes show a real own-property array, with no throw.
But it read `array(0)` at every probe, and `selectedCount` stayed 0 on every
tick across five debug sessions at revs .42/.43/.44 (traces
2026-08-24T17-50-25 / 18-18-05, 2026-08-25T03-47-55 / 03-49-39 / 05-27-04).
One of them, the "Pink Flower" session, held a layer under offer that carried
21 keyframes of its own. The polled getter never reflects the timeline
selection in this host build.

**What the user sees:** "Add selected (0)", disabled, with the tooltip
"Creator hasn't reported any selected keyframes to plugins". "Add all" is
unaffected and fully live-verified.

**Path to lift:** rev .46 subscribes to the typed `selection:keyframes` event
(feature-detected) and feeds the capture offer from the latest event payload
when the getter polls empty. Verdict (trace 2026-08-26T03-55-48): the event
FIRES (`events: {supported: true, fired: 32}` — and `fired: 311` across a
longer session, trace 2026-08-26T06-03-22) but always with empty payloads
(`lastCount: 0`). Both typed routes exist, and neither carries the timeline
selection. Conclusive: the ask is upstream, for Creator to populate either
surface. The moment it does, "Add selected" starts to work with no plugin
changes.

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
- Applying the token *before* you press REC records nothing at all. Trace
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
- The user confirmed that it still does not work on engine rev 2026-08-22.12.

**What the user sees:** the recorder captures nothing for the edit, and no
step appears. Layer-level opacity (the one in the Layer section) records and
replays correctly, and it is the practical substitute.

**Path to lift:**
- A speculative document-level capture is in place. The untyped `node.toJSON()`
  exposes the raw document where `o` lives, and the serializer recovers fill
  and stroke opacities from it, matched by document order. If a future trace
  shows fill-opacity steps being recorded, the capture side works. Replay
  stays limited to honest skip-notes, because no API sets paint opacity on a
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
- The `Rectangle` typing lists `roundness` only as a *creation option*
  (`RectangleOptions.roundness`, `plugin-api-ref.d.ts:1276`), not as a
  property of a live rectangle.
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
- The typings' `Keyframe<T>` interface has `id`, `frame`, `value`, `easing`,
  and `remove`. `inTangent` and `outTangent` appear only in a doc example
  (`plugin-api-ref.d.ts:496-497`).
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
proxies. The engine already reads and writes them defensively
(`KfSnap.inTangent`/`outTangent`, applier read-back verification with a note
on refusal), so a host that adds them starts to record and replay curves with
no code change.

---

## Nesting layers programmatically — CONFIRMED

> **Re-confirmed live 2026-08-26 (rev .52, traces 08-15-14 / 08-30-20 /
> 08-32-08):** all three guess-chain routes still move 0 layers, and the
> breadcrumbs are now in the traces. Sub-finding from the 08-32-08 replay: the
> honest rebuild fallback is also structurally incapable of restoring the
> scene layer's CONTENT. The child recursion in `createLayerFromSpec` knows
> only shape primitives (`SHAPE_FACTORIES`: rectangle, ellipse, polygon, star,
> path), so LAYER-typed children note "can't re-create a shape layer —
> skipped", and the fallback can only ever produce an empty shell. To lift
> that half, the host needs a way to create layers INSIDE a scene layer's
> content, which is the same upstream ask. Same-scene replays are unaffected:
> the recorded id resolves to the original nested scene (adoption), as the
> 08-32-08 transform step shows.

**What does not work:** replay of a "nest layers into a new scene" macro onto
a selection can be unable to actually move the layers into the created scene.
Early replays produced an empty nested scene.

**Why (evidence, 2026-08-22):**
- The typings promise `Scene.createSceneInstance(layers)`. Runtime
  introspection shows **no such method exists** (the scene exposes
  `createSceneLayer`, `createShapeLayer`, `createImageLayer`,
  `createTextLayer`, `export`, `toJSON`, …).
- `createSceneLayer()` **creates an empty scene layer** and does not consume
  the selection. This is live-verified: replay traces of Macro 31/32 produced
  empty shells, and the user confirmed it visually.
- Creator's own UI nest action clearly has a path, but Creator does not expose
  it under any typed name.

**Current engine behavior (rev 2026-08-22.33):** the engine runs a verified
guess-chain — `createSceneInstance(layers)` → `createSceneLayer(layers)` →
`createSceneLayer()` plus a per-layer `shiftTo(created)` (the untyped move
method present on every node). The engine checks each attempt against whether
the created scene actually contains the layers. If no rung works, the engine
removes the empty shell, and the macro falls back to a rebuild of the recorded
scene layer, with notes.

**Status: CONFIRMED (instrumented trace, 2026-08-22, rev .34).** Breadcrumbs
from a live replay: `createSceneLayer(layers)` returned undefined;
`createSceneLayer()` returned an empty layer and did not consume the
selection, even when the engine set the selection programmatically;
`layer.shiftTo(created)` and `shiftTo({to})` both throw (0 of 2 layers moved).
No API route exists to move existing layers into a scene. **Upstream ask for
LottieFiles:** ship `createSceneInstance(layers)` as the typings already
promise, or let `createSceneLayer` accept layers, or give `shiftTo` a
scene-layer destination.

**What replay does meanwhile:** nest steps fall back to a rebuild of the
recorded scene layer from spec. The engine cannot rebuild layer-typed content
either, and it notes that honestly. Same-scene replays adopt the original
nest.

---

## Effects, ungroup — no API surface

No effect types, no effects list, and no ungroup operation exist anywhere in
the plugin API. They are absent from the published typings and from the
runtime surface that introspection found. Edits that use them are invisible to
the recorder.

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

Recording is now whole-scene. The recorder captures edits on any layer, layer
duplication and copy-paste (replayed as real `clone()` calls), new layers,
deletions, and layer reordering. See "Engine v3" in `history/improvements.md`.

---

*Revised, no longer limitations:* shape **reorder**. Runtime introspection
found the untyped `moveBefore`, `moveAfter`, `bringToFront`, and `sendToBack`
methods, and reorder replay now builds on them (rev 2026-08-22.14; the fake's
model of their placement semantics is unverified against the real host until a
reorder trace confirms it). The untyped runtime surface also includes
`toJSON()` on nodes, shapes, and scenes; `clearKeyframes()` and
`getValueAt()` on animatables; `createTrimPath` and `trimPaths`; and
scene-level `export`, `createTextLayer`, and `createImageLayer` — the
published typings substantially undersell the real API.
