---
name: triage-traces
description: Diagnose macro-recorder trace bundles captured from real Creator sessions. Scans traces/ for unprocessed files, fans out one triage agent per trace in parallel, and consolidates a ranked report. Use when the user says traces are ready, asks what went wrong in a recording or playback session, or wants the traces triaged.
---

# Triage macro-recorder traces

Turns captured traces into confirmed, ranked findings backed by regression
tests. The loop is: **you break it → traces land → agents triage → I confirm →
fixtures pin it → fixes land.**

## 1. Find unprocessed traces

```bash
ls -la traces/*.json 2>/dev/null | tail -20
cat traces/.processed 2>/dev/null
```

`traces/.processed` lists filenames already triaged, one per line. Skip those.
If `traces/` is empty or missing, tell the user how to capture one — run
`pnpm dev`, open the plugin in Creator, record and replay — and stop.

## 2. Size each trace before reading it

```bash
wc -c traces/*.json | sort -n | tail
```

Trace bundles carry full node snapshots and can be large. **Never read one
directly into the main context** — that is what the triage agents are for.

## 3. Fan out

Launch one `macro-triage` agent per unprocessed trace, all in a single message
so they run concurrently. Give each agent exactly one file path. Cap at ~6 per
batch; if there are more, do the newest first and say so.

## 4. Consolidate

When the agents return:

1. **Dedupe** by taxonomy number plus the source location, not by wording —
   several traces usually show one underlying cause.
2. **Rank** by: silent failures first (a step changing nothing while reporting
   neither a failure nor a note — noted non-applies are deliberate and visible
   to the user), then loud failures by frequency across traces, then cosmetic.
3. **Verify before believing.** Read the cited `file:line` yourself for anything
   you intend to act on. An agent's diagnosis is a lead, not a fact.
4. Present a short table: rank, one-line verdict, taxonomy #, how many traces
   show it, confidence.

## 5. Pin, then fix

For each confirmed finding, in order:

- Dispatch a `macro-fixture` agent to write the regression test.
- Review the test yourself; confirm it fails for the right reason.
- Only then implement the fix, and re-run `pnpm test` plus `pnpm test:quickjs`.
- Add a row to `docs/history/improvements.md` (issue, fix — a sentence or two each). The fix
  is not done until it is logged there.

Never fix without a test first — the whole point of the trace loop is that
findings stay fixed.

## 6. Record what was handled

Append the triaged filenames to `traces/.processed` so the next run skips them.

## Notes

- The workflow, the trace-honesty rules, and the engine-revision fences are
  documented in `docs/contributing/triage.md`.
- `pnpm test:quickjs` must pass after any change to RPC shapes: it enforces the
  QuickJS no-job-pump contract that ordinary tests cannot catch.
- Debug payloads are opt-in per session; if a trace lacks `snapshots` or
  `targets` blocks, it was captured by a UI that did not request them, and the
  user should recapture with a dev build.
