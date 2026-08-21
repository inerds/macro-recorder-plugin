# Macro Recorder — User Guide

Macro Recorder is a LottieFiles Creator plugin that records what you do to a
scene and replays it — on the same layers, on other layers, on a different
file. Think Photoshop Actions, built for motion: keyframes, layer structure
and fills all record and replay, and values adapt to whatever you apply them
to.

This guide covers every feature and how to use it. For what the engine does
internally, see `README.md`; for what the platform can't do, see
`LIMITATIONS.md`.

---

## 1. Install and open

1. In Creator, open **Plugins → Development → Add plugin** and point it at
   the built `dist/` folder (or `http://localhost:5173` during development —
   see `README.md`).
2. Open **Macro Recorder** from the plugins menu. The panel lists your saved
   macros; it starts empty.

> If a red banner says **Plugin engine is outdated**, remove and re-add the
> plugin: Creator caches the engine once per load.

---

## 2. Record a macro

1. Press **Record**. No selection is needed — the recorder watches the whole
   active scene.
2. Edit the animation as you normally would. Everything below is captured:
   - transform changes (position, scale, rotation, skew, opacity) and any
     property on child shapes (size, roundness, points, path geometry…)
   - keyframes: added, removed, moved, value- or easing-changed
   - fills and strokes: added, removed, recolored, switched solid ↔ gradient
   - masks, trim paths, layer flags (visible, locked, blend mode…), renames
   - scene structure: new layers, deleted layers, **duplicates / copy-paste**,
     reordering, breaking a scene instance apart, nesting layers
3. Steps appear live in the panel as you work (the recorder samples twice a
   second, so a long drag shows up as a handful of steps — see *Simplify*).
4. Press **Stop**. If nothing was recorded you return to the list; otherwise
   the **review sheet** opens.

**Discard** (while recording) throws the session away; it asks first if
steps exist. Deleting the layer you were editing mid-recording stops the
recording with a notice.

---

## 3. Review and save

The review sheet shows the macro's name and every recorded step.

| Control | What it does |
|---|---|
| **Macro name** | Defaults to *Macro N*. Enter saves. |
| **× on a step** (hover) | Removes the step permanently. |
| **Eye toggle** | Disables the step: it stays in the macro but playback skips it. Toggle again to re-enable. |
| **Pencil** | Edits the step's value inline (see §5). |
| **Pin** | Marks the step as a parameter asked for on every play (see §8). |
| **Simplify** | Collapses drag micro-steps and keyframe edit chains (see §4). |
| **Save macro** | Stores it (in Creator's plugin storage — it follows your account, not the file). |
| **Discard** | Drops the recording. |

All of these controls are also available later: expand a saved macro in the
list to see its steps and edit them in place. Changes save immediately.

---

## 4. Simplify

A single drag produces a run of small steps (`position.x 0 → 12`, `12 → 40`,
`40 → 100`). **Simplify** merges every such run into one `0 → 100` step, and
folds keyframe edit chains (add a keyframe, then nudge it three times) into
one net change. Steps whose net effect is nothing (rotate 45°, rotate back)
disappear.

What it will *not* do:

- merge across a structural step (adding a shape, duplicating a layer…) or a
  disabled step — those are boundaries
- merge a static edit with a keyframe edit on the same property
- run on its own — it's a button, so you decide

The button is greyed out when there is nothing to simplify.

---

## 5. Edit a step's value

Hover a step and press the **pencil** (only shown for steps with an editable
value). The label becomes an editor:

| Recorded value | Editor |
|---|---|
| number (rotation, opacity, width…) | number field |
| x/y vector (position, scale, size…) | one field per component |
| color | color picker + hex field |
| text (blend mode, layer name) | text field |
| on/off flag | checkbox |
| a newly created layer | its name |

**Enter** or clicking away commits; **Esc** cancels. The step's label updates
to the new value. Keyframe steps and path-geometry edits aren't editable this
way — re-record those.

---

## 6. Play a macro

Press **▶** on a macro row. How it's applied depends on what the macro
recorded:

**Macros that touched one layer** apply to **every selected layer** (or, with
nothing selected, to the layer they were recorded on if it still exists).
Values adapt per target:

- the layer's own position / rotation / skew shift each target *from its own
  start*; scale multiplies
- everything else — colors, child-shape geometry, keyframe timing — applies
  exactly as recorded
- keyframed motion on the transform offsets the same way, anchored to the
  motion's first keyframe

**Macros that touched several layers or changed scene structure** replay as a
**scene script**: each step finds its layer by identity, then by name, and
reports a skip if it can't. Duplicate steps really duplicate; edits recorded
on a copy go to the copy the replay just made.

**Duplicate-macros are tools.** "Duplicate the layer, then move/recolor the
copy" clones each *selected* layer and edits that clone, offset from the
clone's own position. Select three layers, play once, get three finished
copies.

**Keyframes converge.** A macro means "end up like this": removing a keyframe
the target never had is a no-op, updating one that isn't there creates it,
adding one on an occupied frame updates it in place.

### While it plays

The row shows *Playing step X of Y*. Two things can interrupt:

- **A step fails** (e.g. "target has no fills"): the row pauses with
  **Continue** / **Stop**.
- **Nothing to play on** ("Select a layer first"): press **OK**.

Anything deliberately *not* applied — a value the target didn't need, a
fill it doesn't have — is never silent. It's collected as a **note** and
shown as a toast when the run ends (full list in the browser console).

---

## 7. Play options

Press the **chevron next to ▶** to open the play options.

### At playhead

Slides the whole macro along the timeline so its **earliest keyframe lands on
the current playhead frame**. Record a 0→30 bounce once, park the playhead at
frame 120, play at playhead: the bounce happens at 120→150. All keyframes in
the macro move together; static (non-keyframe) edits are unaffected. Does
nothing for a macro with no keyframes.

### Stagger

Only meaningful with several layers selected. Adds **N frames per layer**:
the first selected layer starts at the playhead, the second N frames later,
the third 2N later… A cascade in one click. Combine with *At playhead* or
leave the playhead off to stagger from the recorded frames.

### Repeat ×N

Runs the macro **N times in a row**. Offsets compound — each repeat applies
on top of the last — which is the point: a "duplicate, move 40px, rotate 15°"
macro played ×8 draws a spiral. Progress counts across all iterations; a
failure pauses exactly like a single run (Continue resumes the loop, Stop
ends everything).

---

## 8. Parameters (values asked for on play)

Some values want to change every time you use a macro — the color of a
recolor macro, the distance of a slide. Instead of editing the macro:

1. In review (or in the expanded macro), hover an editable step and press
   the **pin**. The step is now a parameter.
2. Playing the macro opens a small **form** with one row per pinned step,
   pre-filled with the recorded value.
3. Change what you want and press **Play**; the macro runs with those values
   (the saved macro is unchanged). **Cancel** returns to the list.

Parameters survive export/import and duplicate. Deleting a pinned step drops
its pin; *Simplify* keeps a pin when the pinned step is the first of a merged
run (the survivor) and drops pins on steps it merged away.

---

## 9. Manage macros

| Action | Where |
|---|---|
| Rename | ⋮ menu → Rename, Enter to commit |
| Duplicate | ⋮ menu → Duplicate (creates *name copy*) |
| Export JSON | ⋮ menu → Export JSON — downloads `name.macro.json` |
| Import | **Import** button in the footer — accepts a `.macro.json`, regenerates ids |
| Delete | ⋮ menu → Delete, then confirm inline |
| Expand | click the row to see and edit its steps |

Exported files are plain JSON: steps, disabled flags, and parameters ride
along, so macros can be shared between people and projects.

---

## 10. Tips

- **Record small, combine on play.** A macro that does one thing (a pop-in,
  a recolor) is more reusable than a long session — and *Repeat*, *Stagger*
  and parameters do the combining.
- **Use Simplify before saving** if you dragged controls; the macro becomes
  readable and the replay is faster.
- **Select before you play.** One-layer macros apply to every selected layer;
  with nothing selected they fall back to the original layer.
- **Read the notes toast.** "4 steps adapted or skipped — fills not found on
  this target" is the macro telling you the target's structure differs.
- **Name layers.** Scene scripts find layers by id, then by **name**, so
  consistent naming makes macros portable across files.

---

## 11. Known limits

Confirmed platform limits live in `LIMITATIONS.md` with evidence. The ones
you are most likely to meet:

- **Per-fill opacity** isn't exposed to plugins — it records nothing.
- **Nesting selected layers into a scene** can't be replayed (no API route
  moves existing layers into a scene); the step reports itself honestly.
- Mask edits and layer-reorder replay are implemented but not yet verified in
  a live Creator session.
- Fast drags are sampled at 2 steps/second — use *Simplify*.
- Export relies on a browser download, which Creator's sandbox may block;
  copy from the console in that case.
