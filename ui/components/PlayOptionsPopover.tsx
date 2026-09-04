import {
  Button,
  Checkbox,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
  NumberInput,
} from "@lottiefiles/creator-plugins-ui";
import { SlidersHorizontal } from "lucide-react";
import { useId, useRef, useState } from "react";

import type { PlayOptions } from "../gateways/types";

import { ICON_KEY_CLASS } from "./iconKey";

export interface PlayOptionsPopoverProps {
  macroName: string;
  disabled?: boolean;
  /** This macro replays as a scene script, so stagger has no targets. */
  sceneScript?: boolean;
  /** The row's current options (the bare Play button uses them too). */
  value: PlayOptions;
  onChange: (options: PlayOptions) => void;
  onPlay: (options: PlayOptions) => void;
  /**
   * Optional outside control. A narrow panel hides the trigger and offers
   * the dialog from the overflow menu instead, so the row needs a way in
   * that isn't the key. Omit both and the dialog owns its own state.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const DEFAULTS = { atPlayhead: false, staggerFrames: 0, repeat: 1 };

/** Only non-default fields travel — the gateways treat absent as default. */
function normalize(draft: {
  atPlayhead: boolean;
  staggerFrames: number;
  repeat: number;
}): PlayOptions {
  const options: PlayOptions = {};
  if (draft.atPlayhead) options.atPlayhead = true;
  if (draft.staggerFrames > 0) options.staggerFrames = draft.staggerFrames;
  if (draft.repeat > 1) options.repeat = draft.repeat;
  return options;
}

/**
 * Per-run playback choices. A Dialog rather than a Dropdown: the dropdown is
 * a Base UI menu, whose composite keyboard handling (typeahead, arrow keys)
 * fights the number inputs this panel is made of.
 */
export function PlayOptionsPopover({
  macroName,
  disabled,
  sceneScript,
  value,
  onChange,
  onPlay,
  open: openProp,
  onOpenChange,
}: PlayOptionsPopoverProps) {
  const [selfOpen, setSelfOpen] = useState(false);
  const open = openProp ?? selfOpen;
  const setOpen = (next: boolean) => {
    setSelfOpen(next);
    onOpenChange?.(next);
  };
  // What the dialog opened with — anything but Play puts it back. The fields
  // write straight through to the row (the bare Play button shares them), so
  // dismissing without this would silently keep the abandoned edits.
  const [openedWith, setOpenedWith] = useState<PlayOptions>(value);
  /** Set when Cancel or Play already decided what happens to the edits. */
  const handled = useRef(false);
  const playheadId = useId();
  const playheadHintId = useId();
  const staggerId = useId();
  const staggerHintId = useId();
  const repeatId = useId();
  const repeatHintId = useId();

  const atPlayhead = value.atPlayhead ?? DEFAULTS.atPlayhead;
  const staggerFrames = value.staggerFrames ?? DEFAULTS.staggerFrames;
  const repeat = value.repeat ?? DEFAULTS.repeat;

  const update = (patch: Partial<typeof DEFAULTS>) => {
    onChange(normalize({ atPlayhead, staggerFrames, repeat, ...patch }));
  };

  /**
   * A controlled Dialog does not fire onOpenChange when the parent closes it,
   * so the buttons revert (or keep) the edits themselves — and flag it, in
   * case a future version does fire it too.
   */
  const close = (revert: boolean) => {
    handled.current = true;
    if (revert) onChange(openedWith);
    setOpen(false);
  };

  return (
    <DialogRoot
      open={open}
      onOpenChange={(next: boolean) => {
        if (next) {
          setOpenedWith(value);
          handled.current = false;
        } else if (!handled.current) {
          // Escape or an outside click: an abandoned dialog leaves nothing
          // behind.
          onChange(openedWith);
        }
        setOpen(next);
      }}
    >
      <DialogTrigger
        aria-label={`Play options for ${macroName}`}
        disabled={disabled}
        className={ICON_KEY_CLASS}
        data-testid="play-options-trigger"
      >
        <SlidersHorizontal className="size-3.5" strokeWidth={2.5} />
      </DialogTrigger>
      <DialogContent
        className="w-[calc(100%-1.5rem)] max-w-[280px] gap-2"
        data-testid="play-options"
      >
        <DialogTitle className="instrument">Play options</DialogTitle>
        <DialogDescription className="sr-only">
          Choose how this macro is applied on this run.
        </DialogDescription>

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-12">
            <Checkbox
              id={playheadId}
              checked={atPlayhead}
              onCheckedChange={(next) => update({ atPlayhead: next })}
              aria-describedby={playheadHintId}
            />
            <label htmlFor={playheadId}>At playhead</label>
          </div>
          <p id={playheadHintId} className="text-11 text-muted-foreground">
            Moves the macro's earliest keyframe to the current frame.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2 text-12">
            <label htmlFor={staggerId} className={sceneScript ? "text-muted-foreground" : ""}>
              Stagger
            </label>
            <NumberInput
              id={staggerId}
              value={staggerFrames}
              onChange={(next) => update({ staggerFrames: next })}
              min={0}
              step={1}
              suffix=" frames"
              disabled={sceneScript}
              className="h-6 w-20"
              {...(sceneScript ? { "aria-describedby": staggerHintId } : {})}
            />
          </div>
          {sceneScript && (
            <p id={staggerHintId} className="text-11 text-muted-foreground">
              Stagger needs a macro that applies to selected layers
            </p>
          )}
        </div>

        <div
          role="group"
          aria-labelledby={repeatId}
          aria-describedby={repeatHintId}
          className="flex flex-col gap-1"
        >
          <div className="flex items-center justify-between gap-2 text-12">
            <label id={repeatId} htmlFor={`${repeatId}-input`}>
              Repeat
            </label>
            <NumberInput
              id={`${repeatId}-input`}
              value={repeat}
              onChange={(next) => update({ repeat: next })}
              min={1}
              max={100}
              step={1}
              className="h-6 w-20"
            />
          </div>
          <p id={repeatHintId} className="text-11 text-muted-foreground">
            Each repeat applies on top of the last.
          </p>
        </div>

        <div className="mt-2 flex justify-end gap-1.5 border-t border-border pt-3">
          <Button
            size="sm"
            variant="ghost"
            className="press key key-outline"
            onClick={() => close(true)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="press key key-red"
            onClick={() => {
              close(false);
              onPlay(normalize({ atPlayhead, staggerFrames, repeat }));
            }}
            data-testid="play-with-options"
          >
            Play
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
