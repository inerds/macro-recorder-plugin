import { Button } from "@lottiefiles/creator-plugins-ui";
import { useId } from "react";

import { editableValueOf, type EditableValue } from "../../engine/editing";
import type { PlayOptions } from "../gateways/types";
import type { Macro } from "../types";
import { describeControl } from "./formulaControl";
import { describePlayOptions } from "./playOptionsText";
import { formulaError, rgbToHex, StepValueEditor } from "./StepValueEditor";

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
    case "formula": {
      const fields = Object.entries(value.fields);
      // In the control's own language — `+ 30`, `= 500` — so the recorded
      // line reads back as the keys the user is looking at, not as the
      // engine grammar underneath them.
      if (fields.length === 1 && fields[0]![0] === "value") return describeControl(fields[0]![1]);
      return fields.map(([key, text]) => `${key} ${describeControl(text)}`).join(", ");
    }
  }
}

/**
 * Whether this value's editor lays out more than one input.
 *
 * A multi-field editor names each box itself — the component span carries
 * "x" plus the label, sr-only — so a `<label htmlFor>` pointing at the first
 * of them would name that one input twice, once from the row and once from
 * its own span. The row labels the GROUP instead, and every box keeps one
 * accessible name.
 */
export function isMultiField(value: EditableValue): boolean {
  if (value.kind === "vector") return true;
  if (value.kind !== "formula") return false;
  const keys = Object.keys(value.fields);
  return !(keys.length === 1 && keys[0] === "value");
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
  if (a.kind === "formula" || b.kind === "formula") {
    if (a.kind !== "formula" || b.kind !== "formula") return false;
    const keys = Object.keys(a.fields);
    return (
      keys.length === Object.keys(b.fields).length &&
      keys.every((key) => a.fields[key] === b.fields[key])
    );
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
  // One refused formula holds the whole run: the field says what is wrong,
  // and Play stays off until it does not.
  const blocked = rows.some((param) => formulaError(values[param.stepId]) !== null);

  return (
    // Deliberately NOT a native form submission: Creator hosts this panel in
    // a sandboxed iframe, and a sandbox without `allow-forms` silently blocks
    // the submit event — the Play button then does nothing at all (which is
    // exactly what happened in the wild; standalone tabs were unaffected).
    // Click and Enter drive onPlay directly instead.
    <form
      className="flex min-h-0 flex-1 flex-col"
      data-testid="configure-sheet"
      onSubmit={(event) => {
        // Belt and braces where submission IS allowed (standalone): keep the
        // implicit path inert so Enter/click never double-fire onPlay.
        event.preventDefault();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        const target = event.target as HTMLElement;
        // Enter on the sheet's fields plays (the old implicit-submit
        // behavior); buttons keep their own Enter activation.
        if (target instanceof HTMLInputElement && target.type !== "checkbox") {
          event.preventDefault();
          if (!blocked) onPlay();
        }
      }}
    >
      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3">
        <div className="enter-1">
          {/* tabIndex -1: focus lands on the first field (below), but the
              heading stays a programmatic focus target. */}
          <h2 tabIndex={-1} className="instrument instrument-red">
            Set values
            <span className="sr-only"> for &ldquo;{macro.name}&rdquo;</span>
          </h2>
          <p className="mono mt-1 truncate text-12" title={macro.name}>
            {macro.name}
          </p>
          {/* One supporting line. The playback-mode hint is already on the
              row this sheet was opened from. */}
          <p className="mt-0.5 text-11 text-muted-foreground">
            The saved macro keeps its recorded values.
          </p>
          {/* The readout is lowercase (playOptionsText.ts), so it needs a
              label to start the line here — the row badge has one too, for
              screen readers. */}
          {optionSummary && (
            <p className="mt-0.5 text-11 tabular-nums text-muted-foreground">
              Play options: {optionSummary}
            </p>
          )}
        </div>
        <div className="enter-2 mt-3 flex flex-col gap-3">
          {rows.map((param, index) => {
            const fieldId = `${fieldPrefix}-${index}`;
            const labelId = `${fieldId}-label`;
            const value = values[param.stepId]!;
            const grouped = isMultiField(value);
            const step = macro.steps.find((s) => s.id === param.stepId);
            const recorded = step ? editableValueOf(step) : null;
            // Only worth saying once the field has moved away from it.
            const changed = recorded !== null && !sameValue(recorded, value);
            return (
              <div
                key={param.stepId}
                className="flex flex-col gap-1.5"
                {...(grouped ? { role: "group", "aria-labelledby": labelId } : {})}
              >
                {grouped ? (
                  <span id={labelId} className="instrument truncate" title={param.label}>
                    {param.label}
                  </span>
                ) : (
                  <label htmlFor={fieldId} className="instrument truncate" title={param.label}>
                    {param.label}
                  </label>
                )}
                <StepValueEditor
                  {...(grouped ? {} : { id: fieldId })}
                  label={param.label}
                  value={value}
                  onChange={(next) => onChange(param.stepId, next)}
                  autoFocus={index === 0}
                />
                {recorded && changed && (
                  <p className="text-11 text-muted-foreground">recorded: {formatValue(recorded)}</p>
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
          type="button"
          className="press key key-red"
          data-testid="configure-play-button"
          disabled={blocked}
          onClick={onPlay}
        >
          Play
        </Button>
      </div>
    </form>
  );
}
