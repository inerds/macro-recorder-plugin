import { Button, Spinner } from "@lottiefiles/creator-plugins-ui";

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
  if (playing.error) {
    // A failure before any step ran (e.g. nothing selected) can only stop.
    const preRun = playing.error.stepIndex === 0 && playing.currentStep === 0;
    return (
      <div
        className="flex flex-col gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 p-2"
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
              onClick={() => onResolveFailure("continue")}
            >
              Continue
            </Button>
          )}
          <Button
            size="sm"
            // Nothing ran, so nothing is being abandoned — "Dismiss" is not a
            // destructive act and shouldn't be dressed as one.
            variant={preRun ? "default" : "destructive"}
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
      className="flex items-center gap-2 py-1 text-12 text-muted-foreground"
      data-testid="playback-progress"
    >
      <Spinner className="size-3.5" role="presentation" aria-hidden aria-label={undefined} />
      {/* The live region is the sentence alone. With the button inside it,
          every progress tick re-announced "Stop" too. */}
      <span
        className="min-w-0 flex-1 truncate"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        Playing step {Math.min(playing.currentStep + 1, playing.total)} of{" "}
        {playing.total}…
      </span>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onResolveFailure("stop")}
        data-testid="playback-stop-button"
      >
        Stop
      </Button>
    </div>
  );
}
