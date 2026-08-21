import { Button } from "@lottiefiles/creator-plugins-ui";

export interface ConfirmInlineProps {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
}

/** Compact inline confirmation — fits the 300px panel without a dialog. */
export function ConfirmInline({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  destructive = true,
}: ConfirmInlineProps) {
  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-border bg-muted p-2"
      role="alertdialog"
      aria-label={message}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <p className="text-12 text-foreground">{message}</p>
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant={destructive ? "destructive" : "default"}
          onClick={onConfirm}
          autoFocus
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
