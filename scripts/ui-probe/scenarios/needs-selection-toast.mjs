/**
 * A macro recorded on one layer needs a layer selected to play. With nothing
 * selected the panel says so in a toast and returns to rest — no failure
 * dialog, no row stuck in a playing state (user decision 2026-09-08; the
 * earlier fallback that played onto the recorded layer was reverted).
 *
 * Mock mode has a "no-selection" playback scenario in the dev drawer, so the
 * whole path — gateway event, reducer, toast — runs without Creator.
 */
const TOAST = "Select a layer to play this macro on.";

async function chooseScenario(probe, value) {
  const set = () =>
    probe.evaluate(
      `(() => {
        const select = [...document.querySelectorAll('select')].find((el) =>
          [...el.options].some((o) => o.value === ${JSON.stringify(value)}));
        if (!select) return 'absent';
        if (select.value !== ${JSON.stringify(value)}) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
          setter.call(select, ${JSON.stringify(value)});
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return select.value;
      })()`,
    );
  let result = await set();
  if (result === "absent") {
    await probe.openDevSettings();
    result = await set();
  }
  return result;
}

export default async function needsSelectionToast(probe) {
  const { check } = probe;

  await probe.setViewport(320, 560);
  await probe.navigate();
  await probe.loadDemoMacros();

  const scenario = await chooseScenario(probe, "no-selection");
  check(
    "the dev drawer offers the no-selection playback scenario",
    scenario === "no-selection",
    `select reads ${scenario}`,
  );
  await probe.closeDevSettings();
  await probe.scrollRackToTop();

  await probe.clickOn('[data-testid="play-button"]');

  // The toast is announced through the sr-only live region as well as drawn.
  const seen = await probe
    .waitFor(
      `(() => {
      const live = document.querySelector('[data-testid="notice-live"]')?.textContent ?? '';
      const drawn = document.body.innerText;
      return live.includes(${JSON.stringify(TOAST)}) || drawn.includes(${JSON.stringify(TOAST)});
    })()`,
      { what: "the needs-selection toast", timeout: 4000 },
    )
    .then(
      () => true,
      () => false,
    );
  check("playing with nothing selected shows the toast", seen, `looked for "${TOAST}"`);

  const state = await probe.evaluate(
    `(() => ({
      dialog: !!document.querySelector('[role="alertdialog"], [role="dialog"]'),
      dismiss: [...document.querySelectorAll('button')].some((b) => /^dismiss$/i.test(b.textContent.trim())),
      // A run in progress or a pre-run failure renders one of these.
      playing: !!document.querySelector('[data-testid="playback-progress"], [data-testid="playback-error"], [data-testid="playback-stop-button"]'),
      playEnabled: (() => { const b = document.querySelector('[data-testid="play-button"]'); return !!b && !b.disabled && b.getAttribute("aria-disabled") !== "true"; })(),
    }))()`,
  );
  check(
    "no failure dialog opens and the row is not left playing",
    !state.dialog && !state.dismiss && !state.playing && state.playEnabled,
    JSON.stringify(state),
  );
  await probe.screenshot("needs-selection-toast");
}
