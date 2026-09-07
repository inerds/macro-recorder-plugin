# UI probe suite

`pnpm test:ui` opens the panel in headless Chrome and asks the page
questions that only a browser can answer: what paints on top of what, where a
box actually sits, what a key does when a modifier is held.

The unit tests (`pnpm test`) run in Node with no DOM, so a claim about layout
or stacking cannot be checked there. Three real bugs — a verb menu buried
under the deck, a letterboxed deck stage, a control that would not toggle —
survived code review and were only found when something could open the panel
and call `elementFromPoint`.

## Run it

```bash
pnpm test:ui                                    # starts its own Vite server
UI_PROBE_URL=http://localhost:5173/ pnpm test:ui # probe a panel you already run
CHROME=/path/to/chrome pnpm test:ui              # a Chrome somewhere else
```

Output is one `PASS`/`FAIL name — detail` line per assertion, like
`scripts/quickjs-smoke.mjs`. The command exits 1 if any line fails.
Screenshots land in `artifacts/ui/` (git-ignored), one per scenario plus
`<scenario>-error.png` when a scenario throws.

Chrome is found at `$CHROME`, then `/Applications/Google Chrome.app`, then
`google-chrome-stable` / `google-chrome` / `chromium` on `PATH`.

## The pieces

- `driver.mjs` — the whole browser layer. It launches Chrome, speaks the
  DevTools protocol over Node's global `WebSocket`, and offers two kinds of
  helper: generic (`navigate`, `setViewport`, `click`, `hover`, `key`,
  `rectOf`, `onTopAt`, `screenshot`) and panel-aware (`loadDemoMacros`,
  `expandFirstMacro`, `openPencil`, `openVerbMenu`, `readRow`, `chipText`).
  Anything that names a selector belongs here, not in a scenario.
- `run.mjs` — starts Vite on a free port unless `UI_PROBE_URL` is set, runs
  every scenario in `scenarios/`, counts the lines, and kills Chrome and the
  server on the way out (including on Ctrl-C).
- `scenarios/*.mjs` — one file per question.

## Add a scenario

Drop a file in `scenarios/`. It exports one async function that takes the
probe; `probe.check(name, ok, detail)` prints a line.

```js
export default async function myScenario(probe) {
  const { check } = probe;
  await probe.setViewport(320, 560);
  await probe.navigate();
  const rect = await probe.rectOf(".deck-chassis");
  check("the deck is on the page", rect !== null, JSON.stringify(rect));
  await probe.screenshot("my-scenario");
}
```

Rules that keep the suite honest:

- **Every scenario starts with `navigate()`.** It reloads the document and
  clears the demo-macro store, so scenarios cannot leak state into each
  other, and it absorbs the reload Vite's dependency optimizer fires on a
  cold start.
- **Say what was measured in the detail string.** A `FAIL` has to be
  actionable from the CI log alone, without re-running anything.
- **Assert the user's experience, not the implementation.** `onTopAt` beats
  reading a `z-index`: the z-index was correct in the bug that started this
  suite, and the menu was still unclickable.

## The rule this exists for

A claim about the DOM needs a probe. If a change, a commit message, or a
document says something is on top, aligned, sized, or reachable, there should
be a line in this suite that says so too.
