import { Button } from "@lottiefiles/creator-plugins-ui";
import { Circle } from "lucide-react";

export interface HeaderProps {
  onRecord: () => void;
  recordDisabled?: boolean;
}

export function Header({ onRecord, recordDisabled }: HeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-background px-3 py-2">
      <h1 className="truncate text-13 font-semibold">Macro Recorder</h1>
      <Button
        size="sm"
        onClick={onRecord}
        disabled={recordDisabled}
        data-testid="record-button"
      >
        <Circle className="size-3 fill-current text-destructive" aria-hidden />
        Record
      </Button>
    </header>
  );
}
