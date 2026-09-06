# Changelog

This is the user-facing record: user-visible changes per shared version, one
dated block per release. The engineering log — what was wrong and what changed,
one row per fix — is `docs/history/improvements.md`.

## Unreleased

- Recording now captures the scene settings: size, background (a transparent
  one included), frame rate, duration, and the scene name. Playback applies
  them to the active scene once per run, whatever you have selected.
- Changing a mask's mode, or switching a gradient between linear and radial,
  now records. Both used to record nothing.
- A failed save now shows the reason Creator gave. "Storage full — delete a
  macro first" appears only when Creator reports its storage cap.
- Playing a macro with shapes in the selection now skips the shapes and says
  so — macros replay onto layers.
- Switching scenes while you record now adds a step that says so. The
  recorder stays on the scene you started in, and the step never replays.
- Replaying a nest-layers step in the scene it was recorded in no longer
  leaves a second, empty copy of the nested scene behind when something else
  is selected. The step uses the nested scene that already exists and says so.
- A macro step that nests layers now says plainly when Creator could not move
  the layers into a new scene layer, and that the nested scene was rebuilt
  from the recording instead. Nesting also no longer risks retiming the layers
  it could not move.
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
- The panel now reconnects to the plugin engine when the first handshake is
  lost, instead of running on demo data for the rest of the session.
- The panel's surround now follows Creator's own light or dark setting,
  instead of guessing from the theme name.
- The panel accepts theme updates and engine replies from Creator's own window
  only.
- The inline confirmation now gives focus back to the control you came from
  when you dismiss it.
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
