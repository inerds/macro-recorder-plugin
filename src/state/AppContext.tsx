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
} from "../../shared/editing";
import { simplifySteps } from "../../shared/simplify";
import type { Gateways } from "../gateways";
import {
  enabledSteps,
  repeatCount,
  type PlaybackRun,
  type PlayOptions,
} from "../gateways/types";
import type { Macro, StepResult } from "../types";
import { newId } from "../utils/id";
import {
  appReducer,
  editStepValue,
  initialState,
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
  exportMacro(macroId: string): void;
  importFile(file: File): void;

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
    });
  }, [store]);

  useEffect(() => {
    return recorder.onStep((step) => {
      dispatch({ type: "STEP_RECEIVED", step });
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
            notify(
              notes.length === 1
                ? notes[0]!
                : `${notes.length} steps adapted or skipped — ${topReason}${
                    counts.size > 1 ? " (+ more, see console)" : ""
                  }${topCount > 1 ? ` ×${topCount}` : ""}`,
              "info",
            );
          }
          break;
        }
        case "step-done":
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
            dispatch({ type: "RECORD_START", startedAt: Date.now() });
          })
          .catch((error: unknown) => {
            const message =
              error instanceof Error ? error.message : "Could not start recording";
            notify(message, "error");
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
        dispatch({ type: "REVIEW_SET_STEPS", steps: simplifySteps(current.steps) });
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
        };
        void store.save(macro).catch(() => {
          notify("Could not save macro", "error");
        });
        dispatch({ type: "REVIEW_SAVE", macro });
      },
      discardReview() {
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
      exportMacro(macroId) {
        const macro = findMacro(macroId);
        if (!macro) return;
        const json = store.exportMacro(macro);
        try {
          const blob = new Blob([json], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = `${macro.name.replace(/[^\w-]+/g, "-")}.macro.json`;
          anchor.click();
          URL.revokeObjectURL(url);
        } catch {
          notify("Could not export macro", "error");
        }
      },
      importFile(file) {
        void file
          .text()
          .then((json) => store.importMacro(json))
          .then((macro) => {
            dispatch({ type: "IMPORTED", macro });
            notify(`Imported "${macro.name}"`, "success");
          })
          .catch((error: unknown) => {
            const message =
              error instanceof Error ? error.message : "Import failed";
            notify(message, "error");
          });
      },

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
    [recorder, store, findMacro, notify, runMacro, updateMacro],
  );

  const value = useMemo(() => ({ state, actions }), [state, actions]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
