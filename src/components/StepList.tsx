import { useEffect, useRef } from "react";

import type { MacroStep } from "../types";
import { StepRow } from "./StepRow";

export interface StepListProps {
  steps: MacroStep[];
  onDeleteStep?: (stepId: string) => void;
  /** Keep the newest step scrolled into view (recording feed). */
  autoScroll?: boolean;
  /** Index of the step currently being played back. */
  activeIndex?: number;
}

/** Shared step renderer for the live feed, review sheet, and macro detail. */
export function StepList({
  steps,
  onDeleteStep,
  autoScroll,
  activeIndex,
}: StepListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && steps.length > 0) {
      endRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [autoScroll, steps.length]);

  if (steps.length === 0) return null;

  return (
    <div>
      <ul className="flex flex-col gap-0.5" data-testid="step-list">
        {steps.map((step, index) => (
          <StepRow
            key={step.id}
            step={step}
            index={index}
            onDelete={onDeleteStep}
            active={index === activeIndex}
          />
        ))}
      </ul>
      <div ref={endRef} />
    </div>
  );
}
