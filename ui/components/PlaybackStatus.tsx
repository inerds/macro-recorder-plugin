import { Button, cn, Spinner } from "@lottiefiles/creator-plugins-ui";
import { useEffect, useRef } from "react";

import type { PlayingState } from "../state/appReducer";

export interface PlaybackStatusProps {
  playing: PlayingState;
  onResolveFailure: (action: "continue" | "stop") => void;
}

/** Row-level playback feedback: progress, or a failed step awaiting a decision. */
export function PlaybackStatus({
  playing,
  onResolveFailure,
}: PlaybackStatusProps) {
  // The paused run waits for a decision that lives in this box — and the box
  // sits inside a card that can be scrolled well off screen. Bring it to the
  // eye the way the step list follows the playhead (StepList.tsx).
  const warnRef = useRef<HTMLDivElement>(null);
  const paused = playing.error !== null;
  useEffect(() => {
    if (paused) warnRef.current?.scrollIntoView({ block: "nearest" });
  }, [paused]);

  if (playing.error) {
    // A failure before any step ran (e.g. nothing selected) can only stop.
    const preRun = playing.error.stepIndex === 0 && playing.currentStep === 0;
    return (
      <div
        ref={warnRef}
        className="warn-box flex flex-col gap-1.5 p-2"
        role="alert"
        data-testid="playback-error"
      >
        <p className="text-12 text-foreground">
          {preRun
            ? playing.error.message
            : `Step ${playing.error.stepIndex + 1} failed — ${playing.error.message}`}
        </p>
        <div className="flex justify-end gap-1.5">
          {!preRun && (
            <Button
              size="sm"
              variant="ghost"
              className="press key key-outline"
              onClick={() => onResolveFailure("continue")}
            >
              Continue
            </Button>
          )}
          <Button
            size="sm"
            // Nothing ran, so nothing is being abandoned — "Dismiss" is not a
            // destructive act and must not wear the red cap that says it is.
            // The skin's key classes are the whole treatment here; `variant`
            // never reached the cap at all.
            className={cn("press key", preRun ? "key-outline" : "key-red")}
            onClick={() => onResolveFailure("stop")}
          >
            {preRun ? "Dismiss" : "Stop"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2 py-1 text-11 text-muted-foreground"
      data-testid="playback-progress"
    >
      <Spinner className="size-3.5" role="presentation" aria-hidden aria-label={undefined} />
      {/* Read, never spoken. A step lands every ~50ms, so a live region here
          announced the run up to twenty times a second and buried everything
          else. The run says one thing on the way in and one on the way out,
          both through the panel's own live region (app.tsx). */}
      <span className="min-w-0 flex-1 truncate tabular-nums" aria-hidden>
        Playing step {Math.min(playing.currentStep + 1, playing.total)} of{" "}
        {playing.total}…
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="press key key-outline"
        onClick={() => onResolveFailure("stop")}
        data-testid="playback-stop-button"
      >
        Stop
      </Button>
    </div>
  );
}
