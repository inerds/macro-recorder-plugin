import { withEditedValue, type EditableValue } from "../../engine/editing";
import { withExactApply } from "../../engine/exact";
import type { CaptureOffer, ScopeReport } from "../../engine/protocol";
import type { MacroParam } from "../../engine/macro";
import { simplifySteps } from "../../engine/simplify";
import type { PlayOptions, ScopePreview } from "../gateways/types";
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
export function withSteps(macro: Macro, steps: MacroStep[], params?: readonly MacroParam[]): Macro {
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
  /**
   * What the notice reports, when the default toast life is wrong for it.
   * A playback report is the ONLY account of what a run adapted or skipped,
   * and it arrives while the eye is still on the scene — 3 s is not enough
   * to find it, let alone read it.
   */
  kind?: "playback-notes";
};

/**
 * How long a notice's toast stays up, or `undefined` for the toast default.
 * An error waits for its reader; a playback report gets a long read.
 */
export function noticeToastDuration(notice: Notice): number | undefined {
  if (notice.tone === "error") return Infinity;
  if (notice.kind === "playback-notes") return 8000;
  return undefined;
}

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
      /**
       * The store has answered at least once. Until it has, an empty list is
       * "not known yet", not "nothing saved" — the empty state's copy and its
       * Record key would otherwise flash on every panel open.
       */
      loaded: boolean;
      /**
       * What Record would watch if it were pressed now, polled from the
       * sandbox while the panel rests. Null until the first answer (and in
       * mock mode without a peek), which the deck reads as "say nothing".
       */
      scopePreview: ScopePreview | null;
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
      /** What this recording watches, fixed at record start (null until the
       *  sandbox answers). See ScopeReport. */
      scope: ScopeReport | null;
      /** Running count of edits dropped as outside that scope (cumulative). */
      ignored: number;
      /**
       * The exact-values modifier was held when Record was pressed, so every
       * eligible transform step is stamped with its recorded end value. Fixed
       * for the session: the modifier is read once, per press.
       */
      exact: boolean;
    }
  | {
      mode: "reviewing";
      macros: Macro[];
      steps: MacroStep[];
      /**
       * The recording exactly as it was captured. The review sheet opens
       * simplified, so the raw list has to survive somewhere: it is what
       * "Keep every step" puts back, and what a later re-simplify reads.
       */
      rawSteps: MacroStep[];
      /** Whether `steps` came from `simplifySteps(rawSteps)` or from `rawSteps`. */
      simplified: boolean;
      name: string;
      /** Steps pinned as parameters — asked for on every play. */
      params: MacroParam[];
      /** The recorded layer — saved onto the macro for selection fallback. */
      source?: { nodeId: string; nodeName?: string };
      /** What the recording watched — the review sheet says so in a hint. */
      scope?: ScopeReport;
      /** The recording was made with the exact-values modifier held. Carried
       *  through so the review hint can say so; the steps already carry it. */
      exact?: boolean;
      /** Review has a toast channel too: Simplify reports its count here. */
      notice: Notice | null;
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
  | { type: "RECORD_START"; startedAt: number; scope?: ScopeReport; exact?: boolean }
  | { type: "RECORD_IGNORED_COUNT"; count: number }
  | { type: "RECORD_SCOPE"; scope: ScopeReport }
  /** The idle poll's answer. Ignored outside idle, and identity-stable when
   *  the answer has not changed — a 1 Hz poll must never re-render. */
  | { type: "SCOPE_PEEKED"; preview: ScopePreview | null }
  | { type: "CAPTURE_OFFER_UPDATED"; offer: CaptureOffer | null }
  | { type: "CAPTURE_DONE"; layerId: string; scope: "all" | "selected" }
  | { type: "STEP_RECEIVED"; step: MacroStep }
  | {
      type: "RECORD_STOP";
      suggestedName: string;
      source?: { nodeId: string; nodeName?: string };
      scope?: ScopeReport;
      /**
       * Open the review sheet on the simplified list. Absent means true —
       * the default the panel sends, and the value every older test means.
       */
      autoSimplify?: boolean;
    }
  | { type: "DISCARD_REQUEST" }
  | { type: "DISCARD_CANCEL" }
  | { type: "DISCARD_CONFIRM" }
  | { type: "REVIEW_NAME_CHANGE"; name: string }
  | { type: "REVIEW_STEP_DELETE"; stepId: string }
  | { type: "REVIEW_SET_STEPS"; steps: MacroStep[] }
  /** The review sheet's "Keep every step" switch. Reviewing only. */
  | { type: "REVIEW_SIMPLIFIED_TOGGLE"; simplified: boolean }
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
    // Every other idle state is reached from a mode the store already
    // answered for; only the first one starts unknown.
    loaded: true,
    // The poll refills this within a second of the panel resting.
    scopePreview: null,
    ...overrides,
  };
}

export const initialState: AppState = idleState([], { loaded: false });

export function appReducer(state: AppState, event: AppEvent): AppState {
  switch (event.type) {
    case "MACROS_LOADED": {
      // The review draft is pending state, not a macro — never render it.
      const macros = event.macros.filter((m) => m.id !== REVIEW_DRAFT_ID);
      if (state.mode === "idle") return { ...state, macros, loaded: true };
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
        scope: event.scope ?? null,
        ignored: 0,
        exact: event.exact === true,
      };

    case "STEP_RECEIVED":
      if (state.mode !== "recording") return state;
      // The stamp happens here, not in the sandbox: what the modifier changes
      // is how the panel stores what the host reported, so the recorder and
      // the engine revision are untouched. `withExactApply` returns every
      // step it does not stamp as the same object.
      return {
        ...state,
        steps: [...state.steps, state.exact ? withExactApply(event.step) : event.step],
      };

    case "RECORD_IGNORED_COUNT":
      if (state.mode !== "recording") return state;
      if (state.ignored === event.count) return state;
      return { ...state, ignored: event.count };

    case "RECORD_SCOPE":
      // The scope grew: a layer this recording created joined it. The chip
      // and, later, the review hint name what is watched NOW.
      if (state.mode !== "recording") return state;
      return { ...state, scope: event.scope };

    case "SCOPE_PEEKED": {
      // Only the resting panel has a readout to fill, and a late answer must
      // not disturb a recording that has already fixed its scope.
      if (state.mode !== "idle") return state;
      if (samePreview(state.scopePreview, event.preview)) return state;
      return { ...state, scopePreview: event.preview };
    }

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
            message: "Nothing was recorded — the scene didn't change while recording.",
            tone: "info",
          },
        });
      }
      {
        // The tick loop turns one drag into a chain of micro-steps, so the
        // sheet opens on the merged list. The raw list is kept beside it and
        // "Keep every step" puts it back.
        const simplified = event.autoSimplify !== false;
        return {
          mode: "reviewing",
          macros: state.macros,
          steps: simplified ? simplifySteps(state.steps) : state.steps,
          rawSteps: state.steps,
          simplified,
          name: event.suggestedName,
          params: [],
          notice: null,
          ...(event.source ? { source: event.source } : {}),
          ...(event.scope ? { scope: event.scope } : {}),
          ...(state.exact ? { exact: true } : {}),
        };
      }

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

    case "REVIEW_SIMPLIFIED_TOGGLE": {
      if (state.mode !== "reviewing") return state;
      if (state.simplified === event.simplified) return state;
      // Params pin step ids, and the two lists do not share all of them —
      // a merged run has one id where the raw recording had five. Pins go.
      return {
        ...state,
        steps: event.simplified ? simplifySteps(state.rawSteps) : state.rawSteps,
        simplified: event.simplified,
        params: [],
      };
    }

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
      // A draft is whatever the user last had on screen, merged or not. It
      // comes back byte-for-byte, so it is the raw list here and the switch
      // still offers to merge it.
      return {
        mode: "reviewing",
        macros: state.macros,
        steps: event.draft.steps,
        rawSteps: event.draft.steps,
        simplified: false,
        name: event.draft.name,
        params: event.draft.params ?? [],
        notice: null,
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
        macros: state.macros.map((m) => (m.id === event.macroId ? { ...m, name } : m)),
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
        withSteps(macro, macro.steps, toggleParamPin(macro.params, macro.steps, event.stepId)),
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
      // Idle, recording and reviewing carry the toast channel: capture
      // feedback lands mid-recording, and Simplify — which rewrites the list
      // under the user's eyes — is offered on the review sheet too. Playing
      // and configuring have no notice surface, and nothing announces from
      // either: a run reports through the idle state it ends in.
      if (!hasNoticeChannel(state)) return state;
      return { ...state, notice: event.notice };

    case "NOTICE_CLEAR":
      if (!hasNoticeChannel(state)) return state;
      return { ...state, notice: null };
  }
}

/**
 * Whether two peeks say the same thing. The poll asks once a second and the
 * answer is almost always identical; comparing the serialized shape is what
 * lets the reducer hand back the SAME state object and render nothing.
 */
function samePreview(a: ScopePreview | null, b: ScopePreview | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The modes that hold a `notice` — the toast and the live region read it. */
export function hasNoticeChannel(
  state: AppState,
): state is Extract<AppState, { notice: Notice | null }> {
  return state.mode === "idle" || state.mode === "recording" || state.mode === "reviewing";
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
