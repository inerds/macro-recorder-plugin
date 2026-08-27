# Macro Recorder — user guide

Macro Recorder is a LottieFiles Creator plugin. It records what you do to a
scene and replays it — on the same layers, on other layers, or in a different
file. Think Photoshop Actions, built for motion: keyframes, layer structure,
and fills all record and replay, and the values adapt to whatever you apply
them to.

This guide covers every feature and how to use it. For what the engine does
internally, see `README.md`. For what the platform cannot do, see
`LIMITATIONS.md`.

---

## 1. Install and open

1. Open [creator.lottiefiles.com](https://creator.lottiefiles.com).
2. Open the Plugins panel, and click the **+** icon at the top right.
3. On the **Develop** tab, point it at the built plugin folder. During
   development, enter `http://localhost:5173` instead — see `README.md`.
4. Open **Macro Recorder** from the plugins menu. The panel lists your saved
   macros, and it starts empty.

The **deck** tops every screen: the panel's transport and its status light. It
carries no title, and the strip above the reels is the readout:

| On the deck | What it means |
|---|---|
| **Record** / **Stop** keys | Start and stop recording, from any screen. |
| **Status lamp** | Dark at rest, red while tape is moving (recording, rewind, playing), amber while a playback is paused and waits for your decision. |
| **State word** | READY · RECORDING · REWIND · PLAYING · PAUSED · DONE. |
| **Counter** | The steps captured while you record or review, and the step being applied during playback. |
| **Clock** | Appears while you record, and shows minutes and seconds (m:ss). |
| **The reels** | Spin while you record, rewind when you trigger a macro, run forward while it plays, and coast to a stop when it ends. |

The counter is the four-digit readout at the right of the transport row, and
the clock is the small readout between the reels. Record is dead while a
recording, a review, or a playback is in progress. A highlight travels along
the tape between the reels, so you can see which way it is going. The reels
are pure confirmation: the lamp and the state word always say the same thing,
and if your system asks for reduced motion the reels stay still.

In a very short panel, under about 352px tall, the deck scales down but keeps
whole, turning reels. Nothing moves anywhere else.

> If a red banner says **Plugin engine is outdated**, remove the plugin and add
> it again: Creator caches the engine once per load.

---

## 2. Record a macro

1. Click **Record** on the deck. You need no selection — the recorder watches
   the whole active scene.
2. Edit the animation as you normally would. The recorder records all of the
   following:
   - transform changes (position, scale, rotation, skew, opacity) and any
     property on child shapes (size, roundness, points, path geometry…)
   - keyframes: added, removed, moved, value- or easing-changed (motion-path
     curve handles are **not** exposed to plugins — see §11)
   - fills and strokes: added, removed, recolored, switched solid ↔ gradient
   - masks, trim paths, layer flags (visible, locked, blend mode…), renames
   - scene structure: new layers, deleted layers, **duplicates / copy-paste**,
     reordering, breaking a scene instance apart, nesting layers
3. Watch the steps appear live in the panel as you work. The recorder samples
   twice a second, so a long drag shows up as a handful of steps — see
   *Simplify*.
4. Click **Stop**: the red key at the bottom of the recording screen, or the
   same deck key you started from. Both do the same thing. If the recorder
   recorded nothing, you return to the list. Otherwise the **review sheet**
   opens.

**Discard**, beside Stop at the bottom, throws the session away, and it asks
first when steps exist. Deleting a layer while you record is itself a recorded
step. Recording stops on its own only when the scene goes away, and it says
so.

---

## 3. Review and save

The review sheet shows the macro's name and every recorded step.

| Control | What it does |
|---|---|
| **Macro name** | Defaults to *Macro N*, and Enter saves. |
| **× on a step** (hover) | Removes the step permanently. |
| **Eye toggle** (*Skip step N during playback*) | Keeps the step in the macro but makes playback skip it; click again to re-enable. |
| **Pencil** | Edits the step's value inline (see §5). |
| **Pin** (*Ask for step N's value on every play*) | Marks the step as a parameter (see §8). |
| **Simplify** | Collapses drag micro-steps and keyframe edit chains (see §4), and shows what it will do: `12 → 5`. |
| **⊘ Skipped** | Not a control: Creator's plugin API cannot do this operation, so playback skips it. |
| **Save macro** | Stores the macro in Creator's plugin storage, which follows your account, not the file. |
| **Discard** | Drops the recording. |

You also get all of these controls later: expand a saved macro in the list to
see its steps and edit them in place. Your changes save immediately.

**Tip — select a layer before you record.** A macro recorded on one selected
layer replays on *any* selected layer later. A recording that builds new
layers replays as a scene script bound to those layers. Recording with nothing
selected still works, and that is how you make structure macros. The panel
reminds you of the trade-off when you start that way.

---

## 3½. Turn existing animation into a macro

A layer that is already animated can hand its keyframes to a recording,
without re-authoring. While you record, select **one** layer that has
keyframes. A card appears above the live feed ("*Layer* has N keyframes on M
properties") with two choices:

- **Add all** takes the layer's whole state. Every animated property becomes
  keyframe steps, and its fills travel whole: solid stays solid, and a radial
  gradient stays radial. Replaying replaces a mismatched fill, and adds one
  where none exists. The rest of its current *look* — static transform values,
  stroke widths, text and font, and blend mode — rides along as value steps.
  Those steps read as `property = value` in the feed. Playing the saved macro
  recreates the motion and the look on any selected layer, at the playhead,
  with stagger. Position, scale, and rotation values deliberately do not move
  a replay target, because a style should not teleport the layer it lands on.
- **Add selected (n)** takes only the keyframes you selected on the timeline.
  On current Creator builds it shows **(0), disabled**: Creator does not yet
  report the timeline's keyframe selection to plugins. That is a host
  limitation, not a broken button. The plugin also listens for the selection
  event, so the key lights up by itself the moment a Creator build starts
  delivering it. **Add all** is unaffected.

The offer follows your selection: select a different layer and it updates, and
deselect and it leaves. It shows for a single selected layer only, and not for
scene-instance layers, because their content is shared between instances.
After **Add all**, that button disables for the layer, so a second tap cannot
double up the steps.

---

## 4. Simplify

A single drag produces a run of small steps (`position.x 0 → 12`, `12 → 40`,
`40 → 100`). **Simplify** merges every such run into one `0 → 100` step. It
also folds keyframe edit chains (add a keyframe, then nudge it three times)
into one net change. Steps whose net effect is nothing (rotate 45°, rotate back)
disappear.

Simplify will *not* do the following:

- merge across a structural step (adding a shape, duplicating a layer…) or a
  disabled step — those are boundaries
- merge a static edit with a keyframe edit on the same property
- run on its own — it is a button, so you decide

When there is nothing to merge, the button stays put and says so (*Nothing to
merge*) rather than disappearing.

---

## 5. Edit a step's value

Hover or focus a step, then click the **pencil**. The pencil shows only for
steps with an editable value. The label becomes an editor:

| Recorded value | Editor |
|---|---|
| number (rotation, opacity, width…) | number field |
| x/y vector (position, scale, size…) | one field per component |
| color | color picker + hex field |
| text (blend mode, layer name) | text field |
| on/off flag | checkbox |
| a newly created layer | its name |

Press **Enter** or click away to commit. Press **Esc** to cancel. The step's
label updates to the new value. Keyframe steps and path-geometry edits are not
editable this way — re-record those.

---

## 6. Play a macro

Click **▶** on a macro row. How the plugin applies the macro depends on what
the macro recorded.

**Macros that touched one layer** apply to **every selected layer**. With
nothing selected, they apply to the layer they were recorded on, if it still
exists. The values adapt per target:

- the layer's own position, rotation, and skew shift each target *from its own
  start*, and scale multiplies
- everything else — colors, child-shape geometry, and keyframe timing —
  applies exactly as recorded
- keyframed motion on the transform offsets the same way, anchored to the
  motion's first keyframe

**Macros that touched several layers or changed scene structure** replay as a
**scene script**: each step finds its layer by identity, then by name, and
reports a skip if it cannot. Duplicate steps really duplicate, and edits
recorded on a copy go to the copy the replay created. Layers the replay
recreates keep their kind: a recorded text layer comes back as a real text
layer, with its text, font, size, and alignment applied. If the host cannot
create one, the plugin skips the step with a note rather than faking it.

**Duplicate-macros are tools.** "Duplicate the layer, then move or recolor the
copy" clones each *selected* layer and edits that clone, offset from the
clone's own position. Select three layers, play once, and get three finished
copies.

**Keyframes converge.** A macro means "end up like this". Removing a keyframe
the target never had does nothing. Updating one that is not there creates it.
Adding one on an occupied frame updates it in place.

### While it plays

Playing **opens the macro's card** and walks its step list, one step at a
time. You watch the macro happen rather than see it land all at once:

- the step about to run is **lit and highlighted**, and steps not reached yet
  are dimmed
- a step that lands swaps its number for a **✓**
- a step that fails swaps its number for a **red marker** and keeps it for the
  rest of the playback, even if you Continue past it
- the row shows *Playing step X of Y* throughout

The pace scales with the macro. A short macro steps about three times a
second. A long one — a whole captured timeline, say — speeds up, so the walk
still takes a few seconds rather than a minute.

Three things can interrupt it:

- **A step fails** (for example, "Step 3 failed — couldn't find fill 2 to
  remove"): the row pauses with **Continue** / **Stop**.
- **Nothing to play on** ("Select a layer first"): click **Dismiss**.
- **You change your mind**: click **Stop** in the progress row.

Anything the plugin deliberately does *not* apply — a value the layer did not
need, or a fill it does not have — is never silent. The plugin collects it as
a **note** and shows a toast when the playback ends ("4 steps adapted or
skipped — this layer can't take masks (3 times) and other reasons"). The full
list goes to the log for developers.

---

## 7. Play options

Click the **sliders next to ▶** to open the play options. The dialog has
**Cancel**. What you choose sticks to the row: the plain ▶ uses it too, and
the row shows it (`×8 · +4f · @playhead`).

### At playhead

At playhead slides the whole macro along the timeline, so its **earliest
keyframe lands on the current playhead frame**. Record a 0→30 bounce once,
park the playhead at frame 120, and play at playhead: the bounce happens at
120→150. All keyframes in the macro move together, and static (non-keyframe)
edits are unaffected. It does nothing for a macro with no keyframes. **Newly
recorded macros start with this on** — open the play options to turn it off
for the session.

### Stagger

Stagger is meaningful only with several layers selected, so it is disabled for
macros that replay as a scene script. It adds **N frames per layer**: the
first selected layer starts at the playhead, the second N frames later, the
third 2N later, and so on. That is a cascade in one click. Combine it with *At
playhead*, or leave the playhead off to stagger from the recorded frames.

### Repeat

Set it to N, and the macro replays **N times in a row** (shown as ×N). Offsets
compound, because each repeat applies on top of the last, and that is the
point: a "duplicate, move 40px, rotate 15°" macro played ×8 draws a spiral.
Progress counts across all iterations. A failure pauses exactly like a single
playback: Continue resumes the loop, and Stop ends everything.

---

## 8. Parameters (values the macro asks for on play)

Some values want to change every time you use a macro — the color of a recolor
macro, or the distance of a slide. Instead of editing the macro, do this:

1. In review, or in the expanded macro, hover an editable step and press the
   **pin**. The step is now a parameter.
2. Play the macro. A small **form** opens with one row per pinned step,
   pre-filled with the recorded value. If the first pinned value is a color,
   its picker pops open on its own — pick, then Play.
3. Change what you want, then click **Play**. The macro replays with those
   values, and the saved macro is unchanged. **Cancel** returns to the list.

The form appears only when at least one step is pinned. Without pins, Play
replays the recorded values straight away. To change a value *forever*
instead, edit the step in place with the pencil. To be *asked each play*, pin
it.

Parameters survive Copy JSON, Import, and duplicate. Deleting a pinned step
drops its pin. *Simplify* keeps a pin when the pinned step is the first of a
merged run (the survivor), and drops pins on the steps it merged away.

---

## 9. Manage macros

Each row in the list reads left to right: its position in the list, the
macro's name, then how many steps it holds as a two-digit count (`04`). Screen
readers hear the full "4 steps".

| Action | Where |
|---|---|
| Rename | ⋮ menu → Rename, then Enter to commit |
| Duplicate | ⋮ menu → Duplicate, which creates *name copy* |
| Copy JSON | ⋮ menu → Copy JSON, which puts the macro's JSON on your clipboard |
| Import | **Import** button on the **Saved macros** header, which opens a dialog |
| Delete | ⋮ menu → Delete, then confirm inline |
| Expand | Click the row to see and edit its steps |

Three of these actions have more to them:

- Copy JSON: if the clipboard is blocked — Creator's sandbox can do that — a
  dialog opens with the JSON pre-selected, so you can copy it yourself.
- Import: paste the JSON that Copy JSON produced, then press **Import**. The
  plugin regenerates the ids, so an import never collides with an existing
  macro.
- Expand: the open card's footer keeps **Play**, the play options, and the ⋮
  menu, so nothing needs collapsing first. Hover Play for the macro's duration
  in frames.

A macro travels as plain JSON. Steps, disabled flags, and parameters ride
along, so you can share macros between people and projects: paste the text
into chat, a note, or a file, and Import takes it back on the other side.
There is no file download, because Creator's plugin sandbox blocks downloads,
which is why sharing is copy and paste.

---

## 10. Tips

- **Record small, and combine on play.** A macro that does one thing (a
  pop-in, a recolor) is more reusable than a long session. *Repeat*,
  *Stagger*, and parameters do the combining.
- **Use Simplify before you save** if you dragged controls. The macro becomes
  readable, and the replay is faster.
- **Select before you play.** One-layer macros apply to every selected layer.
  With nothing selected, they fall back to the original layer.
- **Read the notes toast.** "4 steps adapted or skipped — fills not found on
  this layer" is the macro telling you that the layer's structure differs.
- **Name your layers.** Scene scripts find layers by id, then by **name**, so
  consistent naming makes macros portable across files.

---

## 11. Known limits

Confirmed platform limits live in `LIMITATIONS.md` with evidence. You are most
likely to meet these:

- **Per-fill opacity** is not exposed to plugins — it records nothing.
- **Rectangle corner roundness** is not wired to the property the plugin can
  read — corner-radius edits record nothing.
- **Motion-path curves** (bezier handles between position keyframes) are not
  exposed either — curved motion replays as straight lines between the same
  keyframes.
- **Nesting selected layers into a scene** cannot be replayed, because no API
  route moves existing layers into a scene. The step reports itself honestly.
- Layer-reorder replay is live-verified: the macro records which layers it
  reordered, and replay checks them before it moves anything. Mask creation on
  replay is fixed in this build, and a live session has not re-verified it
  yet. Mask *edits* replay after the mask exists.
- Fast drags are sampled at 2 steps per second — use *Simplify*.
- Creator's plugin sandbox blocks file downloads. That is why sharing is
  **Copy JSON** and paste into **Import**, rather than a file export.
