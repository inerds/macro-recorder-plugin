import {
  DropdownContent,
  DropdownItem,
  DropdownRoot,
  DropdownTrigger,
} from "@lottiefiles/creator-plugins-ui";
import { MoreVertical } from "lucide-react";

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
  return (
    <DropdownRoot>
      <DropdownTrigger
        aria-label={`More actions for ${macroName}`}
        className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(event: React.MouseEvent) => event.stopPropagation()}
        data-testid="macro-overflow-trigger"
      >
        <MoreVertical className="size-3.5" />
      </DropdownTrigger>
      {/* finalFocus={false}: default focus restore would blur the rename
          input the instant it mounts, committing the rename prematurely.
          Every destination of these actions autofocuses its own control.
          stopPropagation: portal clicks still bubble through the React tree
          to the row's expand-toggle handler. */}
      <DropdownContent
        align="end"
        className="max-w-56"
        finalFocus={false}
        onClick={(event: React.MouseEvent) => event.stopPropagation()}
      >
        <DropdownItem onSelect={onRename}>Rename</DropdownItem>
        <DropdownItem onSelect={onDuplicate}>Duplicate</DropdownItem>
        <DropdownItem onSelect={onExport}>Export JSON</DropdownItem>
        <DropdownItem variant="destructive" onSelect={onDelete}>
          Delete
        </DropdownItem>
      </DropdownContent>
    </DropdownRoot>
  );
}
