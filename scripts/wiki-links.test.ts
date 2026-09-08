import { describe, expect, it } from "vitest";
// The rewriter is plain ESM so `scripts/wiki-sync.mjs` can run it with no build
// step. This file is outside the three TypeScript projects for the same reason;
// `vitest.config.ts` includes it through the `scripts/**` glob.
import { LINK_PAGES, PAGES, classifyTarget, rewriteLinks, slug } from "./wiki-links.mjs";

const BLOB = "https://github.com/inerds/macro-recorder-plugin/blob/main";
const TREE = "https://github.com/inerds/macro-recorder-plugin/tree/main";

/** The repository, as far as these tests are concerned. */
const files = new Set([
  "README.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "docs/architecture.md",
  "docs/limitations.md",
  "docs/runtime-api.md",
  "docs/history/improvements.md",
  "docs/images/deck.png",
  "docs/releases/",
  "engine/scope.ts",
  "sandbox/applier.ts",
  "sandbox/plugin.ts",
  "scripts/ui-probe/README.md",
  ".claude/agents/macro-triage.md",
]);
const all = (path: string) => files.has(path);

function href(target: string, from: string, exists = all) {
  return classifyTarget(target, { from, exists });
}

describe("the page set", () => {
  it("mirrors the user guide, and nothing else", () => {
    expect(PAGES).toEqual([{ source: "docs/user-guide.md", page: "Home" }]);
  });

  it("keeps every other document out of the wiki", () => {
    for (const path of ["README.md", "CONTRIBUTING.md", "CHANGELOG.md", "docs/limitations.md"]) {
      expect(LINK_PAGES.has(path)).toBe(false);
    }
  });
});

describe("links to the user guide", () => {
  it("rewrites a docs/ path from the repository root", () => {
    expect(href("docs/user-guide.md", "README.md")).toMatchObject({ kind: "wiki", href: "Home" });
  });

  it("rewrites a sibling path", () => {
    expect(href("user-guide.md", "docs/architecture.md")).toMatchObject({
      kind: "wiki",
      href: "Home",
    });
  });

  it("rewrites an explicit ./ path and a path that goes up a directory", () => {
    expect(href("./user-guide.md", "docs/architecture.md")).toMatchObject({
      kind: "wiki",
      href: "Home",
    });
    expect(href("../user-guide.md", "docs/contributing/triage.md")).toMatchObject({
      kind: "wiki",
      href: "Home",
    });
  });

  it("keeps the anchor in GitHub's slug form", () => {
    expect(href("docs/user-guide.md#5-edit-a-steps-value", "README.md")).toMatchObject({
      kind: "wiki",
      href: "Home#5-edit-a-steps-value",
    });
  });
});

describe("links to a document the wiki does not mirror", () => {
  it("rewrites a sibling document to an absolute blob URL", () => {
    expect(href("runtime-api.md", "docs/user-guide.md")).toMatchObject({
      kind: "repo",
      href: `${BLOB}/docs/runtime-api.md`,
    });
  });

  it("keeps the anchor on that document", () => {
    expect(href("limitations.md#rounded-corners", "docs/user-guide.md")).toMatchObject({
      kind: "repo",
      href: `${BLOB}/docs/limitations.md#rounded-corners`,
    });
  });

  it("rewrites the root documents, README.md included", () => {
    expect(href("../README.md", "docs/user-guide.md")).toMatchObject({
      kind: "repo",
      href: `${BLOB}/README.md`,
    });
    expect(href("../CONTRIBUTING.md", "docs/user-guide.md")).toMatchObject({
      kind: "repo",
      href: `${BLOB}/CONTRIBUTING.md`,
    });
    expect(href("CHANGELOG.md", "README.md")).toMatchObject({
      kind: "repo",
      href: `${BLOB}/CHANGELOG.md`,
    });
  });

  it("rewrites a path into a subdirectory", () => {
    expect(href("docs/architecture.md", "CONTRIBUTING.md")).toMatchObject({
      kind: "repo",
      href: `${BLOB}/docs/architecture.md`,
    });
    expect(href("../history/improvements.md", "docs/contributing/triage.md")).toMatchObject({
      kind: "repo",
      href: `${BLOB}/docs/history/improvements.md`,
    });
    expect(href(".claude/agents/macro-triage.md", "CONTRIBUTING.md")).toMatchObject({
      kind: "repo",
      href: `${BLOB}/.claude/agents/macro-triage.md`,
    });
  });
});

describe("links to code", () => {
  it("rewrites a source path to an absolute blob URL", () => {
    expect(href("engine/scope.ts", "docs/user-guide.md")).toMatchObject({
      kind: "repo",
      href: `${BLOB}/engine/scope.ts`,
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
    expect(href(target, "docs/user-guide.md")).toMatchObject({ kind: "external", href: target });
    expect(href("mailto:hello@example.com", "docs/user-guide.md")).toMatchObject({
      kind: "external",
    });
  });

  it("keeps a link to a heading in the same page", () => {
    expect(href("#4-simplify", "docs/user-guide.md")).toMatchObject({ kind: "anchor" });
  });
});

describe("links the rewriter cannot classify", () => {
  it("reports a path that no longer exists", () => {
    const gone = href("engine/gone.ts", "docs/user-guide.md", () => false);
    expect(gone.kind).toBe("unclassified");
    expect(gone.href).toBe("engine/gone.ts");
    expect(gone.why).toMatch(/no such path/);
  });

  it("reports a path that leaves the repository", () => {
    const outside = href("../../elsewhere.md", "docs/user-guide.md");
    expect(outside.kind).toBe("unclassified");
    expect(outside.why).toMatch(/outside the repository/);
  });
});

describe("rewriteLinks over the guide", () => {
  const source = [
    "# Macro Recorder — user guide",
    "",
    "The limits are in [`limitations.md`](limitations.md#rounded-corners), and the",
    "shape of the code is in [`architecture.md`](architecture.md).",
    "Read [step 4](#4-simplify) first.",
    "The proxy boundary lives in [`sandbox/applier.ts`](../sandbox/applier.ts:42).",
    "The host is [Creator](https://creator.lottiefiles.com).",
    "",
    "```md",
    "[`runtime-api.md`](runtime-api.md)",
    "```",
    "",
    "![the deck](images/deck.png)",
  ].join("\n");

  const result = rewriteLinks(source, { from: "docs/user-guide.md", exists: all });

  it("counts each link by kind", () => {
    expect(result.counts).toMatchObject({
      wiki: 0,
      repo: 4,
      external: 1,
      anchor: 1,
      unclassified: 0,
    });
    expect(result.unclassified).toEqual([]);
  });

  it("keeps the page's own H1", () => {
    expect(result.text.startsWith("# Macro Recorder — user guide")).toBe(true);
  });

  it("rewrites the links in the body and keeps the link text", () => {
    expect(result.text).toContain(
      `[\`limitations.md\`](${BLOB}/docs/limitations.md#rounded-corners)`,
    );
    expect(result.text).toContain(`[\`architecture.md\`](${BLOB}/docs/architecture.md)`);
    expect(result.text).toContain(`[\`sandbox/applier.ts\`](${BLOB}/sandbox/applier.ts#L42)`);
    expect(result.text).toContain("[Creator](https://creator.lottiefiles.com)");
  });

  it("leaves a link to a heading on the same page alone", () => {
    expect(result.text).toContain("[step 4](#4-simplify)");
  });

  it("leaves a link inside a fenced block alone", () => {
    expect(result.text).toContain("[`runtime-api.md`](runtime-api.md)");
  });

  it("points an image at the raw URL, which a blob page cannot serve", () => {
    expect(result.text).toContain(
      "![the deck](https://github.com/inerds/macro-recorder-plugin/raw/main/docs/images/deck.png)",
    );
  });

  it("reports the line of a link it cannot classify", () => {
    const broken = rewriteLinks("ok\n\nsee [gone](engine/gone.ts).\n", {
      from: "docs/user-guide.md",
      exists: () => false,
    });
    expect(broken.counts.unclassified).toBe(1);
    expect(broken.unclassified[0]).toMatchObject({ line: 3, target: "engine/gone.ts" });
    expect(broken.text).toContain("[gone](engine/gone.ts)");
  });
});

describe("the section anchors the sidebar links to", () => {
  it("writes a numbered heading the way GitHub does", () => {
    expect(slug("1. Install and open")).toBe("1-install-and-open");
    expect(slug("11. Known limits")).toBe("11-known-limits");
  });

  it("drops the punctuation and keeps a number that is not ASCII", () => {
    expect(slug("5. Edit a step's value")).toBe("5-edit-a-steps-value");
    expect(slug("8. Parameters (values the macro asks for on play)")).toBe(
      "8-parameters-values-the-macro-asks-for-on-play",
    );
    expect(slug("3½. Turn existing animation into a macro")).toBe(
      "3½-turn-existing-animation-into-a-macro",
    );
  });

  it("leaves the two hyphens an em dash's spaces make", () => {
    expect(slug("Macro Recorder — user guide")).toBe("macro-recorder--user-guide");
  });

  it("reads the rendered words, not the Markdown", () => {
    expect(slug("Bump `ENGINE_REV` in the [protocol](engine/protocol.ts)")).toBe(
      "bump-engine_rev-in-the-protocol",
    );
  });
});
