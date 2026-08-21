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

import type { Gateways } from "../gateways";
import type { PlaybackRun } from "../gateways/types";
import type { Macro } from "../types";
import { newId } from "../utils/id";
import {
  appReducer,
  initialState,
  suggestMacroName,
  type AppState,
  type Notice,
} from "./appReducer";

export interface AppActions {
  startRecording(): void;
  stopRecording(): void;
  requestDiscard(): void;
  cancelDiscard(): void;
  confirmDiscard(): void;

  changeReviewName(name: string): void;
  deleteReviewStep(stepId: string): void;
  saveReview(): void;
  discardReview(): void;

  toggleExpand(macroId: string): void;
  startRename(macroId: string): void;
  commitRename(macroId: string, name: string): void;
  cancelRename(): void;
  deleteMacroStep(macroId: string, stepId: string): void;
  requestDelete(macroId: string): void;
  cancelDelete(): void;
  confirmDelete(macroId: string): void;
  duplicateMacro(macroId: string): void;
  exportMacro(macroId: string): void;
  importFile(file: File): void;

  play(macroId: string): void;
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
      saveReview() {
        const current = stateRef.current;
        if (current.mode !== "reviewing") return;
        const macro: Macro = {
          id: newId(),
          name: current.name.trim() || suggestMacroName(current.macros),
          createdAt: Date.now(),
          steps: current.steps,
          ...(current.source ? { source: current.source } : {}),
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
        const macro = findMacro(macroId);
        dispatch({ type: "MACRO_STEP_DELETE", macroId, stepId });
        if (macro) {
          const updated: Macro = {
            ...macro,
            steps: macro.steps.filter((s) => s.id !== stepId),
          };
          void store.save(updated).catch(() => {
            notify("Could not update macro", "error");
          });
        }
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
        const copy: Macro = {
          id: newId(),
          name: `${macro.name} copy`,
          createdAt: Date.now(),
          steps: macro.steps.map((step) => ({
            ...step,
            id: newId(),
          })),
        };
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

      play(macroId) {
        const macro = findMacro(macroId);
        if (!macro) return;
        dispatch({ type: "PLAY_START", macroId, total: macro.steps.length });
        playbackRunRef.current = playback.run(macro, (event) => {
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
        });
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
    [recorder, playback, store, findMacro, notify],
  );

  const value = useMemo(() => ({ state, actions }), [state, actions]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
