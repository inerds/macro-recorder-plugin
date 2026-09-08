/**
 * Drives `dev/harness/host-harness.html` in headless Chrome: the real
 * compiled sandbox bundle against the real panel, with the shared fake scene
 * (`engine/testing/fakeScene.ts`) as the host. It is the only check that
 * exercises record and playback together.
 *
 * Output and exit code follow `run.mjs`: one PASS/FAIL line per assertion,
 * 1 on any failure. Screenshots land in `artifacts/harness/`.
 *
 * Set `UI_PROBE_URL` to drive a dev server that is already running;
 * otherwise a private Vite server is started on a free port and killed on
 * the way out.
 */
import { runSuite } from "./suite.mjs";

await runSuite({
  scenarioDir: new URL("./harness-scenarios/", import.meta.url),
  label: "host harness",
  errorLabel: "test:harness",
  artifactDir: "artifacts/harness/",
  async warmUp(probe) {
    // Room for the 320x560 panel and the harness's log beside it. Scale 1:
    // see `setViewport` for what scale 2 does to clicks in the frame on Linux.
    await probe.setViewport(900, 700, { scale: 1 });
    await probe.navigateHarness();
  },
});
