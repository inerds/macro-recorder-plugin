/**
 * A macro recorded on one layer needs a layer selected to play. With nothing
 * selected the panel says so in a toast and goes back to rest — no failure
 * dialog, no row stuck in a playing state, and nothing written to the scene
 * (user decision 2026-09-08; the earlier fallback that played onto the
 * recorded layer was reverted).
 *
 * `scenarios/needs-selection-toast.mjs` proves the panel half of this on the
 * mock gateways. This one proves the sandbox half: the refusal comes from
 * `sandbox/playback.ts`, over real RPC, and the fake scene can be asked
 * afterwards whether a single value moved.
 */
const TOAST = "Select a layer to play this macro on.";

export default async function needsSelection(probe) {
  const { check } = probe;

  await probe.navigateHarness();

  const start = {
    A: await probe.readNode("A"),
    B: await probe.readNode("B"),
    C: await probe.readNode("C"),
    D: await probe.readNode("D"),
  };

  // A macro recorded on ONE layer: that is what makes a replay need a target.
  await probe.selectNodesAndWait(["A"], start.A.name);
  await probe.startRecording();
  await probe.evaluateInHost(
    `window.harness.nodes.A.position.staticValue = { x: ${start.A.position.x + 25}, y: ${start.A.position.y + 25} }`,
  );
  const counter = await probe.waitForRecordedSteps(1).catch(() => null);
  check("the recording catches the edit", counter >= 1, `counter reads ${counter}`);
  await probe.stopRecording();
  const rows = await probe.saveMacro().catch(() => 0);
  check("the solo-layer macro is saved", rows === 1, `${rows} rows`);

  const recorded = await probe.readNode("A");

  // ---- play with nothing selected ---------------------------------------

  await probe.selectNodes([]);
  await probe.clickInPanel('[data-testid="play-button"]');

  // The toast is announced through the sr-only live region as well as drawn.
  const seen = await probe
    .waitForInPanel(
      `(() => {
        const live = document.querySelector('[data-testid="notice-live"]')?.textContent ?? '';
        return live.includes(${JSON.stringify(TOAST)}) || document.body.innerText.includes(${JSON.stringify(TOAST)});
      })()`,
      { what: "the needs-selection toast", timeout: 8000 },
    )
    .then(
      () => true,
      () => false,
    );
  check("playing with nothing selected shows the toast", seen, `looked for "${TOAST}"`);

  // A run expands the row it started, and the refusal leaves it open — so
  // the row's Play key may be the open card's footer key by now. Either one
  // has to be live: the macro is playable again the moment something is
  // selected.
  const state = await probe.evaluateInPanel(
    `(() => {
      const key = document.querySelector('[data-testid="play-button"], [data-testid="footer-play-button"]');
      return {
        dialog: !!document.querySelector('[role="alertdialog"], [role="dialog"]'),
        playing: !!document.querySelector('[data-testid="playback-progress"], [data-testid="playback-error"], [data-testid="playback-stop-button"]'),
        playEnabled: !!key && key.getAttribute('aria-disabled') !== 'true',
      };
    })()`,
  );
  check(
    "no dialog opens and the row is not left playing",
    !state.dialog && !state.playing && state.playEnabled,
    JSON.stringify(state),
  );

  const after = {
    A: await probe.readNode("A"),
    B: await probe.readNode("B"),
    C: await probe.readNode("C"),
    D: await probe.readNode("D"),
  };
  const unchanged = ["B", "C", "D"].filter(
    (name) => JSON.stringify(after[name]) !== JSON.stringify(start[name]),
  );
  check(
    "the refused run writes nothing to the scene",
    unchanged.length === 0 && JSON.stringify(after.A) === JSON.stringify(recorded),
    unchanged.length === 0 ? "B, C and D are as they started" : `changed: ${unchanged.join(", ")}`,
  );
  await probe.screenshot("needs-selection");
}
