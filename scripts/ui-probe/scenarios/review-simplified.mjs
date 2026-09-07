/**
 * The review sheet opens on the merged list, and the Keep-every-step box is
 * the way back to the raw recording.
 *
 * Two things only a browser can answer. The readout counts `N → M` off the
 * raw steps, so it has to survive the merge that is already on screen. And
 * the box is a `span[role=checkbox]` beside a hidden input: wrapping it in a
 * label routed one click through both controls and the state came back
 * unchanged, which looks exactly like a dead control.
 */
const BOX = '[data-testid="keep-every-step"]';

const stateOf = (probe) =>
  probe.evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(BOX)});
      if (!el) return null;
      return el.getAttribute('aria-checked') ?? el.getAttribute('data-state') ?? String(el.checked); })()`,
  );

export default async function reviewSimplified(probe) {
  const { check } = probe;

  await probe.setViewport(320, 560);
  await probe.navigate();

  // Mock-mode scenario knob: "burst" records a handful of steps, two of them
  // consecutive position edits, so there is always something to merge.
  const scenario = await probe.evaluate(
    `(() => {
      const select = [...document.querySelectorAll('select')].find((el) =>
        [...el.options].some((o) => o.value === 'burst'));
      if (!select) return 'absent';
      if (select.value !== 'burst') {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(select, 'burst');
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return select.value;
    })()`,
  );
  if (scenario === "absent") {
    // The drawer holds it; open it and try once more.
    await probe.openDevSettings();
    await probe.evaluate(
      `(() => {
        const select = [...document.querySelectorAll('select')].find((el) =>
          [...el.options].some((o) => o.value === 'burst'));
        if (!select || select.value === 'burst') return;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(select, 'burst');
        select.dispatchEvent(new Event('change', { bubbles: true }));
      })()`,
    );
  }

  await probe.clickOn('[data-testid="record-button"]');
  await probe.waitFor(`!!document.querySelector('[data-testid="recording-view"]')`, {
    what: "the recording view",
  });
  // The mock feed emits one step every 800ms; four is enough for the merge.
  await probe.waitFor(
    `document.querySelectorAll('[data-testid="recording-view"] li').length >= 4`,
    { what: "four recorded steps", timeout: 12000 },
  );
  await probe.clickOn('[data-testid="stop-button"]');

  const present = await probe
    .waitFor(`!!document.querySelector(${JSON.stringify(BOX)})`, {
      what: "the review sheet's Keep-every-step box",
    })
    .then(() => true)
    .catch(() => false);
  check("the review sheet offers Keep every step", present);
  if (!present) {
    await probe.screenshot("review-simplified-missing");
    return;
  }

  const readout = await probe.evaluate(
    `document.querySelector(${JSON.stringify(BOX)})?.closest('.check-quiet')?.textContent ?? ""`,
  );
  check(
    "the readout counts the merge as N → M",
    /\d+\s*→\s*\d+/.test(readout),
    JSON.stringify(readout.trim().slice(0, 60)),
  );

  const before = await stateOf(probe);
  await probe.clickOn(BOX);
  const after = await stateOf(probe);
  check(
    "one click flips the box exactly once",
    before !== null && after !== null && before !== after,
    `${before} → ${after}`,
  );

  await probe.clickOn(BOX);
  const back = await stateOf(probe);
  check("a second click flips it back", back === before, `${after} → ${back}`);

  await probe.screenshot("review-simplified");
}
