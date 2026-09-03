import {
  DropdownContent,
  DropdownItem,
  DropdownRoot,
  DropdownTrigger,
} from "@lottiefiles/creator-plugins-ui";
import { MoreHorizontal } from "lucide-react";
import { useRef } from "react";

import { ICON_KEY_CLASS } from "./iconKey";

export interface OverflowMenuProps {
  macroName: string;
  /**
   * Set only while the row's play-options key is hidden (a narrow panel).
   * The menu is portalled, so the container query that hides the key cannot
   * hide this item — the row decides whether it exists at all.
   */
  onPlayOptions?: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onCopyJson: () => void;
  onDelete: () => void;
}

export function OverflowMenu({
  macroName,
  onPlayOptions,
  onRename,
  onDuplicate,
  onCopyJson,
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
        className={ICON_KEY_CLASS}
        data-testid="macro-overflow-trigger"
      >
        <MoreHorizontal className="size-3.5" strokeWidth={2.5} />
      </DropdownTrigger>
      {/* "self": the destination mounts its own autofocused control (the
          rename input, the delete confirmation) and the default focus restore
          would yank focus straight back out of it — for rename that also
          commits the rename. Duplicate and Copy JSON leave the row as it was, so
          focus returns to the trigger it came from rather than to the body
          (the clipboard-denied fallback dialog, if one opens, takes focus on
          its own afterwards). */}
      <DropdownContent
        align="end"
        className="max-w-56"
        finalFocus={() => (chosen.current === "self" ? false : triggerRef.current)}
      >
        {onPlayOptions && (
          // "self": the dialog autofocuses its own first field, and the
          // default focus restore would yank focus straight back out of it.
          <DropdownItem onSelect={pick("self", onPlayOptions)}>Play options…</DropdownItem>
        )}
        <DropdownItem onSelect={pick("self", onRename)}>Rename</DropdownItem>
        <DropdownItem onSelect={pick("trigger", onDuplicate)}>Duplicate</DropdownItem>
        <DropdownItem onSelect={pick("trigger", onCopyJson)}>Copy JSON</DropdownItem>
        <DropdownItem variant="destructive" onSelect={pick("self", onDelete)}>
          Delete
        </DropdownItem>
      </DropdownContent>
    </DropdownRoot>
  );
}
