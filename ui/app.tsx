import { cn, ThemeProvider, ToastProvider, useToast } from "@lottiefiles/creator-plugins-ui";
import { useEffect, useRef, useState } from "react";

import { DebugStrip } from "./dev/DebugStrip";
import { DevSettings } from "./dev/DevSettings";
import { TraceStrip } from "./dev/TraceStrip";
import type { GatewaysBundle } from "./gateways";
import { ConfigureSheet } from "./components/ConfigureSheet";
import { Deck } from "./components/deck/Deck";
import { MacroList } from "./components/MacroList";
import { RecordingView } from "./components/RecordingView";
import { ReviewPanel } from "./components/ReviewPanel";
import { useApp } from "./state/AppContext";
import { hasNoticeChannel, noticeToastDuration } from "./state/appReducer";
import { useHostBackground } from "./theme/useHostBackground";
import { VINTAGE_TOKENS } from "./theme/vintageTokens";

/**
 * Bridges reducer notices to the component library's toast system — and to
 * assistive tech, which never sees the toast itself.
 */
function NoticeToasts() {
  const { state, actions } = useApp();
  const { toast } = useToast();
  const notice = hasNoticeChannel(state) ? state.notice : null;
  // The key changes on every announcement, identical text included: a live
  // region only speaks when its contents CHANGE, and "Played X" twice in a
  // row is two events the user needs to hear twice.
  const [live, setLive] = useState({ key: 0, message: "" });
  const announce = (message: string) => setLive((previous) => ({ key: previous.key + 1, message }));

  useEffect(() => {
    if (!notice) return;
    announce(notice.message);
    const duration = noticeToastDuration(notice);
    toast({
      title: notice.message,
      variant: notice.tone === "info" ? "default" : notice.tone,
      // An error waits for its reader; a playback report gets a long read.
      ...(duration === undefined ? {} : { duration }),
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
    announce(`Recording stopped — ${count === 1 ? "1 step" : `${count} steps`} captured`);
  }, [mode]);

  // The progress row itself is silent (it ticks up to ~20 times a second).
  // A run says one thing on the way in; its outcome — played, stopped, or a
  // report of what it adapted — arrives as the notice above.
  const playingMacroId = state.mode === "playing" ? state.playing.macroId : null;
  const playingTotal = useRef(0);
  playingTotal.current = state.mode === "playing" ? state.playing.total : 0;
  useEffect(() => {
    if (playingMacroId === null) return;
    const total = playingTotal.current;
    announce(`Playing ${total === 1 ? "1 step" : `${total} steps`}…`);
  }, [playingMacroId]);

  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="notice-live">
      <span key={live.key}>{live.message}</span>
    </div>
  );
}

/**
 * A full-screen sheet takes the focused element with it when it closes, and
 * focus falls to `<body>`. Aim it back at the list row the sheet came from —
 * the same move `MacroRow`'s own `restoreFocus` makes after a rename. The
 * frame's wait is for the row to exist: the sheet is still mounted when the
 * key is pressed.
 */
function focusAfterSheet(target: { macroId: string } | "last-row" | "deck") {
  requestAnimationFrame(() => {
    const deck = () => document.querySelector<HTMLElement>('[data-testid="record-button"]');
    if (target === "deck") {
      deck()?.focus();
      return;
    }
    const list = document.querySelector('[data-testid="macro-list"]');
    const rows = list?.querySelectorAll<HTMLElement>("[data-row-disclosure]");
    const row =
      target === "last-row"
        ? rows?.[rows.length - 1]
        : list?.querySelector<HTMLElement>(
            `[data-macro-id="${target.macroId}"] [data-row-disclosure]`,
          );
    (row ?? deck())?.focus();
  });
}

function Panel({
  gateways,
  demoEngine,
}: {
  gateways: GatewaysBundle;
  /** Forced on by `main.tsx` when the gateways could not even be built. */
  demoEngine?: boolean;
}) {
  const { state, actions } = useApp();
  // The frame matches Creator's interface theme; null until the host pushes
  // one, and the CSS fallback (dark) covers that.
  const hostBackground = useHostBackground();
  // ToastProvider has no offset prop and its viewport is pinned to bottom-0,
  // so the footer makes room for itself while a toast is up.
  const { toasts } = useToast();

  // Mocks are expected in a standalone tab; inside an iframe (i.e. inside
  // Creator) they mean the sandbox handshake failed — say so loudly instead
  // of silently showing demo data.
  const demoInIframe =
    demoEngine === true || (gateways.kind === "mock" && window.self !== window.top);

  const configuringMacro =
    state.mode === "configuring"
      ? state.macros.find((macro) => macro.id === state.macroId)
      : undefined;

  return (
    // The panel wears ONE skin and never flips, so the provider is told what
    // that skin is called: `useTheme().themeName` is the only way anything
    // downstream can name it, and an unnamed provider reports `undefined`.
    <ThemeProvider tokens={VINTAGE_TOKENS} themeName="vintage">
      {/* The plate sits on Creator's own chrome — see .host-frame in index.css. */}
      <div
        className="host-frame"
        style={
          hostBackground
            ? ({ "--host-frame-bg": hostBackground } as React.CSSProperties)
            : undefined
        }
      >
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
                <>
                  {" "}
                  If this keeps happening, restart <code>pnpm dev</code>.
                </>
              )}
            </div>
          )}
          {demoInIframe && (
            <div
              className="border-b border-border bg-destructive/10 px-3 py-1.5 text-11 text-foreground"
              role="alert"
              data-testid="demo-mode-banner"
            >
              <strong>Demo engine.</strong> Couldn't reach the plugin sandbox — recording and
              playback are simulated. Reload the plugin to retry.
            </div>
          )}
          {/* One transport for every screen. Full-bleed on purpose: this is the
              machine's faceplate, so it meets the panel edges rather than
              floating on the paper like a card. */}
          <Deck />
          {/* One wrapper for every screen. The toast is pinned to the
              panel's bottom edge and every screen has something there — the
              recording and review bars carry their own decision, and the
              idle list runs to the floor. The room for it is made once,
              here, rather than by the one screen that remembered to. */}
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col transition-[padding] duration-150 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
              toasts.length > 0 && "pb-12",
            )}
          >
            {state.mode === "recording" ? (
              <RecordingView
                steps={state.steps}
                confirmingDiscard={state.confirmingDiscard}
                scope={state.scope}
                ignored={state.ignored}
                exact={state.exact}
                captureOffer={state.captureOffer}
                capturedAllLayerIds={state.capturedAllLayerIds}
                onCapture={actions.captureLayerKeyframes}
                onStop={actions.stopRecording}
                onDiscardRequest={actions.requestDiscard}
                onDiscardCancel={actions.cancelDiscard}
                onDiscardConfirm={actions.confirmDiscard}
              />
            ) : state.mode === "reviewing" ? (
              <ReviewPanel
                name={state.name}
                steps={state.steps}
                rawSteps={state.rawSteps}
                simplified={state.simplified}
                params={state.params}
                scope={state.scope}
                exact={state.exact}
                onNameChange={actions.changeReviewName}
                onDeleteStep={actions.deleteReviewStep}
                onSimplifiedChange={actions.setReviewSimplified}
                onToggleStep={actions.toggleReviewStep}
                onEditStep={actions.editReviewStep}
                onToggleParam={actions.toggleReviewParam}
                // Saving lands the macro at the end of the list; discarding
                // leaves nothing behind, so the deck's Record key takes focus.
                onSave={() => {
                  actions.saveReview();
                  focusAfterSheet("last-row");
                }}
                onDiscard={() => {
                  actions.discardReview();
                  focusAfterSheet("deck");
                }}
              />
            ) : state.mode === "configuring" && configuringMacro ? (
              <ConfigureSheet
                macro={configuringMacro}
                values={state.values}
                options={state.options}
                onChange={actions.changeConfigureValue}
                // Both keys close the sheet and put the macro's own row back
                // on screen — that row is where the focus that opened the
                // sheet came from.
                onPlay={() => {
                  actions.confirmConfigure();
                  focusAfterSheet({ macroId: configuringMacro.id });
                }}
                onCancel={() => {
                  actions.cancelConfigure();
                  focusAfterSheet({ macroId: configuringMacro.id });
                }}
              />
            ) : (
              // The footer that used to sit below this list carried only a
              // totals line ("N macros · M steps") — folded into the "Saved
              // macros" header row instead (MacroList.tsx) so the list keeps the
              // whole row of chrome that footer cost. Its other job, clearing
              // the bottom-centre toast, belongs to the wrapper above.
              <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
                <MacroList playing={state.mode === "playing" ? state.playing : null} />
              </main>
            )}
          </div>
          {import.meta.env.DEV && (
            <DevSettings
              store={gateways.store}
              macroCount={state.macros.length}
              onStoreChanged={actions.reloadMacros}
            >
              <TraceStrip kind={gateways.kind} />
              {gateways.mocks && (
                <DebugStrip
                  mockRecorder={gateways.mocks.recorder}
                  mockPlayback={gateways.mocks.playback}
                />
              )}
            </DevSettings>
          )}
          <NoticeToasts />
        </div>
      </div>
    </ThemeProvider>
  );
}

export function App({
  gateways,
  demoEngine,
}: {
  gateways: GatewaysBundle;
  /** Set by `main.tsx` when gateway selection itself failed. */
  demoEngine?: boolean;
}) {
  return (
    <ToastProvider position="bottom-center">
      <Panel gateways={gateways} {...(demoEngine ? { demoEngine } : {})} />
    </ToastProvider>
  );
}
