import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LINK_PAGES, PAGES, rewriteLinks } from "./wiki-links.mjs";

/**
 * Builds the GitHub wiki tree from the documents in this repository. The wiki
 * is a read-only mirror: `.github/workflows/wiki.yml` regenerates it on every
 * push to main, so the Markdown stays here and nobody edits the wiki by hand.
 * Usage:
 *
 *   node scripts/wiki-sync.mjs                 # build into artifacts/wiki
 *   node scripts/wiki-sync.mjs --out wiki-out  # build somewhere else
 *   node scripts/wiki-sync.mjs --check         # build into a temp dir and verify
 *   node scripts/wiki-sync.mjs --quiet         # print the result line only
 *
 * The page set and the link rewriter live in `scripts/wiki-links.mjs`, which
 * the unit tests drive directly.
 */
const root = resolve(fileURLToPath(import.meta.url), "..", "..");

const argv = process.argv.slice(2);
const check = argv.includes("--check");
const quiet = argv.includes("--quiet");
const outArg = valueOf("--out");

function valueOf(flag) {
  const at = argv.indexOf(flag);
  if (at === -1) return null;
  const value = argv[at + 1];
  if (!value || value.startsWith("--")) fail(`${flag} needs a value`);
  return value;
}

function fail(message) {
  console.error(`wiki-sync: ${message}`);
  process.exit(2);
}

const errors = [];

function report(where, message) {
  errors.push(`${where}: ${message}`);
}

// ---------------------------------------------------------------------------
// The repository, as the rewriter sees it.
// ---------------------------------------------------------------------------

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

const tracked = new Set(git("ls-files").split("\n").filter(Boolean));
const trackedDirs = new Set();
for (const path of tracked) {
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i += 1) trackedDirs.add(`${parts.slice(0, i).join("/")}/`);
}

/** Does this repository path exist? Directories carry a trailing slash. */
function exists(path) {
  return tracked.has(path) || trackedDirs.has(path) || trackedDirs.has(`${path}/`);
}

const sha = git("rev-parse", "--short", "HEAD");
// The commit's own date, so the same commit always mirrors to the same footer.
const date = git("log", "-1", "--format=%cs");

// ---------------------------------------------------------------------------
// Text helpers: the title and the one-line description of each page.
// ---------------------------------------------------------------------------

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

/** The paragraphs of a document, with its H1 and any fenced blocks left out. */
function paragraphs(text) {
  return text
    .replace(/^#\s+.*$/m, "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function title(text, path) {
  const heading = text.match(/^#\s+(.+)$/m);
  if (!heading) fail(`${path} has no H1`);
  return heading[1].trim();
}

/** Markdown emphasis and links removed, whitespace collapsed. Code stays. */
function plain(text) {
  return text
    .replace(/!?\[([^\][]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The first sentence of `text`. A period counts as the end of a sentence only
 * when a space and a capital letter, or the end of the text, follow it, so
 * `engine/protocol.ts` and `1.0.1` do not cut a sentence short.
 */
function firstSentence(text) {
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== ".") continue;
    const next = text[i + 1];
    if (next === undefined) return text;
    if (next !== " ") continue;
    const after = text.slice(i + 2).trim();
    if (!after || /^[A-Z(“"]/.test(after)) return text.slice(0, i + 1);
  }
  return text.replace(/:$/, "");
}

function description(text, path) {
  const first = paragraphs(text)[0];
  if (!first) fail(`${path} has no paragraph under its H1`);
  return firstSentence(plain(first));
}

// ---------------------------------------------------------------------------
// The build.
// ---------------------------------------------------------------------------

const counts = { wiki: 0, repo: 0, external: 0, anchor: 0, unclassified: 0 };

function rewrite(text, from) {
  const result = rewriteLinks(text, { from, exists });
  for (const kind of Object.keys(counts)) counts[kind] += result.counts[kind];
  for (const link of result.unclassified) {
    report(`${from}:${link.line}`, `cannot classify the link to "${link.target}" — ${link.why}`);
  }
  return result.text;
}

/** The intro of `Home.md`: the first two paragraphs of the README. */
function homeIntro() {
  const readme = read("README.md");
  const blocks = paragraphs(readme);
  const at = blocks.findIndex((block) => block.startsWith("Macro Recorder records the edits"));
  if (at === -1) fail('README.md has no paragraph that starts "Macro Recorder records the edits"');
  return rewrite(blocks.slice(at, at + 2).join("\n\n"), "README.md");
}

function build(out) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const pages = PAGES.map(({ source, page }) => {
    const text = read(source);
    return {
      source,
      page,
      title: title(text, source),
      description: description(text, source),
      // The page keeps its own H1: the wiki shows a page name, not a title.
      body: rewrite(text, source),
    };
  });

  for (const page of pages) writeFileSync(join(out, `${page.page}.md`), page.body);

  const list = pages.map((page) => `- [${page.title}](${page.page}) — ${page.description}`);
  const home = [
    "# Macro Recorder",
    "",
    homeIntro(),
    "",
    "This wiki mirrors the `docs/` folder of the repository; edit there, not here.",
    "",
    "## Pages",
    "",
    ...list,
    "",
  ].join("\n");
  writeFileSync(join(out, "Home.md"), home);

  const sidebar = [
    "### Macro Recorder",
    "",
    "- [Home](Home)",
    ...pages.map((page) => `- [${page.title}](${page.page})`),
    "",
  ].join("\n");
  writeFileSync(join(out, "_Sidebar.md"), sidebar);

  writeFileSync(join(out, "_Footer.md"), `Mirrored from \`docs/\` at ${sha} · ${date}\n`);

  return pages;
}

// ---------------------------------------------------------------------------
// --check: every link the wiki carries has to land on a page the wiki holds.
// ---------------------------------------------------------------------------

const OUT_LINK_RE = /(!?)\[(?:[^\][]|\[[^\][]*\])*\]\(\s*([^)\s]+)[^)]*\)/g;

function checkOutput(out, pages) {
  const names = new Set([...pages.map((page) => page.page), "Home"]);
  for (const name of [...names, "_Sidebar", "_Footer"]) {
    const path = join(out, `${name}.md`);
    const text = readFileSync(path, "utf8");
    let fence = null;
    text.split("\n").forEach((line, index) => {
      const fenced = line.match(/^\s*(```+|~~~+)/);
      if (fence) {
        if (fenced && line.trim().startsWith(fence)) fence = null;
        return;
      }
      if (fenced) {
        fence = fenced[1];
        return;
      }
      for (const hit of line.matchAll(OUT_LINK_RE)) {
        const target = hit[2];
        if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(target)) continue;
        if (target.startsWith("#")) continue;
        const page = target.split("#")[0];
        if (names.has(page)) continue;
        report(`${name}.md:${index + 1}`, `the link to "${target}" names no wiki page`);
      }
    });
  }
}

// ---------------------------------------------------------------------------

const out = check
  ? mkdtempSync(join(tmpdir(), "wiki-sync-"))
  : resolve(root, outArg ?? "artifacts/wiki");

const pages = build(out);
if (check) checkOutput(out, pages);

const where = check ? "a temporary directory" : outArg ? out : "artifacts/wiki";
if (!quiet || errors.length) {
  for (const line of errors) console.log(line);
  console.log(
    `wiki-sync: ${pages.length + 3} pages → ${where}, links: ${counts.wiki} wiki, ` +
      `${counts.repo} repo, ${counts.external} external, ${counts.anchor} anchor`,
  );
  console.log(
    errors.length
      ? `wiki-sync: FAIL — ${errors.length} problem(s), ${counts.unclassified} unclassified link(s)`
      : "wiki-sync: PASS",
  );
}

if (check) rmSync(out, { recursive: true, force: true });
process.exit(errors.length ? 1 : 0);
