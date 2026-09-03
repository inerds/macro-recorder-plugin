import { Button, Input, Label } from "@lottiefiles/creator-plugins-ui";
import { useState } from "react";

import type { EditableValue } from "../../shared/editing";
import type { MacroParam } from "../../shared/macro";
import { sharedLayerName } from "../../shared/labels";
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

/** Long enough for a sentence-shaped name, short enough to stay one line. */
const NAME_LIMIT = 50;

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

  // The recorded layer used to ride the list header as an inline "on <layer>"
  // that truncated first and hardest. It belongs in the sentence that already
  // explains the replay — there it is prose, and prose wraps.
  const mode = describePlaybackMode({ steps });
  const layer = sharedLayerName(steps);
  const modeHint =
    mode.mode === "targets" && layer
      ? `Applies to selected layers, or to ${layer} if none is selected`
      : playbackModeHint(mode);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="review-panel">
      <h2 className="sr-only">Review recording</h2>
      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1 py-3">
        <p className="instrument instrument-red enter-1 px-2 pb-2">
          Review &amp; save
        </p>
        <div className="enter-1 flex flex-col gap-1.5 px-2">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="macro-name" className="instrument">
              Macro name
            </Label>
            <span className="mono text-10 text-muted-foreground" aria-hidden>
              {name.length} / {NAME_LIMIT}
            </span>
          </div>
          <Input
            id="macro-name"
            className="mono"
            value={name}
            autoFocus
            maxLength={NAME_LIMIT}
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
                hints={[modeHint]}
                className="enter-2"
              />
              {/* The same well the live feed seats its steps in — the review
                  is the same list, one screen later. */}
              <div className="enter-3 rack rack-drawer p-1">
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
          className="press key key-outline"
          // One question at a time: while the confirm above is asking it,
          // the key that asked goes quiet.
          disabled={confirmingDiscard}
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
          className="press key key-red"
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
