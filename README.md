# Macro Recorder — LottieFiles Creator plugin

Records the edits a user makes in Creator (transform changes, fills, keyframes, …)
as a named, replayable **macro**, and replays them onto whatever is selected.

**Inside Creator** the real engine runs: the UI polls the plugin sandbox every
500ms over a small RPC protocol; the sandbox snapshots the recorded node,
diffs against the previous snapshot, and returns human-labeled steps. Macros
persist in `creator.clientStorage`. **Standalone** (plain browser tab) the
handshake times out and the app falls back to mock gateways + the DebugStrip.

## How the engine works

- `shared/` — pure plain-data logic, used by both sides and fully unit-tested:
  RPC protocol (`protocol.ts`), snapshot model + candidate property registry
  (`snapshot.ts`), structural differ (`diff.ts`), step labels (`labels.ts`),
  relative-playback math (`relative.ts`).
- `plugin/` — the QuickJS sandbox side: serial RPC dispatcher, defensive
  proxy→snapshot serializer (`serialize.ts`), step applier with path resolution
  (`applier.ts`), clientStorage-backed store. The sandbox has **no timers** —
  it acts purely on messages; the UI owns all timing.
- `src/gateways/rpc/` — the UI side: correlation-id RPC bridge, tick-loop
  recorder gateway, step-by-step playback orchestrator.
- **Whole-scene recording**: Record watches every layer — edits anywhere in
  any layer's subtree (child geometry, fills/strokes/masks/trim paths, plain
  flags), plus scene structure: **layer duplication and copy-paste** (detected
  structurally, replayed as real `clone()` calls), new layers, layer deletion,
  and layer reordering. No selection needed to start recording.
- **One playback semantics, no modes**: the layer's own position/rotation/skew
  shift each target from its own start and scale multiplies; everything else —
  colors, geometry, child-shape values, keyframe timing — applies exactly.
  Keyframed motion on the layer transform offsets the same way, anchored to
  the recorded motion's lowest-frame value. Replaying onto the original layer
  reproduces the original result.
- **Replay targeting**: a macro that touched several layers (or restructured
  the scene) replays as a scene script — each step finds its layer by recorded
  id, then by name, then skips with a note; duplicate steps always duplicate,
  and edits recorded on a duplicate resolve to the copy created at replay. A
  macro that touched at most one layer keeps selection semantics: it applies
  to every selected layer with smart offsets, falling back to the original
  layer when nothing is selected. **Duplicate-macros are tools**: "duplicate
  the layer, edit the copy" clones each *selected* layer and the copy's edits
  follow its clone, offset from the clone's own start. Deep paths re-find
  children by index, then by shape type.
- **Keyframes converge, they don't replay deltas.** A macro means "end up like
  this", not "apply these edits" — a target's timeline has no guaranteed
  relationship to the recorded layer's. So removing a keyframe the target never
  had is a no-op; updating one that isn't there creates it; adding one where a
  frame is already taken updates it in place instead of duplicating. Each
  keyframe applies independently, so one bad entry can't drop the rest of the
  step. Recorded keyframe *ids* are never used to match: `Keyframe.id` is
  readonly and engine-assigned, so an id from one layer can never identify
  another's — frame is the only identity a macro can carry across nodes.
- **Nothing applies silently.** Writing a static value to a property that is
  animated on the target is discarded by Creator without error, so playback
  reports it as a note instead of a phantom success. Notes are collected across
  the run and surfaced when it finishes (and logged in full to the console);
  they don't interrupt playback.
- Genuine per-step failures ("target has no fills") still pause for
  Continue/Stop. Deleting the recorded layer mid-recording auto-stops with a
  notice.

The plugin API's real runtime surface (which differs from the published
typings in both directions) is documented in **RUNTIME-API.md** — read it
before extending the engine. Known limits are documented with their evidence
in **LIMITATIONS.md** (per-
fill opacity is the headline: invisible to the plugin API, confirmed by
runtime introspection). Operational notes: a fast drag coalesces into ~2
steps/second (polling); edits outside the recorded layer's subtree are not
captured (single-layer scope).

Host quirks worked around at playback (both observed in real Creator traces):
adding a keyframe at frame 0 to a not-yet-animated property is silently
ignored by Creator — the applier seeds animation with a sentinel keyframe and
retries; and `isAnimated` can stay true after every keyframe is removed, so
the static-write guard checks that keyframes actually exist.

**After changing anything under `plugin/` or `shared/`, reload the plugin in
Creator** (remove and re-add it): Creator evaluates `plugin.js` once at plugin
load and never re-fetches it, while Vite serves the UI fresh — a stale engine
makes traces misleading. The UI compares engine revisions at handshake and
logs a loud `plugin engine is STALE` warning when this happens (bump
`ENGINE_REV` in `shared/protocol.ts` alongside sandbox-side changes).

## Run standalone (primary dev loop)

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173 and size the window/viewport to ~300×520. The
**Dev tools** strip at the bottom (dev builds only) reaches every UI state:

- **Seed 3 / Clear** — populate or empty the saved-macro list (localStorage)
- **Light/Dark** — theme toggle (inside Creator the host theme drives this)
- **Recorder** — mock recording scenario: short burst (6 steps), long (20), silent (0 steps)
- **Playback** — mock playback scenario: all pass, fail at step 3, no selection
- **Emit step** — push one step manually while recording

## Run inside Creator

```bash
pnpm dev
```

Then in [Lottie Creator](https://lottiefiles.com/creator): Plugins panel → **+** →
**Develop** tab → enter `http://localhost:5173` → Continue. The panel opens at
300×520. On mount the UI pings the plugin sandbox and logs
`plugin sandbox connected` to the console — that proves the postMessage seam the
real engine will use.

## Diagnostics: capturing traces

Dev builds record a **trace bundle** for every record and playback session and
POST it to the dev server, which writes it to `traces/`. This is how a failing
macro gets diagnosed: the bundle carries the data the UI never shows.

- Every RPC call in both directions, with timing (tapped once, in
  `src/gateways/rpc/bridge.ts`).
- For each recorded tick, the `{ prev, next }` **snapshot pair** the steps were
  diffed from — so any recording bug replays as a pure `diffSnapshots()` unit
  test with no mocking.
- For each playback step, a **per-target probe** before and after: the value at
  the touched path, whether that property is animated, and the target's actual
  keyframe frames. A step that reports success while the before/after probes are
  identical did nothing — the silent-failure class that is invisible in the UI.

Snapshots and probes are **opt-in per session**: the UI sends `debug: true` only
under `import.meta.env.DEV`, so a production UI gets byte-identical responses.
`pnpm test:quickjs` asserts both halves of that contract.

The dev-only strip at the bottom of the panel shows events captured and the last
file written, in **both** engine and mock mode. If the dev server is unreachable
the trace stays in memory and **Copy** puts it on the clipboard (or the console,
when the sandbox denies clipboard access).

Traces are not cleaned up automatically — delete `traces/` when you're done.

### Triaging what you captured

Run `/triage-traces` in Claude Code. It fans out one agent per trace, dedupes
and ranks the findings, then turns each confirmed one into a regression test
before anything is fixed. See `.claude/agents/macro-triage.md` and
`.claude/agents/macro-fixture.md`.

## Tests

```bash
pnpm test          # vitest: reducer, store, diff/labels/relative engine logic
pnpm test:quickjs  # builds, then runs plugin.js inside REAL QuickJS with
                   # Creator's no-job-pump callback semantics (see below)
pnpm type-check    # tsc -b
pnpm build         # production bundle → dist/ (manifest.json, plugin.js, ui.html)
```

**Why test:quickjs exists:** Creator invokes the sandbox's `onMessage`
callback without pumping the VM job queue afterward, so pure VM promise
chains (`Promise.resolve().then(...)`) never run there — code that passes in
a browser can be dead in QuickJS. The RPC dispatcher therefore responds
synchronously for sync handlers; async handlers must start by awaiting a
native-backed promise (`creator.clientStorage.*`). The smoke test enforces
this by driving the real bundle in quickjs-emscripten with zero pumps.

## Architecture

- `src/state/appReducer.ts` — single discriminated-union state machine:
  `idle → recording → reviewing → idle`, `idle → playing → idle`.
- `src/gateways/types.ts` — `RecorderGateway`, `PlaybackGateway`, `MacroStore`.
  The UI only talks to these interfaces; `src/gateways/index.ts` is the single
  seam where mocks get swapped for the real Creator-API implementations.
- `src/components/StepList.tsx` — shared step renderer used by the live
  recording feed, the review sheet, and the saved-macro detail view.
- `plugin/plugin.ts` — plugin-sandbox side; currently just sizes the window and
  echoes a ping. The real recorder/playback engine will live here.

### Known constraint for the real engine

Creator's public plugin API has **no fine-grained edit events** (only
`selection:nodes`, `selection:keyframes`, coarse `change:*`). The real recorder
must poll + diff the selected node's `Animatable` properties and synthesize
steps. The UI's step model (`kind` + human label + opaque `payload`) is designed
for exactly that.

### Sandbox constraints inside Creator

Creator mounts plugin UIs in an `<iframe sandbox="allow-scripts">` — an
**opaque origin**. Two things follow (both handled in code):

- `localStorage` throws a SecurityError there, so `LocalMacroStore` falls back
  to in-memory storage — **macros don't survive a reload inside Creator** until
  the real `creator.clientStorage` engine is wired in (`src/gateways/index.ts`).
- `crypto.randomUUID` is unavailable (opaque origin over http is not a secure
  context), so ids come from `src/utils/id.ts`.

`public/sandbox-test.html` reproduces this exact sandbox for local testing:
open `http://localhost:5173/sandbox-test.html` in a normal browser.

`public/host-harness.html` goes further: it emulates Creator's host with a
fake `creator` global + fake scene nodes, runs the REAL compiled `plugin.js`,
and mounts the real UI iframe — the full record→diff→playback loop is testable
in a plain browser. Drive the fake scene from the console via `window.harness`
(`harness.selection = [harness.nodes.A]`, then mutate
`harness.nodes.A.position.staticValue`, or
`harness.animate(harness.nodes.A, "position", [{frame:0,value:{x:0,y:0}}])`).

The fake scene lives in `shared/testing/fakeScene.ts`, imported by both that
page and the vitest suite, so tests and the harness drive one implementation. It
mirrors the real API's awkward parts deliberately — above all that **writing
`staticValue` does nothing when keyframes exist**. A friendlier fake would hide
the exact bug class this harness exists to catch. `node.__control.setGone()`,
`.failProp(name)` and `prop.__failAdd(msg)` inject failures.

### Accepted limitations (v1)

- Panel is user-resizable below 300px; the layout holds a `min-width: 260px`
  and horizontally scrolls below that.
- Export uses a Blob download; inside Creator's sandboxed iframe downloads may
  be blocked by the host — revisit when wiring the real engine.
