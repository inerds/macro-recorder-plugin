import {
  Button,
  Checkbox,
  DialogContent,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
  NumberInput,
} from "@lottiefiles/creator-plugins-ui";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import type { PlayOptions } from "../gateways/types";

export interface PlayOptionsPopoverProps {
  macroName: string;
  disabled?: boolean;
  onPlay: (options: PlayOptions) => void;
}

const DEFAULTS = { atPlayhead: false, staggerFrames: 0, repeat: 1 };

/**
 * Per-run playback choices. A Dialog rather than a Dropdown: the dropdown is
 * a Base UI menu, whose composite keyboard handling (typeahead, arrow keys)
 * fights the number inputs this panel is made of.
 */
export function PlayOptionsPopover({
  macroName,
  disabled,
  onPlay,
}: PlayOptionsPopoverProps) {
  const [open, setOpen] = useState(false);
  const [atPlayhead, setAtPlayhead] = useState(DEFAULTS.atPlayhead);
  const [staggerFrames, setStaggerFrames] = useState(DEFAULTS.staggerFrames);
  const [repeat, setRepeat] = useState(DEFAULTS.repeat);

  const play = () => {
    // Only non-default fields travel — the gateways treat absent as default.
    const options: PlayOptions = {};
    if (atPlayhead) options.atPlayhead = true;
    if (staggerFrames > 0) options.staggerFrames = staggerFrames;
    if (repeat > 1) options.repeat = repeat;
    setOpen(false);
    onPlay(options);
  };

  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label={`Play options for ${macroName}`}
        disabled={disabled}
        className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
        onClick={(event: React.MouseEvent) => event.stopPropagation()}
        data-testid="play-options-trigger"
      >
        <ChevronDown className="size-3.5" />
      </DialogTrigger>
      {/* Portal clicks still bubble through the React tree to the row's
          expand-toggle handler. */}
      <DialogContent
        className="max-w-[280px] gap-3"
        onClick={(event: React.MouseEvent) => event.stopPropagation()}
        data-testid="play-options"
      >
        <DialogTitle className="text-12 font-medium">Play options</DialogTitle>

        <label className="flex items-center gap-2 text-12">
          <Checkbox
            checked={atPlayhead}
            onCheckedChange={setAtPlayhead}
            aria-label="At playhead"
          />
          At playhead
        </label>

        <label className="flex items-center justify-between gap-2 text-12">
          Stagger
          <span className="flex items-center gap-1.5">
            <NumberInput
              value={staggerFrames}
              onChange={setStaggerFrames}
              min={0}
              step={1}
              className="h-6 w-20"
            />
            <span className="text-11 text-muted-foreground">frames</span>
          </span>
        </label>

        <div className="flex flex-col gap-1">
          <label className="flex items-center justify-between gap-2 text-12">
            Repeat
            <NumberInput
              value={repeat}
              onChange={setRepeat}
              min={1}
              max={100}
              step={1}
              className="h-6 w-20"
            />
          </label>
          <p className="text-10 text-muted-foreground">
            Each repeat applies on top of the last.
          </p>
        </div>

        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={play} data-testid="play-with-options">
            Play
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
