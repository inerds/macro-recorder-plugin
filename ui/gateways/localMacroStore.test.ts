import { describe, expect, it } from "vitest";

import type { Macro } from "../types";
import { LocalMacroStore } from "./localMacroStore";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

function makeMacro(name = "Bounce"): Macro {
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: Date.now(),
    steps: [
      { id: crypto.randomUUID(), kind: "fill", label: "Fill → red", payload: {} },
    ],
  };
}

describe("LocalMacroStore", () => {
  it("round-trips save and list", async () => {
    const store = new LocalMacroStore(memoryStorage());
    const macro = makeMacro();
    await store.save(macro);
    expect(await store.list()).toEqual([macro]);
  });

  it("renames and removes", async () => {
    const store = new LocalMacroStore(memoryStorage());
    const macro = makeMacro();
    await store.save(macro);
    await store.rename(macro.id, "Renamed");
    expect((await store.list())[0]?.name).toBe("Renamed");
    await store.remove(macro.id);
    expect(await store.list()).toEqual([]);
  });

  it("imports a valid macro with regenerated ids", async () => {
    const store = new LocalMacroStore(memoryStorage());
    const original = makeMacro("Shared");
    const imported = await store.importMacro(store.exportMacro(original));
    expect(imported.name).toBe("Shared");
    expect(imported.id).not.toBe(original.id);
    expect(imported.steps[0]?.id).not.toBe(original.steps[0]?.id);
    expect(imported.steps[0]?.label).toBe(original.steps[0]?.label);
    expect(await store.list()).toEqual([imported]);
  });

  it("rejects malformed JSON and wrong shapes", async () => {
    const store = new LocalMacroStore(memoryStorage());
    await expect(store.importMacro("not json {")).rejects.toThrow(
      "Not a valid JSON file",
    );
    await expect(store.importMacro('{"foo": 1}')).rejects.toThrow(
      "File is not a valid macro",
    );
    await expect(
      store.importMacro('{"name": "x", "steps": [{"kind": "nope"}]}'),
    ).rejects.toThrow("File is not a valid macro");
    expect(await store.list()).toEqual([]);
  });

  it("survives corrupted storage contents", async () => {
    const storage = memoryStorage();
    storage.setItem("macro-recorder:macros", "garbage{");
    const store = new LocalMacroStore(storage);
    expect(await store.list()).toEqual([]);
  });
});
