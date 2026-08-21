import {
  Button,
  Input,
  Label,
} from "@lottiefiles/creator-plugins-ui";

import type { MacroStep } from "../types";
import { StepList } from "./StepList";

export interface ReviewPanelProps {
  name: string;
  steps: MacroStep[];
  onNameChange: (name: string) => void;
  onDeleteStep: (stepId: string) => void;
  onSave: () => void;
  onDiscard: () => void;
}

/** Post-recording review: name the macro, prune steps, save or discard. */
export function ReviewPanel({
  name,
  steps,
  onNameChange,
  onDeleteStep,
  onSave,
  onDiscard,
}: ReviewPanelProps) {
  const isEmpty = steps.length === 0;
  return (
    <div className="flex h-full flex-col" data-testid="review-panel">
      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="macro-name">Macro name</Label>
          <Input
            id="macro-name"
            value={name}
            autoFocus
            onChange={(event) => onNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !isEmpty) onSave();
            }}
            data-testid="macro-name-input"
          />
        </div>
        <div className="mt-3">
          {isEmpty ? (
            <p className="px-2 py-6 text-center text-12 text-muted-foreground">
              All steps were removed. Discard this recording, or record again.
            </p>
          ) : (
            <>
              <p className="mb-1 px-2 text-11 font-medium text-muted-foreground">
                {steps.length === 1 ? "1 step" : `${steps.length} steps`}
              </p>
              <StepList steps={steps} onDeleteStep={onDeleteStep} />
            </>
          )}
        </div>
      </div>
      <div className="sticky bottom-0 flex justify-end gap-1.5 border-t border-border bg-background px-3 py-2">
        <Button size="sm" variant="ghost" onClick={onDiscard}>
          Discard
        </Button>
        <Button
          size="sm"
          onClick={onSave}
          disabled={isEmpty}
          data-testid="save-macro-button"
        >
          Save macro
        </Button>
      </div>
    </div>
  );
}
