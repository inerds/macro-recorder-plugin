# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`README.md` is the product-level document: what the plugin does, the three ways to
run it, the playback modes, and the accepted v1 limitations. Read it first. This
file covers what the README leaves out — the invariants that make the code the
shape it is, and the commands the README doesn't list.

## Commands

```bash
pnpm dev                       # vite dev server on :5173 (serves both the UI and, via
                               # @lottiefiles/vite-plugin-creator, the plugin sandbox bundle)
pnpm build                     # tsc -b && vite build → dist/{manifest.json,plugin.js,ui.html}
pnpm type-check                # tsc -b across all three project references
pnpm test                      # vitest run (127 tests, ~350ms)
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

Confirmed platform limits go in `LIMITATIONS.md` — what doesn't work, the
evidence, what the user sees, any path to lift it. If one is later lifted,
move it to `IMPROVEMENTS.md`.

Add a row to `IMPROVEMENTS.md` — what was wrong, what changed, two columns, a
sentence or two each. It is a running log the user reads to track what has been
addressed, so a fix is not done until it is listed there. Do not put reasoning
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

Note `DebugStrip` renders only when `gateways.mocks` exists, which happens only
when the handshake *fails* — i.e. never inside Creator. `TraceStrip` is
deliberately gated on `import.meta.env.DEV` alone so it works in both modes.

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

Creator's live node proxies are touched in exactly **two** files:
`plugin/serialize.ts` (proxy → `NodeSnapshot`) and `plugin/applier.ts`
(`StepPayload` → proxy writes). Everything downstream of those is plain data and
unit-testable without a Creator mock. Preserve this: new engine logic belongs in
`shared/`, driven by snapshots, not in a new proxy-reading module.

`shared/testing/fakeScene.ts` is the test double for that proxy surface, shared
by `public/host-harness.html` and vitest. It reproduces the real API's traps on
purpose — most importantly that assigning `staticValue` is silently discarded
when keyframes exist (`plugin-api.d.ts:17-18`). Never make the fake more
permissive than the real host; that would hide the bugs it exists to catch.

Both proxy files are defensively written because proxies vary by node type and
any getter can throw — `serialize.ts` wraps every read in `tryRead` and simply
omits unreadable properties; `shared/json.ts#toJson` deep-copies into JSON-safe
data with a depth cap so nothing uncloneable escapes into an RPC payload. An
absent property is a normal outcome, never an error.

## Engine v3 — whole-scene recording (architecture as of 2026-08-22)

`RUNTIME-API.md` is required reading: the published typings are wrong in both
directions, and every workaround in the engine is anchored to a live-verified
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
  `reorder-layers`, `break-scene` (removed SCENE layer + adds in one tick),
  `nest-layers` (added SCENE layer + removals in one tick). In-layer payloads
  carry a `layer: LayerRef {id, name, priorName}` binding and, on deep paths,
  a `shapeHint`.
- **Replay picks a mode in `chooseMode` (plugin/playback.ts)**: macros
  touching >1 pre-existing layer or containing unretargetable scene ops
  (remove/reorder/break/nest/fresh add-layer) run as SCENE SCRIPTS — each
  step resolves its layer id → name → priorName → skip-note; values apply
  exactly; layers created during the replay register in `layerByRecordedId`
  so later steps bound to recorded new-layer ids find them. Macros touching
  ≤1 pre-existing layer with a selection run in TARGETS mode — apply to every
  selected layer with smart offsets (`propClassOf`: only length-1 transform
  paths are relative; origins = recorded first-touch value, keyframed paths
  use the lowest-frame value); duplicate steps clone each SELECTED layer
  (chained duplicates clone the replay's copies via per-target maps) and
  shift by the recorded offset from the target's own position.
- **Replay means DO IT**: nest/add ops re-execute; adoption of an existing
  layer (id-only match) is a fallback for same-scene replays where the
  action already happened (prevents duplicate/empty-shell rebuilds).
  `nest-layers` prefers the current selection as its sources (tool
  semantics); inside instance content, resolution is strictly index-ordered
  (user decision — no shape-type redirect there).
- **Nothing applies silently**: `applyStep` returns `StepOutcome.notes` for
  deliberate non-applies/adaptations (cross-kind recolors adapt: solid↔
  gradient, static and keyframed; trim edits create the trim on demand; paint
  paths remap singular text fills). Genuine failures throw and pause. Keep
  this invariant — silent half-applies were the original disease.
- Keyframe machinery (applier): frame-keyed matching via `getKeyframeAt` with
  `hasKeyframes` phantom-guard, verified adds + frame-0 sentinel, same-frame
  add+remove guard (legacy macros), move re-pairing in the differ, collision
  upsert (occupant gives way), per-entry fault tolerance.

## Open threads (as of last update)

- Nesting-from-selection: CONFIRMED platform limitation (see LIMITATIONS.md
  for the breadcrumb evidence and the upstream ask). The guess-chain stays in
  place so a future host that adds any of the routes starts working without
  code changes.
- Never live-verified yet: mask add/remove/edit replay; scene-layer reorder
  replay. (`shiftTo` throws for both guessed signatures — see RUNTIME-API.md.)
- Repeat-applying an offsets macro to the same layer compounds by design —
  user hasn't decided whether that should stay.
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
call `crypto.randomUUID` directly. Persistence is likewise environment-split:
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

Note `.claude/launch.json` declares `https://localhost:5173`; Vite serves plain
HTTP, so prefer `http://` as the README says.
