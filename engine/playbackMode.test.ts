import { describe, expect, it } from "vitest";

import type { MacroStep } from "./macro";
import { describePlaybackMode, playbackModeHint } from "./playbackMode";
import { buildStep, type StepPayload } from "./steps";

function spec(nodeId: string, nodeType = "SHAPE_LAYER") {
  return {
    nodeId,
    nodeType,
    props: {},
    plain: {},
    fills: [],
    strokes: [],
    masks: [],
    shapes: [],
  };
}

function edit(layerId: string, path: (string | number)[] = ["position"]): MacroStep {
  return buildStep({
    op: "set-static",
    path,
    before: 0,
    after: 1,
    layer: { id: layerId, name: layerId },
  } as StepPayload);
}

describe("describePlaybackMode", () => {
  it("one touched layer is a retargetable macro", () => {
    expect(describePlaybackMode({ steps: [edit("L1"), edit("L1", ["rotation"])] })).toEqual({
      mode: "targets",
      layerCount: 1,
    });
  });

  it("no layer binding at all still counts as targets", () => {
    expect(describePlaybackMode({ steps: [] })).toEqual({ mode: "targets", layerCount: 0 });
  });

  it("two pre-existing layers make it a scene script", () => {
    expect(describePlaybackMode({ steps: [edit("L1"), edit("L2")] })).toEqual({
      mode: "scene",
      layerCount: 2,
    });
  });

  it("a duplicate of the touched layer stays retargetable", () => {
    const steps = [
      edit("L1"),
      buildStep({
        op: "add-layer",
        spec: spec("L2"),
        cloneOf: { id: "L1", name: "L1" },
      } as StepPayload),
      edit("L2"),
    ];
    expect(describePlaybackMode({ steps })).toEqual({ mode: "targets", layerCount: 1 });
  });

  it("a fresh layer, a removal or a reorder forces a scene script", () => {
    const fresh = buildStep({ op: "add-layer", spec: spec("N1") } as StepPayload);
    expect(describePlaybackMode({ steps: [fresh] }).mode).toBe("scene");

    const removal = buildStep({
      op: "remove-layer",
      layer: { id: "L1", name: "L1" },
    } as StepPayload);
    expect(describePlaybackMode({ steps: [removal] })).toEqual({ mode: "scene", layerCount: 1 });

    const reorder = buildStep({ op: "reorder-layers", order: [1, 0] } as StepPayload);
    expect(describePlaybackMode({ steps: [reorder] }).mode).toBe("scene");
  });

  it("ignores disabled steps — they never reach the sandbox", () => {
    const steps = [edit("L1"), { ...edit("L2"), disabled: true as const }];
    expect(describePlaybackMode({ steps })).toEqual({ mode: "targets", layerCount: 1 });
  });
});

describe("playbackModeHint", () => {
  it("names the selection for targets mode and the layer count for scene mode", () => {
    expect(playbackModeHint({ mode: "targets", layerCount: 1 })).toBe(
      "Applies to selected layers, or the recorded one",
    );
    expect(playbackModeHint({ mode: "scene", layerCount: 3 })).toBe(
      "Scene script — finds 3 layers by name",
    );
    expect(playbackModeHint({ mode: "scene", layerCount: 1 })).toBe(
      "Scene script — finds 1 layer by name",
    );
  });
});
