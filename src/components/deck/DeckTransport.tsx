import { Button } from "@lottiefiles/creator-plugins-ui";
import { Square } from "lucide-react";
import type { ReactNode } from "react";

import { deckLabel, deckLamp, type DeckState } from "./deckState";
import { useElapsed } from "./useElapsed";

export interface DeckTransportProps {
  state: DeckState;
  /** Steps on the counter right now (captured, or played so far). */
  stepCount: number;
  /** Set only while recording — the clock runs from here. */
  startedAt: number | null;
  /** The reel stage, rendered between the nameplate and the keys. */
  stage: ReactNode;
  recordDisabled: boolean;
  stopDisabled: boolean;
  onRecord: () => void;
  onStop: () => void;
}

const METER_BARS = [4, 7, 10, 7, 5];

/** The counter is a four-digit mechanical readout: it never changes width. */
function counterText(count: number): string {
  return String(Math.min(9999, Math.max(0, count))).padStart(4, "0");
}

/** Nameplate, state lamp, and the two keys that drive the whole panel. */
export function DeckTransport({
  state,
  stepCount,
  startedAt,
  stage,
  recordDisabled,
  stopDisabled,
  onRecord,
  onStop,
}: DeckTransportProps) {
  const elapsed = useElapsed(startedAt);
  const lamp = deckLamp(state);
  const live = state === "recording" || state === "playing";

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          {/* The document's h1 is the sr-only one at the panel root. */}
          <p className="truncate text-24 font-semibold leading-none tracking-tight">
            Macro Recorder
          </p>
          <p className="instrument mt-1 truncate">Record. Play. Automate.</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="lamp" data-on={lamp ?? "off"} aria-hidden />
          {/* Not a live region: the state label repeats what the toasts and
              the recording announcements already say. */}
          <span className="instrument">{deckLabel(state)}</span>
        </div>
      </div>

      {stage}

      <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
        <Button
          size="sm"
          className="press key key-red"
          aria-label="Record"
          data-testid="record-button"
          disabled={recordDisabled}
          onClick={onRecord}
        >
          <span
            className="grid size-3 shrink-0 place-items-center rounded-full border border-current"
            aria-hidden
          >
            <span className="size-1.5 rounded-full bg-current" />
          </span>
          Record
        </Button>
        <Button
          size="sm"
          className="press key key-outline"
          aria-label="Stop"
          data-testid="stop-button"
          disabled={stopDisabled}
          onClick={onStop}
        >
          <Square className="fill-current" strokeWidth={2.5} aria-hidden />
          Stop
        </Button>

        <div className="ml-auto flex items-center gap-1">
          {startedAt !== null && (
            <span
              className="mono text-11 tracking-tight"
              role="timer"
              aria-label="Recording time"
            >
              {elapsed}
            </span>
          )}
          <span
            className="mono rounded-[6px] border border-border bg-muted px-1 py-0.5 text-12 leading-none"
            aria-label="Steps captured"
          >
            {counterText(stepCount)}
          </span>
          <span
            className={`flex h-4 items-end gap-0.5 ${live ? "meter-live" : ""}`}
            aria-hidden
          >
            {METER_BARS.map((height, index) => (
              <span
                key={index}
                className={`meter-bar ${live ? "record-pulse" : ""}`}
                style={{
                  height: `${height}px`,
                  animationDelay: `${index * 120}ms`,
                }}
              />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}
