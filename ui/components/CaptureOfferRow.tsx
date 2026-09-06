import { Button } from "@lottiefiles/creator-plugins-ui";
import { useId } from "react";

import type { CaptureOffer } from "../../engine/protocol";

export interface CaptureOfferRowProps {
  offer: CaptureOffer;
  /** "Add all" already used for this layer this session. */
  alreadyCapturedAll: boolean;
  onCapture: (scope: "all" | "selected") => void;
}

export interface CaptureKeyState {
  /** The key renders at all (the host reported the surface it needs). */
  shown: boolean;
  /** The key is off — `aria-disabled`, and the click does nothing. */
  off: boolean;
  /** Why it is off, or undefined when it is not. */
  hint: string | undefined;
}

/**
 * Which capture key is off and why.
 *
 * Both keys spend most of their life off, and each has a reason a user
 * cannot guess. A natively disabled key drops out of the tab order AND
 * (through the library's `disabled:pointer-events-none`) refuses the hover
 * that would show its tooltip — so the reason was unreachable by every
 * route. The component pairs this with `aria-disabled` and a guarded click,
 * the way `SimplifyButton` does.
 */
export function captureOfferKeys(
  offer: CaptureOffer,
  alreadyCapturedAll: boolean,
): { selected: CaptureKeyState; all: CaptureKeyState } {
  const selectedOff = (offer.selectedCount ?? 0) === 0;
  return {
    selected: {
      // undefined = the host never reported a selected-keyframes surface
      // (typed but unverified) — the key does not render at all.
      shown: offer.selectedCount !== undefined,
      off: selectedOff,
      hint: selectedOff ? "Creator hasn't reported any selected keyframes to plugins" : undefined,
    },
    all: {
      shown: true,
      off: alreadyCapturedAll,
      // What "all" covers is in the card's own sentence, so an enabled key
      // needs no tooltip — only the disabled one has a reason to give.
      hint: alreadyCapturedAll ? "Already added" : undefined,
    },
  };
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
  const selectedHintId = useId();
  const allHintId = useId();
  const name = offer.layerName ?? "This layer";
  const kfWord = offer.keyframeCount === 1 ? "keyframe" : "keyframes";
  const pathWord = offer.pathCount === 1 ? "property" : "properties";
  const selectedCount = offer.selectedCount ?? 0;
  const keys = captureOfferKeys(offer, alreadyCapturedAll);
  const selectedHint = keys.selected.hint;
  const allHint = keys.all.hint;

  return (
    <div
      className="inline-enter flex flex-col gap-2 rounded-[10px] border border-border bg-muted p-2"
      role="group"
      aria-labelledby={messageId}
      data-testid="capture-offer"
    >
      <p id={messageId} className="text-12 text-foreground">
        <span className="mono">“{name}”</span> has {offer.keyframeCount} {kfWord} on{" "}
        {offer.pathCount} {pathWord}. Adding them also captures the layer's current values.
      </p>
      <div className="flex justify-end gap-1.5">
        {keys.selected.shown && (
          <>
            <Button
              size="sm"
              type="button"
              variant="ghost"
              className="press key-quiet aria-disabled:cursor-default"
              aria-disabled={keys.selected.off}
              {...(selectedHint ? { "aria-describedby": selectedHintId, title: selectedHint } : {})}
              onClick={() => {
                if (!keys.selected.off) onCapture("selected");
              }}
              data-testid="capture-selected-button"
            >
              Add selected keyframes ({selectedCount})
            </Button>
            {selectedHint && (
              <span id={selectedHintId} className="sr-only">
                {selectedHint}
              </span>
            )}
          </>
        )}
        <Button
          size="sm"
          type="button"
          variant="ghost"
          className="press key key-outline aria-disabled:cursor-default aria-disabled:opacity-40"
          aria-disabled={keys.all.off}
          {...(allHint ? { "aria-describedby": allHintId, title: allHint } : {})}
          onClick={() => {
            if (!keys.all.off) onCapture("all");
          }}
          data-testid="capture-all-button"
        >
          Add all keyframes
        </Button>
        {allHint && (
          <span id={allHintId} className="sr-only">
            {allHint}
          </span>
        )}
      </div>
    </div>
  );
}
