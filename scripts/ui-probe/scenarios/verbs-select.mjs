/**
 * Every item in the verb menu picks its own verb.
 *
 * The row derives its verb from the stored formula string rather than from
 * state beside it, so a broken conversion shows up as a menu item that
 * appears to do nothing — the menu closes and the key still says what it
 * said. One item is legitimately unreachable on some steps (you cannot
 * multiply or divide away from a recorded 0); those are `aria-disabled` and
 * carry the reason in a title, which is the thing to assert instead.
 */
const VERBS = ["Set to", "Add", "Subtract", "Multiply", "Divide", "Formula…"];

export default async function verbsSelect(probe) {
  const { check } = probe;

  await probe.setViewport(320, 560);
  await probe.navigate();
  await probe.loadDemoMacros();
  await probe.expandFirstMacro();
  await probe.openPencil(/position|rotation|scale/);
  await probe.openVerbMenu();

  const items = await probe.evaluate(
    `[...document.querySelectorAll('[role="menuitem"]')].map((el) => (el.textContent ?? "").trim())`,
  );
  check(
    "the verb menu lists all six verbs",
    VERBS.every((verb) => items.includes(verb)) && items.length === VERBS.length,
    items.join(" | "),
  );
  await probe.closeMenu();

  for (const verb of VERBS) {
    const found = `[...document.querySelectorAll('[role="menuitem"]')].find((el) => (el.textContent ?? "").trim() === ${JSON.stringify(verb)})`;
    await probe.openVerbMenu();
    const state = await probe.evaluate(
      `(() => { const el = ${found}; if (!el) return null;
        return { disabled: el.getAttribute('aria-disabled') === 'true', title: el.getAttribute('title') ?? '' }; })()`,
    );
    if (state === null) {
      check(`the menu offers "${verb}"`, false, "item not rendered");
      await probe.closeMenu();
      continue;
    }
    if (state.disabled) {
      // Kept in the tab order on purpose: a natively disabled item takes its
      // reason with it, and the reason is the whole point.
      check(`"${verb}" is off, and says why`, state.title.length > 0, JSON.stringify(state.title));
      await probe.closeMenu();
      continue;
    }
    await probe.clickOn(found);
    await probe.waitFor(`!document.querySelector('[role="menu"]')`, {
      what: `the menu to close after ${verb}`,
    });
    const row = await probe.readRow();
    // "Formula…" is the item; "Formula" is what the key then reads.
    const wanted = verb.replace(/…$/, "");
    check(
      `"${verb}" sets the key to "${wanted}"`,
      row?.verb === wanted,
      `key reads ${JSON.stringify(row?.verb ?? null)}, box ${JSON.stringify(row?.field ?? null)}`,
    );
  }

  await probe.screenshot("verbs-select");
}
