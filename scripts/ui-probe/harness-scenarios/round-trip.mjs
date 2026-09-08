/**
 * Record on one fake layer, save, and play onto two others: the whole loop,
 * through the real sandbox bundle and the real panel.
 *
 * Every other check in this repository sees one half of it. The unit tests
 * diff snapshots and apply steps with no host; `pnpm test:ui` drives the
 * panel on mock gateways; `pnpm test:quickjs` proves the bundle answers RPC.
 * Only this one lets an edit made on a live-looking proxy travel through the
 * recorder's diff, the review sheet, the store and the applier, and then asks
 * the proxies what happened.
 *
 * The two properties are picked for their playback classes
 * (`engine/snapshot.ts`, `propClassOf`): a layer's own `position` is
 * ADDITIVE, so each target moves by the recorded delta from where it stands,
 * and `opacity` is ABSOLUTE, so each target takes the recorded value exactly.
 */

/** A's edit: +60,+60 from its start, and a value opacity has to land on. */
const DELTA = { x: 60, y: 60 };
const OPACITY = 40;

const near = (a, b, tolerance = 0.01) => Math.abs(a - b) <= tolerance;
const samePoint = (point, x, y) => !!point && near(point.x, x) && near(point.y, y);

export default async function roundTrip(probe) {
  const { check } = probe;

  const how = await probe.navigateHarness();
  check(
    "the driver reaches the panel frame",
    true,
    how === "target"
      ? "the sandboxed frame has a CDP target of its own"
      : "same-process frame, reached through its execution context",
  );

  const start = {
    A: await probe.readNode("A"),
    B: await probe.readNode("B"),
    C: await probe.readNode("C"),
    D: await probe.readNode("D"),
  };

  const caption = await probe.selectNodesAndWait(["A"], start.A.name);
  check("the caption names the selected layer", caption === start.A.name, JSON.stringify(caption));

  // ---- record -----------------------------------------------------------

  await probe.startRecording();
  await probe.evaluateInHost(
    `(() => { const a = window.harness.nodes.A;
      a.position.staticValue = { x: ${start.A.position.x + DELTA.x}, y: ${start.A.position.y + DELTA.y} };
      a.opacity.staticValue = ${OPACITY}; })()`,
  );

  // The sandbox has no timers of its own: the panel polls `record.tick`
  // every 500 ms (`ui/gateways/rpc/recorderGateway.ts`) and each tick diffs
  // the scene, so the steps appear one poll after the edit.
  const counter = await probe.waitForRecordedSteps(2).catch(() => null);
  check("the deck counter reaches the two edits", counter === 2, `counter reads ${counter}`);
  await probe.screenshot("round-trip-recording");

  await probe.stopRecording();

  // ---- review and save ---------------------------------------------------

  const reviewed = await probe.evaluateInPanel(
    `(() => {
      const rows = [...document.querySelectorAll('[data-testid="step-row"]')];
      return { count: rows.length, text: rows.map((r) => r.textContent.replace(/\\s+/g, " ").trim()) };
    })()`,
  );
  check(
    "the review sheet lists a step for each edit",
    reviewed.count === 2,
    `${reviewed.count} steps: ${JSON.stringify(reviewed.text)}`,
  );
  const listed = reviewed.text.join(" ");
  check(
    "the steps name the two properties that changed",
    /position/i.test(listed) && /opacity/i.test(listed),
    JSON.stringify(reviewed.text),
  );
  await probe.screenshot("round-trip-review");

  const rows = await probe.saveMacro().catch(() => 0);
  check("saving puts one macro on the rack", rows === 1, `${rows} rows`);

  const rowCount = await probe.evaluateInPanel(
    `document.querySelector('[data-testid="macro-row"] .rack-count')?.textContent ?? null`,
  );
  check("the row counts the macro's two steps", rowCount === "02", JSON.stringify(rowCount));

  // ---- play onto B and C -------------------------------------------------

  await probe.selectNodes(["B", "C"]);
  const finished = await probe
    .playFirstMacro()
    .then(() => true)
    .catch(() => false);
  check("the run finishes with no failed step", finished);
  await probe.screenshot("round-trip-played");

  const after = {
    A: await probe.readNode("A"),
    B: await probe.readNode("B"),
    C: await probe.readNode("C"),
    D: await probe.readNode("D"),
  };

  for (const name of ["B", "C"]) {
    const want = {
      x: start[name].position.x + DELTA.x,
      y: start[name].position.y + DELTA.y,
    };
    check(
      `${name} moves by the recorded delta, from its own start`,
      samePoint(after[name].position, want.x, want.y),
      `${JSON.stringify(start[name].position)} → ${JSON.stringify(after[name].position)}, expected ${JSON.stringify(want)}`,
    );
    check(
      `${name} takes the recorded opacity exactly`,
      near(after[name].opacity, OPACITY),
      `${start[name].opacity} → ${after[name].opacity}, expected ${OPACITY}`,
    );
  }

  check(
    "the recorded layer keeps the value the recording gave it",
    samePoint(after.A.position, start.A.position.x + DELTA.x, start.A.position.y + DELTA.y) &&
      near(after.A.opacity, OPACITY),
    `${JSON.stringify(after.A.position)}, opacity ${after.A.opacity}`,
  );
  check(
    "the unselected layer is untouched",
    samePoint(after.D.position, start.D.position.x, start.D.position.y) &&
      near(after.D.opacity, start.D.opacity),
    `${JSON.stringify(start.D.position)} → ${JSON.stringify(after.D.position)}, opacity ${start.D.opacity} → ${after.D.opacity}`,
  );
}
