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

import {
  applyParamValues,
  editableValueOf,
  type EditableValue,
} from "../../engine/editing";
import { RPC_ERRORS } from "../../engine/protocol";
import { simplifySteps } from "../../engine/simplify";
import type { Gateways } from "../gateways";
import {
  enabledSteps,
  repeatCount,
  type PlaybackRun,
  type PlayOptions,
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

/**
 * Defaults for a macro's parameter form: the pinned steps that still exist
 * and still carry an editable value. A macro whose pins have all gone stale
 * plays straight away rather than showing an empty form.
 */
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
  startRecording(): void;
  /** Pull the offered layer's existing timeline keyframes into the recording. */
  captureLayerKeyframes(scope: "all" | "selected"): void;
  stopRecording(): void;
  requestDiscard(): void;
  cancelDiscard(): void;
  confirmDiscard(): void;

  changeReviewName(name: string): void;
  deleteReviewStep(stepId: string): void;
  simplifyReview(): void;
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
  notify(message: string, tone: Notice["tone"]): void;

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

export function AppProvider({
  gateways,
  children,
}: {
  gateways: Gateways;
  children: ReactNode;
}) {
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

  // Live selection size — keeps the "select a layer" nudge honest.
  useEffect(() => {
    return recorder.onSelectionCount?.((count) => {
      dispatch({ type: "RECORD_SELECTION_COUNT", count });
    });
  }, [recorder]);

  // Recording ended on its own (e.g. the recorded layer was deleted).
  useEffect(() => {
    return recorder.onEnded?.((message) => {
      const current = stateRef.current;
      if (current.mode !== "recording") return;
      if (current.steps.length > 0) {
        const source = recordingSourceRef.current;
        dispatch({
          type: "RECORD_STOP",
          suggestedName: suggestMacroName(current.macros),
          ...(source ? { source } : {}),
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
      const timer = setTimeout(
        () => dispatch({ type: "PLAY_FLASH_CLEAR" }),
        1500,
      );
      return () => clearTimeout(timer);
    }
  }, [state]);

  const notify = useCallback((message: string, tone: Notice["tone"]) => {
    dispatch({
      type: "NOTICE",
      notice: { id: newId(), message, tone },
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

  const recordingSourceRef = useRef<{ nodeId: string; nodeName?: string } | null>(null);

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
          dispatch({ type: "PLAY_DONE" });
          // Steps the targets didn't need or couldn't take are not
          // failures, but staying quiet about them would be the silent
          // half-apply this playback path exists to avoid.
          if (notes.length > 0) {
            console.info("[macro-recorder] playback notes:\n" + notes.join("\n"));
            // Dedupe identical reasons so the toast names what happened:
            // '4 steps skipped — fills not found on this target'.
            const counts = new Map<string, number>();
            for (const note of notes) {
              const reason = note.replace(/^Step \d+ · [^:]+: /, "");
              counts.set(reason, (counts.get(reason) ?? 0) + 1);
            }
            const [topReason, topCount] = [...counts.entries()].sort(
              (a, b) => b[1] - a[1],
            )[0]!;
            const message =
              notes.length === 1
                ? notes[0]!.replace(/^Step (\d+) · ([^:]+): /, "Step $1 ($2): ")
                : `${notes.length} steps adapted or skipped — ${topReason}` +
                  (topCount > 1 ? ` (${topCount} times)` : "") +
                  (counts.size > 1 ? " and other reasons" : "");
            notify(message, "info");
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
        notify("Could not update macro", "error");
      });
    },
    [findMacro, store, notify],
  );

  const actions = useMemo<AppActions>(
    () => ({
      startRecording() {
        recorder
          .start()
          .then((source) => {
            recordingSourceRef.current = source ?? null;
            // Seeds the standing "select a layer" nudge; ticks keep it live
            // and it clears itself the moment something is selected.
            dispatch({
              type: "RECORD_START",
              startedAt: Date.now(),
              ...(typeof source?.selectionCount === "number"
                ? { selectionCount: source.selectionCount }
                : {}),
            });
          })
          .catch((error: unknown) => {
            const message =
              error instanceof Error ? error.message : "Could not start recording";
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
              notify(`Couldn't add keyframes — ${raw}`, "error");
            }
          });
      },
      stopRecording() {
        void recorder.stop().then((finalSteps) => {
          finalSteps.forEach((step) => dispatch({ type: "STEP_RECEIVED", step }));
          const source = recordingSourceRef.current;
          dispatch({
            type: "RECORD_STOP",
            suggestedName: suggestMacroName(stateRef.current.macros),
            ...(source ? { source } : {}),
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
      simplifyReview() {
        const current = stateRef.current;
        if (current.mode !== "reviewing") return;
        const steps = simplifySteps(current.steps);
        dispatch({ type: "REVIEW_SET_STEPS", steps });
        announceSimplify(current.steps.length, steps.length);
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
        void store.save(macro).catch(() => {
          notify("Could not save macro", "error");
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
            notify("Could not rename macro", "error");
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
        updateMacro(macroId, (macro) =>
          withSteps(macro, toggleStepDisabled(macro.steps, stepId)),
        );
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
          notify("Could not delete macro", "error");
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
          notify("Could not duplicate macro", "error");
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
        runMacro(
          { ...macro, steps: applyParamValues(macro, current.values) },
          current.options,
        );
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
