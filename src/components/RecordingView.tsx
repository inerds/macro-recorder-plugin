import type { MacroStep } from "../types";
import { ConfirmInline } from "./ConfirmInline";
import { RecordingBar } from "./RecordingBar";
import { StepList } from "./StepList";

export interface RecordingViewProps {
  startedAt: number;
  steps: MacroStep[];
  confirmingDiscard: boolean;
  onStop: () => void;
  onDiscardRequest: () => void;
  onDiscardCancel: () => void;
  onDiscardConfirm: () => void;
}

export function RecordingView({
  startedAt,
  steps,
  confirmingDiscard,
  onStop,
  onDiscardRequest,
  onDiscardCancel,
  onDiscardConfirm,
}: RecordingViewProps) {
  return (
    <div className="flex h-full flex-col">
      <h2 className="sr-only">Recording</h2>
      <RecordingBar
        startedAt={startedAt}
        stepCount={steps.length}
        onStop={onStop}
        onDiscard={onDiscardRequest}
      />
      <main className="flex-1 overflow-y-auto overflow-x-hidden p-2">
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
        {steps.length === 0 ? (
          <p className="px-2 py-6 text-center text-12 text-muted-foreground">
            Recording. Edit your animation — steps appear here as you work.
          </p>
        ) : (
          <StepList steps={steps} autoScroll />
        )}
      </main>
    </div>
  );
}
