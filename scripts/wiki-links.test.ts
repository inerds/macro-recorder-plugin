import { describe, expect, it } from "vitest";
// The rewriter is plain ESM so `scripts/wiki-sync.mjs` can run it with no build
// step. This file is outside the three TypeScript projects for the same reason;
// `vitest.config.ts` includes it through the `scripts/**` glob.
import { LINK_PAGES, PAGES, classifyTarget, rewriteLinks } from "./wiki-links.mjs";

const BLOB = "https://github.com/inerds/macro-recorder-plugin/blob/main";
const TREE = "https://github.com/inerds/macro-recorder-plugin/tree/main";

/** The repository, as far as these tests are concerned. */
const files = new Set([
  "engine/scope.ts",
  "sandbox/applier.ts",
  "sandbox/plugin.ts",
  "scripts/ui-probe/README.md",
  ".claude/agents/macro-triage.md",
  "docs/history/improvements.md",
  "docs/releases/",
  "docs/images/deck.png",
]);
const all = (path: string) => files.has(path);

function href(target: string, from: string, exists = all) {
  return classifyTarget(target, { from, exists });
}

describe("the page set", () => {
  it("maps README.md to Home, which is generated and not copied", () => {
    expect(LINK_PAGES.get("README.md")).toBe("Home");
    expect(PAGES.some((page: { source: string }) => page.source === "README.md")).toBe(false);
  });

  it("leaves the engineering history out of the mirror", () => {
    expect(LINK_PAGES.has("docs/history/improvements.md")).toBe(false);
    expect(LINK_PAGES.has("docs/releases/v0.6.0.md")).toBe(false);
  });
});

describe("links to a mirrored document", () => {
  it("rewrites a docs/ path from the repository root", () => {
    expect(href("docs/user-guide.md", "README.md")).toMatchObject({
      kind: "wiki",
      href: "User-Guide",
    });
  });

  it("rewrites a sibling path", () => {
    expect(href("runtime-api.md", "docs/architecture.md")).toMatchObject({
      kind: "wiki",
      href: "Runtime-API",
    });
  });

  it("rewrites an explicit ./ path", () => {
    expect(href("./limitations.md", "docs/architecture.md")).toMatchObject({
      kind: "wiki",
      href: "Limitations",
    });
  });

  it("rewrites a path that goes up a directory", () => {
    expect(href("../design-system.md", "docs/contributing/triage.md")).toMatchObject({
      kind: "wiki",
      href: "Design-System",
    });
  });

  it("rewrites a path into a subdirectory", () => {
    expect(href("contributing/engine-rev.md", "docs/architecture.md")).toMatchObject({
      kind: "wiki",
      href: "Contributing-Engine-Rev",
    });
    expect(href("../contributing/backlog.md", "docs/contributing/triage.md")).toMatchObject({
      kind: "wiki",
      href: "Contributing-Backlog",
    });
    expect(href("docs/contributing/writing-style.md", "CONTRIBUTING.md")).toMatchObject({
      kind: "wiki",
      href: "Contributing-Writing-Style",
    });
  });

  it("rewrites the root documents", () => {
    expect(href("README.md", "CONTRIBUTING.md")).toMatchObject({ kind: "wiki", href: "Home" });
    expect(href("../README.md", "docs/architecture.md")).toMatchObject({
      kind: "wiki",
      href: "Home",
    });
    expect(href("CONTRIBUTING.md", "README.md")).toMatchObject({
      kind: "wiki",
      href: "Contributing",
    });
    expect(href("CHANGELOG.md", "README.md")).toMatchObject({ kind: "wiki", href: "Changelog" });
  });

  it("keeps the anchor in GitHub's slug form", () => {
    expect(href("docs/limitations.md#no-job-pump", "README.md")).toMatchObject({
      kind: "wiki",
      href: "Limitations#no-job-pump",
    });
    expect(href("../runtime-api.md#creatorui", "docs/contributing/triage.md")).toMatchObject({
      kind: "wiki",
      href: "Runtime-API#creatorui",
    });
  });
});

describe("links to any other path in the repository", () => {
  it("rewrites a source path to an absolute blob URL", () => {
    expect(href("engine/scope.ts", "docs/architecture.md")).toMatchObject({
      kind: "repo",
      href: `${BLOB}/engine/scope.ts`,
    });
  });

  it("rewrites a Markdown file the wiki does not mirror", () => {
    expect(href("../history/improvements.md", "docs/contributing/triage.md")).toMatchObject({
      kind: "repo",
      href: `${BLOB}/docs/history/improvements.md`,
    });
    expect(href(".claude/agents/macro-triage.md", "CONTRIBUTING.md")).toMatchObject({
      kind: "repo",
      href: `${BLOB}/.claude/agents/macro-triage.md`,
    });
  });

  it("turns a trailing line number into GitHub's #L form", () => {
    expect(href("sandbox/plugin.ts:13", "docs/architecture.md")).toMatchObject({
      kind: "repo",
      href: `${BLOB}/sandbox/plugin.ts#L13`,
    });
  });

  it("keeps an anchor on a repository path", () => {
    expect(href("scripts/ui-probe/README.md#adding-a-probe", "CONTRIBUTING.md")).toMatchObject({
      kind: "repo",
      href: `${BLOB}/scripts/ui-probe/README.md#adding-a-probe`,
    });
  });

  it("rewrites a directory to the tree view", () => {
    expect(href("docs/releases/", "README.md")).toMatchObject({
      kind: "repo",
      href: `${TREE}/docs/releases/`,
    });
  });
});

describe("links the rewriter leaves alone", () => {
  it("keeps an external link", () => {
    const target = "https://creator.lottiefiles.com";
    expect(href(target, "README.md")).toMatchObject({ kind: "external", href: target });
    expect(href("mailto:hello@example.com", "README.md")).toMatchObject({ kind: "external" });
  });

  it("keeps a link to a heading in the same page", () => {
    expect(href("#the-rule", "docs/contributing/engine-rev.md")).toMatchObject({ kind: "anchor" });
  });
});

describe("links the rewriter cannot classify", () => {
  it("reports a path that no longer exists", () => {
    const gone = href("engine/gone.ts", "docs/architecture.md", () => false);
    expect(gone.kind).toBe("unclassified");
    expect(gone.href).toBe("engine/gone.ts");
    expect(gone.why).toMatch(/no such path/);
  });

  it("reports a path that leaves the repository", () => {
    const outside = href("../../elsewhere.md", "docs/architecture.md");
    expect(outside.kind).toBe("unclassified");
    expect(outside.why).toMatch(/outside the repository/);
  });
});

describe("rewriteLinks over a document", () => {
  const source = [
    "# Architecture",
    "",
    "Read [`runtime-api.md`](runtime-api.md) and [the limits](limitations.md#roundness).",
    "The proxy boundary lives in [`sandbox/applier.ts`](sandbox/applier.ts:42).",
    "The host is [Creator](https://creator.lottiefiles.com).",
    "",
    "```md",
    "[`user-guide.md`](user-guide.md)",
    "```",
    "",
    "![the deck](docs/images/deck.png)",
  ].join("\n");

  const result = rewriteLinks(source, { from: "docs/architecture.md", exists: all });

  it("counts each link by kind", () => {
    expect(result.counts).toMatchObject({
      wiki: 2,
      repo: 2,
      external: 1,
      anchor: 0,
      unclassified: 0,
    });
    expect(result.unclassified).toEqual([]);
  });

  it("keeps the page's own H1", () => {
    expect(result.text.startsWith("# Architecture")).toBe(true);
  });

  it("rewrites the links in the body and keeps the link text", () => {
    expect(result.text).toContain("[`runtime-api.md`](Runtime-API)");
    expect(result.text).toContain("[the limits](Limitations#roundness)");
    expect(result.text).toContain(`[\`sandbox/applier.ts\`](${BLOB}/sandbox/applier.ts#L42)`);
    expect(result.text).toContain("[Creator](https://creator.lottiefiles.com)");
  });

  it("leaves a link inside a fenced block alone", () => {
    expect(result.text).toContain("[`user-guide.md`](user-guide.md)");
  });

  it("points an image at the raw URL, which a blob page cannot serve", () => {
    expect(result.text).toContain(
      "![the deck](https://github.com/inerds/macro-recorder-plugin/raw/main/docs/images/deck.png)",
    );
  });

  it("reports the line of a link it cannot classify", () => {
    const broken = rewriteLinks("ok\n\nsee [gone](engine/gone.ts).\n", {
      from: "docs/architecture.md",
      exists: () => false,
    });
    expect(broken.counts.unclassified).toBe(1);
    expect(broken.unclassified[0]).toMatchObject({ line: 3, target: "engine/gone.ts" });
    expect(broken.text).toContain("[gone](engine/gone.ts)");
  });
});
