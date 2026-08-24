import { useEffect, useRef } from "react";

import type { EditableValue } from "../../shared/editing";
import { sharedLayerName } from "../../shared/labels";
import type { MacroStep } from "../types";
import { StepRow } from "./StepRow";

export interface StepListProps {
  steps: MacroStep[];
  onDeleteStep?: (stepId: string) => void;
  onToggleStep?: (stepId: string) => void;
  onEditStep?: (stepId: string, value: EditableValue) => void;
  onToggleParam?: (stepId: string) => void;
  /** Ids of the steps pinned as parameters. */
  paramIds?: readonly string[];
  /** Keep the newest step scrolled into view (recording feed). */
  autoScroll?: boolean;
  /** Index of the step currently being played back. */
  activeIndex?: number;
}

/** Shared step renderer for the live feed, review sheet, and macro detail. */
export function StepList({
  steps,
  onDeleteStep,
  onToggleStep,
  onEditStep,
  onToggleParam,
  paramIds,
  autoScroll,
  activeIndex,
}: StepListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /** Index of the row whose delete button was last pressed, if any. */
  const deletedAt = useRef<number | null>(null);

  useEffect(() => {
    if (autoScroll && steps.length > 0) {
      endRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [autoScroll, steps.length]);

  // Follow the playhead through the list without yanking the whole panel.
  useEffect(() => {
    if (activeIndex === undefined) return;
    listRef.current
      ?.querySelector('[aria-current="step"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Deleting a row unmounts the button focus was on, which would drop focus to
  // the body. Re-aim it at the row that took this one's place, the row above
  // it, or — when the list is empty — the header's Simplify button.
  useEffect(() => {
    const index = deletedAt.current;
    deletedAt.current = null;
    if (index === null) return;
    const buttons = listRef.current?.querySelectorAll<HTMLElement>(
      '[data-step-action="delete"]',
    );
    const next = buttons?.[index] ?? buttons?.[index - 1];
    if (next) {
      next.focus();
      return;
    }
    rootRef.current?.parentElement
      ?.querySelector<HTMLElement>('[data-step-action="simplify"]')
      ?.focus();
  }, [steps.length]);

  if (steps.length === 0) return null;
  // One layer throughout → its name lives in the header, not on every row.
  const layerName = sharedLayerName(steps);
  const prefix = layerName ? `${layerName} · ` : "";

  return (
    <div ref={rootRef}>
      <ul ref={listRef} className="step-strip flex flex-col" data-testid="step-list">
        {steps.map((step, index) => (
          <StepRow
            key={step.id}
            step={step}
            index={index}
            hidePrefix={prefix}
            onDelete={
              onDeleteStep &&
              ((stepId: string) => {
                deletedAt.current = index;
                onDeleteStep(stepId);
              })
            }
            onToggle={onToggleStep}
            onEdit={onEditStep}
            onToggleParam={onToggleParam}
            param={paramIds?.includes(step.id)}
            active={index === activeIndex}
          />
        ))}
      </ul>
      <div ref={endRef} />
    </div>
  );
}
