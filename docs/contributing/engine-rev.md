# ENGINE_REV and the stale-sandbox trap

`ENGINE_REV` in `shared/protocol.ts` is the sandbox's behaviour revision. This
document is short because the rule is short: bump it with every sandbox-side
change, and check it first when a trace looks wrong.

## The rule

Bump `ENGINE_REV` with EVERY sandbox-behaviour change (35+ bumps in one day was
normal). The handshake compares revisions, stamps both into traces
(`env.sandboxRev`/`uiRev`), and shows an in-panel banner on mismatch.

The current value looks like `2026-08-26.52`: the date of the change, then a
counter within that day.

## The trap

Creator evaluates `plugin.js` once at plugin load and never re-fetches it,
while Vite serves the UI fresh. After any change under `plugin/` or `shared/`,
you must remove and re-add the plugin in Creator. If you do not, traces
reproduce bugs that are already fixed.

The dev server force-recompiles `plugin.js` when any `plugin/` or `shared/`
source changes (`scripts/trace-server.ts` touches the entry file — the vendor
plugin only watches `plugin.ts` itself). That keeps the bundle fresh on disk;
it cannot make Creator re-read it.

## When you triage

Check `env.sandboxRev` FIRST. Stale-sandbox reproductions of already-fixed bugs
cost this project a full day. Diagnostic fields also arrived at known
revisions, so an older trace can be silent about a thing it never probed — the
rev fences are listed in [`triage.md`](triage.md).
