import { sharedLayerName } from "../../shared/labels";
import type { MacroStep } from "../types";
import { SimplifyButton } from "./SimplifyButton";

export interface StepListHeaderProps {
  steps: MacroStep[];
  onSimplify: () => void;
  /** Muted lines under the count (what this list applies to, how it saves). */
  hints?: string[];
  className?: string;
}

/**
 * The header above a step list: how many steps there are, how to shorten
 * them, and what happens to them. Shared so the review sheet and a saved
 * macro's detail read the same way.
 */
export function StepListHeader({
  steps,
  onSimplify,
  hints = [],
  className = "",
}: StepListHeaderProps) {
  const layer = sharedLayerName(steps);
  const count = steps.length === 1 ? "1 step" : `${steps.length} steps`;
  return (
    <div className={`mb-1 flex flex-col gap-0.5 px-1 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-11 font-medium text-muted-foreground" title={layer ? `${count} on ${layer}` : count}>
          {count}
          {layer && <span className="font-normal"> on {layer}</span>}
        </p>
        <SimplifyButton steps={steps} onSimplify={onSimplify} />
      </div>
      {hints.map((hint) => (
        <p key={hint} className="text-11 text-muted-foreground">
          {hint}
        </p>
      ))}
    </div>
  );
}
