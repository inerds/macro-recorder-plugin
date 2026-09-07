import { Checkbox } from "@lottiefiles/creator-plugins-ui";
import { useId } from "react";

import { simplifySteps } from "../../engine/simplify";
import type { MacroStep } from "../types";

export interface KeepEveryStepToggleProps {
  /** The recording as captured — both counts in the readout come from it. */
  rawSteps: MacroStep[];
  /** True while the sheet shows the merged list. */
  simplified: boolean;
  onSimplifiedChange: (simplified: boolean) => void;
}

/**
 * The review sheet's simplify control. The sheet opens merged, so this is not
 * a verb any more — it is the switch that puts the raw recording back. It
 * reads the counts off `rawSteps`, never off the list on screen, so a step
 * deleted in the review cannot move the readout.
 *
 * The label is a sibling of the box rather than a wrapper: the library's
 * checkbox is a `span[role=checkbox]` beside a hidden input, and a wrapping
 * label would route one click through both.
 */
export function KeepEveryStepToggle({
  rawSteps,
  simplified,
  onSimplifiedChange,
}: KeepEveryStepToggleProps) {
  const merged = simplifySteps(rawSteps).length;
  const canSimplify = merged !== rawSteps.length;
  const boxId = useId();
  const hintId = useId();

  const hint = canSimplify ? `${rawSteps.length} steps merged into ${merged}` : "Nothing to merge";

  return (
    <div className="check-quiet shrink-0" title={hint}>
      <Checkbox
        id={boxId}
        size="xs"
        checked={!simplified}
        // The SimplifyButton idiom: a natively disabled control leaves the
        // tab order and takes its reason with it. Nothing to merge means
        // both lists are the same list, so the guarded click loses nothing.
        aria-disabled={canSimplify ? undefined : true}
        aria-label="Keep every step"
        aria-describedby={hintId}
        onCheckedChange={(keepEveryStep) => {
          if (canSimplify) onSimplifiedChange(!keepEveryStep);
        }}
        // The focus fallback when a step list loses its last delete button —
        // this control now holds the review sheet's simplify seat.
        data-step-action="simplify"
        data-testid="keep-every-step"
      />
      <label htmlFor={boxId} className="check-quiet-label">
        Keep every step
        {canSimplify && (
          // Muted ink at 500, never red: red on this panel means action or
          // failure, and a count of merged steps is neither.
          <span
            className="mono shrink-0 text-11 font-medium tabular-nums text-muted-foreground"
            aria-hidden
          >
            {rawSteps.length} → {merged}
          </span>
        )}
      </label>
      <span id={hintId} className="sr-only">
        {hint}
      </span>
    </div>
  );
}
