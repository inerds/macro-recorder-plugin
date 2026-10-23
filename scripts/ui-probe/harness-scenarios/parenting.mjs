/**
 * Record "parent A to B", save, and play onto C and D: both take B as their
 * transform parent, A keeps it, and B itself is never a target.
 *
 * `Layer.transformParent` is typed in creator-api-types 1.1.0 and not yet
 * live-verified, so the fake scene is the only host that answers today. What
 * this proves is the whole route through the real bundle and the real panel:
 * the serializer reads the parent as an identity, the differ turns it into a
 * `set-parent` step bound to A, the review sheet shows it, the store keeps
 * it, and the applier resolves "Layer B" by name in the scene and writes the
 * parent onto each selected target with a read-back.
 */
export default async function parenting(probe) {
  const { check } = probe;

  await probe.navigateHarness();

  const start = {
    A: await probe.readNode("A"),
    B: await probe.readNode("B"),
    C: await probe.readNode("C"),
    D: await probe.readNode("D"),
  };
  check(
    "no layer starts with a parent",
    ["A", "B", "C", "D"].every((name) => start[name].parent === null),
    JSON.stringify(Object.fromEntries(Object.entries(start).map(([k, v]) => [k, v.parent]))),
  );

  // ---- record: A takes B as its parent -----------------------------------

  await probe.selectNodesAndWait(["A"], start.A.name);
  await probe.startRecording();
  // The assignment's own value is the node, which the DevTools protocol
  // cannot hand back by value (the proxies reference each other), so the
  // expression returns the parent's name instead.
  await probe.evaluateInHost(
    `(() => { const n = window.harness.nodes; n.A.transformParent = n.B; return n.A.transformParent.name; })()`,
  );
  const counter = await probe.waitForRecordedSteps(1).catch(() => null);
  check("the recording catches the parent change", counter >= 1, `counter reads ${counter}`);
  await probe.stopRecording();

  const reviewed = await probe.evaluateInPanel(
    `[...document.querySelectorAll('[data-testid="step-row"]')]
      .map((r) => r.textContent.replace(/\\s+/g, " ").trim())`,
  );
  check(
    "the review sheet shows one parent step naming Layer B",
    reviewed.length === 1 && /parent/i.test(reviewed[0]) && reviewed[0].includes(start.B.name),
    JSON.stringify(reviewed),
  );
  await probe.screenshot("parenting-review");

  const rows = await probe.saveMacro().catch(() => 0);
  check("the macro is saved", rows === 1, `${rows} rows`);

  // ---- play onto C and D --------------------------------------------------

  await probe.selectNodes(["C", "D"]);
  const finished = await probe
    .playFirstMacro()
    .then(() => true)
    .catch(() => false);
  check("the run finishes with no failed step", finished);
  await probe.screenshot("parenting-played");

  const after = {
    A: await probe.readNode("A"),
    B: await probe.readNode("B"),
    C: await probe.readNode("C"),
    D: await probe.readNode("D"),
  };
  for (const name of ["C", "D"]) {
    check(
      `${name} is parented to ${start.B.name}`,
      after[name].parent === start.B.name,
      `parent reads ${JSON.stringify(after[name].parent)}`,
    );
  }
  check(
    "the recorded layer keeps the parent the recording gave it",
    after.A.parent === start.B.name,
    `parent reads ${JSON.stringify(after.A.parent)}`,
  );
  check(
    "the parent layer itself is untouched",
    after.B.parent === null &&
      JSON.stringify(after.B.position) === JSON.stringify(start.B.position),
    `parent ${JSON.stringify(after.B.parent)}, position ${JSON.stringify(after.B.position)}`,
  );

  // The fake derives `NullLayer.layers` from the links; a shape layer as a
  // parent has no such list, so the links are read from the children side.
  const linked = await probe.evaluateInHost(
    `Object.entries(window.harness.nodes)
      .filter(([, node]) => node.transformParent === window.harness.nodes.B)
      .map(([name]) => name)`,
  );
  check(
    "B now drives A, C and D",
    JSON.stringify(linked) === JSON.stringify(["A", "C", "D"]),
    JSON.stringify(linked),
  );
}
