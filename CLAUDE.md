# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`docs/USER-GUIDE.md` is the end-user feature walkthrough — update it when a
user-facing behaviour changes. `README.md` is the product-level document: what the plugin does, the three ways to
run it, the playback modes, and the accepted v1 limitations. Read it first. This
file covers what the README leaves out — the invariants that make the code the
shape it is, and the commands the README doesn't list.

## Documentation style

This repository is open source and doubles as a reference for other Creator
plugin developers. Write `README.md`, `docs/RUNTIME-API.md`, and `docs/LIMITATIONS.md`
so an outside plugin developer can use them without this project's context.
The README stays free of UI and skin material — the skin's rules live here.

`docs/STYLE-GUIDE.md` is the standard for every Markdown document in this project:
ASD-STE100 sentence construction, Google developer style mechanics, and the
terminology table. Apply it to every documentation edit you make. Facts, paths,
numbers, and trace ids are content, not style — a style edit never changes
them. `CLAUDE.md` itself keeps its rationale under a lighter application of the
guide: tighten its sentences, but never remove the "why".

## Commands

```bash
pnpm dev                       # vite dev server on :5173 (serves both the UI and, via
                               # @lottiefiles/vite-plugin-creator, the plugin sandbox bundle)
pnpm build                     # tsc -b && vite build → dist/{manifest.json,plugin.js,ui.html}
pnpm type-check                # tsc -b across all three project references
pnpm test                      # vitest run (409 tests, ~1s)
pnpm test:watch
pnpm test:quickjs              # builds first, then drives dist/plugin.js in real QuickJS
```

Single test file / single test:

```bash
pnpm vitest run shared/diff.test.ts
pnpm vitest run -t "position"          # filter by test name across all files
pnpm vitest shared/diff.test.ts        # watch just that file
```

There is no vitest config file and no lint setup — vitest picks up `*.test.ts` by
convention (tests are colocated next to their subject), and `tsc` strictness is
the only static checking. The `eslint-disable` comments in `plugin/` are vestigial.

`pnpm test:quickjs` is the only test that exercises the compiled bundle, so it is
stale until you `pnpm build` — the script does that for you, but it means a
sandbox-side change is *not* covered by `pnpm test` alone. Run both before
claiming plugin-side work is done.

## Three TypeScript projects, deliberately separate

`tsconfig.json` is a solution file referencing three configs. The split is a
correctness boundary, not organization:

- `tsconfig.app.json` — `["src", "shared"]`, DOM libs, `vite/client` types.
- `tsconfig.plugin.json` — `["plugin", "shared"]`, **no DOM lib**, and
  `typeRoots` pointing at `@lottiefiles/creator-plugin-types` so the `creator`
  global resolves. Also sets `noUncheckedIndexedAccess`, which the app config
  does not.
- `tsconfig.node.json` — build tooling.

So `shared/` compiles under both and must not reference `window`, `document`, or
Node APIs. If a `shared/` module needs a platform capability, inject it (see
`parseImportedMacro(json, makeId)` in `shared/macro.ts`) rather than reaching for
a global.

## ENGINE_REV discipline

Bump `ENGINE_REV` in `shared/protocol.ts` with EVERY sandbox-behaviour change
(35+ bumps in one day was normal). The handshake compares revs, stamps both
into traces (`env.sandboxRev`/`uiRev`), and shows an in-panel banner on
mismatch. The dev server force-recompiles plugin.js when any `plugin/` or
`shared/` source changes (scripts/trace-server.ts touches the entry file —
the vendor plugin only watches plugin.ts itself). When triaging any trace,
check `env.sandboxRev` FIRST — stale-sandbox reproductions of already-fixed
bugs cost this project a full day.

## After every fix

Confirmed platform limits go in `docs/LIMITATIONS.md` — what doesn't work, the
evidence, what the user sees, any path to lift it. If one is later lifted,
move it to `docs/IMPROVEMENTS.md`.

Add a row to `docs/IMPROVEMENTS.md` — what was wrong, what changed, two columns, a
sentence or two each. It is a running log the user reads to track what has been
addressed, so a fix is not done until you list it there. Do not put reasoning
or design notes in it; those belong here.

## Diagnostics traces

**Stale-sandbox trap:** Creator evaluates `plugin.js` once at plugin load and
never re-fetches it, while Vite serves the UI fresh — so after any `plugin/` or
`shared/` change the user must remove and re-add the plugin in Creator, or
traces will reproduce already-fixed bugs. Bump `ENGINE_REV` in
`shared/protocol.ts` with every sandbox-side behaviour change; the handshake
compares revisions, stamps both into trace env, and warns on mismatch. When
triaging a trace, check `env.sandboxRev` first.

Dev sessions write a trace bundle per record/playback run to `traces/` via a
`POST /__macro-trace` middleware (`scripts/trace-server.ts`, wired in
`vite.config.ts`). Two rules keep this honest:

- **Debug payloads are opt-in per session.** The UI sends `debug: true` only
  under `import.meta.env.DEV`; the sandbox attaches snapshot pairs and target
  probes only when asked. Never make them unconditional — `pnpm test:quickjs`
  asserts a default response carries no `debug` key.
- **Tap the seam once.** `RpcClient` (`src/gateways/rpc/bridge.ts`) is the only
  place that sees both directions. Add instrumentation there, not in the
  gateways.
- **A traced snapshot pair must be diffScene's exact input.** `recordStop`'s
  "recorded nothing" fallback (whole-session `firstSnapshot`/`lastSnapshot`)
  fires only when the entire session emitted zero steps
  (`RecordingSession.stepped` gates it) — keying it off a quiet final tick
  made healthy recordings look like a dropped layer diff (rev .41 fix,
  taxonomy #14). Same fidelity rule for probes: `probe()` reads plain
  scalars as themselves and includes keyframe `easing` — in traces before
  rev .41, `set-plain` steps probe `null`/`null` and easing-only edits look
  like no-ops; both are artifacts there, not findings. Two more rev fences
  for triage (rev .52): scene ops (`add/remove-layer`, `reorder-layers`,
  `nest-layers`, `break-scene`) probe an ordered `{id, name, type}` scene
  summary and structural ops (`add-mask`/`add-trim`/`add-stroke`) probe a
  readable sub-path (unreadable-before / valued-after IS the creation
  signal) — in traces before .52 both probe empty/null and prove nothing;
  and `debug.breadcrumbs` (guess-chain logs, e.g. the nest routes) exists
  only from .52 on.

`DevSettings` (`src/dev/`) is the ONE dev strip at the panel foot — gated on
`import.meta.env.DEV` alone so it works in both modes, collapsed to a single
header row by default. Everything dev-only renders as sections inside its
drawer: load demo macros / clear all / preload-when-empty, then `TraceStrip`
(both modes), then `DebugStrip`'s mock scenario controls — which render only
when `gateways.mocks` exists, i.e. only when the handshake *fails*, never
inside Creator. `src/dev/demoMacros.ts` builds demo macros from real
`StepPayload`s through `buildStep` so they replay — keep them that way.
There is no bulk delete on the store surface; clear-all loops `list()` +
`remove()`. Clear-all is a two-tap arm/confirm: `.key-armed` (index.css) is
the armed style — `instrument-red` alone loses to `.key-outline.key-outline`
on specificity, which is why the class swaps rather than appends.

Triage workflow: `/triage-traces`, backed by `.claude/agents/macro-triage.md`
(read-only diagnosis) and `.claude/agents/macro-fixture.md` (writes the
regression test, never production code). Trace bundles are large — never read
one into the main context; that is what the triage agents are for.

## The one hard runtime constraint

Creator invokes the sandbox's `onMessage` callback and does **not** pump the
QuickJS job queue afterward. A pure VM promise chain never resolves there. The
README states this; the consequences for how you write code:

- `plugin/rpc-server.ts` calls the handler and, if the result is not a thenable,
  responds **inline in the same invocation**. Do not refactor that dispatch into
  `await handler(...)` — it would deadlock every sync method inside Creator while
  passing in a browser.
- An async handler is only safe if it *starts* by awaiting a native-backed
  promise. In practice that means `creator.clientStorage.*` (`plugin/store.ts`);
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
`plugin/serialize.ts` (proxy → `NodeSnapshot`) and `plugin/applier.ts`
(`StepPayload` → proxy writes). Everything downstream of those is plain data and
unit-testable without a Creator mock. Preserve this: new engine logic belongs in
`shared/`, driven by snapshots, not in a new proxy-reading module.

`shared/testing/fakeScene.ts` is the test double for that proxy surface, shared
by `public/host-harness.html` and vitest. It reproduces the real API's traps on
purpose — most importantly that the host silently discards an assignment to
`staticValue` when keyframes exist (`plugin-api.d.ts:17-18`). Never make the
fake more permissive than the real host; that would hide the bugs it exists to
catch.

Both proxy files are defensive because proxies vary by node type and any
getter can throw — `serialize.ts` wraps every read in `tryRead` and simply
omits unreadable properties; `shared/json.ts#toJson` deep-copies into JSON-safe
data with a depth cap so nothing uncloneable escapes into an RPC payload. An
absent property is a normal outcome, never an error.

## Engine v3 — whole-scene recording (architecture as of 2026-08-22)

`docs/RUNTIME-API.md` is required reading: the published typings are wrong in both
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
  `shared/capture.ts` from **`lastSnapshot`** — never a fresh serialize.
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
  probe evidence — docs/LIMITATIONS.md, taxonomy #17); `selectedCount` is
  present only when the getter reads as an array OR the feature-detected
  `selection:keyframes` event listener (rev .46, `initSelectionEvents`)
  has an event bus — the event cache feeds the offer/capture when the
  getter polls empty, and `selectionIntrospection.events.{supported,fired,
  lastCount}` in the next debug trace proves whether the host ever fires
  it. `RpcRecorderGateway` dedupes offer emissions — without
  that the recording screen re-renders at 2Hz. UI: `CaptureOfferRow` shares
  the above-feed slot with the discard confirm, which wins; notices now
  ride in recording mode too (the toast bridge reads idle OR recording).
- **Replay picks a mode in `chooseMode` (plugin/playback.ts)**: macros
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

- `shared/simplify.ts` is pure and order-preserving. A run is keyed by
  (layer id, pathKey); structural/scene ops and disabled steps are barriers,
  and a static edit never merges with a keyframe edit on the same path (the
  value's meaning changed). `foldKeyframes` is the net-delta algebra —
  extend it with a test per new case, it's easy to get a sign wrong.
- `shared/editing.ts` is the single definition of "editable": the review
  row, the macro detail, and the parameter form must all go through
  `editableValueOf`/`withEditedValue` so a value kind that's editable in one
  place is editable everywhere (and relabeled the same way).
- Disabled steps never reach the sandbox: `enabledSteps` in
  `src/gateways/types.ts` filters client-side, so playback indices are into
  the ENABLED list. Repeat ×N is also purely client-side (one
  begin/steps/end pass per iteration; progress = iteration×len + index).
- The only sandbox part is the frame shift: `playbackBegin` computes
  `frameOffsetBase = currentFrame − earliestKeyframe(steps)` (0 when the
  host has no readable timeline or the macro has no keyframes) and
  `applyKeyframes` shifts the payload ONCE up front so matching and
  placement both see shifted frames. Stagger is `+ i × staggerFrames` per
  target in targets mode only.
- Params reference step ids; anything that regenerates ids (import,
  duplicate) or removes steps (delete, simplify) must remap or drop pins.

## Open threads (as of last update)

- Motion-token (color token/slot) bindings: SETTLED — not observable,
  conclusively (docs/LIMITATIONS.md). Rev .51's record.start token hunt ran in two
  independent sessions (traces 2026-08-26T07-39-25/-52, 07-40-35): proxy
  chains carry only `{r,g,b}`, `node.data`/`shape.data` is the plugin's own
  empty storage, and `node.toJSON()`/`scene.toJSON()` are `{id,type}` STUBS
  on this host (docs/RUNTIME-API.md caveat — this also means the per-fill-opacity
  toJSON recovery finds nothing live). The hunt stays in the debug probe so a
  host that adds any surface shows up unchanged; the full ask (read a binding
  AND apply-by-reference) is upstream.
- Verification gap noted in the 08-26 triage sweep: `set-static` in
  plugin/applier.ts has no post-write read-back (unlike `set-plain`, fixes
  #13/#20), so a host-swallowed absolute write is indistinguishable from a
  coincidental value match in probes. No trace shows it firing; watch for it.

- Nesting-from-selection: CONFIRMED platform limitation (see docs/LIMITATIONS.md
  for the breadcrumb evidence and the upstream ask). The guess-chain stays in
  place so a future host that adds any of the routes starts working without
  code changes.
- Never live-verified yet: the interface-theme relay (`plugin/theme.ts` —
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
  signatures — see docs/RUNTIME-API.md.)
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
  permanently empty payloads. docs/LIMITATIONS.md + taxonomy #17; upstream ask.
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
- Rectangle corner roundness: filed in docs/LIMITATIONS.md (dead `roundness`
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

## The gateway seam

`src/gateways/index.ts` is the only place that decides real-vs-mock. It pings
`hello` (4 × 150ms) and falls back to mocks + `DebugStrip` on timeout. The UI
depends only on the three interfaces in `src/gateways/types.ts` — components
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

## The skin — one committed look, and how it wins

`src/theme/vintageTokens.ts` exports `VINTAGE_TOKENS`, passed to the library's
`ThemeProvider` in `app.tsx`. That provider writes every `--*` key of its
`tokens` prop as an **inline custom property on `<html>`**, which outranks both
`:root` and `.dark` in the library's `theme.css`. Consequences, all
load-bearing:

- `VINTAGE_TOKENS` **must stay a module-level constant**. The provider removes
  and re-applies the whole set whenever the object identity changes; building
  it in a render would repaint the panel on every render.
- It must override *every* key `theme.css` defines (`--chart-*` and
  `--sidebar-*` included) or an unset one falls back to library teal.
- Creator's interface theme touches exactly ONE pixel surface: the
  `.host-frame` gutter. The relay is the official ThemeProvider sync
  pattern (ui-library docs): `plugin/theme.ts` reads `creator.ui.theme` and
  subscribes to `change:theme` (both feature-detected — absent from typings
  AND from our live introspection, docs/RUNTIME-API.md item 10), forwarding
  `{ type: "change:theme", tokens, themeName }` on boot, on `hello`, and on
  every change. Three consumers, resolution chain kept identical in all:
  the index.html head script (pre-React paint of `--host-frame-bg` on
  `<html>`), `useHostBackground()` (inline on the frame div), and the CSS
  fallback (theme.css's dark `hsl(198 16.7% 11.8)`, hardcoded because every
  live token is repainted cream). Order: pushed `--background`/`background`/
  `--base`/`base` token → `isLight`/`themeName` → fallback. The panel itself
  never flips: no `dark` class toggle, no transition freeze — and no
  transition on the frame either, a theme flip should snap. ThemeProvider
  is NOT theme support — it is the token delivery mechanism above; removing
  it reverts the panel to library teal.
- `.host-frame` is an 8px gutter around `.panel-root`, which becomes a plate
  on it: 10px radius, `overflow: clip`, one seat shadow. The gutter costs
  16px of height, so panel-height math (collapse threshold, README's
  develop-at size) is against the panel, not the window.
- All CSS lives in `src/styles/index.css`; the build inlines one file. No
  network assets, system font stacks only (`--font-sans`, `--font-mono` are
  overridden too).
- Small red text uses `--ink-red-text` (#B5301F, 5.2:1), never `--primary`
  (#C8382B) — that one is for fills. Red is never a readout: the Simplify
  count (`5 → 3`) is muted ink at weight 500, because a red number beside a
  key reads as a warning (2026-09-03 audit). The red section titles
  (`REVIEW & SAVE`, `LIVE STEPS`) are a deliberate mode cue and stay.
- A dead red key on the cream surface is `.key.key-red:disabled`: flat
  cream, muted legend, hairline edge, no travel — the deck's "a dead key is a
  dark key" rule translated to paper. The library's `disabled:opacity-50`
  made it a pink key that users kept pressing.
- The list header's Import is icon-only (`aria-label` + `title` carry the
  name): as a bold word it outranked `SAVED MACROS` beside it. Success signals (the completion flash)
  use `--lamp-green` (#5C9457); red on this panel always means action or
  failure, never "done". Muted body copy is `--muted-foreground`
  (#6B635B); instrument labels are `--label-fg` (#5E564F).
- `.key`, `.key-quiet`, `.card`, `.instrument`, `.mono`, `.lamp` are the
  skin's vocabulary. `.key` is written as `.key.key` on purpose: the
  library's `Button` merges its `size="sm"` utilities
  (`h-6 px-3 rounded font-normal`) onto the same element via
  `tailwind-merge`, and a single class would lose on source order alone.
  `.key-quiet.key-quiet` is doubled for the same reason.
- **Controls rank by how much chrome they wear: primary = red key
  (`.key.key-red`), secondary = cream key (`.key.key-outline`), tertiary =
  quiet (`.key-quiet`) — instrument type on nothing at all, no ink edge and
  no drop.** At most one red key per surface. A standalone utility (Import
  in the list header, Simplify in a drawer header) is tertiary: it must not
  outrank the decision beside it. Quiet controls take their feedback from
  `.press`'s scale, never key travel — travel needs a shadow to travel into,
  and a quiet control has none.
- **`--ring` is ink (#2A2623), not red.** Focus is "you are here", never an
  action, and red on this panel means "this does something". It used to be
  `#C8382B`, which made every `focus-visible:ring-ring` — the macro row's
  disclosure most visibly — look like a designed red state marker.

## The deck

`src/components/deck/` — rendered once in `app.tsx`, above the mode switch, on
**every** screen. It owns the Record/Stop transport, the step counter, the
recording clock, the status lamp, and the state word.

- `deckState.ts` is pure and table-tested: `deriveDeckState(input, flags, now)`
  over `{mode, playbackError}` plus two timestamps. `rewind` and `done` are
  deliberately **not** reducer state — they are decorations with a stopwatch,
  and the reducer has no business knowing about them. `useDeckState` owns the
  flags in a ref and is keyed on the single boolean "is playing", so React's
  double-invoked mount effects can't swallow an edge.
- **The reels never carry information on their own.** Every state they show is
  also the lamp's colour and the label's word, which is what makes
  `@media (prefers-reduced-motion: reduce) { .reel { animation: none } }` an
  acceptable fallback rather than a loss. Keep that invariant when adding
  states.
- **The hero is ONE chassis, not a card holding a plate.** It has no title
  block (the panel's name is the sr-only `<h1>`) and no cream frame:
  `.deck-chassis` *is* the faceplate, with `.deck-window` bezelled into it and
  the transport row — lamp + state word, RECORD, STOP, LCD counter — sitting
  directly on it. Controls on a dark ground need the `.key-plate` /
  `.key-plate-red` variant (light keycap, dark bezel) rather than `.key`,
  which is cream-surface only. The recording clock shares the LCD pane with
  the counter (see `.deck-clock` below); the state word is the reduced-motion
  state channel so it is the last thing allowed to truncate. Two nested
  surfaces cost two sets of padding — that collapse is what took the hero
  from 203px to 156px on a 300x520 panel.
- **The stage is a studio deck's faceplate, drawn to a reference photo
  (2026-09-03).** `ReelDeck.tsx` builds it from constants: two R=44 reels
  centred at y=47, each a spun-silver flange (radial gradient + alternating
  1.5-unit rings) with three parallel-sided spokes, and the cut-outs between
  them generated by `cutoutPath` — an annular sector whose corners are
  filleted by placing the fillet centres on the sector shrunk by `CORNER`,
  so every arc meets its edge tangentially. The cut-outs are a mask on the
  flange and are ALSO stroked over it (dark line, plus a 0.5-unit-offset
  light line) so the edge reads as machined thickness. The bolted hub, the
  axle cap and the wound pack all sit inside the rotating `.reel` group;
  the `#reel-light` sheen circle sits OUTSIDE it, because a reflection stays
  with the lamp while the reel turns. The tape is ONE threaded path, the
  way a deck is laced (user correction, 2026-09-03 — two separate runs made
  the supply reel look like it fed tape out both ways): off the supply
  pack's outer-left side, around the bottom-left guide roller, along the
  bottom behind the nameplate, around the bottom-right roller, up onto the
  take-up pack's outer-right side. Pack-to-roller runs are computed
  external tangents (`tangent()`), and the wraps sit one unit outside the
  roller rim to stay visible. Tape is drawn FIRST so it passes behind reels,
  rollers and plate. **Forward is counter-clockwise**: the tape runs under
  the reels, so forward travel drags each bottom edge rightward, and
  deck.css maps recording/playing/done to `reel-ccw` and rewind to
  `reel-cw`; the shimmer's dash offset runs the same left-to-right. Change
  the lacing and re-derive both. A SECOND short run (`RETURN_PATH`) goes
  from the take-up pack's bottom over the nameplate's shoulders to the
  supply pack's bottom, authored right-to-left so its shimmer travels
  opposite to the outer tape (user decision, 2026-09-03: the two runs read
  as one loop going round, not two lines sliding the same way). Rollers
  stay at every size (a wrap around
  nothing reads as a kink); only the nameplate (name + `__APP_VERSION__`)
  and the bottom screws are `.deck-furniture` that a short panel drops.
- **One light source: high, slightly left.** Every highlight in the deck sits
  on a top edge, every occlusion on a bottom edge, and the two specular
  sweeps (`.deck-window::after`'s glass band at 118deg and
  `.deck-chassis::before`'s raking highlight at 100deg) run the same diagonal.
  That consistency — not any single gradient — is what makes the chassis,
  glass, caps, lamp, and LCD read as one moulded object. Adding a bottom
  highlight or a sweep on a different angle quietly undoes the whole effect,
  so match the lamp before adding a surface.
- **The window has glass over it.** `.deck-window::after` is a specular band
  plus a corner vignette, `pointer-events: none`, at `z-index: 2`. Its alpha
  is capped at .11 on purpose: the reels' legibility cost real work (see the
  collapse-threshold note) and a prettier sheen is not worth dimming them.
  Verify reel width and deg/250ms after touching it.
- **Never give `#root` a z-index.** `position: relative` alone lifts it above
  the fixed paper-grain overlay. A z-index there creates a stacking context
  that buries every portalled popover: Base UI renders menus into a portal
  div after `#root` whose positioner is `z-auto`, and the menu's own `z-50`
  does nothing because that element is `position: static`. The symptom is a
  dropdown that opens, looks fine, and ignores clicks — because the panel is
  painted on top of it and `elementFromPoint` returns the row underneath. A
  scripted `.click()` still "works" (it skips hit-testing), so this bug hides
  from naive automation; probe it with `document.elementFromPoint`.
- **Dialogs must not slide.** The component library centres `DialogContent`
  by layout (resting `transform: none`) but still ships shadcn's
  translate-based entrance (`slide-in-from-left-1/2`,
  `slide-in-from-top-[48%]`), which assumes the dialog is centred BY that
  transform. Mismatched, it flies in diagonally from ~138px left and ~121px
  up — outside the panel. `index.css` zeroes `--tw-enter/exit-translate-*`
  for `[role="dialog"]`, leaving the intended zoom + fade.
- **The transport row is `1fr auto 1fr`.** Status legend in the first track,
  key pair in the middle, recording clock in the third. Equal outer tracks
  are what keep the keys centred on the CHASSIS rather than on the space the
  readouts left over. It only fits because the `REC` legend shrank the pair
  to ~122px, leaving ~84px per gutter against the ~73px the legend needs; at
  <=286px the legend gives up tracking and size (never letters — it is the
  reduced-motion state channel) to stay clear of the keys.
- `.deck-keys` is an auto-flow column grid with `grid-auto-columns: 1fr`, so
  RECORD and STOP are exactly equal width whatever their labels say. The
  clock and the step counter share ONE recessed pane (`.lcd`, with
  `.deck-clock` as a divided segment inside it) in the row's trailing track —
  the way a deck's counter window carries time and count together. Keep them
  in one pane: two panes side by side read as two instruments, and the
  trailing gutter is only ~84px wide at 300px.
- The faceplate's lower legend is the package version, which `vite.config.ts`
  injects as `__APP_VERSION__` (declared in `src/vite-env.d.ts`), so it can
  never drift from what shipped.
- **The Record key's visible legend is `REC`, its accessible name is
  `Record`** (aria-label). Consequence for the headless driver: `walk.mjs`
  finds the key by aria-label, but its FIRST assertion matches `/record/i`
  against *textContent*, which now only the EmptyState's Record button
  satisfies. That check therefore passes only while the macro list is empty —
  true for every driver run, since it starts on a fresh profile. If that
  assertion ever starts failing, the skin is not broken; the check is
  asserting on visible text the skin deliberately abbreviated.
- **The chassis is full-bleed and square-cornered.** It renders as a direct
  child of `.panel-root` with no padded wrapper, so it meets the panel edges
  the way a faceplate meets its case; its corners are square; the rounding
  happens one level up, where `.panel-root`'s `overflow: clip` carves the
  plate's 10px radius out of it against the dark `.host-frame` gutter. `.deck-stage`'s
  height is then tuned against the BLED window width so the drawing is
  width-limited rather than height-limited: window = panel - 2x chassis
  padding, and `height = 110 * (window / 272)` (117px at a 300px panel). Get
  this wrong and the reels quietly letterbox inside the glass instead of
  filling it — widening the chassis on its own buys nothing.
- Deck CSS lives in **`src/styles/deck.css`**, imported from `index.css`
  (Vite still inlines one stylesheet). Anything reused outside the hero —
  `.key`, `.card`, `.instrument`, `.mono` — stays in `index.css`.
- Rotation is the CSS `rotate` property on the reel groups with
  `transform-box: fill-box; transform-origin: center` — so probe it with
  `getComputedStyle(el).rotate`, NOT `.transform`, which stays `none`. State
  travels as `data-deck` on `.deck-stage`; the stage `div` carries the dark
  plate and the SVG only the mechanism.
- **The collapse threshold is a real breakpoint, not a round number.**
  `@container panel (max-height: 352px)` (needs `container: panel / size` on
  `.panel-root`) is set where the *list* stops working — hero ~156px, list
  needs ~150px for its header, a row, and a peek. Re-derive it whenever the
  hero's height changes. It was 520px once,
  which is exactly the panel height README tells you to develop at, so the
  hero rendered collapsed at every realistic size and the reels were sliced
  through the middle. When it does collapse the stage scales the drawing DOWN
  to 72px (`meet`, letterboxed onto the plate colour) rather than cropping
  it: a half reel reads as texture and gives the rotation nothing to register
  against.
- Three motion layers, per the deck's own rule that no single one is
  load-bearing: **primary** = reel rotation (linear — a reel is a spinner, the
  one thing exempt from "never linear"); **secondary** = `.tape-shimmer`, a
  dashed stroke travelling the tape path, which is the only element that can
  express *direction* (three-fold symmetric reels cannot); **ambient** = the
  `::after` warm glow while recording. `REWIND_MS`/`DONE_MS` in `deckState.ts`
  must stay equal to the `[data-deck]` animation durations in `deck.css` or
  the reels stop mid-turn.
- The recording screen's bottom CTA is **Stop** (red key), with Discard as
  the outline secondary beside it — the same grammar as the review bar it
  hands off to (user decision, 2026-08-24; this retired the earlier
  "exactly one Stop" rule). Both Stops perform the same action; drivers that
  match Stop by name must scope to the deck's `data-testid="stop-button"`
  or the bar's `stop-recording-button`.

- Pseudo-element budget on the hero is fully spent: `.deck-chassis::before`
  (scanline grain + raking highlight) / `::after` (chamfer bevel);
  `.deck-window::after` (the one glass layer — never add a second sheen on
  `.deck-stage`, the reels dim under two); `.deck-stage::after` (recording
  glow, z 0, under the SVG at z 1); `.key-plate::after` (keycap side wall);
  `.lcd::after` (phosphor scanlines). A new layer needs a new element.

## The rack — the macro list as one seated panel

`.rack` / `.rack-row` / `.rack-drawer` in `index.css`. The list is a single
shallow well holding rows that butt together, not N cards with N borders and
N drop shadows: fewer edges reads quieter AND matches the deck's object
language. Two rules keep it coherent:

- **It is a console readout, not a list of cards.** Rows divide with a dotted
  rule and a `.rack-lead` leader carries the eye from each macro's name to a
  two-digit step count, the way an instrument list does; names are `--font-mono`
  and `.rack-num` is lit (`--primary` plus a glow, not the small-text red —
  the glow is what carries it at that weight). The monospace grid is what
  makes it read as equipment; setting the names back in the sans face is what
  would quietly undo it.
- **Closed rows shed furniture below a 262px PANEL, never at Creator's
  300px window.** `@container panel (max-width: 262px)` hides `.rack-lead`,
  `.rack-count` and the play-options key on closed rows; the deck's 286px
  breakpoint is the wrong one for this — the panel sits inside an 8px gutter
  and measures 284px at a 300px window, so 286 is always on there (that slip
  shipped for one capture). The overflow menu picks up "Play options…" at
  the same width via `useNarrowPanel()` (a ResizeObserver on `.panel-root`,
  `NARROW_PANEL_PX` = 262, kept equal to the CSS) because the menu is
  portalled out of the container query's reach. Open cards keep everything.
- **Step rows show PROPERTY → RESULT; the before value is sr-only.**
  `labelPartsOf` (shared/labels.ts) splits a label into path/before/after
  only when re-joining reproduces the stored label byte-for-byte (imported
  v1 macros may carry labels their payload no longer emits); otherwise the
  row falls back to splitting at the last arrow. The result is capped at
  50% of the line so a long value never pushes the property to "Trans…".
  A three-piece row with the before visible was tried and rejected: at
  250px a before squeezed to "(…" is noise where the property should be.
- **Counts are bare mono readouts everywhere** — the list header's
  `10 · 42`, each row's `05`, and the recording header's `02 steps`. The
  recording count was the one bordered pill on the panel; it is not.
- **The two-digit count is `aria-hidden`, with the words beside it.** "04"
  spoken aloud is meaningless, and `walk.mjs` asserts the row's text contains
  "N steps" — so the readout is decorative and an `sr-only` "4 steps" carries
  the meaning. Keep both.
- **The open macro POPS OUT as a card** (user concept, 2026-08-24):
  `.rack-row-open` lifts out of the rack with 6px margins, the paper-card
  treatment, and no adjacent dotted rules — the gap separates. Its lid drops
  the play/options/overflow cluster and shows ONE disclosure cue — the
  leading chevron beside the number, rotated (user decision, 2026-09-03: the
  earlier trailing ChevronUp made two arrows point at each other) — except
  while THAT macro plays, when the stop key stays so it never unmounts under
  focus. While playback is PAUSED on an error the lid's stop square goes
  quiet grey: the warn-box below owns the red STOP. Card body:
  `StepListHeader` (the header is `Steps (N)` on every surface; the layer
  name is sr-only there and, on the review screen, spoken in the hint
  sentence — inline it truncated to "on Rectan…") + the
  `.step-strip` + a footer that is the card's control row: a PLAY key leads
  it (user ask, 2026-08-25 — the open card carries every lid ability), the
  ×N repeat readout (label sr-only — no width for it), and the play-options
  + overflow triggers, which live on the lid when closed and in the footer
  when open (never both). The footer key mirrors the lid's mount rule:
  while THAT macro plays it stays mounted and swaps to Stop (two stops on
  the open card, same grammar as the recording screen's pair). Duration in
  FRAMES (via `shared/steps.ts#keyframeSpan` — the UI never learns fps, a
  timecode would be a lie) rides the play key's `title` and an sr-only
  span; it lost its visible seat to the key.
- **Steps are ONE `.step-strip`** (one `bg-card` surface, 8px radius,
  `overflow: clip`, dotted rules between rows). Rows keep `bg-card`
  individually because `StepRow`'s hover action lane paints `bg-inherit` and
  needs a solid ground. `RecordingView`'s feed AND the review screen seat
  the strip in a `rack rack-drawer` well (one list, one dressing, 2026-09-03
  audit); the pop-out card's interior is uniform card.
  The drawer's playback-mode hint is a `quietHint` (tooltip + sr-only);
  visible `hints` remain only on the review screen.

## UI state

`src/state/appReducer.ts` is a single discriminated union over
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

`shared/id.ts#newId` exists for exactly this and is the only id source — never
call `crypto.randomUUID` directly. The same table is why the panel must never
rely on **native form submission**: Creator's sandboxed iframe can lack
`allow-forms`, which silently swallows the submit event (the Set values
sheet's Play was dead in Creator while passing every standalone check).
Buttons act via `onClick`, Enter via key handlers; an `onSubmit` may exist
only to `preventDefault()`. Persistence is likewise environment-split:
`LocalMacroStore` (localStorage, with in-memory fallback when it throws) versus
`RpcMacroStore` → `plugin/store.ts` (`creator.clientStorage`, keys prefixed
`macro:`, one entry per macro).

## Local harnesses

`public/host-harness.html` fakes the Creator host — a fake `creator` global with
fake scene nodes, the **real compiled `plugin.js`**, and the real UI iframe — so
the full record→diff→playback loop runs in a plain browser. Because it loads the
compiled bundle, `pnpm build` after any `plugin/` or `shared/` change or you are
testing stale code. Drive it from the console via `window.harness`.
`public/sandbox-test.html` is narrower: it reproduces the opaque-origin sandbox
to test the no-`localStorage` / no-`randomUUID` paths.

`.claude/launch.json` declares `https://localhost:5173`; Vite serves plain
HTTP, so prefer `http://` as the README says.
