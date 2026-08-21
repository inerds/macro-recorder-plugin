import { Button } from "@lottiefiles/creator-plugins-ui";
import { Wand2 } from "lucide-react";

import { simplifySteps } from "../../shared/simplify";
import type { MacroStep } from "../types";

export interface SimplifyButtonProps {
  steps: MacroStep[];
  onSimplify: () => void;
}

/**
 * Collapses tick-loop micro-steps. Disabled — with the count as the hint —
 * when the transform would leave the list exactly as it is.
 */
export function SimplifyButton({ steps, onSimplify }: SimplifyButtonProps) {
  const simplified = simplifySteps(steps).length;
  const canSimplify = simplified !== steps.length;

  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-6 px-1.5 text-11"
      disabled={!canSimplify}
      onClick={onSimplify}
      title={
        canSimplify
          ? `Merge repeated edits — ${steps.length} steps become ${simplified}`
          : "Nothing left to merge"
      }
      data-testid="simplify-button"
    >
      <Wand2 className="size-3" aria-hidden />
      Simplify
      {canSimplify && (
        <span className="tabular-nums text-muted-foreground">
          {steps.length} → {simplified}
        </span>
      )}
    </Button>
  );
}
