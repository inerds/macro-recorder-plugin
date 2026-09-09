# ENGINE_REV and the stale-sandbox trap

`ENGINE_REV` in `engine/protocol.ts` is the sandbox's behaviour revision. This
document is short because the rule is short: bump it with every sandbox-side
change, and check it first when a trace looks wrong.

## The rule

Bump `ENGINE_REV` with EVERY sandbox-behaviour change (35+ bumps in one day was
normal). The handshake compares revisions, stamps both into traces
(`env.sandboxRev`/`uiRev`), and shows an in-panel banner on mismatch.

The value is the date of the change, then a counter within that day. At the
time of writing it is `2026-09-08.2`.

## The trap

Creator evaluates `plugin.js` once at plugin load and never re-fetches it,
while Vite serves the UI fresh. After any change under `sandbox/` or `engine/`,
you must remove and re-add the plugin in Creator. If you do not, traces
reproduce bugs that are already fixed.

The dev server recompiles `plugin.js` when any `sandbox/` or `engine/` source
changes. `@lottiefiles/vite-plugin-creator` 0.0.7 watches `sandbox/` itself.
For an `engine/` edit, `scripts/trace-server.ts` touches `sandbox/plugin.ts`
so that watcher rebuilds, because the plugin ignores every path outside
`sandbox/`. The touch is for `engine/` sources only, and it skips
`*.test.ts`. That keeps the bundle fresh on disk; it cannot make Creator
re-read it.

## When you triage

Check `env.sandboxRev` FIRST. Stale-sandbox reproductions of already-fixed bugs
cost this project a full day. Diagnostic fields also arrived at known
revisions, so an older trace can be silent about a thing it never probed — the
rev fences are listed in [`triage.md`](triage.md).

## The gate

`scripts/engine-rev-gate.mjs` enforces the rule instead of relying on memory.
It fails when the diff touches `sandbox/` or `engine/` — excluding `*.test.ts`
files and the `engine/testing/` and `sandbox/testing/` fixture directories —
without also adding a new `ENGINE_REV` line in `engine/protocol.ts`.

Two callers run it:

- The `pre-commit` hook (`.githooks/pre-commit`), wired in by `pnpm install`
  through `git config core.hooksPath .githooks`. It checks the staged diff
  and blocks the commit on a failure. It skips, rather than blocks, on a
  machine with no `node` on `PATH`.
- The `build-and-test` job in `.github/workflows/ci.yml`, on `pull_request`
  events only. It checks the diff between the base branch and the pull
  request's head, so a contributor who bypassed the hook still gets caught
  before merge.

`SKIP_ENGINE_REV=1 git commit …` bypasses the hook. Use it only for a change
that provably does not alter sandbox behaviour — a comment, a type-only edit —
and say why in the commit message. The bypass is honest because it covers only
the local hook: a change that reaches a pull request still meets the CI step,
which has no bypass.
