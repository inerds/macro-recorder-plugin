import { Button, Input } from "@lottiefiles/creator-plugins-ui";
import { Check, ChevronRight, ChevronUp, Play, Square } from "lucide-react";
import { useId, useRef, useState } from "react";

import type { EditableValue } from "../../shared/editing";
import { describePlaybackMode, playbackModeHint } from "../../shared/playbackMode";
import { keyframeSpan } from "../../shared/steps";
import type { PlayOptions } from "../gateways/types";
import type { PlayingState } from "../state/appReducer";
import { stepStatusFor, type PlayStepStatus } from "../state/stepStatus";
import type { Macro } from "../types";
import { ConfirmInline } from "./ConfirmInline";
import { OverflowMenu } from "./OverflowMenu";
import { PlaybackStatus } from "./PlaybackStatus";
import { ICON_KEY_CLASS } from "./iconKey";
import { describePlayOptions } from "./playOptionsText";
import { PlayOptionsPopover } from "./PlayOptionsPopover";
import { StepList } from "./StepList";
import { StepListHeader } from "./StepListHeader";


export interface MacroRowProps {
  macro: Macro;
  /** Position in the list — shown as the deck-style two-digit macro ID. */
  index: number;
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
  onCopyJson: () => void;
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
  index,
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
  onCopyJson,
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
  const [options, setOptions] = useState<PlayOptions>(() => ({
    ...(macro.playOptions ?? {}),
  }));
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
  // Per-row pending/running/done/failed, keyed by FULL-array index — the same
  // enabled→full walk, so a skipped step simply gets no entry (it is not part
  // of the run and must keep its own skipped treatment).
  const stepStatuses = new Map<number, PlayStepStatus>();
  if (playing && enabled.length > 0) {
    const step = enabled[playing.currentStep % enabled.length];
    const position = step ? macro.steps.indexOf(step) : -1;
    if (position >= 0) activeIndex = position;
    enabled.forEach((enabledStep, enabledIndex) => {
      const full = macro.steps.indexOf(enabledStep);
      if (full >= 0) {
        stepStatuses.set(full, stepStatusFor(enabledIndex, playing, enabled.length));
      }
    });
  }

  /** Renaming is a detour: hand focus back to the row it started from. */
  const restoreFocus = () => {
    queueMicrotask(() => disclosureRef.current?.focus());
  };

  return (
    <li
      className={`rack-row ${expanded ? "rack-row-open" : ""} ${justPlayed ? "success-flash" : ""}`}
      data-testid="macro-row"
    >
      {renaming ? (
        <div
          className={`flex items-center gap-1.5 px-2 py-1 ${
            expanded ? "border-b border-dotted border-border" : ""
          }`}
        >
          <Input
            value={draftName}
            autoFocus
            aria-label="Macro name"
            className="mono h-6 min-w-0 flex-1"
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
        <div
          className={`flex items-center gap-1.5 px-2 py-1 ${
            expanded ? "border-b border-dotted border-border" : ""
          }`}
        >
          {/* Outside the disclosure on purpose: the button's accessible name
              is the macro, not a catalogue number. */}
          <span className="rack-num shrink-0" aria-hidden>
            {String(index + 1).padStart(2, "0")}
          </span>
          <button
            type="button"
            ref={disclosureRef}
            className="press flex min-w-0 flex-1 items-center gap-1.5 rounded-[7px] text-left hover:bg-accent/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={onToggleExpand}
          >
            <ChevronRight
              className={`me-1.5 size-3 shrink-0 text-muted-foreground/70 transition-[rotate] duration-150 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none ${
                expanded ? "rotate-90" : ""
              }`}
              strokeWidth={2.5}
              aria-hidden
            />
            {/* Name, step count and (if set) play options share one line —
                the row used to stack them, which cost it a whole line of
                height for information that fits beside the name just fine. */}
            <span className="flex min-w-0 flex-1 items-baseline gap-0">
              <span className="rack-name min-w-0 truncate" title={macro.name}>
                {macro.name}
              </span>
              {/* The leader is drawn, the count is a two-digit readout — but a
                  bare "04" means nothing spoken aloud, so the words ride
                  along for assistive tech (and keep the row's text honest). */}
              <span className="rack-lead" aria-hidden />
              <span
                className="mono shrink-0 text-10 text-muted-foreground tabular-nums"
                aria-hidden
              >
                {String(macro.steps.length).padStart(2, "0")}
              </span>
              <span className="sr-only">{stepCount}</span>
              {optionSummary && (
                <span
                  className="mono ms-1.5 max-w-[30%] shrink-0 truncate text-10 tabular-nums text-muted-foreground"
                  title={optionSummary}
                  data-testid="play-options-summary"
                >
                  {/* The badge truncates; the announcement never does. */}
                  <span className="sr-only">Play options: </span>
                  {optionSummary}
                </span>
              )}
            </span>
            {/* The open lid trades its action cluster for one collapse cue,
                inside the same disclosure — no second tab stop. */}
            {expanded && (
              <ChevronUp
                className="ms-1 me-1 size-3 shrink-0 text-muted-foreground/70"
                strokeWidth={2.5}
                aria-hidden
              />
            )}
          </button>
          {/* Stays mounted across the run, swapping glyph and action: an
              unmounting Play button would drop the focus that pressed it —
              so while THIS macro plays, the stop key stays even on the open
              lid; otherwise the pop-out card's lid is bare (concept). */}
          {(!expanded || isPlayingThis) && (
          <button
            type="button"
            className={ICON_KEY_CLASS}
            aria-label={isPlayingThis ? `Stop ${macro.name}` : `Play ${macro.name}`}
            disabled={!isPlayingThis && playDisabled}
            onClick={() =>
              isPlayingThis ? onResolveFailure("stop") : onPlay(options)
            }
            data-testid="play-button"
          >
            {isPlayingThis ? (
              <Square
                className="size-3 fill-current text-[color:var(--ink-red-text)]"
                strokeWidth={2.5}
              />
            ) : (
              <Play className="size-3.5 translate-x-[0.5px] fill-current" />
            )}
          </button>
          )}
          {!isPlayingThis && !expanded && (
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
                onCopyJson={onCopyJson}
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
            message={`Delete “${macro.name}”? This can't be undone.`}
            confirmLabel="Delete macro"
            onConfirm={onDeleteConfirm}
            onCancel={onDeleteCancel}
          />
        </div>
      )}

      {expanded && (
        <div
          id={panelId}
          className="inline-enter px-1.5 pb-1.5 pt-0.5"
        >
          {macro.steps.length === 0 ? (
            <p className="px-2 py-3 text-center text-11 text-muted-foreground">
              No steps left. Delete this macro, or record a new one.
            </p>
          ) : (
            <>
              {/* "Changes save automatically" used to run here as a second
                  sentence — expendable prose that cost every expanded row a
                  full line. The playback-mode hint below is the one that
                  matters (what the macro will touch when it replays). */}
              <StepListHeader
                steps={macro.steps}
                onSimplify={onSimplify}
                quietHint={playbackModeHint(mode)}
                showLayer={false}
              />
              <StepList
                steps={macro.steps}
                onDeleteStep={onDeleteStep}
                onToggleStep={onToggleStep}
                onEditStep={onEditStep}
                onToggleParam={onToggleParam}
                paramIds={(macro.params ?? []).map((param) => param.stepId)}
                activeIndex={activeIndex}
                {...(isPlayingThis ? { statuses: stepStatuses } : {})}
              />
              {/* The card's control footer: play leads it, so the open
                  card carries every lid ability (user ask, 2026-08-25 —
                  this seat was the Duration readout; the span now rides
                  the key's tooltip so the number survives without the
                  label's width). Like the lid's key, it stays mounted
                  across the run swapping glyph and action — unmounting
                  under the focus that pressed it would drop focus. */}
              {(() => {
                const span = keyframeSpan(macro.steps);
                const durationTitle = span
                  ? `Duration ${span.last - span.first} fr`
                  : undefined;
                return (
                  <div className="mt-1.5 flex items-center gap-1.5 border-t border-dotted border-border px-2 pt-1.5">
                    <button
                      type="button"
                      className={ICON_KEY_CLASS}
                      aria-label={isPlayingThis ? `Stop ${macro.name}` : `Play ${macro.name}`}
                      {...(durationTitle && !isPlayingThis ? { title: durationTitle } : {})}
                      disabled={!isPlayingThis && playDisabled}
                      onClick={() =>
                        isPlayingThis ? onResolveFailure("stop") : onPlay(options)
                      }
                      data-testid="footer-play-button"
                    >
                      {isPlayingThis ? (
                        <Square
                          className="size-3 fill-current text-[color:var(--ink-red-text)]"
                          strokeWidth={2.5}
                        />
                      ) : (
                        <Play className="size-3.5 translate-x-[0.5px] fill-current" />
                      )}
                    </button>
                    {durationTitle && (
                      <span className="sr-only">{durationTitle}</span>
                    )}
                    {/* The ×N reads as the dial's setting beside the control
                        that changes it — the label is for screen readers,
                        the footer hasn't the width for it beside two keys. */}
                    <span
                      className="mono ms-auto text-10 tabular-nums whitespace-nowrap"
                      title={`Repeats ${options.repeat ?? 1}×`}
                    >
                      <span className="sr-only">Repeats </span>
                      {options.repeat ?? 1}×
                    </span>
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
                          // Reset the draft like the collapsed lid's menu
                          // does — a stale draft from an abandoned rename
                          // would otherwise open (and blur-commit) here.
                          onRename={() => {
                            setDraftName(macro.name);
                            onRenameStart();
                          }}
                          onDuplicate={onDuplicate}
                          onCopyJson={onCopyJson}
                          onDelete={onDeleteRequest}
                        />
                      </>
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}
    </li>
  );
}
