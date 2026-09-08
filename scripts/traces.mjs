/**
 * The trace index command line. Usage:
 *
 *   node scripts/traces.mjs index         # rebuild traces/index.jsonl from the bundles
 *   node scripts/traces.mjs stale         # traces whose sandbox revision is not current
 *   node scripts/traces.mjs unprocessed   # traces no triage run has claimed, newest first
 *
 * `--dir <path>` or `TRACES_DIR` points at a different traces directory;
 * `traces/` is the default. Every subcommand is a report and exits 0 unless it
 * was asked to do something it could not do.
 *
 * The logic lives in `scripts/trace-index.mjs`, which the tests drive
 * directly. This file is the shell around it: arguments in, columns out.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import {
  INDEX_FILE,
  PROCESSED_FILE,
  currentEngineRev,
  formatLine,
  parseIndex,
  rebuild,
  stale,
  tracesDir,
  unprocessed,
} from "./trace-index.mjs";

const argv = process.argv.slice(2);
const command = argv[0];

function valueOf(flag) {
  const at = argv.indexOf(flag);
  if (at === -1) return null;
  const value = argv[at + 1];
  if (!value || value.startsWith("--")) {
    console.error(`traces: ${flag} needs a value`);
    process.exit(2);
  }
  return value;
}

const dirArg = valueOf("--dir");
const dir = dirArg ? resolve(process.cwd(), dirArg) : tracesDir();
// A directory inside the repository reads better relative; one outside it
// (a temporary directory under test, say) reads better as it is.
const near = relative(process.cwd(), dir);
const shown = !near || near.startsWith("..") ? dir : near;
const indexPath = join(dir, INDEX_FILE);

/** Bytes, in the units a human reads. */
function size(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "?";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * The index, or a scan of the bundles when no index exists yet. A report must
 * still answer on a directory nobody has indexed.
 */
function load() {
  if (existsSync(indexPath)) return parseIndex(readFileSync(indexPath, "utf8"));
  const entries = rebuild(dir);
  if (entries.length)
    console.log(`no ${shown}/${INDEX_FILE} yet — scanned the bundles instead (pnpm traces:index)`);
  return entries;
}

function runIndex() {
  const entries = rebuild(dir);
  writeFileSync(indexPath, entries.map(formatLine).join(""), "utf8");
  const broken = entries.filter((entry) => entry.error);
  console.log(`${shown}/${INDEX_FILE}: ${plural(entries.length, "trace")}`);
  for (const entry of broken) console.log(`  unreadable: ${entry.file} — ${entry.error}`);
}

function runStale() {
  const entries = load();
  if (!entries.length) {
    console.log(`no traces in ${shown}/`);
    return;
  }
  const rev = currentEngineRev();
  const split = stale(entries, rev);
  console.log(`${shown}/: ${plural(entries.length, "trace")} indexed`);
  for (const group of split.groups) {
    const newest = group.entries[0]?.at ?? "?";
    console.log(`  ${group.rev.padEnd(16)} ${String(group.count).padStart(4)}  newest ${newest}`);
  }
  if (split.unknown.length)
    console.log(`  ${"(no rev)".padEnd(16)} ${String(split.unknown.length).padStart(4)}`);
  const behind = split.stale.length + split.unknown.length;
  console.log(
    behind === 0
      ? `nothing is stale: the engine rev is ${rev}, and every trace matches it.`
      : `${behind} of ${plural(entries.length, "trace")} predate the current engine rev ${rev} — re-capture before you trust them.`,
  );
}

function runUnprocessed() {
  const entries = load();
  const ledger = join(dir, PROCESSED_FILE);
  const open = unprocessed(entries, existsSync(ledger) ? readFileSync(ledger, "utf8") : "");
  if (!open.length) {
    console.log(`no unprocessed traces in ${shown}/ (${plural(entries.length, "trace")} indexed)`);
    return;
  }
  for (const entry of open) {
    const rev = entry.sandboxRev ?? "no rev";
    console.log(
      `  ${String(entry.at ?? "?").padEnd(24)} ${String(entry.kind ?? "?").padEnd(13)} ` +
        `${rev.padEnd(16)} ${size(entry.bytes).padStart(8)}  ${entry.file}`,
    );
  }
  console.log(`${plural(open.length, "unprocessed trace")} of ${entries.length} in ${shown}/.`);
}

const commands = { index: runIndex, stale: runStale, unprocessed: runUnprocessed };

if (!command || !commands[command]) {
  console.error("usage: node scripts/traces.mjs <index|stale|unprocessed> [--dir <path>]");
  process.exit(command ? 2 : 1);
}
commands[command]();
