import { Button } from "@lottiefiles/creator-plugins-ui";

import type { MacroStep } from "../types";
import { ConfirmInline } from "./ConfirmInline";
import { StepList } from "./StepList";

export interface RecordingViewProps {
  steps: MacroStep[];
  confirmingDiscard: boolean;
  onDiscardRequest: () => void;
  onDiscardCancel: () => void;
  onDiscardConfirm: () => void;
}

/**
 * The live feed. Stop, the clock and the step counter all live in the deck —
 * this view owns only the steps as they land and the one way out that the
 * deck can't offer (discarding what has been captured).
 */
export function RecordingView({
  steps,
  confirmingDiscard,
  onDiscardRequest,
  onDiscardCancel,
  onDiscardConfirm,
}: RecordingViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="recording-view">
      <h2 className="sr-only">Recording</h2>
      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2">
        {confirmingDiscard && (
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
        )}
        <div className="flex items-center justify-between gap-2 px-1 pb-1">
          <span className="instrument instrument-red truncate">Live steps</span>
          {/* Not a live region: at one tick every 500ms it read the count
              aloud over everything else. The total is announced once, on stop. */}
          <span className="mono shrink-0 rounded-[6px] border border-border bg-muted px-1.5 py-0.5 text-10 leading-none">
            {steps.length === 1 ? "1 step" : `${steps.length} steps`}
          </span>
        </div>
        <div className="card p-1">
          {steps.length === 0 ? (
            <p className="px-2 py-6 text-center text-12 text-muted-foreground">
              Recording. Edit your animation — steps appear here as you work.
            </p>
          ) : (
            <StepList steps={steps} autoScroll />
          )}
        </div>
      </main>
      {/* Stop is the deck's key, and there is exactly one of it. */}
      <div className="border-t border-border bg-background px-3 py-2">
        <Button
          size="sm"
          variant="ghost"
          className="press key key-outline w-full"
          onClick={onDiscardRequest}
          data-testid="discard-recording-button"
        >
          Discard
        </Button>
      </div>
    </div>
  );
}
