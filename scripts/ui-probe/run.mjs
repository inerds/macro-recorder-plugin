/**
 * Runs every scenario in `scenarios/` against the panel in headless Chrome
 * and prints one PASS/FAIL line per assertion, the way
 * `scripts/quickjs-smoke.mjs` does.
 *
 * The suite exists because DOM claims cannot be checked by reading the code:
 * three real bugs on 2026-09-07 (a menu buried under the deck, a letterboxed
 * deck stage, a verb that would not change) were only found once something
 * could open the panel and ask `elementFromPoint`. Vitest is node-only here,
 * so this is a separate script rather than a test file.
 *
 * The panel runs alone here, on mock gateways. `harness.mjs` is the other
 * half: the same driver, the same runner, the panel inside the host harness
 * with the real sandbox behind it.
 *
 * Set `UI_PROBE_URL` to probe a panel that is already running; otherwise a
 * private Vite server is started on a free port and killed on the way out.
 */
import { runSuite } from "./suite.mjs";

await runSuite({
  scenarioDir: new URL("./scenarios/", import.meta.url),
  label: "UI probe",
  errorLabel: "ui-probe",
  artifactDir: "artifacts/ui/",
  async warmUp(probe) {
    await probe.setViewport(320, 560);
    await probe.navigate();
  },
});
