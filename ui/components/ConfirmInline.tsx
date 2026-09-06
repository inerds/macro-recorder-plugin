import { Button, cn } from "@lottiefiles/creator-plugins-ui";
import { useEffect, useId, useRef } from "react";

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
  const groupRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  // This prompt appears in place and takes focus (the Cancel key autofocuses),
  // so it also has to give focus back: when it goes away, whatever the user
  // was on before it opened gets the caret again instead of the document.
  useEffect(() => {
    const active = document.activeElement;
    returnFocus.current = active instanceof HTMLElement && active !== document.body ? active : null;
    return () => {
      const group = groupRef.current;
      // StrictMode double-invokes mount effects, and that cleanup runs while
      // the prompt is still on screen — a real unmount has already detached
      // it. Restoring on the first would just undo the autoFocus.
      if (!group || group.isConnected) return;
      const previous = returnFocus.current;
      if (!previous || !previous.isConnected) return;
      // Restore only if this prompt still owned focus: either it is still
      // inside the group, or the browser dropped it to <body> when the
      // focused key was removed. Focus that moved on elsewhere is left alone.
      const focused = document.activeElement;
      if (focused && focused !== document.body && !group.contains(focused)) return;
      previous.focus();
    };
  }, []);

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
      ref={groupRef}
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
        {/* A destructive confirm wore the exact cap the Save primary wears, so
            "Delete" and "Save" were the same object in the same place — the
            word was the only thing separating them. `.key-armed` is the skin's
            answer (cream face, red legend, red edge and red drop): armed, and
            visibly not the filled key that saves. A non-destructive confirm
            IS the primary, so it keeps the red cap. `variant` never reached
            the cap — the key classes are the whole treatment — so it goes. */}
        <Button
          size="sm"
          className={cn("press key", destructive ? "key-armed" : "key-red")}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
