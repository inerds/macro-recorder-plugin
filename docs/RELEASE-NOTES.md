# Macro Recorder v0.4.0

**Turn your repetitive edits into one-click macros — record, then apply to any layer.**

First build shared outside the project. Unzip it, add the folder as a plugin
in Lottie Creator, and you're recording.

## Highlights

- **Record anything you do.** The recorder captures transforms, fills and
  gradients, strokes, trims, keyframes, text edits, renames, and structural
  changes (add, duplicate, remove, nest, reorder). Recording watches the whole
  scene, so you don't need to set up anything first.
- **Replay adapts to the target.** Apply a macro to any selected layers.
  Replay computes positions and offsets relative to each target. Duplicate
  steps clone the layer you selected. Colors adapt across paint kinds: a
  gradient recolor onto a solid fill converts the fill, and a solid color
  onto a gradient tints every stop. Macros that touch many layers, or
  restructure the scene, replay as a scene script instead and match layers
  by name.
- **Watch it happen.** Playback shows each step as it applies, Photoshop-actions
  style: the card expands, the active step lights up, a finished step gets a
  check mark, and a failed step keeps a red marker even after you continue.
- **Make it yours before you replay it.** Review, rename, skip, or edit any
  step. Simplify collapses noisy recordings. Pin values as parameters to fill
  in at play time. Play a macro at the playhead, staggered across a
  selection, or repeated ×N.
- **Capture existing animation.** While recording, select an animated layer
  and add its current keyframes, or its full style, to the macro in one tap.
- **Honest by design.** Nothing applies silently. Any step that can't apply,
  or had to adapt, says exactly what happened and why.

## Fixed in this build

- Replay now creates masks that a macro recorded.
- Replaying a layer reorder into a different scene no longer reshuffles that
  scene's own layers. The macro now remembers which layers it reordered, and
  checks them before it moves anything.
- Playback now flashes green when it completes. Red always means action or
  failure.

## Known limitations (host plugin API)

Some things the host doesn't yet expose to plugins. These record fine, but
they can't fully replay — the panel notes it when they don't:

- Nesting layers into a new scene: replay creates the scene layer, but can't
  move layers into it.
- Color tokens: replay applies the resolved color, not the token binding.
- Per-fill opacity, rectangle corner roundness, and timeline keyframe
  selection ("Add selected").

These light up automatically as the host's API grows.
