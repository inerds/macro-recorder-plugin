/**
 * Legacy selection-based copy, for contexts where the async clipboard is
 * denied (Creator's opaque-origin iframe — see TraceStrip's copy()). Must be
 * called inside a user gesture or execCommand refuses. Returns whether the
 * browser reported the copy as done.
 */
export function copyViaHiddenTextarea(text: string): boolean {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}
