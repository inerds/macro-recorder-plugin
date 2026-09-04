# CLAUDE.md

Macro Recorder is a LottieFiles Creator plugin. It records the edits you make
in Creator — transforms, paints, keyframes, text, structure — as a named,
replayable macro, and replays those steps onto whatever you select. The panel
is React in Creator's UI iframe; the engine is a QuickJS plugin sandbox; the
two talk over a small RPC protocol. This repository also doubles as an
open-source reference for other Creator plugin developers, so the docs are
written for an outside reader.

This file is a pointer plus the conventions an AI agent must follow here. The
rationale lives in `docs/`.

## Read these first

- [`README.md`](README.md) — what the plugin does, the three ways to run it,
  the playback modes, the accepted v1 limitations.
- [`docs/architecture.md`](docs/architecture.md) — the invariants behind the
  code's shape: the three TypeScript projects, the no-job-pump sandbox
  constraint, the proxy boundary, engine v3, the gateway seam, the runtime
  environments table.
- [`docs/design-system.md`](docs/design-system.md) — the skin, the deck, and
  the rack. Read it before you touch any CSS or UI structure.
- [`docs/contributing/writing-style.md`](docs/contributing/writing-style.md) —
  the documentation standard for every Markdown file you edit.
- [`docs/contributing/triage.md`](docs/contributing/triage.md) — trace bundles
  and the triage loop.
- [`docs/contributing/engine-rev.md`](docs/contributing/engine-rev.md) — the
  `ENGINE_REV` rule and the stale-sandbox trap.
- [`docs/runtime-api.md`](docs/runtime-api.md) — the host API's real runtime
  surface. The published typings are wrong in both directions.
- [`docs/limitations.md`](docs/limitations.md) — confirmed host limits, with
  evidence.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — setup, the checks a change must pass,
  and how a release is cut.

## Commands

```bash
pnpm dev                       # vite dev server on :5173 (serves both the UI and, via
                               # @lottiefiles/vite-plugin-creator, the plugin sandbox bundle)
pnpm build                     # tsc -b && vite build → dist/{manifest.json,plugin.js,ui.html}
pnpm type-check                # tsc -b across all three project references
pnpm test                      # vitest run (438 tests, 20 files, ~1s)
pnpm test:watch
pnpm test:quickjs              # builds first, then drives dist/plugin.js in real QuickJS
```

Single test file / single test:

```bash
pnpm vitest run engine/diff.test.ts
pnpm vitest run -t "position"          # filter by test name across all files
pnpm vitest engine/diff.test.ts        # watch just that file
```

`pnpm test:quickjs` is the only test that exercises the compiled bundle, so it is
stale until you `pnpm build` — the script does that for you, but it means a
sandbox-side change is *not* covered by `pnpm test` alone. Run both before
claiming plugin-side work is done.

## Rules for every change

1. **Bump `ENGINE_REV` in `engine/protocol.ts` with every sandbox-behaviour
   change.** Creator evaluates `plugin.js` once and never re-fetches it, so a
   stale sandbox reproduces bugs that are already fixed. See
   [`docs/contributing/engine-rev.md`](docs/contributing/engine-rev.md).
2. **After every fix, add a row to
   [`docs/history/improvements.md`](docs/history/improvements.md)** — what was
   wrong, what changed, a sentence or two each. A fix is not done until you log
   it there. Keep reasoning and design notes out of that log; they belong in
   `docs/architecture.md` or `docs/design-system.md`. File a confirmed platform
   limit in [`docs/limitations.md`](docs/limitations.md) with its evidence, and
   move the entry to the improvements log if the host later lifts it.
3. **Keep the proxy boundary.** Only `sandbox/serialize.ts` and
   `sandbox/applier.ts` touch Creator's live node proxies. New engine logic goes
   in `engine/`, driven by snapshots, so it stays unit-testable without a
   Creator mock. Never make `engine/testing/fakeScene.ts` more permissive than
   the real host.
4. **Never read a trace bundle into the main context.** Bundles are large. Use
   `/triage-traces`, which fans out the read-only `macro-triage` agent
   (`.claude/agents/macro-triage.md`) and the test-writing `macro-fixture`
   agent (`.claude/agents/macro-fixture.md`). Check `env.sandboxRev` first in
   any trace.
5. **Update [`docs/user-guide.md`](docs/user-guide.md) when user-facing
   behaviour changes**, and add a `CHANGELOG.md` entry for anything a user
   sees.

## Documentation conventions

[`docs/contributing/writing-style.md`](docs/contributing/writing-style.md) is
the standard for every Markdown document here: ASD-STE100 sentence
construction, Google developer style mechanics, and the terminology table.
Apply it to every documentation edit you make. Facts, paths, numbers, and trace
ids are content, not style — a style edit never changes them.

`README.md`, `docs/runtime-api.md`, and `docs/limitations.md` must work for an
outside plugin developer with none of this project's context. The README stays
free of UI and skin material; those rules live in `docs/design-system.md`.

`CLAUDE.md` itself keeps its rationale under a lighter application of the
guide: tighten its sentences, but never remove the "why".
