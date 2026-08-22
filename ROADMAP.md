# Macro Recorder v3.1 — pro-workflow features (from tool-landscape evaluation)

> **Status (2026-08-22):** all four features implemented on branch
> `v3.1-pro-workflow` and merged to `main` on 2026-08-22. At-playhead, stagger
> and repeat are live-verified in Creator traces; simplify/edit/disable and
> params are verified in the standalone UI. A UI/accessibility/copy pass
> followed (IMPROVEMENTS.md). User-facing documentation in `USER-GUIDE.md`.

## Context

Evaluated our recorder against the field: Photoshop/Illustrator Actions (step
editing, toggles, stop-steps, sets), Excel VBA (relative/absolute — we solved
with "smart"), After Effects animation presets (apply-at-playhead — the
motion-native anchor we lack), Fusion macros / Nuke gizmos (exposed
parameters), Blender/Maya repeat-with-accumulation, and Figma's current
automation plugins (Action Recorder, Automator, Macro Automate Now — batch
and record/replay, no motion). We already exceed all of them on scene
structure, keyframes, convergent replay, and diagnostics; the user greenlit
all four gap-closing features:

1. **Step editing + Simplify** (PS-Actions parity)
2. **Apply at playhead + stagger** (AE-preset parity, motion-native)
3. **Repeat ×N** (formalize compounding into a cascade generator)
4. **Parameters on apply** (gizmo knobs)

Build in that order — 1 provides machinery 4 reuses. All are feasible under
RUNTIME-API.md constraints (timeline.currentFrame is readable; everything
else is client-side data transforms + existing applier paths).

## 1. Step editing + Simplify

**Simplify** — new `shared/simplify.ts`: `simplifySteps(steps): MacroStep[]`
(pure, testable):
- Merge runs of consecutive `set-static` payloads on the same path (and same
  layer ref): keep first `before`, last `after`; drop the run if net no-op
  (jsonEqual). Never merge across a differing-op step on the same path.
- Merge runs of consecutive `keyframes` payloads on the same path: fold
  chains of same-frame `changed` entries (first.before → last.after); fold
  `added@f` followed by `changed@f` chains into one `added` with the final
  value. Rebuild labels via `buildStep`-style relabeling (labelOf).
- Wire: "Simplify" button in `ReviewPanel` (dispatch REVIEW_SET_STEPS) and in
  the saved-macro detail view (MACRO_SET_STEPS). Manual, not automatic.

**Step disable/enable** — `MacroStep.disabled?: true` (macro.ts; tolerate on
import). StepRow gains a toggle (eye icon); reducer events
REVIEW_STEP_TOGGLE / MACRO_STEP_TOGGLE. `playbackGateway` skips disabled
steps client-side (index bookkeeping: send only enabled steps to
playback.begin — no sandbox change needed).

**Step value editing** — for editable payloads (`set-static` / `set-plain`
with number, `{x,y}`-like vector, `{r,g,b}` color, or string `after`;
`add-layer` name): StepRow edit affordance opens a small inline editor
(number field / x-y pair / hex color / text). On commit: replace
`payload.after` (and recompute label via `labelOf`). Reducer events
REVIEW_STEP_EDIT / MACRO_STEP_EDIT carrying `{stepId, payload}`. Keyframe
payload editing is out of scope for this pass (values live per-frame).

## 2. Apply at playhead + stagger

Sandbox math (bump ENGINE_REV):
- `shared/protocol.ts`: `playback.begin` params gain
  `atPlayhead?: boolean; staggerFrames?: number`.
- `plugin/playback.ts` `playbackBegin`: when `atPlayhead`, read
  `creator.timeline.currentFrame` (tryRead; readonly per RUNTIME-API), find
  the macro's minimum keyframe frame across `keyframes` payloads, store
  `frameOffsetBase = currentFrame - minFrame` on the session. Store
  `staggerFrames` too.
- `ApplyContext` gains `frameOffset?: number`. In `playbackStep`: targets
  mode passes `base + i * stagger` per target; scene mode passes `base`.
- `plugin/applier.ts` `applyKeyframes`: offset every snap frame (added,
  removed, changed.before/after) by `context.frameOffset ?? 0` BEFORE
  matching/upserting, so lookup and placement both use shifted frames.
  `adjust()` already transforms values; add the frame shift alongside.
- UI: play-options popover on the macro row (replaces bare play click-through
  when opened via the overflow menu): "At playhead" toggle, "Stagger" frame
  input (only meaningful with multi-selection), threaded through
  `AppContext.play(macroId, options)` → `playbackGateway.run`.

## 3. Repeat ×N

Client-side loop in `playbackGateway.run(macro, onEvent, options)`: for
`repeat > 1`, run begin/steps/end N times sequentially, aggregating notes;
report progress as `stepIndex + iteration*steps.length` with
`total = steps.length * N` (PLAY_START total accordingly). A failure pause in
any iteration behaves exactly as today (Continue resumes the loop, Stop ends
everything). UI: count input in the same play-options popover. Compounding
offsets are the point — document that in the popover copy ("each repeat
applies on top of the last").

## 4. Parameters on apply

- `Macro.params?: { stepId: string; label: string }[]` — review UI: editable
  steps get a "use as parameter" pin next to the edit affordance; pinned
  steps' current `after` values become the defaults.
- Playing a macro with params first enters a lightweight pre-play sheet
  (reducer state `mode: "configuring"` with macroId + working copies):
  reuses the SAME inline editors from feature 1, one row per param
  (label = step label). Confirm → substitute values into a cloned steps
  array → run as normal. Cancel → idle.
- Import/export: params ride along in the macro JSON (isMacroShape
  tolerates).

## Files touched (by feature)

1. `shared/simplify.ts` (new) + tests; `shared/macro.ts` (disabled,
   tolerant validation); `src/state/appReducer.ts` (+ events),
   `AppContext.tsx`, `StepRow.tsx` (toggle + editors), `ReviewPanel.tsx`,
   `MacroRow.tsx`/detail; `playbackGateway.ts` (filter disabled).
2. `shared/protocol.ts`, `plugin/playback.ts`, `plugin/applier.ts`
   (+ applier tests for frame offset & stagger), `playbackGateway.ts`,
   play-options popover component, `AppContext.tsx`.
3. `playbackGateway.ts` loop + reducer totals + popover count input.
4. `shared/macro.ts` (params), reducer `configuring` state + events,
   pre-play sheet component reusing editors, `AppContext.play` substitution.

Reuse: `labelOf` for relabeling, `jsonEqual` for no-op detection, existing
notes/pause plumbing, existing editors across features 1↔4.

## Verification

- `pnpm test` (new suites: simplify transforms incl. keyframe-chain folding;
  applier frame-offset/stagger; reducer toggle/edit/configuring), `pnpm
  test:quickjs` (playback.begin param additions — assert default responses
  unchanged), `pnpm type-check`, `pnpm build`.
- Live: record a position+keyframe macro → Simplify (micro-steps collapse) →
  edit a color step → disable a step → replay (edited value applies, disabled
  skipped). Scrub playhead to frame 60 → play "at playhead" (keyframes start
  at 60). Select 3 layers → stagger 5 (cascading animation). Apply ×5 a
  duplicate-and-rotate macro (spiral in one click). Pin a color as parameter
  → play shows the form → change → applies.
- Traces confirm each; ENGINE_REV bumped for the sandbox changes; rows in
  IMPROVEMENTS.md per landed feature.
