import { Button } from "@lottiefiles/creator-plugins-ui";

import type { CaptureOffer } from "../../shared/protocol";
import type { MacroStep } from "../types";
import { CaptureOfferRow } from "./CaptureOfferRow";
import { ConfirmInline } from "./ConfirmInline";
import { StepList } from "./StepList";

export interface RecordingViewProps {
  steps: MacroStep[];
  confirmingDiscard: boolean;
  /** Recording began with nothing selected — nudge, don't gate. */
  startedWithoutSelection?: boolean;
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
  startedWithoutSelection,
  captureOffer,
  capturedAllLayerIds,
  onCapture,
  onStop,
  onDiscardRequest,
  onDiscardCancel,
  onDiscardConfirm,
}: RecordingViewProps) {
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
              message={`Discard this recording (${steps.length} ${
                steps.length === 1 ? "step" : "steps"
              })?`}
              confirmLabel="Discard"
              onConfirm={onDiscardConfirm}
              onCancel={onDiscardCancel}
            />
          </div>
        ) : captureOffer ? (
          <div className="mb-2">
            <CaptureOfferRow
              offer={captureOffer}
              alreadyCapturedAll={capturedAllLayerIds.includes(captureOffer.layerId)}
              onCapture={onCapture}
            />
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2 px-1 pb-1">
          <span className="instrument instrument-red truncate">Live steps</span>
          {/* Not a live region: at one tick every 500ms it read the count
              aloud over everything else. The total is announced once, on stop. */}
          <span className="mono shrink-0 rounded-[7px] border border-border bg-muted px-1.5 py-0.5 text-10 leading-none">
            {steps.length === 1 ? "1 step" : `${steps.length} steps`}
          </span>
        </div>
        {/* A well, not a card: the step rows are `bg-card` themselves, so a
            card behind them would be the same tone. Recessed matches the
            macro list's drawer — steps always sit IN something. */}
        <div className="rack rack-drawer p-1">
          {steps.length === 0 ? (
            startedWithoutSelection ? (
              <p className="px-2 py-6 text-center text-12 text-muted-foreground">
                Recording the whole scene — nothing was selected.
                <br />
                <span className="text-11">
                  Tip: record with <strong className="font-medium">one layer selected</strong> to
                  make a macro you can replay on any layer.
                </span>
              </p>
            ) : (
              <p className="px-2 py-6 text-center text-12 text-muted-foreground">
                Recording. Edit your animation — steps appear here as you work.
              </p>
            )
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
