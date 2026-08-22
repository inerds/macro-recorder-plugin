import { Button } from "@lottiefiles/creator-plugins-ui";
import { Circle } from "lucide-react";

export interface HeaderProps {
  onRecord: () => void;
  recordDisabled?: boolean;
}

export function Header({ onRecord, recordDisabled }: HeaderProps) {
  return (
    <header className="flex items-center justify-between gap-2 border-b border-border bg-background px-3 py-2">
      {/* The document's h1 is the sr-only one at the panel root. */}
      <p className="truncate text-13 font-semibold">Macro Recorder</p>
      <Button
        size="sm"
        className="press"
        onClick={onRecord}
        disabled={recordDisabled}
        data-testid="record-button"
      >
        <Circle className="size-3! fill-current text-destructive" aria-hidden />
        Record
      </Button>
    </header>
  );
}
