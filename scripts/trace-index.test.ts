import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// The index is plain ESM so `scripts/traces.mjs` and `scripts/trace-server.ts`
// can run it with no build step. This file sits outside the three TypeScript
// projects for the same reason; `vitest.config.ts` includes it through the
// `scripts/**` glob.
import {
  INDEX_FILE,
  appendEntry,
  atFromFile,
  currentEngineRev,
  formatLine,
  indexLineFor,
  kindOf,
  parseIndex,
  parseProcessed,
  rebuild,
  slugOf,
  stale,
  tally,
  unprocessed,
} from "./trace-index.mjs";

const REV = "2026-09-08.2";

/** A bundle in the shape `ui/dev/trace.ts` flushes. */
function bundle(label: string, endedAt: number, extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    label,
    startedAt: endedAt - 1000,
    endedAt,
    env: { inIframe: true, sandboxRev: REV, uiRev: REV },
    dropped: 0,
    events: [],
    ...extra,
  };
}

/** The name `scripts/trace-server.ts` gives a bundle it just wrote. */
function nameFor(endedAt: number, label: string) {
  const stamp = new Date(endedAt).toISOString().replace(/[:.]/g, "-").slice(0, 23);
  return `${stamp}_${label.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 60)}.json`;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "macro-traces-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, text: string) {
  writeFileSync(join(dir, name), text, "utf8");
  return { file: name, bytes: Buffer.byteLength(text) };
}

describe("the index line", () => {
  it("carries the fields triage reads before it opens a bundle", () => {
    const at = Date.parse("2026-09-08T02:19:34.375Z");
    const file = nameFor(at, "record");
    expect(indexLineFor(bundle("record", at), { file, bytes: 4096 })).toEqual({
      file,
      at: "2026-09-08T02:19:34.375Z",
      kind: "record",
      label: "record",
      sandboxRev: REV,
      uiRev: REV,
      bytes: 4096,
    });
  });

  it("reads a playback run's kind off the label the gateway flushed", () => {
    const at = Date.parse("2026-09-08T02:20:00.000Z");
    const entry = indexLineFor(bundle("playback-Spin the badge", at), {
      file: nameFor(at, "playback-Spin the badge"),
      bytes: 10,
    });
    expect(entry.kind).toBe("playback");
    expect(entry.label).toBe("playback-Spin the badge");
  });

  it("keeps a failed recording apart from a clean one", () => {
    expect(kindOf("record")).toBe("record");
    expect(kindOf("record-failed")).toBe("record-failed");
    expect(kindOf("manual")).toBe("manual");
    expect(kindOf("something else")).toBe("other");
    expect(kindOf(undefined)).toBe("other");
  });

  it("counts the steps a recording emitted, tick by tick", () => {
    const at = Date.parse("2026-09-08T03:00:00.000Z");
    const events = [
      { seq: 0, t: 1, kind: "rpc-request", data: { method: "record.start" } },
      { seq: 1, t: 2, kind: "step-recorded", data: { seq: 1, steps: [{}, {}] } },
      { seq: 2, t: 3, kind: "step-recorded", data: { final: true, steps: [{}] } },
    ];
    const entry = indexLineFor(bundle("record", at, { events }), { file: "a.json", bytes: 1 });
    expect(entry.steps).toBe(3);
    expect(entry.failures).toBeUndefined();
  });

  it("counts a playback's steps and its failures", () => {
    const at = Date.parse("2026-09-08T03:10:00.000Z");
    const events = [
      { seq: 0, t: 1, kind: "playback-event", data: { index: 0, failures: [], notes: [] } },
      { seq: 1, t: 2, kind: "playback-event", data: { index: 1, failures: [{}, {}] } },
      { seq: 2, t: 3, kind: "rpc-error", data: { method: "playback.step", error: "timeout" } },
    ];
    const entry = indexLineFor(bundle("playback-Wiggle", at, { events }), {
      file: "b.json",
      bytes: 1,
    });
    expect(entry.steps).toBe(2);
    expect(entry.failures).toBe(3);
  });

  it("leaves both counts out when nothing in the bundle could report one", () => {
    expect(tally([{ kind: "rpc-request", data: {} }])).toEqual({});
    expect(tally(undefined)).toEqual({});
    // A clean playback still reports zero, so a 0 never means "not measured".
    expect(tally([{ kind: "playback-event", data: { failures: [] } }])).toEqual({
      steps: 1,
      failures: 0,
    });
  });

  it("falls back to the filename when the bundle lost its label or its clock", () => {
    const file = "2026-09-08T02-19-34-375_playback-Spin-the-badge.json";
    const entry = indexLineFor({ env: {} }, { file, bytes: 7 });
    expect(entry).toEqual({
      file,
      at: "2026-09-08T02:19:34.375Z",
      kind: "playback",
      label: "playback-Spin-the-badge",
      sandboxRev: null,
      uiRev: null,
      bytes: 7,
    });
  });

  it("reverses the filename stamp the trace server writes", () => {
    const at = Date.parse("2026-09-08T02:19:34.375Z");
    expect(atFromFile(nameFor(at, "record"))).toBe("2026-09-08T02:19:34.375Z");
    expect(slugOf(nameFor(at, "playback-A B"))).toBe("playback-A-B");
    expect(atFromFile("not-a-trace.json")).toBeNull();
    expect(slugOf("no-underscore.json")).toBe("no-underscore");
  });
});

describe("rebuild", () => {
  it("indexes every bundle in the directory, oldest first", () => {
    const first = Date.parse("2026-09-08T01:00:00.000Z");
    const second = Date.parse("2026-09-08T02:00:00.000Z");
    write(nameFor(second, "record"), JSON.stringify(bundle("record", second)));
    write(nameFor(first, "manual"), JSON.stringify(bundle("manual", first)));
    const entries = rebuild(dir);
    expect(entries.map((entry: { kind: string }) => entry.kind)).toEqual(["manual", "record"]);
    expect(entries[0].bytes).toBeGreaterThan(0);
  });

  it("records a malformed bundle rather than throwing on it", () => {
    const at = Date.parse("2026-09-08T01:00:00.000Z");
    write(nameFor(at, "record"), JSON.stringify(bundle("record", at)));
    write("2026-09-08T01-30-00-000_truncated.json", '{"version":1,"label":"rec');
    const entries = rebuild(dir);
    expect(entries).toHaveLength(2);
    const broken = entries.find((entry: { file: string }) => entry.file.includes("truncated"));
    expect(broken.error).toEqual(expect.any(String));
    expect(broken.at).toBeUndefined();
    // The healthy bundle beside it is still indexed.
    expect(entries.find((entry: { kind?: string }) => entry.kind === "record")).toBeTruthy();
  });

  it("does not read a bundle over the size cap", () => {
    const at = Date.parse("2026-09-08T01:00:00.000Z");
    const { file } = write(nameFor(at, "record"), JSON.stringify(bundle("record", at)));
    const [entry] = rebuild(dir, { maxBytes: 8 });
    expect(entry.file).toBe(file);
    expect(entry.error).toContain("larger than 8 bytes");
  });

  it("ignores the index itself and anything that is not a bundle", () => {
    const at = Date.parse("2026-09-08T01:00:00.000Z");
    write(nameFor(at, "record"), JSON.stringify(bundle("record", at)));
    write(INDEX_FILE, "{}\n");
    write(".processed", "x\n");
    expect(rebuild(dir)).toHaveLength(1);
  });

  it("returns nothing for a directory that does not exist", () => {
    expect(rebuild(join(dir, "missing"))).toEqual([]);
  });
});

describe("the index file", () => {
  it("appends one line per bundle and never rewrites the ones before it", () => {
    const first = Date.parse("2026-09-08T01:00:00.000Z");
    const second = Date.parse("2026-09-08T02:00:00.000Z");
    const nested = join(dir, "new");
    appendEntry(nested, indexLineFor(bundle("record", first), { file: "a.json", bytes: 1 }));
    appendEntry(nested, indexLineFor(bundle("manual", second), { file: "b.json", bytes: 2 }));
    const text = readFileSync(join(nested, INDEX_FILE), "utf8");
    expect(text.trimEnd().split("\n")).toHaveLength(2);
    const entries = parseIndex(text);
    expect(entries.map((entry: { file: string }) => entry.file)).toEqual(["a.json", "b.json"]);
  });

  it("skips a blank or half-written last line", () => {
    const good = formatLine({ file: "a.json", at: "2026-09-08T01:00:00.000Z" });
    expect(parseIndex(`${good}\n${good}{"file":"b.js`)).toHaveLength(2);
    expect(parseIndex("")).toEqual([]);
    // A JSON line that is not an object is not an entry.
    expect(parseIndex("[1,2]\n3\n")).toEqual([]);
  });
});

describe("stale", () => {
  const entries = [
    { file: "a.json", at: "2026-09-08T01:00:00.000Z", sandboxRev: REV },
    { file: "b.json", at: "2026-09-07T01:00:00.000Z", sandboxRev: "2026-09-07.2" },
    { file: "c.json", at: "2026-09-07T02:00:00.000Z", sandboxRev: "2026-09-07.2" },
    { file: "d.json", at: "2026-09-06T01:00:00.000Z", sandboxRev: "2026-09-06.4" },
    { file: "e.json", at: "2026-09-05T01:00:00.000Z", sandboxRev: null },
    { file: "f.json", bytes: 0, error: "unreadable" },
  ];

  it("splits the traces by the revision that captured them", () => {
    const split = stale(entries, REV);
    expect(split.current.map((entry: { file: string }) => entry.file)).toEqual(["a.json"]);
    expect(split.stale.map((entry: { file: string }) => entry.file)).toEqual([
      "b.json",
      "c.json",
      "d.json",
    ]);
    expect(split.unknown.map((entry: { file: string }) => entry.file)).toEqual([
      "e.json",
      "f.json",
    ]);
  });

  it("groups the stale traces by revision, newest revision first", () => {
    const { groups } = stale(entries, REV);
    expect(groups.map((group: { rev: string; count: number }) => [group.rev, group.count])).toEqual(
      [
        ["2026-09-07.2", 2],
        ["2026-09-06.4", 1],
      ],
    );
    // Newest trace first inside a group.
    expect(groups[0].entries.map((entry: { file: string }) => entry.file)).toEqual([
      "c.json",
      "b.json",
    ]);
  });

  it("finds nothing stale when every trace is on the current revision", () => {
    const split = stale([entries[0]], REV);
    expect(split.stale).toEqual([]);
    expect(split.groups).toEqual([]);
  });

  it("reads the current revision out of engine/protocol.ts", () => {
    expect(currentEngineRev()).toMatch(/^\d{4}-\d\d-\d\d\.\d+$/);
  });
});

describe("unprocessed", () => {
  const entries = [
    { file: "a.json", at: "2026-09-08T01:00:00.000Z" },
    { file: "b.json", at: "2026-09-08T03:00:00.000Z" },
    { file: "c.json", at: "2026-09-08T02:00:00.000Z" },
  ];

  it("lists what no triage run has claimed, newest first", () => {
    const open = unprocessed(entries, "a.json\n");
    expect(open.map((entry: { file: string }) => entry.file)).toEqual(["b.json", "c.json"]);
  });

  it("reads the ledger's blank lines, comments, and path prefixes", () => {
    expect([...parseProcessed("\n# a note\ntraces/a.json\n  b.json  \n")]).toEqual([
      "a.json",
      "b.json",
    ]);
    expect(unprocessed(entries, "traces/b.json\n")).toHaveLength(2);
  });

  it("lists everything when there is no ledger", () => {
    expect(unprocessed(entries, "")).toHaveLength(3);
    expect(unprocessed(entries, undefined)[0].file).toBe("b.json");
  });
});

describe("the traces directory", () => {
  it("indexes bundles written under a directory the server had to create", () => {
    const nested = join(dir, "deep", "traces");
    mkdirSync(nested, { recursive: true });
    const at = Date.parse("2026-09-08T01:00:00.000Z");
    writeFileSync(
      join(nested, nameFor(at, "record")),
      JSON.stringify(bundle("record", at)),
      "utf8",
    );
    expect(rebuild(nested)).toHaveLength(1);
  });
});
