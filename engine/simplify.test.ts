import { describe, expect, it } from "vitest";

import type { MacroStep } from "./macro";
import { payloadClass } from "./operator";
import { simplifySteps } from "./simplify";
import { buildStep, type StepPayload } from "./steps";

const layer = { id: "L1", name: "Rect" };

function stat(
  path: (string | number)[],
  before: unknown,
  after: unknown,
  extra: object = {},
): MacroStep {
  return buildStep({ op: "set-static", path, before, after, layer, ...extra } as StepPayload);
}

function kfs(
  parts: Partial<Extract<StepPayload, { op: "keyframes" }>>,
  path: (string | number)[] = ["position"],
): MacroStep {
  return buildStep({ op: "keyframes", path, added: [], removed: [], changed: [], layer, ...parts });
}

describe("simplifySteps — static runs", () => {
  it("collapses a drag's micro-steps into first → last", () => {
    const steps = [
      stat(["position"], { x: 0, y: 0 }, { x: 10, y: 0 }),
      stat(["position"], { x: 10, y: 0 }, { x: 40, y: 0 }),
      stat(["position"], { x: 40, y: 0 }, { x: 100, y: 0 }),
    ];
    const out = simplifySteps(steps);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe(steps[0]!.id);
    expect(out[0]!.payload).toMatchObject({ before: { x: 0, y: 0 }, after: { x: 100, y: 0 } });
    // A position step adds, and the label says so (engine/operator.ts).
    expect(out[0]!.label).toBe("Rect · Transform · position.x +100");
  });

  it("drops a run whose net effect is nothing", () => {
    const out = simplifySteps([
      stat(["rotation"], 0, 45),
      stat(["scale"], { x: 1, y: 1 }, { x: 2, y: 2 }),
      stat(["rotation"], 45, 0),
    ]);
    expect(out.map((s) => (s.payload as { path: unknown[] }).path)).toEqual([["scale"]]);
  });

  it("merges across steps on OTHER properties but not across structural ops", () => {
    const addShape = buildStep({
      op: "add-shape",
      parentPath: ["shapes"],
      spec: {
        nodeId: "n",
        nodeType: "RECTANGLE",
        props: {},
        plain: {},
        fills: [],
        strokes: [],
        masks: [],
        shapes: [],
      },
      layer,
    });
    const out = simplifySteps([
      stat(["opacity"], 100, 80),
      stat(["rotation"], 0, 10),
      stat(["opacity"], 80, 50),
      addShape,
      stat(["opacity"], 50, 20),
    ]);
    expect(out).toHaveLength(4);
    expect(out[0]!.payload).toMatchObject({ path: ["opacity"], before: 100, after: 50 });
    expect(out[3]!.payload).toMatchObject({ path: ["opacity"], before: 50, after: 20 });
  });

  it("keeps a static edit and a keyframe edit on the same property separate", () => {
    const out = simplifySteps([
      stat(["rotation"], 0, 10),
      kfs({ added: [{ frame: 0, value: 10 }] }, ["rotation"]),
      stat(["rotation"], 10, 20),
    ]);
    expect(out).toHaveLength(3);
  });

  it("never merges into or across a disabled step, and keys runs per layer", () => {
    const disabled = { ...stat(["rotation"], 10, 20), disabled: true as const };
    const other = buildStep({
      op: "set-static",
      path: ["rotation"],
      before: 0,
      after: 5,
      layer: { id: "L2" },
    });
    const out = simplifySteps([
      stat(["rotation"], 0, 10),
      disabled,
      other,
      stat(["rotation"], 20, 30),
    ]);
    expect(out).toHaveLength(4);
    expect(out[1]).toBe(disabled);
  });

  it("passes unknown payloads through untouched", () => {
    const mock: MacroStep = { id: "m", kind: "other", label: "mock", payload: "opaque" };
    expect(simplifySteps([mock, mock])).toEqual([mock, mock]);
  });
});

describe("simplifySteps — scene settings", () => {
  function sceneStep(key: string, before: unknown, after: unknown): MacroStep {
    return buildStep({ op: "set-scene", key, before, after } as StepPayload);
  }

  it("collapses a dragged scene setting into first → last, keyed per setting", () => {
    const out = simplifySteps([
      sceneStep("framerate", 30, 40),
      sceneStep("size", { width: 1920, height: 1080 }, { width: 1500, height: 1080 }),
      sceneStep("framerate", 40, 60),
      sceneStep("size", { width: 1500, height: 1080 }, { width: 1080, height: 1080 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.payload).toMatchObject({
      op: "set-scene",
      key: "framerate",
      before: 30,
      after: 60,
    });
    expect(out[1]!.payload).toMatchObject({
      op: "set-scene",
      key: "size",
      before: { width: 1920, height: 1080 },
      after: { width: 1080, height: 1080 },
    });
  });

  it("drops a scene setting run whose net effect is nothing", () => {
    const out = simplifySteps([sceneStep("duration", 5, 8), sceneStep("duration", 8, 5)]);
    expect(out).toEqual([]);
  });
});

describe("simplifySteps — keyframe folding", () => {
  it("folds added@f + changed@f chains into one add with the final value", () => {
    const out = simplifySteps([
      kfs({ added: [{ frame: 30, value: { x: 1, y: 0 } }] }),
      kfs({
        changed: [
          {
            before: { frame: 30, value: { x: 1, y: 0 } },
            after: { frame: 30, value: { x: 5, y: 0 } },
          },
        ],
      }),
      kfs({
        changed: [
          {
            before: { frame: 30, value: { x: 5, y: 0 } },
            after: { frame: 30, value: { x: 9, y: 0 } },
          },
        ],
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.payload).toMatchObject({
      added: [{ frame: 30, value: { x: 9, y: 0 } }],
      changed: [],
    });
    expect(out[0]!.label).toBe("Rect · Keyframe · position @ 30");
  });

  it("chains of changes keep the first before and the last after, following moves", () => {
    const out = simplifySteps([
      kfs({ changed: [{ before: { frame: 10, value: 0 }, after: { frame: 20, value: 0 } }] }),
      kfs({ changed: [{ before: { frame: 20, value: 0 }, after: { frame: 25, value: 3 } }] }),
    ]);
    expect(out[0]!.payload).toMatchObject({
      changed: [{ before: { frame: 10, value: 0 }, after: { frame: 25, value: 3 } }],
    });
  });

  it("an add then a remove of the same frame cancels out; a round-trip change drops", () => {
    const out = simplifySteps([
      kfs({ added: [{ frame: 30, value: 1 }] }),
      kfs({ removed: [{ frame: 30, value: 1 }] }),
      kfs({ changed: [{ before: { frame: 0, value: 0 }, after: { frame: 0, value: 7 } }] }),
      kfs({ changed: [{ before: { frame: 0, value: 7 }, after: { frame: 0, value: 0 } }] }),
    ]);
    expect(out).toHaveLength(0);
  });

  it("remove then re-add at a frame becomes an in-place change", () => {
    const out = simplifySteps([
      kfs({ removed: [{ frame: 30, value: 1 }] }),
      kfs({ added: [{ frame: 30, value: 2 }] }),
    ]);
    expect(out[0]!.payload).toMatchObject({
      added: [],
      removed: [],
      changed: [{ before: { frame: 30, value: 1 }, after: { frame: 30, value: 2 } }],
    });
  });

  it("removing a keyframe a prior change produced removes the original", () => {
    const out = simplifySteps([
      kfs({ changed: [{ before: { frame: 10, value: 0 }, after: { frame: 20, value: 0 } }] }),
      kfs({ removed: [{ frame: 20, value: 0 }] }),
    ]);
    expect(out[0]!.payload).toMatchObject({ removed: [{ frame: 10, value: 0 }], changed: [] });
  });
});

describe("simplifySteps — the merged step's formula", () => {
  const place = { x: { scale: 0, offset: 100 }, y: { scale: 0, offset: 0 } };
  const shift = { x: { scale: 1, offset: 90 }, y: { scale: 1, offset: 0 } };

  it("keeps an explicit `apply` from the last step of the run", () => {
    const out = simplifySteps([
      stat(["position"], { x: 0, y: 0 }, { x: 10, y: 0 }),
      stat(["position"], { x: 10, y: 0 }, { x: 100, y: 0 }, { apply: place }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.payload).toMatchObject({ after: { x: 100, y: 0 }, apply: place });
  });

  it("keeps an explicit `apply` set only on the first step of the run", () => {
    const out = simplifySteps([
      stat(["position"], { x: 0, y: 0 }, { x: 10, y: 0 }, { apply: place }),
      stat(["position"], { x: 10, y: 0 }, { x: 100, y: 0 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.payload).toMatchObject({ after: { x: 100, y: 0 }, apply: place });
  });

  it("lets the last explicit `apply` win over an earlier one", () => {
    const out = simplifySteps([
      stat(["position"], { x: 0, y: 0 }, { x: 10, y: 0 }, { apply: place }),
      stat(["position"], { x: 10, y: 0 }, { x: 40, y: 0 }),
      stat(["position"], { x: 40, y: 0 }, { x: 100, y: 0 }, { apply: shift }),
    ]);
    expect(out).toHaveLength(1);
    // `after` is recomputed from the winning formula over the run's own
    // start: the 100 the last step recorded came from a different operator,
    // and a stale pair would make the label and a scene rebuild lie.
    expect(out[0]!.payload).toMatchObject({ after: { x: 90, y: 0 }, apply: shift });
    // A step with its own formula reads the target live, so playback tracks
    // no origin for it: absolute, whatever the path's default class is.
    expect(payloadClass(out[0]!.payload as StepPayload)).toBe("absolute");
  });

  it("keeps a step whose formula does something, however still its values are", () => {
    // "rotation 0 → 45" edited to `v * 2` recomputes `after` onto `before`,
    // and the pair alone then reads as a no-op. The formula is what replays.
    const doubled = simplifySteps([
      stat(["rotation"], 0, 45),
      stat(["rotation"], 45, 0, { apply: { scale: 2, offset: 0 } }),
    ]);
    expect(doubled).toHaveLength(1);
    expect(doubled[0]!.payload).toMatchObject({
      before: 0,
      after: 0,
      apply: { scale: 2, offset: 0 },
    });
    expect(doubled[0]!.label).toBe("Rect · Transform · rotation ×2");
  });

  it("drops a step whose formula is plain `v`", () => {
    // Scale 1, offset 0 writes the target's own value back. That IS nothing,
    // whatever the recorded pair says.
    const identity = simplifySteps([
      stat(["rotation"], 0, 45),
      stat(["rotation"], 45, 0, { apply: { scale: 1, offset: 0 } }),
    ]);
    expect(identity).toHaveLength(0);
    const perComponent = simplifySteps([
      stat(["position"], { x: 0, y: 0 }, { x: 10, y: 0 }),
      stat(
        ["position"],
        { x: 10, y: 0 },
        { x: 0, y: 0 },
        { apply: { x: { scale: 1, offset: 0 }, y: { scale: 1, offset: 0 } } },
      ),
    ]);
    expect(perComponent).toHaveLength(0);
  });

  it("leaves `apply` absent when no step in the run set one", () => {
    const out = simplifySteps([
      stat(["position"], { x: 0, y: 0 }, { x: 10, y: 0 }),
      stat(["position"], { x: 10, y: 0 }, { x: 100, y: 0 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.payload).not.toHaveProperty("apply");
    // The merged pair decides the class the run replays with.
    expect(payloadClass(out[0]!.payload as StepPayload)).toBe("additive");
  });
});
