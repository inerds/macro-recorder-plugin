/**
 * What the two probe suites share: the private Vite server, the PASS/FAIL
 * counter, and the loop that runs a directory of scenarios and reports.
 *
 * `run.mjs` (the panel, `pnpm test:ui`) and `harness.mjs` (the host harness,
 * `pnpm test:harness`) differ only in which page they open, which directory
 * they read, and where their screenshots land. Everything else was identical,
 * and a second copy of the server start-up would have carried its own
 * version of the two CI lessons the comments below record.
 */
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { launchProbe, freePort, sleep } from "./driver.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** A PASS/FAIL printer with the running counts behind it. */
export function createChecker() {
  const counts = { pass: 0, fail: 0 };
  let scenarioName = "";
  const check = (name, ok, detail = "") => {
    const qualified = scenarioName ? `${scenarioName}: ${name}` : name;
    console.log(`${ok ? "PASS" : "FAIL"} ${qualified}${detail ? ` — ${detail}` : ""}`);
    if (ok) counts.pass += 1;
    else counts.fail += 1;
  };
  return {
    check,
    counts,
    setScenario(name) {
      scenarioName = name;
    },
  };
}

/**
 * Start Vite on a free port and wait for it to answer.
 *
 * Returns `{ url, stop }`. `stop` is safe to call more than once.
 */
export async function startDevServer() {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  console.log(`# starting vite on ${url}`);
  // `--host 127.0.0.1`: the probe polls that address, so Vite must bind it.
  // Left to its default, Vite binds `localhost`, which on GitHub's ubuntu
  // runners resolves to ::1 first — every poll got ECONNREFUSED and the
  // job timed out on 2026-09-07 while the same command passed on macOS,
  // where `localhost` binds both families.
  const child = spawn(
    "pnpm",
    ["exec", "vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  // Keep Vite's last lines so a start-up failure says why instead of only
  // that it timed out.
  const tail = [];
  const keep = (chunk) => {
    for (const line of String(chunk).split("\n")) {
      if (line.trim() === "") continue;
      tail.push(line);
      if (tail.length > 30) tail.shift();
      if (process.env.UI_PROBE_VERBOSE) console.log(`# vite: ${line}`);
    }
  };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  child.on("error", (error) => {
    console.error(`# vite failed to start: ${error.message}`);
  });

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
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
  };

  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return { url, stop };
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      stop();
      throw new Error(
        `vite did not come up within 60s\n# vite output:\n${tail.map((l) => `#   ${l}`).join("\n")}`,
      );
    }
    await sleep(250);
  }
}

/**
 * Run every `.mjs` in `scenarioDir` against one Chrome and one page, print
 * the summary, and exit. `warmUp` gets the probe before the first scenario:
 * a cold Vite optimizes dependencies during the first page load and then
 * forces a reload, and paying that here keeps it out of a scenario, where it
 * looks exactly like the panel resetting itself.
 *
 * Never returns: it calls `process.exit` with 1 on any failure.
 */
export async function runSuite({ scenarioDir, label, errorLabel = label, artifactDir, warmUp }) {
  const { check, counts, setScenario } = createChecker();

  let devServer = null;
  let probe = null;

  const shutdown = async () => {
    if (probe) {
      const closing = probe;
      probe = null;
      await closing.close().catch(() => {});
    }
    devServer?.stop();
    devServer = null;
  };

  process.on("SIGINT", () => {
    void shutdown().then(() => process.exit(130));
  });
  process.on("SIGTERM", () => {
    void shutdown().then(() => process.exit(143));
  });

  const started = Date.now();
  let exitCode = 0;

  try {
    let baseUrl = process.env.UI_PROBE_URL;
    if (!baseUrl) {
      devServer = await startDevServer();
      baseUrl = devServer.url;
    }
    probe = await launchProbe({ baseUrl, artifactDir });
    probe.check = check;

    await warmUp(probe);

    const files = readdirSync(scenarioDir)
      .filter((name) => name.endsWith(".mjs"))
      .sort();
    if (files.length === 0) throw new Error("no scenarios found");

    for (const file of files) {
      const name = file.replace(/\.mjs$/, "");
      setScenario(name);
      const module = await import(new URL(file, scenarioDir));
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
        await probe.screenshot(`${name}-error`).catch(() => {});
      }
    }
    setScenario("");
  } catch (error) {
    console.error(`# ${errorLabel} could not run: ${error instanceof Error ? error.stack : error}`);
    exitCode = 1;
  } finally {
    await shutdown();
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const total = counts.pass + counts.fail;
  console.log(`\n${counts.pass}/${total} ${label} checks passed in ${seconds}s`);
  process.exit(exitCode || (counts.fail ? 1 : 0));
}
