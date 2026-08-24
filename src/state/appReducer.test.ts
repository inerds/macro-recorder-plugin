import { describe, expect, it } from "vitest";

import { buildStep } from "../../shared/steps";
import type { Macro, MacroStep } from "../types";
import {
  appReducer,
  idleState,
  initialState,
  REVIEW_DRAFT_ID,
  suggestMacroName,
  type AppState,
} from "./appReducer";

function step(id: string): MacroStep {
  return { id, kind: "transform", label: `Step ${id}`, payload: {} };
}

function macro(id: string, name = `Macro ${id}`): Macro {
  return { id, name, createdAt: 0, steps: [step("a"), step("b"), step("c")] };
}

function recordWithSteps(count: number): AppState {
  let state = appReducer(initialState, {
    type: "RECORD_START",
    startedAt: 1000,
  });
  for (let i = 0; i < count; i++) {
    state = appReducer(state, { type: "STEP_RECEIVED", step: step(`s${i}`) });
  }
  return state;
}

describe("recording flow", () => {
  it("starts recording from idle with empty steps", () => {
    const state = appReducer(initialState, {
      type: "RECORD_START",
      startedAt: 1000,
    });
    expect(state).toMatchObject({ mode: "recording", steps: [], startedAt: 1000 });
  });

  it("appends received steps in order", () => {
    const state = recordWithSteps(3);
    expect(state.mode).toBe("recording");
    if (state.mode === "recording") {
      expect(state.steps.map((s) => s.id)).toEqual(["s0", "s1", "s2"]);
    }
  });

  it("ignores RECORD_START outside idle", () => {
    const recording = recordWithSteps(1);
    expect(
      appReducer(recording, { type: "RECORD_START", startedAt: 2000 }),
    ).toBe(recording);
  });

  it("stop with steps moves to reviewing with the suggested name", () => {
    const state = appReducer(recordWithSteps(2), {
      type: "RECORD_STOP",
      suggestedName: "Macro 1",
    });
    expect(state).toMatchObject({ mode: "reviewing", name: "Macro 1" });
  });

  it("stop with zero steps returns to idle with a notice", () => {
    const state = appReducer(recordWithSteps(0), {
      type: "RECORD_STOP",
      suggestedName: "Macro 1",
    });
    expect(state.mode).toBe("idle");
    if (state.mode === "idle") {
      expect(state.notice?.message).toBe(
        "Nothing was recorded — the scene didn't change while recording.",
      );
    }
  });

  it("discard with steps requires confirmation; without steps exits directly", () => {
    const withSteps = appReducer(recordWithSteps(2), { type: "DISCARD_REQUEST" });
    expect(withSteps).toMatchObject({ mode: "recording", confirmingDiscard: true });
    expect(appReducer(withSteps, { type: "DISCARD_CANCEL" })).toMatchObject({
      confirmingDiscard: false,
    });
    expect(appReducer(withSteps, { type: "DISCARD_CONFIRM" }).mode).toBe("idle");

    const empty = appReducer(recordWithSteps(0), { type: "DISCARD_REQUEST" });
    expect(empty.mode).toBe("idle");
  });
});

describe("review flow", () => {
  const reviewing = appReducer(recordWithSteps(3), {
    type: "RECORD_STOP",
    suggestedName: "Macro 1",
  });

  it("edits the name", () => {
    const state = appReducer(reviewing, {
      type: "REVIEW_NAME_CHANGE",
      name: "Bounce",
    });
    expect(state).toMatchObject({ mode: "reviewing", name: "Bounce" });
  });

  it("deletes steps individually", () => {
    const state = appReducer(reviewing, {
      type: "REVIEW_STEP_DELETE",
      stepId: "s1",
    });
    if (state.mode === "reviewing") {
      expect(state.steps.map((s) => s.id)).toEqual(["s0", "s2"]);
    } else {
      expect.fail("expected reviewing state");
    }
  });

  it("save appends the macro and returns to idle with success notice", () => {
    const saved = macro("m1", "Bounce");
    const state = appReducer(reviewing, { type: "REVIEW_SAVE", macro: saved });
    expect(state.mode).toBe("idle");
    expect(state.macros).toContain(saved);
    if (state.mode === "idle") {
      expect(state.notice?.tone).toBe("success");
    }
  });

  it("discard drops the recording", () => {
    const state = appReducer(reviewing, { type: "REVIEW_DISCARD" });
    expect(state.mode).toBe("idle");
    expect(state.macros).toEqual([]);
  });
});

describe("idle list interactions", () => {
  const base = idleState([macro("m1"), macro("m2")]);

  it("expand toggles and collapses", () => {
    const expanded = appReducer(base, { type: "EXPAND_TOGGLE", macroId: "m1" });
    expect(expanded).toMatchObject({ expandedId: "m1" });
    expect(
      appReducer(expanded, { type: "EXPAND_TOGGLE", macroId: "m1" }),
    ).toMatchObject({ expandedId: null });
  });

  it("rename commits trimmed names and rejects empty ones", () => {
    const renaming = appReducer(base, { type: "RENAME_START", macroId: "m1" });
    const committed = appReducer(renaming, {
      type: "RENAME_COMMIT",
      macroId: "m1",
      name: "  New name  ",
    });
    expect(committed.macros.find((m) => m.id === "m1")?.name).toBe("New name");

    const rejected = appReducer(renaming, {
      type: "RENAME_COMMIT",
      macroId: "m1",
      name: "   ",
    });
    expect(rejected.macros.find((m) => m.id === "m1")?.name).toBe("Macro m1");
    expect(rejected).toMatchObject({ renamingId: null });
  });

  it("delete requires confirm and collapses the deleted row", () => {
    const expanded = appReducer(base, { type: "EXPAND_TOGGLE", macroId: "m1" });
    const confirming = appReducer(expanded, {
      type: "DELETE_REQUEST",
      macroId: "m1",
    });
    expect(confirming).toMatchObject({ confirmingDeleteId: "m1" });
    const deleted = appReducer(confirming, {
      type: "DELETE_CONFIRM",
      macroId: "m1",
    });
    expect(deleted.macros.map((m) => m.id)).toEqual(["m2"]);
    expect(deleted).toMatchObject({ expandedId: null, confirmingDeleteId: null });
  });

  it("deletes a step inside a saved macro", () => {
    const state = appReducer(base, {
      type: "MACRO_STEP_DELETE",
      macroId: "m1",
      stepId: "b",
    });
    expect(state.macros.find((m) => m.id === "m1")?.steps.map((s) => s.id)).toEqual(
      ["a", "c"],
    );
  });
});

describe("playback flow", () => {
  const base = idleState([macro("m1")]);
  const playing = appReducer(base, {
    type: "PLAY_START",
    macroId: "m1",
    total: 3,
  });

  it("tracks progress", () => {
    const state = appReducer(playing, { type: "PLAY_PROGRESS", stepIndex: 1 });
    expect(state).toMatchObject({
      mode: "playing",
      playing: { currentStep: 1, error: null },
    });
  });

  it("records a step failure awaiting a decision", () => {
    const state = appReducer(playing, {
      type: "PLAY_STEP_FAILED",
      stepIndex: 2,
      message: "Property not available",
    });
    expect(state.mode).toBe("playing");
    if (state.mode === "playing") {
      expect(state.playing.error).toEqual({
        stepIndex: 2,
        message: "Property not available",
      });
    }
  });

  it("continue clears the error, stop returns to idle", () => {
    const failed = appReducer(playing, {
      type: "PLAY_STEP_FAILED",
      stepIndex: 2,
      message: "x",
    });
    const continued = appReducer(failed, {
      type: "PLAY_FAILURE_RESOLVED",
      action: "continue",
    });
    expect(continued.mode).toBe("playing");
    if (continued.mode === "playing") expect(continued.playing.error).toBeNull();

    const stopped = appReducer(failed, {
      type: "PLAY_FAILURE_RESOLVED",
      action: "stop",
    });
    expect(stopped.mode).toBe("idle");
  });

  it("stopping after a failure says where it stopped and that the run half-landed", () => {
    const failed = appReducer(
      appReducer(playing, { type: "PLAY_PROGRESS", stepIndex: 1 }),
      { type: "PLAY_STEP_FAILED", stepIndex: 1, message: "x" },
    );
    const stopped = appReducer(failed, {
      type: "PLAY_FAILURE_RESOLVED",
      action: "stop",
    });
    expect(stopped.mode).toBe("idle");
    if (stopped.mode === "idle") {
      expect(stopped.notice).toMatchObject({
        message:
          'Stopped “Macro m1” at step 2 of 3 — earlier steps are still applied',
        tone: "info",
      });
    }
  });

  it("stopping a healthy run mid-way announces the same thing", () => {
    const midRun = appReducer(playing, { type: "PLAY_PROGRESS", stepIndex: 2 });
    const stopped = appReducer(midRun, {
      type: "PLAY_FAILURE_RESOLVED",
      action: "stop",
    });
    expect(stopped.mode).toBe("idle");
    if (stopped.mode === "idle") {
      expect(stopped.notice).toMatchObject({
        message:
          'Stopped “Macro m1” at step 3 of 3 — earlier steps are still applied',
        tone: "info",
      });
    }
  });

  it("stopping a macro that is gone still returns to idle, without a notice", () => {
    const orphan = appReducer(idleState([]), {
      type: "PLAY_START",
      macroId: "gone",
      total: 2,
    });
    const stopped = appReducer(orphan, {
      type: "PLAY_FAILURE_RESOLVED",
      action: "stop",
    });
    expect(stopped.mode).toBe("idle");
    if (stopped.mode === "idle") expect(stopped.notice).toBeNull();
  });

  it("done returns to idle with a success flash on the macro", () => {
    const state = appReducer(playing, { type: "PLAY_DONE" });
    expect(state).toMatchObject({ mode: "idle", justPlayedId: "m1" });
    expect(appReducer(state, { type: "PLAY_FLASH_CLEAR" })).toMatchObject({
      justPlayedId: null,
    });
  });

  it("done announces the macro it played", () => {
    const state = appReducer(playing, { type: "PLAY_DONE" });
    expect(state.mode).toBe("idle");
    if (state.mode === "idle") {
      expect(state.notice).toMatchObject({
        message: 'Played “Macro m1”',
        tone: "success",
      });
    }
  });

  it("done on a macro that is gone still returns to idle, without a notice", () => {
    const orphan = appReducer(idleState([]), {
      type: "PLAY_START",
      macroId: "gone",
      total: 1,
    });
    const state = appReducer(orphan, { type: "PLAY_DONE" });
    expect(state.mode).toBe("idle");
    if (state.mode === "idle") expect(state.notice).toBeNull();
  });
});

describe("suggestMacroName", () => {
  it("starts at Macro 1 and increments past the highest suffix", () => {
    expect(suggestMacroName([])).toBe("Macro 1");
    expect(
      suggestMacroName([macro("a", "Macro 4"), macro("b", "Bounce")]),
    ).toBe("Macro 5");
  });
});

/** A step with a real payload — the only kind that is editable. */
function editableStep(id: string, after = 45): MacroStep {
  return {
    ...buildStep({
      op: "set-static",
      path: ["rotation"],
      before: 0,
      after,
      layer: { id: "L1", name: "Rect" },
    }),
    id,
  };
}

function asReviewing(state: AppState): Extract<AppState, { mode: "reviewing" }> {
  if (state.mode !== "reviewing") throw new Error("expected reviewing state");
  return state;
}

function reviewingWith(steps: MacroStep[]): Extract<AppState, { mode: "reviewing" }> {
  let state = appReducer(initialState, { type: "RECORD_START", startedAt: 0 });
  for (const s of steps) state = appReducer(state, { type: "STEP_RECEIVED", step: s });
  return asReviewing(
    appReducer(state, { type: "RECORD_STOP", suggestedName: "Macro 1" }),
  );
}

function macroWith(steps: MacroStep[], params?: Macro["params"]): Macro {
  return {
    id: "m1",
    name: "Macro m1",
    createdAt: 0,
    steps,
    ...(params ? { params } : {}),
  };
}

describe("step disable / edit (review)", () => {
  const reviewing = reviewingWith([editableStep("e1"), step("s2")]);

  it("starts with no parameters", () => {
    expect(reviewing.params).toEqual([]);
  });

  it("toggle sets disabled: true, and removes the key when toggled back", () => {
    const off = appReducer(reviewing, { type: "REVIEW_STEP_TOGGLE", stepId: "e1" });
    if (off.mode !== "reviewing") return expect.fail("expected reviewing state");
    expect(off.steps[0]).toMatchObject({ id: "e1", disabled: true });

    const on = appReducer(off, { type: "REVIEW_STEP_TOGGLE", stepId: "e1" });
    if (on.mode !== "reviewing") return expect.fail("expected reviewing state");
    expect(on.steps[0]).not.toHaveProperty("disabled");
  });

  it("edit replaces the value and rebuilds the label", () => {
    const edited = appReducer(reviewing, {
      type: "REVIEW_STEP_EDIT",
      stepId: "e1",
      value: { kind: "number", value: 90 },
    });
    if (edited.mode !== "reviewing") return expect.fail("expected reviewing state");
    expect(edited.steps[0]?.payload).toMatchObject({ after: 90 });
    expect(edited.steps[0]?.label).toContain("0 → 90");
    expect(edited.steps[0]?.label).not.toBe(reviewing.steps[0]?.label);
  });

  it("ignores an edit for a step with no editable value", () => {
    const edited = appReducer(reviewing, {
      type: "REVIEW_STEP_EDIT",
      stepId: "s2",
      value: { kind: "number", value: 90 },
    });
    if (edited.mode !== "reviewing") return expect.fail("expected reviewing state");
    expect(edited.steps[1]).toEqual(reviewing.steps[1]);
  });

  it("replaces the whole list on set-steps (Simplify)", () => {
    const merged = appReducer(reviewing, {
      type: "REVIEW_SET_STEPS",
      steps: [editableStep("e1", 90)],
    });
    if (merged.mode !== "reviewing") return expect.fail("expected reviewing state");
    expect(merged.steps.map((s) => s.id)).toEqual(["e1"]);
  });

  it("ignores review events outside reviewing", () => {
    const idle = idleState([macro("m1")]);
    expect(appReducer(idle, { type: "REVIEW_STEP_TOGGLE", stepId: "a" })).toBe(idle);
    expect(
      appReducer(idle, {
        type: "REVIEW_STEP_EDIT",
        stepId: "a",
        value: { kind: "number", value: 1 },
      }),
    ).toBe(idle);
    expect(appReducer(idle, { type: "REVIEW_PARAM_TOGGLE", stepId: "a" })).toBe(idle);
    expect(appReducer(idle, { type: "REVIEW_SET_STEPS", steps: [] })).toBe(idle);
  });
});

describe("parameter pins (review)", () => {
  const reviewing = reviewingWith([editableStep("e1"), step("s2")]);
  const pinned = asReviewing(
    appReducer(reviewing, { type: "REVIEW_PARAM_TOGGLE", stepId: "e1" }),
  );

  it("pins a step with its current label, and unpins it again", () => {
    expect(pinned.params).toEqual([
      { stepId: "e1", label: reviewing.steps[0]?.label },
    ]);
    const unpinned = appReducer(pinned, { type: "REVIEW_PARAM_TOGGLE", stepId: "e1" });
    if (unpinned.mode !== "reviewing") return expect.fail("expected reviewing state");
    expect(unpinned.params).toEqual([]);
  });

  it("drops the pin when the step is deleted", () => {
    const deleted = appReducer(pinned, { type: "REVIEW_STEP_DELETE", stepId: "e1" });
    if (deleted.mode !== "reviewing") return expect.fail("expected reviewing state");
    expect(deleted.params).toEqual([]);
  });

  it("drops pins whose step Simplify merged away", () => {
    const merged = appReducer(pinned, {
      type: "REVIEW_SET_STEPS",
      steps: [step("s2")],
    });
    if (merged.mode !== "reviewing") return expect.fail("expected reviewing state");
    expect(merged.params).toEqual([]);
  });

  it("re-labels a surviving pin after the step is edited", () => {
    const edited = appReducer(pinned, {
      type: "REVIEW_STEP_EDIT",
      stepId: "e1",
      value: { kind: "number", value: 90 },
    });
    if (edited.mode !== "reviewing") return expect.fail("expected reviewing state");
    expect(edited.params[0]?.label).toBe(edited.steps[0]?.label);
    expect(edited.params[0]?.label).not.toBe(pinned.params[0]?.label);
  });
});

describe("saved-macro step editing", () => {
  const base = idleState([macroWith([editableStep("e1"), step("s2")]), macro("m2")]);

  it("toggles a step on the named macro only", () => {
    const state = appReducer(base, {
      type: "MACRO_STEP_TOGGLE",
      macroId: "m1",
      stepId: "e1",
    });
    expect(state.macros[0]?.steps[0]).toMatchObject({ disabled: true });
    expect(state.macros[1]).toBe(base.macros[1]);
  });

  it("edits a step's value and label", () => {
    const state = appReducer(base, {
      type: "MACRO_STEP_EDIT",
      macroId: "m1",
      stepId: "e1",
      value: { kind: "number", value: 90 },
    });
    expect(state.macros[0]?.steps[0]?.payload).toMatchObject({ after: 90 });
    expect(state.macros[0]?.steps[0]?.label).toContain("0 → 90");
  });

  it("adds and removes a parameter, omitting `params` when empty", () => {
    const pinned = appReducer(base, {
      type: "MACRO_PARAM_TOGGLE",
      macroId: "m1",
      stepId: "e1",
    });
    expect(pinned.macros[0]?.params).toEqual([
      { stepId: "e1", label: base.macros[0]?.steps[0]?.label },
    ]);
    const unpinned = appReducer(pinned, {
      type: "MACRO_PARAM_TOGGLE",
      macroId: "m1",
      stepId: "e1",
    });
    expect(unpinned.macros[0]).not.toHaveProperty("params");
  });

  it("drops a pin when its step is deleted or simplified away", () => {
    const pinnedBase = idleState([
      macroWith([editableStep("e1"), step("s2")], [{ stepId: "e1", label: "old" }]),
    ]);
    const deleted = appReducer(pinnedBase, {
      type: "MACRO_STEP_DELETE",
      macroId: "m1",
      stepId: "e1",
    });
    expect(deleted.macros[0]).not.toHaveProperty("params");

    const simplified = appReducer(pinnedBase, {
      type: "MACRO_SET_STEPS",
      macroId: "m1",
      steps: [step("s2")],
    });
    expect(simplified.macros[0]?.steps.map((s) => s.id)).toEqual(["s2"]);
    expect(simplified.macros[0]).not.toHaveProperty("params");
  });

  it("re-labels a surviving pin from the edited step", () => {
    const pinnedBase = idleState([
      macroWith([editableStep("e1")], [{ stepId: "e1", label: "old" }]),
    ]);
    const edited = appReducer(pinnedBase, {
      type: "MACRO_STEP_EDIT",
      macroId: "m1",
      stepId: "e1",
      value: { kind: "number", value: 90 },
    });
    expect(edited.macros[0]?.params?.[0]?.label).toBe(edited.macros[0]?.steps[0]?.label);
  });

  it("ignores macro step events outside idle", () => {
    const recording = recordWithSteps(1);
    expect(
      appReducer(recording, { type: "MACRO_STEP_TOGGLE", macroId: "m1", stepId: "e1" }),
    ).toBe(recording);
    expect(
      appReducer(recording, { type: "MACRO_SET_STEPS", macroId: "m1", steps: [] }),
    ).toBe(recording);
    expect(
      appReducer(recording, { type: "MACRO_PARAM_TOGGLE", macroId: "m1", stepId: "e1" }),
    ).toBe(recording);
  });
});

describe("configuring flow", () => {
  const base = idleState([macroWith([editableStep("e1")], [{ stepId: "e1", label: "Rotation" }])]);
  const configuring = appReducer(base, {
    type: "CONFIGURE_START",
    macroId: "m1",
    values: { e1: { kind: "number", value: 45 } },
    options: { repeat: 3 },
  });

  it("enters the parameter form with defaults and the chosen options", () => {
    expect(configuring).toMatchObject({
      mode: "configuring",
      macroId: "m1",
      values: { e1: { kind: "number", value: 45 } },
      options: { repeat: 3 },
    });
  });

  it("changes one value, leaving the others alone", () => {
    const two = appReducer(base, {
      type: "CONFIGURE_START",
      macroId: "m1",
      values: {
        e1: { kind: "number", value: 45 },
        e2: { kind: "text", value: "Star" },
      },
      options: {},
    });
    const changed = appReducer(two, {
      type: "CONFIGURE_CHANGE",
      stepId: "e1",
      value: { kind: "number", value: 90 },
    });
    if (changed.mode !== "configuring") return expect.fail("expected configuring state");
    expect(changed.values).toEqual({
      e1: { kind: "number", value: 90 },
      e2: { kind: "text", value: "Star" },
    });
  });

  it("cancel returns to idle with the macros intact", () => {
    const cancelled = appReducer(configuring, { type: "CONFIGURE_CANCEL" });
    expect(cancelled.mode).toBe("idle");
    expect(cancelled.macros).toEqual(base.macros);
  });

  it("plays straight out of the form", () => {
    const playing = appReducer(configuring, {
      type: "PLAY_START",
      macroId: "m1",
      total: 3,
    });
    expect(playing).toMatchObject({
      mode: "playing",
      playing: { macroId: "m1", total: 3, currentStep: 0 },
    });
  });

  it("ignores CONFIGURE_START outside idle and CONFIGURE_CHANGE outside the form", () => {
    const recording = recordWithSteps(1);
    expect(
      appReducer(recording, {
        type: "CONFIGURE_START",
        macroId: "m1",
        values: {},
        options: {},
      }),
    ).toBe(recording);
    expect(
      appReducer(base, {
        type: "CONFIGURE_CHANGE",
        stepId: "e1",
        value: { kind: "number", value: 1 },
      }),
    ).toBe(base);
    expect(appReducer(base, { type: "CONFIGURE_CANCEL" })).toBe(base);
  });
});

describe("expanded step list survives play and configure", () => {
  it("carries expandedId through PLAY_START → PLAY_DONE and CONFIGURE_START → CONFIGURE_CANCEL", () => {
    const macro = { id: "m1", name: "M", createdAt: 0, steps: [] };
    let state = appReducer(idleState([macro], { expandedId: "m1" }), {
      type: "PLAY_START",
      macroId: "m1",
      total: 1,
    });
    expect(state.mode === "playing" && state.expandedId).toBe("m1");
    state = appReducer(state, { type: "PLAY_DONE" });
    expect(state.mode === "idle" && state.expandedId).toBe("m1");

    state = appReducer(idleState([macro], { expandedId: "m1" }), {
      type: "CONFIGURE_START",
      macroId: "m1",
      values: {},
      options: {},
    });
    expect(state.mode === "configuring" && state.expandedId).toBe("m1");
    state = appReducer(state, { type: "CONFIGURE_CANCEL" });
    expect(state.mode === "idle" && state.expandedId).toBe("m1");
  });
});

describe("review draft restore (panel reload survival)", () => {
  const draft: Macro = {
    id: REVIEW_DRAFT_ID,
    name: "Half-typed na",
    createdAt: 123,
    steps: [step("s0"), step("s1")],
    source: { nodeId: "n1", nodeName: "Layer A" },
    params: [{ stepId: "s0", label: "Step s0" }],
  };

  it("REVIEW_RESTORE re-enters reviewing from idle with the draft's content", () => {
    const state = appReducer(idleState([macro("m1")]), {
      type: "REVIEW_RESTORE",
      draft,
    });
    expect(state).toMatchObject({
      mode: "reviewing",
      name: "Half-typed na",
      source: { nodeId: "n1", nodeName: "Layer A" },
    });
    if (state.mode === "reviewing") {
      expect(state.steps.map((s) => s.id)).toEqual(["s0", "s1"]);
      expect(state.params).toEqual([{ stepId: "s0", label: "Step s0" }]);
      expect(state.macros.map((m) => m.id)).toEqual(["m1"]);
    }
  });

  it("ignores REVIEW_RESTORE outside idle (never interrupts work in progress)", () => {
    const recording = recordWithSteps(1);
    expect(appReducer(recording, { type: "REVIEW_RESTORE", draft })).toBe(recording);

    const reviewing = appReducer(recordWithSteps(1), {
      type: "RECORD_STOP",
      suggestedName: "Macro 1",
    });
    expect(appReducer(reviewing, { type: "REVIEW_RESTORE", draft })).toBe(reviewing);
  });

  it("ignores an empty draft", () => {
    const idle = idleState([]);
    expect(
      appReducer(idle, { type: "REVIEW_RESTORE", draft: { ...draft, steps: [] } }),
    ).toBe(idle);
  });

  it("MACROS_LOADED never surfaces the draft as a saved macro", () => {
    const state = appReducer(idleState([]), {
      type: "MACROS_LOADED",
      macros: [macro("m1"), draft],
    });
    expect(state.macros.map((m) => m.id)).toEqual(["m1"]);

    const reviewing = appReducer(recordWithSteps(1), {
      type: "RECORD_STOP",
      suggestedName: "Macro 1",
    });
    const reloaded = appReducer(reviewing, {
      type: "MACROS_LOADED",
      macros: [macro("m1"), draft],
    });
    expect(reloaded.mode).toBe("reviewing");
    expect(reloaded.macros.map((m) => m.id)).toEqual(["m1"]);
  });
});
