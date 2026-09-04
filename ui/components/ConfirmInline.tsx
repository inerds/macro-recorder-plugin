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
      className="inline-enter flex flex-col gap-2 rounded-[10px] border border-border bg-muted p-2 shadow-[0_1px_2px_-1px_rgba(42,38,35,0.12),0_2px_6px_-2px_rgba(42,38,35,0.16)]"
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
          className="press key key-outline"
          onClick={onCancel}
          autoFocus
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="press key key-red"
          variant={destructive ? "destructive" : "default"}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
