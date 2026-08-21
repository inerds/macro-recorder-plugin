import { Button, Input } from "@lottiefiles/creator-plugins-ui";
import { Check, Play } from "lucide-react";
import { useState } from "react";

import type { PlayingState } from "../state/appReducer";
import type { Macro } from "../types";
import { ConfirmInline } from "./ConfirmInline";
import { OverflowMenu } from "./OverflowMenu";
import { PlaybackStatus } from "./PlaybackStatus";
import { StepList } from "./StepList";

export interface MacroRowProps {
  macro: Macro;
  expanded: boolean;
  renaming: boolean;
  confirmingDelete: boolean;
  justPlayed: boolean;
  /** Set when THIS macro is playing. */
  playing: PlayingState | null;
  /** Disable play while another macro is playing. */
  playDisabled: boolean;
  onToggleExpand: () => void;
  onPlay: () => void;
  onRenameStart: () => void;
  onRenameCommit: (name: string) => void;
  onRenameCancel: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDeleteRequest: () => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: () => void;
  onDeleteStep: (stepId: string) => void;
  onResolveFailure: (action: "continue" | "stop") => void;
}

export function MacroRow({
  macro,
  expanded,
  renaming,
  confirmingDelete,
  justPlayed,
  playing,
  playDisabled,
  onToggleExpand,
  onPlay,
  onRenameStart,
  onRenameCommit,
  onRenameCancel,
  onDuplicate,
  onExport,
  onDeleteRequest,
  onDeleteCancel,
  onDeleteConfirm,
  onDeleteStep,
  onResolveFailure,
}: MacroRowProps) {
  const [draftName, setDraftName] = useState(macro.name);
  const stepCount =
    macro.steps.length === 1 ? "1 step" : `${macro.steps.length} steps`;

  const isPlayingThis = playing !== null;

  return (
    <li
      className={`rounded-md border border-border ${
        justPlayed ? "success-flash" : ""
      }`}
      data-testid="macro-row"
    >
      {renaming ? (
        <div className="flex items-center gap-1.5 p-2">
          <Input
            value={draftName}
            autoFocus
            aria-label="Macro name"
            className="h-7 min-w-0 flex-1"
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onRenameCommit(draftName);
              if (event.key === "Escape") onRenameCancel();
            }}
            onBlur={() => onRenameCommit(draftName)}
            data-testid="rename-input"
          />
          <Button
            size="icon"
            variant="ghost"
            aria-label="Confirm rename"
            className="size-7 shrink-0"
            onClick={() => onRenameCommit(draftName)}
          >
            <Check className="size-3.5" />
          </Button>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          className="flex w-full cursor-pointer items-center gap-1.5 rounded-md p-2 text-left hover:bg-accent/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={expanded}
          onClick={onToggleExpand}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onToggleExpand();
            }
          }}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-12 font-medium" title={macro.name}>
              {macro.name}
            </p>
            <p className="text-10 text-muted-foreground">{stepCount}</p>
          </div>
          {!isPlayingThis && (
            <>
              <button
                type="button"
                className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
                aria-label={`Play ${macro.name}`}
                disabled={playDisabled}
                onClick={(event) => {
                  event.stopPropagation();
                  onPlay();
                }}
                data-testid="play-button"
              >
                <Play className="size-3.5 fill-current" />
              </button>
              <OverflowMenu
                macroName={macro.name}
                onRename={() => {
                  setDraftName(macro.name);
                  onRenameStart();
                }}
                onDuplicate={onDuplicate}
                onExport={onExport}
                onDelete={onDeleteRequest}
              />
            </>
          )}
        </div>
      )}

      {isPlayingThis && (
        <div className="px-2 pb-2">
          <PlaybackStatus playing={playing} onResolveFailure={onResolveFailure} />
        </div>
      )}

      {confirmingDelete && (
        <div className="px-2 pb-2">
          <ConfirmInline
            message={`Delete "${macro.name}"? This can't be undone.`}
            confirmLabel="Delete"
            onConfirm={onDeleteConfirm}
            onCancel={onDeleteCancel}
          />
        </div>
      )}

      {expanded && !isPlayingThis && (
        <div className="border-t border-border px-1 py-1.5">
          {macro.steps.length === 0 ? (
            <p className="px-2 py-3 text-center text-11 text-muted-foreground">
              This macro has no steps.
            </p>
          ) : (
            <StepList steps={macro.steps} onDeleteStep={onDeleteStep} />
          )}
        </div>
      )}
    </li>
  );
}
