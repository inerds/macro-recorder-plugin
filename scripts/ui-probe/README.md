# Browser probe suites

Two suites share one driver. `pnpm test:ui` opens the panel alone and asks
the page questions that only a browser can answer: what paints on top of
what, where a box actually sits, what a key does when a modifier is held.
`pnpm test:harness` opens `dev/harness/host-harness.html` and drives the
whole plugin — the real sandbox bundle, the real panel, the shared fake
scene — through a record and a replay.

The unit tests (`pnpm test`) run in Node with no DOM, so a claim about layout
or stacking cannot be checked there. Three real bugs — a verb menu buried
under the deck, a letterboxed deck stage, a control that would not toggle —
survived code review and were only found when something could open the panel
and call `elementFromPoint`. The harness suite covers the other gap: the unit
tests diff snapshots and apply steps with no host, so nothing else proves
that an edit made on a live-looking proxy survives the recorder, the store,
and the applier.

## Run them

```bash
pnpm test:ui                                     # the panel, on mock gateways
pnpm test:harness                                # the whole plugin, on the fake scene
UI_PROBE_URL=http://localhost:5173/ pnpm test:ui # probe a dev server you already run
CHROME=/path/to/chrome pnpm test:ui              # a Chrome somewhere else
```

`UI_PROBE_URL` and `CHROME` work for both commands. `UI_PROBE_SYNTHETIC_CLICKS=1`
makes the harness suite dispatch every panel click inside the frame instead
of through the page, the fallback it takes on its own when a real click does
not arrive. Output is one
`PASS`/`FAIL name — detail` line per assertion, like
`scripts/quickjs-smoke.mjs`. A command exits 1 if any line fails.
Screenshots land in `artifacts/ui/` and `artifacts/harness/` (both
git-ignored), one per scenario plus `<scenario>-error.png` when a scenario
throws.

Chrome is found at `$CHROME`, then `/Applications/Google Chrome.app`, then
`google-chrome-stable` / `google-chrome` / `chromium` on `PATH`.

## The pieces

- `driver.mjs` — the whole browser layer. It launches Chrome, speaks the
  DevTools protocol over Node's global `WebSocket`, and offers three kinds of
  helper: generic (`navigate`, `setViewport`, `click`, `hover`, `key`,
  `rectOf`, `onTopAt`, `screenshot`), frame-aware (`navigateHarness`,
  `evaluateInHost`, `evaluateInPanel`, `waitForInPanel`, `panelRectOf`,
  `clickInPanel`, `selectNodes`, `readNode`), and panel-aware
  (`loadDemoMacros`, `expandFirstMacro`, `openPencil`, `openVerbMenu`,
  `readRow`, `chipText`, `startRecording`, `stopRecording`, `saveMacro`,
  `playFirstMacro`). Anything that names a selector belongs here, not in a
  scenario.
- `suite.mjs` — what both suites share: the private Vite server, the
  `PASS`/`FAIL` counter, and the loop that runs a directory of scenarios,
  counts the lines, and kills Chrome and the server on the way out
  (including on Ctrl-C).
- `run.mjs` — the panel suite's entry point. It reads `scenarios/`.
- `harness.mjs` — the host-harness suite's entry point. It reads
  `harness-scenarios/`.
- `scenarios/*.mjs`, `harness-scenarios/*.mjs` — one file per question.

## Reaching the panel inside the harness

The harness page seats the panel in `<iframe sandbox="allow-scripts">`, the
way Creator does. Chrome isolates a sandboxed iframe into its own process
(`IsolateSandboxedIframes`), so the panel arrives as a separate DevTools
target: `Runtime.evaluate` on the page cannot see its DOM at all. The driver
therefore calls `Target.setAutoAttach` in flat mode before the first
navigation and routes every panel command to the attached session by
`sessionId`. A frame that stays in the page's process attaches no target, so
the driver falls back to the execution context whose `auxData.frameId`
matches the child frame.

Input is the exception. `Input.dispatchMouseEvent` always goes to the top
page, and Chrome routes the event down to the frame under the point — so
`clickInPanel` adds the frame's box to the element's box and clicks the page.

## Add a scenario

Drop a file in `scenarios/` or, for the harness, in `harness-scenarios/`. It
exports one async function that takes the probe; `probe.check(name, ok,
detail)` prints a line.

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

- **Every scenario starts with `navigate()`**, or with `navigateHarness()`
  in the harness suite. It reloads the document and clears the store, so
  scenarios cannot leak state into each other, and it absorbs the reload
  Vite's dependency optimizer fires on a cold start. A reloaded harness also
  gets a fresh fake scene, so a scenario always knows where a layer starts.
- **Wait for the deck caption after you change the selection.** The panel
  asks the sandbox what Record would watch about once a second while it
  rests. A press that beats that answer records the previous scope.
  `selectNodesAndWait` does both.
- **Say what was measured in the detail string.** A `FAIL` has to be
  actionable from the CI log alone, without re-running anything.
- **Assert the user's experience, not the implementation.** `onTopAt` beats
  reading a `z-index`: the z-index was correct in the bug that started this
  suite, and the menu was still unclickable.

## The harness scenarios

The four scenarios in `harness-scenarios/` cover the loop end to end:

| Scenario | What it proves |
|---|---|
| `round-trip` | A recording on one layer replays onto two others. Position is additive, opacity is absolute, and the layer that was not selected is untouched. |
| `needs-selection` | A solo-layer macro with nothing selected shows the toast, opens no dialog, and writes nothing to the scene. |
| `scene-scope` | With nothing selected, the caption names the scene and an edit to any layer is recorded against that layer. |
| `exact-values` | An Alt-click on Record makes the replay write the recorded value, not the recorded delta. |

## The rules these exist for

A claim about the DOM needs a probe. If a change, a commit message, or a
document says something is on top, aligned, sized, or reachable, there should
be a line in the panel suite that says so too.

A claim about a value the host ends up with needs the harness. The engine's
unit tests can agree with themselves and still be wrong about the round trip,
because they never send a step through the sandbox and back.
