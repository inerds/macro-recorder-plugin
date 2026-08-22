import {
  ThemeProvider,
  ToastProvider,
  useToast,
} from "@lottiefiles/creator-plugins-ui";
import { useEffect, useRef, useState } from "react";

import { DebugStrip } from "./dev/DebugStrip";
import { TraceStrip } from "./dev/TraceStrip";
import type { GatewaysBundle } from "./gateways";
import { ConfigureSheet } from "./components/ConfigureSheet";
import { Deck } from "./components/deck/Deck";
import { MacroList } from "./components/MacroList";
import { RecordingView } from "./components/RecordingView";
import { ReviewPanel } from "./components/ReviewPanel";
import { useApp } from "./state/AppContext";
import { useTheme } from "./theme/useTheme";
import { VINTAGE_TOKENS } from "./theme/vintageTokens";

/**
 * Bridges reducer notices to the component library's toast system — and to
 * assistive tech, which never sees the toast itself.
 */
function NoticeToasts() {
  const { state, actions } = useApp();
  const { toast } = useToast();
  const notice = state.mode === "idle" ? state.notice : null;
  // The key changes on every announcement, identical text included: a live
  // region only speaks when its contents CHANGE, and "Played X" twice in a
  // row is two events the user needs to hear twice.
  const [live, setLive] = useState({ key: 0, message: "" });
  const announce = (message: string) =>
    setLive((previous) => ({ key: previous.key + 1, message }));

  useEffect(() => {
    if (!notice) return;
    announce(notice.message);
    toast({
      title: notice.message,
      variant: notice.tone === "info" ? "default" : notice.tone,
      // Something went wrong: don't time out before it has been read.
      ...(notice.tone === "error" ? { duration: Infinity } : {}),
    });
    actions.clearNotice();
  }, [notice, toast, actions]);

  // Stopping a recording swaps the whole panel for the review sheet with no
  // toast to carry the news. Announce the outcome once, on the way in.
  const mode = state.mode;
  const reviewCount = useRef(0);
  reviewCount.current = state.mode === "reviewing" ? state.steps.length : 0;
  useEffect(() => {
    if (mode !== "reviewing") return;
    const count = reviewCount.current;
    announce(
      `Recording stopped — ${count === 1 ? "1 step" : `${count} steps`} captured`,
    );
  }, [mode]);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      data-testid="notice-live"
    >
      <span key={live.key}>{live.message}</span>
    </div>
  );
}

function Panel({ gateways }: { gateways: GatewaysBundle }) {
  const { state, actions } = useApp();
  // Observed only — the panel wears one committed skin (see vintageTokens.ts).
  useTheme();
  // ToastProvider has no offset prop and its viewport is pinned to bottom-0,
  // so the footer makes room for itself while a toast is up.
  const { toasts } = useToast();

  // Mocks are expected in a standalone tab; inside an iframe (i.e. inside
  // Creator) they mean the sandbox handshake failed — say so loudly instead
  // of silently showing demo data.
  const demoInIframe = gateways.kind === "mock" && window.self !== window.top;

  const configuringMacro =
    state.mode === "configuring"
      ? state.macros.find((macro) => macro.id === state.macroId)
      : undefined;

  return (
    <ThemeProvider tokens={VINTAGE_TOKENS}>
      <div className="panel-root flex h-full flex-col overflow-x-hidden bg-background text-foreground">
        <h1 className="sr-only">Macro Recorder</h1>
        {gateways.staleEngine && (
          <div
            className="border-b border-border bg-destructive/10 px-3 py-1.5 text-11 text-foreground"
            role="alert"
            data-testid="stale-engine-banner"
          >
            <strong>Plugin engine is outdated</strong> ({gateways.staleEngine.sandboxRev} vs{" "}
            {gateways.staleEngine.uiRev}). Remove and re-add the plugin in Creator.
            {import.meta.env.DEV && (
              <> If this keeps happening, restart <code>pnpm dev</code>.</>
            )}
          </div>
        )}
        {demoInIframe && (
          <div
            className="border-b border-border bg-destructive/10 px-3 py-1.5 text-11 text-foreground"
            role="alert"
            data-testid="demo-mode-banner"
          >
            <strong>Demo engine.</strong> Couldn't reach the plugin sandbox —
            recording and playback are simulated. Reload the plugin to retry.
          </div>
        )}
        {/* One transport for every screen. */}
        <div className="shrink-0 p-2 pb-0">
          <Deck />
        </div>
        {state.mode === "recording" ? (
          <RecordingView
            steps={state.steps}
            confirmingDiscard={state.confirmingDiscard}
            onDiscardRequest={actions.requestDiscard}
            onDiscardCancel={actions.cancelDiscard}
            onDiscardConfirm={actions.confirmDiscard}
          />
        ) : state.mode === "reviewing" ? (
          <ReviewPanel
            name={state.name}
            steps={state.steps}
            params={state.params}
            onNameChange={actions.changeReviewName}
            onDeleteStep={actions.deleteReviewStep}
            onSimplify={actions.simplifyReview}
            onToggleStep={actions.toggleReviewStep}
            onEditStep={actions.editReviewStep}
            onToggleParam={actions.toggleReviewParam}
            onSave={actions.saveReview}
            onDiscard={actions.discardReview}
          />
        ) : state.mode === "configuring" && configuringMacro ? (
          <ConfigureSheet
            macro={configuringMacro}
            values={state.values}
            options={state.options}
            onChange={actions.changeConfigureValue}
            onPlay={actions.confirmConfigure}
            onCancel={actions.cancelConfigure}
          />
        ) : (
          // The footer that used to sit below this list carried only a
          // totals line ("N macros · M steps") — folded into the "Saved
          // macros" header row instead (MacroList.tsx) so the list keeps the
          // whole row of chrome that footer cost. Its other job, clearing
          // the bottom-centre toast, moves to this <main> directly.
          <main
            className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden transition-[padding] duration-150 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none ${
              toasts.length > 0 ? "pb-12" : ""
            }`}
          >
            <MacroList
              playing={state.mode === "playing" ? state.playing : null}
            />
          </main>
        )}
        {import.meta.env.DEV && <TraceStrip kind={gateways.kind} />}
        {import.meta.env.DEV && gateways.mocks && (
          <DebugStrip
            mockRecorder={gateways.mocks.recorder}
            mockPlayback={gateways.mocks.playback}
            store={gateways.store}
            onStoreChanged={actions.reloadMacros}
          />
        )}
        <NoticeToasts />
      </div>
    </ThemeProvider>
  );
}

export function App({ gateways }: { gateways: GatewaysBundle }) {
  return (
    <ToastProvider position="bottom-center">
      <Panel gateways={gateways} />
    </ToastProvider>
  );
}
