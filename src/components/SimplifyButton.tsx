import { Button } from "@lottiefiles/creator-plugins-ui";
import { Wand2 } from "lucide-react";
import { useId } from "react";

import { simplifySteps } from "../../shared/simplify";
import type { MacroStep } from "../types";

export interface SimplifyButtonProps {
  steps: MacroStep[];
  onSimplify: () => void;
}

/**
 * Collapses tick-loop micro-steps. When there is nothing to merge it stays
 * focusable and explains itself (aria-disabled, not disabled) rather than
 * vanishing from the keyboard.
 */
export function SimplifyButton({ steps, onSimplify }: SimplifyButtonProps) {
  const simplified = simplifySteps(steps).length;
  const canSimplify = simplified !== steps.length;
  const hintId = useId();

  const hint = canSimplify
    ? `Merges ${steps.length} steps into ${simplified}`
    : "Nothing to merge";

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="press key-quiet shrink-0 aria-disabled:cursor-default"
        aria-disabled={!canSimplify}
        aria-describedby={hintId}
        onClick={() => {
          if (canSimplify) onSimplify();
        }}
        title={hint}
        // The focus fallback when a step list loses its last delete button.
        data-step-action="simplify"
        data-testid="simplify-button"
      >
        <Wand2 className="size-3!" strokeWidth={2.5} aria-hidden />
        Simplify
        {canSimplify && (
          // The verb is quiet and so is the saving: red on this panel means
          // action or failure, and a count of merged steps is neither. Muted
          // ink at 500 keeps it a readout beside the verb, not a signal.
          <span
            className="mono shrink-0 text-11 font-medium tabular-nums text-muted-foreground"
            aria-hidden
          >
            {steps.length} → {simplified}
          </span>
        )}
      </Button>
      <span id={hintId} className="sr-only">
        {hint}
      </span>
    </>
  );
}
