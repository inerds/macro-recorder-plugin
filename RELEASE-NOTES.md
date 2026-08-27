# Macro Recorder v0.4.0

**Turn your repetitive edits into one-click macros — record, then apply to any layer.**

First build shared outside the project. Unzip, add the folder as a plugin in
Lottie Creator, and you're recording.

## Highlights

- **Record anything you do** — transforms, fills and gradients, strokes, trims,
  keyframes, text edits, renames, and structural changes (add, duplicate,
  remove, nest, reorder). No setup: recording watches the whole scene.
- **Replay adapts to the target.** Apply a macro to any selected layers:
  positions and offsets are computed relative to each target, duplicates clone
  the layer you selected, and colors adapt across paint kinds (a gradient
  recolor onto a solid fill converts it; a solid onto a gradient tints every
  stop). Macros that touch many layers or restructure the scene replay as a
  scene script instead, matching layers by name.
- **Watch it happen.** Playback steps through the macro Photoshop-actions
  style — the card expands, the running step lights up, finished steps get a
  check, and a failed step keeps a red marker even after you continue.
- **Make it yours before you run it.** Review, rename, skip, or edit any step;
  Simplify collapses noisy recordings; pin values as parameters to fill in at
  play time; run at the playhead, staggered across a selection, or repeated ×N.
- **Capture existing animation.** While recording, select an animated layer and
  add its current keyframes — or its full style — to the macro in one tap.
- **Honest by design.** Nothing applies silently: any step that can't apply or
  had to adapt says exactly what happened and why.

## Fixed in this build

- Masks recorded in a macro now really get created on replay.
- Replaying a layer reorder into a different scene no longer reshuffles that
  scene's own layers — the macro now remembers *which* layers it reordered and
  checks before moving anything.
- Playback completion flashes green (red now always means action or failure).

## Known limitations (Creator plugin API)

Some things Creator doesn't yet expose to plugins — these record fine but
can't fully replay, and the plugin tells you when they don't:

- Nesting layers into a new scene (replay creates the scene layer, but can't
  move layers into it)
- Color tokens (the resolved color is applied, not the token binding)
- Per-fill opacity, rectangle corner roundness, and timeline keyframe
  selection ("Add selected")

These light up automatically as Creator's API grows.
