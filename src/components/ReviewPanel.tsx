import { Button, Input, Label } from "@lottiefiles/creator-plugins-ui";
import { useState } from "react";

import type { EditableValue } from "../../shared/editing";
import type { MacroParam } from "../../shared/macro";
import { describePlaybackMode, playbackModeHint } from "../../shared/playbackMode";
import type { MacroStep } from "../types";
import { ConfirmInline } from "./ConfirmInline";
import { StepList } from "./StepList";
import { StepListHeader } from "./StepListHeader";

export interface ReviewPanelProps {
  name: string;
  steps: MacroStep[];
  params: MacroParam[];
  onNameChange: (name: string) => void;
  onDeleteStep: (stepId: string) => void;
  onSimplify: () => void;
  onToggleStep: (stepId: string) => void;
  onEditStep: (stepId: string, value: EditableValue) => void;
  onToggleParam: (stepId: string) => void;
  onSave: () => void;
  onDiscard: () => void;
}

/** Post-recording review: name the macro, prune steps, save or discard. */
export function ReviewPanel({
  name,
  steps,
  params,
  onNameChange,
  onDeleteStep,
  onSimplify,
  onToggleStep,
  onEditStep,
  onToggleParam,
  onSave,
  onDiscard,
}: ReviewPanelProps) {
  const isEmpty = steps.length === 0;
  // Discarding a recording can't be undone, so a full list asks first.
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  return (
    <div className="flex h-full flex-col" data-testid="review-panel">
      <h2 className="sr-only">Review recording</h2>
      <main className="flex-1 overflow-y-auto overflow-x-hidden px-1 py-3">
        <div className="enter-1 flex flex-col gap-1.5 px-2">
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
              All steps were removed. Discard this recording to start over.
            </p>
          ) : (
            <>
              <StepListHeader
                steps={steps}
                onSimplify={onSimplify}
                hints={[playbackModeHint(describePlaybackMode({ steps }))]}
                className="enter-2"
              />
              <div className="enter-3">
                <StepList
                  steps={steps}
                  onDeleteStep={onDeleteStep}
                  onToggleStep={onToggleStep}
                  onEditStep={onEditStep}
                  onToggleParam={onToggleParam}
                  paramIds={params.map((param) => param.stepId)}
                />
              </div>
            </>
          )}
        </div>
      </main>
      {confirmingDiscard && (
        <div className="border-t border-border px-3 py-2">
          <ConfirmInline
            message={`Discard this recording? Its ${
              steps.length === 1 ? "1 step" : `${steps.length} steps`
            } will be lost.`}
            confirmLabel="Discard"
            onConfirm={onDiscard}
            onCancel={() => setConfirmingDiscard(false)}
          />
        </div>
      )}
      <div className="flex items-center justify-between gap-1.5 border-t border-border bg-background px-3 py-2">
        <Button
          size="sm"
          variant="ghost"
          className="press"
          onClick={() => {
            if (isEmpty) onDiscard();
            else setConfirmingDiscard(true);
          }}
          data-testid="discard-review-button"
        >
          Discard
        </Button>
        <Button
          size="sm"
          className="press"
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
