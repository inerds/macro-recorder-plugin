import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { creator } from "@lottiefiles/vite-plugin-creator";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { traceServer } from "./scripts/trace-server.ts";
import pkg from "./package.json" with { type: "json" };

/**
 * The dev build's plugin id. Creator scopes `clientStorage` — where every
 * saved macro lives — by the manifest's `id`, so a dev build that keeps the
 * release id in sandbox/manifest.json ("a67faf08-…") shares ONE macro store
 * with the released plugin: a tester who wipes the dev store from the dev
 * strip wipes the macros they recorded for real. This second, equally fixed
 * uuid gives the dev build its own store. It must stay stable — changing it
 * abandons every macro a tester saved under the old one.
 */
const DEV_PLUGIN_ID = "5f2c9b41-7d38-4e6a-9c05-1b8ae4f37d62";

/**
 * sandbox/manifest.json has no version field — the released manifest should
 * never hand-carry a number that can drift from package.json. This stamps
 * `version` onto dist/manifest.json after the build.
 *
 * Runs in `closeBundle` rather than `writeBundle`: @lottiefiles/vite-plugin-
 * creator copies sandbox/manifest.json into dist/ from its OWN `writeBundle`
 * hook, and writeBundle hooks across plugins run in parallel with no
 * ordering guarantee. `closeBundle` fires only after every plugin's
 * writeBundle has settled, so dist/manifest.json is guaranteed to exist by
 * the time this reads it.
 */
function injectManifestVersion(version: string): Plugin {
  let outDir = "dist";
  let dev = false;
  return {
    name: "macro-recorder-inject-manifest-version",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
      // `vite build --mode development` is the DEV build: the dev strip is
      // on, React is unminified, and the manifest says so — a tester can
      // hold both plugins in Creator without confusing them.
      dev = config.mode === "development";
    },
    closeBundle() {
      const manifestPath = resolve(outDir, "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      manifest.version = dev ? `${version}-dev` : version;
      if (dev) {
        manifest.name = `${manifest.name} (dev)`;
        // Its own id, so the dev build gets its own clientStorage scope.
        manifest.id = DEV_PLUGIN_ID;
      }
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    tailwindcss(),
    // `pluginDir` defaults to "plugin". The sandbox tree is named sandbox/, so
    // it must be named here: the Creator plugin reads sandbox/manifest.json and
    // derives the esbuild entry from the manifest's `entry` field
    // (plugin.js → sandbox/plugin.ts). Renaming the tree without this breaks
    // both the dev endpoint and the build.
    creator({ pluginDir: "sandbox" }),
    injectManifestVersion(pkg.version),
    traceServer(),
  ],
  // The dev harnesses (dev/harness/*.html) are served at the dev server's root
  // so `http://localhost:5173/host-harness.html` keeps working, but they are
  // dev tooling: the build copies no public dir, so dist/ is exactly the
  // three files the plugin bundle needs.
  publicDir: command === "serve" ? "dev/harness" : false,
  // The deck's nameplate reads this. Injected rather than hard-coded so the
  // faceplate can never drift from the released version.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
}));
