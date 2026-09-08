import { describe, expect, it } from "vitest";
// Plain ESM, no build step — the same reason `wiki-links.mjs` sits outside
// the three TypeScript projects. `vitest.config.ts` picks this file up
// through the `scripts/**` glob.
import { computeNextRev, decide, hasBump, isGated } from "./engine-rev-gate.mjs";

const TODAY = "2026-09-08";
const CURRENT_REV = "2026-09-08.2";

const BUMPED_DIFF = [
  "diff --git a/engine/protocol.ts b/engine/protocol.ts",
  "--- a/engine/protocol.ts",
  "+++ b/engine/protocol.ts",
  '-export const ENGINE_REV = "2026-09-08.2";',
  '+export const ENGINE_REV = "2026-09-08.3";',
].join("\n");

const UNRELATED_DIFF = [
  "diff --git a/engine/protocol.ts b/engine/protocol.ts",
  "--- a/engine/protocol.ts",
  "+++ b/engine/protocol.ts",
  "-export const PROTOCOL_VERSION = 3;",
  "+export const PROTOCOL_VERSION = 4;",
].join("\n");

describe("isGated", () => {
  it("gates a sandbox/ source file", () => {
    expect(isGated("sandbox/store.ts")).toBe(true);
  });

  it("gates an engine/ source file", () => {
    expect(isGated("engine/diff.ts")).toBe(true);
  });

  it("does not gate a file outside sandbox/ and engine/", () => {
    expect(isGated("ui/components/deck/Deck.tsx")).toBe(false);
  });

  it("does not gate a *.test.ts file", () => {
    expect(isGated("sandbox/store.test.ts")).toBe(false);
  });

  it("does not gate an engine/testing/ fixture", () => {
    expect(isGated("engine/testing/macros/v1-add-fill.json")).toBe(false);
  });

  it("does not gate a sandbox/testing/ fixture", () => {
    expect(isGated("sandbox/testing/replay.ts")).toBe(false);
  });
});

describe("hasBump", () => {
  it("finds an added ENGINE_REV line", () => {
    expect(hasBump(BUMPED_DIFF)).toBe(true);
  });

  it("ignores an unrelated added line, including the +++ file header", () => {
    expect(hasBump(UNRELATED_DIFF)).toBe(false);
  });

  it("ignores an empty diff", () => {
    expect(hasBump("")).toBe(false);
  });
});

describe("computeNextRev", () => {
  it("bumps the counter within the same day", () => {
    expect(computeNextRev("2026-09-08.2", "2026-09-08")).toBe("2026-09-08.3");
  });

  it("resets the counter to .1 on a new day", () => {
    expect(computeNextRev("2026-09-08.4", "2026-09-09")).toBe("2026-09-09.1");
  });

  it("falls back to <today>.1 when the current rev is not in the dated shape", () => {
    expect(computeNextRev("not-a-rev", "2026-09-08")).toBe("2026-09-08.1");
  });
});

describe("decide", () => {
  it("skips quietly when nothing changed is gated", () => {
    const result = decide({
      changed: ["README.md", "ui/components/deck/Deck.tsx"],
      protocolDiff: "",
      today: TODAY,
      currentRev: CURRENT_REV,
    });
    expect(result).toEqual({ verdict: "skip", offenders: [], nextRev: null, message: "" });
  });

  it("skips a test-only change under a gated directory", () => {
    const result = decide({
      changed: ["sandbox/store.test.ts"],
      protocolDiff: "",
      today: TODAY,
      currentRev: CURRENT_REV,
    });
    expect(result.verdict).toBe("skip");
  });

  it("skips a fixture under engine/testing/", () => {
    const result = decide({
      changed: ["engine/testing/macros/v2-set-static.json"],
      protocolDiff: "",
      today: TODAY,
      currentRev: CURRENT_REV,
    });
    expect(result.verdict).toBe("skip");
  });

  it("fails a sandbox/ change with no ENGINE_REV bump", () => {
    const result = decide({
      changed: ["sandbox/store.ts"],
      protocolDiff: "",
      today: TODAY,
      currentRev: CURRENT_REV,
    });
    expect(result.verdict).toBe("fail");
    expect(result.offenders).toEqual(["sandbox/store.ts"]);
    expect(result.nextRev).toBe("2026-09-08.3");
    expect(result.message).toContain("sandbox/store.ts");
    expect(result.message).toContain("Creator caches plugin.js");
    expect(result.message).toContain('current:    "2026-09-08.2"');
    expect(result.message).toContain('suggested:  "2026-09-08.3"');
    expect(result.message).toContain("SKIP_ENGINE_REV=1 git commit");
  });

  it("fails an engine/ change whose protocol.ts diff touches something else", () => {
    const result = decide({
      changed: ["engine/diff.ts", "engine/protocol.ts"],
      protocolDiff: UNRELATED_DIFF,
      today: TODAY,
      currentRev: CURRENT_REV,
    });
    expect(result.verdict).toBe("fail");
  });

  it("passes a sandbox/ change that also bumps ENGINE_REV", () => {
    const result = decide({
      changed: ["sandbox/store.ts", "engine/protocol.ts"],
      protocolDiff: BUMPED_DIFF,
      today: TODAY,
      currentRev: CURRENT_REV,
    });
    expect(result.verdict).toBe("pass");
    expect(result.offenders).toEqual(["sandbox/store.ts", "engine/protocol.ts"]);
    expect(result.message).toContain("gate passed");
  });

  it("suggests the same-day next counter", () => {
    const result = decide({
      changed: ["sandbox/store.ts"],
      protocolDiff: "",
      today: "2026-09-08",
      currentRev: "2026-09-08.2",
    });
    expect(result.nextRev).toBe("2026-09-08.3");
  });

  it("suggests .1 on a new day", () => {
    const result = decide({
      changed: ["sandbox/store.ts"],
      protocolDiff: "",
      today: "2026-09-09",
      currentRev: "2026-09-08.2",
    });
    expect(result.nextRev).toBe("2026-09-09.1");
  });

  it("lists every offender when more than one gated file changed", () => {
    const result = decide({
      changed: ["sandbox/store.ts", "engine/diff.ts", "README.md"],
      protocolDiff: "",
      today: TODAY,
      currentRev: CURRENT_REV,
    });
    expect(result.offenders).toEqual(["sandbox/store.ts", "engine/diff.ts"]);
  });
});

// The SKIP_ENGINE_REV bypass is read from process.env by the CLI wrapper in
// run(), not by decide() — decide() stays a pure function of the diff. The
// bypass is exercised in the manual verification pass (a real hook run with
// the env set), not here: it is a global, mutate-the-process concern, not a
// case the pure rule needs to cover.
