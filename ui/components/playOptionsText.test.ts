/**
 * The badge and the pre-play sheet both read this line, so its shape is
 * asserted here rather than in either of them.
 */
import { describe, expect, it } from "vitest";

import { describePlayOptions } from "./playOptionsText";

describe("describePlayOptions", () => {
  it("reads as one lowercase line of settings", () => {
    expect(describePlayOptions({ repeat: 2, staggerFrames: 4, atPlayhead: true })).toBe(
      "repeat ×2 · stagger 4 frames · at playhead",
    );
  });

  it("says one frame, not one frames", () => {
    expect(describePlayOptions({ staggerFrames: 1 })).toBe("stagger 1 frame");
  });

  it("says nothing for a plain run", () => {
    expect(describePlayOptions({ repeat: 1, staggerFrames: 0, atPlayhead: false })).toBe("");
    expect(describePlayOptions(undefined)).toBe("");
  });
});
