# Improvements

This is the engineering log: what was wrong, what changed, one row per fix,
newest first. `CHANGELOG.md` is the user-facing record of the same work — this
file is the internal one.

**Convention:** Add one row per fix, at the top of the newest dated section,
right after the fix lands. Two columns only — what was wrong, and what changed.
Keep each to a sentence or two: this is a changelog to scan, not a design doc.
Reasoning belongs in `../architecture.md` and `../design-system.md`, and open
findings belong in the failure taxonomy.

---

## 2026-09-03 — Spin the reels; no text selection; flatter chassis

| Issue | Fix |
|---|---|
| **The hero was look-only.** | At rest (Ready or Paused) you can drag a reel and fling it: both reels turn together, coast with friction, the tape highlight runs with them and the counter becomes a tape counter until they stop. Inert while recording or playing. |
| **A drag across the panel painted a text selection.** | Text selection is off for the whole panel; inputs and text areas keep it. |
| **The chassis' raking highlight read as a smear at 300px.** | The chassis keeps only its brushed grain and a near-flat gradient. |
| **The window's glass band looked like a ray of light between the reels at 300px.** Its stops were percentages of the window, so it faded nicely on a wide window and collapsed into a narrow diagonal stripe on a 274px one. | The band is gone. The window keeps a faint sheen at its top-left corner, and the light is a broad, soft pool in the centre of the stage behind the reels, sized in percentages of the stage so it is the same pool at 274px and at 600px. |

---

## 2026-09-03 — Hero chassis edges at panel size

| Issue | Fix |
|---|---|
| **The hero's top and left edges looked cramped in Creator.** The chassis' lit top band, its chamfer highlight (drawn twice), the window bezel and a 10px-deep inner shadow all stacked inside a 5px gutter, and the window's 8px radius left an uneven sliver of chassis in each corner of the panel's 10px corner. | The chassis gradient is nearly flat, the top/left highlight is one hairline, the chamfer draws only the falling-away edges, the window recess is shallow, the glass band is fainter, and the window radius is 6px so it nests inside the panel corner. |

---

## 2026-09-03 — UI polish pass (visual audit, eleven findings)

| Issue | Fix |
|---|---|
| **The Simplify count was red.** `5 → 3` sat beside the key in the failure colour, so it read as a warning. | The count is muted ink at weight 500; the key keeps its wand and word. |
| **Counts were styled two ways.** The recording header's `2 steps` was the panel's only bordered pill; the list header and every row use bare mono readouts. | The recording count is a bare two-digit readout, `02 steps`, in the same ink. |
| **The disabled Import key was pink.** The red key at half opacity looked faded rather than dead, and got pressed. | A cream dead key: flat fill, muted legend, hairline edge, no travel. |
| **Import outranked the section title.** A bold uppercase word beside `SAVED MACROS`. | Icon-only, with the name in the tooltip and accessible label. |
| **Two red stops while paused on an error.** The lid's stop square and the notice's STOP key were both red. | The lid square goes quiet grey while the failure notice is open. |
| **Step rows truncated the property, not the value.** `Transform · position.x 1… → 160` cut the one word that says what changed. | Rows show property and result (`Transform · position.x → 160`); the before value is kept for the tooltip and screen readers. The result is capped at half the line. |
| **The review step list sat directly on the paper** while the recording feed sat in a rack well. | The review list seats in the same well. |
| **The review header truncated the layer name** (`on Rectan…`). | The header is `Steps (N)`; the layer is spoken in the hint: *Applies to selected layers, or to Rectangle 1 if none is selected.* |
| **The open card's lid showed two chevrons pointing opposite ways.** | Only the leading chevron remains, rotated when open. |
| **Renaming removed the card's number.** | The `01` stays in front of the rename field. |
| **In a narrow panel the macro name truncated first** while the leader, count and three action icons kept their space. | Below a 262px panel, closed rows drop the leader, the count and the play-options key, and the ⋮ menu offers **Play options…**. Open cards and wider panels are unchanged. |

---

## 2026-09-03 — Hero visual: studio-deck reels

| Issue | Fix |
|---|---|
| **The tape moved the wrong way, and from both ends.** The redrawn stage had two separate tape runs leaving each reel, and the reels turned clockwise while the highlight ran left to right along the bottom — a reel whose bottom edge moves right is turning counter-clockwise. | The tape is one threaded path: off the left reel's outer side, around the bottom-left roller, along the bottom behind the nameplate, around the bottom-right roller, up onto the right reel. Play and record now turn the reels counter-clockwise with the tape; rewind turns them clockwise. The short run over the nameplate stays, and travels the opposite way to the outer tape so the two read as one loop. The rollers stay in the collapsed deck so the tape never wraps around nothing. |
| **The reel stage read as a flat diagram.** Each reel was a plain disc with three round holes, a tape head sat between them, and the model legend was silkscreen on the plate, so the hero looked like an icon rather than the recorder the panel is styled as. | The stage is redrawn after a studio deck's faceplate: spun-silver three-spoke reels with filleted cut-outs over a wound pack, a bolted hub and axle cap, a fixed top-left sheen that does not turn with the reel, tape running from each pack to a guide roller in the bottom corner and to a riveted nameplate that carries the name and the version. The rotation, shimmer and reduced-motion behaviour are unchanged, and the stage keeps its 117px height. |

---

## 2026-08-26 — Seed-macro trace sweep: three fixes (rev .52)

| Issue | Fix |
|---|---|
| **Every add-mask step was skipped on the live host.** The applier only looked for `container.addMask`, which the real host does not have — it exposes `createMask` (live trace 08-15-40). The mask was never created, and every follow-on edit on `masks[0]` cascaded into a "not found" skip, so a masking macro replayed as nothing at all. | `add-mask` now mirrors its siblings exactly: `addMask` → `createMask` → the "this layer can't take masks — skipped" note, the same fallback `add-stroke` and the new-layer rebuild already used. |
| **A reorder-layers step could silently reshuffle a foreign scene's real layers.** The payload carried raw positions and nothing else, so replaying it anywhere but the recorded scene permuted whichever layers happened to sit in those slots — with no note, no failure, and no way to see it in a trace (08-15-02). | The payload now carries the reordered layers' identities. Replay resolves every one of them against the live scene first (id → name → priorName) and reorders only when they ALL check out; a single miss changes nothing and says which layer it couldn't find. Layers the recording never saw keep their positions. A legacy payload with no identities still reorders, but now says it did so without verifying. |
| **The Style stamp demo's blendMode step never applied.** It seeded `"NORMAL"`, but the host's `BlendMode` is a lowercase union, so a live host threw "✗ Invalid input" and the step the macro exists to demonstrate was skipped every time. | The seed uses `"normal"`, and the fake scene now validates the union on assignment — the same class of casing bug can no longer pass in tests while failing on a real host. |
| **Structural and scene ops were invisible to trace probes.** `add-mask` / `add-trim` / `add-stroke` probed the entry they create, which has no readable value, so both sides read null and "created" looked exactly like "silently skipped" (08-13-16); scene ops probed `[]` on both sides, leaving reorder, nest, and break structurally unauditable (08-15-02). | Structural probes read a member of the created entry (mask opacity, trim end, stroke width), so an unreadable before against a readable after IS the creation signal; removals probe the entry itself. Scene ops probe an ordered `{id, name, type}` summary of the scene's layers, capped at 25 and defensively read, so their outcome is visible in the trace. |

---

## 2026-08-26 — Demo seed macros

| Issue | Fix |
|---|---|
| **The dev seed data was three trivial macros** — a move, a recolor, and a spin, all one layer, all targets mode. Nothing in the panel ever exercised scene scripts, masks, trims, text layers, capture-shaped steps, disabled steps, pinned params, or play options without recording them by hand first, and one of the three carried a stroke-color step on a path the applier can't resolve, so it silently skipped on every playback. | Ten seed macros that combine features: both playback modes, every scene op (add/remove/reorder/nest/break), cross-kind paint adaptation, masks, trims, a text layer, a chained retargeted duplicate, a capture-shaped style stamp, a disabled step, and pinned parameters with stagger + repeat. Every one is replay-verified in tests — `sandbox/demoMacros.replay.test.ts` drives all ten through the real playback orchestrator against the shared fake scene and asserts zero failures, with `ui/dev/demoMacros.test.ts` pinning their shape (labels, param targets, disabled steps, mode). |

---

## 2026-08-26 — Motion tokens triaged; token hunt added to the debug probe (rev .51)

| Issue | Fix |
|---|---|
| **Applying a color token recorded/replayed as a flat RGB fill** — the token binding never survived a macro. | Confirmed a platform limit, not a recorder/playback bug (`../limitations.md`, conclusive): no token/slot surface exists on any enumerated paint/node/scene proxy, and the rev .51 probe's hunt through the last unprobed routes (`node.data`, `node.toJSON()`, scene-root `slots`) came back empty in two independent sessions — `toJSON()` is an `{id,type}` stub on this host, so no document route exists at all. The recorder can only ever see the resolved color; the ask is upstream. |

---

## 2026-08-26 — Paced playback

| Issue | Fix |
|---|---|
| **The completion flash was red** — the run-finished row flash used the action red, which reads as failure/danger, and now clashed outright with the red failed-step marker. | The flash uses a new `--lamp-green` success pilot-lamp token (muted green, matched to the amber lamp), so finished reads as finished. |
| **Playback applied instantly with no per-step feedback** — a macro landed as one jump, the step list only ever marked the "current" row (usually too briefly to see), and nothing said afterwards which steps had actually played. A failed step's mark vanished the moment you pressed Continue. | Playing now auto-expands the macro's card and walks its steps one at a time, Photoshop-actions style: pending rows dim, the running row's numeral lights up, a landed step shows a ✓ and a failed one a red marker that stays for the rest of the run. The dwell is a whole-run budget (~4.5s, clamped 45–300ms per step), so a 200-step macro walks as fast as a 5-step one is deliberate. UI-only — no engine change. |

---

## 2026-08-26 — Trace sweep: fill fix confirmed live; two probe/apply gaps closed (rev .50)

| Issue | Fix |
|---|---|
| **Trace sweep verdicts (10 traces, revs .47–.49):** the fill fix works live (topology remap replaced Ellipse 1's root fill for real), Macro 2's relative-offset replay is exact, simplify folding correct, .48/.49 field rollout clean, all fixed taxonomy items holding. The `selection:keyframes` event fired 311× in one session — every payload empty (limitation now conclusively triple-evidenced). | Evidence appended to `../limitations.md`'s entry; historical 08-24 backlog marked processed (superseded by fixes). |
| **`probe()` was blind to paints** — `replace-paint` probes read `.staticValue` off a Paint proxy (null/null, no unreadable flag), and topology-remapped writes probed at the *recorded* path — a fill swap was indistinguishable from a silent failure in traces. | Paint-shaped resolved values probe as a summary (`{paintType, color, stops}`), and a path that fails to resolve on the target follows `resolvePaint`'s role-based descent to the paint that was actually written. |
| **`set-plain` could create phantom properties** — the best-effort shape fallback can resolve a different node type (an ELLIPSE geometry for a group's `blendMode` path); bare assignment then *created* the flag and the read-back trivially passed — a mis-applied write reporting success. | The applier pre-reads the flag: a clean `undefined` means the node doesn't carry it → skip note (a *throwing* getter still writes — write-only flags stay writable). |

---

## 2026-08-26 — Standing inline nudge; compact toasts (rev .49)

| Issue | Fix |
|---|---|
| **The no-selection nudge was a toast** — it vanished on its own timer instead of tracking the state it describes. | Now a standing inline row on the recording screen (dashed quiet chip above the feed, third in the slot chain after discard-confirm and the capture offer — which needs a selection, so they can never collide). It rides a live `selectionCount` in every tick and leaves by itself the moment a layer is selected. Toast dropped. |
| **Toasts were a full-app-sized dark slab** — the library hardcodes `bg 10% black`, `text-15`, 20px icons, full width; at 300px it dwarfed every instrument. | Restyled via the panel's library-override pattern: a compact ink chip (26px tall, panel cream on `#2A2623`, 12px type, 14px status icons, width hugging content) that reads as the machine's annunciator. Also: captured `before === after` labels now render `= value` on fills/strokes branches too ("width 3 → 3" → "width = 3"). |

---

## 2026-08-26 — Nudge toward single-layer recordings (rev .48)

| Issue | Fix |
|---|---|
| **Nothing steered users toward selecting a layer before recording** — no-selection sessions that add fresh layers produce scene scripts pinned to those layers, and users didn't learn why their macros wouldn't retarget. | `record.start` now reports `selectionCount`; when it's 0 the UI nudges without gating: an info toast at start plus guidance in the empty live feed ("record with one layer selected to make a macro you can replay on any layer"). Whole-scene/structure recordings stay first-class — REC is never disabled, no confirm interstitial (user decision: option A only). |

---

## 2026-08-26 — "This layer can't take fills" on retarget (rev .47)

| Issue | Fix |
|---|---|
| **Replaying a captured fill onto another ellipse failed at step 0** ("Ellipse 1: this layer can't take fills") — a topology mismatch: the source layer kept its fill inside a GROUP (`shapes[0].fills[0]`), the target keeps its own at the layer root, and replay resolved the target's bare geometry shape (no fills, no `addFill`) and threw. Worse, the code path removed the old fill *before* discovering it couldn't create the new one (harmless in the live traces only because the removal happened to fail first). | Paint ops now resolve the target's fill **by role, not recorded path**: `resolvePaint` descends the first-shape chain from the root when the recorded container holds no paints (works in both directions, group→flat and flat→group), `replace-paint` checks creation capability **before** removing anything, degrades to writing the spec onto the existing paint in place when the host can't swap fills, creates the fill on capable bare targets, and notes every adaptation. Deep component recolors gain the same fallback. |

---

## 2026-08-26 — "Add selected" verified against live traces; event fallback (rev .46)

| Issue | Fix |
|---|---|
| **"Add selected" never worked live** — five debug sessions (revs .42–.44) prove `creator.selection.keyframes` is a real but permanently EMPTY array on the host: `selectedCount` stayed 0 even with 21 keyframes on the offered layer, so the key was always disabled. ("Add all", by contrast, is fully live-verified: up to 198 captured steps retargeted with 0 failures.) | Filed in `../limitations.md` with the trace evidence. Rev .46 subscribes to the typed `selection:keyframes` event (feature-detected) and feeds the offer/capture from the latest event payload when the getter polls empty — the remaining route by which the host could deliver the selection; `selectionIntrospection` now reports `events: {supported, fired, lastCount}` so the next trace settles it. The disabled key's tooltip now tells the truth ("Creator hasn't reported any selected keyframes to plugins"). Triage taxonomy gains #16 (zero-delta transform statics: intentional) and #17 (this platform limit). |

---

## 2026-08-25 — Capture carries the whole fill (rev .45)

| Issue | Fix |
|---|---|
| **"Add all" still lost the fill's KIND** — component steps can't say "this is a radial gradient", so a captured radial degraded to linear on conversion, and a target with no fill note-skipped the look entirely. | Capture now emits each fill first as a `replace-paint` with its complete snapshot (kind, gradientType, statics — animated-only components seeded from their earliest keyframe), then the animated components as keyframes ops on the fresh paint. Replay replaces a mismatched fill outright and adds one where none exists. Text layers' singular fills keep component capture (no replace surface). Also recorded live: `creator.selection.keyframes` exists on the real host ("Add selected (0)" rendered) — noted in `../runtime-api.md`. |

---

## 2026-08-25 — Gradient macros convert solid fills (rev .44)

| Issue | Fix |
|---|---|
| **A gradient macro couldn't change a target's fill type** — gradient `stops` landing on a solid fill adapted to the first stop's color only, so the full gradient never arrived ("we are not able to change fill type"). | Gradient stops (static or keyframed) on a solid LIST fill now **convert** the fill — remove + recreate as a gradient carrying the full stops (the replace-paint mechanism), with a note ("was solid — converted it to a gradient"); later `start`/`end` steps then find a gradient and apply directly. Singular text fills and strokes keep the first-color adaptation (no removal semantics); solid-onto-gradient still tints every stop. |

---

## 2026-08-25 — Capture grabs the whole layer, not just keyframes (rev .43)

| Issue | Fix |
|---|---|
| **"Add all" captured motion but not the layer's look** — static properties (rotation parked at 15°, a fill that never animates, text content, blend mode) were left behind, so a captured macro couldn't reproduce the layer. | Scope-all capture now emits the full state: keyframes ops first, then every static animatable as `set-static` and the content plain flags (text/font/size/alignment/blendMode — never visibility/lock/timeline flags/name) as `set-plain`, all `before === after`. Replay semantics fall out of the existing engine: deep paths apply exactly ("make it look like this"), length-1 transform statics are additive with a zero delta so a retargeted style capture doesn't teleport the target. Equal-pair steps label as `prop = value` (a state, not a transition). "Add selected" stays keyframes-only. |

---

## 2026-08-25 — Capture existing keyframes into a recording (rev .42)

| Issue | Fix |
|---|---|
| **Existing layer animation couldn't become a macro** — the recorder only diffs *changes*, so a layer's pre-existing timeline keyframes were invisible to it; users had to re-author motion while recording. | While recording, selecting a single keyframed layer raises an inline offer above the live feed — "Add all" pulls every animated path of the layer's subtree in as `keyframes` steps (synthesized from the tick's own snapshot through `buildStep`, so they replay/retarget/at-playhead like anything recorded); "Add selected" appears when the host's typed-but-unverified `selection.keyframes` surface proves live, matching by frame+value. Capture reads `lastSnapshot`, so it can never double-emit against the diff stream; a debug-session probe (`selectionIntrospection`) will turn the unverified surface into `../runtime-api.md` ground truth. |

---

## 2026-08-25 — Expanded card: play from the footer

| Issue | Fix |
|---|---|
| **The open macro card had no Play** — expanding a row traded the lid's play/options/overflow cluster for the footer's options + overflow, but playback itself required collapsing first. | The footer's control row now leads with a play key (stop while that macro plays, mounted across the run like the lid's), so the open card carries every lid ability. The Duration readout gave up its visible seat: the frame span rides the play key's tooltip and an sr-only span. |

---

## 2026-08-24 — Set values → Play dead inside Creator

| Issue | Fix |
|---|---|
| **The configure sheet's Play did nothing inside Creator.** The sheet relied on native form submission (`<form onSubmit>` + `type="submit"`), and Creator hosts the panel in a sandboxed iframe — a sandbox without `allow-forms` silently blocks the submit event, so `onPlay` never ran: no `playback.begin`, no trace, no play. Standalone tabs were unaffected, which is why every earlier check passed. | Play is a `type="button"` with an explicit `onClick`; Enter in a field plays via the form's `onKeyDown`; `onSubmit` stays but only prevents default, so environments that DO allow submission can't double-fire. Verified headless: click and Enter both start playback, no double-run. |
| **A play stuck on a failure banner held its trace hostage.** `trace.flush` ran only in the run loop's `finally`, but a step failure `await`s the user's Continue/Stop first — an un-dismissed banner meant the run's events flushed into the NEXT trace (or were lost with the panel), which is exactly why the failing session left no playback trace to triage. | The gateway flushes the trace when a failure banner appears (pre-run and mid-run), before waiting on the decision; the loop-end flush still carries the remainder. |

---

## 2026-08-24 — Set-value flow fixes (traces 09-25/09-27)

| Issue | Fix |
|---|---|
| **A color step edit silently reverted.** The row editor commits on blur-outside — but the native color picker is a separate OS window, so opening it blurred the page (`relatedTarget: null`), which committed the untouched draft and unmounted the editor mid-pick; the chosen color landed nowhere and playback used the recorded value ("set value and then play is not working"). | The blur-commit now ignores blurs while `document.hasFocus()` is false — a page-level blur is the picker opening, not the user leaving the editor. Enter / clicking away still commit. |
| **A color parameter took two gestures to reach the picker.** The configure sheet focused the swatch but the picker needed another click. | The autofocused color field calls `showPicker()` (try/catch: browsers refuse it in cross-origin iframes, where the focused swatch still opens on Enter/Space). |
| **New macros ignored the playhead by default** — replaying a recorded animation always landed on its original frames until *At playhead* was switched on per row, per session. | Newly recorded macros save `playOptions: { atPlayhead: true }`; the row seeds its play options from the macro (`MacroRow`), imports carry the field, and the popover still overrides per session. |

---

## 2026-08-24 — Text-property trace triage (11 traces, rev .41)

| Issue | Fix |
|---|---|
| **Replayed text layers were shape shells.** `createLayerFromSpec` routed every non-`SCENE*` type through `createShapeLayer`, so an `add-layer` of a `TEXT_LAYER` rebuilt a SHAPE_LAYER named "Text 1" with no text surface — every later text/font/size/alignment write landed on nothing, and re-recording that layer captured nothing (live aftermath in trace 2026-08-24T07-49-36-061). | The factory now matches the recorded type: `TEXT_LAYER` → `createTextLayer` (feature-detected; a host without it skips with a note instead of silently building a fake). |
| **A host-swallowed `set-plain` write reported success.** `owner[flag] = after` only noted a thrown error; a proxy that accepts the assignment and keeps its own value produced a step that changed nothing with no failure and no note. | The applier reads the flag back defensively: a mismatch surfaces as a note naming the flag; an unreadable read-back makes no claim; a normal write stays silent. |
| **Traces couldn't verify text applies.** `probe()` read `.staticValue` off whatever `resolvePath` returned, so a `set-plain` scalar path (`text`, `fontSize`, …) probed `null` on both sides regardless of outcome; keyframe probes also never carried easing, so easing-only edits looked like no-ops. | Plain scalars now probe as themselves; keyframe probe entries carry `easing` when readable (`TargetProbe` gains the optional field). |
| **`recordStop`'s "recorded nothing" debug fallback misfired.** It keyed off the *final tick* being quiet, so any debug session ending on a quiet tick got the whole-session snapshot pair stapled to an empty step list — making healthy recordings look like an entire layer's diff was dropped (3 traces). | The fallback now fires only when the whole *session* emitted zero steps (`RecordingSession.stepped` tracks it); a quiet final tick after real steps keeps its empty delta empty. |

---

## 2026-08-24 — UI audit quick wins (full-panel design critique)

| Issue | Fix |
|---|---|
| **The recording screen's only bottom action was Discard** — the screen's natural next step (Stop → review) lived solely in the deck, so the one full-width key at the foot was the destructive exit. | Bottom bar now mirrors the review bar it hands off to: **Stop** as the red CTA (same action as the deck's key), Discard as the outline secondary beside it. Retires the earlier "exactly one Stop while recording" rule (see `../design-system.md`); drivers matching Stop by name scope to `stop-button` (deck) / `stop-recording-button` (bar). |
| **The overflow menu's Delete item was click-dead when the menu opened low.** `DevSettings` wore `relative z-[1]` inside `#root`, so the dev strip out-stacked the portalled menu's `z-auto` positioner — the menu's bottom ~30px painted under the strip and `elementFromPoint` on "Delete" returned the DEV SETTINGS toggle (the same stacking trap `index.css` documents for `#root`). | Dropped the `z-[1]`; being positioned and later in the DOM already wins over the scrolling rack rows. Re-probed: all three hit-test points on Delete land in the menu, and a real mouse click opens the delete confirm. |
| **The configure sheet was the one screen speaking the wrong voice** — a 14px sans-medium title ("Set values for …"), the only `text-14` in `ui/`, against every sibling's red instrument-caps header. | Header joins the convention: `SET VALUES` in `instrument instrument-red`, the macro name on its own mono line (truncating, `title`-carried), full title kept for screen readers. |
| **"← Review & save" promised a back navigation that didn't exist** — the arrow lived in a plain `<p>`; the only real exits are Discard/Save. | Dropped the arrow; the header stays as a label, which is what it is. |
| **Two Discards during discard.** While a discard confirm was up (recording and review), the bottom-bar Discard that summoned it stayed live — a second button asking the question already on screen. | The bottom Discard is `disabled` while its confirm is open, in both `RecordingView` and `ReviewPanel`. |
| **The quiet icon-key chrome was hand-rolled four times** (`MacroRow`, `OverflowMenu`, `PlayOptionsPopover` triggers — verbatim copies — plus `StepRow`'s lane with drifted hover colour and radius). | One shared `ICON_KEY_CLASS` (`ui/components/iconKey.ts`) for the three triggers; the step lane keeps its visibility behaviour but now matches the family's `rounded-[7px]` and `hover:text-foreground`. |
| **Names displayed in mono, edited in sans** — the rename input and MACRO NAME input switched the same string to the sans face the moment it became editable. | Both inputs set in `mono`. |
| **Radius strays outside the skin's 4/7/10 family**: disclosure hover pill 5px, recording count pill 6px, colour swatch 2px/2px. | Normalized: pills join 7px, swatch outer 4px with a 3px nested inner. |
| **Quote marks split by surface** — typographic quotes in the configure sheet, straight quotes in every toast and confirm (`Saved "…"`, `Delete "…"?`). | All user-facing name quoting is typographic (“…”) — confirms, save/play/stop/import/copy notices — with tests updated to match. |
| **DEV SETTINGS wrapped to two lines at 260px** — the only wrapped instrument label in the app. | The label is `whitespace-nowrap shrink-0`. |

Full audit (findings, evidence, and the [larger] backlog: toast placement over
action rows, unskinned toast, deck STOP dead during playback, Simplify
dropping pins silently, inline step-edit commit affordance) → `ui-audit-2026-08-24.md`.

## 2026-08-24 — Macro sharing without file downloads

| Issue | Fix |
|---|---|
| **Export JSON did nothing inside Creator.** The plugin iframe is sandboxed without `allow-downloads`, so the blob-anchor download was silently dropped — no file, no error (filed in `../limitations.md`). | Macros now travel as copied JSON: ⋮ → **Copy JSON** tries the async clipboard, then a hidden-textarea `execCommand("copy")` in the same gesture, and falls back to a dialog with the JSON pre-selected for a manual ⌘C; **Import** opens a paste-JSON dialog that feeds the existing `importMacro` validation and shows parse errors inline. Verified headless: granted-clipboard copy → paste → macro in the list, and the denied-clipboard fallback dialog with auto-selected JSON. |

## 2026-08-23 — Compaction pass: one-chassis hero, denser list

| Issue | Fix |
|---|---|
| The deck read as a flat dark rectangle: no glass over the reels, no edge thickness, keys that were a face with a drop shadow. | Physicality pass (CSS only): a specular sheen + vignette + lit lip over the reel window (`.deck-stage::before`), a chamfered chassis with a 2–3px lower edge (`.deck-chassis::after` + outer shadows), and true keycaps — lighter top face, a 3px side wall (`.key-plate::after`) that collapses on press while the face darkens, so the pressed state reads without motion. Hero height unchanged (155px at 300×520); REC still hit-tests to the button; reduced motion keeps the darkened press, instantly. |
| The hero cost 203px — **39% of a 300x520 panel** — because it was a cream card *containing* a dark plate, plus a cream status strip above it: two surfaces, two sets of padding, and a strip repeating what the plate could say itself. | The hero is now a single dark chassis (`.deck-chassis`) with the reel window bezelled into it and the transport row — lamp + state word, RECORD, STOP, LCD counter — sitting directly on the faceplate. New `.key-plate` variant for light keycaps on the dark ground; the clock moved onto the faceplate between the reels, where the transport row has no space for it and where it reads as a real deck counter. **203px → 156px** with the reels no smaller (stage 110px, reel 102px). |
| A macro row spent 56px on one name because the step count sat on its own second line, and an expanded macro spent **80px** of header — a count, a button, and two full sentences of prose — before showing a single 26px step. | Name, step count, and the play-options badge share one line; the expendable "Changes save automatically" hint is gone and the playback-mode hint is one truncating line. **Row 56px → 38px, step header 80px → 42px.** |
| The footer existed to print "N macros · M steps" and cost a border and 31px for it. | Folded into the "Saved macros" header row, which had space beside the label. The toast-clearance padding that footer secretly carried moved onto the scrolling `<main>`, or bottom-centre toasts would have covered the last row. |
| "Applies to the selected layers (or the recorded layer if nothing is selected)" no longer fit on one line, so the density pass truncated it mid-word. | Shortened at the source to "Applies to selected layers, or the recorded one" — same meaning, fits at 300px, no ellipsis. |
| The hero still floated on the paper inside 8px of panel padding, so it read as a picture of a deck rather than the panel's own faceplate — and the padding was pure cost. | The chassis is full-bleed and square-cornered, rendered straight into `.panel-root`. The reclaimed top padding went into stage height, which is what actually converts width into reel size: the drawing was HEIGHT-limited at 110px, so widening alone would have added empty faceplate. At 117px it is width-limited and fills the glass. **Reels 102px → 108.5px (+6.4%) for 1px less hero.** |
| The two transport keys were different widths and sat left-of-centre with the status legend and counter competing for the same row, so they read as controls parked on the hero rather than part of it. | `.deck-keys` is an equal-column grid and the row's only child, so the pair is mathematically centred on the chassis (measured 0.0px off-centre at 260/300/320px). The status legend and counter moved onto the faceplate's window corners — the one arrangement that fits, since equal gutters around a centred pair leave less room than "RECORDING" needs. Both got the recessed pane the counter already had, so neither sits unreadably on bright reel metal. |
| **The overflow menu opened but ignored every click.** `#root` carried `z-index: 1` (added for the paper-grain overlay), which made it a stacking context painted above the portalled menu — whose own `z-50` does nothing, because that element is `position: static`. `elementFromPoint` at the menu's centre returned the macro row's button, so real mouse clicks went to the row underneath. Scripted clicks skipped hit-testing and "passed", which is why no test caught it. | `#root` keeps `position: relative` and drops the z-index; it still sits above the grain by DOM order. Verified by hit-testing the menu centre and by a real, hit-tested mouse click on Rename. |
| **The play-options dialog flew in diagonally from outside the panel.** The library centres it by layout (resting `transform: none`) but still applies shadcn's translate-based entrance, which assumes the dialog is centred BY that transform — so it started ~138px left and ~121px above its home. | `[role="dialog"]` zeroes `--tw-enter/exit-translate-*`, leaving the intended zoom + fade. Entrance drift measured 102x90px → **6x5px**. |
| The faceplate's model number `MR-300` was invented. | It now reads the real package version, injected at build time as `__APP_VERSION__`, so the nameplate cannot drift from the release. |
| The list still read as software rather than equipment, and the reference the user kept trying to send could not reach this session. | Sketched three directions on a design canvas — machined plate, card index, console readout — with the current design beside them and each option's tradeoff written out, so the choice could be made by pointing instead of describing. Direction C was picked and built: mono names, a dotted leader running to a two-digit step count, a lit `--primary` index, dotted row rules in one shallow well. Rows 38px → 32px. The two-digit readout is `aria-hidden` with an `sr-only` "N steps" beside it — "04" spoken aloud means nothing, and the driver asserts that text. |
| The macro list was N floating cards — N borders, N radii, N drop shadows — with an outlined box around every one of the three icon buttons on every row. Busy, and it read as web UI sitting under a piece of hardware. | The list is one seated panel (`.rack`): rows butt together and separate with an engraved groove (dark rule + white lip, lit by the same lamp as the deck). Row actions lost their permanent outlines and show a box only under the pointer. Expanding a row opens a recessed compartment (`.rack-drawer`) that is darker than the step plates seated in it, so steps sit IN something — the recording feed's list got the same treatment, since its rows had just become the same tone as the card behind them. |
| The deck had bevels, gradients, and shadows, but each was authored in isolation — some highlights on top edges, some omnidirectional, and no surface at all over the reel window. A pile of individually-correct gradients still reads as graphics. | Everything re-lit from ONE source, high and slightly left: a four-sided chamfer on the chassis (top catches light, bottom occludes, sides differ), a raking highlight across the brushed grain, glass over the reel window (specular band + corner vignette, so you look THROUGH the pane rather than at the mechanism), a recessed collar on the lamp whose lit states now bloom onto the plate, and scanlines behind the counter digits. All CSS, no markup, no height: hero still 155px, reels and rotation unchanged, 32/32 driver checks. |
| The step counter was still parked in the faceplate's top-right corner, floating out of line with everything else. | It joined the clock in the row's trailing track as one recessed counter window (time, divider, count), so every control and readout now sits on the key line and the faceplate is clear. |
| The status legend and clock had been pushed onto the faceplate to make room for centred keys. | With `REC` shrinking the pair to ~122px there is now ~84px per gutter, so the row is a `1fr auto 1fr` grid: legend, centred keys, clock — all on one line, keys still measured 0.0px off-centre at 260/300/320px, hero still 155px. |
| "Record" was a long legend for a transport key. | The faceplate legend is now `REC`, the tape-deck abbreviation, with `aria-label="Record"` keeping the accessible name intact. Keys went 74.6px → 58.2px each. |
| Net effect | The macro list went from 224px to **302px** of the same panel: room for ~6 rows where 3 fit before, and an expanded macro now shows 4 steps plus the next row instead of one or two. |

## 2026-08-22 — Vintage reel-to-reel skin

| Issue | Fix |
|---|---|
| First cut of the reels read as small dark discs — no brushed metal, no visible cut-outs, and tape path and nameplate lost against the deck. | Reel artwork rebuilt: r44 brushed-metal flanges (radial gradient + concentric brushing rings) with three large cut-outs over a grooved tape pack, dark hub with six screws and spindle, corner rollers, a light two-line `MACRO-REC / MR-300` nameplate, and a tape path reel → roller → roller → reel. Same `.reel`/`.tape`/`.deck-furniture` hooks, so the state choreography is unchanged. |
| The panel looked like a generic SaaS list: library defaults, a teal accent nobody chose, and a look that changed under it whenever Creator pushed a theme. | One committed cream-and-ink skin. `VINTAGE_TOKENS` (`ui/theme/vintageTokens.ts`) overrides every key the library's `theme.css` defines and is handed to `ThemeProvider`, which writes them inline on `<html>` — above both `:root` and `.dark`, so Creator's light and dark themes both land on the same panel. |
| Nothing in the panel said what the recorder was doing except a small bar that only existed while recording; playback had no panel-level state at all. | A reel-to-reel **deck** on every screen: two reels that spin while recording, rewind for 400ms when a macro is triggered, run forward while it plays and coast to a stop when it ends — plus a status lamp (red moving / amber paused) and a word (READY / RECORDING / REWIND / PLAYING / PAUSED / DONE). Derivation is pure and table-tested (`ui/components/deck/deckState.ts`). |
| Record and Stop moved between screens: Record lived in a header that vanished while recording, Stop lived in a bar that only existed then. | Both are keys on the deck, on every screen, in the same place. `RecordingView`'s bottom bar is Discard alone, so there is exactly one button named "Stop" while recording. |
| Buttons were flat rectangles with no press affordance beyond a scale. | `.key` — ink outline, 10px radius, a hard 1.5px drop shadow the key travels into on `:active`. Doubled selectors (`.key.key`) so the recipe beats the library's `size="sm"` utilities, which land on the same element through `tailwind-merge`. |
| The deck's title block ("Macro Recorder" + a tagline) repeated the sr-only `<h1>` and took ~48px off the one thing in the card worth looking at. | Titles removed; above the stage is a thin instrument strip (lamp + state word, clock + counter) and the stage is full-bleed to the card's edges. The reels get the panel's whole width and the card got shorter at the same time. |
| Import sat in the footer next to a macro count, unrelated to the list it adds to; the footer said nothing else. | Import moved onto the **SAVED MACROS** section header; the footer is an instrument readout of what the panel holds (`N macros · M steps`). |
| The theme hook toggled a `dark` class and froze every transition around the flip — machinery for a theme switch that no longer exists. | `useTheme` still listens to Creator's theme relay (so the host theme stays observable) but applies nothing; the class toggle, the freeze effect and the DebugStrip's Light/Dark button are gone. |
| The deck's collapse threshold (`max-height: 520px`) was the exact panel height README tells you to develop at, so at every realistic size — 300x520, 260x480 — the hero rendered as a 56px letterbox with the reels sliced through their middle. The animation was effectively invisible: half a reel reads as texture, so the rotation had nothing to register against. | Threshold moved to 400px, set where the *list* actually stops working rather than where the deck merely gets big. At 300x520 the stage goes 56px -> 113px (109px reels) with 212px of list still below it. Below 400px the stage now scales the whole drawing down to 76px instead of cropping it, so the reels stay whole and keep turning. |
| The reels were the only thing moving — one motion layer, and a three-fold symmetric one, so it could say "turning" but never "which way". Rewind (400ms) was over before it registered. | Two layers added: a dashed highlight travelling the tape path (the only element that can express direction) and a warm ambient glow on the plate while recording. Rewind is now two fast backwards revolutions over 700ms and the finish coasts for 900ms, with `REWIND_MS`/`DONE_MS` kept equal to the CSS durations. Measured: 34.6°/250ms of reel rotation, shimmer wrapping seamlessly at its dash period, both `none` under `prefers-reduced-motion` while the lamp and label still change. |
| A tall deck would have crowded the step list in a short panel. | `container: panel / size` on the panel root plus `@container panel (max-height: 520px)`: the stage drops to a 56px slot showing the same reels cropped, and the nameplate, rollers, and rivets are hidden. Under `prefers-reduced-motion` the reels do not turn at all — the lamp and label carry every state on their own. |

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
| Explanatory lines under headers, rows, and form fields were 10px — the same size as the row index, and below the panel's smallest readable size for prose. | Load-bearing hints promoted to 11px; 10px is now only the step index and the play-options badge. |
| The expanded step list collapsed the moment a macro started playing (and after the parameter form), so the just-wired running-step highlight never showed. | `expandedId` now rides through the `playing` and `configuring` states and comes back to idle, so the list stays open and the active row is highlighted and scrolled into view. |
| Every row in a single-layer macro repeated the same "Rectangle 1 · " prefix, and with the reserved action lane that left "Transform · …" at 320px. | `sharedLayerPrefix` strips a prefix every label shares and the header reads "6 steps on Rectangle 1" instead. |
| The Stagger field rendered "0frames". | Suffix spaced. |
| Demo mode (standalone dev / handshake fallback) emitted opaque `{mock:true}` steps, so Simplify, editing, and parameter pins could never be demonstrated outside Creator. | The mock recorder emits real `StepPayload`s through `buildStep`, so demo mode exercises every v3.1 affordance — and the headless walk-through (`scratchpad/drive/walk.mjs`, 30 checks at 260/320px) can verify them. |
| Step-row actions were mounted/unmounted on hover (`hidden`/`flex`), so the label reflowed under the cursor, the buttons were invisible on touch, and the eye/pin swap jumped. | Actions are always mounted in a reserved lane and only their opacity changes; both eye glyphs cross-fade in place, the pin fills, and `[@media(hover:none)]` shows them permanently. |
| A macro row was a `role="button"` `<div>` containing Play, options, and menu buttons — nested interactive content, with a keydown handler that swallowed Space/Enter. | The header is a plain row with a real disclosure `<button>` (chevron, `aria-expanded`/`aria-controls`) and the action buttons as siblings; the custom keydown/tabIndex/role are gone. |
| Toggles announced as unlabelled buttons whose name changed on click, and "won't replay" was a text badge in a font size the theme doesn't define. | Eye and pin have stable names plus `aria-pressed`; the badge is a `CircleSlash` icon with an sr-only explanation; rows carry `aria-current="step"` while playing. |
| Discarding a recording was one click away from losing every step, and there was no way to stop a run that was working but wrong. | Discard asks first (with the step count) and sits at the far left of the footer; the progress row has a **Stop** button, and stopping now cancels the run rather than only resolving a pending failure. |
| Notices existed only as toasts — invisible to screen readers — and error toasts timed out before they could be read. | A polite live region mirrors every notice, error toasts persist, playback success announces `Played "<name>"`, and Simplify announces `12 steps merged into 4`. |
| Nothing said what a macro would apply to until it ran. | `engine/playbackMode.ts#describePlaybackMode` mirrors the sandbox's `chooseMode` from the steps alone; the expanded row and the parameter form say "applies to the selected layers" or "scene script — finds N layers by name", and Stagger is disabled for scene scripts. |
| Play options lived inside the dialog, so the bare ▶ ignored them and nothing showed what was set. | Options belong to the row (`×8 · +4f · @playhead` next to the name), the plain ▶ uses them, and Cancel restores what the dialog opened with. |
| The parameter form had no labels bound to its fields, inline editors never received focus (`NumberInput` drops `autoFocus`), and Enter didn't submit. | `StepValueEditor` takes a required `label` (and optional `id`), focuses its first field via a ref, and the form is a real `<form>` with Enter-to-play; editing a step returns focus to the pencil it came from. |
| Notes and failures spoke API ("target", "node", "paint", `at index 0`, "this host") and dumped `[nest]` host-probing breadcrumbs into user-facing notes. | Note strings say layer/fill/stroke, 1-based positions, "Creator", and proper plurals; node types read as English via a display-name map in `engine/labels.ts`; nest breadcrumbs go to the debug trace only (`PlaybackStepDebug.breadcrumbs`). |
| Landmarks, headings, and overflow were unset: two h1s, no `<main>`, and every scroller could scroll sideways. | One sr-only `<h1>`, an `<h2>` per mode, a `<main>` per mode body, `overflow-x-hidden` on every scroller, and the inert `sticky` classes removed. |
| Motion was inconsistent: no press feedback, panels appeared instantly, theme switches smeared through every element's transition. | A `.press` affordance on every button (except the playback decisions), `inline-enter`/`panel-enter` staggers, an inset ring on the success flash that still reads under `prefers-reduced-motion`, and a transition freeze around the theme class toggle. |

## 2026-08-22 — v3.1 pro-workflow features (roadmap-v3.1.md)

| Issue | Fix |
|---|---|
| Position keyframes' motion-path bezier handles (spatial tangents) were never recorded — the serializer read only `frame/value/easing`, so curved motion replayed as straight lines. **Outcome:** live introspection showed the host does not expose them at all (`../limitations.md`); the defensive support stays dormant. | `KfSnap` gained `inTangent`/`outTangent`, read defensively (the typings omit them; their docs show them). The differ treats a handle-only edit as a keyframe change and keeps handles through move re-pairing; the applier writes them after add/change and **verifies the read-back**, noting "motion-path handle not supported by this host" instead of assuming. `record.start`'s debug probe now dumps a keyframe proxy's real surface so the next trace settles whether Creator exposes them. |
| A 500ms tick loop turns one drag into a dozen micro-steps; the only tool was deleting them one by one. | **Simplify** button (review sheet + macro detail): merges runs of value edits on one property into first→last (dropping net no-ops) and folds keyframe add/change/remove chains into one net delta. Never reaches across structural/scene ops or disabled steps. Manual, never automatic. |
| No way to keep a step but not run it, or to fix a recorded value without re-recording. | Steps can be **disabled** (eye toggle; playback sends only enabled steps) and **edited** inline (numbers, x/y vectors, colors, text, new-layer names) with the label rebuilt from the new value. Both persist and export. |
| Keyframed macros always replayed at the recorded frames — the one thing AE animation presets do that we didn't. | **At playhead** play option: `playback.begin` reads `creator.timeline.currentFrame` and shifts every recorded keyframe so the macro's earliest lands on the playhead (scene scripts too). **Stagger** adds N frames per selected layer for a cascade. |
| Compounding offsets (re-applying a macro to the same layer) were an accident, not a feature. | **Repeat ×N** play option: the client runs begin/steps/end N times; progress counts across iterations; a failure pause behaves exactly as before. |
| A macro's values were fixed at record time; the only "knob" was editing the macro itself. | **Parameters**: pin any editable step; playing the macro first opens a small form (defaults = recorded values), then plays an edited copy. Pins survive import/export (step ids are remapped). |

## 2026-08-22 — Nest-from-selection: verdict

| Issue | Fix |
|---|---|
| Whether nesting selected layers at replay was possible at all remained unproven through three rounds of guesses. | Instrumented every attempt with breadcrumbs; one live trace delivered the verdict: **confirmed platform limitation** — no API route moves existing layers into a scene (`createSceneLayer(layers)` undefined, no-arg ignores selection, `shiftTo` throws). Logged in `../limitations.md` with the upstream ask; the verified guess-chain stays so a future host fix lights up automatically. Replay meanwhile falls back honestly. |

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
| Skipped steps went unnoticed: the end-of-run toast said only "Played with N steps skipped". (Per user decision: a fill step that doesn't fit the target is skipped, never guessed into child shapes — but the user must know.) | The toast now names the dominant reason, deduped: "4 steps adapted or skipped — fills not found on this target" (+ full list in the console). |
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
| **Every "still failing" report today traced to one cause**: `@lottiefiles/vite-plugin-creator` recompiles the sandbox bundle only when `sandbox/plugin.ts` itself changes — edits to `applier.ts`, `recorder.ts`, or `engine/*` kept serving a stale `plugin.js` forever, so re-adding the plugin in Creator reloaded the same old engine (stuck at rev .5 all day). | The dev server now touches the entry file whenever any engine source changes, forcing the vendor plugin to recompile and push its hot-reload. Restarting `pnpm dev` is no longer needed after engine edits. |
| The engine-rev mismatch warning only went to the console, where nobody looks. | An unmissable in-panel banner: "Plugin engine is outdated (rev X vs Y) — remove and re-add the plugin." |
| Fill opacity was never recorded: the published API typings omit per-paint `opacity`, so the serializer never read it (confirmed in the trace — paints carry only color/stops). | Paint opacity is probed defensively (present in Creator's UI even if not in the typings), diffed, replayed, and carried through paint re-creation. |
| "Scale not maintained" and "gradient onto solid fails" re-reports | Both verified fixed in the current engine (scale records per-component and multiplies from each target's baseline; paint-kind mismatches adapt or skip with notes) — the observed failures came from the stale .5 sandbox above. |

## 2026-08-21 — Engine v2: deep recording, one semantics

| Issue | Fix |
|---|---|
| Shape geometry never recorded: a rectangle's `size`/`roundness` (and star points, path data) live on child shapes inside the Container, which the flat recorder never visited. Three registry entries matched no real API property at all. | Snapshots are recursive over the whole shape subtree with a per-node-type property registry verified against the plugin API; groups recurse; masks, gradients (start/end/stops/highlights), and plain layer flags (visibility, lock, blend mode, in/out points) are captured too. |
| Structural edits half-worked: paint removal and re-creating shapes "failed honestly", paint type changes were smuggled through a best-effort stops write, masks were invisible. | New replayable ops via the real mutation APIs: add/remove/replace paints and strokes, add/remove masks, add/remove shapes (recreated from the recorded subtree end-state, keyframes included). Shape reorders are recorded but badged "won't replay" — the plugin API has no reorder call. |
| Replaying a deep step onto a target whose shape list differs would miss or hit the wrong child. | Deep paths carry the recorded shape's type; the applier resolves by index first, then re-finds by type, then falls back to an only child — each adaptation noted. |
| The per-macro "As offsets / Exactly" choice confused more than it helped. | Removed entirely (UI, state, protocol, storage). One semantics: layer transforms offset from each target's own start, everything else applies exactly. Old exports with a `mode` field still import; the field is ignored. |
| Playback required a selection even when the user only wanted to re-run the macro on the recorded layer. | Macros remember their source layer; with nothing selected, playback falls back to it if it still exists. |

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
| Creator discards a static-value write to a property that is animated on the target, without error. Playback reported these as successful, so a macro could half-apply while claiming to have worked. | `set-static` checks `isAnimated` first and returns a note (`"<prop> is animated here — static value not applied"`). Notes surface as a toast when the run finishes and are logged in full to the console. |

## 2026-08-21 — Diagnostics

| Issue | Fix |
|---|---|
| A failing macro gave no way to see what actually happened: no logging existed anywhere except one `console.warn`, and inside Creator the dev strip never rendered because it required mock gateways. | Dev sessions write a trace bundle per run to `traces/`, carrying every RPC call, the snapshot pair behind each recorded step, and per-target before/after probes for each playback step. A `TraceStrip` gated on `import.meta.env.DEV` alone renders in both engine and mock mode. |
| The fake scene in `host-harness.html` accepted `staticValue` writes on animated properties, unlike the real host — so tests written against it could not reproduce the silent no-op class of bug. | Extracted to `engine/testing/fakeScene.ts`, shared by the harness page and vitest, and corrected to discard those writes like Creator does. Failure injection added for deleted nodes, unreadable properties, and failing keyframe add/write/remove. |
| Seeding and wiping the macro store was only possible from `DebugStrip`, which never renders inside Creator, and its three seed macros carried empty payloads so they could not be played, simplified, or edited. | New `DevSettings` strip (`ui/dev/DevSettings.tsx`, gated on `import.meta.env.DEV` alone, so it shows inside Creator too): **Load demo macros** saves three replayable macros built from real `StepPayload`s via `buildStep` (`ui/dev/demoMacros.ts`), **Clear all macros** is a two-tap confirm that removes every stored macro, and a **Preload demo when empty** toggle seeds them on an empty start. `DebugStrip` keeps only the mock scenario selects, and every dev section — settings, `TraceStrip`, mock controls — now nests inside the one collapsed Dev settings drawer, so the panel foot is a single header row. |
| The panel filled the plugin iframe edge-to-edge, so inside Creator the cream faceplate butted directly against the host's dark chrome with no seam. | `.host-frame`: an 8px gutter around the panel wearing Creator's own interface background — `useHostBackground()` tracks the host's theme relay (pushed `--background` token, else light/dark by `isLight`, dark fallback until a push arrives) — so the panel reads as a plate on the live host chrome: 10px radius, clipped corners, one seat shadow. |
| `useTheme()` listened to Creator's theme relay but nothing read its result — dead weight that suggested the panel supported host themes when it deliberately does not. | Deleted (`ui/theme/useTheme.ts` and its call). `ThemeProvider` stays: it is what applies `VINTAGE_TOKENS` as inline custom properties on `<html>`, not theme support. |
| Dev settings polish: the armed "Clear all" state had no colour cue (`instrument-red` lost to `.key-outline`'s doubled specificity), the label swap shifted layout, the receipt note pushed buttons around, and sections ran together. | `.key-armed` red key style, equal-width two-column keys, the receipt shares the header's count readout (`aria-live`, no shift), drawer body seats in a `rack-drawer` well with dotted rules between sections, chevron rotates instead of swapping. |
| The host-frame colour came from the UI guessing at theme messages no one was sending — a hardcoded dark with a listener that nothing fed inside Creator. | Implemented the official ThemeProvider sync (ui-library docs): `sandbox/theme.ts` relays `creator.ui.theme` + `change:theme` from the sandbox (feature-detected, ENGINE_REV 2026-08-24.40), an `index.html` head script paints the gutter pre-React, and `useHostBackground` accepts the official `{type:"change:theme", tokens, themeName}` shape — `--background`/`--base` tokens and light/dark theme names all resolve. |
| Narrow-panel truncation ate meaning across the list screen: the header totals cut mid-word ("12 ste…"), step labels cut the result value mid-token ("→ #002B…"), a truncated name's ellipsis collided with the dotted leader, and the drawer's hint sentence ellipsized. | Header totals are a bare two-number readout ("4 · 12", nowrap) with the words in `sr-only`/`title`; step labels split at the last " → " so the head gives way while the result stays whole (full label in `title`); the leader gained a wider start gap; hint sentences wrap (`text-wrap: pretty`) instead of truncating. |
| Every control wore the same physical key chrome, so the tertiary utilities (Import in the list header, Simplify in a drawer header) visually outranked everything but REC, and the "red outline" on an expanded macro row was not a designed marker at all — `--ring` was `#C8382B`, so every focus ring in the panel painted action-red. | Controls now rank by chrome: primary red key, secondary cream key, and a new tertiary `.key-quiet` (instrument type, no border, no drop, `.press` scale for feedback) which Import and Simplify wear — Simplify's "N → M" saving moves into the lit `.rack-num` readout, since the number is the information and the verb is not. `--ring` is the skin's ink (#2A2623), so focus reads as focus. The expanded row takes the drawer's ground (`.rack-row-open`) and the drawer drops its hairline top border, so lid and well read as one opened compartment. |
| The expanded macro view read busy and alien: each step was its own floating rounded pill (N×4 corners, N gaps — card language inside a console-readout UI), a full prose sentence sat between header and steps on every expansion, and the kind icons were heavier than their labels. | Steps are ONE `.step-strip` — a single seated paper surface with dotted rules between rows, the rack's own grammar one level down. The hint sentence is demoted to tooltip + screen-reader text in the drawer (still visible on the review screen); icon strokes dropped to 2px to match the 12px regular labels. |
| The open compartment's muted slab was bounded only by the same dotted rules every closed row uses, so it read as spilled background — "layout looks broken" — rather than an opened tray. | The compartment closes with solid hairlines above the lid and below the drawer (overriding the dotted row rule at those two seams) and a faint inset at the lid's top sinks the whole tray into the rack; the step strip floats with slightly wider (6px) margins. |
| The expanded macro sat flush in the list as a muted tray; the user's concept wanted it to read as the macro's own object, lifted out of the rack, with its key numbers visible. | The open macro is a raised card (6px margins, paper treatment, adjacent rules suppressed): a bare lid with a collapse chevron (actions return on close; the stop key stays while playing), "Steps (N)" header, the step strip, and a new readout footer — DURATION (keyframe span in frames, `keyframeSpan` in `engine/steps.ts`, +3 tests) and REPEATS (the row's play-options ×N). |
| The pop-out card lost access to play options and the overflow menu (the bare lid hid them), the strip sat tonelessly on the card, the header's text edge missed the strip's, and the card snapped open with no motion. | The card's footer is now its control row — DURATION readout, the ×N repeat setting beside the play-options key that changes it, and the more-menu (both return to the lid on collapse; the label "Repeats" is sr-only/tooltip, the footer hasn't the width). A dotted rule closes the lid, the strip recedes one tone (`--background`) with rows on `bg-inherit`, header/footer text aligns to the strip's inner edge (px-2 everywhere), and the pop-out eases over 200ms on the skin's curve (reduced-motion: none). |
| The empty state was the component library's generic card — stock list icon, sans title, floating on the page — the one screen left speaking no console at all. | Rebuilt in the skin's vocabulary, seated in the `.rack` well the macros will land in: a miniature of the hero's reel window (bezel, two reels, tape run) in the label ink, a mono uppercase readout title, and the one red key this surface gets wearing the deck's own `.key-dot` record glyph (promoted from `deck.css` to `index.css` as shared vocabulary). Copy unchanged and natural-case; the uppercase is CSS. |
| The deck's keys and the panel's keys were two different objects — moulded gradient caps with a top sheen and engraved 700 legends on the hero, flat 10px-radius pills below — so the hero and the section under it read as two products sharing a red. | One key family on two grounds: `.key` tightened to a 6px cap with 700/0.05em legends, `.key-red` took the plates' own red gradient (`#E0574A→#C8382B→#B3301F`), top sheen, warm off-white legend and pressed-state gradient, `.key-outline` a subtle bone gradient with the same sheen. Values duplicated from `deck.css` on purpose, with a retune-both warning in both files. |
| — | Transport keys carry bare legends: the record-dot and square glyphs came off REC and STOP (user decision); accessible names and testids unchanged. |
| **Typing a name in the review sheet could end with the whole recording gone.** The pending macro (steps, name, params, source) lived only in reducer memory, and the panel iframe reloads under the user's feet — Creator re-evaluates plugin.js (`creator.ui.show` re-creates the iframe), the dev server hot-reloads the UI, the mock→engine reboot in `gateways/index.ts` calls `location.reload()`. Traces from 2026-08-24 show two recordings (06:40, 06:52) whose review ended in a fresh `hello` handshake and no `store.save` — lost mid-naming. | The reviewing state is mirrored into the store (debounced 300ms) under a reserved id (`REVIEW_DRAFT_ID`), restored on boot via a new `REVIEW_RESTORE` event (idle-only, so it never interrupts work), filtered out of `MACROS_LOADED` so it can't render as a macro, and removed on Save/Discard. Also: the expanded card footer's Rename now resets the draft name like the collapsed lid's menu does, so an abandoned rename can't resurface (and blur-commit) stale text. |
| Scrolled rows painted OVER the deck's bottom shadow band and ghosted through the translucent dev strip (rack rows are `position: relative`, and positioned z-auto boxes paint above all in-flow content); a pinned step's resting action lane painted its four-button-wide background over the label's tail, crushing it to "Tr…". | The chassis and the dev strip take real stacking levels (`z-index: 1`; the strip's tint baked onto a solid `color-mix` ground), so the list scrolls UNDER the chrome again. Hidden lane actions collapse to `w-0` at rest — the resting lane is only as wide as its state icons, and expanding on hover/focus reflows nothing outside the absolute lane. Step-label tails are capped at 60% with a ~9ch floor so neither half of the split label crushes. |
