# Changelog

User-visible changes per shared version. One dated block per release. The
internal detail lives in `docs/IMPROVEMENTS.md`.

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
