# Trace triage

Every dev session writes a trace bundle per record run and per playback run.
This document tells you what a bundle holds, which rules keep it honest, which
engine revision each diagnostic field arrived in, and how to turn a bundle into
a confirmed finding with a regression test behind it.

**Trace bundles are large — never read one into the main context.** The triage
agents exist for that.


## What a trace holds

**Check `env.sandboxRev` first.** Creator evaluates `plugin.js` once at plugin
load and never re-fetches it, so a stale sandbox reproduces bugs that are
already fixed. The handshake stamps the sandbox and panel revisions into every
trace. See [`engine-rev.md`](engine-rev.md) for the full trap.

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

## The dev strip

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

## The triage agents

Two agents back the workflow: `.claude/agents/macro-triage.md` (read-only
diagnosis) and `.claude/agents/macro-fixture.md` (writes the regression test,
never production code). Trace bundles are large — never read one into the main
context; that is what the triage agents are for.

## The triage loop

Run `/triage-traces` in Claude Code. The loop is: you break it, traces land,
agents triage, you confirm, fixtures pin it, fixes land.

1. **Find unprocessed traces.** `traces/.processed` names the files already
   triaged, one per line. The skill skips those.
2. **Size each trace before you read it.** Bundles carry full node snapshots.
   Never read one directly into the main context.
3. **Fan out.** One read-only `macro-triage` agent per unprocessed trace, all
   in one message so they run concurrently, about six per batch. Each agent
   checks `env.sandboxRev` first, classifies the trace against the failure
   taxonomy in `.claude/agents/macro-triage.md`, and returns a diagnosis with
   `file:line` evidence and a minimal reproduction.
4. **Consolidate.** Dedupe by taxonomy number plus source location, not by
   wording. Rank silent failures first — a step that changes nothing while
   reporting neither a failure nor a note is worse than a loud error, because
   the user cannot see it. A noted non-apply is deliberate and visible, so it
   is not silent. Read the cited `file:line` yourself before you act on it: an
   agent's diagnosis is a lead, not a fact.
5. **Pin, then fix.** Dispatch a `macro-fixture` agent to write the regression
   test, confirm the test fails for the right reason, and only then write the
   fix. Re-run `pnpm test` and `pnpm test:quickjs`. Add a row to
   [`../history/improvements.md`](../history/improvements.md); the fix is not
   done until you log it there.
6. **Record what was handled.** Append the triaged filenames to
   `traces/.processed`.

Never fix without a test first. The whole point of the trace loop is that
findings stay fixed.

Nothing cleans `traces/` automatically. Delete it when you finish.
