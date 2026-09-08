/**
 * Holding Alt (Option) over the Record key promises an exact-values
 * recording, and the key says so by turning blue before it is pressed.
 *
 * The promise and the recording read the same `altKey` (`recordModifier.ts`),
 * but nothing in a unit test proves the pointer path is wired: the hover
 * colour comes from a React state that only a real `mousemove` carrying the
 * modifier can set. CDP's `modifiers: 1` is that modifier.
 */
const KEY = '[data-testid="record-button"]';

const classOf = (probe) =>
  probe.evaluate(`document.querySelector(${JSON.stringify(KEY)})?.className ?? null`);

export default async function recordExactModifier(probe) {
  const { check } = probe;

  await probe.setViewport(320, 560);
  await probe.navigate();

  const rect = await probe.rectOf(KEY);
  check("the deck has a Record key", rect !== null);
  if (!rect) return;
  const x = rect.x + rect.w / 2;
  const y = rect.y + rect.h / 2;

  await probe.hover(x, y);
  const resting = await classOf(probe);
  check("the Record key rests red", /key-plate-red/.test(resting ?? ""), resting ?? "no class");

  // The pointer has to MOVE for a mousemove to land, so nudge a pixel.
  await probe.hover(x + 1, y, { alt: true });
  const held = await classOf(probe);
  check(
    "Alt held over the Record key turns it blue",
    /key-plate-blue/.test(held ?? ""),
    held ?? "no class",
  );

  await probe.hover(x + 2, y);
  const released = await classOf(probe);
  check(
    "releasing Alt puts the Record key back to red",
    /key-plate-red/.test(released ?? "") && !/key-plate-blue/.test(released ?? ""),
    released ?? "no class",
  );

  await probe.screenshot("record-exact-modifier-hover");

  await probe.click(x, y, { alt: true });
  const chip = await probe.waitFor(
    `document.querySelector('[data-testid="scope-chip"]')?.textContent ?? ""`,
    { what: "the recording chip" },
  );
  check(
    "an Alt-click records exact values, and the chip says so",
    /exact values/.test(chip),
    JSON.stringify(chip.slice(0, 80)),
  );

  await probe.screenshot("record-exact-modifier");
}
