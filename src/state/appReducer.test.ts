import { describe, expect, it } from "vitest";

import type { Macro, MacroStep } from "../types";
import {
  appReducer,
  idleState,
  initialState,
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
      expect(state.notice?.message).toBe("Nothing was recorded");
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

  it("done returns to idle with a success flash on the macro", () => {
    const state = appReducer(playing, { type: "PLAY_DONE" });
    expect(state).toMatchObject({ mode: "idle", justPlayedId: "m1" });
    expect(appReducer(state, { type: "PLAY_FLASH_CLEAR" })).toMatchObject({
      justPlayedId: null,
    });
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
