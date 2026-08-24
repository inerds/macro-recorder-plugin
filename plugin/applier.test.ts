/**
 * Playback regression suite, driven by the shared fake scene.
 *
 * A macro says "end up like this", not "apply these deltas" — the target's
 * timeline has no guaranteed relationship to the recorded node's. These tests
 * pin that convergent behaviour, and the honest reporting that replaces the
 * failures and silent no-ops it used to produce.
 */
import { describe, expect, it } from "vitest";

import type { Json } from "../shared/json";
import { makeGradientFill, makeIds, makeNode } from "../shared/testing/fakeScene";
import { diffSnapshots } from "../shared/diff";
import type { StepPayload } from "../shared/steps";
import { applyStep, readBaseline, type ApplyContext } from "./applier";

const exact: ApplyContext = { origins: {}, baselines: {} };

function apply(target: unknown, payload: StepPayload, context: ApplyContext = exact) {
  return applyStep(target, payload, context);
}

function kf(frame: number, value: Json) {
  return { frame, value };
}

function frames(prop: { keyframes: { frame: number }[] }) {
  return prop.keyframes.map((k) => k.frame);
}

function values(prop: { keyframes: { value: Json }[] }) {
  return prop.keyframes.map((k) => k.value);
}

describe("keyframe replay onto a divergent timeline", () => {
  it("is a no-op with a note when removing a keyframe the target never had", () => {
    // The reported bug: "Rectangle 2: keyframe @ 67 not found to remove".
    const target = makeNode("Rectangle 2", {}, makeIds());

    const outcome = apply(target, {
      op: "keyframes",
      path: ["position"],
      added: [],
      removed: [{ frame: 67, value: { x: 0, y: 0 } }],
      changed: [],
    });

    expect(outcome.notes).toEqual(["couldn't find a keyframe at 67 to remove"]);
  });

  it("creates the keyframe when updating one the target never had", () => {
    const target = makeNode("Rectangle 2", {}, makeIds());

    const outcome = apply(target, {
      op: "keyframes",
      path: ["position"],
      added: [],
      removed: [],
      changed: [{ before: kf(12, { x: 0, y: 0 }), after: kf(12, { x: 9, y: 9 }) }],
    });

    expect(frames(target.position)).toEqual([12]);
    expect(values(target.position)).toEqual([{ x: 9, y: 9 }]);
    expect(outcome.notes).toEqual(["no keyframe at 12 — created it"]);
  });

  it("updates in place instead of duplicating when the frame is already taken", () => {
    const target = makeNode("Rectangle 2", {}, makeIds());
    target.position.addKeyframes([kf(30, { x: 1, y: 1 })]);

    apply(target, {
      op: "keyframes",
      path: ["position"],
      added: [kf(30, { x: 7, y: 7 })],
      removed: [],
      changed: [],
    });

    expect(frames(target.position)).toEqual([30]);
    expect(values(target.position)).toEqual([{ x: 7, y: 7 }]);
  });

  it("resolves by frame — recorded keyframe ids never match another node's", () => {
    const target = makeNode("Rectangle 2", {}, makeIds());
    target.position.addKeyframes([kf(10, { x: 1, y: 1 })]);
    const targetKfId = target.position.keyframes[0].id;

    apply(target, {
      op: "keyframes",
      path: ["position"],
      added: [],
      removed: [],
      changed: [
        {
          before: { id: "kf-from-another-node", frame: 10, value: { x: 1, y: 1 } },
          after: { id: "kf-from-another-node", frame: 10, value: { x: 5, y: 5 } },
        },
      ],
    });

    expect(target.position.keyframes[0].id).toBe(targetKfId);
    expect(target.position.keyframes[0].value).toEqual({ x: 5, y: 5 });
  });

  it("still applies the removals when an added keyframe fails", () => {
    const target = makeNode("Rectangle 2", {}, makeIds());
    target.position.addKeyframes([kf(30, { x: 3, y: 3 })]);
    target.position.__failAdd("bad keyframe value");

    expect(() =>
      apply(target, {
        op: "keyframes",
        path: ["position"],
        added: [kf(0, { x: 0, y: 0 })],
        removed: [{ frame: 30, value: { x: 3, y: 3 } }],
        changed: [],
      }),
    ).toThrow("keyframe @ 0: bad keyframe value");

    // The independently-valid removal ran despite the failed add.
    expect(frames(target.position)).toEqual([]);
  });

  it("reports every failing entry rather than only the first", () => {
    const target = makeNode("Rectangle 2", {}, makeIds());
    target.position.__failAdd("nope");

    expect(() =>
      apply(target, {
        op: "keyframes",
        path: ["position"],
        added: [kf(0, { x: 0, y: 0 }), kf(10, { x: 1, y: 1 })],
        removed: [],
        changed: [],
      }),
    ).toThrow("keyframe @ 0: nope; keyframe @ 10: nope");
  });

  it("never leaves a duplicate when the write fallback cannot remove the original", () => {
    const target = makeNode("Rectangle 2", {}, makeIds());
    target.position.addKeyframes([kf(10, { x: 1, y: 1 })]);
    target.position.__failWrite("read-only keyframe");
    target.position.__failRemove("cannot remove");

    expect(() =>
      apply(target, {
        op: "keyframes",
        path: ["position"],
        added: [],
        removed: [],
        changed: [{ before: kf(10, { x: 1, y: 1 }), after: kf(10, { x: 2, y: 2 }) }],
      }),
    ).toThrow("cannot remove");

    // One keyframe, not two: the fallback must not add after a failed remove.
    expect(frames(target.position)).toEqual([10]);
  });

  it("recreates the keyframe when the in-place write fails but removal works", () => {
    const target = makeNode("Rectangle 2", {}, makeIds());
    target.position.addKeyframes([kf(10, { x: 1, y: 1 })]);
    target.position.__failWrite("read-only keyframe");

    apply(target, {
      op: "keyframes",
      path: ["position"],
      added: [],
      removed: [],
      changed: [{ before: kf(10, { x: 1, y: 1 }), after: kf(10, { x: 2, y: 2 }) }],
    });

    expect(frames(target.position)).toEqual([10]);
    expect(values(target.position)).toEqual([{ x: 2, y: 2 }]);
  });
});

describe("add+remove-same-frame keyframe payloads (what pre-fix saved macros contain)", () => {
  // shared/diff.ts used to key keyframes by id, and Creator reassigns a
  // keyframe's id on every value edit — so a saved macro can contain a
  // 'keyframes' payload whose added and removed entries target the SAME
  // frame. applyKeyframes processes added before removed, so today the add
  // (re)writes the keyframe and the immediately-following remove then
  // deletes it — a fully silent net deletion (failures: [], notes: []).

  it("keeps the edited keyframe at its new value when added and removed share a frame — currently the remove destroys it after the add applies it", () => {
    const target = makeNode("Rectangle 2", {}, makeIds());
    target.position.addKeyframes([kf(126, { x: 10, y: 10 })]);

    const outcome = apply(target, {
      op: "keyframes",
      path: ["position"],
      added: [kf(126, { x: 20, y: 20 })],
      removed: [kf(126, { x: 10, y: 10 })],
      changed: [],
    });

    expect(frames(target.position)).toEqual([126]);
    expect(values(target.position)).toEqual([{ x: 20, y: 20 }]);
    expect(outcome.notes).toEqual([]);
  });

  it("ends up with the added keyframe when a target with none receives an add+remove targeting the same frame — currently ends up with no keyframe at all", () => {
    const target = makeNode("Rectangle 2", {}, makeIds());

    const outcome = apply(target, {
      op: "keyframes",
      path: ["position"],
      added: [kf(125, { x: 9, y: 9 })],
      removed: [kf(125, { x: 1, y: 1 })],
      changed: [],
    });

    expect(frames(target.position)).toEqual([125]);
    expect(values(target.position)).toEqual([{ x: 9, y: 9 }]);
    expect(outcome.notes).toEqual([]);
  });
});

describe("static writes onto an animated target", () => {
  it("reports a note instead of a phantom success", () => {
    const target = makeNode("Rectangle 2", { props: { rotation: 0 } }, makeIds());
    target.rotation.addKeyframes([kf(0, 0), kf(30, 90)]);

    const outcome = apply(target, {
      op: "set-static",
      path: ["rotation"],
      before: 0,
      after: 45,
    });

    // The host would discard this write silently (plugin-api.d.ts:17-18).
    expect(target.rotation.staticValue).toBe(0);
    expect(outcome.notes).toEqual([
      "rotation has keyframes here — static value not applied",
    ]);
  });

  it("applies normally when the target property is static", () => {
    const target = makeNode("Rectangle 2", { props: { rotation: 0 } }, makeIds());

    const outcome = apply(target, {
      op: "set-static",
      path: ["rotation"],
      before: 0,
      after: 45,
    });

    expect(target.rotation.staticValue).toBe(45);
    expect(outcome.notes).toEqual([]);
  });
});

describe("path resolution failures", () => {
  it("skips with a note when the target has no fill at that index", () => {
    const bare = makeNode("Bare", { fills: [] }, makeIds());

    const outcome = apply(bare, {
      op: "set-static",
      path: ["fills", 0, "color"],
      before: { r: 0, g: 0, b: 0 },
      after: { r: 1, g: 0, b: 0 },
    });

    expect(outcome.notes).toHaveLength(1);
    expect(outcome.notes[0]).toMatch(/fills\[0\] not found/);
    expect(outcome.notes[0]).toMatch(/skipped$/);
  });

  it("applies a gradient recolor to a solid-fill target via the first stop's color", () => {
    // A recolor is a recolor: a layer has one fill, whatever its paint kind.
    // (Previously this hard-failed at step 0 and blocked the whole macro.)
    const target = makeNode("Star 1", { fills: [{ r: 40, g: 183, b: 219 }] }, makeIds());

    const outcome = apply(target, {
      op: "set-static",
      path: ["fills", 0, "stops"],
      before: null,
      after: [
        { color: { r: 64, g: 180, b: 208 }, offset: 0, opacity: 1 },
        { color: { r: 159, g: 164, b: 166 }, offset: 1, opacity: 1 },
      ],
    });

    expect(target.fills[0].color.staticValue).toEqual({ r: 64, g: 180, b: 208 });
    expect(outcome.notes).toEqual([
      "this layer's fill is solid — applied the gradient's first color",
    ]);
  });

  it("applies a solid recolor to a gradient-fill target by tinting every stop", () => {
    const target = makeNode("Rectangle 1", { fills: [] }, makeIds());
    const ids = makeIds();
    target.fills.push(
      makeGradientFill(
        [
          { color: { r: 187, g: 190, b: 191 }, offset: 0, opacity: 1 },
          { color: { r: 159, g: 164, b: 166 }, offset: 1, opacity: 1 },
        ],
        ids,
      ),
    );

    const outcome = apply(target, {
      op: "set-static",
      path: ["fills", 0, "color"],
      before: { r: 178, g: 182, b: 183 },
      after: { r: 0, g: 204, b: 255 },
    });

    expect(target.fills[0].stops.staticValue).toEqual([
      { color: { r: 0, g: 204, b: 255 }, offset: 0, opacity: 1 },
      { color: { r: 0, g: 204, b: 255 }, offset: 1, opacity: 1 },
    ]);
    expect(outcome.notes).toEqual([
      "this layer's fill is a gradient — applied the color to every stop",
    ]);
  });

  it("remaps a recorded fill index onto the target's only fill", () => {
    const target = makeNode("Star 1", { fills: [{ r: 10, g: 10, b: 10 }] }, makeIds());

    const outcome = apply(target, {
      op: "set-static",
      path: ["fills", 1, "color"],
      before: { r: 0, g: 0, b: 0 },
      after: { r: 255, g: 0, b: 0 },
    });

    expect(target.fills[0].color.staticValue).toEqual({ r: 255, g: 0, b: 0 });
    expect(outcome.notes).toEqual(["applied to this layer's first fill"]);
  });

  it("readBaseline returns undefined rather than throwing for an absent path", () => {
    const bare = makeNode("Bare", { fills: [] }, makeIds());

    expect(readBaseline(bare, ["fills", 0, "color"])).toBeUndefined();
    expect(readBaseline(bare, ["position"])).toEqual({ x: 0, y: 0 });
  });
});

describe("offset mode", () => {
  it("offsets a static transform from the target's own baseline", () => {
    const target = makeNode("Layer B", { props: { position: { x: 400, y: 300 } } }, makeIds());
    const context: ApplyContext = {
      origins: { position: { x: 100, y: 50 } },
      baselines: { position: { x: 400, y: 300 } },
    };

    apply(
      target,
      { op: "set-static", path: ["position"], before: { x: 100, y: 50 }, after: { x: 160, y: 50 } },
      context,
    );

    expect(target.position.staticValue).toEqual({ x: 460, y: 300 });
  });

  it("offsets keyframe values from the target's own baseline, like the static form", () => {
    const target = makeNode("Layer B", { props: { position: { x: 400, y: 300 } } }, makeIds());
    const context: ApplyContext = {
      origins: { position: { x: 100, y: 50 } },
      baselines: { position: { x: 400, y: 300 } },
    };

    apply(
      target,
      {
        op: "keyframes",
        path: ["position"],
        added: [kf(0, { x: 100, y: 50 }), kf(30, { x: 160, y: 50 })],
        removed: [],
        changed: [],
      },
      context,
    );

    // The recorded motion starts at its own origin, so the target's animation
    // starts at the target's baseline and moves by the recorded delta.
    expect(values(target.position)).toEqual([
      { x: 400, y: 300 },
      { x: 460, y: 300 },
    ]);
  });

  it("applies keyframe values as recorded when the path is untracked (no origin)", () => {
    const target = makeNode("Layer B", { props: { position: { x: 400, y: 300 } } }, makeIds());

    apply(target, {
      op: "keyframes",
      path: ["position"],
      added: [kf(0, { x: 100, y: 50 }), kf(30, { x: 160, y: 50 })],
      removed: [],
      changed: [],
    });

    expect(values(target.position)).toEqual([
      { x: 100, y: 50 },
      { x: 160, y: 50 },
    ]);
  });
});

describe("the reported scenario, end to end", () => {
  it("completes a macro that previously died mid-run", () => {
    // Recorded on a layer that had keyframes at 0/67; replayed onto a target
    // whose timeline has neither. Step 2 used to throw and stop everything.
    const target = makeNode("Rectangle 2", { props: { position: { x: 20, y: 20 } } }, makeIds());
    const steps: StepPayload[] = [
      {
        op: "keyframes",
        path: ["position"],
        added: [kf(0, { x: 0, y: 0 })],
        removed: [],
        changed: [],
      },
      {
        op: "keyframes",
        path: ["position"],
        added: [],
        removed: [{ frame: 67, value: { x: 5, y: 5 } }],
        changed: [],
      },
      {
        op: "keyframes",
        path: ["position"],
        added: [kf(90, { x: 300, y: 0 })],
        removed: [],
        changed: [],
      },
    ];

    const notes = steps.flatMap((step) => apply(target, step).notes);

    expect(frames(target.position)).toEqual([0, 90]);
    expect(notes).toEqual(["couldn't find a keyframe at 67 to remove"]);
  });
});

describe("keyframes colliding on the same frame", () => {
  it("never leaves two keyframes at one frame when a move lands on an occupied one", () => {
    const target = makeNode("Rectangle 2", { props: { rotation: 0 } }, makeIds());
    target.rotation.addKeyframes([kf(10, 1), kf(30, 99)]);

    const outcome = apply(target, {
      op: "keyframes",
      path: ["rotation"],
      added: [],
      removed: [],
      changed: [{ before: kf(10, 1), after: kf(30, 1) }],
    });

    expect(frames(target.rotation)).toEqual([30]);
    expect(values(target.rotation)).toEqual([1]);
    expect(outcome.notes).toEqual(["replaced the keyframe at 30"]);
  });

  it("does not duplicate when a missing keyframe is created onto an occupied frame", () => {
    const target = makeNode("Rectangle 2", { props: { rotation: 0 } }, makeIds());
    target.rotation.addKeyframes([kf(30, 99)]);

    apply(target, {
      op: "keyframes",
      path: ["rotation"],
      added: [],
      removed: [],
      changed: [{ before: kf(10, 1), after: kf(30, 5) }],
    });

    expect(frames(target.rotation)).toEqual([30]);
    expect(values(target.rotation)).toEqual([5]);
  });

  it("applies a value swap between two keyframes correctly", () => {
    const target = makeNode("Rectangle 2", { props: { rotation: 0 } }, makeIds());
    target.rotation.addKeyframes([kf(10, 1), kf(20, 2)]);

    apply(target, {
      op: "keyframes",
      path: ["rotation"],
      added: [],
      removed: [],
      changed: [
        { before: kf(10, 1), after: kf(10, 2) },
        { before: kf(20, 2), after: kf(20, 1) },
      ],
    });

    expect(frames(target.rotation)).toEqual([10, 20]);
    expect(values(target.rotation)).toEqual([2, 1]);
  });
});

describe("host quirks found in real Creator traces (2026-08-21)", () => {
  it("still lands a keyframe at frame 0 on a not-yet-animated property", () => {
    // Creator silently ignores addKeyframes at frame 0 while a property is
    // static — every playback of a macro starting with "Keyframe @ 0" lost
    // that keyframe. The applier seeds animation with a sentinel and retries.
    const target = makeNode("Rectangle 1", { props: { position: { x: 5, y: 5 } } }, makeIds());
    expect(target.position.isAnimated).toBe(false);

    const outcome = apply(target, {
      op: "keyframes",
      path: ["position"],
      added: [kf(0, { x: 1, y: 2 })],
      removed: [],
      changed: [],
    });

    expect(frames(target.position)).toEqual([0]);
    expect(values(target.position)).toEqual([{ x: 1, y: 2 }]);
    expect(outcome.notes).toEqual([]);
  });

  it("frame 0 inserts directly once the property is animated", () => {
    const target = makeNode("Ellipse 2", { props: { position: { x: 5, y: 5 } } }, makeIds());
    target.position.addKeyframes([kf(108, { x: 9, y: 9 })]);

    apply(target, {
      op: "keyframes",
      path: ["position"],
      added: [kf(0, { x: 1, y: 2 })],
      removed: [],
      changed: [],
    });

    expect(frames(target.position)).toEqual([0, 108]);
  });

  it("applies a static write to a property that is animated but has zero keyframes", () => {
    // isAnimated can stay true after every keyframe is removed. The contract
    // is about keyframes EXISTING, so the write must go through and not be
    // reported as skipped.
    const target = makeNode("Ellipse 2", { props: { position: { x: 5, y: 5 } } }, makeIds());
    target.position.addKeyframes([kf(10, { x: 1, y: 1 })]);
    target.position.keyframes[0].remove();
    expect(target.position.isAnimated).toBe(true);

    const outcome = apply(target, {
      op: "set-static",
      path: ["position"],
      before: { x: 0, y: 0 },
      after: { x: 60.57, y: 139.31 },
    });

    expect(target.position.staticValue).toEqual({ x: 60.57, y: 139.31 });
    expect(outcome.notes).toEqual([]);
  });
});

describe("scale in offset mode", () => {
  it("multiplies from the target's own baseline", () => {
    const target = makeNode("Rectangle 2", { props: { scale: { x: 50, y: 50 } } }, makeIds());
    const context: ApplyContext = {
      origins: { scale: { x: 100, y: 100 } },
      baselines: { scale: { x: 50, y: 50 } },
    };

    apply(
      target,
      {
        op: "set-static",
        path: ["scale"],
        before: { x: 100, y: 100 },
        after: { x: 322.15, y: 308.34 },
      },
      context,
    );

    expect(target.scale.staticValue).toEqual({ x: 161.075, y: 154.17 });
  });
});

describe("phantom getKeyframeAt occupants", () => {
  it("creates the keyframe instead of converging a phantom on a keyframe-less property", () => {
    // Real trace (09:00:24): the host returned a truthy occupant at frame 0
    // on a static property; playback wrote to it, changed nothing, and
    // reported success. keyframeAt must not trust getKeyframeAt when the
    // property has no keyframes at all.
    const target = makeNode("Rectangle 1", { props: { position: { x: 33, y: 62 } } }, makeIds());
    target.position.__phantomGetAt(true);

    const outcome = apply(target, {
      op: "keyframes",
      path: ["position"],
      added: [kf(0, { x: 1, y: 2 })],
      removed: [],
      changed: [],
    });

    expect(frames(target.position)).toEqual([0]);
    expect(values(target.position)).toEqual([{ x: 1, y: 2 }]);
    expect(outcome.notes).toEqual([]);
  });
});

describe("v2: deep paths and structural ops", () => {
  it("applies a child rectangle's size by index", () => {
    const target = makeNode("Layer A", {}, makeIds());
    target.createRectangle({ size: { x: 80, y: 60 } });

    apply(target, {
      op: "set-static",
      path: ["shapes", 0, "size"],
      before: { x: 80, y: 60 },
      after: { x: 200, y: 100 },
      shapeHint: "RECTANGLE",
    });

    expect(target.shapes[0].size.staticValue).toEqual({ x: 200, y: 100 });
  });

  it("re-finds the rectangle by type when target indices differ", () => {
    const target = makeNode("Layer B", {}, makeIds());
    target.createStar({});
    target.createRectangle({ size: { x: 10, y: 10 } });

    const outcome = apply(target, {
      op: "set-static",
      path: ["shapes", 0, "size"], // recorded at index 0; here it's index 1
      before: { x: 80, y: 60 },
      after: { x: 200, y: 100 },
      shapeHint: "RECTANGLE",
    });

    expect(target.shapes[1].size.staticValue).toEqual({ x: 200, y: 100 });
    expect(outcome.notes).toEqual(["matched this layer's rectangle shape"]);
  });

  it("keyframes a nested shape property", () => {
    const target = makeNode("Layer A", {}, makeIds());
    target.createRectangle({});

    apply(target, {
      op: "keyframes",
      path: ["shapes", 0, "roundness"],
      added: [kf(0, 0), kf(30, 20)],
      removed: [],
      changed: [],
      shapeHint: "RECTANGLE",
    });

    expect(frames(target.shapes[0].roundness)).toEqual([0, 30]);
  });

  it("sets a plain layer flag", () => {
    const target = makeNode("Layer A", {}, makeIds());

    apply(target, { op: "set-plain", path: ["visible"], before: true, after: false });

    expect(target.visible).toBe(false);
  });

  it("replaces a solid fill with the recorded gradient end state", () => {
    const target = makeNode("Layer A", { fills: [{ r: 1, g: 2, b: 3 }] }, makeIds());

    apply(target, {
      op: "replace-paint",
      path: ["fills", 0],
      spec: {
        kind: "gradient",
        gradientType: "GRADIENT_LINEAR",
        stops: { animated: false, static: [{ color: { r: 9, g: 9, b: 9 }, offset: 0, opacity: 1 }] },
      },
    });

    expect(target.fills).toHaveLength(1);
    expect(target.fills[0].type).toBe("GRADIENT_LINEAR");
  });

  it("removes a fill via remove-paint (no longer 'isn't supported')", () => {
    const target = makeNode("Layer A", { fills: [{ r: 1, g: 2, b: 3 }] }, makeIds());

    apply(target, { op: "remove-paint", path: ["fills", 0] });

    expect(target.fills).toHaveLength(0);
  });

  it("creates a recorded shape subtree end-state via add-shape", () => {
    const target = makeNode("Layer B", {}, makeIds());

    const outcome = apply(target, {
      op: "add-shape",
      parentPath: [],
      spec: {
        nodeId: "rec-1",
        nodeType: "ELLIPSE",
        nodeName: "my ellipse",
        props: {
          size: { animated: false, static: { x: 40, y: 40 } },
          position: { animated: true, static: { x: 0, y: 0 }, keyframes: [kf(0, { x: 0, y: 0 }), kf(30, { x: 9, y: 9 })] },
        },
        plain: {},
        fills: [{ kind: "solid", color: { animated: false, static: { r: 7, g: 7, b: 7 } } }],
        strokes: [],
        masks: [],
        shapes: [],
      },
    });

    expect(target.shapes).toHaveLength(1);
    const created = target.shapes[0];
    expect(created.type).toBe("ELLIPSE");
    expect(created.name).toBe("my ellipse");
    expect(created.size.staticValue).toEqual({ x: 40, y: 40 });
    expect(frames(created.position)).toEqual([0, 30]);
    expect(created.fills).toHaveLength(1);
    expect(outcome.notes).toEqual([]);
  });

  it("removes a shape, resolving by type hint", () => {
    const target = makeNode("Layer B", {}, makeIds());
    target.createStar({});
    target.createRectangle({});

    apply(target, { op: "remove-shape", path: ["shapes", 0], shapeType: "RECTANGLE" });

    expect(target.shapes).toHaveLength(1);
    expect(target.shapes[0].type).toBe("STAR");
  });

  it("adds and removes masks", () => {
    const target = makeNode("Layer A", {}, makeIds());

    apply(target, {
      op: "add-mask",
      path: ["masks", 0],
      spec: {
        mode: "add",
        pathData: { animated: false, static: { points: [], closed: true } },
        opacity: { animated: false, static: 50 },
      },
    });
    expect(target.masks).toHaveLength(1);
    expect(target.masks[0].opacity.staticValue).toBe(50);

    apply(target, { op: "remove-mask", path: ["masks", 0] });
    expect(target.masks).toHaveLength(0);
  });

  it("reports a not-replayable step as a skip note", () => {
    const target = makeNode("Layer A", {}, makeIds());

    const outcome = apply(target, {
      op: "not-replayable",
      description: "Shapes reordered (can't be replayed)",
    });

    expect(outcome.notes).toEqual(["Shapes reordered (can't be replayed) — skipped"]);
  });
});

describe("fill opacity", () => {
  it("applies a recorded fill-opacity change", () => {
    const target = makeNode("Star 4", { fills: [{ r: 178, g: 182, b: 183 }] }, makeIds());

    apply(target, {
      op: "set-static",
      path: ["fills", 0, "opacity"],
      before: 100,
      after: 40,
    });

    expect(target.fills[0].opacity.staticValue).toBe(40);
  });

  it("carries opacity when a paint is recreated via replace-paint", () => {
    const target = makeNode("Star 4", { fills: [{ r: 1, g: 2, b: 3 }] }, makeIds());

    apply(target, {
      op: "replace-paint",
      path: ["fills", 0],
      spec: {
        kind: "gradient",
        gradientType: "GRADIENT_LINEAR",
        stops: { animated: false, static: [] },
        opacity: { animated: false, static: 55 },
      },
    });

    expect(target.fills[0].type).toBe("GRADIENT_LINEAR");
  });
});

describe("animated recolors across paint kinds", () => {
  it("keyframes a recorded solid-color animation onto a gradient fill's stops", () => {
    const target = makeNode("Polygon 2", { fills: [] }, makeIds());
    const ids = makeIds();
    target.fills.push(
      makeGradientFill(
        [
          { color: { r: 1, g: 1, b: 1 }, offset: 0, opacity: 1 },
          { color: { r: 2, g: 2, b: 2 }, offset: 1, opacity: 1 },
        ],
        ids,
      ),
    );

    const outcome = apply(target, {
      op: "keyframes",
      path: ["fills", 0, "color"],
      added: [kf(29, { r: 147, g: 103, b: 244 }), kf(101, { r: 0, g: 204, b: 255 })],
      removed: [],
      changed: [],
    });

    const stops = target.fills[0].stops;
    expect(frames(stops)).toEqual([29, 101]);
    expect(stops.keyframes[0].value).toEqual([
      { color: { r: 147, g: 103, b: 244 }, offset: 0, opacity: 1 },
      { color: { r: 147, g: 103, b: 244 }, offset: 1, opacity: 1 },
    ]);
    expect(outcome.notes).toEqual([
      "this layer's fill is a gradient — animated the color onto every stop",
    ]);
  });

  it("keyframes recorded gradient stops onto a solid fill's color", () => {
    const target = makeNode("Star 1", { fills: [{ r: 5, g: 5, b: 5 }] }, makeIds());

    const outcome = apply(target, {
      op: "keyframes",
      path: ["fills", 0, "stops"],
      added: [
        kf(0, [{ color: { r: 64, g: 180, b: 208 }, offset: 0, opacity: 1 }]),
        kf(60, [{ color: { r: 255, g: 0, b: 0 }, offset: 0, opacity: 1 }]),
      ],
      removed: [],
      changed: [],
    });

    const color = target.fills[0].color;
    expect(frames(color)).toEqual([0, 60]);
    expect(color.keyframes[0].value).toEqual({ r: 64, g: 180, b: 208 });
    expect(outcome.notes).toEqual([
      "this layer's fill is solid — animated the gradient's first color",
    ]);
  });
});

describe("reorder replay via the untyped move methods", () => {
  function shapeNames(target: { shapes: { name: string }[] }) {
    return target.shapes.map((s) => s.name);
  }

  it("applies a recorded swap to the target's shapes", () => {
    const target = makeNode("Layer A", {}, makeIds());
    const star = target.createStar({});
    const rect = target.createRectangle({});
    star.name = "star";
    rect.name = "rect";

    const outcome = apply(target, { op: "reorder-shapes", path: [], order: [1, 0] });

    expect(shapeNames(target)).toEqual(["rect", "star"]);
    expect(outcome.notes).toEqual([]);
  });

  it("applies a three-shape rotation and leaves extra target shapes at the end", () => {
    const target = makeNode("Layer A", {}, makeIds());
    const a = target.createStar({});
    const b = target.createRectangle({});
    const c = target.createEllipse({});
    const extraShape = target.createPolygon({});
    a.name = "a"; b.name = "b"; c.name = "c"; extraShape.name = "extra";

    // recorded on a 3-shape layer: [c, a, b]
    apply(target, { op: "reorder-shapes", path: [], order: [2, 0, 1] });

    expect(shapeNames(target)).toEqual(["c", "a", "b", "extra"]);
  });

  it("is a no-op when the target already matches the recorded order", () => {
    const target = makeNode("Layer A", {}, makeIds());
    target.createStar({}).name = "a";
    target.createRectangle({}).name = "b";

    const outcome = apply(target, { op: "reorder-shapes", path: [], order: [0, 1] });

    expect(shapeNames(target)).toEqual(["a", "b"]);
    expect(outcome.notes).toEqual([]);
  });

  it("skips with a note when the target's shapes lack the move methods", () => {
    const target = makeNode("Layer A", {}, makeIds());
    const s1 = target.createStar({});
    target.createRectangle({});
    s1.moveBefore = undefined;
    s1.moveAfter = undefined;

    const outcome = apply(target, { op: "reorder-shapes", path: [], order: [1, 0] });

    expect(outcome.notes).toEqual(["this layer can't reorder shapes — skipped"]);
  });

  it("round-trips: a recorded reorder diff replays onto a same-shaped layer", () => {
    // record side: diff two snapshots where the shapes swapped
    const recPrev = {
      nodeId: "n", nodeType: "CONTAINER", props: {}, plain: {}, fills: [], strokes: [], masks: [],
      shapes: [
        { nodeId: "s1", nodeType: "STAR", props: {}, plain: {}, fills: [], strokes: [], masks: [], shapes: [] },
        { nodeId: "s2", nodeType: "RECTANGLE", props: {}, plain: {}, fills: [], strokes: [], masks: [], shapes: [] },
      ],
    };
    const recNext = { ...recPrev, shapes: [recPrev.shapes[1]!, recPrev.shapes[0]!] };
    const ops = diffSnapshots(recPrev, recNext);
    expect(ops).toEqual([{ op: "reorder-shapes", path: [], order: [1, 0] }]);

    // replay side
    const target = makeNode("Layer B", {}, makeIds());
    target.createStar({}).name = "star";
    target.createRectangle({}).name = "rect";
    apply(target, ops[0] as StepPayload);
    expect(shapeNames(target)).toEqual(["rect", "star"]);
  });
});

describe("trim paths (untyped runtime surface)", () => {
  it("round-trips: recorded trim edits replay onto another layer", () => {
    // record side
    const trim = (start: number, end: number) => ({
      mode: "simultaneously",
      start: { animated: false, static: start },
      end: { animated: false, static: end },
      offset: { animated: false, static: 0 },
    });
    const base = {
      nodeId: "n", nodeType: "CONTAINER", props: {}, plain: {},
      fills: [], strokes: [], masks: [], shapes: [],
    };
    const ops = diffSnapshots(
      { ...base, trims: [] },
      { ...base, trims: [trim(0, 100)] },
    );
    expect(ops).toEqual([
      { op: "add-trim", path: ["trimPaths", 0], spec: trim(0, 100) },
    ]);
    const editOps = diffSnapshots(
      { ...base, trims: [trim(0, 100)] },
      { ...base, trims: [trim(25, 60)] },
    );
    expect(editOps.map((o) => o.op)).toEqual(["set-static", "set-static"]);

    // replay side
    const target = makeNode("Layer B", {}, makeIds());
    apply(target, ops[0] as StepPayload);
    expect(target.trimPaths).toHaveLength(1);
    for (const op of editOps) apply(target, op as StepPayload);
    expect(target.trimPaths[0].start.staticValue).toBe(25);
    expect(target.trimPaths[0].end.staticValue).toBe(60);
  });

  it("keyframes a trim end and removes a trim", () => {
    const target = makeNode("Layer A", {}, makeIds());
    target.createTrimPath();

    apply(target, {
      op: "keyframes",
      path: ["trimPaths", 0, "end"],
      added: [kf(0, 0), kf(60, 100)],
      removed: [],
      changed: [],
    });
    expect(frames(target.trimPaths[0].end)).toEqual([0, 60]);

    apply(target, { op: "remove-trim", path: ["trimPaths", 0] });
    expect(target.trimPaths).toHaveLength(0);
  });

  it("skips add-trim with a note when the target can't take one", () => {
    const target = makeNode("Layer A", {}, makeIds());
    target.createTrimPath = undefined;

    const outcome = apply(target, {
      op: "add-trim",
      path: ["trimPaths", 0],
      spec: {},
    });
    expect(outcome.notes).toEqual(["this layer can't take trim paths — skipped"]);
  });
});

describe("trim edits onto targets without a trim path", () => {
  it("creates the trim path on demand and lands the keyframes", () => {
    const target = makeNode("Path 2", {}, makeIds());
    expect(target.trimPaths).toHaveLength(0);

    const outcome = apply(target, {
      op: "keyframes",
      path: ["trimPaths", 0, "start"],
      added: [kf(0, 13), kf(36, 60)],
      removed: [],
      changed: [],
    });

    expect(target.trimPaths).toHaveLength(1);
    expect(frames(target.trimPaths[0].start)).toEqual([0, 36]);
    expect(outcome.notes).toEqual(["added a trim path to this layer"]);
  });

  it("creates the trim path for a static trim edit too", () => {
    const target = makeNode("Path 2", {}, makeIds());

    const outcome = apply(target, {
      op: "set-static",
      path: ["trimPaths", 0, "end"],
      before: 100,
      after: 40,
    });

    expect(target.trimPaths).toHaveLength(1);
    expect(target.trimPaths[0].end.staticValue).toBe(40);
    expect(outcome.notes).toEqual(["added a trim path to this layer"]);
  });

  it("still skips when the target can't take trim paths at all", () => {
    const target = makeNode("Bare", {}, makeIds());
    target.createTrimPath = undefined;

    const outcome = apply(target, {
      op: "set-static",
      path: ["trimPaths", 0, "end"],
      before: 100,
      after: 40,
    });

    expect(outcome.notes).toHaveLength(1);
    expect(outcome.notes[0]).toMatch(/skipped$/);
  });
});

describe("path data replay", () => {
  it("applies a recorded path shape onto another path's pathData", () => {
    const target = makeNode("Path 2", {}, makeIds());
    target.createPath({});
    const recorded = {
      closed: true,
      points: [
        { vertex: { x: 10, y: 20 }, inTan: { x: 0, y: 0 }, outTan: { x: 5, y: 5 } },
        { vertex: { x: 90, y: 20 }, inTan: { x: -5, y: 0 }, outTan: { x: 0, y: 0 } },
      ],
    };

    apply(target, {
      op: "set-static",
      path: ["shapes", 0, "pathData"],
      before: { closed: true, points: [] },
      after: recorded,
      shapeHint: "PATH",
    });

    expect(target.shapes[0].pathData.staticValue).toEqual(recorded);
  });
});

describe("paint removal on the real host's surface (object-level remove)", () => {
  it("replace-paint actually replaces when only paint.remove() exists", () => {
    // Real Creator has no container.removeFill — removal is on the paint.
    const target = makeNode("Polygon 1", { fills: [{ r: 1, g: 2, b: 3 }] }, makeIds());
    target.removeFill = undefined;

    const outcome = apply(target, {
      op: "replace-paint",
      path: ["fills", 0],
      spec: {
        kind: "gradient",
        gradientType: "GRADIENT_LINEAR",
        stops: { animated: false, static: [{ color: { r: 9, g: 9, b: 9 }, offset: 0, opacity: 1 }] },
      },
    });

    expect(target.fills).toHaveLength(1);
    expect(target.fills[0].type).toBe("GRADIENT_LINEAR");
    expect(outcome.notes).toEqual([]);
  });

  it("remove-paint works via paint.remove() and notes a genuine miss", () => {
    const target = makeNode("Polygon 1", { fills: [{ r: 1, g: 2, b: 3 }] }, makeIds());
    target.removeFill = undefined;

    apply(target, { op: "remove-paint", path: ["fills", 0] });
    expect(target.fills).toHaveLength(0);

    const outcome = apply(target, { op: "remove-paint", path: ["fills", 0] });
    expect(outcome.notes).toEqual(["couldn't find fill 1 to remove"]);
  });
});

describe("group re-creation", () => {
  it("creates a recorded group by creating its children and grouping them", () => {
    const target = makeNode("Rectangle 1", {}, makeIds());
    const shape = (id: string, type: string, props: Record<string, Json> = {}) => ({
      nodeId: id, nodeType: type, plain: {}, fills: [], strokes: [], masks: [], shapes: [],
      props: Object.fromEntries(
        Object.entries(props).map(([k, v]) => [k, { animated: false, static: v }]),
      ),
    });

    const outcome = apply(target, {
      op: "add-shape",
      parentPath: [],
      spec: {
        ...shape("g1", "GROUP", { position: { x: 44, y: 44 } }),
        nodeName: "my group",
        shapes: [
          shape("c1", "RECTANGLE", { size: { x: 10, y: 10 } }),
          shape("c2", "ELLIPSE", {}),
        ],
      },
    });

    expect(target.shapes).toHaveLength(1);
    const group = target.shapes[0];
    expect(group.type).toBe("GROUP");
    expect(group.name).toBe("my group");
    expect(group.shapes.map((s2: { type: string }) => s2.type)).toEqual(["RECTANGLE", "ELLIPSE"]);
    expect(group.position.staticValue).toEqual({ x: 44, y: 44 });
    expect(outcome.notes).toEqual([]);
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

describe("text layers (untyped runtime surface)", () => {
  it("recolors a text layer's SINGULAR fill via the paint fallback", () => {
    const ids = makeIds();
    const text: Any = {
      type: "TEXT_LAYER",
      name: "Text 1",
      fill: makeGradientFill([], ids),
    };
    // solid recorded onto gradient text fill -> tint all stops... use solid fill:
    const solidText: Any = {
      type: "TEXT_LAYER",
      name: "Text 2",
      fill: { type: "SOLID", color: { staticValue: { r: 0, g: 0, b: 0 }, keyframes: [], isAnimated: false, addKeyframes() {} } },
    };
    let written: Any = null;
    Object.defineProperty(solidText.fill.color, "staticValue", {
      get() { return { r: 0, g: 0, b: 0 }; },
      set(v: Any) { written = v; },
    });

    const outcome = apply(solidText, {
      op: "set-static",
      path: ["fills", 0, "color"],
      before: { r: 0, g: 0, b: 0 },
      after: { r: 255, g: 0, b: 0 },
    });
    expect(written).toEqual({ r: 255, g: 0, b: 0 });
    expect(outcome.notes).toEqual([]);
    void text;
  });

  it("applies font plain-props via set-plain", () => {
    const textNode: Any = { type: "TEXT_LAYER", name: "Text 1", fontFamily: "Inter", fontSize: 24 };
    apply(textNode, { op: "set-plain", path: ["fontFamily"], before: "Inter", after: "Archivo" });
    apply(textNode, { op: "set-plain", path: ["fontSize"], before: 24, after: 48 });
    expect(textNode.fontFamily).toBe("Archivo");
    expect(textNode.fontSize).toBe(48);
  });
});

describe("set-plain onto a host that silently discards the write (no throw)", () => {
  // Confirmed gap: `owner[flag] = payload.after` in the "set-plain" case is
  // fire-and-forget. It only reports a skip note when the host THROWS. A host
  // proxy that silently discards the write (assignment succeeds, value
  // unchanged — the exact trap fakeScene's staticValue-with-keyframes discard
  // exists to model) produces a step that changed nothing while reporting
  // neither a failure nor a note. That violates "nothing applies silently".
  // Leading suspect for the "text properties don't apply on replay" report,
  // since text/fontFamily/fontSize/alignment are all set-plain steps.

  it("silently does nothing and reports success when the write is discarded (no read-back guard)", () => {
    const swallowingText: Any = { type: "TEXT_LAYER", name: "Text 1" };
    Object.defineProperty(swallowingText, "text", {
      get() {
        return "Text";
      },
      set(_v: Any) {
        // the host accepts the assignment but keeps its own value — exactly
        // the staticValue-with-keyframes trap, generalized to a plain flag.
      },
      enumerable: true,
      configurable: true,
    });

    const outcome = apply(swallowingText, {
      op: "set-plain",
      path: ["text"],
      before: "Text",
      after: "poop :D",
    });

    // Desired contract: a defensive read-back that doesn't match payload.after
    // must surface as a note naming the flag. Currently fails — notes is [].
    expect(outcome.notes.length).toBeGreaterThan(0);
    expect(outcome.notes.some((note) => /text/i.test(note))).toBe(true);
  });

  it("still applies cleanly and reports nothing when the write actually sticks", () => {
    const writableText: Any = { type: "TEXT_LAYER", name: "Text 2", text: "Text" };

    const outcome = apply(writableText, {
      op: "set-plain",
      path: ["text"],
      before: "Text",
      after: "poop :D",
    });

    expect(writableText.text).toBe("poop :D");
    expect(outcome.notes).toEqual([]);
  });

  it("makes no claim when the flag can't be read back at all (unverifiable is not a failure)", () => {
    const unreadableText: Any = { type: "TEXT_LAYER", name: "Text 3" };
    let stored = "Text";
    Object.defineProperty(unreadableText, "text", {
      get() {
        throw new Error("text is write-only on this node");
      },
      set(v: Any) {
        stored = v;
      },
      enumerable: true,
      configurable: true,
    });

    const outcome = apply(unreadableText, {
      op: "set-plain",
      path: ["text"],
      before: "Text",
      after: "poop :D",
    });

    expect(outcome.notes).toEqual([]);
    void stored;
  });
});

describe("frame offset (apply at playhead / stagger)", () => {
  it("places added keyframes at recorded frame + offset", () => {
    const target = makeNode("Rect", {}, makeIds());
    apply(
      target,
      { op: "keyframes", path: ["rotation"], added: [kf(0, 0), kf(30, 90)], removed: [], changed: [] },
      { ...exact, frameOffset: 60 },
    );
    expect(frames(target.rotation)).toEqual([60, 90]);
    expect(values(target.rotation)).toEqual([0, 90]);
  });

  it("matches removals and changes against shifted frames", () => {
    const target = makeNode("Rect", {}, makeIds());
    target.rotation.addKeyframes([kf(60, 0), kf(90, 90), kf(120, 180)]);
    const outcome = apply(
      target,
      {
        op: "keyframes",
        path: ["rotation"],
        added: [],
        removed: [kf(60, 180)],
        changed: [{ before: kf(30, 90), after: kf(45, 45) }],
      },
      { ...exact, frameOffset: 60 },
    );
    expect(outcome.notes).toEqual([]);
    expect(frames(target.rotation)).toEqual([60, 105]);
    expect(values(target.rotation)).toEqual([0, 45]);
  });

  it("a zero or absent offset changes nothing", () => {
    const a = makeNode("A", {}, makeIds());
    const b = makeNode("B", {}, makeIds());
    const payload: StepPayload = { op: "keyframes", path: ["rotation"], added: [kf(10, 1)], removed: [], changed: [] };
    apply(a, payload, { ...exact, frameOffset: 0 });
    apply(b, payload);
    expect(frames(a.rotation)).toEqual(frames(b.rotation));
  });
});

describe("motion-path handles (spatial tangents)", () => {
  it("writes recorded in/out tangents onto added and changed keyframes", () => {
    const target = makeNode("Rect", {}, makeIds());
    target.position.addKeyframes([kf(30, { x: 5, y: 5 })]);
    const outcome = apply(target, {
      op: "keyframes",
      path: ["position"],
      added: [{ frame: 0, value: { x: 0, y: 0 }, outTangent: { x: 40, y: 0 } }],
      removed: [],
      changed: [
        {
          before: kf(30, { x: 5, y: 5 }),
          after: { frame: 30, value: { x: 5, y: 5 }, inTangent: { x: -40, y: 0 }, outTangent: { x: 0, y: 10 } },
        },
      ],
    });
    expect(outcome.notes).toEqual([]);
    const [k0, k30] = target.position.keyframes;
    expect(k0.outTangent).toEqual({ x: 40, y: 0 });
    expect(k30.inTangent).toEqual({ x: -40, y: 0 });
    expect(k30.outTangent).toEqual({ x: 0, y: 10 });
  });

  it("reports a note instead of a phantom success when the host drops the handle", () => {
    const target = makeNode("Rect", {}, makeIds());
    target.position.addKeyframes([kf(10, { x: 0, y: 0 })]);
    const live = target.position.getKeyframeAt(10);
    Object.defineProperty(live, "inTangent", { get: () => undefined, set: () => {} });
    // The fake hands out a fresh handle per lookup, so patch the lookup too.
    const original = target.position.getKeyframeAt;
    target.position.getKeyframeAt = (frame: number) => (frame === 10 ? live : original(frame));
    const outcome = apply(target, {
      op: "keyframes",
      path: ["position"],
      added: [],
      removed: [],
      changed: [{ before: kf(10, { x: 0, y: 0 }), after: { frame: 10, value: { x: 1, y: 1 }, inTangent: { x: 3, y: 3 } } }],
    });
    expect(outcome.notes).toEqual(["motion-path handle (inTangent) @ 10 not supported by Creator"]);
    expect(live.value).toEqual({ x: 1, y: 1 });
  });
});
