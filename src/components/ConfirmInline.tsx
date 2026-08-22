import { Button } from "@lottiefiles/creator-plugins-ui";
import { useEffect, useId } from "react";

export interface ConfirmInlineProps {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
}

/**
 * Compact inline confirmation — fits the 300px panel without a dialog. It is
 * NOT an alertdialog: nothing here traps focus or blocks the rest of the
 * panel, so it announces itself as a plain labelled group instead.
 */
export function ConfirmInline({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  destructive = true,
}: ConfirmInlineProps) {
  const messageId = useId();

  // Escape cancels from anywhere while this is up — the keypress rarely
  // happens inside the two buttons.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="inline-enter flex flex-col gap-2 rounded-md bg-muted p-2 shadow-[0_1px_2px_-1px_oklch(0_0_0/0.08),0_2px_6px_-2px_oklch(0_0_0/0.12)] dark:shadow-[0_1px_2px_-1px_oklch(0_0_0/0.4),0_2px_6px_-2px_oklch(0_0_0/0.5)]"
      role="group"
      aria-labelledby={messageId}
    >
      <p id={messageId} role="alert" className="text-12 text-foreground">
        {message}
      </p>
      <div className="flex justify-end gap-1.5">
        {/* Focus lands on the safe choice: this prompt appears unbidden, and
            a stray Enter must not be the one that deletes something. */}
        <Button
          size="sm"
          variant="ghost"
          className="press"
          onClick={onCancel}
          autoFocus
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="press"
          variant={destructive ? "destructive" : "default"}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
