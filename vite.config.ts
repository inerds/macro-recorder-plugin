import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { creator } from "@lottiefiles/vite-plugin-creator";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { traceServer } from "./scripts/trace-server";
import pkg from "./package.json" with { type: "json" };

/**
 * plugin/manifest.json has no version field — the released manifest should
 * never hand-carry a number that can drift from package.json. This stamps
 * `version` onto dist/manifest.json after the build.
 *
 * Runs in `closeBundle` rather than `writeBundle`: @lottiefiles/vite-plugin-
 * creator copies plugin/manifest.json into dist/ from its OWN `writeBundle`
 * hook, and writeBundle hooks across plugins run in parallel with no
 * ordering guarantee. `closeBundle` fires only after every plugin's
 * writeBundle has settled, so dist/manifest.json is guaranteed to exist by
 * the time this reads it.
 */
function injectManifestVersion(version: string): Plugin {
  let outDir = "dist";
  return {
    name: "macro-recorder-inject-manifest-version",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const manifestPath = resolve(outDir, "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      manifest.version = version;
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), creator(), injectManifestVersion(pkg.version), traceServer()],
  // The deck's nameplate reads this. Injected rather than hard-coded so the
  // faceplate can never drift from the released version.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
});
