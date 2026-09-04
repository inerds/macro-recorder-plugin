import { withEditedValue, type EditableValue } from "../../engine/editing";
import type { CaptureOffer } from "../../engine/protocol";
import type { MacroParam } from "../../engine/macro";
import type { PlayOptions } from "../gateways/types";
import type { Macro, MacroStep } from "../types";
import { newId } from "../utils/id";

/**
 * Step-list transforms shared by the reducer and by AppContext (which has to
 * persist the same result through the store). One implementation so the
 * saved macro and the rendered macro can never disagree.
 */

/** Flips `disabled`. Absent, never `false` — imports stay clean. */
export function toggleStepDisabled(steps: MacroStep[], stepId: string): MacroStep[] {
  return steps.map((step) => {
    if (step.id !== stepId) return step;
    if (step.disabled !== true) return { ...step, disabled: true as const };
    const enabled: MacroStep = { ...step };
    delete enabled.disabled;
    return enabled;
  });
}

/** Rewrites one step's editable value (label included). */
export function editStepValue(
  steps: MacroStep[],
  stepId: string,
  value: EditableValue,
): MacroStep[] {
  return steps.map((step) => (step.id === stepId ? withEditedValue(step, value) : step));
}

/**
 * Drops pins whose step is gone (deleted, or merged away by Simplify) and
 * re-labels the survivors from the steps they point at.
 */
export function syncParams(
  params: readonly MacroParam[] | undefined,
  steps: MacroStep[],
): MacroParam[] {
  if (!params || params.length === 0) return [];
  return params.flatMap((param) => {
    const step = steps.find((s) => s.id === param.stepId);
    return step ? [{ stepId: param.stepId, label: step.label }] : [];
  });
}

/** Adds or removes the parameter pin for `stepId`. */
export function toggleParamPin(
  params: readonly MacroParam[] | undefined,
  steps: MacroStep[],
  stepId: string,
): MacroParam[] {
  const current = params ?? [];
  if (current.some((param) => param.stepId === stepId)) {
    return current.filter((param) => param.stepId !== stepId);
  }
  const step = steps.find((s) => s.id === stepId);
  if (!step) return [...current];
  return [...current, { stepId, label: step.label }];
}

/** A macro with new steps, its pins re-synced, `params` omitted when empty. */
export function withSteps(
  macro: Macro,
  steps: MacroStep[],
  params?: readonly MacroParam[],
): Macro {
  const next: Macro = { ...macro, steps };
  const synced = syncParams(params ?? macro.params, steps);
  if (synced.length > 0) next.params = synced;
  else delete next.params;
  return next;
}

/**
 * Reserved store id for the persisted copy of an in-progress review. The
 * pending recording used to live only in reducer memory, so ANY panel reload
 * (Creator re-evaluating plugin.js re-runs `creator.ui.show` and re-creates
 * the iframe; the dev server hot-reloads the UI; the mock→engine reboot in
 * gateways/index.ts) silently destroyed it — reported as "I typed the name
 * and lost the macro". AppContext mirrors the reviewing state into the store
 * under this id and restores it on boot; MACROS_LOADED filters it so the
 * draft never renders as a saved macro.
 */
export const REVIEW_DRAFT_ID = "__macro-review-draft__";

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
  /**
   * How many step executions have completed — raw playback indices, so
   * enabled-space and climbing across repeats, same as `currentStep`. A step
   * is done when its index is below this.
   */
  doneCount: number;
  /**
   * Raw indices of steps that failed. Kept for the rest of the run (a
   * continued failure stays marked) rather than cleared with `error`, which
   * is only the pending decision.
   */
  failedSteps: number[];
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
      /** Standing offer to pull the selected layer's keyframes in (per tick). */
      captureOffer: CaptureOffer | null;
      /** Layers already captured with scope "all" — their key disables. */
      capturedAllLayerIds: string[];
      /** Capture feedback rides the same toast channel idle uses. */
      notice: Notice | null;
      /** Live selection size (per tick; null until known) — 0 keeps the
       *  standing "select a layer" nudge up until something is selected. */
      selectionCount: number | null;
    }
  | {
      mode: "reviewing";
      macros: Macro[];
      steps: MacroStep[];
      name: string;
      /** Steps pinned as parameters — asked for on every play. */
      params: MacroParam[];
      /** The recorded layer — saved onto the macro for selection fallback. */
      source?: { nodeId: string; nodeName?: string };
    }
  | {
      mode: "playing";
      macros: Macro[];
      playing: PlayingState;
      /** Carried through from idle so the expanded step list stays open
       *  (and can highlight the running step) while the macro plays. */
      expandedId: string | null;
    }
  /** Pre-play form for a macro with parameters. */
  | {
      mode: "configuring";
      macros: Macro[];
      macroId: string;
      expandedId: string | null;
      /** Working values, keyed by the pinned step's id. */
      values: Record<string, EditableValue>;
      options: PlayOptions;
    };

export type AppEvent =
  | { type: "MACROS_LOADED"; macros: Macro[] }
  | { type: "RECORD_START"; startedAt: number; selectionCount?: number }
  | { type: "RECORD_SELECTION_COUNT"; count: number }
  | { type: "CAPTURE_OFFER_UPDATED"; offer: CaptureOffer | null }
  | { type: "CAPTURE_DONE"; layerId: string; scope: "all" | "selected" }
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
  | { type: "REVIEW_SET_STEPS"; steps: MacroStep[] }
  | { type: "REVIEW_STEP_TOGGLE"; stepId: string }
  | { type: "REVIEW_STEP_EDIT"; stepId: string; value: EditableValue }
  | { type: "REVIEW_PARAM_TOGGLE"; stepId: string }
  | { type: "REVIEW_SAVE"; macro: Macro }
  | { type: "REVIEW_DISCARD" }
  /** Re-enters review from a persisted draft after a panel reload. */
  | { type: "REVIEW_RESTORE"; draft: Macro }
  | { type: "EXPAND_TOGGLE"; macroId: string }
  | { type: "RENAME_START"; macroId: string }
  | { type: "RENAME_COMMIT"; macroId: string; name: string }
  | { type: "RENAME_CANCEL" }
  | { type: "MACRO_STEP_DELETE"; macroId: string; stepId: string }
  | { type: "MACRO_SET_STEPS"; macroId: string; steps: MacroStep[] }
  | { type: "MACRO_STEP_TOGGLE"; macroId: string; stepId: string }
  | { type: "MACRO_STEP_EDIT"; macroId: string; stepId: string; value: EditableValue }
  | { type: "MACRO_PARAM_TOGGLE"; macroId: string; stepId: string }
  | { type: "DELETE_REQUEST"; macroId: string }
  | { type: "DELETE_CANCEL" }
  | { type: "DELETE_CONFIRM"; macroId: string }
  | { type: "DUPLICATE"; macro: Macro }
  | { type: "IMPORTED"; macro: Macro }
  | {
      type: "CONFIGURE_START";
      macroId: string;
      values: Record<string, EditableValue>;
      options: PlayOptions;
    }
  | { type: "CONFIGURE_CHANGE"; stepId: string; value: EditableValue }
  | { type: "CONFIGURE_CANCEL" }
  | { type: "PLAY_START"; macroId: string; total: number }
  | { type: "PLAY_PROGRESS"; stepIndex: number }
  | { type: "PLAY_STEP_DONE"; stepIndex: number }
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
    case "MACROS_LOADED": {
      // The review draft is pending state, not a macro — never render it.
      const macros = event.macros.filter((m) => m.id !== REVIEW_DRAFT_ID);
      return { ...state, macros };
    }

    case "RECORD_START":
      if (state.mode !== "idle") return state;
      return {
        mode: "recording",
        macros: state.macros,
        steps: [],
        startedAt: event.startedAt,
        confirmingDiscard: false,
        captureOffer: null,
        capturedAllLayerIds: [],
        notice: null,
        selectionCount: typeof event.selectionCount === "number" ? event.selectionCount : null,
      };

    case "STEP_RECEIVED":
      if (state.mode !== "recording") return state;
      return { ...state, steps: [...state.steps, event.step] };

    case "RECORD_SELECTION_COUNT":
      if (state.mode !== "recording") return state;
      return { ...state, selectionCount: event.count };

    case "CAPTURE_OFFER_UPDATED":
      // Late gateway callbacks after stop land here harmlessly.
      if (state.mode !== "recording") return state;
      return { ...state, captureOffer: event.offer };

    case "CAPTURE_DONE":
      if (state.mode !== "recording") return state;
      if (event.scope !== "all") return state;
      return {
        ...state,
        capturedAllLayerIds: state.capturedAllLayerIds.includes(event.layerId)
          ? state.capturedAllLayerIds
          : [...state.capturedAllLayerIds, event.layerId],
      };

    case "RECORD_STOP":
      if (state.mode !== "recording") return state;
      if (state.steps.length === 0) {
        return idleState(state.macros, {
          notice: {
            id: newId(),
            message:
              "Nothing was recorded — the scene didn't change while recording.",
            tone: "info",
          },
        });
      }
      return {
        mode: "reviewing",
        macros: state.macros,
        steps: state.steps,
        name: event.suggestedName,
        params: [],
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
      return { ...state, steps, params: syncParams(state.params, steps) };
    }

    case "REVIEW_SET_STEPS":
      if (state.mode !== "reviewing") return state;
      return {
        ...state,
        steps: event.steps,
        params: syncParams(state.params, event.steps),
      };

    case "REVIEW_STEP_TOGGLE":
      if (state.mode !== "reviewing") return state;
      return { ...state, steps: toggleStepDisabled(state.steps, event.stepId) };

    case "REVIEW_STEP_EDIT": {
      if (state.mode !== "reviewing") return state;
      const steps = editStepValue(state.steps, event.stepId, event.value);
      return { ...state, steps, params: syncParams(state.params, steps) };
    }

    case "REVIEW_PARAM_TOGGLE":
      if (state.mode !== "reviewing") return state;
      return {
        ...state,
        params: toggleParamPin(state.params, state.steps, event.stepId),
      };

    case "REVIEW_SAVE":
      if (state.mode !== "reviewing") return state;
      return idleState([...state.macros, event.macro], {
        notice: {
          id: newId(),
          message: `Saved “${event.macro.name}”`,
          tone: "success",
        },
      });

    case "REVIEW_DISCARD":
      if (state.mode !== "reviewing") return state;
      return idleState(state.macros);

    case "REVIEW_RESTORE":
      // A draft only takes over the resting screen — never interrupt a
      // recording or playback already under way, and an empty draft has
      // nothing worth restoring.
      if (state.mode !== "idle") return state;
      if (event.draft.steps.length === 0) return state;
      return {
        mode: "reviewing",
        macros: state.macros,
        steps: event.draft.steps,
        name: event.draft.name,
        params: event.draft.params ?? [],
        ...(event.draft.source ? { source: event.draft.source } : {}),
      };

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
      return mapMacro(state, event.macroId, (macro) =>
        withSteps(
          macro,
          macro.steps.filter((s) => s.id !== event.stepId),
        ),
      );

    case "MACRO_SET_STEPS":
      if (state.mode !== "idle") return state;
      return mapMacro(state, event.macroId, (macro) => withSteps(macro, event.steps));

    case "MACRO_STEP_TOGGLE":
      if (state.mode !== "idle") return state;
      return mapMacro(state, event.macroId, (macro) =>
        withSteps(macro, toggleStepDisabled(macro.steps, event.stepId)),
      );

    case "MACRO_STEP_EDIT":
      if (state.mode !== "idle") return state;
      return mapMacro(state, event.macroId, (macro) =>
        withSteps(macro, editStepValue(macro.steps, event.stepId, event.value)),
      );

    case "MACRO_PARAM_TOGGLE":
      if (state.mode !== "idle") return state;
      return mapMacro(state, event.macroId, (macro) =>
        withSteps(
          macro,
          macro.steps,
          toggleParamPin(macro.params, macro.steps, event.stepId),
        ),
      );

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

    case "CONFIGURE_START":
      if (state.mode !== "idle") return state;
      return {
        mode: "configuring",
        macros: state.macros,
        macroId: event.macroId,
        expandedId: state.expandedId,
        values: event.values,
        options: event.options,
      };

    case "CONFIGURE_CHANGE":
      if (state.mode !== "configuring") return state;
      return {
        ...state,
        values: { ...state.values, [event.stepId]: event.value },
      };

    case "CONFIGURE_CANCEL":
      if (state.mode !== "configuring") return state;
      return idleState(state.macros, { expandedId: state.expandedId });

    case "PLAY_START":
      // Also from `configuring`: the pre-play form confirms straight into play.
      if (state.mode !== "idle" && state.mode !== "configuring") return state;
      return {
        mode: "playing",
        macros: state.macros,
        // Playing walks the step list visibly, so the card it walks has to be
        // open — whatever was expanded before gives way to the macro playing.
        expandedId: event.macroId,
        playing: {
          macroId: event.macroId,
          currentStep: 0,
          total: event.total,
          error: null,
          doneCount: 0,
          failedSteps: [],
        },
      };

    case "PLAY_PROGRESS":
      if (state.mode !== "playing") return state;
      return {
        ...state,
        playing: { ...state.playing, currentStep: event.stepIndex, error: null },
      };

    case "PLAY_STEP_DONE":
      if (state.mode !== "playing") return state;
      return {
        ...state,
        playing: {
          ...state.playing,
          // Indices are 0-based and arrive in order; the count is the high
          // water mark, so a late duplicate can't walk it backwards.
          doneCount: Math.max(state.playing.doneCount, event.stepIndex + 1),
        },
      };

    case "PLAY_STEP_FAILED":
      if (state.mode !== "playing") return state;
      return {
        ...state,
        playing: {
          ...state.playing,
          error: { stepIndex: event.stepIndex, message: event.message },
          failedSteps: state.playing.failedSteps.includes(event.stepIndex)
            ? state.playing.failedSteps
            : [...state.playing.failedSteps, event.stepIndex],
        },
      };

    case "PLAY_FAILURE_RESOLVED": {
      if (state.mode !== "playing") return state;
      if (event.action !== "stop") {
        return { ...state, playing: { ...state.playing, error: null } };
      }
      // Stop arrives both from a failed step and from the progress row's own
      // Stop button. Either way the run is abandoned part-done, and the scene
      // keeps whatever already landed — say so, since there is no undo.
      const stopped = state.macros.find((m) => m.id === state.playing.macroId);
      const at = Math.min(state.playing.currentStep + 1, state.playing.total);
      return idleState(state.macros, {
        expandedId: state.expandedId,
        ...(stopped
          ? {
              notice: {
                id: newId(),
                message: `Stopped “${stopped.name}” at step ${at} of ${state.playing.total} — earlier steps are still applied`,
                tone: "info" as const,
              },
            }
          : {}),
      });
    }

    case "PLAY_DONE": {
      if (state.mode !== "playing") return state;
      const played = state.macros.find((m) => m.id === state.playing.macroId);
      return idleState(state.macros, {
        expandedId: state.expandedId,
        justPlayedId: state.playing.macroId,
        ...(played
          ? {
              notice: {
                id: newId(),
                message: `Played “${played.name}”`,
                tone: "success" as const,
              },
            }
          : {}),
      });
    }

    case "PLAY_FLASH_CLEAR":
      if (state.mode !== "idle") return state;
      return { ...state, justPlayedId: null };

    case "NOTICE":
      // Idle and recording carry the toast channel (capture feedback lands
      // mid-recording); other modes have no notice surface.
      if (state.mode !== "idle" && state.mode !== "recording") return state;
      return { ...state, notice: event.notice };

    case "NOTICE_CLEAR":
      if (state.mode !== "idle" && state.mode !== "recording") return state;
      return { ...state, notice: null };
  }
}

/** Replaces one macro in an idle state, leaving the rest untouched. */
function mapMacro(
  state: Extract<AppState, { mode: "idle" }>,
  macroId: string,
  update: (macro: Macro) => Macro,
): AppState {
  return {
    ...state,
    macros: state.macros.map((macro) => (macro.id === macroId ? update(macro) : macro)),
  };
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
