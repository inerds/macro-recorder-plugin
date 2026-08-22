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
  const count = `Steps (${steps.length})`;
  return (
    <div className={`mb-1 flex flex-col gap-0.5 px-1 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <p
          className="instrument min-w-0 truncate"
          title={layer ? `${count} on ${layer}` : count}
        >
          {count}
          {layer && <span className="normal-case"> on {layer}</span>}
        </p>
        <SimplifyButton steps={steps} onSimplify={onSimplify} />
      </div>
      {/* Truncated to one line — full text still lives in the DOM and in the
          title tooltip, so nothing load-bearing is lost, just the wrap. */}
      {hints.map((hint) => (
        <p key={hint} className="truncate text-11 leading-tight text-muted-foreground" title={hint}>
          {hint}
        </p>
      ))}
    </div>
  );
}
