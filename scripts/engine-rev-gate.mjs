import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Fails a commit, or a pull request, that touches `sandbox/` or `engine/`
 * without also bumping `ENGINE_REV` in `engine/protocol.ts`. Creator caches
 * `plugin.js` after the first load and never re-fetches it, so a stale
 * sandbox reproduces bugs that are already fixed — see
 * `docs/contributing/engine-rev.md`.
 *
 * Usage:
 *
 *   node scripts/engine-rev-gate.mjs --staged        # the pre-commit hook
 *   node scripts/engine-rev-gate.mjs --range A..B    # CI, over a commit range
 *
 * `decide()` is the pure rule, exported for the unit tests. Everything else
 * in this file collects git's answer to "what changed" and prints one of two
 * outcomes: a quiet pass (nothing gated changed, or it changed with a bump),
 * or a failure that names the files, the reason, and the fix.
 *
 * `SKIP_ENGINE_REV=1 git commit …` bypasses the gate for a change that
 * provably does not alter sandbox behaviour — a comment, a type-only edit.
 * The bypass is read here, not in `decide()`, so `decide()` stays a pure
 * function of the diff: it never sees the environment.
 */

const root = resolve(fileURLToPath(import.meta.url), "..", "..");

const GATED_PREFIXES = ["sandbox/", "engine/"];
const GATED_TEST_DIRS = ["engine/testing/", "sandbox/testing/"];
const BUMP_RE = /^\+\s*export const ENGINE_REV\s*=/m;
const REV_RE = /^(\d{4}-\d\d-\d\d)\.(\d+)$/;

/** A changed path the gate cares about: under `sandbox/` or `engine/`, but
 * not a test file or a testing fixture — those never touch what Creator
 * caches. */
export function isGated(path) {
  if (!GATED_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;
  if (path.endsWith(".test.ts")) return false;
  if (GATED_TEST_DIRS.some((prefix) => path.startsWith(prefix))) return false;
  return true;
}

/** Does `protocolDiff` (a unified diff of `engine/protocol.ts`) add a new
 * `ENGINE_REV` line? A `+++ b/…` file header never matches: the line still
 * needs `export const ENGINE_REV =` right after the leading `+`. */
export function hasBump(protocolDiff) {
  return BUMP_RE.test(protocolDiff);
}

/** The rev to suggest: the next counter today, or `.1` on a new day. Falls
 * back to `<today>.1` if `currentRev` is not in the `YYYY-MM-DD.N` shape. */
export function computeNextRev(currentRev, today) {
  const match = currentRev.match(REV_RE);
  if (!match) return `${today}.1`;
  const [, date, counter] = match;
  return date === today ? `${date}.${Number(counter) + 1}` : `${today}.1`;
}

function failMessage(offenders, currentRev, nextRev) {
  const files = offenders.map((path) => `  - ${path}`).join("\n");
  return [
    "engine-rev-gate: sandbox/engine change with no ENGINE_REV bump.",
    "",
    "Changed without a bump:",
    files,
    "",
    "Creator caches plugin.js after the first load and never re-fetches it,",
    "so a stale sandbox reproduces bugs that are already fixed.",
    "",
    "Fix: bump ENGINE_REV in engine/protocol.ts.",
    `  current:    "${currentRev}"`,
    `  suggested:  "${nextRev}"`,
    "",
    "Bypass, only for a change that provably does not alter sandbox behaviour",
    "(a comment, a type-only edit):",
    "  SKIP_ENGINE_REV=1 git commit …",
    "Say why you bypassed it in the commit message.",
  ].join("\n");
}

/**
 * The pure rule. `changed` is every path the diff touches; `protocolDiff` is
 * the unified diff of `engine/protocol.ts` alone (so a bump elsewhere in the
 * file, or in an unrelated file, cannot count); `today` and `currentRev` are
 * `YYYY-MM-DD` and the value `ENGINE_REV` holds right now.
 */
export function decide({ changed, protocolDiff, today, currentRev }) {
  const offenders = changed.filter(isGated);
  if (offenders.length === 0) {
    return { verdict: "skip", offenders: [], nextRev: null, message: "" };
  }

  const nextRev = computeNextRev(currentRev, today);
  if (hasBump(protocolDiff)) {
    return {
      verdict: "pass",
      offenders,
      nextRev,
      message: `engine-rev-gate: ENGINE_REV bumped — gate passed (${offenders.length} file(s) under sandbox/ or engine/).`,
    };
  }

  return {
    verdict: "fail",
    offenders,
    nextRev,
    message: failMessage(offenders, currentRev, nextRev),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function namesToList(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * The revision the commit would carry. In staged mode that is the INDEX copy
 * of `engine/protocol.ts`, not the working tree: a bump that sits unstaged
 * would otherwise be reported as the current value, and the fix suggested
 * would be a second bump instead of `git add`.
 */
function currentRev({ staged }) {
  const text = staged
    ? git(["show", ":engine/protocol.ts"])
    : readFileSync(resolve(root, "engine/protocol.ts"), "utf8");
  const match = text.match(/ENGINE_REV\s*=\s*"([^"]+)"/);
  if (!match) fail("could not find ENGINE_REV in engine/protocol.ts");
  return match[1];
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function fail(message) {
  console.error(`engine-rev-gate: ${message}`);
  process.exit(2);
}

function run() {
  const argv = process.argv.slice(2);

  if (process.env.SKIP_ENGINE_REV) {
    console.log(
      "engine-rev-gate: SKIP_ENGINE_REV set — bypassing the gate. Say why in the commit message.",
    );
    process.exit(0);
  }

  const staged = argv.includes("--staged");
  const rangeAt = argv.indexOf("--range");
  const range = rangeAt === -1 ? null : argv[rangeAt + 1];

  if (!staged && !range) fail("pass --staged or --range <A..B>");

  let changed;
  let protocolDiff;
  try {
    if (staged) {
      changed = namesToList(git(["diff", "--cached", "--name-only"]));
      protocolDiff = git(["diff", "--cached", "-U0", "--", "engine/protocol.ts"]);
    } else {
      changed = namesToList(git(["diff", "--name-only", range]));
      protocolDiff = git(["diff", "-U0", range, "--", "engine/protocol.ts"]);
    }
  } catch (error) {
    fail(`git diff failed — ${error.message}`);
    return;
  }

  const result = decide({
    changed,
    protocolDiff,
    today: todayIso(),
    currentRev: currentRev({ staged }),
  });

  if (result.verdict === "skip") process.exit(0);

  if (result.verdict === "fail") {
    if (staged) {
      let worktreeDiff = "";
      try {
        worktreeDiff = git(["diff", "-U0", "--", "engine/protocol.ts"]);
      } catch {
        worktreeDiff = "";
      }
      if (hasBump(worktreeDiff)) {
        console.error(
          `${result.message}\n\nThe bump is in the working tree but not staged. Stage ` +
            "engine/protocol.ts (or the hunk that bumps it) before you commit.",
        );
        process.exit(1);
      }
    }
    console.error(result.message);
    process.exit(1);
  }

  console.log(result.message);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) run();
