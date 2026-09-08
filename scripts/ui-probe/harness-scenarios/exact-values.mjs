/**
 * An Alt-click on Record records EXACT values: replay writes the number the
 * recording ended on, instead of the delta it moved by.
 *
 * `scenarios/record-exact-modifier.mjs` proves the pointer carries the
 * modifier and the key turns blue. This proves the number: the promise the
 * key makes has to survive the recorder's diff, the saved step, and the
 * applier's relative-versus-absolute decision, and only a real host answer
 * can tell the two apart — a delta and an absolute agree whenever the target
 * happens to start where the source did, which is why B, not A, is the
 * target here.
 */
const EXACT = { x: 333, y: 222 };

const near = (a, b, tolerance = 0.01) => Math.abs(a - b) <= tolerance;
const samePoint = (point, x, y) => !!point && near(point.x, x) && near(point.y, y);

export default async function exactValues(probe) {
  const { check } = probe;

  await probe.navigateHarness();

  const a = await probe.readNode("A");
  const b = await probe.readNode("B");

  await probe.selectNodesAndWait(["A"], a.name);
  // Alt held over the key is the whole promise: `startRecording({exact})`
  // dispatches the modifier with the press.
  await probe.startRecording({ exact: true });

  const chip = await probe.evaluateInPanel(
    `document.querySelector('[data-testid="scope-chip"]')?.textContent?.trim() ?? null`,
  );
  check(
    "the recording chip says the values are exact",
    /exact values/i.test(chip ?? ""),
    JSON.stringify(chip),
  );

  await probe.evaluateInHost(
    `window.harness.nodes.A.position.staticValue = { x: ${EXACT.x}, y: ${EXACT.y} }`,
  );
  const counter = await probe.waitForRecordedSteps(1).catch(() => null);
  check("the exact recording catches the edit", counter >= 1, `counter reads ${counter}`);

  await probe.stopRecording();
  const rows = await probe.saveMacro().catch(() => 0);
  check("the exact macro is saved", rows === 1, `${rows} rows`);

  await probe.selectNodes(["B"]);
  const finished = await probe
    .playFirstMacro()
    .then(() => true)
    .catch(() => false);
  check("the run finishes with no failed step", finished);
  await probe.screenshot("exact-values");

  const after = await probe.readNode("B");
  const asDelta = {
    x: b.position.x + (EXACT.x - a.position.x),
    y: b.position.y + (EXACT.y - a.position.y),
  };
  check(
    "B takes the recorded absolute position, not its own start plus the delta",
    samePoint(after.position, EXACT.x, EXACT.y),
    `B ${JSON.stringify(b.position)} → ${JSON.stringify(after.position)}; exact is ${JSON.stringify(EXACT)}, a delta would give ${JSON.stringify(asDelta)}`,
  );
}
