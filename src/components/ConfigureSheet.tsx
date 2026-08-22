import { Button } from "@lottiefiles/creator-plugins-ui";
import { useId } from "react";

import { editableValueOf, type EditableValue } from "../../shared/editing";
import type { PlayOptions } from "../gateways/types";
import type { Macro } from "../types";
import { describePlayOptions } from "./playOptionsText";
import { rgbToHex, StepValueEditor } from "./StepValueEditor";

export interface ConfigureSheetProps {
  macro: Macro;
  values: Record<string, EditableValue>;
  /** The play options this run was started with (shown, not edited here). */
  options?: PlayOptions;
  onChange: (stepId: string, value: EditableValue) => void;
  onPlay: () => void;
  onCancel: () => void;
}

function round2(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** How a recorded value reads in a helper line. */
function formatValue(value: EditableValue): string {
  switch (value.kind) {
    case "number":
      return round2(value.value);
    case "boolean":
      return value.value ? "on" : "off";
    case "text":
      return value.value;
    case "color":
      return rgbToHex(value.value).toUpperCase();
    case "vector":
      return Object.entries(value.value)
        .map(([key, n]) => `${key} ${round2(n)}`)
        .join(", ");
  }
}

/** Whether a field still holds exactly what was recorded. */
function sameValue(a: EditableValue, b: EditableValue): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "vector" && b.kind === "vector") {
    const keys = Object.keys(a.value);
    return (
      keys.length === Object.keys(b.value).length &&
      keys.every((key) => a.value[key] === b.value[key])
    );
  }
  if (a.kind === "color" && b.kind === "color") {
    return a.value.r === b.value.r && a.value.g === b.value.g && a.value.b === b.value.b;
  }
  return a.value === b.value;
}

/** Pre-play form for a macro's pinned parameters (the gizmo knobs). */
export function ConfigureSheet({
  macro,
  values,
  options,
  onChange,
  onPlay,
  onCancel,
}: ConfigureSheetProps) {
  // Pins whose step was deleted or lost its editable value have no row.
  const rows = (macro.params ?? []).filter((param) => values[param.stepId]);
  const fieldPrefix = useId();
  const optionSummary = describePlayOptions(options);

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      data-testid="configure-sheet"
      onSubmit={(event) => {
        event.preventDefault();
        onPlay();
      }}
    >
      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3">
        <div className="enter-1">
          {/* tabIndex -1: focus lands on the first field (below), but the
              heading stays a programmatic focus target. */}
          <h2 tabIndex={-1} className="text-14 font-medium">
            Set values for &ldquo;{macro.name}&rdquo;
          </h2>
          {/* One supporting line. The playback-mode hint is already on the
              row this sheet was opened from. */}
          <p className="mt-0.5 text-11 text-muted-foreground">
            The saved macro keeps its recorded values.
          </p>
          {optionSummary && (
            <p className="mt-0.5 text-11 tabular-nums text-muted-foreground">
              {optionSummary}
            </p>
          )}
        </div>
        <div className="enter-2 mt-3 flex flex-col gap-3">
          {rows.map((param, index) => {
            const fieldId = `${fieldPrefix}-${index}`;
            const step = macro.steps.find((s) => s.id === param.stepId);
            const recorded = step ? editableValueOf(step) : null;
            // Only worth saying once the field has moved away from it.
            const changed = recorded !== null && !sameValue(recorded, values[param.stepId]!);
            return (
              <div key={param.stepId} className="flex flex-col gap-1.5">
                <label
                  htmlFor={fieldId}
                  className="instrument truncate"
                  title={param.label}
                >
                  {param.label}
                </label>
                <StepValueEditor
                  id={fieldId}
                  label={param.label}
                  value={values[param.stepId]!}
                  onChange={(value) => onChange(param.stepId, value)}
                  autoFocus={index === 0}
                />
                {recorded && changed && (
                  <p className="text-11 text-muted-foreground">
                    recorded: {formatValue(recorded)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </main>
      <div className="enter-3 flex justify-end gap-1.5 border-t border-border bg-background px-3 py-2">
        <Button
          size="sm"
          type="button"
          variant="ghost"
          className="press key key-outline"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          type="submit"
          className="press key key-red"
          data-testid="configure-play-button"
        >
          Play
        </Button>
      </div>
    </form>
  );
}
