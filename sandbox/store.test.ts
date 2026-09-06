/**
 * `saveMacro`'s failure wording, against a stubbed `creator` global — the
 * same setup sandbox/recorder.test.ts uses.
 *
 * "Storage full — delete a macro first" sends the user to delete their own
 * work, so it must only appear when the host actually named the cap. Every
 * other rejection has to arrive with the host's own words or a trace of it
 * is undiagnosable.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Macro } from "../engine/macro";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const macro: Macro = {
  id: "m1",
  name: "Demo",
  createdAt: 0,
  steps: [],
};

/** Fresh module per test: the used-quota reading is cached at module level. */
async function loadStore(clientStorage: Record<string, unknown>) {
  (globalThis as Any).creator = { clientStorage };
  vi.resetModules();
  return import("./store");
}

afterEach(() => {
  delete (globalThis as Any).creator;
});

describe("saveMacro failure wording", () => {
  it("says the store is full when the host names the quota", async () => {
    const { saveMacro } = await loadStore({
      set: () => Promise.reject(new Error("Quota exceeded")),
      usedQuota: () => Promise.resolve(4096),
    });
    await expect(saveMacro(macro)).rejects.toThrow("Storage full — delete a macro first");
  });

  it("surfaces the host's own message for every other rejection", async () => {
    const { saveMacro } = await loadStore({
      set: () => Promise.reject(new Error("Value is not structured-cloneable")),
      usedQuota: () => Promise.resolve(4096),
    });
    await expect(saveMacro(macro)).rejects.toThrow("Value is not structured-cloneable");
  });

  it("does not read a quota failure into an unrelated storage error", async () => {
    const { saveMacro } = await loadStore({
      set: () => Promise.reject(new Error("plugin storage unavailable")),
      usedQuota: () => Promise.resolve(4096),
    });
    await expect(saveMacro(macro)).rejects.toThrow("plugin storage unavailable");
  });

  it("falls back to a plain message when the host rejects with nothing", async () => {
    const { saveMacro } = await loadStore({
      set: () => Promise.reject(new Error("")),
    });
    await expect(saveMacro(macro)).rejects.toThrow("Could not save the macro");
  });
});

describe("lastUsedQuota", () => {
  it("caches whatever the host last reported", async () => {
    const { lastUsedQuota, saveMacro } = await loadStore({
      set: () => Promise.resolve(),
      usedQuota: () => Promise.resolve(2048),
    });
    await saveMacro(macro);
    expect(lastUsedQuota()).toBe(2048);
  });

  it("stays undefined on a host without the surface", async () => {
    const { lastUsedQuota, saveMacro } = await loadStore({
      set: () => Promise.resolve(),
    });
    await saveMacro(macro);
    expect(lastUsedQuota()).toBeUndefined();
  });
});
