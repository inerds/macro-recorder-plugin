import {
  Button,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from "@lottiefiles/creator-plugins-ui";
import { ClipboardPaste } from "lucide-react";
import { useId, useRef, useState } from "react";

export interface ImportButtonProps {
  /** Resolves when the macro is saved; rejects with the reason to show. */
  onImport: (json: string) => Promise<void>;
}

/**
 * The paste-side wording lives here, not in engine/macro.ts: the parser's
 * messages say "file" (they predate the paste flow and also run in the
 * sandbox), and rewording them there would be a sandbox change for a purely
 * presentational fix.
 */
function importErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/not a valid json/i.test(message)) {
    return "That text isn't valid JSON. Paste everything Copy JSON put on the clipboard, including the braces.";
  }
  if (/not a valid macro/i.test(message)) {
    return "That JSON isn't a macro. Use Copy JSON on a macro to get the right text.";
  }
  return message || "Unable to import. Check the text and try again.";
}

/**
 * Import lives behind a paste dialog rather than a file picker: Creator's
 * sandboxed iframe blocks downloads, so macros travel as copied JSON
 * (see docs/limitations.md) and the file half of the round trip went with it.
 */
export function ImportButton({ onImport }: ImportButtonProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fieldId = useId();
  const errorId = useId();

  const close = () => {
    setOpen(false);
    setText("");
    setError(null);
    setBusy(false);
    // No DialogTrigger (the trigger is the library Button), so the focus
    // restore that a trigger would provide is done by hand.
    queueMicrotask(() => triggerRef.current?.focus());
  };

  const submit = () => {
    const json = text.trim();
    if (!json || busy) return;
    setBusy(true);
    onImport(json).then(close, (reason: unknown) => {
      setBusy(false);
      setError(importErrorText(reason));
    });
  };

  return (
    <>
      <Button
        ref={triggerRef}
        size="sm"
        variant="ghost"
        className="press key-quiet"
        // Icon-only: the shelf it sits on already says what this list is,
        // and the word cost the row width the macro counts need. The name
        // survives for the pointer (title) and for assistive tech.
        aria-label="Import a macro"
        title="Import a macro"
        onClick={() => setOpen(true)}
        data-testid="import-button"
      >
        <ClipboardPaste className="size-3!" strokeWidth={2.5} aria-hidden />
      </Button>
      <DialogRoot
        open={open}
        onOpenChange={(next: boolean) => {
          if (!next) close();
        }}
      >
        <DialogContent
          className="w-[calc(100%-1.5rem)] max-w-[280px] gap-2"
          data-testid="import-dialog"
        >
          <DialogTitle className="instrument">Import a macro</DialogTitle>
          <DialogDescription className="text-11 text-muted-foreground">
            Paste the JSON that Copy JSON produced — from another project, or
            from a teammate.
          </DialogDescription>
          <label htmlFor={fieldId} className="sr-only">
            Macro JSON
          </label>
          <textarea
            id={fieldId}
            value={text}
            autoFocus
            rows={7}
            placeholder='{ "name": … }'
            onChange={(event) => {
              setText(event.target.value);
              if (error) setError(null);
            }}
            aria-invalid={error !== null}
            aria-describedby={error ? errorId : undefined}
            className="mono w-full resize-none rounded-[7px] border border-border bg-background px-2 py-1.5 text-11 leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="import-json-input"
          />
          {error && (
            <p
              id={errorId}
              role="alert"
              className="text-11 text-[color:var(--ink-red-text)]"
              data-testid="import-error"
            >
              {error}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-1.5 border-t border-border pt-3">
            <Button
              size="sm"
              variant="ghost"
              className="press key key-outline"
              onClick={close}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="press key key-red"
              disabled={text.trim() === "" || busy}
              onClick={submit}
              data-testid="import-submit"
            >
              Import
            </Button>
          </div>
        </DialogContent>
      </DialogRoot>
    </>
  );
}
