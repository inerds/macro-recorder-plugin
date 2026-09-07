import { describe, expect, it } from "vitest";

import type { ScopeReport } from "../../engine/protocol";
import { ignoredText, scopeName } from "./scopeText";

const layers = (...names: (string | undefined)[]): ScopeReport => ({
  kind: "layers",
  layers: names.map((name, index) => ({
    id: `L${index + 1}`,
    ...(name ? { name } : {}),
  })),
});

describe("scopeName", () => {
  it("names a single layer", () => {
    expect(scopeName(layers("Layer A"))).toBe("Layer A");
  });

  it("names the first layer and counts the rest", () => {
    expect(scopeName(layers("Layer A", "Layer B", "Layer C"))).toBe("Layer A + 2 more");
  });

  it("falls back to a count when the layers have no names", () => {
    expect(scopeName(layers(undefined))).toBe("1 layer");
    expect(scopeName(layers(undefined, undefined, undefined))).toBe("3 layers");
  });

  it("says whole scene for scene scope, fallback scope, and nothing known", () => {
    expect(scopeName({ kind: "scene" })).toBe("whole scene");
    expect(scopeName({ kind: "scene", fallback: "unresolved" })).toBe("whole scene");
    expect(scopeName(null)).toBe("whole scene");
    expect(scopeName(undefined)).toBe("whole scene");
    // A layer scope with no layers is not recordable — never a count of none.
    expect(scopeName({ kind: "layers", layers: [] })).toBe("whole scene");
  });
});

describe("ignoredText", () => {
  it("is empty until something is ignored", () => {
    expect(ignoredText(0, layers("Layer A"))).toBe("");
    expect(ignoredText(-1, layers("Layer A"))).toBe("");
  });

  it("names the one recorded layer", () => {
    expect(ignoredText(1, layers("Layer A"))).toBe("1 change outside Layer A ignored");
    expect(ignoredText(2, layers("Layer A"))).toBe("2 changes outside Layer A ignored");
  });

  it("counts the layers past one rather than listing them", () => {
    expect(ignoredText(2, layers("Layer A", "Layer B", "Layer C"))).toBe(
      "2 changes outside the 3 recorded layers ignored",
    );
  });

  it("has a name for an unnamed layer and for scene scope", () => {
    expect(ignoredText(1, layers(undefined))).toBe("1 change outside the recorded layer ignored");
    // Scene scope ignores nothing, so this line is a safety net, not a state.
    expect(ignoredText(1, { kind: "scene" })).toBe("1 change outside the recording ignored");
  });
});
