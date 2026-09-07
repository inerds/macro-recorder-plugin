import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import { applyParamValues, editableValueOf, type EditableValue } from "../../engine/editing";
import { RPC_ERRORS } from "../../engine/protocol";
import { trace } from "../dev/trace";
import { simplifySteps } from "../../engine/simplify";
import type { Gateways } from "../gateways";
import {
  enabledSteps,
  repeatCount,
  type PlaybackRun,
  type PlayOptions,
  type RecordingSource,
} from "../gateways/types";
import type { Macro, StepResult } from "../types";
import { copyViaHiddenTextarea } from "../utils/clipboard";
import { newId } from "../utils/id";
import {
  appReducer,
  editStepValue,
  initialState,
  REVIEW_DRAFT_ID,
  suggestMacroName,
  toggleParamPin,
  toggleStepDisabled,
  withSteps,
  type AppState,
  type Notice,
} from "./appReducer";
import { summarizePlaybackNotes } from "./playbackNotes";

/**
 * Defaults for a macro's parameter form: the pinned steps that still exist
 * and still carry an editable value. A macro whose pins have all gone stale
 * plays straight away rather than showing an empty form.
 */
/**
 * The sandbox store passes the host's own rejection text through, or says
 * "Storage full — delete a macro first" when the host names its cap. An RPC
 * timeout carries no user-readable cause, so that one keeps the plain line.
 */
function saveFailureText(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return message && !message.startsWith("timeout")
    ? message
    : "Couldn't save the macro. Try again.";
}

/**
 * How often the resting panel asks what Record would watch. One second is
 * slow enough to cost nothing and fast enough that the readout has caught up
 * before the hand reaches the key.
 */
const PEEK_MS = 1000;

/**
 * Splits a finished session into the two things RECORD_STOP carries: the node
 * that is SAVED onto the macro (selection fallback on replay) and the scope,
 * which is review-screen copy and must never reach the stored macro.
 */
function recordedSource(source: RecordingSource | null): {
  source?: { nodeId: string; nodeName?: string };
  scope?: RecordingSource["scope"];
} {
  if (!source) return {};
  return {
    source: {
      nodeId: source.nodeId,
      ...(source.nodeName ? { nodeName: source.nodeName } : {}),
    },
    ...(source.scope ? { scope: source.scope } : {}),
  };
}

function paramDefaults(macro: Macro): Record<string, EditableValue> {
  const values: Record<string, EditableValue> = {};
  for (const param of macro.params ?? []) {
    const step = macro.steps.find((s) => s.id === param.stepId);
    if (!step) continue;
    const value = editableValueOf(step);
    if (value) values[param.stepId] = value;
  }
  return values;
}

export interface AppActions {
  /**
   * Starts a recording. `exact` — the Option/Alt modifier held on the Record
   * key — records this session's layer-transform steps as their end values
   * rather than as deltas. Per press, never remembered.
   */
  startRecording(options?: { exact?: boolean }): void;
  /** Pull the offered layer's existing timeline keyframes into the recording. */
  captureLayerKeyframes(scope: "all" | "selected"): void;
  stopRecording(): void;
  requestDiscard(): void;
  cancelDiscard(): void;
  confirmDiscard(): void;

  changeReviewName(name: string): void;
  deleteReviewStep(stepId: string): void;
  /** The review sheet's "Keep every step" switch, remembered for the session. */
  setReviewSimplified(simplified: boolean): void;
  toggleReviewStep(stepId: string): void;
  editReviewStep(stepId: string, value: EditableValue): void;
  toggleReviewParam(stepId: string): void;
  saveReview(): void;
  discardReview(): void;

  toggleExpand(macroId: string): void;
  startRename(macroId: string): void;
  commitRename(macroId: string, name: string): void;
  cancelRename(): void;
  deleteMacroStep(macroId: string, stepId: string): void;
  simplifyMacro(macroId: string): void;
  toggleMacroStep(macroId: string, stepId: string): void;
  editMacroStep(macroId: string, stepId: string, value: EditableValue): void;
  toggleMacroParam(macroId: string, stepId: string): void;
  requestDelete(macroId: string): void;
  cancelDelete(): void;
  confirmDelete(macroId: string): void;
  duplicateMacro(macroId: string): void;
  /**
   * Copies the macro's JSON to the clipboard. Resolves null when the copy
   * landed (a toast has been shown); resolves the payload when every
   * clipboard route was denied, so the caller can offer a manual-copy dialog.
   */
  copyMacroJson(macroId: string): Promise<{ name: string; json: string } | null>;
  /** Imports a pasted macro JSON; rejects so the caller can show the error inline. */
  importJson(json: string): Promise<void>;
  /** Shows a toast (and announces it) through the shared notice channel. */
  notify(message: string, tone: Notice["tone"], kind?: Notice["kind"]): void;

  /** Opens the parameter form when the macro has parameters; else plays. */
  play(macroId: string, options?: PlayOptions): void;
  changeConfigureValue(stepId: string, value: EditableValue): void;
  confirmConfigure(): void;
  cancelConfigure(): void;
  resolvePlaybackFailure(action: "continue" | "stop"): void;

  /** Re-read macros from the store (used by dev tools). */
  reloadMacros(): void;
  clearNotice(): void;
}

interface AppContextValue {
  state: AppState;
  actions: AppActions;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used within AppProvider");
  return context;
}

export function AppProvider({ gateways, children }: { gateways: Gateways; children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const playbackRunRef = useRef<PlaybackRun | null>(null);
  const { recorder, playback, store } = gateways;

  useEffect(() => {
    void store.list().then((macros) => {
      dispatch({ type: "MACROS_LOADED", macros });
      // A pending review survives panel reloads as a store draft (see
      // REVIEW_DRAFT_ID) — restore it so a reload mid-naming can no longer
      // lose the recording. The reducer ignores it outside idle.
      const draft = macros.find((m) => m.id === REVIEW_DRAFT_ID);
      if (draft) dispatch({ type: "REVIEW_RESTORE", draft });
    });
  }, [store]);

  // Mirror the in-progress review into the store, debounced per change, so
  // the draft above exists to restore. The cleanup also runs when review
  // exits (save/discard), which cancels any still-pending write — save and
  // discard then remove the draft entry itself.
  useEffect(() => {
    if (state.mode !== "reviewing") return;
    const draft: Macro = {
      id: REVIEW_DRAFT_ID,
      // A blank name would fail the stores' macro-shape check and drop the
      // whole draft — persist the suggestion instead.
      name: state.name.trim() ? state.name : suggestMacroName(state.macros),
      createdAt: Date.now(),
      steps: state.steps,
      ...(state.source ? { source: state.source } : {}),
      ...(state.params.length > 0 ? { params: state.params } : {}),
    };
    const timer = setTimeout(() => {
      void store.save(draft).catch(() => {
        // Losing a draft write is the pre-existing behaviour, not an error
        // worth a toast mid-typing.
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [state, store]);

  useEffect(() => {
    return recorder.onStep((step) => {
      dispatch({ type: "STEP_RECEIVED", step });
    });
  }, [recorder]);

  // The standing keyframe-capture offer, re-evaluated by the recorder each
  // tick (deduped at the gateway). The reducer's mode guard makes a late
  // callback after stop harmless.
  useEffect(() => {
    return recorder.onCaptureOffer?.((offer) => {
      dispatch({ type: "CAPTURE_OFFER_UPDATED", offer });
    });
  }, [recorder]);

  // Edits dropped as out of scope, counted per tick (deduped at the gateway)
  // — the chip's counter is the only place a dropped edit is ever reported.
  useEffect(() => {
    return recorder.onIgnoredCount?.((count) => {
      dispatch({ type: "RECORD_IGNORED_COUNT", count });
    });
  }, [recorder]);

  // The scope grew (a layer this recording created joined it): the chip
  // names it now, and the ref carries it into review at stop.
  useEffect(() => {
    return recorder.onScope?.((scope) => {
      if (recordingSourceRef.current)
        recordingSourceRef.current = { ...recordingSourceRef.current, scope };
      dispatch({ type: "RECORD_SCOPE", scope });
    });
  }, [recorder]);

  // What Record will watch, asked once a second while the panel rests. The
  // sandbox has no timers and cannot volunteer it (docs/architecture.md), so
  // the poll lives here with the rest of the side effects. The reducer hands
  // back the same state for an unchanged answer, so a quiet minute of polling
  // renders nothing. The dependency is the MODE, not the whole state: every
  // dispatch makes a new state object, and depending on it would tear the
  // interval down and start a fresh one on every keystroke in the panel.
  useEffect(() => {
    if (state.mode !== "idle") return;
    const peek = recorder.peekScope?.bind(recorder);
    if (!peek) return;
    let cancelled = false;
    let inFlight = false;
    let failures = 0;
    let timer: number | undefined;
    // The bridge keeps this method out of traces, so a sandbox that cannot
    // answer it (a stale engine without the method — the ENGINE_REV trap)
    // would otherwise fail once a second, invisibly, for the whole session.
    // The first failure is traced, and the interval backs off to 16 s while
    // the failures continue; one success resets it.
    const delay = () => PEEK_MS * 2 ** Math.min(failures, 4);
    const ask = () => {
      // A hidden panel has no readout to keep fresh, and one call still in
      // flight means the sandbox is already answering this question.
      if (cancelled) return;
      if (inFlight || document.hidden) {
        timer = window.setTimeout(ask, delay());
        return;
      }
      inFlight = true;
      void peek()
        .then((preview) => {
          failures = 0;
          if (!cancelled) dispatch({ type: "SCOPE_PEEKED", preview });
        })
        .catch((error: unknown) => {
          // A peek that fails is a caption that stays as it was.
          if (failures === 0) {
            trace.event("scope-peek-failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
          failures += 1;
        })
        .finally(() => {
          inFlight = false;
          if (!cancelled) timer = window.setTimeout(ask, delay());
        });
    };
    ask();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [state.mode, recorder]);

  // Recording ended on its own (e.g. the recorded layer was deleted).
  useEffect(() => {
    return recorder.onEnded?.((message) => {
      const current = stateRef.current;
      if (current.mode !== "recording") return;
      if (current.steps.length > 0) {
        dispatch({
          type: "RECORD_STOP",
          suggestedName: suggestMacroName(current.macros),
          autoSimplify: autoSimplifyRef.current,
          ...recordedSource(recordingSourceRef.current),
        });
      } else {
        dispatch({ type: "DISCARD_CONFIRM" });
      }
      dispatch({
        type: "NOTICE",
        notice: { id: newId(), message, tone: "error" },
      });
    });
  }, [recorder]);

  // Transient success flash after playback.
  useEffect(() => {
    if (state.mode === "idle" && state.justPlayedId) {
      const timer = setTimeout(() => dispatch({ type: "PLAY_FLASH_CLEAR" }), 1500);
      return () => clearTimeout(timer);
    }
  }, [state]);

  const notify = useCallback((message: string, tone: Notice["tone"], kind?: Notice["kind"]) => {
    dispatch({
      type: "NOTICE",
      notice: { id: newId(), message, tone, ...(kind ? { kind } : {}) },
    });
  }, []);

  /** Simplify changes the list under the user's eyes — say what it did. */
  const announceSimplify = useCallback(
    (before: number, after: number) => {
      if (before === after) return;
      notify(`${before} steps merged into ${after}`, "info");
    },
    [notify],
  );

  // The WHOLE source, not just the node: stop and the ended-on-its-own path
  // both have to report the scope the recording was fixed to.
  const recordingSourceRef = useRef<RecordingSource | null>(null);

  /**
   * How the NEXT review sheet opens. A ref, not state — nothing renders from
   * it — and not storage: the plugin iframe has no reliable `localStorage`,
   * and `clientStorage` is a sandbox round trip that a preference does not
   * earn. The choice therefore lasts for the panel session and no longer.
   */
  const autoSimplifyRef = useRef(true);

  const findMacro = useCallback((macroId: string): Macro | undefined => {
    return stateRef.current.macros.find((m) => m.id === macroId);
  }, []);

  // One handler for both play paths (direct and via the parameter form).
  const handlePlaybackEvent = useCallback(
    (event: StepResult) => {
      switch (event.kind) {
        case "progress":
          dispatch({ type: "PLAY_PROGRESS", stepIndex: event.stepIndex });
          break;
        case "step-failed":
          dispatch({
            type: "PLAY_STEP_FAILED",
            stepIndex: event.stepIndex,
            message: event.message,
          });
          break;
        case "done": {
          playbackRunRef.current = null;
          const notes = event.notes ?? [];
          const noteKinds = event.noteKinds ?? [];
          dispatch({ type: "PLAY_DONE" });
          // Steps the targets didn't need or couldn't take are not
          // failures, but staying quiet about them would be the silent
          // half-apply this playback path exists to avoid.
          if (notes.length > 0) {
            console.info("[macro-recorder] playback notes:\n" + notes.join("\n"));
            // Tagged so the toast gives it a long read: this line is the
            // whole report of what the run adapted or skipped.
            notify(summarizePlaybackNotes(notes, noteKinds), "info", "playback-notes");
          }
          break;
        }
        case "step-done":
          dispatch({ type: "PLAY_STEP_DONE", stepIndex: event.stepIndex });
          break;
      }
    },
    [notify],
  );

  /** Starts a run: disabled steps are skipped, repeats multiply the total. */
  const runMacro = useCallback(
    (macro: Macro, options?: PlayOptions) => {
      dispatch({
        type: "PLAY_START",
        macroId: macro.id,
        total: enabledSteps(macro).length * repeatCount(options),
      });
      playbackRunRef.current = playback.run(macro, handlePlaybackEvent, options);
    },
    [playback, handlePlaybackEvent],
  );

  /** Applies a step-list transform to a saved macro and persists the result. */
  const updateMacro = useCallback(
    (macroId: string, update: (macro: Macro) => Macro) => {
      const macro = findMacro(macroId);
      if (!macro) return;
      void store.save(update(macro)).catch(() => {
        notify("Couldn't update the macro. Try again.", "error");
      });
    },
    [findMacro, store, notify],
  );

  const actions = useMemo<AppActions>(
    () => ({
      startRecording(options) {
        recorder
          .start()
          .then((source) => {
            recordingSourceRef.current = source ?? null;
            // The scope is fixed here, at start, and the chip says so for the
            // whole session — the selection is free to move after this. The
            // exact-values modifier is fixed the same way, and for the same
            // reason: what the key said it would do is what the session does.
            dispatch({
              type: "RECORD_START",
              startedAt: Date.now(),
              ...(source?.scope ? { scope: source.scope } : {}),
              ...(options?.exact ? { exact: true } : {}),
            });
          })
          .catch((error: unknown) => {
            const message =
              error instanceof Error ? error.message : "Couldn't start recording. Try again.";
            notify(message, "error");
          });
      },
      captureLayerKeyframes(scope) {
        const current = stateRef.current;
        if (current.mode !== "recording" || !current.captureOffer) return;
        const { layerId, layerName } = current.captureOffer;
        if (!recorder.captureKeyframes) return;
        recorder
          .captureKeyframes(layerId, scope)
          .then((steps) => {
            steps.forEach((step) => dispatch({ type: "STEP_RECEIVED", step }));
            dispatch({ type: "CAPTURE_DONE", layerId, scope });
            const label = layerName ? `“${layerName}”` : "the layer";
            // Scope "all" also carries property/state steps — say "steps".
            const noun =
              scope === "selected"
                ? `keyframe ${steps.length === 1 ? "step" : "steps"}`
                : steps.length === 1
                  ? "step"
                  : "steps";
            notify(`Added ${steps.length} ${noun} from ${label}`, "success");
          })
          .catch((error: unknown) => {
            const raw = error instanceof Error ? error.message : String(error);
            if (raw === RPC_ERRORS.noSelectedKeyframes) {
              notify("None of the selected keyframes belong to this layer — try Add all.", "info");
            } else if (raw === RPC_ERRORS.nodeGone) {
              notify("That layer is no longer in the scene.", "error");
            } else {
              notify("Couldn't add the keyframes. Try again.", "error");
            }
          });
      },
      stopRecording() {
        void recorder.stop().then((finalSteps) => {
          finalSteps.forEach((step) => dispatch({ type: "STEP_RECEIVED", step }));
          dispatch({
            type: "RECORD_STOP",
            suggestedName: suggestMacroName(stateRef.current.macros),
            autoSimplify: autoSimplifyRef.current,
            ...recordedSource(recordingSourceRef.current),
          });
        });
      },
      requestDiscard() {
        const current = stateRef.current;
        if (current.mode === "recording" && current.steps.length === 0) {
          recorder.discard();
        }
        dispatch({ type: "DISCARD_REQUEST" });
      },
      cancelDiscard() {
        dispatch({ type: "DISCARD_CANCEL" });
      },
      confirmDiscard() {
        recorder.discard();
        dispatch({ type: "DISCARD_CONFIRM" });
      },

      changeReviewName(name) {
        dispatch({ type: "REVIEW_NAME_CHANGE", name });
      },
      deleteReviewStep(stepId) {
        dispatch({ type: "REVIEW_STEP_DELETE", stepId });
      },
      setReviewSimplified(simplified) {
        const current = stateRef.current;
        if (current.mode !== "reviewing") return;
        if (current.simplified === simplified) return;
        autoSimplifyRef.current = simplified;
        dispatch({ type: "REVIEW_SIMPLIFIED_TOGGLE", simplified });
        if (simplified) {
          announceSimplify(current.rawSteps.length, simplifySteps(current.rawSteps).length);
        } else {
          notify("Every recorded step is back", "info");
        }
      },
      toggleReviewStep(stepId) {
        dispatch({ type: "REVIEW_STEP_TOGGLE", stepId });
      },
      editReviewStep(stepId, value) {
        dispatch({ type: "REVIEW_STEP_EDIT", stepId, value });
      },
      toggleReviewParam(stepId) {
        dispatch({ type: "REVIEW_PARAM_TOGGLE", stepId });
      },
      saveReview() {
        const current = stateRef.current;
        if (current.mode !== "reviewing") return;
        const macro: Macro = {
          id: newId(),
          name: current.name.trim() || suggestMacroName(current.macros),
          createdAt: Date.now(),
          steps: current.steps,
          ...(current.source ? { source: current.source } : {}),
          ...(current.params.length > 0 ? { params: current.params } : {}),
          // Newly recorded macros play at the playhead by default — the
          // row's popover can still turn it off for the session.
          playOptions: { atPlayhead: true },
        };
        void store.save(macro).catch((error: unknown) => {
          // The sandbox store passes the host's own words through (or
          // "Storage full — delete a macro first" when the host names the
          // cap), so show them instead of a fixed line.
          notify(saveFailureText(error), "error");
        });
        void store.remove(REVIEW_DRAFT_ID).catch(() => {});
        dispatch({ type: "REVIEW_SAVE", macro });
      },
      discardReview() {
        void store.remove(REVIEW_DRAFT_ID).catch(() => {});
        dispatch({ type: "REVIEW_DISCARD" });
      },

      toggleExpand(macroId) {
        dispatch({ type: "EXPAND_TOGGLE", macroId });
      },
      startRename(macroId) {
        dispatch({ type: "RENAME_START", macroId });
      },
      commitRename(macroId, name) {
        const trimmed = name.trim();
        dispatch({ type: "RENAME_COMMIT", macroId, name });
        if (trimmed) {
          void store.rename(macroId, trimmed).catch(() => {
            notify("Couldn't rename the macro. Try again.", "error");
          });
        }
      },
      cancelRename() {
        dispatch({ type: "RENAME_CANCEL" });
      },
      deleteMacroStep(macroId, stepId) {
        dispatch({ type: "MACRO_STEP_DELETE", macroId, stepId });
        updateMacro(macroId, (macro) =>
          withSteps(
            macro,
            macro.steps.filter((s) => s.id !== stepId),
          ),
        );
      },
      simplifyMacro(macroId) {
        const macro = findMacro(macroId);
        if (!macro) return;
        const steps = simplifySteps(macro.steps);
        dispatch({ type: "MACRO_SET_STEPS", macroId, steps });
        updateMacro(macroId, (current) => withSteps(current, steps));
        announceSimplify(macro.steps.length, steps.length);
      },
      toggleMacroStep(macroId, stepId) {
        dispatch({ type: "MACRO_STEP_TOGGLE", macroId, stepId });
        updateMacro(macroId, (macro) => withSteps(macro, toggleStepDisabled(macro.steps, stepId)));
      },
      editMacroStep(macroId, stepId, value) {
        dispatch({ type: "MACRO_STEP_EDIT", macroId, stepId, value });
        updateMacro(macroId, (macro) =>
          withSteps(macro, editStepValue(macro.steps, stepId, value)),
        );
      },
      toggleMacroParam(macroId, stepId) {
        dispatch({ type: "MACRO_PARAM_TOGGLE", macroId, stepId });
        updateMacro(macroId, (macro) =>
          withSteps(macro, macro.steps, toggleParamPin(macro.params, macro.steps, stepId)),
        );
      },
      requestDelete(macroId) {
        dispatch({ type: "DELETE_REQUEST", macroId });
      },
      cancelDelete() {
        dispatch({ type: "DELETE_CANCEL" });
      },
      confirmDelete(macroId) {
        dispatch({ type: "DELETE_CONFIRM", macroId });
        void store.remove(macroId).catch(() => {
          notify("Couldn't delete the macro. Try again.", "error");
        });
      },
      duplicateMacro(macroId) {
        const macro = findMacro(macroId);
        if (!macro) return;
        // Step ids are regenerated, so parameter pins follow their steps.
        const idMap = new Map(macro.steps.map((step) => [step.id, newId()]));
        const copy: Macro = {
          id: newId(),
          name: `${macro.name} copy`,
          createdAt: Date.now(),
          steps: macro.steps.map((step) => ({ ...step, id: idMap.get(step.id)! })),
          ...(macro.source ? { source: macro.source } : {}),
        };
        const params = (macro.params ?? []).flatMap((param) => {
          const stepId = idMap.get(param.stepId);
          return stepId ? [{ ...param, stepId }] : [];
        });
        if (params.length > 0) copy.params = params;
        dispatch({ type: "DUPLICATE", macro: copy });
        void store.save(copy).catch(() => {
          notify("Couldn't duplicate the macro. Try again.", "error");
        });
      },
      async copyMacroJson(macroId) {
        const macro = findMacro(macroId);
        if (!macro) return null;
        const json = store.exportMacro(macro);
        // File downloads are blocked in Creator's sandboxed iframe (no
        // allow-downloads token — see docs/limitations.md), so sharing a macro is
        // copy/paste. The async clipboard is usually denied in that
        // opaque-origin iframe too (same as TraceStrip's copy): try it, then
        // the legacy selection copy while the gesture is still warm, and only
        // then hand the JSON back for a manual-copy dialog.
        try {
          await navigator.clipboard.writeText(json);
          notify(`Copied “${macro.name}” as JSON`, "success");
          return null;
        } catch {
          // Denied or unavailable — fall through to the legacy path.
        }
        if (copyViaHiddenTextarea(json)) {
          notify(`Copied “${macro.name}” as JSON`, "success");
          return null;
        }
        return { name: macro.name, json };
      },
      async importJson(json) {
        const macro = await store.importMacro(json);
        dispatch({ type: "IMPORTED", macro });
        notify(`Imported “${macro.name}”`, "success");
      },
      notify,

      play(macroId, options) {
        const macro = findMacro(macroId);
        if (!macro) return;
        const values = paramDefaults(macro);
        // Parameters turn play into a two-step flow: ask, then run.
        if (Object.keys(values).length > 0) {
          dispatch({
            type: "CONFIGURE_START",
            macroId,
            values,
            options: options ?? {},
          });
          return;
        }
        runMacro(macro, options);
      },
      changeConfigureValue(stepId, value) {
        dispatch({ type: "CONFIGURE_CHANGE", stepId, value });
      },
      confirmConfigure() {
        const current = stateRef.current;
        if (current.mode !== "configuring") return;
        const macro = current.macros.find((m) => m.id === current.macroId);
        if (!macro) {
          dispatch({ type: "CONFIGURE_CANCEL" });
          return;
        }
        // The substituted macro is a throwaway clone — the saved one keeps
        // its recorded values as the parameter defaults.
        runMacro({ ...macro, steps: applyParamValues(macro, current.values) }, current.options);
      },
      cancelConfigure() {
        dispatch({ type: "CONFIGURE_CANCEL" });
      },
      resolvePlaybackFailure(action) {
        playbackRunRef.current?.resolveFailure(action);
        dispatch({ type: "PLAY_FAILURE_RESOLVED", action });
        if (action === "stop") {
          // Stop can also arrive mid-run (the progress row's Stop), where no
          // failure is pending — cancel so the loop actually ends.
          playbackRunRef.current?.cancel();
          playbackRunRef.current = null;
        }
      },

      reloadMacros() {
        void store.list().then((macros) => {
          dispatch({ type: "MACROS_LOADED", macros });
        });
      },
      clearNotice() {
        dispatch({ type: "NOTICE_CLEAR" });
      },
    }),
    [recorder, store, findMacro, notify, runMacro, updateMacro, announceSimplify],
  );

  const value = useMemo(() => ({ state, actions }), [state, actions]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
