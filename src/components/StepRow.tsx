import {
  Circle,
  Diamond,
  Eye,
  EyeOff,
  Layers,
  Move,
  PaintBucket,
  PenLine,
  Pencil,
  Pin,
  Shapes,
  Scissors,
  X,
} from "lucide-react";
import { useState } from "react";

import { editableValueOf, type EditableValue } from "../../shared/editing";
import type { MacroStep, StepKind } from "../types";
import { StepValueEditor } from "./StepValueEditor";

const KIND_ICONS: Record<StepKind, typeof Move> = {
  transform: Move,
  fill: PaintBucket,
  stroke: PenLine,
  keyframe: Diamond,
  layer: Layers,
  shape: Shapes,
  mask: Scissors,
  other: Circle,
};

/** Hover/focus-revealed row action. Shown permanently when `pinned`. */
const ACTION_CLASS =
  "size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-secondary-foreground focus-visible:flex group-hover:flex group-focus-within:flex";

export interface StepRowProps {
  step: MacroStep;
  index: number;
  onDelete?: (stepId: string) => void;
  /** Enable/disable the step for playback. */
  onToggle?: (stepId: string) => void;
  /** Commit a new value for an editable step. */
  onEdit?: (stepId: string, value: EditableValue) => void;
  /** Pin/unpin the step as a macro parameter. */
  onToggleParam?: (stepId: string) => void;
  /** This step is currently pinned as a parameter. */
  param?: boolean;
  /** Highlight as the currently-running playback step. */
  active?: boolean;
}

export function StepRow({
  step,
  index,
  onDelete,
  onToggle,
  onEdit,
  onToggleParam,
  param,
  active,
}: StepRowProps) {
  const Icon = KIND_ICONS[step.kind];
  const [draft, setDraft] = useState<EditableValue | null>(null);

  const editable = editableValueOf(step);
  const disabled = step.disabled === true;
  const editing = draft !== null;

  const commit = () => {
    if (draft && onEdit) onEdit(step.id, draft);
    setDraft(null);
  };

  return (
    <li
      className={`group flex min-h-7 items-center gap-2 rounded px-2 text-12 ${
        active ? "bg-accent text-accent-foreground" : "text-foreground"
      } ${disabled ? "opacity-50" : ""}`}
      data-testid="step-row"
    >
      <span className="w-4 shrink-0 text-right text-10 tabular-nums text-muted-foreground">
        {index + 1}
      </span>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />

      {editing ? (
        <span
          className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setDraft(null);
            }
          }}
          // Moving between the editor's own fields (hex + swatch, x + y) must
          // not commit; leaving the editor entirely does.
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              commit();
            }
          }}
        >
          <StepValueEditor value={draft} onChange={setDraft} autoFocus />
        </span>
      ) : (
        <span
          className={`min-w-0 flex-1 truncate ${disabled ? "line-through" : ""}`}
          title={step.label}
        >
          {step.label}
        </span>
      )}

      {step.replayable === false && (
        <span
          className="shrink-0 rounded bg-muted px-1 py-0.5 text-9 uppercase tracking-wide text-muted-foreground"
          title="Creator's plugin API can't perform this action, so playback will skip it"
        >
          won't replay
        </span>
      )}

      {!editing && onToggleParam && editable && (
        <button
          type="button"
          className={`${ACTION_CLASS} ${param ? "flex text-foreground" : "hidden"}`}
          aria-label={param ? "Stop using as parameter" : "Use as parameter"}
          title={
            param
              ? "Asked for on every play"
              : "Ask for this value on every play"
          }
          onClick={() => onToggleParam(step.id)}
        >
          <Pin className={`size-3.5 ${param ? "fill-current" : ""}`} />
        </button>
      )}

      {!editing && onEdit && editable && (
        <button
          type="button"
          className={`${ACTION_CLASS} hidden`}
          aria-label={`Edit step ${index + 1}`}
          onClick={() => setDraft(editable)}
        >
          <Pencil className="size-3.5" />
        </button>
      )}

      {!editing && onToggle && (
        <button
          type="button"
          className={`${ACTION_CLASS} ${disabled ? "flex" : "hidden"}`}
          aria-label={disabled ? `Enable step ${index + 1}` : `Disable step ${index + 1}`}
          onClick={() => onToggle(step.id)}
        >
          {disabled ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      )}

      {!editing && onDelete && (
        <button
          type="button"
          className={`${ACTION_CLASS} hidden`}
          aria-label={`Delete step ${index + 1}`}
          onClick={() => onDelete(step.id)}
        >
          <X className="size-3.5" />
        </button>
      )}
    </li>
  );
}
