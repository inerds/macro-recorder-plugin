import {
  Button,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from "@lottiefiles/creator-plugins-ui";
import { useEffect, useRef, useState } from "react";

/** What copyMacroJson hands back when every clipboard route was denied. */
export interface CopyJsonPayload {
  name: string;
  json: string;
}

/**
 * Last-resort copy path. Creator's sandboxed iframe blocks file downloads
 * outright and usually denies the async clipboard (opaque origin), so when
 * both automatic routes fail this dialog shows the JSON pre-selected for a
 * manual copy. The Copy key retries execCommand("copy") — inside the click
 * gesture it often succeeds where the automatic attempt could not.
 */
export function CopyJsonDialog({
  payload,
  onClose,
  onCopied,
}: {
  payload: CopyJsonPayload | null;
  onClose: () => void;
  /** Announce the success (toast + live region) — the dialog closes itself. */
  onCopied: (name: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [blocked, setBlocked] = useState(false);

  // Pre-select the JSON so ⌘C works the moment the dialog opens.
  useEffect(() => {
    if (!payload) {
      setBlocked(false);
      return;
    }
    const frame = requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [payload]);

  const copyNow = () => {
    if (!payload) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    if (copied) {
      onCopied(payload.name);
      onClose();
    } else {
      setBlocked(true);
    }
  };

  return (
    <DialogRoot
      open={payload !== null}
      onOpenChange={(next: boolean) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="w-[calc(100%-1.5rem)] max-w-[280px] gap-2"
        data-testid="copy-json-dialog"
      >
        <DialogTitle className="instrument">Copy macro JSON</DialogTitle>
        <DialogDescription className="text-11 text-muted-foreground">
          The clipboard is blocked here, so copy the text yourself. It is
          already selected — paste it into Import on the other side.
        </DialogDescription>
        <textarea
          ref={textareaRef}
          readOnly
          value={payload?.json ?? ""}
          rows={7}
          aria-label={payload ? `JSON for ${payload.name}` : "Macro JSON"}
          onFocus={(event) => event.currentTarget.select()}
          className="mono w-full resize-none rounded border border-border bg-background px-2 py-1.5 text-11 leading-relaxed text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="copy-json-textarea"
        />
        {blocked && (
          <p role="alert" className="text-11 text-[color:var(--ink-red-text)]">
            Copying is blocked here too. Press ⌘C or Ctrl+C while the text is
            selected.
          </p>
        )}
        <div className="mt-2 flex justify-end gap-1.5 border-t border-border pt-3">
          <Button
            size="sm"
            variant="ghost"
            className="press key key-outline"
            onClick={onClose}
          >
            Close
          </Button>
          <Button
            size="sm"
            className="press key key-red"
            onClick={copyNow}
            data-testid="copy-json-retry"
          >
            Copy
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  );
}
