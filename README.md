# Macro Recorder — LottieFiles Creator plugin

Macro Recorder records the edits you make in Creator — transform changes,
fills, keyframes, structure, and more — as a named, replayable **macro**. It
replays those steps onto whatever you select.

This repository is also an open-source **reference for Creator plugin
developers**. Beyond the product, it documents patterns that any Creator
plugin needs:

- A panel-to-sandbox RPC protocol with a mock fallback, so every panel state
  is reachable without Creator (`ui/gateways/`, `engine/protocol.ts`).
- The QuickJS sandbox constraints that the typings do not mention, above all
  the no-job-pump callback contract (`pnpm test:quickjs` enforces it).
- The host API's real runtime surface, found by introspection
  (`docs/runtime-api.md`), and confirmed host limits with evidence
  (`docs/limitations.md`).
- A fake host scene for tests and a browser harness that reproduce the real
  proxies' traps (`engine/testing/fakeScene.ts`, `dev/harness/host-harness.html`).
- Trace-driven debugging: every dev session writes an auditable bundle of
  RPC traffic, snapshots, and probes (see "Diagnostics and triage").

Inside Creator, the real engine runs. The panel polls the plugin sandbox
every 500ms over a small RPC protocol. The sandbox snapshots the scene, diffs
it against the previous snapshot, and returns human-labeled steps. Macros
persist in `creator.clientStorage`. Standalone, in a plain browser tab, the
handshake times out and the panel falls back to mock gateways and the dev
strip.

Document map:

- [`docs/user-guide.md`](docs/user-guide.md) — the end-user walkthrough of every
  feature.
- [`docs/architecture.md`](docs/architecture.md) — the invariants behind the
  code's shape: the three TypeScript projects, the sandbox constraints, the
  proxy boundary, the recording engine, and the gateway seam.
- [`docs/design-system.md`](docs/design-system.md) — the panel's skin, deck, and
  rack rules.
- [`docs/runtime-api.md`](docs/runtime-api.md) — the host API's real runtime
  surface. Read it before you extend the engine; the published typings are wrong
  in both directions.
- [`docs/limitations.md`](docs/limitations.md) — confirmed host limits, with
  evidence.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — setup, the checks a change must pass,
  and how a release is cut.
- [`docs/contributing/`](docs/contributing/) — the writing style standard, the
  trace-triage workflow, and the `ENGINE_REV` rule.
- [`docs/history/`](docs/history/) — the engineering log, the 2026-08-24 UI
  audit, and the v3.1 roadmap.
- [`docs/releases/`](docs/releases/) — the release notes per shared build.
- [`CHANGELOG.md`](CHANGELOG.md) — user-visible changes per version.

## How the engine works

- `engine/` holds the pure, fully unit-tested logic both sides use: protocol,
  snapshot model, structural differ, labels, relative-playback math,
  simplification, and value editing.
- `sandbox/` is the QuickJS sandbox: RPC dispatcher, defensive
  proxy-to-snapshot serializer, step applier, and the `clientStorage` store.
  The sandbox has no timers — the panel owns all timing.
- `ui/gateways/rpc/` is the panel side: the RPC bridge, the tick-loop
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

Run `pnpm dev`, then add the plugin in Creator:

1. Open [creator.lottiefiles.com](https://creator.lottiefiles.com).
2. Open the Plugins panel.
3. Click the **+** icon at the top right.
4. Open the **Develop** tab.
5. Enter `http://localhost:5173` and click Continue.

**After any change under `sandbox/` or `engine/`, remove and re-add the
plugin.** Creator evaluates `plugin.js` once and never re-fetches it, while
Vite serves the panel fresh. Bump `ENGINE_REV` in `engine/protocol.ts` with
every sandbox-side change; the handshake compares revisions and logs a loud
`plugin engine is STALE` warning on mismatch.

### Host harness (full loop, no Creator)

`http://localhost:5173/host-harness.html` emulates the host: a fake `creator`
global, fake scene nodes, the real compiled `plugin.js`, and the real panel
iframe. Run `pnpm build` first — the harness loads the compiled bundle. Drive
the fake scene from the console through `window.harness`.
`dev/harness/sandbox-test.html` reproduces Creator's opaque-origin iframe (no
`localStorage`, no `crypto.randomUUID`) for the fallback paths.

## Tests

```bash
pnpm test          # vitest: engine logic, reducer, demo-macro replay (438 tests, 20 files)
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

- `ui/state/appReducer.ts` — one discriminated-union state machine
  (`idle → recording → reviewing`, `idle → playing`).
- `ui/gateways/types.ts` — the three gateway interfaces the panel talks to;
  `ui/gateways/index.ts` is the single real-versus-mock seam.
- `sandbox/serialize.ts` and `sandbox/applier.ts` — the only two files that
  touch Creator's live node proxies. Everything downstream is plain data.
- `engine/testing/fakeScene.ts` — the test double for the proxy surface,
  shared by the harness and vitest. It reproduces the host's traps on
  purpose, above all that a `staticValue` write does nothing while keyframes
  exist. Never make it more permissive than the real host.

## Accepted limitations (v1)

- The layout holds a `min-width: 260px` and scrolls horizontally below that.
- Sharing is **Copy JSON** and **Import**, not file export — Creator's
  sandboxed iframe can block downloads. `docs/limitations.md` tracks the host
  limits with their evidence.

## License

MIT — see `LICENSE`.
