import { describe, expect, it } from "vitest";

import { parseImportedMacro } from "./macro";

describe("parseImportedMacro — v3.1 fields", () => {
  it("keeps disabled flags and remaps param pins onto the regenerated step ids", () => {
    let n = 0;
    const makeId = () => `id${++n}`;
    const json = JSON.stringify({
      name: "M",
      steps: [
        { id: "old-a", kind: "transform", label: "a", payload: {}, disabled: true },
        { id: "old-b", kind: "transform", label: "b", payload: {}, disabled: false },
      ],
      params: [{ stepId: "old-b", label: "b" }, { stepId: "ghost", label: "x" }, "junk"],
    });
    const macro = parseImportedMacro(json, makeId);
    expect(macro.steps[0]!.disabled).toBe(true);
    expect("disabled" in macro.steps[1]!).toBe(false);
    expect(macro.params).toEqual([{ stepId: macro.steps[1]!.id, label: "b" }]);
  });

  it("omits params when none survive", () => {
    const macro = parseImportedMacro(
      JSON.stringify({ name: "M", steps: [], params: [{ stepId: "x", label: "x" }] }),
      () => "id",
    );
    expect(macro.params).toBeUndefined();
  });
});
