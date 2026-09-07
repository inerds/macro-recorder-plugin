import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Checks the numbers and the names the documentation quotes against the code
 * that owns them. Usage:
 *
 *   node scripts/lint-docs.mjs                      # lint (runs vitest for the counts)
 *   node scripts/lint-docs.mjs --counts 734,33      # lint with the counts handed in
 *   node scripts/lint-docs.mjs --counts-file f.json # lint with a vitest JSON report
 *   node scripts/lint-docs.mjs --fix                # rewrite what it can rewrite
 *   node scripts/lint-docs.mjs --quiet              # print errors only
 *
 * Every fact comes out of the source file that owns it, by regex, so the lint
 * has nothing of its own to keep up to date. It reports `file:line: message`
 * and exits 1 on any error.
 */
const root = resolve(fileURLToPath(import.meta.url), "..", "..");

const argv = process.argv.slice(2);
// `--fix` is a local convenience. Under CI it reports instead of rewriting,
// so a stale count fails the build rather than being quietly repaired in a
// tree nobody commits.
const fix = argv.includes("--fix") && !process.env.CI;
const quiet = argv.includes("--quiet");
const countsArg = valueOf("--counts");
const countsFileArg = valueOf("--counts-file");

function valueOf(flag) {
  const at = argv.indexOf(flag);
  if (at === -1) return null;
  const value = argv[at + 1];
  if (!value || value.startsWith("--")) fail(`${flag} needs a value`);
  return value;
}

function fail(message) {
  console.error(`lint-docs: ${message}`);
  process.exit(2);
}

const findings = [];

/** `level` is "error" or "warn". `line` is 1-based; 0 means "the file itself". */
function report(file, line, level, message) {
  findings.push({ file, line, level, message });
}

// ---------------------------------------------------------------------------
// Source of truth: the facts, pulled out of the code that owns them.
// ---------------------------------------------------------------------------

const sources = new Map();

function source(path) {
  if (!sources.has(path)) sources.set(path, readFileSync(resolve(root, path), "utf8"));
  return sources.get(path);
}

/** The first capture of `re` in `path`, or a hard failure: a fact must exist. */
function extract(path, re, what) {
  const match = source(path).match(re);
  if (!match) fail(`could not find ${what} in ${path} — the extractor needs updating`);
  return match[1];
}

/** The body of the first CSS block whose selector line matches `selector`. */
function cssBlock(path, selector) {
  const text = source(path);
  const at = text.search(selector);
  if (at === -1) fail(`could not find ${selector} in ${path}`);
  const open = text.indexOf("{", at);
  const close = text.indexOf("\n}", open);
  return text.slice(open, close);
}

function cssNumber(body, property, what, path) {
  const match = body.match(new RegExp(`(?:^|\\n)\\s*${property}:\\s*(\\d+)px`));
  if (!match) fail(`could not find ${what} in ${path} — the extractor needs updating`);
  return Number(match[1]);
}

const panelShow = source("sandbox/plugin.ts").match(
  /creator\.ui\.show\(\{\s*width:\s*(\d+),\s*height:\s*(\d+)/,
);
if (!panelShow) fail("could not find creator.ui.show({ width, height }) in sandbox/plugin.ts");

const facts = {
  engineRev: extract("engine/protocol.ts", /ENGINE_REV\s*=\s*"([^"]+)"/, "ENGINE_REV"),
  panelWidth: Number(panelShow[1]),
  panelHeight: Number(panelShow[2]),
  deckHeight: cssNumber(
    cssBlock("ui/styles/deck.css", /^\.deck-stage \{/m),
    "height",
    ".deck-stage height",
    "ui/styles/deck.css",
  ),
  breakpoint: Number(
    extract(
      "ui/styles/deck.css",
      /@container panel \(max-height:\s*(\d+)px\)/,
      "the panel max-height breakpoint",
    ),
  ),
  verbWidth: cssNumber(
    cssBlock("ui/styles/index.css", /^\.key-verb\.key-verb \{/m),
    "width",
    ".key-verb width",
    "ui/styles/index.css",
  ),
  runBudgetMs: Number(
    extract("ui/gateways/pacing.ts", /RUN_BUDGET_MS\s*=\s*(\d+)/, "RUN_BUDGET_MS"),
  ),
  maxDelayMs: Number(extract("ui/gateways/pacing.ts", /MAX_DELAY_MS\s*=\s*(\d+)/, "MAX_DELAY_MS")),
  minDelayMs: Number(extract("ui/gateways/pacing.ts", /MIN_DELAY_MS\s*=\s*(\d+)/, "MIN_DELAY_MS")),
  settleMs: Number(extract("ui/gateways/pacing.ts", /SETTLE_MS\s*=\s*(\d+)/, "SETTLE_MS")),
  decimals: Number(extract("engine/formula.ts", /\bDECIMALS\s*=\s*(\d+)/, "DECIMALS")),
  primary: extract("ui/theme/vintageTokens.ts", /"--primary":\s*"(#[0-9A-Fa-f]{6})"/, "--primary"),
  inkBlue: extract(
    "ui/theme/vintageTokens.ts",
    /"--ink-blue":\s*"(#[0-9A-Fa-f]{6})"/,
    "--ink-blue",
  ),
};

// ---------------------------------------------------------------------------
// Documents.
// ---------------------------------------------------------------------------

const docs = new Map();

function doc(path) {
  if (!docs.has(path)) docs.set(path, readFileSync(resolve(root, path), "utf8"));
  return docs.get(path);
}

function writeDoc(path, text) {
  docs.set(path, text);
  writeFileSync(resolve(root, path), text);
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text[i] === "\n") line += 1;
  return line;
}

/**
 * A sentence that names itself as history is allowed to quote a number or a
 * name the code no longer carries — that is what a "was" sentence is for. The
 * window is the sentence around the match, not the whole paragraph, so one
 * past-tense clause cannot excuse a whole bullet.
 */
const HISTORY_MARKERS =
  /\b(was|were|used to|first cut|rejected|superseded|old|older|once|no longer|before)\b/i;

function sentenceAround(text, index) {
  let start = 0;
  for (let i = index; i > 0; i -= 1) {
    if (text[i] === "\n" && text[i - 1] === "\n") {
      start = i + 1;
      break;
    }
    if (text[i] === "." && /[\s)]/.test(text[i + 1] ?? " ")) {
      start = i + 1;
      break;
    }
  }
  let end = text.length;
  for (let i = index; i < text.length; i += 1) {
    if (text[i] === "\n" && text[i + 1] === "\n") {
      end = i;
      break;
    }
    if (text[i] === "." && /[\s)]/.test(text[i + 1] ?? " ")) {
      end = i;
      break;
    }
  }
  return text.slice(start, end);
}

function isHistory(text, index) {
  return HISTORY_MARKERS.test(sentenceAround(text, index));
}

// ---------------------------------------------------------------------------
// (a) The engine revision.
// ---------------------------------------------------------------------------

/**
 * Files that must quote the CURRENT revision wherever they name one. The
 * history records, the triage guide, and the agent definitions cite past revs
 * on purpose, so they are not in this list.
 */
const REV_FILES = ["CLAUDE.md", "README.md", "docs/contributing/engine-rev.md"];
const REV_RE = /\b2026-\d\d-\d\d\.\d+\b/g;
const STATUS_HEADING_RE = /^## Status and open threads \(as of engine rev ([^)]+)\)$/m;

function checkEngineRev() {
  for (const path of REV_FILES) {
    const text = doc(path);
    for (const match of text.matchAll(REV_RE)) {
      if (match[0] === facts.engineRev) continue;
      report(
        path,
        lineAt(text, match.index),
        "error",
        `engine rev ${match[0]} is stale — ENGINE_REV is ${facts.engineRev} (engine/protocol.ts)`,
      );
    }
  }

  // In architecture.md only the status heading tracks the current rev; every
  // other rev in that file dates a specific change and must not move.
  const text = doc("docs/architecture.md");
  const heading = text.match(STATUS_HEADING_RE);
  if (!heading) {
    report(
      "docs/architecture.md",
      0,
      "error",
      'no "## Status and open threads (as of engine rev …)" heading',
    );
  } else if (heading[1] !== facts.engineRev) {
    report(
      "docs/architecture.md",
      lineAt(text, heading.index),
      "error",
      `status heading says rev ${heading[1]} — ENGINE_REV is ${facts.engineRev} (engine/protocol.ts)`,
    );
  }
}

// ---------------------------------------------------------------------------
// (b) The test counts.
// ---------------------------------------------------------------------------

const COUNT_FILES = ["CLAUDE.md", "README.md", "CONTRIBUTING.md"];
const COUNT_RE = /(\d+) tests, (\d+) files/g;

function countsFromReport(path) {
  const json = JSON.parse(readFileSync(path, "utf8"));
  return { tests: json.numTotalTests, files: json.testResults.length };
}

function runVitest() {
  const bin = resolve(root, "node_modules/vitest/vitest.mjs");
  if (!existsSync(bin)) fail("vitest is not installed — pass --counts <tests>,<files>");
  const out = resolve(root, "artifacts/vitest.json");
  mkdirSync(dirname(out), { recursive: true });
  try {
    execFileSync(process.execPath, [bin, "run", "--reporter=json", `--outputFile=${out}`], {
      cwd: root,
      stdio: "ignore",
    });
  } catch {
    fail("vitest run failed — fix the tests first, or pass --counts <tests>,<files>");
  }
  return countsFromReport(out);
}

function resolveCounts() {
  if (countsArg) {
    const [tests, files] = countsArg.split(",").map((n) => Number(n.trim()));
    if (!Number.isInteger(tests) || !Number.isInteger(files))
      fail("--counts wants <tests>,<files>");
    return { tests, files };
  }
  if (countsFileArg) {
    const path = resolve(root, countsFileArg);
    // Missing is not an error: `posttest` hands in the report the run just
    // wrote, and the lint must never start a second vitest run from there.
    if (!existsSync(path)) return null;
    try {
      return countsFromReport(path);
    } catch {
      return null;
    }
  }
  return runVitest();
}

function checkCounts(counts) {
  if (!counts) {
    report(
      "package.json",
      0,
      "warn",
      `no vitest report at ${countsFileArg} — test counts not checked`,
    );
    return;
  }
  for (const path of COUNT_FILES) {
    let text = doc(path);
    let fixed = false;
    for (const match of [...text.matchAll(COUNT_RE)]) {
      const tests = Number(match[1]);
      const files = Number(match[2]);
      if (tests === counts.tests && files === counts.files) continue;
      if (fix) {
        fixed = true;
        continue;
      }
      report(
        path,
        lineAt(text, match.index),
        "error",
        `"${match[0]}" — vitest runs ${counts.tests} tests in ${counts.files} files`,
      );
    }
    if (fixed) {
      text = text.replace(COUNT_RE, `${counts.tests} tests, ${counts.files} files`);
      writeDoc(path, text);
      report(
        path,
        0,
        "warn",
        `fixed: test counts rewritten to ${counts.tests} tests, ${counts.files} files`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// (c) Numbers quoted in prose, matched by the keyword they sit beside.
// ---------------------------------------------------------------------------

const PROSE_FILES = [
  "README.md",
  "CONTRIBUTING.md",
  "docs/architecture.md",
  "docs/design-system.md",
  "docs/user-guide.md",
];

/** How near a quoted number has to be to a fact to count as that fact. */
const NEAR = 0.2;
const WINDOW = 80;

const WORD_NUMBERS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/**
 * Each rule is: near this keyword, a number of this shape names this fact.
 * `near` keeps an unrelated number out — a 10px radius beside the stage is
 * not a stale stage height — so the rule fires on drift, which is always
 * small, and stays silent on the arithmetic around it.
 */
const PROSE_RULES = [
  {
    what: "the .deck-stage height",
    keyword: /\bstages?\b/gi,
    value: () => facts.deckHeight,
    unit: "px",
    origin: "ui/styles/deck.css",
  },
  {
    what: "the collapse breakpoint",
    keyword: /\bbreakpoints?\b|max-height/gi,
    value: () => facts.breakpoint,
    unit: "px",
    origin: "ui/styles/deck.css",
  },
  {
    what: "the verb trigger width",
    keyword: /\.key-verb|\btriggers?\b/gi,
    value: () => facts.verbWidth,
    unit: "px",
    origin: "ui/styles/index.css",
  },
  {
    what: "the run budget",
    keyword: /\bbudget\b/gi,
    value: () => facts.runBudgetMs,
    unit: "ms",
    origin: "ui/gateways/pacing.ts",
  },
  {
    what: "the delay floor",
    keyword: /\bfloor\b/gi,
    value: () => facts.minDelayMs,
    unit: "ms",
    origin: "ui/gateways/pacing.ts",
  },
  {
    what: "the settle dwell",
    keyword: /\bdwell\b/gi,
    value: () => facts.settleMs,
    unit: "ms",
    origin: "ui/gateways/pacing.ts",
  },
];

function windowsFor(text, keyword) {
  const spans = [];
  for (const hit of text.matchAll(keyword)) {
    spans.push([Math.max(0, hit.index - WINDOW), hit.index + hit[0].length + WINDOW]);
  }
  return spans;
}

function inAnySpan(spans, index) {
  return spans.some(([from, to]) => index >= from && index <= to);
}

function checkProseNumbers() {
  for (const path of PROSE_FILES) {
    const text = doc(path);

    for (const rule of PROSE_RULES) {
      const spans = windowsFor(text, rule.keyword);
      if (!spans.length) continue;
      const value = rule.value();
      const numbers = new RegExp(`(\\d+)\\s*${rule.unit}\\b`, "g");
      for (const hit of text.matchAll(numbers)) {
        const quoted = Number(hit[1]);
        if (quoted === value) continue;
        if (Math.abs(quoted - value) > value * NEAR) continue;
        if (!inAnySpan(spans, hit.index)) continue;
        if (isHistory(text, hit.index)) continue;
        report(
          path,
          lineAt(text, hit.index),
          "error",
          `"${hit[0]}" beside ${rule.what}, which is ${value}${rule.unit} (${rule.origin})`,
        );
      }
    }

    checkPanelSize(path, text);
    checkDecimals(path, text);
    checkTokens(path, text);
  }
}

/** `320×560`, the size `creator.ui.show` opens the panel at. */
function checkPanelSize(path, text) {
  const spans = windowsFor(text, /creator\.ui\.show|\bpanel\b|\bviewport\b/gi);
  if (!spans.length) return;
  for (const hit of text.matchAll(/(\d{2,4})\s*[×x]\s*(\d{2,4})/g)) {
    const width = Number(hit[1]);
    const height = Number(hit[2]);
    if (width === facts.panelWidth && height === facts.panelHeight) continue;
    if (Math.abs(width - facts.panelWidth) > facts.panelWidth * NEAR) continue;
    if (Math.abs(height - facts.panelHeight) > facts.panelHeight * NEAR) continue;
    if (!inAnySpan(spans, hit.index)) continue;
    if (isHistory(text, hit.index)) continue;
    report(
      path,
      lineAt(text, hit.index),
      "error",
      `"${hit[0]}" — the sandbox opens the panel at ${facts.panelWidth}×${facts.panelHeight} (sandbox/plugin.ts)`,
    );
  }
}

/** "two decimals", "4 decimals", `decimals={2}` — all one number. */
function checkDecimals(path, text) {
  const written = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)[- ]decimals?\b/gi;
  const bound = /\bdecimals\s*=\s*\{?(\d+)\}?/gi;
  for (const re of [written, bound]) {
    for (const hit of text.matchAll(re)) {
      const token = hit[1].toLowerCase();
      const quoted = WORD_NUMBERS[token] ?? Number(token);
      if (!Number.isFinite(quoted) || quoted === facts.decimals) continue;
      if (isHistory(text, hit.index)) continue;
      report(
        path,
        lineAt(text, hit.index),
        "error",
        `"${hit[0]}" — DECIMALS is ${facts.decimals} (engine/formula.ts)`,
      );
    }
  }
}

/** A token named in prose has to carry the hex the theme gives it. */
function checkTokens(path, text) {
  const tokens = [
    { name: "--primary", value: facts.primary },
    { name: "--ink-blue", value: facts.inkBlue },
  ];
  for (const token of tokens) {
    const re = new RegExp(`${token.name}(?![-\\w])`, "g");
    for (const hit of text.matchAll(re)) {
      const after = text.slice(hit.index, hit.index + hit[0].length + WINDOW);
      const hex = after.match(/#[0-9A-Fa-f]{6}/);
      if (!hex) continue;
      if (hex[0].toLowerCase() === token.value.toLowerCase()) continue;
      if (isHistory(text, hit.index)) continue;
      report(
        path,
        lineAt(text, hit.index),
        "error",
        `${token.name} is quoted as ${hex[0]} — the theme sets ${token.value} (ui/theme/vintageTokens.ts)`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// (d) Names the code no longer carries.
// ---------------------------------------------------------------------------

/**
 * The records of what the project used to do, plus the two vendored host
 * skills, which this repository does not write.
 */
const TERM_EXEMPT = [
  "CHANGELOG.md",
  "docs/history/",
  "docs/releases/",
  ".claude/skills/creator-plugin-development/",
  ".claude/skills/creator-plugins-ui/",
];

function markdownFiles() {
  const listed = execFileSync("git", ["ls-files", "*.md"], { cwd: root, encoding: "utf8" });
  return listed
    .split("\n")
    .filter(Boolean)
    .filter((path) => !TERM_EXEMPT.some((prefix) => path.startsWith(prefix)));
}

function deniedTerms() {
  return readFileSync(resolve(root, "scripts/lint-docs.terms.txt"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function checkTerms() {
  const terms = deniedTerms();
  for (const path of markdownFiles()) {
    const text = doc(path);
    for (const term of terms) {
      let at = text.indexOf(term);
      while (at !== -1) {
        if (!isHistory(text, at)) {
          report(
            path,
            lineAt(text, at),
            "error",
            `"${term}" names something the code dropped — write it in the past tense, or drop it`,
          );
        }
        at = text.indexOf(term, at + term.length);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// --fix: the two rewrites that are safe to make without reading the prose.
// ---------------------------------------------------------------------------

const WRITING_RE = /(time of writing it is `)([^`]+)(`)/;

function fixEngineRevDoc() {
  const path = "docs/contributing/engine-rev.md";
  const text = doc(path);
  const match = text.match(WRITING_RE);
  if (!match || match[2] === facts.engineRev) return;
  writeDoc(path, text.replace(WRITING_RE, `$1${facts.engineRev}$3`));
  report(path, lineAt(text, match.index), "warn", `fixed: rev rewritten to ${facts.engineRev}`);
}

// ---------------------------------------------------------------------------

const counts = resolveCounts();
if (fix) fixEngineRevDoc();
checkCounts(counts);
checkEngineRev();
checkProseNumbers();
checkTerms();

const errors = findings.filter((f) => f.level === "error");
const warnings = findings.filter((f) => f.level !== "error");
const shown = quiet ? errors : findings;
for (const finding of shown.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
  const where = finding.line ? `${finding.file}:${finding.line}` : finding.file;
  console.log(`${where}: ${finding.message}`);
}

if (!quiet || errors.length) {
  const files = new Set(findings.map((f) => f.file)).size;
  console.log(
    errors.length
      ? `lint-docs: ${errors.length} error(s), ${warnings.length} warning(s) across ${files} file(s)`
      : `lint-docs: clean — ${warnings.length} warning(s), rev ${facts.engineRev}${
          counts ? `, ${counts.tests} tests in ${counts.files} files` : ""
        }`,
  );
}

process.exit(errors.length ? 1 : 0);
