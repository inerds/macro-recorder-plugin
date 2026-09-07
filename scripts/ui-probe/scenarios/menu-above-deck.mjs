/**
 * A verb menu opened from a rack row near the top of the panel flips upward
 * and lands over the deck. It has to PAINT over the deck too.
 *
 * Base UI portals the menu as portal > positioner > popup. The positioner
 * carries a transform, which makes it a stacking context, so the popup's own
 * `z-50` ranks it only against its siblings — and the positioner itself sat
 * at level 0, under the deck chassis' level 1. The menu looked open and was
 * unclickable. Reading the CSS never showed it; `elementFromPoint` did.
 */
export default async function menuAboveDeck(probe) {
  const { check } = probe;

  // A short panel forces the flip: there is no room below the first rows.
  await probe.setViewport(320, 400);
  await probe.navigate();
  await probe.loadDemoMacros();
  await probe.expandFirstMacro();
  await probe.openPencil(/position|rotation|scale/);
  await probe.openVerbMenu();

  const geometry = await probe.evaluate(
    `(() => {
      const menu = document.querySelector('[role="menu"]');
      const deck = document.querySelector('.deck-chassis');
      if (!menu || !deck) return null;
      const m = menu.getBoundingClientRect();
      const d = deck.getBoundingClientRect();
      return {
        menu: { top: m.top, bottom: m.bottom, left: m.left, right: m.right },
        deck: { top: d.top, bottom: d.bottom },
      };
    })()`,
  );
  check("the verb menu and the deck are both on the page", geometry !== null);
  if (!geometry) return;

  const overlap = Math.min(geometry.menu.bottom, geometry.deck.bottom) - geometry.menu.top;
  check(
    "the menu flips up and overlaps the deck",
    overlap > 2,
    `menu top ${geometry.menu.top.toFixed(0)}, deck bottom ${geometry.deck.bottom.toFixed(0)} (overlap ${overlap.toFixed(0)}px)`,
  );

  // Probe a point that is inside BOTH boxes: whatever answers there is
  // whatever the user's click would hit.
  const x = geometry.menu.left + Math.min(20, (geometry.menu.right - geometry.menu.left) / 2);
  const y = geometry.menu.top + Math.min(4, Math.max(overlap - 1, 1));
  const top = await probe.onTopAt(x, y, '[role="menu"]');
  check(
    "the menu paints above the deck at the overlap",
    top?.within === true,
    `elementFromPoint(${x.toFixed(0)}, ${y.toFixed(0)}) → ${top?.name ?? "nothing"}`,
  );

  await probe.screenshot("menu-above-deck");
}
