# Changelog

User-visible changes per shared version. One dated block per release. The
internal detail lives in `docs/IMPROVEMENTS.md`.

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
