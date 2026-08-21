import { Button } from "@lottiefiles/creator-plugins-ui";

import type { EditableValue } from "../../shared/editing";
import type { Macro } from "../types";
import { StepValueEditor } from "./StepValueEditor";

export interface ConfigureSheetProps {
  macro: Macro;
  values: Record<string, EditableValue>;
  onChange: (stepId: string, value: EditableValue) => void;
  onPlay: () => void;
  onCancel: () => void;
}

/** Pre-play form for a macro's pinned parameters (the gizmo knobs). */
export function ConfigureSheet({
  macro,
  values,
  onChange,
  onPlay,
  onCancel,
}: ConfigureSheetProps) {
  // Pins whose step was deleted or lost its editable value have no row.
  const rows = (macro.params ?? []).filter((param) => values[param.stepId]);

  return (
    <div className="flex h-full flex-col" data-testid="configure-sheet">
      <div className="flex-1 overflow-y-auto p-3">
        <p className="text-12 font-medium">Play {macro.name}</p>
        <p className="mt-0.5 text-11 text-muted-foreground">
          {rows.length === 1
            ? "1 value is asked for on every play."
            : `${rows.length} values are asked for on every play.`}
        </p>
        <div className="mt-3 flex flex-col gap-3">
          {rows.map((param) => (
            <div key={param.stepId} className="flex flex-col gap-1.5">
              <span className="text-11 text-muted-foreground" title={param.label}>
                {param.label}
              </span>
              <StepValueEditor
                value={values[param.stepId]!}
                onChange={(value) => onChange(param.stepId, value)}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="sticky bottom-0 flex justify-end gap-1.5 border-t border-border bg-background px-3 py-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={onPlay} data-testid="configure-play-button">
          Play
        </Button>
      </div>
    </div>
  );
}
