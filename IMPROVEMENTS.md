# Improvements

Running log of issues found and fixed in the Macro Recorder plugin.

**Convention:** add one row per fix, at the top of the newest dated section,
right after the fix lands. Two columns only — what was wrong, and what changed.
Keep each to a sentence or two: this is a changelog to scan, not a design doc.
Reasoning belongs in `CLAUDE.md`, open findings in the failure taxonomy.

---

## 2026-08-22 — Vintage reel-to-reel skin

| Issue | Fix |
|---|---|
| First cut of the reels read as small dark discs — no brushed metal, no visible cut-outs, tape path and nameplate lost against the deck. | Reel artwork rebuilt: r44 brushed-metal flanges (radial gradient + concentric brushing rings) with three large cut-outs over a grooved tape pack, dark hub with six screws and spindle, corner rollers, a light two-line `MACRO-REC / MR-300` nameplate, and a tape path reel → roller → roller → reel. Same `.reel`/`.tape`/`.deck-furniture` hooks, so the state choreography is unchanged. |
| The panel looked like a generic SaaS list: library defaults, a teal accent nobody chose, and a look that changed under it whenever Creator pushed a theme. | One committed cream-and-ink skin. `VINTAGE_TOKENS` (`src/theme/vintageTokens.ts`) overrides every key the library's `theme.css` defines and is handed to `ThemeProvider`, which writes them inline on `<html>` — above both `:root` and `.dark`, so Creator's light and dark themes both land on the same panel. |
| Nothing in the panel said what the recorder was doing except a small bar that only existed while recording; playback had no panel-level state at all. | A reel-to-reel **deck** on every screen: two reels that spin while recording, rewind for 400ms when a macro is triggered, run forward while it plays and coast to a stop when it ends — plus a status lamp (red moving / amber paused) and a word (READY / RECORDING / REWIND / PLAYING / PAUSED / DONE). Derivation is pure and table-tested (`src/components/deck/deckState.ts`). |
| Record and Stop moved between screens: Record lived in a header that vanished while recording, Stop lived in a bar that only existed then. | Both are keys on the deck, on every screen, in the same place. `RecordingView`'s bottom bar is Discard alone, so there is exactly one button named "Stop" while recording. |
| Buttons were flat rectangles with no press affordance beyond a scale. | `.key` — ink outline, 10px radius, a hard 1.5px drop shadow the key travels into on `:active`. Doubled selectors (`.key.key`) so the recipe beats the library's `size="sm"` utilities, which land on the same element through `tailwind-merge`. |
| The deck's title block ("Macro Recorder" + a tagline) repeated the sr-only `<h1>` and took ~48px off the one thing in the card worth looking at. | Titles removed; above the stage is a thin instrument strip (lamp + state word, clock + counter) and the stage is full-bleed to the card's edges. The reels get the panel's whole width and the card got shorter at the same time. |
| Import sat in the footer next to a macro count, unrelated to the list it adds to; the footer said nothing else. | Import moved onto the **SAVED MACROS** section header; the footer is an instrument readout of what the panel holds (`N macros · M steps`). |
| The theme hook toggled a `dark` class and froze every transition around the flip — machinery for a theme switch that no longer exists. | `useTheme` still listens to Creator's theme relay (so the host theme stays observable) but applies nothing; the class toggle, the freeze effect and the DebugStrip's Light/Dark button are gone. |
| A tall deck would have crowded the step list in a short panel. | `container: panel / size` on the panel root plus `@container panel (max-height: 520px)`: the stage drops to a 56px slot showing the same reels cropped, and the nameplate, rollers and rivets are hidden. Under `prefers-reduced-motion` the reels do not turn at all — the lamp and label carry every state on their own. |

## 2026-08-22 — UI, accessibility and copy pass

| Issue | Fix |
|---|---|
| The reserved action lane took a fixed 6.25rem off every step row's label, so a 320px panel truncated labels that had room to spare — and the lane sat empty most of the time. | The lane is absolutely positioned at the row's end and paints `bg-inherit` over the label tail only while it is revealed. Labels get the full row width back; the buttons stay mounted and tabbable, and a pinned or skipped row keeps its state icon (and lane) visible at rest. |
| A skipped step dimmed the whole row to 50%, taking its action buttons and focus ring below contrast with it. | Only the label is muted and struck through (the kind icon slightly); the buttons and focus ring keep full contrast. |
| "Dismiss" on a pre-run playback error was styled destructive, though nothing had run and nothing was being abandoned. | The button is `destructive` only when a run is actually being stopped mid-way. |
| The playback progress row was one live region containing the Stop button, so every tick re-announced "Stop" along with the count. | `role="status"` moved onto the sentence alone; the button sits outside it. |
| The inline confirmation autofocused its destructive button — a prompt that appears unbidden with Enter already armed on "Delete". | Focus lands on Cancel; the message is a `role="alert"`. Confirm keeps its destructive styling. |
| The recording step counter was a live region ticking every 500ms, so screen readers read the count over everything else, and the far more useful "recording stopped, N steps" was never announced at all. | The counter is plain text; entering the review sheet announces `Recording stopped — N steps captured` once. |
| Stopping a playback — from a failure or from the Stop button — returned to idle silently, leaving the user unsure whether anything had been applied. | Both paths emit `Stopped "<name>" at step N of M — earlier steps are still applied`. |
| The notice live region held the message as plain text, so a repeated message (playing the same macro twice) changed nothing and was never announced a second time. | The message sits in a keyed span; every announcement remounts it, identical text included. |
| Play options were phrased twice: "×2 · +4f · @playhead" on the row and "Repeat ×2 · stagger 4 frames · at playhead" in the pre-play sheet. | One formatter, `describePlayOptions`, feeds both. The row badge truncates to 40% with the full text in `title` and a screen-reader long form. |
| Focus fell to the body whenever a control unmounted under it: the Play button vanished at the start of a run, a deleted step row took its delete button with it, and the overflow menu's Duplicate/Export left nothing focused. | The Play button stays mounted and becomes Stop for the running macro; deleting a step re-aims focus at the neighbouring row's delete button (or the header's Simplify); the overflow menu restores focus to its trigger except where the destination autofocuses its own control. |
| Dismissing the play-options dialog with Escape or an outside click kept the edits — the fields write straight through to the row — so an abandoned dialog silently changed what the bare Play button would do. | Any close but Play reverts to the values the dialog opened with. |
| `sharedLayerPrefix` inferred the shared layer from label *text*, so any label containing " · " could be mistaken for a layer prefix. | `sharedLayerName(steps)` reads `payload.layer.name` instead, ignores steps with no binding, and returns "" unless exactly one name is shared. Rows strip the prefix only when their label actually starts with it. |
| The pre-play sheet opened with four stacked grey lines — a generic heading, two overlapping explanations and a playback-mode hint already shown on the row — and repeated `recorded: …` under every field even when nothing had been changed. | Heading names the macro, one supporting line survives, and `recorded: …` appears only once a field differs from what was recorded. |
| A toast covered the footer's import button and macro count. | The footer pads itself clear while a toast is up (`ToastProvider` has no offset prop). |
| Explanatory lines under headers, rows and form fields were 10px — the same size as the row index, and below the panel's smallest readable size for prose. | Load-bearing hints promoted to 11px; 10px is now only the step index and the play-options badge. |
| The expanded step list collapsed the moment a macro started playing (and after the parameter form), so the just-wired running-step highlight never showed. | `expandedId` now rides through the `playing` and `configuring` states and comes back to idle, so the list stays open and the active row is highlighted and scrolled into view. |
| Every row in a single-layer macro repeated the same "Rectangle 1 · " prefix, and with the reserved action lane that left "Transform · …" at 320px. | `sharedLayerPrefix` strips a prefix every label shares and the header reads "6 steps on Rectangle 1" instead. |
| The Stagger field rendered "0frames". | Suffix spaced. |
| Demo mode (standalone dev / handshake fallback) emitted opaque `{mock:true}` steps, so Simplify, editing and parameter pins could never be demonstrated outside Creator. | The mock recorder emits real `StepPayload`s through `buildStep`, so demo mode exercises every v3.1 affordance — and the headless walk-through (`scratchpad/drive/walk.mjs`, 30 checks at 260/320px) can verify them. |
| Step-row actions were mounted/unmounted on hover (`hidden`/`flex`), so the label reflowed under the cursor, the buttons were invisible on touch, and the eye/pin swap jumped. | Actions are always mounted in a reserved lane and only their opacity changes; both eye glyphs cross-fade in place, the pin fills, and `[@media(hover:none)]` shows them permanently. |
| A macro row was a `role="button"` `<div>` containing Play, options and menu buttons — nested interactive content, with a keydown handler that swallowed Space/Enter. | The header is a plain row with a real disclosure `<button>` (chevron, `aria-expanded`/`aria-controls`) and the action buttons as siblings; the custom keydown/tabIndex/role are gone. |
| Toggles announced as unlabelled buttons whose name changed on click, and "won't replay" was a text badge in a font size the theme doesn't define. | Eye and pin have stable names plus `aria-pressed`; the badge is a `CircleSlash` icon with an sr-only explanation; rows carry `aria-current="step"` while playing. |
| Discarding a recording was one click away from losing every step, and there was no way to stop a run that was working but wrong. | Discard asks first (with the step count) and sits at the far left of the footer; the progress row has a **Stop** button, and stopping now cancels the run rather than only resolving a pending failure. |
| Notices existed only as toasts — invisible to screen readers — and error toasts timed out before they could be read. | A polite live region mirrors every notice, error toasts persist, playback success announces `Played "<name>"`, and Simplify announces `12 steps merged into 4`. |
| Nothing said what a macro would apply to until it ran. | `shared/playbackMode.ts#describePlaybackMode` mirrors the sandbox's `chooseMode` from the steps alone; the expanded row and the parameter form say "applies to the selected layers" or "scene script — finds N layers by name", and Stagger is disabled for scene scripts. |
| Play options lived inside the dialog, so the bare ▶ ignored them and nothing showed what was set. | Options belong to the row (`×8 · +4f · @playhead` next to the name), the plain ▶ uses them, and Cancel restores what the dialog opened with. |
| The parameter form had no labels bound to its fields, inline editors never received focus (`NumberInput` drops `autoFocus`), and Enter didn't submit. | `StepValueEditor` takes a required `label` (and optional `id`), focuses its first field via a ref, and the form is a real `<form>` with Enter-to-play; editing a step returns focus to the pencil it came from. |
| Notes and failures spoke API ("target", "node", "paint", `at index 0`, "this host") and dumped `[nest]` host-probing breadcrumbs into user-facing notes. | Note strings say layer/fill/stroke, 1-based positions, "Creator", and proper plurals; node types read as English via a display-name map in `shared/labels.ts`; nest breadcrumbs go to the debug trace only (`PlaybackStepDebug.breadcrumbs`). |
| Landmarks, headings and overflow were unset: two h1s, no `<main>`, and every scroller could scroll sideways. | One sr-only `<h1>`, an `<h2>` per mode, a `<main>` per mode body, `overflow-x-hidden` on every scroller, and the inert `sticky` classes removed. |
| Motion was inconsistent: no press feedback, panels appeared instantly, theme switches smeared through every element's transition. | A `.press` affordance on every button (except the playback decisions), `inline-enter`/`panel-enter` staggers, an inset ring on the success flash that still reads under `prefers-reduced-motion`, and a transition freeze around the theme class toggle. |

## 2026-08-22 — v3.1 pro-workflow features (ROADMAP.md)

| Issue | Fix |
|---|---|
| Position keyframes' motion-path bezier handles (spatial tangents) were never recorded — the serializer read only `frame/value/easing`, so curved motion replayed as straight lines. **Outcome:** live introspection showed the host does not expose them at all (LIMITATIONS.md); the defensive support stays dormant. | `KfSnap` gained `inTangent`/`outTangent`, read defensively (the typings omit them; their docs show them). The differ treats a handle-only edit as a keyframe change and keeps handles through move re-pairing; the applier writes them after add/change and **verifies the read-back**, noting "motion-path handle not supported by this host" instead of assuming. `record.start`'s debug probe now dumps a keyframe proxy's real surface so the next trace settles whether Creator exposes them. |
| A 500ms tick loop turns one drag into a dozen micro-steps; the only tool was deleting them one by one. | **Simplify** button (review sheet + macro detail): merges runs of value edits on one property into first→last (dropping net no-ops) and folds keyframe add/change/remove chains into one net delta. Never reaches across structural/scene ops or disabled steps. Manual, never automatic. |
| No way to keep a step but not run it, or to fix a recorded value without re-recording. | Steps can be **disabled** (eye toggle; playback sends only enabled steps) and **edited** inline (numbers, x/y vectors, colors, text, new-layer names) with the label rebuilt from the new value. Both persist and export. |
| Keyframed macros always replayed at the recorded frames — the one thing AE animation presets do that we didn't. | **At playhead** play option: `playback.begin` reads `creator.timeline.currentFrame` and shifts every recorded keyframe so the macro's earliest lands on the playhead (scene scripts too). **Stagger** adds N frames per selected layer for a cascade. |
| Compounding offsets (re-applying a macro to the same layer) were an accident, not a feature. | **Repeat ×N** play option: the client runs begin/steps/end N times; progress counts across iterations; a failure pause behaves exactly as before. |
| A macro's values were fixed at record time; the only "knob" was editing the macro itself. | **Parameters**: pin any editable step; playing the macro first opens a small form (defaults = recorded values), then plays an edited copy. Pins survive import/export (step ids are remapped). |

## 2026-08-22 — Nest-from-selection: verdict

| Issue | Fix |
|---|---|
| Whether nesting selected layers at replay was possible at all remained unproven through three rounds of guesses. | Instrumented every attempt with breadcrumbs; one live trace delivered the verdict: **confirmed platform limitation** — no API route moves existing layers into a scene (`createSceneLayer(layers)` undefined, no-arg ignores selection, `shiftTo` throws). Logged in LIMITATIONS.md with the upstream ask; the verified guess-chain stays so a future host fix lights up automatically. Replay meanwhile falls back honestly. |

## 2026-08-22 — Nesting from selection, order-based inside mapping

| Issue | Fix |
|---|---|
| Replaying the nest-macro on two selected layers produced an **empty** nested scene: the typings' `createSceneInstance` doesn't exist at runtime, and the real `createSceneLayer()` creates an empty shell. | Nesting is now a verified guess-chain: `createSceneInstance(layers)` if it ever ships → `createSceneLayer(layers)` → `createSceneLayer()` + the untyped `shiftTo` to move each selected layer in — each attempt verified by checking the created scene actually contains the layers; an unfillable shell is removed and the honest fallback reported. |
| Inside-nest edits could be redirected by shape-type matching, but a nest built from an arbitrary selection should map recorded edits **by layer order** (user decision: "color change should be applied based on layer order"). | Resolution inside instance content is strictly index-ordered — the recorded Nth layer's edits apply to the target nest's Nth layer, regardless of type. |

## 2026-08-22 — Nest macros as tools

| Issue | Fix |
|---|---|
| Running a nest-macro with two NEW layers selected didn't nest them — the step only looked for its recorded sources, found them already inside the old nest, and adopted it ("already exists — using it"). Replay-in-place also never re-executed creation steps. | Replay now means DO IT, in priority order: a non-empty selection is nested (tool semantics, like retargeted duplication — the inside-the-nest edits then apply to the new nest via the id map); otherwise the recorded sources are re-nested when they're at top level; adoption remains only for the case where nothing can be nested but the recorded result exists (prevents the empty-shell rebuild). Add-layer specs likewise always re-create on replay. |

## 2026-08-22 — Idempotent same-scene replays

| Issue | Fix |
|---|---|
| Replaying a break-macro in the scene where the break already happened rebuilt the result layers as duplicates — the originals were sitting right there (first live break replay showed it). The mirror case followed one trace later: a same-scene nest replay couldn't find its source layers (they were already inside the nested scene) and fell back to rebuilding an empty shell. | Layer rebuilds converge instead of duplicating: break fallbacks, add-layer specs, and nest results adopt an existing layer when its recorded id is still present (id-only match, so same-named layers in other scenes are never hijacked), and only rebuild what's missing. Same-scene replays are now idempotent for scene structure. |

## 2026-08-22 — Nested scenes ("create scene is not working")

| Issue | Fix |
|---|---|
| A recorded scene-instance layer rebuilt via `createShapeLayer` — the wrong layer kind entirely, so "create scene" replays produced nothing scene-like. | Layer rebuilding picks its factory by recorded type: SCENE specs use the untyped `createSceneLayer`. |
| Creator's "nest into scene" recorded only as raw structure (add scene layer + remove the nested layers), so replay removed layers by name and built an empty scene. | Detected as a semantic **`nest-layers`** step; replay resolves the recorded layers in the target scene and nests them via the real `createSceneInstance(layers)`, falling back to spec rebuild with a note. |
| Everything done INSIDE a scene instance was invisible (the 105-empty-tick sessions): instance content lives in the source scene, which the snapshot never traversed. | Instance content (`instance.scene.layers`) is serialized as the instance's child channel, so inside-instance edits record as deep steps and resolve at replay through the same channel. Content is shared between instances of a scene — edits affect all of them, as in Creator itself. |

## 2026-08-22 — Text layers, rename-tolerant resolution

| Issue | Fix |
|---|---|
| Text edits (font, size, content, alignment, color) recorded nothing — `TEXT_LAYER` doesn't exist in the typings, and its paints are SINGULAR `fill`/`stroke` objects rather than lists. Runtime introspection supplied the real surface: `text`, `fontFamily`, `fontSize`, `fontStyle`, `alignment`. | Text layers are first-class: font/text/alignment record as plain-prop steps and replay as writes; `fontSize` is probed both ways (animatable or plain); singular paints are modelled as one-item lists so the entire recolor pipeline — static, keyframed, cross-kind — applies to text color unchanged. |
| Steps recorded after a rename were bound to the new name only, so replaying in a scene where the layer still has its old name skipped them ("layer not found"). | Layer refs now carry the pre-rename name as an extra resolution key (id → name → prior name). |

## 2026-08-22 — Break scene, renames

| Issue | Fix |
|---|---|
| Breaking a scene instance recorded only as raw structure (remove instance + add its content layers), losing the semantic — replay rebuilt content from specs instead of breaking the instance. Runtime also revealed the real type name is `SCENE_LAYER` (typings say `SCENE_INSTANCE`) and that `TEXT_LAYER` exists. | One vanished SCENE-instance plus new layers in the same tick now records as a **`break-scene`** step; replay calls the instance's real `break()`, falling back to rebuilding the recorded result layers when it can't. |
| Layer renames were never recorded (missing since v1 — surfaced when a text-to-scene action renamed the source layer). | Name changes diff as `set-plain` on `name` at every tree level and replay as plain writes. |

## 2026-08-22 — Chained duplication

| Issue | Fix |
|---|---|
| Live retargeted replay (recorded on polygons, played on Star 4) proved the tool semantics — but exposed that a duplicate-of-a-copy cloned the base target instead of the first copy: Polygon 3's replay counterpart started from the star's state, not Polygon 2's (rotation 0, not 26). | A chained duplicate resolves its clone source through the replay's role map: the copy created for the recorded source is what gets cloned. Copies of copies now inherit the copy's state. |

## 2026-08-22 — Duplicate detection vs Creator's offset

| Issue | Fix |
|---|---|
| Mouse/⌘D duplication recorded as a fresh "add layer" with the full spec, not as a duplicate — so replaying onto an ellipse **drew polygons**. Root cause: Creator offsets the copy's position (and copies inherit the source's live rotation), which broke the structural "is this a copy?" match; spec-adds then forced scene mode, so retargeting never engaged. Confirmed in a live trace: every copy's initial rotation continued its source's. | Duplicate matching now compares content only — the layer's own transform statics are excluded from the structural key (a copy is a copy wherever it sits). The recorded step carries the copy−source position delta, and replay reproduces it: same-scene clones land at the recorded spot; retargeted clones shift by the delta from the SELECTED layer's own position. Duplicating onto an ellipse now duplicates the ellipse. |

## 2026-08-22 — Retargeted duplication

| Issue | Fix |
|---|---|
| A duplicate-macro ("duplicate the layer, move the copy") always cloned the RECORDED source layer — replaying with a different layer selected still duplicated the original star. As a reusable tool it should be relative to the target (user design call). | Mode analysis now recognizes a macro whose only pre-existing layer role is the duplicate source: with a selection, the duplicate **clones each selected layer**, the copy's recorded edits route to that clone, and motion offsets from the clone's own start. With nothing selected (or for multi-layer scene scripts) the previous same-layer semantics stand. |

## 2026-08-22 — Engine v3: whole-scene recording (multi-layer workflows)

| Issue | Fix |
|---|---|
| Duplicating a layer, pasting one, creating one, deleting one, or editing a layer other than the selected one recorded **nothing** — recording watched a single layer's subtree. The "star 6" duplicate test made this concrete. | Recording is whole-scene: every layer is snapshotted and diffed per tick. Layer-level ops became first-class steps: `add-layer` (with **structural duplicate detection** — a new layer that is a copy of an existing one, ignoring ids/names, records as a clone and replays via the real `node.clone()`), `remove-layer`, and `reorder-layers` (via the untyped move methods). Every in-layer step carries a layer binding. |
| Multi-layer replay semantics didn't exist. | Two modes, chosen automatically: a macro touching several layers (or restructuring the scene) replays as a **scene script** — steps resolve their layer by recorded id → name → skip-note, edits bound to a recorded duplicate resolve to the copy created during the replay, and values apply exactly. A macro touching at most one layer keeps the selection semantics (apply to each selected layer, smart offsets). Old macros keep working unchanged. |

## 2026-08-22 — Group re-creation

| Issue | Fix |
|---|---|
| Replaying a macro that created a group skipped it ("can't re-create a group") — groups have no factory; `createGroup` only wraps existing shapes. Hit twice in live replays. | A recorded group now replays by creating its child shapes on the parent first, then grouping them via `createGroup`, then seeding the group's name, transform, and fills. Targets without `createGroup` still skip honestly. |

## 2026-08-22 — Paint replacement on the real removal surface

| Issue | Fix |
|---|---|
| Converting a fill solid→gradient replayed as a **duplicate**: the target ended up with both fills, and the follow-up stops/start edits then resolved to the leftover solid and mis-adapted. Root cause: the typings promise `container.removeFill(index)` etc., but the real host has none of those methods — removal lives on the paint object itself (`paint.remove()`, visible in the introspection all along). | Paint/stroke/mask removal now tries the container method and falls back to the object's own `remove()`, verifying the list actually shrank. `replace-paint` reports honestly if the old paint could not be removed. Also proven live in the same trace: `addFill`-style creation of a gradient spec works, and gradient `start`-handle drags record. |

## 2026-08-22 — Path edits and trim paths

| Issue | Fix |
|---|---|
| Editing a path's points recorded **nothing** (40/40 empty ticks on "Path 1"): `PathData` and its points are getter-based host objects whose fields are invisible to `Object.keys`, so `toJson` serialized every path value as `{}` on both sides of the diff — silent by construction, same class as the fill-opacity gap. | Path values are now read structurally (`closed`, and each point's `vertex`/`inTan`/`outTan` vectors read field-by-field), in statics and keyframes alike. |
| Trim paths failed to record: they live on the untyped runtime surface (`node.trimPaths` / `createTrimPath`) that the typings omit, so the serializer never looked. | Trim paths are captured (`start`/`end`/`offset` as animatables, `mode` — names verified against a real trace on first try), diffed, and replayed: value edits and keyframes flow through the generic paths, add/remove replay via `createTrimPath()`/`trim.remove()`. |
| Replaying a trim animation onto a path with no trim path skipped all 17 steps (first live replay, "Path 2"). | Trim edits create the trim path on demand — the recorded end state wants a trimmed shape, so the target gets one, with a note. Targets that can't take one still skip honestly. |

## 2026-08-22 — Reorder replay

| Issue | Fix |
|---|---|
| Shape reorders were recorded but badged "won't replay" — the published typings show no reorder API. Runtime introspection found the host actually exposes untyped `moveBefore`/`moveAfter` on every shape. | Reorders now record as a replayable survivor permutation and replay via those methods: the recorded order is realized against the target's shapes (extra target shapes keep their place at the end), the result is verified by re-reading the list, and a partial apply is reported instead of hidden. Targets whose shapes lack the methods skip with a note. |

## 2026-08-22 — Skip visibility, fill-opacity hunt

| Issue | Fix |
|---|---|
| Skipped steps were easy to miss: the end-of-run toast said only "Played with N steps skipped". (Per user decision: a fill step that doesn't fit the target is skipped, never guessed into child shapes — but the user must know.) | The toast now names the dominant reason, deduped: "4 steps adapted or skipped — fills not found on this target" (+ full list in the console). |
| Fill opacity still unrecordable — every probe under expected names finds nothing on the real paint objects. | **Resolved as a platform limitation**: runtime introspection (own + prototype chain) proves the paint proxy exposes only `color`/`type`/`remove`, colors carry no alpha, and dragging the fill-opacity slider produces zero observable change (10/10 empty ticks). Documented in the README; not recordable via the plugin API. Bonus discovery: `Animatable` exposes untyped `clearKeyframes()` and `getValueAt()` methods. |

## 2026-08-22 — Fresh-engine verification round

| Issue | Fix |
|---|---|
| An **animated** fill-color macro replayed onto a gradient-filled layer skipped every color keyframe (honest notes, but nothing animated) — the adaptive paint logic only covered static recolors. Found live in a trace within minutes of the fresh engine running. | Keyframed recolors now adapt too: solid-color keyframes onto a gradient animate its stops (every stop tinted per keyframe); keyframed stops onto a solid animate its color via the first stop. |
| Fill opacity, resolved the hard way: the real host's paint objects expose no `opacity` property at all (confirmed — fresh recordings while editing paints carry only `kind`/`color`), so the probe finds nothing to record. | Nothing further to fix engine-side; the limitation is the plugin API's. The layer-level opacity control records and replays fine. Documented as a known limit. |

Everything else from the original bug reports verified fixed on real Creator data this round: frame-0 keyframes land (sentinel workaround proven live), keyframe value edits record as `changed` (no id-churn destruction), scale multiplies per component, gradient-onto-solid adapts with notes, deep child-shape recording works, and skipped static writes on animated properties report themselves.

## 2026-08-21 — The stale-sandbox root cause, fill opacity

| Issue | Fix |
|---|---|
| **Every "still failing" report today traced to one cause**: `@lottiefiles/vite-plugin-creator` recompiles the sandbox bundle only when `plugin/plugin.ts` itself changes — edits to `applier.ts`, `recorder.ts` or `shared/*` kept serving a stale `plugin.js` forever, so re-adding the plugin in Creator reloaded the same old engine (stuck at rev .5 all day). | The dev server now touches the entry file whenever any engine source changes, forcing the vendor plugin to recompile and push its hot-reload. Restarting `pnpm dev` is no longer needed after engine edits. |
| The engine-rev mismatch warning only went to the console, where nobody looks. | An unmissable in-panel banner: "Plugin engine is outdated (rev X vs Y) — remove and re-add the plugin." |
| Fill opacity was never recorded: the published API typings omit per-paint `opacity`, so the serializer never read it (confirmed in the trace — paints carry only color/stops). | Paint opacity is probed defensively (present in Creator's UI even if not in the typings), diffed, replayed, and carried through paint re-creation. |
| "Scale not maintained" and "gradient onto solid fails" re-reports | Both verified fixed in the current engine (scale records per-component and multiplies from each target's baseline; paint-kind mismatches adapt or skip with notes) — the observed failures came from the stale .5 sandbox above. |

## 2026-08-21 — Engine v2: deep recording, one semantics

| Issue | Fix |
|---|---|
| Shape geometry never recorded: a rectangle's `size`/`roundness` (and star points, path data) live on child shapes inside the Container, which the flat recorder never visited. Three registry entries matched no real API property at all. | Snapshots are recursive over the whole shape subtree with a per-node-type property registry verified against the plugin API; groups recurse; masks, gradients (start/end/stops/highlights) and plain layer flags (visibility, lock, blend mode, in/out points) are captured too. |
| Structural edits half-worked: paint removal and re-creating shapes "failed honestly", paint type changes were smuggled through a best-effort stops write, masks were invisible. | New replayable ops via the real mutation APIs: add/remove/replace paints and strokes, add/remove masks, add/remove shapes (recreated from the recorded subtree end-state, keyframes included). Shape reorders are recorded but badged "won't replay" — the plugin API has no reorder call. |
| Replaying a deep step onto a target whose shape list differs would miss or hit the wrong child. | Deep paths carry the recorded shape's type; the applier resolves by index first, then re-finds by type, then falls back to an only child — each adaptation noted. |
| The per-macro "As offsets / Exactly" choice confused more than it helped. | Removed entirely (UI, state, protocol, storage). One semantics: layer transforms offset from each target's own start, everything else applies exactly. Old exports with a `mode` field still import; the field is ignored. |
| Playback required a selection even when the user just wanted to re-run the macro on the recorded layer. | Macros remember their source layer; with nothing selected, playback falls back to it if it still exists. |

## 2026-08-21 — Adaptive fill targeting

| Issue | Fix |
|---|---|
| A fill recolor was bound to the recorded paint's exact shape: gradient-stops steps failed on solid-fill targets (and vice versa), even though a layer effectively has a single fill and "recolor the fill" is the obvious intent. | Paint paths that don't resolve now adapt instead of skipping: gradient stops onto a solid fill apply the first stop's color; a solid color onto a gradient tints every stop; a recorded index beyond the target's list remaps to its first paint. Each adaptation is reported as a note. Same rules for stroke paints. |

## 2026-08-21 — Color and scale on other layers (third trace batch, fresh engine)

| Issue | Fix |
|---|---|
| A "simple color change" on a gradient-filled layer replays as a gradient-stops write; on a solid-fill target the path doesn't exist, the step hard-failed, the user hit Stop — and the macro's perfectly applicable **scale and rotation steps never ran**. Scale replay itself was never broken. | Path-resolution misses in `set-static`/`keyframes` steps are now skip-notes instead of run-stopping failures ("fills[0].stops not found on this target — skipped"). The rest of the macro applies; skipped steps are reported at the end. |
| The frame-0 sentinel workaround was silently defeated on real Creator: `getKeyframeAt(0)` on a keyframe-less property returned a truthy occupant, so playback "converged" a phantom instead of creating the keyframe — no error, no keyframe. | `keyframeAt` returns nothing when the property has no keyframes at all, and every keyframe creation path now goes through a single verified add (add → check → sentinel → check → loud failure). The fake scene gained a phantom-occupant control so the case stays tested. |

## 2026-08-21 — Keyframes on another layer (second trace batch)

| Issue | Fix |
|---|---|
| **Creator silently ignores `addKeyframes` at frame 0 on a not-yet-animated property.** Every playback of a macro beginning with "Keyframe @ 0" lost that keyframe on a fresh target — no error, nothing to report. Once a property is animated, frame 0 inserts fine (confirmed across four playback traces). | The applier verifies every add landed; when the host drops one, it seeds animation with a sentinel keyframe at another frame, retries the add, removes the sentinel, and fails loudly only if the keyframe still refuses to exist. The fake scene now models the quirk so tests can catch regressions. |
| In *As offsets* mode, keyframe values applied verbatim — replaying a position animation onto another layer snapped it to the recorded layer's coordinates instead of animating from its own position. With the recorded start far away, this read as "keyframes not applied". | Keyframed values now shift from the target's baseline exactly like static edits: origins are anchored to the recorded motion's lowest-frame value per path, so the target's animation starts where the target sits and moves by the recorded delta. *Exactly* mode still applies recorded values verbatim. |
| The static-write guard blocked writes whenever `isAnimated` was true — but traces show Creator keeps `isAnimated=true` after every keyframe is removed, and the contract only voids writes while keyframes *exist*. Writes to animated-but-empty properties were skipped with a wrong note. | Guard now checks `keyframes.length > 0` instead of `isAnimated`. |
| Creator evaluates `plugin.js` once at plugin load and never re-fetches it, so the sandbox silently ran a stale engine while Vite served a fresh UI — an entire batch of traces reproduced already-fixed bugs and nearly sent the investigation in circles. | `hello` now returns an `ENGINE_REV`; the UI compares it at handshake, stamps both revisions into every trace, and logs a loud "plugin engine is STALE — reload the plugin" warning on mismatch. |

## 2026-08-21 — Keyframe identity (found from real Creator traces)

| Issue | Fix |
|---|---|
| Replaying a macro **destroyed keyframes and reported success**. A trace showed a target going from keyframes at `[1, 126]` to `[1]`, and another from `[125]` to `[]`, with no failure and no note. Four more steps created a keyframe and deleted it again, netting nothing. | `applyKeyframes` skips a removal whose frame is also in the step's `added` list. The addition describes the intended end state, so it wins. Protects macros already saved with these payloads. |
| Root cause: Creator reassigns a keyframe's `id` when its value is edited, and recycles ids from a pool (one trace showed `f08K → Tgw1 → 0kxd → m-pg → f08K` on a single property). The differ keyed keyframes by id whenever both snapshots had them — which is always — so an ordinary value edit was recorded as "removed one, added one" at the same frame. 7 of 16 keyframe payloads in one recording were affected, with zero genuine moves. | `diffKeyframes` keys strictly by frame; a property cannot hold two keyframes at one frame, so frame is the only stable identity a recorded keyframe can carry. Re-diffing the captured trace now yields 0 same-frame pairs and 12 correct `changed` entries, up from 5. |
| A keyframe dragged along the timeline would have become an unlabelled add+remove pair once id-keying was dropped, losing the "moved" reading in the review list. | When exactly one addition and one removal remain unmatched and carry the same value and easing, they are re-paired as a move. |
| Dragging a keyframe onto a frame the target already used left **two keyframes sharing one frame**, silently. Frame is now the only identity a keyframe has, so a duplicate frame makes subsequent lookups ambiguous — the next step could resolve to either one. | A frame-moving `changed` entry removes whatever occupies the destination first, and every creation path goes through a single upsert helper that updates an existing keyframe rather than stacking a new one. Reported as `replaced the keyframe at N`. |
| Playback probes recorded keyframe *frames* but not values, so "value updated in place" and "nothing happened" looked identical in a trace — the blind spot that made two of these steps hard to classify. | Probes now capture each keyframe's frame and value, plus fill/stroke counts so `add-fill`/`add-stroke` steps have something observable. |

## 2026-08-21 — Keyframe replay

| Issue | Fix |
|---|---|
| Replaying a macro onto a layer with a different timeline died mid-run: `keyframe @ 67 not found to remove`. A 16-step macro stopped at step 5, leaving 11 steps unapplied. | Keyframes now converge on the recorded end state instead of replaying deltas. Removing a keyframe the target never had is a no-op with a note, not a failure. |
| Updating a keyframe the target didn't have threw `keyframe @ N not found to update`. | Creates the keyframe at the recorded frame and value, since that is the end state the macro describes. Reports a note. |
| Adding a keyframe at a frame the target already used stacked a second one at the same frame. | Existing keyframe at that frame is updated in place. |
| One bad entry in a step's `added` list threw immediately, dropping the rest of the batch *and* skipping the step's `removed`/`changed` work entirely. | Each entry applies independently. All failures are collected and reported together rather than only the first. |
| The write fallback removed a keyframe and re-added it; if the removal threw, it added anyway, silently leaving two keyframes at one frame. | The fallback only re-adds when the removal actually succeeded. A failed removal is reported instead of producing a duplicate. |
| Keyframes were matched by recorded id first. `Keyframe.id` is readonly and engine-assigned, so a recorded id can never match another layer's keyframe — the branch was dead weight that masked how matching really worked. | Matching is by frame only, via the API's `getKeyframeAt(frame)` with a defensive scan fallback. |
| Writing a static value to a property that is animated on the target is discarded by Creator without error. Playback reported these as successful, so a macro could half-apply while claiming to have worked. | `set-static` checks `isAnimated` first and returns a note (`"<prop> is animated here — static value not applied"`). Notes surface as a toast when the run finishes and are logged in full to the console. |

## 2026-08-21 — Diagnostics

| Issue | Fix |
|---|---|
| A failing macro gave no way to see what actually happened: no logging existed anywhere except one `console.warn`, and inside Creator the dev strip never rendered because it required mock gateways. | Dev sessions write a trace bundle per run to `traces/`, carrying every RPC call, the snapshot pair behind each recorded step, and per-target before/after probes for each playback step. A `TraceStrip` gated on `import.meta.env.DEV` alone renders in both engine and mock mode. |
| The fake scene in `host-harness.html` accepted `staticValue` writes on animated properties, unlike the real host — so tests written against it could not reproduce the silent no-op class of bug. | Extracted to `shared/testing/fakeScene.ts`, shared by the harness page and vitest, and corrected to discard those writes like Creator does. Failure injection added for deleted nodes, unreadable properties, and failing keyframe add/write/remove. |
