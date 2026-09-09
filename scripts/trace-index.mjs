/**
 * The trace index: one JSON line per captured bundle, in `traces/index.jsonl`.
 *
 * A trace bundle carries full scene snapshots, so it is large and must never
 * be read into an agent's context (see `docs/contributing/triage.md`). The
 * index is the small file you CAN read: it answers "what is here, when was it
 * captured, which sandbox revision wrote it, and is it worth opening" without
 * touching a bundle.
 *
 * The file is append-only. `scripts/trace-server.ts` adds one line as it
 * writes each bundle; only `rebuild()` behind `pnpm traces:index` ever writes
 * the whole file, to seed an index for bundles that predate it.
 *
 * Everything here is a pure function over data, except `rebuild()` and
 * `appendEntry()`, so `scripts/trace-index.test.ts` can drive it over
 * synthetic bundles in a temporary directory.
 */

import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/** The index, relative to the traces directory. */
export const INDEX_FILE = "index.jsonl";

/** The triage ledger, relative to the traces directory. One filename a line. */
export const PROCESSED_FILE = ".processed";

/**
 * A bundle this size is not read. `scripts/trace-server.ts` refuses a POST
 * over 32 MiB, so nothing it wrote can reach this; a hand-made file can.
 */
export const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;

/** The traces directory, from `TRACES_DIR` or the `traces/` default. */
export function tracesDir(env = process.env) {
  return resolve(env.TRACES_DIR || "traces");
}

/**
 * The kind of run a bundle records, from the label the UI flushed it under.
 * `ui/gateways/rpc/recorderGateway.ts` flushes `record` and `record-failed`,
 * `ui/gateways/rpc/playbackGateway.ts` flushes `playback-<macro name>`, and
 * `ui/dev/TraceStrip.tsx` flushes `manual`.
 */
export function kindOf(label) {
  if (typeof label !== "string" || !label) return "other";
  if (label === "manual") return "manual";
  if (label === "record") return "record";
  if (label === "record-failed") return "record-failed";
  if (label.startsWith("playback")) return "playback";
  return "other";
}

/**
 * The label part of a bundle's filename. `scripts/trace-server.ts` names each
 * file `<stamp>_<slug>.json`, where the slug is the label with every character
 * outside `[a-zA-Z0-9._-]` replaced.
 */
export function slugOf(file) {
  const name = file.replace(/^.*[\\/]/, "").replace(/\.json$/i, "");
  const at = name.indexOf("_");
  return at === -1 ? name : name.slice(at + 1);
}

const STAMP_RE = /^(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)(?:-(\d{1,3}))?/;

/**
 * The capture time from a bundle filename, as an ISO string, or null. The
 * stamp is `toISOString()` with `:` and `.` replaced by `-`, so it reverses
 * exactly.
 */
export function atFromFile(file) {
  const match = file.replace(/^.*[\\/]/, "").match(STAMP_RE);
  if (!match) return null;
  const [, date, hh, mm, ss, ms] = match;
  return `${date}T${hh}:${mm}:${ss}.${(ms ?? "0").padEnd(3, "0")}Z`;
}

function count(value) {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Steps and failures across a bundle's event stream. A record bundle counts
 * the steps each `step-recorded` event carried — `record.tick` and
 * `record.stop` each report their own delta, never a running total. A
 * playback bundle counts one step per `playback-event`, and its failures are
 * the entries the sandbox reported plus any RPC error in the session.
 *
 * Both fields stay absent when nothing in the bundle could report them, so a
 * `0` in the index means "none", never "not measured".
 */
export function tally(events) {
  let steps = 0;
  let failures = 0;
  let sawSteps = false;
  let sawFailures = false;
  for (const event of Array.isArray(events) ? events : []) {
    const data = event && typeof event === "object" ? event.data : undefined;
    switch (event?.kind) {
      case "step-recorded":
        sawSteps = true;
        steps += count(data?.steps);
        break;
      case "playback-event":
        sawSteps = true;
        sawFailures = true;
        steps += 1;
        failures += count(data?.failures);
        break;
      case "rpc-error":
        sawFailures = true;
        failures += 1;
        break;
      default:
        break;
    }
  }
  return {
    ...(sawSteps ? { steps } : {}),
    ...(sawFailures ? { failures } : {}),
  };
}

/**
 * One index entry for one bundle. `file` is the bundle's name inside the
 * traces directory and `bytes` its size on disk; everything else comes off the
 * bundle, with the filename as the fallback for a bundle that lost its label
 * or its clock.
 */
export function indexLineFor(bundle, { file, bytes }) {
  const source = bundle && typeof bundle === "object" ? bundle : {};
  const env = source.env && typeof source.env === "object" ? source.env : {};
  const label = typeof source.label === "string" && source.label ? source.label : slugOf(file);
  const endedAt = typeof source.endedAt === "number" && Number.isFinite(source.endedAt);
  return {
    file,
    at: endedAt ? new Date(source.endedAt).toISOString() : (atFromFile(file) ?? null),
    kind: kindOf(label),
    label,
    sandboxRev: typeof env.sandboxRev === "string" ? env.sandboxRev : null,
    uiRev: typeof env.uiRev === "string" ? env.uiRev : null,
    bytes,
    ...tally(source.events),
  };
}

/** One index line, newline included. */
export function formatLine(entry) {
  return `${JSON.stringify(entry)}\n`;
}

/**
 * The entries in an index file. A line that does not parse is skipped: the
 * file is appended to while the dev server runs, so its last line can be a
 * partial write.
 */
export function parseIndex(text) {
  const entries = [];
  for (const line of String(text ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed);
      if (entry && typeof entry === "object" && !Array.isArray(entry)) entries.push(entry);
    } catch {
      // truncated or hand-edited line — the index is a report, not a record
    }
  }
  return entries;
}

/** Appends one entry to `<dir>/index.jsonl`, creating both if they are new. */
export function appendEntry(dir, entry) {
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, INDEX_FILE), formatLine(entry), "utf8");
  return entry;
}

/** Every bundle filename in `dir`, oldest first — the stamp sorts as text. */
export function bundleFiles(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((name) => name.endsWith(".json")).sort();
}

/**
 * Reads every bundle in `dir` and returns one index entry each, oldest first.
 * A file that cannot be read or parsed becomes `{ file, bytes, error }` rather
 * than throwing, so one bad bundle cannot cost you the index.
 */
export function rebuild(dir, { maxBytes = MAX_BUNDLE_BYTES } = {}) {
  const entries = [];
  for (const file of bundleFiles(dir)) {
    const path = join(dir, file);
    let bytes = 0;
    try {
      bytes = statSync(path).size;
      if (bytes > maxBytes) {
        entries.push({ file, bytes, error: `larger than ${maxBytes} bytes — not read` });
        continue;
      }
      entries.push(indexLineFor(JSON.parse(readFileSync(path, "utf8")), { file, bytes }));
    } catch (error) {
      entries.push({ file, bytes, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return entries;
}

/** Descending, so the newest entry reads first. `null` sorts last. */
function byNewest(a, b) {
  return String(b.at ?? "").localeCompare(String(a.at ?? ""));
}

/**
 * Splits entries by sandbox revision against `currentRev`.
 *
 * `current` matches, `stale` does not, and `unknown` never carried a revision
 * — a bundle from before the handshake stamped one, or one the index could not
 * read. `groups` holds the stale entries by revision, newest revision first,
 * which is how `pnpm traces:stale` reports them.
 */
export function stale(entries, currentRev) {
  const current = [];
  const staleEntries = [];
  const unknown = [];
  for (const entry of entries) {
    const rev = entry?.sandboxRev;
    if (typeof rev !== "string" || !rev) unknown.push(entry);
    else if (rev === currentRev) current.push(entry);
    else staleEntries.push(entry);
  }
  const byRev = new Map();
  for (const entry of staleEntries) {
    const rev = entry.sandboxRev;
    if (!byRev.has(rev)) byRev.set(rev, []);
    byRev.get(rev).push(entry);
  }
  const groups = [...byRev.entries()]
    .map(([rev, group]) => ({ rev, count: group.length, entries: group.sort(byNewest) }))
    .sort((a, b) => b.rev.localeCompare(a.rev));
  return { current, stale: staleEntries, unknown, groups };
}

/** The filenames in a `.processed` ledger. Blank lines and `#` lines are not. */
export function parseProcessed(text) {
  return new Set(
    String(text ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.replace(/^.*[\\/]/, "")),
  );
}

/** The entries no triage run has claimed, newest first. */
export function unprocessed(entries, processedText) {
  const done = processedText instanceof Set ? processedText : parseProcessed(processedText);
  return entries.filter((entry) => !done.has(entry?.file)).sort(byNewest);
}

/** The current `ENGINE_REV`, read out of `engine/protocol.ts`. */
export function currentEngineRev(root = process.cwd()) {
  const text = readFileSync(resolve(root, "engine/protocol.ts"), "utf8");
  const match = text.match(/ENGINE_REV\s*=\s*"([^"]+)"/);
  if (!match) throw new Error("no ENGINE_REV in engine/protocol.ts");
  return match[1];
}
