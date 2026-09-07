# Macro Recorder — user guide

Macro Recorder is a LottieFiles Creator plugin. It records what you do to a
scene and replays it — on the same layers, on other layers, or in a different
file. Think Photoshop Actions, built for motion: keyframes, layer structure,
and fills all record and replay, and the values adapt to whatever you apply
them to.

This guide covers every feature and how to use it. For what the engine does
internally, see `README.md`. For what the platform cannot do, see
`limitations.md`.

---

## 1. Install and open

1. Open [creator.lottiefiles.com](https://creator.lottiefiles.com).
2. Install **Macro Recorder** from the
   [Creator Extensions marketplace](https://extensions.lottiefiles.com/plugin/inerds/macro-recorder), or open the Plugins panel and
   click the **+** icon at the top right to add it by hand.
3. To run a build you made yourself, use the **Develop** tab and point it at
   the built plugin folder. During development, enter `http://localhost:5173`
   instead — see `README.md`. A development build installs as **Macro
   Recorder (dev)** and keeps its own macros, so it never touches the macros
   you saved with the released build.
4. Open **Macro Recorder** from the plugins menu. The panel lists your saved
   macros, and it starts empty.

The **deck** tops every screen: the panel's transport and its status light. It
carries no title, and the transport row under the reels is the readout:

| On the deck | What it means |
|---|---|
| **Record** / **Stop** keys | Start and stop recording, from any screen. |
| **Status lamp** | Dark at rest, red while tape is moving (recording, rewind, playing), amber while a playback is paused and waits for your decision. |
| **State word** | READY · RECORDING · REWIND · PLAYING · PAUSED · DONE. |
| **Counter** | The steps captured while you record or review, and the step being applied during playback. |
| **Clock** | Appears while you record, and shows minutes and seconds (m:ss). |
| **Scope caption** | Under the transport row: *RECORDS · LAYER A* before you record, and *RECORDING · LAYER A* while you record. |
| **The reels** | Spin while you record, rewind when you trigger a macro, run forward while it plays, and coast to a stop when it ends. When the deck is at rest you can spin them yourself: drag a reel and let go, and they coast like a platter while the counter runs with them. |

The counter is the four-digit readout at the right of the transport row, and
the clock shares that window while you record. The nameplate under the reels
carries the plugin version. Record is dead while a
recording, a review, or a playback is in progress. A highlight travels along
the tape, which leaves the left reel, runs around the bottom guide rollers and
winds onto the right reel, and back the other way along the short run over
the nameplate, so you can see which way it is going. The reels
are pure confirmation: the lamp and the state word always say the same thing,
and if your system asks for reduced motion the reels stay still.

In a very short panel, under about 371px tall, the deck scales down but keeps
whole, turning reels. The scope caption stays. Nothing moves anywhere else.

The panel wears one skin and keeps it. Only the surround around the panel
follows Creator's own light or dark setting.

> If a red banner says **Plugin engine is outdated**, remove the plugin and add
> it again: Creator caches the engine once per load.

If the panel cannot reach the plugin engine, it opens on the demo engine and
says so: *Couldn't reach the plugin sandbox — recording and playback are
simulated. Reload the plugin to retry.* Nothing you do there reaches your
scene. The panel keeps asking in the background, and it reloads onto the real
engine as soon as the engine answers.

---

## 2. Record a macro

1. Select the layer or layers you want to record, or select nothing to
   record the whole scene. A selected shape counts as its layer. The deck's
   readout shows what Record will watch: *RECORDS · LAYER A* or *RECORDS ·
   WHOLE SCENE*. Then click **Record** on the deck.
2. Edit the animation as you normally would. The recorder records all of the
   following on the recorded layers:
   - transform changes (position, scale, rotation, skew, opacity) and any
     property on child shapes (size, roundness, points, path geometry…)
   - keyframes: added, removed, moved, value- or easing-changed (motion-path
     curve handles are **not** exposed to plugins — see §11)
   - fills and strokes: added, removed, recolored, switched solid ↔ gradient,
     and switched linear ↔ radial
   - masks (including a mask's mode), trim paths, layer flags (visible,
     locked, blend mode…), renames
   - scene structure: new layers, deleted layers, **duplicates / copy-paste**,
     reordering, breaking a scene layer apart, nesting layers
   - scene settings, in a whole-scene recording only: size, background (a
     transparent one included), frame rate, duration, and the scene name
3. Watch the steps appear live in the panel as you work. The recorder samples
   twice a second, so a long drag shows up as a handful of steps. The review
   sheet merges them for you — see §4.
4. Click **Stop**: the red key at the bottom of the recording screen, or the
   same deck key you started from. Both do the same thing. If the recorder
   recorded nothing, you return to the list. Otherwise the **review sheet**
   opens.

**Hold Option (macOS) or Alt (Windows) while you press Record to record
exact values.** The Record key turns blue while you hold the modifier, and it
stays blue for the recording it starts. The recorder then records each change
to a layer's own position, rotation, scale, skew, and skew axis as a **Set to**
step, which puts the target at that value. Without the modifier the same
changes record as **Add** or **Multiply** steps, which move the target from
where it is. Use exact values when you want a macro that puts things in fixed
places. Keyframes, fills, and everything else record the same way in both
modes. The modifier applies to one press: it is not remembered. On the
keyboard, hold the same modifier and press Enter or Space on the Record key.
Both Record keys take it — the deck's key and the Record key on the empty
list.

**What the recorder watches is fixed when you press Record.** A chip above
the live feed names it: *Recording Layer A* or *Recording the whole scene*.
When you record a layer, an edit to any other layer is not recorded, and the
chip counts what it dropped: *2 changes outside Layer A ignored*. An exact
recording says so in the same chip: *Recording Layer A · exact values.*
A layer that did not exist when you pressed Record is always recorded: duplicate the
recorded layer, or any layer, and the copy joins the recording, and so does a
new layer or a scene layer you nest the recorded layer into. Scene settings
record only in a whole-scene recording. If your selection is not in the
active scene, the recorder falls back to the whole scene and the chip says so.

**Discard**, beside Stop at the bottom, throws the session away, and it asks
first when steps exist — *Discard this recording? Its 4 steps will be lost.* —
with **Discard recording** as the confirm key. Deleting a layer while you
record is itself a recorded step. Recording stops on its own only when the
scene goes away, and it says so.

**One scene per recording.** The recorder stays on the scene you started in.
If you switch scenes while you record, it adds one step that says so —
*You switched scenes — still recording "Scene 1"* — and it keeps recording
that first scene. The step is a marker: playback skips it. Delete it in the
review sheet, or leave it as a reminder.

---

## 3. Review and save

The review sheet shows the macro's name and every recorded step, in the same
recessed list the live feed uses. Each step reads as its property and its new
value, for example `position.x +60`. A transform step reads as the formula
it applies (see §5). Hover or focus a step to see the value it replaced. A
sentence above the list names what the macro applies to, including the
recorded layer for a single-layer macro.

| Control | What it does |
|---|---|
| **Macro name** | Defaults to *Macro N*, and Enter saves. |
| **× on a step** (hover) | Removes the step permanently. |
| **Eye toggle** (*Skip step N during playback*) | Keeps the step in the macro but makes playback skip it; click again to re-enable. |
| **Pencil** | Edits the step's value or formula inline (see §5). |
| **Pin** (*Ask for step N's value on every play*) | Marks the step as a parameter (see §8). |
| **Keep every step** | Shows the recording as it was captured, instead of the merged list the sheet opens with (see §4). The readout says what was merged: `12 → 5`. |
| **⊘ Skipped** | Not a control: Creator's plugin API cannot do this operation, so playback skips it. |
| **Save macro** | Stores the macro in Creator's plugin storage, which follows your account, not the file. |
| **Discard** | Drops the recording. |

You also get all of these controls later: expand a saved macro in the list to
see its steps and edit them in place. Your changes save immediately.

**Tip — select one layer before you record.** A macro recorded on one
selected layer replays on *any* selected layer later, and with nothing
selected it replays on the layer it was recorded on. A recording with nothing
selected watches the whole scene, and that is how you make structure macros.
It replays as a scene rebuild bound to its layers. The deck's readout tells
you which kind you are about to make.

---

## 3½. Turn existing animation into a macro

A layer that is already animated can hand its keyframes to a recording,
without re-authoring. While you record, select **one** layer that has
keyframes. A card appears above the live feed ("*Layer* has N keyframes on M
properties. Adding them also captures the layer's current values.") with two
choices:

- **Add all keyframes** takes the layer's whole state. Every animated property
  becomes keyframe steps, and its fills travel whole: solid stays solid, and a
  radial gradient stays radial. Replaying replaces a mismatched fill, and adds
  one where none exists. The rest of its current *look* — static transform
  values, stroke widths, text and font, and blend mode — rides along as value
  steps. Those steps read as `property = value` in the feed. Playing the saved
  macro recreates the motion and the look on any selected layer, at the
  playhead, with stagger. Position, scale, and rotation values deliberately do
  not move a replay target, because a style should not teleport the layer it
  lands on.
- **Add selected keyframes (n)** takes only the keyframes you selected on the
  timeline. On current Creator builds it shows **(0)** and is off, with the
  reason on the key: *Creator hasn't reported any selected keyframes to
  plugins*. That is a host limitation, not a broken button. The plugin also
  listens for the selection event, so the key lights up by itself the moment
  a Creator build starts delivering it. **Add all keyframes** is unaffected.

The offer follows your selection: select a different layer and it updates, and
deselect and it leaves. It shows for a single selected layer only, and not for
a scene layer, because a scene layer's content belongs to the scene it shows,
and every layer that shows that scene shares it.
After **Add all keyframes**, that key goes off for the layer and reads
*Already added*, so a second tap cannot double up the steps.

---

## 4. Simplify

A single drag produces a run of small steps (`position.x 0 → 12`, `12 → 40`,
`40 → 100`). The plugin merges every such run into one `0 → 100` step. It
also folds keyframe edit chains (add a keyframe, then nudge it three times)
into one net change. A scene setting you changed several times — the frame
rate, say — folds the same way, into one step from the first value to the
last. Steps whose net effect is nothing (rotate 45°, rotate back) disappear.

**The review sheet opens on the merged list.** The recorder samples twice a
second, so three deliberate edits can arrive as five steps, and the merged
list is the one that reads like what you did.

To see the recording as it was captured, select **Keep every step** above the
step list. The readout beside it says what was merged: `12 → 5`. Your choice
holds for every recording until you close the panel.

The switch rebuilds the list from the recording, so it also removes the step
deletions, the value edits, and the parameter pins you made in this review.
Make those edits after you choose the list you want.

Simplify will *not* do the following:

- merge across a structural step (adding a shape, duplicating a layer…) or a
  disabled step — those are boundaries
- merge a static edit with a keyframe edit on the same property

When there is nothing to merge, the switch stays put and says so (*Nothing to
merge*) rather than disappearing.

A saved macro keeps the manual **Simplify** button: expand its row in the
list and press it to merge the steps that are stored.

---

## 5. Edit a step's value

Hover or focus a step, then click the **pencil**. The pencil shows for steps
with an editable value, and for keyframe steps on a layer's transform. The
label becomes an editor:

| Recorded value | Editor |
|---|---|
| position, rotation, skew, skew axis, scale | a verb and a number box per component (see below) |
| number (opacity, width…) | number field |
| x/y vector (size…) | one field per component |
| color | color picker + hex field |
| text (blend mode, layer name) | text field |
| on/off flag | checkbox |
| a newly created layer | its name |

Press **Enter** or click away to commit. Press **Esc** to cancel. The step's
label updates to the new value. Path-geometry edits are not editable this
way — re-record those.

### The step's verb: set a value, or change it

A step on a layer's own position, rotation, skew, skew axis, or scale opens as
a verb and one number box. A vector property gets one row per component, **X**
and **Y**. Click the verb to change what replay does:

| Verb | What replay does |
|---|---|
| **Set to** | Sets the value to the number. |
| **Add** | Adds the number to the target's own value. |
| **Subtract** | Subtracts the number from the target's own value. |
| **Multiply** | Multiplies the target's own value by the number. |
| **Divide** | Divides the target's own value by the number. |
| **Formula…** | Hands the box a whole expression. |

You can also type the operator into the number box: a leading `+`, `-`, `*`,
`/`, or `=` selects the verb it names and leaves the box. Under **Set to** a
leading `-` is a negative number.

The verb you choose always wins. Between **Add** and **Subtract**, or
between **Multiply** and **Divide**, the number stays as you typed it:
**Add** `30` becomes **Subtract** `30`. Between those pairs and **Set to**,
the number converts through the value the step recorded, so it keeps
meaning the same edit. A drag from 100 to 130 opens as **Add** `30`. Choose
**Set to** and the box shows `130`. Choose **Multiply** and it shows `1.3`.
A step recorded from 0 cannot use **Multiply** or **Divide**, and **Divide**
needs a number that is not 0 — those items go quiet and say why.

Numbers show two decimals. A number that two decimals would flatten into
"changes nothing" — a shift of `0.00004`, a scale of `1.00001` — keeps the
digits it needs. What you type is stored as you type it, however many decimals
that is.

**Formula** is for everything the five verbs cannot say. Choose **Formula…**,
or type `v` anywhere in the number box and the verb changes on its own: `v` is
the value the target holds when the macro reaches it, and the box takes `+`,
`-`, `*`, `/`, parentheses, and one `v`. Type `v * 2 + 10` to multiply and then
add. `current` works as a synonym for `v`.

Four rules cover the rest:

- The default is relative. A recorded drag opens as **Add** `60`, a recorded
  rotation as **Add** `45`, and a recorded scale as **Multiply** `2` —
  position, rotation, skew, and skew axis shift each target from its own
  start, and scale multiplies. To record these steps as **Set to** instead,
  hold Option or Alt when you press Record — see §2.
- A recorded rotation of 0, skew of 0, skew axis of 0, or scale of 100% opens
  as **Set to** `0` or **Set to** `100`, because it is a reset. A delta to
  zero is never what you meant. This applies to macros you recorded before
  this version too.
- Only arithmetic that is linear in `v` is accepted. The box refuses `v * v`
  and `10 / v`, and says why in the line under it. An expression longer than
  200 characters is refused too.
- The box takes no references to other properties, layers, or scenes.

With nothing selected, a macro recorded on one layer rebuilds the recorded
result on that layer, and the formulas do not apply. Formulas matter when you
play the macro onto selected layers.

---

## 6. Play a macro

Click **▶** on a macro row. How the plugin applies the macro depends on what
the macro recorded.

**Macros replay onto layers.** Select the layer, not a shape inside it. A
shape in the selection is skipped, and the plugin says so once: *2 selected
shapes skipped — macros replay onto layers*. With no layer left in the
selection, you get the usual *Select a layer first*.

**Macros that touched one layer** apply to **every selected layer**. With
nothing selected, they apply to the layer they were recorded on, if it still
exists. The values adapt per target:

- each step on the layer's own position, rotation, skew, skew axis, or scale
  applies the formula in its box (see §5). The default shifts each target
  *from its own start*, and scale multiplies
- everything else — colors, child-shape geometry, and keyframe timing —
  applies exactly as recorded
- keyframed motion on the transform offsets the same way, anchored to the
  motion's first keyframe

**Macros that touched several layers or changed scene structure** replay as a
**scene rebuild**: each step finds its layer by identity, then by name, and
reports a skip if it cannot. Duplicate steps really duplicate, and edits
recorded on a copy go to the copy the replay created. Layers the replay
recreates keep their kind: a recorded text layer comes back as a real text
layer, with its text, font, size, and alignment applied. If the host cannot
create one, the plugin skips the step with a note rather than faking it. An
image layer is always such a step: a recording holds no image asset, so the
plugin reports *can't re-create an image layer — the recording has no image
asset — skipped*. Every other edit to that image layer replays normally when
the layer is already there.

**A nest step rebuilds the layers.** Creator gives no plugin a way to move a
layer into a scene, so the plugin rebuilds instead. It copies each selected
layer into the new scene, places the new scene where the first selected layer
was, and removes the originals. A run says *nested the 3 selected layers
(rebuilt inside the new scene — Creator can't move them)*. An image layer
cannot be copied, so it stays where it is: *an image layer can't be rebuilt
inside the new scene — left it where it was*, and the count drops to *nested 2
of the 3 selected layers*. If the rebuild fails, nothing moves: *couldn't
rebuild your 3 selected layers inside a new scene — left them where they are*.
With nothing selected, the plugin nests the layers it recorded. If they are
gone but the nested scene is still there — you replay in the scene you
recorded in — it uses that scene and says so: *Nested Scene 5 already exists
— using it*. With neither left, it rebuilds the nested scene from the
recording: *couldn't find the layers to nest — rebuilt Nested Scene 5 from
the recording instead*. The copies are new layers, so undo takes several
steps.

**Scene settings apply to the scene.** A step that recorded the size,
background, frame rate, duration, or name goes to the active scene once per
play, whatever you have selected. Playback names the setting it wrote, and it
says so when Creator keeps the old value.

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
- every other macro's Play key goes off and says why: *Another macro is
  playing*

The pace scales with the macro. A short macro steps about three times a
second. A long one — a whole captured timeline, say — speeds up: 15 steps
walk in about a second and a half, and 200 steps in about four seconds.

Three things can interrupt it:

- **A step fails** (for example, "Step 3 failed — couldn't find fill 2 to
  remove"): the row pauses with **Continue** / **Stop**.
- **Nothing to play on** ("Select a layer first"): click **Dismiss**.
- **You change your mind**: click **Stop** in the progress row.

Anything the plugin deliberately does *not* apply — a value the layer did not
need, or a fill it does not have — is never silent. The plugin collects it as
a **note** and shows a toast when the playback ends ("4 steps adapted or
skipped — this layer can't take masks (3 times) and other reasons"). That
toast stays for eight seconds, because it is the only account of what the run
adapted. The full list goes to the log for developers.

---

## 7. Play options

Click the **sliders next to ▶** to open the play options. In a very narrow
panel the sliders leave the closed row, and the ⋮ menu offers **Play
options…** instead. The dialog has **Play** and **Cancel**. What you choose
sticks to the row: the plain ▶ uses it too, and the row shows it
(`repeat ×8 · stagger 4 frames · at playhead`).

### At playhead

At playhead slides the whole macro along the timeline, so its **earliest
keyframe lands on the current playhead frame**. Record a 0→30 bounce once,
park the playhead at frame 120, and play at playhead: the bounce happens at
120→150. All keyframes in the macro move together, and static (non-keyframe)
edits are unaffected. **Newly recorded macros start with this on** — open the
play options to turn it off for the session.

A macro with no keyframes has nothing to slide, so At playhead moves the
**first target layer's in point to the current frame** instead. The layer's
own animation moves with the in point.

### Stagger

Stagger is meaningful only with several layers selected, so it is disabled for
macros that replay as a scene rebuild. It adds **N frames per layer**: the
first selected layer starts at the playhead, the second N frames later, the
third 2N later, and so on. That is a cascade in one click. Combine it with *At
playhead*, or leave the playhead off to stagger from the recorded frames.

#### Stagger on a macro with no keyframes

A macro of static edits has no motion to cascade, so stagger **delays the
layer** instead. The first selected layer keeps its in point, the second
starts N frames later, and the third 2N later. Each layer's own animation
moves with its in point, so an animated layer starts later as a whole. Turn
*At playhead* on as well, and the first layer's in point lands on the current
frame.

Four things to expect from the delay:

- The layers move in selection order.
- The delay happens once per run. With *Repeat*, only the first pass moves
  them.
- The plugin skips a layer whose new in point reaches its out point, and
  reports it as a note.
- The out point never moves, so each layer gets shorter as it moves later.

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
   pre-filled with the recorded value. A pinned transform step shows its
   formula, and you edit it for this play only. If the first pinned value is
   a color, its picker pops open on its own — pick, then Play.
3. Change what you want, then click **Play**. The macro replays with those
   values, and the saved macro is unchanged. **Cancel** returns to the list.

The form appears only when at least one step is pinned. Without pins, Play
replays the recorded values straight away. To change a value *forever*
instead, edit the step in place with the pencil. To be *asked each play*, pin
it.

Parameters survive Copy JSON, Import, and duplicate. Deleting a pinned step
drops its pin. A saved macro's *Simplify* keeps a pin when the pinned step is
the first of a merged run (the survivor), and drops pins on the steps it
merged away. The review sheet's **Keep every step** rebuilds the list from
the recording, so it drops every pin.

---

## 9. Manage macros

Each row in the list reads left to right: its position in the list, the
macro's name, then how many steps it holds as a two-digit count (`04`). Screen
readers hear the full "4 steps". A chevron in front of the number shows
whether the row is open, and it rotates when the row opens. Renaming a macro
keeps its number in place.

Below a 262px panel — about a 278px window — a closed row drops the leader and
the count to leave room for the name. The ⋮ menu adds **Play options…** there,
since the key no longer fits the row.

| Action | Where |
|---|---|
| Rename | ⋮ menu → Rename, then Enter to commit |
| Duplicate | ⋮ menu → Duplicate, which creates *name copy* |
| Copy JSON | ⋮ menu → Copy JSON, which puts the macro's JSON on your clipboard |
| Import | The import icon on the **Saved macros** header, which opens a dialog |
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
  ("Duration 30 frames"), and hover the **Steps (N)** heading for what the
  macro will touch — *Applies to selected layers, or the recorded one*, or
  *Rebuilds the scene — finds 2 layers by name*.

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
- **Leave the review sheet merged** if you dragged controls. The macro stays
  readable, and the replay is faster.
- **Select before you play.** One-layer macros apply to every selected layer.
  With nothing selected, they fall back to the original layer.
- **Read the notes toast.** "4 steps adapted or skipped — fills not found on
  this layer" is the macro telling you that the layer's structure differs. A
  run that only adapted says "adjusted" instead, and skipped nothing.
- **Name your layers.** A scene rebuild finds layers by id, then by **name**, so
  consistent naming makes macros portable across files.

---

## 11. Known limits

Confirmed platform limits live in `limitations.md` with evidence. You are most
likely to meet these:

- **Per-fill opacity** is not exposed to plugins — it records nothing.
- **Rectangle corner roundness** is not wired to the property the plugin can
  read — corner-radius edits record nothing.
- **Motion-path curves** (bezier handles between position keyframes) are not
  exposed either — curved motion replays as straight lines between the same
  keyframes.
- **A color token or slot** records as the flat color it resolves to, because
  the binding itself is not exposed. Replay applies that color, and the target
  keeps no token.
- **Effects and ungroup** have no plugin API at all, so the recorder never
  sees those edits.
- **Nesting selected layers into a scene** rebuilds them, because no API route
  moves existing layers into a scene. The plugin copies each selected layer
  into the new scene, and then removes the original. The copies are new
  layers, so undo takes one step per copy and one per removal. An image layer
  stays where it is, with a note. With nothing selected in the scene the macro
  was recorded in, the step uses the nested scene that already exists instead
  of building a copy next to it.
- **A new image layer** cannot be re-created on replay: a recording holds the
  layer, not the image asset behind it. The step says so and skips.
- **Macros replay onto layers**, so a shape in the selection is skipped with a
  note. Select the layer that holds the shape.
- Layer-reorder replay is live-verified: the macro records which layers it
  reordered, and replay checks them before it moves anything. Mask creation on
  replay was fixed in the 0.4.0 build, and a live session has not re-verified
  it since. Mask *edits* replay after the mask exists.
- Fast drags are sampled at 2 steps per second. The review sheet merges the
  result before you see it.
- Creator's plugin sandbox blocks file downloads. That is why sharing is
  **Copy JSON** and paste into **Import**, rather than a file export.
