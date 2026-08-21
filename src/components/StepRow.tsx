import {
  Circle,
  Diamond,
  Layers,
  Move,
  PaintBucket,
  PenLine,
  Shapes,
  Scissors,
  X,
} from "lucide-react";

import type { MacroStep, StepKind } from "../types";

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

export interface StepRowProps {
  step: MacroStep;
  index: number;
  onDelete?: (stepId: string) => void;
  /** Highlight as the currently-running playback step. */
  active?: boolean;
}

export function StepRow({ step, index, onDelete, active }: StepRowProps) {
  const Icon = KIND_ICONS[step.kind];
  return (
    <li
      className={`group flex h-7 items-center gap-2 rounded px-2 text-12 ${
        active ? "bg-accent text-accent-foreground" : "text-foreground"
      }`}
      data-testid="step-row"
    >
      <span className="w-4 shrink-0 text-right text-10 tabular-nums text-muted-foreground">
        {index + 1}
      </span>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 truncate" title={step.label}>
        {step.label}
      </span>
      {step.replayable === false && (
        <span
          className="shrink-0 rounded bg-muted px-1 py-0.5 text-9 uppercase tracking-wide text-muted-foreground"
          title="Creator's plugin API can't perform this action, so playback will skip it"
        >
          won't replay
        </span>
      )}
      {onDelete && (
        <button
          type="button"
          className="hidden size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-secondary-foreground focus-visible:flex group-hover:flex group-focus-within:flex"
          aria-label={`Delete step ${index + 1}`}
          onClick={() => onDelete(step.id)}
        >
          <X className="size-3.5" />
        </button>
      )}
    </li>
  );
}
