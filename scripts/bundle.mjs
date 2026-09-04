import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Packages a built dist/ into a release zip: release/macro-recorder-v<version>.zip
 * containing exactly manifest.json, plugin.js, and ui.html at the zip root.
 * Run via `pnpm bundle` (which builds first) — this script assumes dist/ is
 * already up to date and fails loudly if the three files are missing.
 * `pnpm bundle:dev` builds in development mode and passes --dev.
 */

const root = resolve(fileURLToPath(import.meta.url), "..", "..");
const distDir = resolve(root, "dist");
const releaseDir = resolve(root, "release");

const dev = process.argv.includes("--dev");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version = pkg.version;
if (!version) {
  console.error("bundle: package.json has no version");
  process.exit(1);
}

const files = ["manifest.json", "plugin.js", "ui.html"];
const missing = files.filter((file) => !existsSync(resolve(distDir, file)));
if (missing.length) {
  console.error(`bundle: dist/ is missing ${missing.join(", ")} — run "pnpm build" first`);
  process.exit(1);
}

mkdirSync(releaseDir, { recursive: true });
// A development build (vite build --mode development: dev strip on, React
// dev build, manifest name "Macro Recorder (dev)") gets a -dev suffix so it
// can never be mistaken for the release.
const zipName = `macro-recorder-v${version}${dev ? "-dev" : ""}.zip`;
const zipPath = resolve(releaseDir, zipName);
rmSync(zipPath, { force: true });

// -X: no extra attributes (deterministic-ish output); -j: junk the paths so
// the three files land at the zip root regardless of dist/'s own layout.
execFileSync("zip", ["-X", "-j", zipPath, ...files.map((file) => resolve(distDir, file))], {
  cwd: root,
  stdio: "inherit",
});

console.log(`bundle: wrote release/${zipName}`);
