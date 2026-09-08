/**
 * The wiki page set and the link rewriter behind `scripts/wiki-sync.mjs`.
 *
 * The rewriter is a pure function so the unit tests can drive it without a
 * checkout: it takes Markdown text and the path it came from, and returns the
 * rewritten text, a count per link kind, and every link it could not classify.
 *
 * Three kinds of link exist in these documents:
 *
 *   - A link to a document the wiki mirrors becomes a wiki page link.
 *   - A link to any other path in the repository becomes an absolute
 *     github.com URL, because the wiki cannot reach the repository tree.
 *   - An external link stays as it is.
 */

export const REPO = "inerds/macro-recorder-plugin";
export const BRANCH = "main";

/**
 * The mirrored pages, in sidebar order. `source` is the path in the
 * repository, `page` the wiki page name. `docs/history/**` and
 * `docs/releases/**` are absent on purpose: they are engineering history, not
 * reader documentation, so a link to them turns into a repository URL.
 */
export const PAGES = [
  { source: "docs/user-guide.md", page: "User-Guide" },
  { source: "docs/runtime-api.md", page: "Runtime-API" },
  { source: "docs/limitations.md", page: "Limitations" },
  { source: "docs/architecture.md", page: "Architecture" },
  { source: "docs/design-system.md", page: "Design-System" },
  { source: "docs/contributing/writing-style.md", page: "Contributing-Writing-Style" },
  { source: "docs/contributing/triage.md", page: "Contributing-Triage" },
  { source: "docs/contributing/engine-rev.md", page: "Contributing-Engine-Rev" },
  { source: "docs/contributing/backlog.md", page: "Contributing-Backlog" },
  { source: "CONTRIBUTING.md", page: "Contributing" },
  { source: "CHANGELOG.md", page: "Changelog" },
];

/**
 * Every path that resolves to a wiki page. `README.md` is here but not in
 * `PAGES`: the wiki's `Home` is generated from it, not copied from it.
 */
export const LINK_PAGES = new Map([
  ...PAGES.map(({ source, page }) => [source, page]),
  ["README.md", "Home"],
]);

const LINK_RE = /(!?)\[((?:[^\][]|\[[^\][]*\])*)\]\(\s*<?([^)<>\s]+)>?(\s+"[^"]*")?\s*\)/g;
const URL_RE = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;
const MAIL_RE = /^(?:mailto|tel):/i;
const FENCE_RE = /^\s*(```+|~~~+)/;
// A source reference of the `sandbox/plugin.ts:13` form. GitHub spells the
// same thing `#L13`.
const LINE_RE = /^(.*\.[a-z0-9]+):(\d+)$/i;

/** Resolves `target` against the directory of `from`, POSIX style. */
function resolvePath(from, target) {
  const base = from.includes("/") ? from.slice(0, from.lastIndexOf("/")).split("/") : [];
  const parts = target.split("/");
  const out = target.startsWith("/") ? [] : [...base];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!out.length) return null; // escapes the repository root
      out.pop();
      continue;
    }
    out.push(part);
  }
  const path = out.join("/");
  return target.endsWith("/") ? `${path}/` : path;
}

/**
 * Classifies one link target. Returns `{ kind, href }`, where `kind` is
 * "wiki", "repo", "external", "anchor", or "unclassified". `href` is what the
 * link becomes; for an unclassified link it is the target, unchanged.
 */
export function classifyTarget(target, options = {}) {
  const from = options.from ?? "";
  const pages = options.pages ?? LINK_PAGES;
  const exists = options.exists ?? (() => true);
  const repo = options.repo ?? REPO;
  const branch = options.branch ?? BRANCH;

  if (URL_RE.test(target) || MAIL_RE.test(target)) return { kind: "external", href: target };
  if (target.startsWith("#")) return { kind: "anchor", href: target };

  const hash = target.indexOf("#");
  const rawPath = hash === -1 ? target : target.slice(0, hash);
  const fragment = hash === -1 ? "" : target.slice(hash);
  if (!rawPath) return { kind: "anchor", href: target };

  const resolved = resolvePath(from, rawPath);
  if (resolved === null || !resolved) {
    return { kind: "unclassified", href: target, why: "points outside the repository root" };
  }

  // `path/to/file.ts:13` — the line number is part of the target, not a path.
  const withLine = resolved.match(LINE_RE);
  const relative = withLine ? withLine[1] : resolved;
  const line = withLine ? withLine[2] : null;

  if (!line && pages.has(relative)) {
    return { kind: "wiki", href: `${pages.get(relative)}${fragment}` };
  }

  // A document links to code either from its own directory or from the
  // repository root. Take the root reading only when the relative one names
  // nothing, so a real file always wins over a guess.
  const rooted = withLine ? rawPath.replace(/:\d+$/, "") : rawPath;
  const path = exists(relative) ? relative : exists(rooted) ? rooted : null;
  if (!path) {
    return { kind: "unclassified", href: target, why: "no such path in the repository" };
  }

  const view = path.endsWith("/") ? "tree" : "blob";
  const suffix = line ? `#L${line}` : fragment;
  return { kind: "repo", href: `https://github.com/${repo}/${view}/${branch}/${path}${suffix}` };
}

/**
 * Rewrites every Markdown link in `text`. Fenced code blocks are left alone:
 * a link inside one is an example, not a reference.
 *
 * Options: `from` (the path the text came from, for relative targets),
 * `pages` (path → page name), `exists` (does this repository path exist),
 * `repo`, `branch`.
 */
export function rewriteLinks(text, options = {}) {
  const counts = { wiki: 0, repo: 0, external: 0, anchor: 0, unclassified: 0 };
  const unclassified = [];
  let fence = null;

  const lines = text.split("\n").map((line, index) => {
    const fenced = line.match(FENCE_RE);
    if (fence) {
      if (fenced && line.trim().startsWith(fence)) fence = null;
      return line;
    }
    if (fenced) {
      fence = fenced[1];
      return line;
    }

    return line.replace(LINK_RE, (whole, bang, label, target, title = "") => {
      const result = classifyTarget(target, options);
      counts[result.kind] += 1;
      if (result.kind === "unclassified") {
        unclassified.push({ line: index + 1, target, label, why: result.why });
        return whole;
      }
      // An image cannot render from a blob page, so it takes the raw URL.
      const href =
        bang && result.kind === "repo" ? result.href.replace("/blob/", "/raw/") : result.href;
      return `${bang}[${label}](${href}${title})`;
    });
  });

  return { text: lines.join("\n"), counts, unclassified };
}
