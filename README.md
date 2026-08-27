# Macro Recorder — LottieFiles Creator plugin

Macro Recorder records the edits you make in Creator — transform changes,
fills, keyframes, and more — as a named, replayable **macro**. It replays
those steps onto whatever you select.

**Inside Creator** the real engine runs. The panel polls the plugin sandbox
every 500ms over a small RPC protocol. The sandbox snapshots the recorded
node, diffs it against the previous snapshot, and returns human-labeled
steps. Macros persist in `creator.clientStorage`. **Standalone**, in a plain
browser tab, the handshake times out, and the panel falls back to the mock
gateways and the DebugStrip.

For the end-user walkthrough of every feature — recording, review,
simplify/edit/disable, play options, parameters, and import/export — see
**`USER-GUIDE.md`**.

## What the panel looks like

The panel wears one committed skin: warm cream surfaces, dark-ink outlines,
red as the only action colour, and compact uppercase instrument labels. It
reads as retro audio hardware with a modern list under it. The panel does
**not** follow Creator's light/dark theme. `src/theme/vintageTokens.ts`
exports `VINTAGE_TOKENS`, and the library's `ThemeProvider` writes those
tokens as inline custom properties on `<html>`, which override every token
`theme.css` defines. `useTheme()` still observes Creator's theme messages,
but it applies nothing.

The **deck** tops every screen: one full-bleed dark chassis, square to the
panel edges. A reel-to-reel window sits bezelled into it, and a transport bar
runs across the bottom. The bar holds the status lamp and the state word,
plus the equal-width REC and STOP keycaps centred on the chassis. It also
holds a recessed counter window that carries the clock and the step count.
The reels spin while you record, rewind when you trigger a macro, run forward
while the macro plays, and coast to a stop when it ends. They are decoration,
because the lamp and the word say the same thing, which is what
`prefers-reduced-motion` falls back to. The faceplate's lower legend is the
package version, injected at build time.
Below 352px of panel height, a container query scales the stage down to a
72px strip. That breakpoint is where the macro list stops working, not where
the deck gets big.

Under the deck, the saved-macro list reads as a **console readout**: one
shallow well, rows divided by dotted rules, monospace names with a leader
running to a two-digit step count, and a lit index. One light source, high
and slightly left, lights everything, and that consistency is what makes the
parts read as one object. The panel uses system fonts only, and no network
assets.

## How the engine works

The engine has these parts and behaviors:

- `shared/` holds the pure plain-data logic that both sides use, and the unit
  tests cover it fully. It contains the RPC protocol (`protocol.ts`), the
  snapshot model and candidate property registry (`snapshot.ts`), the
  structural differ (`diff.ts`), the step labels (`labels.ts`), the
  relative-playback math (`relative.ts`), step simplification (`simplify.ts`),
  and step value editing (`editing.ts`).
- `plugin/` is the QuickJS sandbox side: a serial RPC dispatcher, a defensive
  proxy-to-snapshot serializer (`serialize.ts`), a step applier with path
  resolution (`applier.ts`), and a `clientStorage`-backed store. The sandbox
  has **no timers** — it acts only on messages, and the panel owns all timing.
- `src/gateways/rpc/` is the panel side: a correlation-id RPC bridge, a
  tick-loop recorder gateway, and a step-by-step playback orchestrator.
- **Whole-scene recording**: Record watches every layer. It records edits
  anywhere in any layer's subtree — child geometry, fills, strokes, masks,
  trim paths, and plain flags. It also records scene structure: **layer
  duplication and copy-paste** (detected structurally, replayed as real
  `clone()` calls), new layers, layer deletion, and layer reordering. You need
  no selection to start recording.
- **Capture existing animation**: while you record, selecting a single keyframed
  layer raises an offer that pulls its state into the macro. **Add all**
  takes every animated path as keyframe steps, plus the layer's current look
  (whole fills with their kind, static transforms, text/font, blend mode).
  Existing timeline work therefore becomes a reusable macro without
  re-authoring. **Add selected** — only the keyframes you pick on the
  timeline — ships feature-detected, but a host limit blocks it today:
  Creator never populates `selection.keyframes`. See `LIMITATIONS.md`.
- **One playback semantics, no modes**: the layer's own position, rotation,
  and skew shift each target from its own start, and scale multiplies.
  Everything else — colors, geometry, child-shape values, and keyframe timing
  — applies exactly. Keyframed motion on the layer transform offsets the same
  way, anchored to the recorded motion's lowest-frame value. Replaying onto
  the original layer reproduces the original result.
- **Replay targeting**: a macro that touched several layers, or that
  restructured the scene, replays as a scene script. Each step finds its layer
  by recorded id, then by name, then skips with a note. Duplicate steps always
  duplicate, and edits recorded on a duplicate resolve to the copy that the
  replay creates. A macro that touched at most one layer keeps selection
  semantics: it applies to every selected layer with smart offsets, and falls
  back to the original layer when you select nothing. **Duplicate-macros are
  tools**: "duplicate the layer, edit the copy" clones each *selected* layer,
  and the copy's edits follow its clone, offset from the clone's own start.
  Deep paths re-find children by index, then by shape type.
- **Keyframes converge, they do not replay deltas.** A macro means "end up
  like this", not "apply these edits" — a target's timeline has no guaranteed
  relationship to the recorded layer's. So removing a keyframe the target
  never had does nothing. Updating one that is not there creates it. Adding
  one where a frame is already taken updates it in place instead of
  duplicating it. Each keyframe applies independently, so one bad entry cannot
  drop the rest of the step. The engine never matches on recorded keyframe
  *ids*: `Keyframe.id` is readonly and engine-assigned, so an id from one
  layer can never identify another layer's. Frame is the only identity a macro
  can carry across nodes.
- **Nothing applies silently.** Creator discards a static value written to a
  property that is animated on the target, and it reports no error. Playback
  therefore reports a note instead of a phantom success. Playback collects the
  notes across the run and shows them when it finishes, and it logs them in
  full to the console. Notes do not interrupt playback.
- Genuine per-step failures ("target has no fills") still pause for
  Continue/Stop. Deleting the recorded layer while you record stops recording
  automatically, with a notice.
- **Pro-workflow tools (v3.1)** are all client-side data transforms, except
  the frame shift:
  - *Simplify* (review sheet and macro detail) collapses a drag's micro-steps
    into one first→last step per property, and folds keyframe edit chains into
    one net delta (`shared/simplify.ts`). It is manual, never automatic.
    *Disable* a step with the eye toggle, and playback skips it. *Edit* a
    step's value inline: numbers, vectors, colors, text, and new-layer names.
  - *Play options* (the sliders button next to Play): **At playhead** slides
    the macro so its earliest keyframe lands on
    `creator.timeline.currentFrame`. **Stagger** adds N frames per selected
    layer (cascade). **Repeat ×N** replays the macro N times — offsets
    compound, which is the point (spirals, steps).
  - *Parameters*: pin an editable step in review. Playing the macro first
    shows a form with those values (defaults = recorded), and then applies the
    edited copy. Pins ride along in exported JSON.

The plugin API's real runtime surface differs from the published typings in
both directions, and **`RUNTIME-API.md`** documents it — read that file before
you extend the engine. **`LIMITATIONS.md`** documents the known limits with
their evidence. Per-fill opacity is the headline: it is invisible to the
plugin API, as runtime introspection confirms. Two operational notes matter
here. A fast drag coalesces into about 2 steps per second, because the
recorder polls. The recorder does not capture edits outside the recorded
layer's subtree (single-layer scope).

The applier works around two host quirks at playback, and real Creator traces
show both. Creator silently ignores a keyframe added at frame 0 to a
not-yet-animated property, so the applier seeds animation with a sentinel
keyframe and retries. `isAnimated` can stay true after every keyframe is
removed, so the static-write guard checks that keyframes actually exist.

**After you change anything under `plugin/` or `shared/`, reload the plugin in
Creator** — remove it and add it again. Creator evaluates `plugin.js` once at
plugin load and never re-fetches it, while Vite serves the panel fresh, and a
stale engine makes traces misleading. The panel compares engine revisions at
the handshake and logs a loud `plugin engine is STALE` warning when this
happens. Bump `ENGINE_REV` in `shared/protocol.ts` alongside sandbox-side
changes.

## Run standalone (primary dev loop)

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173`. Size the window or viewport to about 300×520.
The **Dev tools** strip at the bottom (dev builds only) reaches every panel
state:

- **Seed 3 / Clear** — populate or empty the saved-macro list (localStorage)
- **Recorder** — mock recording scenario: short burst (6 steps), long (20), silent (0 steps)
- **Playback** — mock playback scenario: all pass, fail at step 3, no selection
- **Emit step** — push one step manually while you record

## Run inside Creator

```bash
pnpm dev
```

Then add the plugin in [Lottie Creator](https://lottiefiles.com/creator):

1. Open the Plugins panel.
2. Click **+**.
3. Open the **Develop** tab.
4. Enter `http://localhost:5173`.
5. Click Continue.

The panel opens at 300×520. On mount, the panel pings the plugin sandbox and
logs `plugin sandbox connected` to the console — that proves the postMessage
seam the real engine will use.

## Diagnostics: capturing traces

Dev builds record a **trace bundle** for every record and playback session,
and POST it to the dev server, which writes it to `traces/`. This is how you
diagnose a failing macro: the bundle carries the data the panel never shows.
Each bundle holds:

- Every RPC call in both directions, with timing (tapped once, in
  `src/gateways/rpc/bridge.ts`).
- For each recorded tick, the `{ prev, next }` **snapshot pair** the engine
  diffed the steps from. Any recording bug therefore replays as a pure
  `diffSnapshots()` unit test with no mocking.
- For each playback step, a **per-target probe** before and after: the value
  at the touched path, whether that property is animated, and the target's
  actual keyframe frames. A step that reports success while the before and
  after probes are identical did nothing — the silent-failure class that the
  panel never shows.

Snapshots and probes are **opt-in per session**: the panel sends `debug: true`
only under `import.meta.env.DEV`, so a production panel gets byte-identical
responses. `pnpm test:quickjs` asserts both halves of that contract.

The dev-only strip at the bottom of the panel shows the events captured and
the last file written, in **both** engine and mock mode. If the dev server is
unreachable, the trace stays in memory, and **Copy** puts it on the clipboard.
When the sandbox denies clipboard access, Copy writes the trace to the
console.

Nothing cleans up traces automatically — delete `traces/` when you finish.

### Triaging what you captured

Run `/triage-traces` in Claude Code. It fans out one agent per trace, dedupes
and ranks the findings, and then turns each confirmed finding into a
regression test before anyone fixes it. See `.claude/agents/macro-triage.md`
and `.claude/agents/macro-fixture.md`.

## Tests

```bash
pnpm test          # vitest: reducer, store, diff/labels/relative engine logic
pnpm test:quickjs  # builds, then runs plugin.js inside REAL QuickJS with
                   # Creator's no-job-pump callback semantics (see below)
pnpm type-check    # tsc -b
pnpm build         # production bundle → dist/ (manifest.json, plugin.js, ui.html)
```

**Why test:quickjs exists:** Creator invokes the sandbox's `onMessage`
callback without pumping the VM job queue afterward. Pure VM promise chains
(`Promise.resolve().then(...)`) therefore never run there, and code that
passes in a browser can be dead in QuickJS. The RPC dispatcher responds
synchronously for sync handlers, and an async handler must start by awaiting a
native-backed promise (`creator.clientStorage.*`). The smoke test enforces
this: it drives the real bundle in quickjs-emscripten with zero pumps.

## Architecture

These files define the architecture:

- `src/state/appReducer.ts` — single discriminated-union state machine:
  `idle → recording → reviewing → idle`, and `idle → playing → idle`.
- `src/gateways/types.ts` — `RecorderGateway`, `PlaybackGateway`, and
  `MacroStore`. The panel talks only to these interfaces, and
  `src/gateways/index.ts` is the single seam that swaps mocks for the real
  Creator-API implementations.
- `src/components/StepList.tsx` — the shared step renderer that the live
  recording feed, the review sheet, and the saved-macro detail view all use.
- `plugin/plugin.ts` — the plugin-sandbox side. It currently only sizes the
  window and echoes a ping. The real recorder and playback engine will live
  here.

### Known constraint for the real engine

Creator's public plugin API has **no fine-grained edit events** — only
`selection:nodes`, `selection:keyframes`, and coarse `change:*`. The real
recorder must poll the selected node's `Animatable` properties, diff them, and
synthesize steps. The panel's step model (`kind` + human label + opaque
`payload`) is designed for exactly that.

### Sandbox constraints inside Creator

Creator mounts plugin UIs in an `<iframe sandbox="allow-scripts">`, which is
an **opaque origin**. Two things follow, and the code handles both:

- `localStorage` throws a SecurityError there, so `LocalMacroStore` falls back
  to in-memory storage. **Macros do not survive a reload inside Creator**
  until the real `creator.clientStorage` engine is wired in
  (`src/gateways/index.ts`).
- `crypto.randomUUID` is unavailable, because an opaque origin over http is
  not a secure context, so ids come from `src/utils/id.ts`.

`public/sandbox-test.html` reproduces this exact sandbox for local testing.
Open `http://localhost:5173/sandbox-test.html` in a normal browser.

`public/host-harness.html` goes further: it emulates Creator's host with a
fake `creator` global and fake scene nodes, runs the REAL compiled
`plugin.js`, and mounts the real UI iframe. You can therefore test the full
record→diff→playback loop in a plain browser. Drive the fake scene from the
console through `window.harness`: set `harness.selection = [harness.nodes.A]`,
then mutate `harness.nodes.A.position.staticValue`, or call
`harness.animate(harness.nodes.A, "position", [{frame:0,value:{x:0,y:0}}])`.

The fake scene lives in `shared/testing/fakeScene.ts`, and both that page and
the vitest suite import it, so the tests and the harness drive one
implementation. It mirrors the real API's awkward parts deliberately, above
all that **writing `staticValue` does nothing when keyframes exist**. A
friendlier fake would hide the exact bug class this harness exists to catch.
`node.__control.setGone()`, `.failProp(name)`, and `prop.__failAdd(msg)`
inject failures.

### Accepted limitations (v1)

- You can resize the panel below 300px. The layout holds a `min-width: 260px`
  and scrolls horizontally below that.
- Export uses a Blob download, and inside Creator's sandboxed iframe the host
  can block downloads — revisit this when you wire the real engine.
