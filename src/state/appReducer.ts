import type { Macro, MacroStep } from "../types";
import { newId } from "../utils/id";

export type Notice = {
  id: string;
  message: string;
  tone: "info" | "success" | "error";
};

export type PlayingState = {
  macroId: string;
  currentStep: number;
  total: number;
  /** Index of the step whose failure awaits a Continue/Stop decision. */
  error: { stepIndex: number; message: string } | null;
};

export type AppState =
  | {
      mode: "idle";
      macros: Macro[];
      expandedId: string | null;
      renamingId: string | null;
      confirmingDeleteId: string | null;
      /** Macro id that just finished playing successfully (for flash). */
      justPlayedId: string | null;
      notice: Notice | null;
    }
  | {
      mode: "recording";
      macros: Macro[];
      steps: MacroStep[];
      startedAt: number;
      confirmingDiscard: boolean;
    }
  | {
      mode: "reviewing";
      macros: Macro[];
      steps: MacroStep[];
      name: string;
      /** The recorded layer — saved onto the macro for selection fallback. */
      source?: { nodeId: string; nodeName?: string };
    }
  | {
      mode: "playing";
      macros: Macro[];
      playing: PlayingState;
    };

export type AppEvent =
  | { type: "MACROS_LOADED"; macros: Macro[] }
  | { type: "RECORD_START"; startedAt: number }
  | { type: "STEP_RECEIVED"; step: MacroStep }
  | {
      type: "RECORD_STOP";
      suggestedName: string;
      source?: { nodeId: string; nodeName?: string };
    }
  | { type: "DISCARD_REQUEST" }
  | { type: "DISCARD_CANCEL" }
  | { type: "DISCARD_CONFIRM" }
  | { type: "REVIEW_NAME_CHANGE"; name: string }
  | { type: "REVIEW_STEP_DELETE"; stepId: string }
  | { type: "REVIEW_SAVE"; macro: Macro }
  | { type: "REVIEW_DISCARD" }
  | { type: "EXPAND_TOGGLE"; macroId: string }
  | { type: "RENAME_START"; macroId: string }
  | { type: "RENAME_COMMIT"; macroId: string; name: string }
  | { type: "RENAME_CANCEL" }
  | { type: "MACRO_STEP_DELETE"; macroId: string; stepId: string }
  | { type: "DELETE_REQUEST"; macroId: string }
  | { type: "DELETE_CANCEL" }
  | { type: "DELETE_CONFIRM"; macroId: string }
  | { type: "DUPLICATE"; macro: Macro }
  | { type: "IMPORTED"; macro: Macro }
  | { type: "PLAY_START"; macroId: string; total: number }
  | { type: "PLAY_PROGRESS"; stepIndex: number }
  | { type: "PLAY_STEP_FAILED"; stepIndex: number; message: string }
  | { type: "PLAY_FAILURE_RESOLVED"; action: "continue" | "stop" }
  | { type: "PLAY_DONE" }
  | { type: "PLAY_FLASH_CLEAR" }
  | { type: "NOTICE"; notice: Notice }
  | { type: "NOTICE_CLEAR" };

export function idleState(
  macros: Macro[],
  overrides?: Partial<Extract<AppState, { mode: "idle" }>>,
): Extract<AppState, { mode: "idle" }> {
  return {
    mode: "idle",
    macros,
    expandedId: null,
    renamingId: null,
    confirmingDeleteId: null,
    justPlayedId: null,
    notice: null,
    ...overrides,
  };
}

export const initialState: AppState = idleState([]);

export function appReducer(state: AppState, event: AppEvent): AppState {
  switch (event.type) {
    case "MACROS_LOADED":
      if (state.mode !== "idle") return { ...state, macros: event.macros };
      return { ...state, macros: event.macros };

    case "RECORD_START":
      if (state.mode !== "idle") return state;
      return {
        mode: "recording",
        macros: state.macros,
        steps: [],
        startedAt: event.startedAt,
        confirmingDiscard: false,
      };

    case "STEP_RECEIVED":
      if (state.mode !== "recording") return state;
      return { ...state, steps: [...state.steps, event.step] };

    case "RECORD_STOP":
      if (state.mode !== "recording") return state;
      if (state.steps.length === 0) {
        return idleState(state.macros, {
          notice: {
            id: newId(),
            message: "Nothing was recorded",
            tone: "info",
          },
        });
      }
      return {
        mode: "reviewing",
        macros: state.macros,
        steps: state.steps,
        name: event.suggestedName,
        ...(event.source ? { source: event.source } : {}),
      };

    case "DISCARD_REQUEST":
      if (state.mode !== "recording") return state;
      if (state.steps.length === 0) return idleState(state.macros);
      return { ...state, confirmingDiscard: true };

    case "DISCARD_CANCEL":
      if (state.mode !== "recording") return state;
      return { ...state, confirmingDiscard: false };

    case "DISCARD_CONFIRM":
      if (state.mode !== "recording") return state;
      return idleState(state.macros);

    case "REVIEW_NAME_CHANGE":
      if (state.mode !== "reviewing") return state;
      return { ...state, name: event.name };

    case "REVIEW_STEP_DELETE": {
      if (state.mode !== "reviewing") return state;
      const steps = state.steps.filter((s) => s.id !== event.stepId);
      return { ...state, steps };
    }

    case "REVIEW_SAVE":
      if (state.mode !== "reviewing") return state;
      return idleState([...state.macros, event.macro], {
        notice: {
          id: newId(),
          message: `Saved "${event.macro.name}"`,
          tone: "success",
        },
      });

    case "REVIEW_DISCARD":
      if (state.mode !== "reviewing") return state;
      return idleState(state.macros);

    case "EXPAND_TOGGLE":
      if (state.mode !== "idle") return state;
      return {
        ...state,
        expandedId: state.expandedId === event.macroId ? null : event.macroId,
        renamingId: null,
        confirmingDeleteId: null,
      };

    case "RENAME_START":
      if (state.mode !== "idle") return state;
      return { ...state, renamingId: event.macroId };

    case "RENAME_COMMIT": {
      if (state.mode !== "idle") return state;
      const name = event.name.trim();
      if (!name) return { ...state, renamingId: null };
      return {
        ...state,
        renamingId: null,
        macros: state.macros.map((m) =>
          m.id === event.macroId ? { ...m, name } : m,
        ),
      };
    }

    case "RENAME_CANCEL":
      if (state.mode !== "idle") return state;
      return { ...state, renamingId: null };

    case "MACRO_STEP_DELETE":
      if (state.mode !== "idle") return state;
      return {
        ...state,
        macros: state.macros.map((m) =>
          m.id === event.macroId
            ? { ...m, steps: m.steps.filter((s) => s.id !== event.stepId) }
            : m,
        ),
      };

    case "DELETE_REQUEST":
      if (state.mode !== "idle") return state;
      return { ...state, confirmingDeleteId: event.macroId };

    case "DELETE_CANCEL":
      if (state.mode !== "idle") return state;
      return { ...state, confirmingDeleteId: null };

    case "DELETE_CONFIRM":
      if (state.mode !== "idle") return state;
      return {
        ...state,
        confirmingDeleteId: null,
        expandedId: state.expandedId === event.macroId ? null : state.expandedId,
        macros: state.macros.filter((m) => m.id !== event.macroId),
      };

    case "DUPLICATE":
    case "IMPORTED":
      if (state.mode !== "idle") return state;
      return { ...state, macros: [...state.macros, event.macro] };

    case "PLAY_START":
      if (state.mode !== "idle") return state;
      return {
        mode: "playing",
        macros: state.macros,
        playing: {
          macroId: event.macroId,
          currentStep: 0,
          total: event.total,
          error: null,
        },
      };

    case "PLAY_PROGRESS":
      if (state.mode !== "playing") return state;
      return {
        ...state,
        playing: { ...state.playing, currentStep: event.stepIndex, error: null },
      };

    case "PLAY_STEP_FAILED":
      if (state.mode !== "playing") return state;
      return {
        ...state,
        playing: {
          ...state.playing,
          error: { stepIndex: event.stepIndex, message: event.message },
        },
      };

    case "PLAY_FAILURE_RESOLVED":
      if (state.mode !== "playing") return state;
      if (event.action === "stop") {
        return idleState(state.macros, {
          expandedId: null,
        });
      }
      return { ...state, playing: { ...state.playing, error: null } };

    case "PLAY_DONE":
      if (state.mode !== "playing") return state;
      return idleState(state.macros, { justPlayedId: state.playing.macroId });

    case "PLAY_FLASH_CLEAR":
      if (state.mode !== "idle") return state;
      return { ...state, justPlayedId: null };

    case "NOTICE":
      if (state.mode !== "idle") return state;
      return { ...state, notice: event.notice };

    case "NOTICE_CLEAR":
      if (state.mode !== "idle") return state;
      return { ...state, notice: null };
  }
}

/** "Macro N" where N is one more than the highest existing suffix. */
export function suggestMacroName(macros: Macro[]): string {
  let max = 0;
  for (const macro of macros) {
    const match = /^Macro (\d+)$/.exec(macro.name);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `Macro ${max + 1}`;
}
