import { Button, Input, Label } from "@lottiefiles/creator-plugins-ui";
import { useState } from "react";

import type { EditableValue } from "../../engine/editing";
import type { MacroParam } from "../../engine/macro";
import type { ScopeReport } from "../../engine/protocol";
import { describePlaybackMode, playbackModeHint } from "../../engine/playbackMode";
import type { MacroStep } from "../types";
import { ConfirmInline } from "./ConfirmInline";
import { KeepEveryStepToggle } from "./KeepEveryStepToggle";
import { scopeName } from "./scopeText";
import { StepList } from "./StepList";
import { StepListHeader } from "./StepListHeader";

export interface ReviewPanelProps {
  name: string;
  steps: MacroStep[];
  /** The recording as captured — the source the simplify switch reads. */
  rawSteps: MacroStep[];
  /** True while the sheet shows the merged list (how it opens). */
  simplified: boolean;
  params: MacroParam[];
  /** What the recording watched — said once, above the list it produced. */
  scope?: ScopeReport;
  /** The recording was made with the exact-values modifier held. */
  exact?: boolean;
  onNameChange: (name: string) => void;
  onDeleteStep: (stepId: string) => void;
  onSimplifiedChange: (simplified: boolean) => void;
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
  rawSteps,
  simplified,
  params,
  scope,
  exact = false,
  onNameChange,
  onDeleteStep,
  onSimplifiedChange,
  onToggleStep,
  onEditStep,
  onToggleParam,
  onSave,
  onDiscard,
}: ReviewPanelProps) {
  const isEmpty = steps.length === 0;
  // Discarding a recording can't be undone, so a full list asks first.
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  // The scope line below names the recorded layer, so this line says only
  // what a replay does with it: a solo-layer macro applies to the layers you
  // select, and needs a selection.
  const mode = describePlaybackMode({ steps });
  const modeHint = playbackModeHint(mode);

  // What was watched comes before what the list will do on replay: it is the
  // one line that explains why a step the user expected is not in the list.
  const scopeText = !scope
    ? null
    : scope.kind === "layers" && scope.layers.length > 1
      ? `Recorded ${scope.layers.length} layers only`
      : scope.kind === "layers" && scope.layers.length === 1
        ? `Recorded ${scopeName(scope)} only`
        : "Recorded the whole scene";
  // The modifier is part of the same answer — what was watched, and how it
  // was written down — so it extends that line rather than adding one. With
  // no scope to name it still has to be said: the steps replay differently.
  const scopeHint = exact
    ? scopeText
      ? `${scopeText} · exact values`
      : "Recorded exact values"
    : scopeText;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="review-panel">
      <h2 className="sr-only">Review recording</h2>
      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1 py-3">
        <p className="instrument instrument-red enter-1 px-2 pb-2">Review &amp; save</p>
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
                action={
                  <KeepEveryStepToggle
                    rawSteps={rawSteps}
                    simplified={simplified}
                    onSimplifiedChange={onSimplifiedChange}
                  />
                }
                hints={scopeHint ? [scopeHint, modeHint] : [modeHint]}
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
            confirmLabel="Discard recording"
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
