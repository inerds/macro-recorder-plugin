import { Button, Input } from "@lottiefiles/creator-plugins-ui";
import { Check, ChevronRight, Play, Square } from "lucide-react";
import { useId, useRef, useState } from "react";

import type { EditableValue } from "../../shared/editing";
import { describePlaybackMode, playbackModeHint } from "../../shared/playbackMode";
import type { PlayOptions } from "../gateways/types";
import type { PlayingState } from "../state/appReducer";
import type { Macro } from "../types";
import { ConfirmInline } from "./ConfirmInline";
import { OverflowMenu } from "./OverflowMenu";
import { PlaybackStatus } from "./PlaybackStatus";
import { describePlayOptions } from "./playOptionsText";
import { PlayOptionsPopover } from "./PlayOptionsPopover";
import { StepList } from "./StepList";
import { StepListHeader } from "./StepListHeader";

/** Hand-rolled icon buttons (the library Button is too tall for this row). */
const ICON_BUTTON_CLASS =
  "press flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-[background-color,color,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none hover:bg-secondary hover:text-secondary-foreground active:scale-[0.96] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

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
  onPlay: (options?: PlayOptions) => void;
  onRenameStart: () => void;
  onRenameCommit: (name: string) => void;
  onRenameCancel: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDeleteRequest: () => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: () => void;
  onDeleteStep: (stepId: string) => void;
  onSimplify: () => void;
  onToggleStep: (stepId: string) => void;
  onEditStep: (stepId: string, value: EditableValue) => void;
  onToggleParam: (stepId: string) => void;
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
  onSimplify,
  onToggleStep,
  onEditStep,
  onToggleParam,
  onResolveFailure,
}: MacroRowProps) {
  const [draftName, setDraftName] = useState(macro.name);
  // Play options belong to the row, not the dialog: the bare ▶ uses whatever
  // was chosen last, and the row says so.
  const [options, setOptions] = useState<PlayOptions>({});
  const panelId = useId();
  const disclosureRef = useRef<HTMLButtonElement>(null);

  const stepCount =
    macro.steps.length === 1 ? "1 step" : `${macro.steps.length} steps`;
  const optionSummary = describePlayOptions(options);
  const mode = describePlaybackMode(macro);

  const isPlayingThis = playing !== null;

  // Playback indices count ENABLED steps and keep climbing across repeats;
  // the list renders every step, so map back to its own index.
  const enabled = macro.steps.filter((step) => step.disabled !== true);
  let activeIndex: number | undefined;
  if (playing && enabled.length > 0) {
    const step = enabled[playing.currentStep % enabled.length];
    const index = step ? macro.steps.indexOf(step) : -1;
    if (index >= 0) activeIndex = index;
  }

  /** Renaming is a detour: hand focus back to the row it started from. */
  const restoreFocus = () => {
    queueMicrotask(() => disclosureRef.current?.focus());
  };

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
            className="h-6 min-w-0 flex-1"
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onRenameCommit(draftName);
                restoreFocus();
              }
              if (event.key === "Escape") {
                onRenameCancel();
                restoreFocus();
              }
            }}
            onBlur={() => onRenameCommit(draftName)}
            data-testid="rename-input"
          />
          <Button
            size="icon"
            variant="ghost"
            className="press size-6 shrink-0"
            aria-label="Confirm rename"
            // The input's blur would unmount this button before its click
            // ever landed; keep focus where it is until the click resolves.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onRenameCommit(draftName);
              restoreFocus();
            }}
          >
            <Check className="size-3.5!" strokeWidth={2.5} />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 p-2">
          <button
            type="button"
            ref={disclosureRef}
            className="press flex min-w-0 flex-1 items-center gap-1.5 rounded-[5px] text-left hover:bg-accent/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={onToggleExpand}
          >
            <ChevronRight
              className={`size-3.5 shrink-0 text-muted-foreground transition-[rotate] duration-150 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none ${
                expanded ? "rotate-90" : ""
              }`}
              strokeWidth={2.5}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-12 font-medium" title={macro.name}>
                  {macro.name}
                </span>
                {optionSummary && (
                  <span
                    className="max-w-[40%] shrink-0 truncate text-10 tabular-nums text-muted-foreground"
                    title={optionSummary}
                    data-testid="play-options-summary"
                  >
                    {/* The badge truncates; the announcement never does. */}
                    <span className="sr-only">Play options: </span>
                    {optionSummary}
                  </span>
                )}
              </span>
              <span className="block text-11 text-muted-foreground">{stepCount}</span>
            </span>
          </button>
          {/* Stays mounted across the run, swapping glyph and action: an
              unmounting Play button would drop the focus that pressed it. */}
          <button
            type="button"
            className={ICON_BUTTON_CLASS}
            aria-label={isPlayingThis ? `Stop ${macro.name}` : `Play ${macro.name}`}
            disabled={!isPlayingThis && playDisabled}
            onClick={() =>
              isPlayingThis ? onResolveFailure("stop") : onPlay(options)
            }
            data-testid="play-button"
          >
            {isPlayingThis ? (
              <Square className="size-3 fill-current" strokeWidth={2.5} />
            ) : (
              <Play className="size-3.5 translate-x-[0.5px] fill-current" />
            )}
          </button>
          {!isPlayingThis && (
            <>
              <PlayOptionsPopover
                macroName={macro.name}
                disabled={playDisabled}
                sceneScript={mode.mode === "scene"}
                value={options}
                onChange={setOptions}
                onPlay={(next) => {
                  setOptions(next);
                  onPlay(next);
                }}
              />
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
            confirmLabel="Delete macro"
            onConfirm={onDeleteConfirm}
            onCancel={onDeleteCancel}
          />
        </div>
      )}

      {expanded && (
        <div id={panelId} className="inline-enter border-t border-border px-1 py-1.5">
          {macro.steps.length === 0 ? (
            <p className="px-2 py-3 text-center text-11 text-muted-foreground">
              No steps left. Delete this macro, or record a new one.
            </p>
          ) : (
            <>
              <StepListHeader
                steps={macro.steps}
                onSimplify={onSimplify}
                hints={[playbackModeHint(mode), "Changes save automatically"]}
              />
              <StepList
                steps={macro.steps}
                onDeleteStep={onDeleteStep}
                onToggleStep={onToggleStep}
                onEditStep={onEditStep}
                onToggleParam={onToggleParam}
                paramIds={(macro.params ?? []).map((param) => param.stepId)}
                activeIndex={activeIndex}
              />
            </>
          )}
        </div>
      )}
    </li>
  );
}
