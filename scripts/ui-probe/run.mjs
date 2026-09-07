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
 * Set `UI_PROBE_URL` to probe a panel that is already running; otherwise a
 * private Vite server is started on a free port and killed on the way out.
 */
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { freePort, launchProbe, sleep } from "./driver.mjs";

const SCENARIO_DIR = new URL("./scenarios/", import.meta.url);
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

let pass = 0;
let fail = 0;
let scenarioName = "";

function check(name, ok, detail = "") {
  const qualified = scenarioName ? `${scenarioName}: ${name}` : name;
  console.log(`${ok ? "PASS" : "FAIL"} ${qualified}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass += 1;
  else fail += 1;
}

// ---- dev server ---------------------------------------------------------

let devServer = null;

async function startDevServer() {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  console.log(`# starting vite on ${url}`);
  devServer = spawn("pnpm", ["exec", "vite", "--port", String(port), "--strictPort"], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "inherit"],
    detached: true,
  });
  devServer.on("error", (error) => {
    console.error(`# vite failed to start: ${error.message}`);
  });

  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return url;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error("vite did not come up within 60s");
    await sleep(250);
  }
}

function stopDevServer() {
  if (!devServer) return;
  const child = devServer;
  devServer = null;
  try {
    // Vite spawns under pnpm; kill the whole group or the port stays held.
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // already gone
    }
  }
}

// ---- run ----------------------------------------------------------------

let probe = null;

async function shutdown() {
  if (probe) {
    const closing = probe;
    probe = null;
    await closing.close().catch(() => {});
  }
  stopDevServer();
}

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(130));
});
process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(143));
});

const started = Date.now();
let exitCode = 0;

try {
  const baseUrl = process.env.UI_PROBE_URL ?? (await startDevServer());
  probe = await launchProbe({ baseUrl });
  probe.check = check;

  // One warm-up load. A cold Vite optimizes dependencies during the first
  // page load and then forces a reload; paying that here keeps it out of a
  // scenario, where it looks exactly like the panel resetting itself.
  await probe.setViewport(320, 560);
  await probe.navigate();

  const files = readdirSync(SCENARIO_DIR)
    .filter((name) => name.endsWith(".mjs"))
    .sort();
  if (files.length === 0) throw new Error("no scenarios found");

  for (const file of files) {
    scenarioName = file.replace(/\.mjs$/, "");
    const module = await import(new URL(file, SCENARIO_DIR));
    const scenario = module.default;
    if (typeof scenario !== "function") {
      check("scenario exports a default function", false, file);
      continue;
    }
    try {
      await scenario(probe);
    } catch (error) {
      check(
        "scenario ran to the end",
        false,
        error instanceof Error ? error.message : String(error),
      );
      await probe.screenshot(`${scenarioName}-error`).catch(() => {});
    }
  }
  scenarioName = "";
} catch (error) {
  console.error(`# ui-probe could not run: ${error instanceof Error ? error.stack : error}`);
  exitCode = 1;
} finally {
  await shutdown();
}

const seconds = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${pass}/${pass + fail} UI probe checks passed in ${seconds}s`);
process.exit(exitCode || (fail ? 1 : 0));
