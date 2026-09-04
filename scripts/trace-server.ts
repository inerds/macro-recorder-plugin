import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { Plugin } from "vite";

const ENDPOINT = "/__macro-trace";
const MAX_BYTES = 32 * 1024 * 1024;

function stamp(endedAt: unknown): string {
  const date = typeof endedAt === "number" ? new Date(endedAt) : new Date();
  // Millisecond precision: two flushes with the same label in the same second
  // must not overwrite each other.
  return date.toISOString().replace(/[:.]/g, "-").slice(0, 23);
}

function slug(label: unknown): string {
  const text = typeof label === "string" && label ? label : "trace";
  return text.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 60);
}

/**
 * Dev-only endpoint that persists diagnostics bundles from the plugin UI.
 *
 * The UI runs in a sandboxed opaque-origin iframe inside Creator, so its POST
 * arrives with `Origin: null` and is preceded by a preflight — both handled
 * here. (@lottiefiles/vite-plugin-creator already sets server.cors, but this
 * endpoint answers explicitly so it does not depend on that.)
 */
export function traceServer(outDir = "traces"): Plugin {
  return {
    name: "macro-recorder-trace-server",
    apply: "serve",
    configureServer(server) {
      const dir = resolve(server.config.root, outDir);

      // @lottiefiles/vite-plugin-creator recompiles the sandbox bundle ONLY
      // when the manifest entry file itself (sandbox/plugin.ts) changes — edits
      // to sandbox/applier.ts, engine/*.ts etc. keep serving a STALE plugin.js
      // forever (this cost a whole day of "why is the sandbox still old").
      // Touch the entry file whenever any engine source changes so their
      // watcher rebuilds and pushes the SSE hot-reload.
      const entry = resolve(server.config.root, "sandbox", "plugin.ts");
      const sandboxDir = resolve(server.config.root, "sandbox") + sep;
      const engineDir = resolve(server.config.root, "engine") + sep;
      let touching = false;
      server.watcher.on("change", (file) => {
        if (touching || file === entry) return;
        if (!file.startsWith(sandboxDir) && !file.startsWith(engineDir)) return;
        if (file.endsWith(".test.ts")) return;
        touching = true;
        try {
          const now = new Date();
          utimesSync(entry, now, now);
          server.config.logger.info(
            `[trace] engine source changed (${file.slice(server.config.root.length + 1)}) — rebuilding plugin.js`,
          );
        } catch {
          // entry missing — nothing to do
        } finally {
          // let the triggered change event for the entry pass through untouched
          setTimeout(() => {
            touching = false;
          }, 200);
        }
      });
      server.middlewares.use(ENDPOINT, (req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("method not allowed");
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        let aborted = false;
        // A client disconnect mid-upload must not crash the dev server.
        req.on("error", () => {
          aborted = true;
        });
        req.on("data", (chunk: Buffer) => {
          if (aborted) return;
          size += chunk.length;
          if (size > MAX_BYTES) {
            aborted = true;
            res.statusCode = 413;
            res.end("trace too large");
            return;
          }
          chunks.push(chunk);
        });
        req.on("end", () => {
          if (aborted) return;
          const body = Buffer.concat(chunks).toString("utf8");
          let bundle: { label?: unknown; endedAt?: unknown; events?: unknown[] };
          try {
            bundle = JSON.parse(body);
          } catch {
            res.statusCode = 400;
            res.end("invalid json");
            return;
          }
          const file = `${stamp(bundle.endedAt)}_${slug(bundle.label)}.json`;
          try {
            mkdirSync(dir, { recursive: true });
            writeFileSync(resolve(dir, file), body, "utf8");
          } catch (error) {
            server.config.logger.error(
              `[trace] write failed: ${error instanceof Error ? error.message : String(error)}`,
            );
            res.statusCode = 500;
            res.end("write failed");
            return;
          }
          const count = Array.isArray(bundle.events) ? bundle.events.length : 0;
          server.config.logger.info(`[trace] ${outDir}/${file} (${count} events)`);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ file: `${outDir}/${file}` }));
        });
      });
    },
  };
}
