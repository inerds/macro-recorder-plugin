/**
 * With nothing selected, Record watches the WHOLE scene: the caption names
 * the scene, and an edit to any layer is recorded against that layer.
 *
 * The scope is resolved in the sandbox (`engine/scope.ts`, driven from
 * `sandbox/recorder.ts`) and reaches the panel only as a caption, so the two
 * halves can disagree without any unit test noticing. Here the same fake
 * scene answers both: the caption, and which layer the recorded step names.
 */
export default async function sceneScope(probe) {
  const { check } = probe;

  await probe.navigateHarness();

  const sceneName = await probe.evaluateInHost(`window.harness.scene.name`);
  const b = await probe.readNode("B");

  const caption = await probe.selectNodesAndWait([], sceneName);
  check(
    "with nothing selected the caption names the scene",
    caption === sceneName,
    `${JSON.stringify(caption)}, scene is ${JSON.stringify(sceneName)}`,
  );

  await probe.startRecording();

  const chip = await probe.evaluateInPanel(
    `document.querySelector('[data-testid="scope-chip"]')?.textContent?.trim() ?? null`,
  );
  check(
    "the recording chip says the whole scene is being watched",
    /scene/i.test(chip ?? ""),
    JSON.stringify(chip),
  );

  // Edit a layer that was NOT the selection when the recording started.
  await probe.evaluateInHost(
    `window.harness.nodes.B.position.staticValue = { x: ${b.position.x + 15}, y: ${b.position.y - 5} }`,
  );
  const counter = await probe.waitForRecordedSteps(1).catch(() => null);
  check(
    "a scene-scope recording catches an edit to any layer",
    counter >= 1,
    `counter reads ${counter}`,
  );

  await probe.stopRecording();

  // One layer throughout, so its name is hoisted off the rows and into the
  // list heading (`ui/components/StepList.tsx`). The row keeps the full
  // label in its tooltip; the heading is what a reader sees.
  const reviewed = await probe.evaluateInPanel(
    `(() => ({
      labels: [...document.querySelectorAll('[data-testid="step-row"] [title]')]
        .map((el) => el.getAttribute('title')),
      heading: document.querySelector('[data-testid="review-panel"] .instrument[title]')?.getAttribute('title') ?? null,
    }))()`,
  );
  check(
    "the recorded step is bound to the edited layer",
    reviewed.labels.some((label) => label && label.includes(b.name)),
    JSON.stringify(reviewed.labels),
  );
  check(
    "the review heading says which layer the steps are on",
    (reviewed.heading ?? "").includes(b.name),
    JSON.stringify(reviewed.heading),
  );
  await probe.screenshot("scene-scope-review");

  // Nothing to keep: this recording exists to be read, not replayed. A
  // recording with steps in it asks before it throws them away.
  await probe.clickInPanel('[data-testid="discard-review-button"]');
  await probe.evaluateInPanel(
    `(() => { const button = [...document.querySelectorAll('button')]
      .find((el) => /^discard recording$/i.test((el.textContent ?? '').trim()));
      if (button) button.click(); })()`,
  );
  const gone = await probe
    .waitForInPanel(`!document.querySelector('[data-testid="review-panel"]')`, {
      what: "the review sheet to close",
      timeout: 8000,
    })
    .then(
      () => true,
      () => false,
    );
  check("discarding the recording leaves the review sheet", gone);
}
