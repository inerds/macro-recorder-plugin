import { sharedLayerName } from "../../shared/labels";
import type { MacroStep } from "../types";
import { SimplifyButton } from "./SimplifyButton";

export interface StepListHeaderProps {
  steps: MacroStep[];
  onSimplify: () => void;
  /** Muted lines under the count (what this list applies to, how it saves). */
  hints?: string[];
  /** Demoted hint: tooltip + screen reader only, no visible line. The macro
      drawer uses this — a sentence of prose on every expansion read as
      clutter; the review screen keeps visible `hints` (that is where the
      user decides). */
  quietHint?: string;
  /**
   * Kept for compatibility — the layer name no longer renders beside the
   * count on any surface. It truncated before anything else on a narrow
   * panel; the review screen says it in its hint sentence instead, and the
   * tooltip and screen readers still get it from the heading below.
   */
  showLayer?: boolean;
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
  quietHint,
  className = "",
}: StepListHeaderProps) {
  const layer = sharedLayerName(steps);
  const count = `Steps (${steps.length})`;
  const heading = layer ? `${count} on ${layer}` : count;
  return (
    <div className={`mb-1.5 flex flex-col gap-0.5 px-2 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <p
          className="instrument min-w-0 flex-1 truncate"
          title={quietHint ? `${heading} — ${quietHint}` : heading}
        >
          {count}
          {layer && <span className="sr-only"> on {layer}</span>}
          {quietHint && <span className="sr-only">. {quietHint}</span>}
        </p>
        <SimplifyButton steps={steps} onSimplify={onSimplify} />
      </div>
      {hints.map((hint) => (
        // A sentence wraps; only labels truncate. `pretty` keeps the last
        // word from stranding when it does wrap on a narrow panel.
        <p key={hint} className="text-11 leading-snug text-pretty text-muted-foreground">
          {hint}
        </p>
      ))}
    </div>
  );
}
