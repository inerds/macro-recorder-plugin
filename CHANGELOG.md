# Changelog

This is the user-facing record: user-visible changes per shared version, one
dated block per release. The engineering log — what was wrong and what changed,
one row per fix — is `docs/history/improvements.md`.

## Unreleased

## 0.8.1 — 2026-09-08

- Toolchain refresh: TypeScript 7, Vitest 5, lucide-react 1.40, and the
  current major versions of the GitHub Actions the CI and release workflows
  use. No change to what the plugin does.
- Macro Recorder is published in the Creator Extensions marketplace:
  [extensions.lottiefiles.com/plugin/inerds/macro-recorder](https://extensions.lottiefiles.com/plugin/inerds/macro-recorder).

## 0.8.0 — 2026-09-07

- Hold Option (macOS) or Alt (Windows) while you press Record to record exact
  values. The Record key turns blue, and every change to a layer's own
  position, rotation, scale, skew, and skew axis is recorded as a **Set to**
  step rather than as a delta — for macros that put things in fixed places.
  Both Record keys take the modifier, from the pointer or from the keyboard.
- The panel opens at 320 × 560 instead of 300 × 520: two more rows in the
  list, and the reels a touch larger.
- What you select before you press Record now decides what the recorder
  watches. Select a layer and only that layer records; a selected shape
  counts as its layer. Select nothing and the whole scene records, as
  before. The deck shows which one Record will do, and the recording screen
  names it. Edits to other layers are dropped and counted ("2 changes
  outside Layer A ignored"), never recorded by surprise. Duplicates and new
  layers still record. Scene settings record in whole-scene recordings only.
- The review sheet now opens on the simplified list, because a single drag is
  recorded as a chain of micro-steps. Select **Keep every step** above the
  step list to see the recording as it was captured; the choice holds until
  you close the panel. A saved macro keeps its manual **Simplify** button.
- Playback walks the step list in about a second and a half instead of four
  and a half. Short macros pace the same as before; long ones no longer take
  many seconds to finish.
- The pencil on a step for a layer's own position, rotation, skew, skew axis,
  or scale now opens **a verb and a number box**: **Set to**, **Add**,
  **Subtract**, **Multiply**, **Divide**, or **Formula…** for a whole
  expression. Choose the verb, or type the operator into the box. The number
  converts when you change the verb, so a drag from 100 to 130 reads
  **Add** `30`, **Set to** `130`, or **Multiply** `1.3` — the same edit in
  three ways. A vector property gets one row per component. **Formula…** hands
  the box an expression such as `v * 2 + 10`, where `v` is the target's
  current value. The default is unchanged — a drag opens as **Add** `60`, a
  scale as **Multiply** `2` — so a macro you never edit behaves as it
  always did.
- Numbers in the panel show **two decimals**. A number that two decimals would
  flatten into "changes nothing" keeps the digits it needs, and what you type
  is stored as you type it.
- A recorded "rotation to 0", "skew to 0", or "scale to 100%" step now
  applies **exactly**, in macros you saved before this version too. Such a
  step used to replay as a delta, so a target at 30° ended at −15° instead
  of 0°.
- A pinned transform step's play-time form now shows the same verb, so you can
  change what the step does for one play without editing the macro.
- A keyframe step on a layer's transform now takes a formula as well, so a
  keyframed move can be set to an exact value. A scale keyframe run keeps its
  proportions: recorded 100% → 200% keyframes played onto a half-size layer
  now run 50% → 100%, not 50% → 150%.
- A step you gave a formula keeps its formula on the row and in the list, even
  when the numbers it was recorded with do not change. `v * 2` on a recorded
  "rotation to 0" now reads "rotation ×2" and survives **Simplify**.
- Playing onto several layers at once no longer lets one layer's result move
  the others. A layer that could not take a step — a property already on the
  timeline, for instance — now keeps its own starting point for the steps that
  follow, instead of measuring against a value only its neighbours reached.
- A macro the panel cannot draw now reports what happened and how to recover,
  instead of leaving the panel blank.

## 0.7.0 — 2026-09-07

- Nesting layers now really nests them. Creator gives no plugin a way to move
  a layer into a scene, so the plugin rebuilds each selected layer inside the
  new scene, puts the new scene where the first layer was, and removes the
  originals: "nested the 3 selected layers (rebuilt inside the new scene —
  Creator can't move them)". An image layer stays where it is, with its own
  note. Undo takes one step per rebuilt layer. The step used to report a
  success while nothing moved, and in the scene it was recorded in it no
  longer leaves a second empty copy of the nested scene behind. Nesting also
  no longer risks retiming the layers it could not move.
- Recording now captures the scene settings: size, background (a transparent
  one included), frame rate, duration, and the scene name. Playback applies
  them to the active scene once per run, whatever you have selected.
- Changing a mask's mode, or switching a gradient between linear and radial,
  now records. Both used to record nothing.
- Switching scenes while you record now adds a step that says so. The
  recorder stays on the scene you started in, and the step never replays.
- Playing a macro with shapes in the selection now skips the shapes and says
  so — macros replay onto layers.
- A macro that adds an image layer now says it cannot re-create the layer,
  because a recording holds no image asset.
- A group the replay re-creates now holds its shapes. It used to arrive empty,
  with the shapes left loose on the layer, and reported success anyway.
- A re-created group now keeps its flags, strokes, masks, and trim paths too.
  Only its name, transform, and fills used to survive.
- Adding or replacing a fill or a stroke no longer fails outright when the
  recording carried a paint opacity. Creator used to reject the whole paint.
- Removing or replacing a text layer's fill or stroke now works. The step used
  to miss, and then claim it had added the new paint alongside the old one.
- A macro that shifts a keyframed layer now measures the target against the
  value you can see at the playhead, so a relative move lands where you expect.
- Simplify now folds a scene setting you changed several times — the frame
  rate, say — into one step, the way it already folds a drag.
- Playback notes now tell adjustments from skips: a stagger that worked says
  "3 steps adjusted", and only a step that could not apply counts as skipped.
  Every note speaks Creator's language ("Creator kept the in point as it
  was"), a step that moves a layer's timeline window reads "in point" and
  "out point", and the notes toast stays for eight seconds.
- The panel no longer stays blank when the plugin engine cannot be reached;
  it opens on the demo engine and says so.
- The panel now reconnects to the plugin engine when the first handshake is
  lost, instead of running on demo data for the rest of the session.
- A failed save now shows the reason Creator gave. "Storage full — delete a
  macro first" appears only when Creator reports its storage cap.
- Keys that are off now say why when you reach them with the keyboard, the
  deck's Stop key works during playback, a paused run scrolls its
  Continue/Stop into view, and the screen reader hears one announcement at
  the start and end of a run instead of one per step.
- Clearer wording: "Add all keyframes", "Discard recording", "Duration 30
  frames", one lowercase play-options readout, one wording for every failure
  toast ("Couldn't import the macro. Try again."), and "Rebuilds the scene"
  instead of "scene script".
- Higher contrast on the red keys, the running and pending steps, the import
  placeholder and the warning box; a hairline edge on light Creator themes;
  the deck's smallest readouts never drop under 9 px.
- The inline confirmation now gives focus back to the control you came from
  when you dismiss it.
- The panel's surround now follows Creator's own light or dark setting,
  instead of guessing from the theme name.
- The panel accepts theme updates and engine replies from Creator's own window
  only.
- The development build installs as **Macro Recorder (dev)** and keeps its own
  macro store, so testing no longer touches the macros you saved with the
  released build.

## 0.6.0 — 2026-09-04

- Rounded corners now follow three sizes across the panel: cards and menus, keys, and recessed fields and lists.
- Tightened the macro rows: the name has more room and the three row keys sit together. Rows now lift as a whole when you hover, and the dotted leader between the name and the count is gone.
- Stagger now works on a macro with no keyframes: it delays each selected
  layer instead, moving the in point and the layer's own animation together.
  The layers move in selection order, once per run, and a layer whose new in
  point reaches its out point is skipped with a note.
- At playhead now moves the first target layer's in point to the current
  frame when the macro has no keyframes.
- Stagger says when it does nothing: a macro that replays as a scene script,
  or a run with one selected layer, now reports a note.
- The plugin manifest now carries the version number.
- The release zip is built by `pnpm bundle` and contains only the three
  files Creator needs.

## 0.5.0 — 2026-09-04

- Redrew the deck after a studio reel-to-reel: spun-metal three-spoke
  reels, tape laced around corner guide rollers, and a nameplate that
  carries the version. Play and record turn the reels counter-clockwise
  with the tape; rewind turns them clockwise.
- Added a hand spin: at rest, drag a reel and let go. Both reels coast,
  the tape highlight runs with them, and the counter runs as a tape
  counter until they settle.
- Changed step rows to show the property and the result; the previous
  value stays in the tooltip.
- Changed the Simplify count and the recording count to plain readouts.
- Changed the list header's Import to an icon.
- Changed the open card to one disclosure chevron, and kept the row number
  while renaming.
- Changed narrow panels (under about 278px) to give closed rows to the
  macro name; play options move to the ⋮ menu there.
- Changed the review step list to sit in the same well as the live feed,
  and moved the recorded layer's name into the sentence under it.
- Changed the disabled Import key to a flat cream key.
- Fixed the deck's edges and light at panel size: one hairline per edge,
  corners that nest, and a soft centre light instead of a diagonal band.
- Fixed text selection appearing when dragging across the panel.

## 0.4.0 — 2026-08-26

Initial public build.

- Added whole-scene recording for transforms, paints, keyframes, text, and
  structure.
- Added replay onto any selected layers, with smart retargeting, or as a
  scene script.
- Added visible, step-by-step playback with per-step status.
- Added review, edit, skip, and simplify actions for steps.
- Added parameters, stagger, and repeat ×N as play options.
- Added capture of an animated layer's keyframes, or its full style, into a
  macro.
- Fixed mask creation on replay.
- Fixed layer-reorder replay to verify layer identity before it moves
  anything.
- Fixed the completion flash to show green.
