import {
  DropdownContent,
  DropdownItem,
  DropdownRoot,
  DropdownTrigger,
} from "@lottiefiles/creator-plugins-ui";
import { MoreHorizontal } from "lucide-react";
import { useRef } from "react";

export interface OverflowMenuProps {
  macroName: string;
  onRename: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
}

export function OverflowMenu({
  macroName,
  onRename,
  onDuplicate,
  onExport,
  onDelete,
}: OverflowMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  /** Which item closed the menu — read at close time, not at render time. */
  const chosen = useRef<"self" | "trigger">("trigger");

  const pick = (kind: "self" | "trigger", run: () => void) => () => {
    chosen.current = kind;
    run();
  };

  return (
    <DropdownRoot>
      <DropdownTrigger
        ref={triggerRef}
        aria-label={`More actions for ${macroName}`}
        className="press flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-[7px] text-muted-foreground transition-[background-color,color,scale,box-shadow] duration-150 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none hover:bg-secondary hover:text-foreground hover:shadow-[inset_0_0_0_1px_rgba(42,38,35,0.18)] active:scale-[0.96] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="macro-overflow-trigger"
      >
        <MoreHorizontal className="size-3.5" strokeWidth={2.5} />
      </DropdownTrigger>
      {/* "self": the destination mounts its own autofocused control (the
          rename input, the delete confirmation) and the default focus restore
          would yank focus straight back out of it — for rename that also
          commits the rename. Duplicate and Export leave the row as it was, so
          focus returns to the trigger it came from rather than to the body. */}
      <DropdownContent
        align="end"
        className="max-w-56"
        finalFocus={() => (chosen.current === "self" ? false : triggerRef.current)}
      >
        <DropdownItem onSelect={pick("self", onRename)}>Rename</DropdownItem>
        <DropdownItem onSelect={pick("trigger", onDuplicate)}>Duplicate</DropdownItem>
        <DropdownItem onSelect={pick("trigger", onExport)}>Export JSON</DropdownItem>
        <DropdownItem variant="destructive" onSelect={pick("self", onDelete)}>
          Delete
        </DropdownItem>
      </DropdownContent>
    </DropdownRoot>
  );
}
