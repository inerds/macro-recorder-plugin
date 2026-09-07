/**
 * A vector step's two component rows are one control, read down the page:
 * the X box and the Y box must start on the same vertical line.
 *
 * They only do because the verb key has a fixed width and the component
 * letter has a fixed column. Both are easy to lose — a wider verb label, a
 * dropped `w-[10px]` — and the result is a visible stagger no unit test can
 * see.
 */
export default async function rowsAlign(probe) {
  const { check } = probe;

  await probe.setViewport(320, 560);
  await probe.navigate();
  await probe.loadDemoMacros();
  await probe.expandFirstMacro();
  await probe.openPencil(/position/);

  const boxes = await probe.evaluate(
    `(() => {
      const rows = [...document.querySelectorAll('.key-verb')].map((trigger) => {
        const row = trigger.closest('[role="group"]') ?? trigger.parentElement;
        const input = row?.querySelector('input');
        if (!input) return null;
        const r = input.getBoundingClientRect();
        return { name: (row.getAttribute('aria-label') ?? '').trim(), left: r.left, top: r.top, width: r.width };
      });
      return rows.filter(Boolean);
    })()`,
  );

  check(
    "the position editor shows two component rows",
    boxes.length === 2,
    boxes.map((b) => b.name || "?").join(", ") || "none",
  );
  if (boxes.length < 2) {
    await probe.screenshot("rows-align-unexpected");
    return;
  }

  const [x, y] = boxes;
  check(
    "the X and Y boxes share a left edge",
    Math.abs(x.left - y.left) <= 0.5,
    `left ${x.left.toFixed(2)} vs ${y.left.toFixed(2)}`,
  );
  check(
    "the X and Y boxes are the same width",
    Math.abs(x.width - y.width) <= 0.5,
    `width ${x.width.toFixed(2)} vs ${y.width.toFixed(2)}`,
  );
  check(
    "the rows stack, they do not sit side by side",
    Math.abs(x.top - y.top) > 2,
    `top ${x.top.toFixed(1)} vs ${y.top.toFixed(1)}`,
  );

  await probe.screenshot("rows-align");
}
