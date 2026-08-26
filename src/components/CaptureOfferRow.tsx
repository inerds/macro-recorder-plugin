import { Button } from "@lottiefiles/creator-plugins-ui";
import { useId } from "react";

import type { CaptureOffer } from "../../shared/protocol";

export interface CaptureOfferRowProps {
  offer: CaptureOffer;
  /** "Add all" already used for this layer this session. */
  alreadyCapturedAll: boolean;
  onCapture: (scope: "all" | "selected") => void;
}

/**
 * The standing offer to pull a selected layer's existing timeline keyframes
 * into the recording. ConfirmInline's structural grammar (bordered muted
 * group, message, right-aligned keys) — but it is an OFFER, not a question:
 * no red key (Stop owns this surface's red), no autofocus, no alert/live
 * region (it appears and leaves with the selection every tick and must not
 * steal focus or talk over the feed), no dismiss (deselecting dismisses).
 */
export function CaptureOfferRow({ offer, alreadyCapturedAll, onCapture }: CaptureOfferRowProps) {
  const messageId = useId();
  const name = offer.layerName ?? "This layer";
  const kfWord = offer.keyframeCount === 1 ? "keyframe" : "keyframes";
  const pathWord = offer.pathCount === 1 ? "property" : "properties";
  // undefined = the host never reported a selected-keyframes surface
  // (typed but unverified) — the key does not render at all.
  const hasSelectionSurface = offer.selectedCount !== undefined;
  const selectedCount = offer.selectedCount ?? 0;

  return (
    <div
      className="inline-enter flex flex-col gap-2 rounded-[10px] border border-border bg-muted p-2"
      role="group"
      aria-labelledby={messageId}
      data-testid="capture-offer"
    >
      <p id={messageId} className="text-12 text-foreground">
        <span className="mono">“{name}”</span> has {offer.keyframeCount} {kfWord} on{" "}
        {offer.pathCount} {pathWord}.
      </p>
      <div className="flex justify-end gap-1.5">
        {hasSelectionSurface && (
          <Button
            size="sm"
            type="button"
            variant="ghost"
            className="press key-quiet"
            disabled={selectedCount === 0}
            title={
              selectedCount === 0
                ? "Creator hasn't reported any selected keyframes to plugins"
                : undefined
            }
            onClick={() => onCapture("selected")}
            data-testid="capture-selected-button"
          >
            Add selected ({selectedCount})
          </Button>
        )}
        <Button
          size="sm"
          type="button"
          variant="ghost"
          className="press key key-outline"
          disabled={alreadyCapturedAll}
          title={
            alreadyCapturedAll
              ? "Already added"
              : "All keyframes plus the layer's current property values"
          }
          onClick={() => onCapture("all")}
          data-testid="capture-all-button"
        >
          Add all
        </Button>
      </div>
    </div>
  );
}
