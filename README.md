# Macro Recorder — LottieFiles Creator plugin

Macro Recorder records the edits you make in Creator — transform changes,
fills, keyframes, structure, and more — as a named, replayable **macro**. It
replays those steps onto whatever you select.

Inside Creator, the real engine runs. The panel polls the plugin sandbox
every 500ms over a small RPC protocol. The sandbox snapshots the scene, diffs
it against the previous snapshot, and returns human-labeled steps. Macros
persist in `creator.clientStorage`. Standalone, in a plain browser tab, the
handshake times out and the panel falls back to mock gateways and the dev
strip.

Document map:

- `USER-GUIDE.md` — the end-user walkthrough of every feature.
- `RUNTIME-API.md` — the host API's real runtime surface. Read it before you
  extend the engine; the published typings are wrong in both directions.
- `LIMITATIONS.md` — confirmed host limits, with evidence.
- `IMPROVEMENTS.md` — the running log of fixes.
- `CLAUDE.md` — the invariants behind the code's shape.
- `STYLE-GUIDE.md` — the documentation style standard.

## The panel

The panel wears one committed skin: cream surfaces, ink outlines, red as the
only action color, and a reel-to-reel **deck** on top of every screen. The
reels spin while you record and replay, but they are decoration — the lamp and
the state word always carry the same information, which is what
`prefers-reduced-motion` falls back to. The saved-macro list below reads as a
console readout. The panel does not follow Creator's light or dark theme, and
it loads no network assets. `CLAUDE.md` documents the skin's rules.

## How the engine works

- `shared/` holds the pure, fully unit-tested logic both sides use: protocol,
  snapshot model, structural differ, labels, relative-playback math,
  simplification, and value editing.
- `plugin/` is the QuickJS sandbox: RPC dispatcher, defensive
  proxy-to-snapshot serializer, step applier, and the `clientStorage` store.
  The sandbox has no timers — the panel owns all timing.
- `src/gateways/rpc/` is the panel side: the RPC bridge, the tick-loop
  recorder gateway, and the paced step-by-step playback orchestrator.

Recording watches the whole scene — every layer's subtree, paints, masks,
trims, plain flags, and structure (add, duplicate, remove, nest, reorder). You
need no selection to start. While you record, selecting one keyframed layer
offers to **capture** its keyframes and current style into the macro.

Replay picks one of two modes. A macro that touched at most one layer applies
to every **selected layer**: the layer's own position, rotation, and skew
shift each target from its own start, scale multiplies, and everything else
applies exactly. A macro that touched several layers, or that restructured the
scene, replays as a **scene script**: each step finds its layer by recorded
id, then by name, then skips with a note.

Two rules govern every step:

- **Keyframes converge.** A macro means "end up like this". Frame numbers are
  the only keyframe identity, adds upsert onto occupied frames, and removes of
  absent keyframes do nothing.
- **Nothing applies silently.** The host discards some writes without an
  error, so the applier verifies and reports a note for every non-apply or
  adaptation. Genuine failures pause for Continue or Stop.

Pro tools are client-side data transforms: Simplify, per-step disable and
edit, parameters (pinned values asked for on play), and the play options —
at playhead, stagger, and repeat ×N.

## Run it

### Standalone (primary dev loop)

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173` and size the viewport to about 300×520. The
**Dev tools** strip at the panel foot (dev builds only) loads the ten demo
macros, clears the store, controls the mock recorder and playback scenarios,
and shows captured traces.

### Inside Creator

Run `pnpm dev`, then add the plugin in
[Lottie Creator](https://lottiefiles.com/creator):

1. Open the Plugins panel.
2. Click **+**.
3. Open the **Develop** tab.
4. Enter `http://localhost:5173`.
5. Click Continue.

**After any change under `plugin/` or `shared/`, remove and re-add the
plugin.** Creator evaluates `plugin.js` once and never re-fetches it, while
Vite serves the panel fresh. Bump `ENGINE_REV` in `shared/protocol.ts` with
every sandbox-side change; the handshake compares revisions and logs a loud
`plugin engine is STALE` warning on mismatch.

### Host harness (full loop, no Creator)

`http://localhost:5173/host-harness.html` emulates the host: a fake `creator`
global, fake scene nodes, the real compiled `plugin.js`, and the real panel
iframe. Run `pnpm build` first — the harness loads the compiled bundle. Drive
the fake scene from the console through `window.harness`.
`public/sandbox-test.html` reproduces Creator's opaque-origin iframe (no
`localStorage`, no `crypto.randomUUID`) for the fallback paths.

## Tests

```bash
pnpm test          # vitest: engine logic, reducer, demo-macro replay
pnpm test:quickjs  # builds, then drives dist/plugin.js in real QuickJS
pnpm type-check    # tsc -b across all three project references
pnpm build         # production bundle → dist/ (manifest.json, plugin.js, ui.html)
```

`test:quickjs` exists because Creator invokes the sandbox's callback without
pumping the VM job queue. A pure VM promise chain never settles there, so code
that passes in a browser can be dead in Creator. The smoke test drives the
real bundle with zero pumps and asserts the RPC contract holds.

## Diagnostics and triage

Dev sessions write a **trace bundle** per record and playback run to
`traces/`. Each bundle carries what the panel never shows: every RPC call
with timing, the `{prev, next}` snapshot pair behind each recorded tick, and
per-target probes before and after each playback step. Snapshot and probe
payloads are opt-in per session (`debug: true`, dev builds only), so a
production panel gets byte-identical responses.

To triage captured traces, run the skill in Claude Code:

```text
/triage-traces
```

The skill:

1. Lists the trace files that `traces/.processed` does not name yet.
2. Fans out one read-only `macro-triage` agent per trace. Each agent checks
   `env.sandboxRev` first, then classifies the trace against the failure
   taxonomy and returns a diagnosis with evidence.
3. Dedupes and ranks the findings.
4. Turns each confirmed finding into a failing regression test through the
   `macro-fixture` agent before anyone writes a fix.
5. Appends the triaged filenames to `traces/.processed`.

Trace bundles are large — never read one into the main context; the agents
exist for that. Nothing cleans `traces/` automatically; delete it when you
finish. When you triage by hand, check `env.sandboxRev` first: a stale
sandbox reproduces bugs that are already fixed.

## Architecture pointers

- `src/state/appReducer.ts` — one discriminated-union state machine
  (`idle → recording → reviewing`, `idle → playing`).
- `src/gateways/types.ts` — the three gateway interfaces the panel talks to;
  `src/gateways/index.ts` is the single real-versus-mock seam.
- `plugin/serialize.ts` and `plugin/applier.ts` — the only two files that
  touch Creator's live node proxies. Everything downstream is plain data.
- `shared/testing/fakeScene.ts` — the test double for the proxy surface,
  shared by the harness and vitest. It reproduces the host's traps on
  purpose, above all that a `staticValue` write does nothing while keyframes
  exist. Never make it more permissive than the real host.

## Accepted limitations (v1)

- The layout holds a `min-width: 260px` and scrolls horizontally below that.
- Sharing is **Copy JSON** and **Import**, not file export — Creator's
  sandboxed iframe can block downloads. `LIMITATIONS.md` tracks the host
  limits with their evidence.
