import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BRANCH, PAGES, REPO, rewriteLinks, slug, plainText } from "./wiki-links.mjs";

/**
 * Builds the GitHub wiki from the user guide. The wiki is a read-only mirror
 * of `docs/user-guide.md`: `.github/workflows/wiki.yml` regenerates it on
 * every push to main, so the Markdown stays here and nobody edits the wiki by
 * hand. Every other document stays in `docs/` (user decision, 2026-09-08), so
 * a link out of the guide becomes a link into the repository. Usage:
 *
 *   node scripts/wiki-sync.mjs                 # build into artifacts/wiki
 *   node scripts/wiki-sync.mjs --out wiki-out  # build somewhere else
 *   node scripts/wiki-sync.mjs --check         # build into a temp dir and verify
 *   node scripts/wiki-sync.mjs --quiet         # print the result line only
 *
 * The page set, the link rewriter, and the anchor form live in
 * `scripts/wiki-links.mjs`, which the unit tests drive directly.
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
// The build. One source document, one page.
// ---------------------------------------------------------------------------

const [guide] = PAGES;
const source = `https://github.com/${REPO}/blob/${BRANCH}/${guide.source}`;

const counts = { wiki: 0, repo: 0, external: 0, anchor: 0, unclassified: 0 };

function rewrite(text, from) {
  const result = rewriteLinks(text, { from, exists });
  for (const kind of Object.keys(counts)) counts[kind] += result.counts[kind];
  for (const link of result.unclassified) {
    report(`${from}:${link.line}`, `cannot classify the link to "${link.target}" — ${link.why}`);
  }
  return result.text;
}

/** The lines of `text` that are not inside a fenced code block. */
function proseLines(text) {
  const out = [];
  let fence = null;
  for (const line of text.split("\n")) {
    const fenced = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      if (fenced && line.trim().startsWith(fence)) fence = null;
      continue;
    }
    if (fenced) {
      fence = fenced[1];
      continue;
    }
    out.push(line);
  }
  return out;
}

/**
 * The page: the guide, with one line under its own H1 that says where the
 * source is. The H1 stays — the guide reads as a document, not as a wiki page
 * that lost its title.
 */
function page(text) {
  const note =
    "_This page mirrors `docs/user-guide.md` in the repository; edit there, not here._" +
    ` [\`${guide.source}\` on ${BRANCH}](${source})`;
  const lines = text.split("\n");
  const h1 = lines.findIndex((line) => line.startsWith("# "));
  if (h1 === -1) fail(`${guide.source} has no H1`);
  lines.splice(h1 + 1, 0, "", note);
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

/** The guide's `##` sections, as the sidebar and the check both read them. */
function sections(text) {
  return proseLines(text)
    .filter((line) => /^##\s+\S/.test(line))
    .map((line) => {
      const heading = line.replace(/^##\s+/, "").trim();
      return { title: plainText(heading), anchor: slug(heading) };
    });
}

function build(out) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const text = rewrite(readFileSync(resolve(root, guide.source), "utf8"), guide.source);
  const body = page(text);
  writeFileSync(join(out, `${guide.page}.md`), body);

  const list = sections(body);
  if (!list.length) fail(`${guide.source} has no "##" section`);
  const sidebar = [
    "### User guide",
    "",
    ...list.map((section) => `- [${section.title}](#${section.anchor})`),
    "",
  ].join("\n");
  writeFileSync(join(out, "_Sidebar.md"), sidebar);

  writeFileSync(join(out, "_Footer.md"), `Mirrored from \`docs/\` at ${sha} · ${date}\n`);

  return { body, sections: list };
}

// ---------------------------------------------------------------------------
// --check: every link the wiki carries has to land somewhere the wiki holds.
// ---------------------------------------------------------------------------

const OUT_LINK_RE = /(!?)\[(?:[^\][]|\[[^\][]*\])*\]\(\s*([^)\s]+)[^)]*\)/g;

function checkOutput(out, built) {
  const names = new Set(PAGES.map((each) => each.page));
  const anchors = new Set(built.sections.map((section) => section.anchor));
  // Every heading the page carries, so a link to a "###" heading passes too.
  for (const line of proseLines(built.body)) {
    if (/^#{1,6}\s+\S/.test(line)) anchors.add(slug(line.replace(/^#+\s+/, "")));
  }

  for (const name of [...names, "_Sidebar", "_Footer"]) {
    const text = readFileSync(join(out, `${name}.md`), "utf8");
    proseLines(text).forEach((line, index) => {
      for (const hit of line.matchAll(OUT_LINK_RE)) {
        const target = hit[2];
        if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(target)) continue;
        const [path, anchor] = target.startsWith("#")
          ? ["", target.slice(1)]
          : [target.split("#")[0], target.split("#")[1] ?? ""];
        if (path && !names.has(path)) {
          report(`${name}.md:${index + 1}`, `the link to "${target}" names no wiki page`);
          continue;
        }
        if (!path && !anchors.has(anchor)) {
          report(`${name}.md:${index + 1}`, `the link to "${target}" names no heading on Home`);
        }
      }
    });
  }
}

// ---------------------------------------------------------------------------

const out = check
  ? mkdtempSync(join(tmpdir(), "wiki-sync-"))
  : resolve(root, outArg ?? "artifacts/wiki");

const built = build(out);
if (check) checkOutput(out, built);

const where = check ? "a temporary directory" : outArg ? out : "artifacts/wiki";
if (!quiet || errors.length) {
  for (const line of errors) console.log(line);
  console.log(
    `wiki-sync: ${PAGES.length + 2} pages, ${built.sections.length} sections → ${where}, ` +
      `links: ${counts.wiki} wiki, ${counts.repo} repo, ${counts.external} external, ` +
      `${counts.anchor} anchor`,
  );
  console.log(
    errors.length
      ? `wiki-sync: FAIL — ${errors.length} problem(s), ${counts.unclassified} unclassified link(s)`
      : "wiki-sync: PASS",
  );
}

if (check) rmSync(out, { recursive: true, force: true });
process.exit(errors.length ? 1 : 0);
