# Architecture

This document holds the invariants that give the code its shape: why the three
TypeScript projects are separate, what the QuickJS sandbox can and cannot do,
where the host proxies stop, and how the recording engine and the panel fit
together. Read it before you extend the engine. Read
[`runtime-api.md`](runtime-api.md) with it: the published typings are wrong in
both directions, and every workaround anchors to a live-verified quirk listed
there.

The panel and the sandbox are one loop. The panel polls the sandbox every
500ms over a small RPC protocol. The sandbox snapshots the active scene, diffs
it against the previous snapshot, and returns labeled steps. Replay sends the
steps back the other way. Everything between the two proxy-touching files is
plain data.

- The design rules for the skin, the deck, and the rack are in
  [`design-system.md`](design-system.md).
- The trace-triage workflow is in [`contributing/triage.md`](contributing/triage.md).
- Confirmed host limits, with evidence, are in [`limitations.md`](limitations.md).

## Three TypeScript projects, deliberately separate

`tsconfig.json` is a solution file referencing three configs. The split is a
correctness boundary, not organization:

- `tsconfig.ui.json` — `["ui", "engine"]`, DOM libs, `vite/client` types.
- `tsconfig.sandbox.json` — `["sandbox", "engine"]`, **no DOM lib**, and
  `typeRoots` pointing at `@lottiefiles/creator-plugin-types` so the `creator`
  global resolves. Also sets `noUncheckedIndexedAccess`, which the UI config
  does not.
- `tsconfig.node.json` — build tooling.

So `engine/` compiles under both and must not reference `window`, `document`, or
Node APIs. If an `engine/` module needs a platform capability, inject it (see
`parseImportedMacro(json, makeId)` in `engine/macro.ts`) rather than reaching for
a global.

## ENGINE_REV discipline

Bump `ENGINE_REV` in `engine/protocol.ts` with EVERY sandbox-behaviour change.
The handshake compares revisions, stamps both into traces
(`env.sandboxRev`/`uiRev`), and shows an in-panel banner on mismatch. Creator
evaluates `plugin.js` once and never re-fetches it, so a stale sandbox
reproduces bugs that are already fixed. When you triage any trace, check
`env.sandboxRev` FIRST.

The full rule, with the stale-sandbox trap and the dev-server recompile
behaviour, is in [`contributing/engine-rev.md`](contributing/engine-rev.md).

## The one hard runtime constraint

Creator invokes the sandbox's `onMessage` callback and does **not** pump the
QuickJS job queue afterward. A pure VM promise chain never resolves there. The
README states this; the consequences for how you write code:

- `sandbox/rpc-server.ts` calls the handler and, if the result is not a thenable,
  responds **inline in the same invocation**. Do not refactor that dispatch into
  `await handler(...)` — it would deadlock every sync method inside Creator while
  passing in a browser.
- An async handler is only safe if it *starts* by awaiting a native-backed
  promise. In practice that means `creator.clientStorage.*` (`sandbox/store.ts`);
  its settlement is what pumps the queue and drains the `.then()` continuations.
  A handler that awaits a VM-only promise first is dead code in Creator.
- The sandbox has **no timers**. All timing lives in the UI —
  `RpcRecorderGateway` owns the 500ms tick loop and the sandbox only ever
  responds to messages.

`scripts/quickjs-smoke.mjs` enforces this by mirroring Creator's `_wrapCallback`
exactly: `vm.callFunction` with zero `executePendingJobs` after. If you add an
RPC method that must answer synchronously, add a check there.

## Untyped host API surface (found via runtime introspection)

The real `Animatable` proxies expose two methods the published typings omit:
`clearKeyframes()` (the missing bulk animated→static) and `getValueAt(frame)`.
Safe to feature-detect (`typeof prop.clearKeyframes === "function"`), never
assume. Conversely, per-fill opacity does NOT exist anywhere on the paint
surface (paint = `color`/`type`/`remove` only, colors are `{r,g,b}`) — do not
re-attempt to record it; it is a documented platform limit.

## Layering — where the proxies stop

Exactly **two** files touch Creator's live node proxies:
`sandbox/serialize.ts` (proxy → `NodeSnapshot`) and `sandbox/applier.ts`
(`StepPayload` → proxy writes). Everything downstream of those is plain data and
unit-testable without a Creator mock. Preserve this: new engine logic belongs in
`engine/`, driven by snapshots, not in a new proxy-reading module.

`engine/testing/fakeScene.ts` is the test double for that proxy surface, shared
by `dev/harness/host-harness.html` and vitest. It reproduces the real API's traps on
purpose — most importantly that the host silently discards an assignment to
`staticValue` when keyframes exist (`plugin-api.d.ts:17-18`). Never make the
fake more permissive than the real host; that would hide the bugs it exists to
catch.

Both proxy files are defensive because proxies vary by node type and any
getter can throw — `serialize.ts` wraps every read in `tryRead` and simply
omits unreadable properties; `engine/json.ts#toJson` deep-copies into JSON-safe
data with a depth cap so nothing uncloneable escapes into an RPC payload. An
absent property is a normal outcome, never an error.

## Engine v3 — whole-scene recording (architecture as of 2026-08-22)

`runtime-api.md` is required reading: the published typings are wrong in both
directions, and every workaround in the engine anchors to a live-verified
quirk listed there. Introspect before extending (record.start's debug probe
dumps node/scene surfaces into traces).

```
UI tick (500ms)                     sandbox
RpcRecorderGateway ──record.tick──▶ serializeScene(activeScene) → SceneSnapshot
                                    diffScene(prev, next) → StepPayload[]
                   ◀─── steps ───── buildStep() → {kind, label, payload}
```

- Recording watches the WHOLE active scene (no selection needed): every
  layer's subtree (shapes recurse; scene-instance layers expose their source
  scene's layers as the child channel), fills/strokes/masks/trims, plain
  flags (incl. text props), names. `diffScene` matches layers by id and emits
  scene ops: `add-layer` (with structural duplicate detection → `cloneOf`,
  transform-agnostic, plus recorded position `offset`), `remove-layer`,
  `reorder-layers` (since rev .52 the payload also carries `layers:
  LayerRef[]` — replay verifies those identities and refuses to permute a
  scene that isn't the recorded one; legacy identity-less payloads reorder
  positionally WITH a caution note), `break-scene` (removed SCENE layer +
  adds in one tick),
  `nest-layers` (added SCENE layer + removals in one tick). In-layer payloads
  carry a `layer: LayerRef {id, name, priorName}` binding and, on deep paths,
  a `shapeHint`.
- **Selection nudge (rev .48, inline since .49)**: `record.start` seeds and
  every `record.tick` carries `selectionCount`; 0 → a standing dashed chip
  above the live feed that clears ITSELF when a layer is selected (slot
  chain: discard confirm > capture offer > nudge — offer needs a selection,
  nudge needs none, so the last two never collide). A NUDGE, never a gate
  (user decision: no disabled REC, no confirm interstitial, no toast) —
  whole-scene/structure recordings are a designed feature. Toasts
  themselves are restyled in index.css as compact ink chips (the library's
  hardcoded dark slab is full-app-scale; attribute-contains selectors on
  the fixed z-100 viewport, same strategy as the dialog-slide fix).
- **Keyframe capture (rev .42)**: while recording, `record.tick`'s result
  carries a `CaptureOffer` when exactly one non-`SCENE*` top-level layer
  with keyframes is selected — computed from the tick's OWN snapshot plus a
  defensive `selection.nodes` read, never a second serialize.
  `record.captureKeyframes` (sync handler) synthesizes steps via
  `engine/capture.ts` from **`lastSnapshot`** — never a fresh serialize.
  Scope "all" is a FULL-STATE capture (rev .43, fills whole since .45):
  each fill first as `replace-paint` with its complete PaintSnapshot —
  kind and gradientType survive replay, animated-only components seeded
  from their earliest keyframe (TEXT_LAYER singular fills stay
  component-captured; no replace surface) — then keyframes ops, then
  static animatables as `set-static` and content plain flags as `set-plain`
  with before === after — deep paths replay exactly, length-1 transform
  statics are additive-zero (style capture never teleports the target;
  pinned in applier.test), and `labelOf` renders equal pairs as
  `prop = value`. "Add selected" stays keyframes-only. Rationale: that keeps capture and the diff stream disjoint by construction
  (a post-tick edit arrives as a diff step; nothing double-emits; ≤500ms
  staleness accepted). The walk mirrors `diffNodeInner`'s addressing exactly
  and strips host keyframe ids (recycled). `selection.keyframes` is
  SETTLED: live but permanently EMPTY on the real host (five sessions of
  probe evidence — `limitations.md`, taxonomy #17); `selectedCount` is
  present only when the getter reads as an array OR the feature-detected
  `selection:keyframes` event listener (rev .46, `initSelectionEvents`)
  has an event bus — the event cache feeds the offer/capture when the
  getter polls empty, and `selectionIntrospection.events.{supported,fired,
  lastCount}` in the next debug trace proves whether the host ever fires
  it. `RpcRecorderGateway` dedupes offer emissions — without
  that the recording screen re-renders at 2Hz. UI: `CaptureOfferRow` shares
  the above-feed slot with the discard confirm, which wins; notices now
  ride in recording mode too (the toast bridge reads idle OR recording).
- **Replay picks a mode in `chooseMode` (sandbox/playback.ts)**: macros
  touching >1 pre-existing layer or containing unretargetable scene ops
  (remove/reorder/break/nest/fresh add-layer) replay as SCENE SCRIPTS — each
  step resolves its layer id → name → priorName → skip-note; values apply
  exactly; layers created during the replay register in `layerByRecordedId`
  so later steps bound to recorded new-layer ids find them. Macros touching
  ≤1 pre-existing layer with a selection replay in TARGETS mode — apply to every
  selected layer with smart offsets (`propClassOf`: only length-1 transform
  paths are relative; origins = recorded first-touch value, keyframed paths
  use the lowest-frame value); duplicate steps clone each SELECTED layer
  (chained duplicates clone the replay's copies via per-target maps) and
  shift by the recorded offset from the target's own position.
- **Replay means DO IT**: nest/add ops re-execute; adoption of an existing
  layer (id-only match) is a fallback for same-scene replays where the
  action already happened (prevents duplicate/empty-shell rebuilds).
  `createLayerFromSpec` picks the factory by recorded type — `SCENE*` →
  `createSceneLayer`, `TEXT_LAYER` → `createTextLayer` (feature-detected;
  absent → note + skip, never a shape shell), else `createShapeLayer`. A
  text layer rebuilt as a shape shell was the worst silent failure found in
  traces: every later text/font write landed on nothing and re-recording the
  shell captured nothing (taxonomy #12).
  `nest-layers` prefers the current selection as its sources (tool
  semantics); inside instance content, resolution is strictly index-ordered
  (user decision — no shape-type redirect there).
- **Nothing applies silently**: `applyStep` returns `StepOutcome.notes` for
  deliberate non-applies/adaptations (cross-kind recolors: gradient stops
  onto a solid LIST fill CONVERT the fill to a gradient via the
  replace-paint mechanism so the full stop values survive — user decision,
  2026-08-25, rev .44; solid color onto a gradient still tints every stop;
  singular text fills and strokes keep first-color adaptation since they
  have no removal semantics; static and keyframed both; trim edits create
  the trim on demand; paint paths remap singular text fills). Genuine failures throw and pause. Keep
  this invariant — silent half-applies were the original disease. It extends
  to `set-plain`: the applier reads the flag back after writing and notes a
  mismatch ("the host kept X unchanged"); an unreadable read-back makes no
  claim (taxonomy #13). Hosts can accept an assignment and keep their own
  value, so a bare write is never proof of application.
- Keyframe machinery (applier): frame-keyed matching via `getKeyframeAt` with
  `hasKeyframes` phantom-guard, verified adds + frame-0 sentinel, same-frame
  add+remove guard (legacy macros), move re-pairing in the differ, collision
  upsert (occupant gives way), per-entry fault tolerance.

## v3.1 pro-workflow layer (simplify / edit / play options / params)

Where each piece lives and the invariants worth keeping:

- `engine/simplify.ts` is pure and order-preserving. A run is keyed by
  (layer id, pathKey); structural/scene ops and disabled steps are barriers,
  and a static edit never merges with a keyframe edit on the same path (the
  value's meaning changed). `foldKeyframes` is the net-delta algebra —
  extend it with a test per new case, it's easy to get a sign wrong.
- `engine/editing.ts` is the single definition of "editable": the review
  row, the macro detail, and the parameter form must all go through
  `editableValueOf`/`withEditedValue` so a value kind that's editable in one
  place is editable everywhere (and relabeled the same way).
- Disabled steps never reach the sandbox: `enabledSteps` in
  `ui/gateways/types.ts` filters client-side, so playback indices are into
  the ENABLED list. Repeat ×N is also purely client-side (one
  begin/steps/end pass per iteration; progress = iteration×len + index).
- The only sandbox part is the frame shift: `playbackBegin` computes
  `frameOffsetBase = currentFrame − earliestKeyframe(steps)` (0 when the
  host has no readable timeline or the macro has no keyframes) and
  `applyKeyframes` shifts the payload ONCE up front so matching and
  placement both see shifted frames. Stagger is `+ i × staggerFrames` per
  target in targets mode only.
- **A macro with no keyframes has nothing to shift, so stagger delays the
  layer** (rev `2026-09-04.1`): `begin` decides, step 0 acts. `playbackBegin`
  parks `delay: { base?, perTarget }` on the session when
  `hasKeyframes(steps)` is false, the mode is targets, and this is Repeat
  pass 0 (`iteration`, sent by `playbackGateway`); `playbackStep` at index 0
  calls `delayLayer` once per target before the step applies. `delayLayer`
  (`sandbox/applier.ts`) is the only proxy toucher: it moves `startFrame` and
  `timelineOffset` by the same delta, never writes `endFrame`, and turns
  every outcome — including a host that keeps its own value — into a note.
  Two reasons for the split: the per-target notes channel already reaches the
  toast and the `playback-event` trace record, and `playback.begin`'s result
  stays byte-identical. Keyframed macros never enter this path, so their
  cascade is unchanged. Stagger that CANNOT act (scene mode, or one target)
  parks a `staggerNote` reported the same way — nothing applies silently.
- Params reference step ids; anything that regenerates ids (import,
  duplicate) or removes steps (delete, simplify) must remap or drop pins.

## The gateway seam

`ui/gateways/index.ts` is the only place that decides real-vs-mock. It pings
`hello` (4 × 150ms) and falls back to mocks + `DebugStrip` on timeout. The UI
depends only on the three interfaces in `ui/gateways/types.ts` — components
never import an RPC class directly, which is what makes every UI state reachable
standalone.

Two subtleties worth knowing before changing it:

- Falling back to mocks *inside an iframe* means the handshake failed inside
  Creator, which is a bug, not a dev convenience. `app.tsx` renders a loud
  "Demo engine" banner for that case (`data-testid="demo-mode-banner"`) rather
  than silently showing fake data.
- After falling back, the client listens for a `sandbox-ready` notify and
  reloads the page, so Creator's hot-reload of plugin code recovers onto the real
  engine.

`RecorderGateway.stop()` returns the **final delta only** — steps captured since
the last `onStep` emission. It is not a full replay of the session; the UI has
already accumulated the earlier ones.

## UI state

`ui/state/appReducer.ts` is a single discriminated union over
`idle | recording | reviewing | playing`. Every case guards on `state.mode` and
returns `state` unchanged when the event doesn't apply to the current mode — keep
that pattern; it is what makes late-arriving gateway callbacks (a tick that lands
after stop) harmless. The reducer is pure and fully unit-tested; side effects
live in `AppContext.tsx`.

## Runtime environments this code must survive

Three, and they differ in what globals exist:

| | `crypto.randomUUID` | `localStorage` | timers | DOM |
|---|---|---|---|---|
| browser tab (standalone dev) | yes | yes | yes | yes |
| Creator UI iframe (opaque origin) | **no** | **throws** | yes | yes |
| QuickJS plugin sandbox | **no** | n/a | **no** | **no** |

`engine/id.ts#newId` exists for exactly this and is the only id source — never
call `crypto.randomUUID` directly. The same table is why the panel must never
rely on **native form submission**: Creator's sandboxed iframe can lack
`allow-forms`, which silently swallows the submit event (the Set values
sheet's Play was dead in Creator while passing every standalone check).
Buttons act via `onClick`, Enter via key handlers; an `onSubmit` may exist
only to `preventDefault()`. Persistence is likewise environment-split:
`LocalMacroStore` (localStorage, with in-memory fallback when it throws) versus
`RpcMacroStore` → `sandbox/store.ts` (`creator.clientStorage`, keys prefixed
`macro:`, one entry per macro).

## Local harnesses

`dev/harness/host-harness.html` fakes the Creator host — a fake `creator` global with
fake scene nodes, the **real compiled `plugin.js`**, and the real UI iframe — so
the full record→diff→playback loop runs in a plain browser. Because it loads the
compiled bundle, `pnpm build` after any `sandbox/` or `engine/` change or you are
testing stale code. Drive it from the console via `window.harness`.
`dev/harness/sandbox-test.html` is narrower: it reproduces the opaque-origin sandbox
to test the no-`localStorage` / no-`randomUUID` paths.

Vite serves plain HTTP, so use `http://localhost:5173`. `.claude/launch.json`
declares the same URL.

## Status and open threads (as of engine rev 2026-08-26.52)

- Motion-token (color token/slot) bindings: SETTLED — not observable,
  conclusively (`limitations.md`). Rev .51's record.start token hunt ran in two
  independent sessions (traces 2026-08-26T07-39-25/-52, 07-40-35): proxy
  chains carry only `{r,g,b}`, `node.data`/`shape.data` is the plugin's own
  empty storage, and `node.toJSON()`/`scene.toJSON()` are `{id,type}` STUBS
  on this host (`runtime-api.md` caveat — this also means the per-fill-opacity
  toJSON recovery finds nothing live). The hunt stays in the debug probe so a
  host that adds any surface shows up unchanged; the full ask (read a binding
  AND apply-by-reference) is upstream.
- Verification gap noted in the 08-26 triage sweep: `set-static` in
  sandbox/applier.ts has no post-write read-back (unlike `set-plain`, fixes
  #13/#20), so a host-swallowed absolute write is indistinguishable from a
  coincidental value match in probes. No trace shows it firing; watch for it.

- Nesting-from-selection: CONFIRMED platform limitation (see `limitations.md`
  for the breadcrumb evidence and the upstream ask). The guess-chain stays in
  place so a future host that adds any of the routes starts working without
  code changes.
- Never live-verified yet: the interface-theme relay (`sandbox/theme.ts` —
  `creator.ui.theme` / `change:theme` per the ui-library docs,
  feature-detected, silent on hosts without it); the set-plain read-back
  DISCARD note (no host-discarded write has appeared in a ≥.41 trace);
  break-scene's fallback-restore path (live runs have only ever broken an
  EMPTY shell, so the rebuild-from-`fallback` branch is still untested).
  Set-plain text/font WRITES are live-verified (the .41 traces of
  2026-08-24T12:16 show real probe values applying).
- Live-verified 2026-08-26 (rev .51 seed-macro sweep): the `createTextLayer`
  rebuild — trace 08-15-26 built a REAL text layer with honest read-backs,
  the singular-fill remap and keyframes routed through
  `layerByRecordedId`. Mask add/edit replay is live-verified BROKEN (the
  applier only checked `addMask`; the host has only `createMask`) and fixed
  in rev .52 — pending a live re-verify. Nest-layers reconfirmed
  platform-blocked (08-15-14: the guess-chain exhausted every route and fell
  back with honest notes). v3.1 params + the configure-sheet edit are now
  live-verified in Creator (Parametric slide trace: the edited param value
  flowed through BOTH repeat passes), as are repeat compounding and
  disabled-step filtering in the same trace.
- Scene-layer reorder: the moveBefore/moveAfter mechanism executed live in
  08-15-02, but its outcome was unverifiable (scene ops probed `[]` on both
  sides) AND the payload was positions-only, so a foreign scene got
  reshuffled silently. Rev .52 gates it on recorded layer identities and
  adds the scene-summary probe that closes the audit gap; the reorder itself
  still needs one clean live confirmation. (`shiftTo` throws for both guessed
  signatures — see `runtime-api.md`.)
- Live-verified 2026-08-26 (rev .47–.49 trace sweep): whole-fill
  `replace-paint` replay INCLUDING the topology remap (recorded
  group-nested fill → flat target's root fill really replaced, trace
  04-04-16; recorded solid→gradient kind change replayed clean, 06-03
  session); relative-offset retarget math exact (04-05 session); the
  .48/.49 `selectionCount` rollout; the #14 recorded-nothing fallback.
  Fill swaps became VERIFIABLE in traces only at rev .50 (probe paint
  summaries, taxonomy #19) — earlier paint probes are null/null artifacts.
- Capture live status (2026-08-26): offer + "Add all" fully verified in
  five sessions (up to 198 steps, "Fish" → mismatched target, 0 failures,
  traces 2026-08-24T17-50…2026-08-25T05-27); "Add selected" blocked by
  the host — SETTLED both routes: the getter polls `array(0)` always,
  and the `selection:keyframes` event fires (311× in trace 06-03-22) with
  permanently empty payloads. `limitations.md` + taxonomy #17; upstream ask.
  The moment Creator populates either surface it lights up unchanged.
- Repeat-applying an offsets macro to the same layer compounds by design —
  now formalized as the Repeat ×N play option.
- v3.1 live status: at-playhead, stagger, and repeat verified in traces
  (2026-08-21T21-45-57-555, 2026-08-22T14-25-27-048; `timeline.currentFrame`
  IS readable). Repeat ×N on a keyframe-only macro is idempotent by design —
  keyframe steps converge to the same absolute frames/values each pass;
  compounding only happens through static transform offsets.
  Simplify is live-verified too (trace 2026-08-23T07-54-20-321: Macro 1
  collapsed 15 → 5 steps, replayed clean). Edit/disable and params are
  verified in the standalone UI (headless walk-through, see below) but not
  yet seen in a Creator trace.
- Rectangle corner roundness: filed in `limitations.md` (dead `roundness`
  proxy — always 0, edits produce empty ticks). Registry entry stays so a
  host fix lights up by itself.
- UI verification without the Chrome extension: a puppeteer-core driver
  (session scratchpad `drive/walk.mjs`, not in the repo) walks record →
  review (simplify/skip/edit/pin) → save → play options → configure sheet →
  playback against the standalone mock engine and asserts keyboard reach,
  live-region announcements, no horizontal overflow, and label widths at
  260/320px. Demo mode emits real StepPayloads precisely so this is possible
  — keep `mockRecorder.ts` on `buildStep`.
- A persistent Monitor task watches `traces/` during dev sessions; audited
  traces are appended to `traces/.processed` (the /triage-traces skill skips
  those).

