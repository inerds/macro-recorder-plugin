import { Button } from "@lottiefiles/creator-plugins-ui";

import type { CaptureOffer, ScopeReport } from "../../engine/protocol";
import type { MacroStep } from "../types";
import { CaptureOfferRow } from "./CaptureOfferRow";
import { ConfirmInline } from "./ConfirmInline";
import { ignoredText, scopeName } from "./scopeText";
import { StepList } from "./StepList";

export interface RecordingViewProps {
  steps: MacroStep[];
  confirmingDiscard: boolean;
  /** What this recording watches, fixed at record start (null until known). */
  scope?: ScopeReport | null;
  /** Running count of edits dropped as outside that scope. */
  ignored?: number;
  captureOffer: CaptureOffer | null;
  capturedAllLayerIds: string[];
  onCapture: (scope: "all" | "selected") => void;
  onStop: () => void;
  onDiscardRequest: () => void;
  onDiscardCancel: () => void;
  onDiscardConfirm: () => void;
}

/**
 * The live feed. The clock and the step counter live in the deck; the bottom
 * bar carries the screen's own decision — Stop (the CTA, same action as the
 * deck's key) against Discard — mirroring the review bar's grammar.
 */
export function RecordingView({
  steps,
  confirmingDiscard,
  scope = null,
  ignored = 0,
  captureOffer,
  capturedAllLayerIds,
  onCapture,
  onStop,
  onDiscardRequest,
  onDiscardCancel,
  onDiscardConfirm,
}: RecordingViewProps) {
  const isLayerScope = scope?.kind === "layers" && scope.layers.length > 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="recording-view">
      <h2 className="sr-only">Recording</h2>
      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2">
        {/* One slot above the feed; the discard confirm outranks the
            capture offer — a destructive decision in progress beats an
            optional affordance. */}
        {confirmingDiscard ? (
          <div className="mb-2">
            <ConfirmInline
              message={`Discard this recording? Its ${
                steps.length === 1 ? "1 step" : `${steps.length} steps`
              } will be lost.`}
              confirmLabel="Discard recording"
              onConfirm={onDiscardConfirm}
              onCancel={onDiscardCancel}
            />
          </div>
        ) : (
          <>
            {captureOffer ? (
              <div className="mb-2">
                <CaptureOfferRow
                  offer={captureOffer}
                  alreadyCapturedAll={capturedAllLayerIds.includes(captureOffer.layerId)}
                  onCapture={onCapture}
                />
              </div>
            ) : null}
            {scope ? (
          <div className="mb-2">
            {/* Standing statement of what is being recorded, not an alert.
                It stacks UNDER the capture offer rather than yielding to it:
                the counter on this chip is the only place a dropped edit is
                ever reported, and a keyframed layer can stay selected for a
                whole session. Not a live region either — the counter moves
                on every dropped edit, and a screen reader reading each one
                would talk over the work. */}
            <div
              className="inline-enter rounded-[10px] border border-dashed border-border bg-muted/60 p-2 text-12 text-muted-foreground"
              role="note"
              data-testid="scope-chip"
            >
              <strong className="font-medium text-foreground">
                {isLayerScope ? `Recording ${scopeName(scope)}.` : "Recording the whole scene."}
              </strong>{" "}
              {isLayerScope
                ? ignored > 0
                  ? `${ignoredText(ignored, scope)}.`
                  : "Edits to other layers are ignored. New layers are recorded."
                : scope.kind === "scene" && scope.fallback === "unresolved"
                  ? "The selection isn't in this scene."
                  : "Select a layer before you press Record to record that layer only."}
            </div>
          </div>
            ) : null}
          </>
        )}
        <div className="flex items-center justify-between gap-2 px-1 pb-1">
          <span className="instrument instrument-red truncate">Live steps</span>
          {/* Not a live region: at one tick every 500ms it read the count
              aloud over everything else. The total is announced once, on stop. */}
          <span className="mono shrink-0 text-10 text-muted-foreground tabular-nums">
            {`${String(steps.length).padStart(2, "0")} ${
              steps.length === 1 ? "step" : "steps"
            }`}
          </span>
        </div>
        {/* A well, not a card: the step rows are `bg-card` themselves, so a
            card behind them would be the same tone. Recessed matches the
            macro list's drawer — steps always sit IN something. */}
        <div className="rack rack-drawer p-1">
          {steps.length === 0 ? (
            <p className="px-2 py-6 text-center text-12 text-muted-foreground">
              {/* The second sentence is the only place the capture offer is
                  named: it appears above the feed on its own terms, and a
                  user who never selects a layer with keyframes never learns
                  it exists. */}
              Recording. Edit your animation — steps appear here as you work.{" "}
              {isLayerScope
                ? "Select a recorded layer that has keyframes to add them to the recording."
                : "Select a layer that has keyframes to add them to the recording."}
            </p>
          ) : (
            <StepList steps={steps} autoScroll />
          )}
        </div>
      </main>
      {/* Stop is the CTA (user decision, 2026-08-24): it duplicates the
          deck's key on purpose — same name, same action — so the screen's
          bottom bar reads like the review bar it hands off to. */}
      {/* Equal tracks, like the deck's own key pair — otherwise DISCARD's
          seven letters out-weigh the four-letter CTA beside it. */}
      <div className="grid grid-cols-2 items-center gap-1.5 border-t border-border bg-background px-3 py-2">
        <Button
          size="sm"
          variant="ghost"
          className="press key key-outline w-full"
          // One question at a time: while the confirm at the top of the feed
          // is asking it, the key that asked goes quiet.
          disabled={confirmingDiscard}
          onClick={onDiscardRequest}
          data-testid="discard-recording-button"
        >
          Discard
        </Button>
        <Button
          size="sm"
          className="press key key-red w-full"
          onClick={onStop}
          data-testid="stop-recording-button"
        >
          Stop
        </Button>
      </div>
    </div>
  );
}
