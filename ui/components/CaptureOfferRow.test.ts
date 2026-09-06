import { describe, expect, it } from "vitest";

import type { CaptureOffer } from "../../engine/protocol";
import { captureOfferKeys } from "./CaptureOfferRow";

const OFFER: CaptureOffer = {
  layerId: "L1",
  layerName: "Text 1",
  pathCount: 3,
  keyframeCount: 12,
  selectedCount: 2,
};

describe("captureOfferKeys", () => {
  it("keeps both keys on when there is something to add", () => {
    const keys = captureOfferKeys(OFFER, false);
    expect(keys.selected).toMatchObject({ shown: true, off: false, hint: undefined });
    expect(keys.all.off).toBe(false);
    // What "Add all keyframes" covers is in the card's sentence, so an
    // enabled key carries no tooltip of its own.
    expect(keys.all.hint).toBeUndefined();
  });

  it("turns a key off WITH its reason rather than hiding the reason", () => {
    // The reason has to survive: an off key keeps its place in the tab order
    // and says why, instead of a dead control with a tooltip nobody can open.
    const noSelection = captureOfferKeys({ ...OFFER, selectedCount: 0 }, false);
    expect(noSelection.selected.off).toBe(true);
    expect(noSelection.selected.hint).toBe(
      "Creator hasn't reported any selected keyframes to plugins",
    );

    const usedAll = captureOfferKeys(OFFER, true);
    expect(usedAll.all).toMatchObject({ off: true, hint: "Already added" });
  });

  it("hides the selected key only when the host reported no such surface", () => {
    const { selectedCount: _selectedCount, ...noSurface } = OFFER;
    expect(captureOfferKeys(noSurface, false).selected.shown).toBe(false);
    expect(captureOfferKeys({ ...OFFER, selectedCount: 0 }, false).selected.shown).toBe(true);
  });
});
