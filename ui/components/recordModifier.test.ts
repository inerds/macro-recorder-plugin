import { describe, expect, it } from "vitest";

import { isExactActivation, isExactModifier } from "./recordModifier";

/** A keyboard event shaped the way the key's `onKeyDown` sees one. */
function key(name: string, altKey: boolean) {
  return { key: name, altKey } as never;
}

describe("isExactModifier", () => {
  it("reads Option on macOS and Alt on Windows as the same flag", () => {
    expect(isExactModifier({ altKey: true })).toBe(true);
    expect(isExactModifier({ altKey: false })).toBe(false);
  });
});

describe("isExactActivation", () => {
  it("takes Enter and Space with the modifier", () => {
    expect(isExactActivation(key("Enter", true))).toBe(true);
    expect(isExactActivation(key(" ", true))).toBe(true);
  });

  it("leaves a plain Enter or Space to the key's own click", () => {
    expect(isExactActivation(key("Enter", false))).toBe(false);
    expect(isExactActivation(key(" ", false))).toBe(false);
  });

  it("ignores every other key, modifier or not", () => {
    expect(isExactActivation(key("Tab", true))).toBe(false);
    expect(isExactActivation(key("a", true))).toBe(false);
  });
});
