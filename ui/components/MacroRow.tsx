import { Button, cn, Input } from "@lottiefiles/creator-plugins-ui";
import { Check, ChevronRight, Play, Square } from "lucide-react";
import { useId, useRef, useState } from "react";

import type { EditableValue } from "../../engine/editing";
import { describePlaybackMode, playbackModeHint } from "../../engine/playbackMode";
import { hasKeyframes, keyframeSpan } from "../../engine/steps";
import { enabledSteps, type PlayOptions } from "../gateways/types";
import type { PlayingState } from "../state/appReducer";
import { stepStatusFor, type PlayStepStatus } from "../state/stepStatus";
import { useNarrowPanel } from "../state/useNarrowPanel";
import type { Macro } from "../types";
import { ConfirmInline } from "./ConfirmInline";
import { OverflowMenu } from "./OverflowMenu";
import { PlaybackStatus } from "./PlaybackStatus";
import { ICON_KEY_CLASS } from "./iconKey";
import { describePlayOptions } from "./playOptionsText";
import { atPlayheadHint, PlayOptionsPopover } from "./PlayOptionsPopover";
import { SimplifyButton } from "./SimplifyButton";
import { StepList } from "./StepList";
import { StepListHeader } from "./StepListHeader";

/** Why Play and its options are off on every row but the running one. */
const PLAY_DISABLED_REASON = "Another macro is playing";

/**
 * The look a natively disabled key gets for free. These keys keep their
 * reason (and their place in the tab order), so they wear it by hand.
 */
const DEAD_KEY_CLASS = "aria-disabled:cursor-default aria-disabled:opacity-40";

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
  // A narrow panel hides the closed row's play-options key; the dialog then
  // opens from the overflow menu, which needs the row to hold the state.
  const [optionsOpen, setOptionsOpen] = useState(false);
  const narrow = useNarrowPanel();
  const panelId = useId();
  const playDisabledId = useId();
  const disclosureRef = useRef<HTMLButtonElement>(null);

  const stepCount = macro.steps.length === 1 ? "1 step" : `${macro.steps.length} steps`;
  const optionSummary = describePlayOptions(options);
  const mode = describePlaybackMode(macro);

  const isPlayingThis = playing !== null;
  // Paused on a failure: the decision has moved into the warn-box below, so
  // the lid's stop square goes quiet rather than shouting a second red.
  const errorPaused = playing?.error != null;

  // Playback indices count ENABLED steps and keep climbing across repeats;
  // the list renders every step, so map back to its own index.
  const enabled = enabledSteps(macro);
  // The sandbox only ever sees the enabled steps, so the play options must
  // read "has keyframes" from the same list.
  const noKeyframes = !hasKeyframes(enabled);
  // The badge truncates, and the popover that explains "at playhead" is a
  // click away — so the pointer gets the dialog's own sentence here.
  const optionSummaryTitle =
    optionSummary && options.atPlayhead
      ? `${optionSummary} — ${atPlayheadHint({
          noKeyframes,
          sceneScript: mode.mode === "scene",
        })}`
      : optionSummary;
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
      className={cn("rack-row", expanded && "rack-row-open", justPlayed && "success-flash")}
      data-testid="macro-row"
      data-macro-id={macro.id}
    >
      {playDisabled && !isPlayingThis && (
        // One reason for both of this row's dead keys and its options key.
        <span id={playDisabledId} className="sr-only">
          {PLAY_DISABLED_REASON}
        </span>
      )}
      {renaming ? (
        <div
          className={cn(
            "flex items-center gap-1 px-1.5 py-1",
            expanded && "border-b border-dotted border-border",
          )}
        >
          {/* The row keeps its place in the rack while it is renamed — the
              number is the row's address, not a decoration of its name. */}
          <span className="rack-num shrink-0" aria-hidden>
            {String(index + 1).padStart(2, "0")}
          </span>
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
          className={cn(
            "flex items-center gap-1 px-1.5 py-1",
            expanded && "border-b border-dotted border-border",
          )}
        >
          {/* Outside the disclosure on purpose: the button's accessible name
              is the macro, not a catalogue number. */}
          <span className="rack-num shrink-0" aria-hidden>
            {String(index + 1).padStart(2, "0")}
          </span>
          <button
            type="button"
            ref={disclosureRef}
            // Stretches to the row's full height: the name is one line of
            // 11px type, and a 16px target for the row's own control is
            // under every pointer-target floor there is.
            className="press flex min-h-[22px] min-w-0 flex-1 items-center gap-1 self-stretch rounded-[7px] text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={onToggleExpand}
            data-row-disclosure
          >
            <ChevronRight
              className={cn(
                "me-0.5 size-3 shrink-0 text-muted-foreground/70 transition-[rotate] duration-150 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none",
                expanded && "rotate-90",
              )}
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
                className="rack-count mono shrink-0 text-10 text-muted-foreground tabular-nums"
                aria-hidden
              >
                {String(macro.steps.length).padStart(2, "0")}
              </span>
              <span className="sr-only">{stepCount}</span>
              {optionSummary && (
                <span
                  className="mono ms-1.5 max-w-[30%] shrink-0 truncate text-10 tabular-nums text-muted-foreground"
                  title={optionSummaryTitle}
                  data-testid="play-options-summary"
                >
                  {/* The badge truncates; the announcement never does. */}
                  <span className="sr-only">Play options: </span>
                  {optionSummary}
                </span>
              )}
            </span>
          </button>
          {/* Stays mounted across the run, swapping glyph and action: an
              unmounting Play button would drop the focus that pressed it —
              so while THIS macro plays, the stop key stays even on the open
              lid; otherwise the pop-out card's lid is bare (concept). */}
          {(!expanded || isPlayingThis) && (
            <button
              type="button"
              className={cn(ICON_KEY_CLASS, DEAD_KEY_CLASS)}
              aria-label={isPlayingThis ? `Stop ${macro.name}` : `Play ${macro.name}`}
              // aria-disabled, not disabled: a natively disabled key drops out
              // of the tab order with its reason, and the library's
              // `disabled:pointer-events-none` kills the tooltip that carried
              // it. Same idiom as SimplifyButton.
              aria-disabled={!isPlayingThis && playDisabled}
              {...(!isPlayingThis && playDisabled
                ? { "aria-describedby": playDisabledId, title: PLAY_DISABLED_REASON }
                : {})}
              onClick={() => {
                if (isPlayingThis) onResolveFailure("stop");
                else if (!playDisabled) onPlay(options);
              }}
              data-testid="play-button"
            >
              {isPlayingThis ? (
                <Square
                  className={cn(
                    "size-3 fill-current",
                    !errorPaused && "text-[color:var(--ink-red-text)]",
                  )}
                  // A filled square needs no outline: the 2.5 stroke grew the
                  // glyph past the Play triangle beside it.
                  strokeWidth={0}
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
                disabledReason={PLAY_DISABLED_REASON}
                sceneScript={mode.mode === "scene"}
                noKeyframes={noKeyframes}
                value={options}
                onChange={setOptions}
                onPlay={(next) => {
                  setOptions(next);
                  onPlay(next);
                }}
                open={optionsOpen}
                onOpenChange={setOptionsOpen}
              />
              <OverflowMenu
                macroName={macro.name}
                // The key beside this menu is hidden at <=286px; the ability
                // it stands for is not, so the menu picks it up there.
                {...(narrow && !playDisabled ? { onPlayOptions: () => setOptionsOpen(true) } : {})}
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
        <div id={panelId} className="inline-enter px-1.5 pb-1.5 pt-0.5">
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
                // A saved macro keeps the manual verb: it has no raw list to
                // put back, so Simplify is a one-way edit the user asks for.
                action={<SimplifyButton steps={macro.steps} onSimplify={onSimplify} />}
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
                const frames = span ? span.last - span.first : 0;
                const durationTitle = span
                  ? `Duration ${frames} ${frames === 1 ? "frame" : "frames"}`
                  : undefined;
                return (
                  <div className="mt-1.5 flex items-center gap-1 border-t border-dotted border-border px-1.5 pt-1.5">
                    <button
                      type="button"
                      className={cn(ICON_KEY_CLASS, DEAD_KEY_CLASS)}
                      aria-label={isPlayingThis ? `Stop ${macro.name}` : `Play ${macro.name}`}
                      aria-disabled={!isPlayingThis && playDisabled}
                      {...(!isPlayingThis && playDisabled
                        ? {
                            "aria-describedby": playDisabledId,
                            title: PLAY_DISABLED_REASON,
                          }
                        : durationTitle && !isPlayingThis
                          ? { title: durationTitle }
                          : {})}
                      onClick={() => {
                        if (isPlayingThis) onResolveFailure("stop");
                        else if (!playDisabled) onPlay(options);
                      }}
                      data-testid="footer-play-button"
                    >
                      {isPlayingThis ? (
                        <Square
                          className="size-3 fill-current text-[color:var(--ink-red-text)]"
                          strokeWidth={0}
                        />
                      ) : (
                        <Play className="size-3.5 translate-x-[0.5px] fill-current" />
                      )}
                    </button>
                    {durationTitle && <span className="sr-only">{durationTitle}</span>}
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
                          disabledReason={PLAY_DISABLED_REASON}
                          sceneScript={mode.mode === "scene"}
                          noKeyframes={noKeyframes}
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
