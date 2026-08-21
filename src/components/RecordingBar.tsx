import { Button } from "@lottiefiles/creator-plugins-ui";
import { useEffect, useState } from "react";

function formatElapsed(startedAt: number, now: number): string {
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export interface RecordingBarProps {
  startedAt: number;
  stepCount: number;
  onStop: () => void;
  onDiscard: () => void;
}

/** Sticky bar shown while recording: pulse, elapsed time, step count, actions. */
export function RecordingBar({
  startedAt,
  stepCount,
  onStop,
  onDiscard,
}: RecordingBarProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div
      className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background px-3 py-2"
      data-testid="recording-bar"
    >
      <span
        className="record-pulse size-2.5 shrink-0 rounded-full bg-destructive"
        aria-hidden
      />
      <span className="text-12 font-medium" role="timer" aria-label="Recording time">
        {formatElapsed(startedAt, now)}
      </span>
      <span className="min-w-0 flex-1 truncate text-11 text-muted-foreground">
        {stepCount === 1 ? "1 step" : `${stepCount} steps`}
      </span>
      <Button size="sm" variant="ghost" onClick={onDiscard}>
        Discard
      </Button>
      <Button size="sm" onClick={onStop} data-testid="stop-button">
        Stop
      </Button>
    </div>
  );
}
