/**
 * The deck carries ONE transport key, and it toggles.
 *
 * Three claims that only a browser can answer. The key reads Record at rest
 * and Stop while a recording runs, from the same element — a second key would
 * pass a unit test and still be there on the faceplate. Its box is centred on
 * the row, which is a grid track measurement, not a class name. And the scope
 * caption under it is the layer name alone, centred on the panel: the
 * `RECORDS ·` legend it used to lead with is gone, and only the rendered box
 * proves the name did not stay left-aligned where the legend put it.
 */
const KEY = '[data-testid="record-button"]';

/** The key's visible word, its accessible name, and its box. */
const keyState = (probe) =>
  probe.evaluate(
    `(() => {
      const el = document.querySelector(${JSON.stringify(KEY)});
      if (!el) return null;
      const box = el.getBoundingClientRect();
      return {
        text: (el.textContent ?? "").trim(),
        label: el.getAttribute("aria-label"),
        disabled: el.disabled === true,
        centre: box.x + box.width / 2,
        width: box.width,
      };
    })()`,
  );

/**
 * The caption: what it SHOWS (the sr-only sentence is not on the faceplate),
 * whether the retired legend span is still rendered, and where the visible
 * text box actually sits.
 */
const captionState = (probe) =>
  probe.evaluate(
    `(() => {
      const caption = document.querySelector('.deck-scope');
      const panel = document.querySelector('.panel-root');
      if (!caption || !panel) return null;
      const value = caption.querySelector('.deck-scope-value');
      const shown = [...caption.children]
        .filter((el) => !el.classList.contains('sr-only'))
        .map((el) => (el.textContent ?? '').trim())
        .join(' ')
        .trim();
      const spoken = caption.querySelector('.sr-only')?.textContent?.trim() ?? '';
      const box = value?.getBoundingClientRect() ?? null;
      const panelBox = panel.getBoundingClientRect();
      return {
        shown,
        spoken,
        legend: !!caption.querySelector('.deck-scope-legend'),
        centre: box ? box.x + box.width / 2 : null,
        panelCentre: panelBox.x + panelBox.width / 2,
      };
    })()`,
  );

const rowCentre = (probe) =>
  probe.evaluate(
    `(() => {
      const row = document.querySelector('.deck-row');
      if (!row) return null;
      const box = row.getBoundingClientRect();
      return box.x + box.width / 2;
    })()`,
  );

export default async function recordToggle(probe) {
  const { check } = probe;

  await probe.setViewport(320, 560);
  await probe.navigate();

  const idle = await keyState(probe);
  check("the deck has one transport key", idle !== null);
  if (!idle) return;
  check("the idle key reads Record", idle.text === "Record", JSON.stringify(idle.text));
  check("its accessible name is Record", idle.label === "Record", String(idle.label));

  const secondKey = await probe.evaluate(
    `document.querySelectorAll('.deck-row .key-plate').length`,
  );
  check("the deck's Stop key is gone", secondKey === 1, `${secondKey} keys on the row`);

  const centre = await rowCentre(probe);
  check(
    "the key is centred on the transport row",
    centre !== null && Math.abs(idle.centre - centre) <= 2,
    `key ${idle.centre.toFixed(1)}, row ${centre?.toFixed(1)} (${Math.abs(idle.centre - (centre ?? 0)).toFixed(2)}px off)`,
  );

  // The key is as wide as the riveted nameplate above it (user decision,
  // 2026-09-08): the two read as one column when their edges line up.
  const plate = await probe.evaluate(
    `(() => {
      const plate = document.querySelector('[data-part="nameplate"]');
      const key = document.querySelector('[data-testid="record-button"]');
      if (!plate || !key) return null;
      const p = plate.getBoundingClientRect(), k = key.getBoundingClientRect();
      return { plate: p.width, key: k.width, plateCentre: p.x + p.width / 2, keyCentre: k.x + k.width / 2 };
    })()`,
  );
  check("the nameplate and the key are both on the deck", plate !== null);
  if (plate) {
    // The plate's shadow rect is 2 units wider than the plate; the key
    // matches the plate itself, so allow the shadow's ±2px on either side.
    check(
      "the key is as wide as the nameplate above it",
      Math.abs(plate.key - plate.plate) <= 3,
      `key ${plate.key.toFixed(1)}px, plate ${plate.plate.toFixed(1)}px`,
    );
    check(
      "the key sits directly under the nameplate",
      Math.abs(plate.keyCentre - plate.plateCentre) <= 1,
      `key centre ${plate.keyCentre.toFixed(1)}, plate centre ${plate.plateCentre.toFixed(1)}`,
    );
  }

  // The caption fills a second after the panel rests: it is the 1 Hz idle
  // selection poll's answer, not part of the first paint.
  await probe.waitFor(`(document.querySelector('.deck-scope-value')?.textContent ?? '') !== ''`, {
    what: "the scope caption",
  });
  const caption = await captionState(probe);
  check("the scope caption is on the deck", caption !== null);
  if (!caption) return;
  check(
    "the caption shows the name alone, with no RECORDS legend",
    !caption.legend && !/records/i.test(caption.shown) && !caption.shown.includes("·"),
    JSON.stringify(caption.shown),
  );
  check(
    "the sentence a screen reader hears is still there",
    /record will watch/i.test(caption.spoken),
    JSON.stringify(caption.spoken),
  );
  check(
    "the caption is centred on the panel",
    caption.centre !== null && Math.abs(caption.centre - caption.panelCentre) <= 2,
    `caption ${caption.centre?.toFixed(1)}, panel ${caption.panelCentre.toFixed(1)}`,
  );

  await probe.screenshot("record-toggle-idle");

  await probe.clickOn(KEY);
  await probe.waitFor(`!!document.querySelector('[data-testid="recording-view"]')`, {
    what: "the recording view",
  });

  const running = await keyState(probe);
  check("the same key reads Stop while recording", running?.text === "Stop", String(running?.text));
  check("its accessible name follows", running?.label === "Stop", String(running?.label));
  check("the key is live, not dead, while recording", running?.disabled === false);
  check(
    "the key does not resize when its word changes",
    running !== null && Math.abs(running.width - idle.width) < 0.5,
    `${idle.width.toFixed(1)}px → ${running?.width.toFixed(1)}px`,
  );

  const recordingCaption = await captionState(probe);
  check(
    "the caption still shows the same name",
    recordingCaption?.shown === caption.shown,
    `${JSON.stringify(caption.shown)} → ${JSON.stringify(recordingCaption?.shown)}`,
  );

  await probe.screenshot("record-toggle-recording");

  // One step, so the stop has something to hand to the review sheet.
  await probe.waitFor(
    `document.querySelectorAll('[data-testid="recording-view"] li').length >= 1`,
    {
      what: "one recorded step",
      timeout: 12000,
    },
  );
  await probe.clickOn(KEY);
  const ended = await probe
    .waitFor(`!document.querySelector('[data-testid="recording-view"]')`, {
      what: "the recording to end",
    })
    .then(() => true)
    .catch(() => false);
  check("a second press ends the recording", ended);

  const after = await probe.evaluate(
    `(() => {
      if (document.querySelector('[data-testid="review-panel"]')) return 'review';
      if (document.querySelector('.rack')) return 'list';
      return 'neither';
    })()`,
  );
  check("it lands on the review sheet or back on the list", after !== "neither", after);
  // Nothing selected: the caption names the SCENE, not "whole scene" (user
  // decision, 2026-09-08). Mock mode: the "silent" recorder scenario peeks a
  // whole-scene scope with the mock scene's name.
  await probe.navigate();
  await probe.openDevSettings();
  await probe.evaluate(
    `(() => {
      const select = [...document.querySelectorAll('select')].find((el) =>
        [...el.options].some((o) => o.value === 'silent'));
      if (!select) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(select, 'silent');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
  );
  await probe.closeDevSettings();
  const named = await probe
    .waitFor(
      `(() => { const v = document.querySelector('.deck-scope-value'); return !!v && /scene 1/i.test(v.textContent); })()`,
      { what: "the scene-named caption", timeout: 4000 },
    )
    .then(
      () => true,
      () => false,
    );
  const sceneCaption = await probe.evaluate(
    `document.querySelector('.deck-scope-value')?.textContent?.trim() ?? null`,
  );
  check(
    "with nothing selected the caption names the scene, not 'whole scene'",
    named && !/whole scene/i.test(sceneCaption ?? ""),
    JSON.stringify(sceneCaption),
  );
}
