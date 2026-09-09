# Automation backlog

This document records automation this project has proposed but not built. Each
entry names the evidence that motivated it, what it would build, and a rough
size (S: a session, M: a few sessions, L: a project of its own). Move an entry
out of this file and into `docs/history/improvements.md` once it ships.

## Trace index: `traces/index.jsonl` and `pnpm traces:stale`

Triage this session read `traces/.processed` by hand to find what was new,
and `docs/contributing/triage.md`'s workflow has no automated way to flag a
trace whose `env.sandboxRev` no longer matches `ENGINE_REV`. `scripts/trace-server.ts`
would append one line per captured trace to `traces/index.jsonl` (timestamp,
kind, sandbox and UI revisions, byte size), and `pnpm traces:stale` would list
entries whose revision predates the current `ENGINE_REV`. Size: S.

## Prettier clean-up, then `format:check` in CI

`pnpm format:check` fails on 34 files today; `.github/workflows/ci.yml:20-24`
documents the omission as deliberate, pending a one-shot cleanup. The build
is one commit that runs `pnpm format` across the tree, reviewed for
unintended diffs, followed by adding `pnpm format:check` back into
`ci.yml` so the tree cannot drift again. Size: S.

## Token contrast test: `ui/theme/vintageTokens.test.ts`

The 2026-09-07 session hand-solved the blue Record key's stops to match the
red key's contrast ratios rather than checking them by rule. A test over
`ui/theme/vintageTokens.ts` would assert the legend-on-plate ratio is at
least 4.5, the plate-on-chassis ratio is at least 3, and each blue stop's
relative luminance sits within 0.005 of its red twin, so a future palette
edit cannot silently break contrast or the red/blue pairing. Size: S.

## `ui-probe` and `docs-audit` Claude skills

This session ran headless-Chrome checks and a full documentation audit as
one-off, hand-written passes rather than repeatable tools. `ui-probe` would
wrap the driver and scenarios from `pnpm test:ui` (see the automation plan)
as an on-demand skill for a single ad hoc check; `docs-audit` would grep the
facts `pnpm lint:docs` tracks and flag prose that quotes a number without
the lint's keyword-window matching, for a broader sweep than the lint
covers. Size: M.

## Implementation, review, fix-with-failing-test loop as standing practice

The most-caught bugs this session came from an independent second look, not
from the implementer re-reading their own diff. Adopting the loop as a
standing practice means every non-trivial change goes through three steps:
one agent implements, a second, independently-briefed agent reviews the
diff, and any confirmed finding gets a failing regression test before the
fix lands — the same discipline `.claude/skills/triage-traces/SKILL.md`
already applies to trace findings. Size: L (a practice, not a one-time
build).
