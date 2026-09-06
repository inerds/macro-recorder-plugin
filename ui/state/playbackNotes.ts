import type { NoteKind } from "../types";

/**
 * One line for everything a run adapted or did not apply.
 *
 * Notes arrive as "Step 3 · Hero: reason" strings with a parallel kind. A
 * `skip` did not fully apply; an `info` applied after an adaptation worth
 * reporting ("delayed this layer by 4 frames"). A run with skips reports the
 * skips alone — counting the info notes with them called a working stagger a
 * skipped step. A run with only info notes says "adjusted", never "skipped".
 *
 * Identical reasons are deduped, so the line names what happened rather than
 * repeating it: "4 steps adapted or skipped — fills not found on this layer".
 */
export function summarizePlaybackNotes(
  notes: readonly string[],
  noteKinds: readonly NoteKind[] = [],
): string {
  // A note from an older sandbox carries no kind; read it as a skip.
  const skips = notes.filter((_, i) => (noteKinds[i] ?? "skip") === "skip");
  const reported = skips.length > 0 ? skips : notes;
  if (reported.length === 0) return "";
  if (reported.length === 1) {
    return reported[0]!.replace(/^Step (\d+) · ([^:]+): /, "Step $1 ($2): ");
  }
  const verb = skips.length > 0 ? "adapted or skipped" : "adjusted";
  const counts = new Map<string, number>();
  for (const note of reported) {
    const reason = note.replace(/^Step \d+ · [^:]+: /, "");
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  const [topReason, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  return (
    `${reported.length} steps ${verb} — ${topReason}` +
    (topCount > 1 ? ` (${topCount} times)` : "") +
    (counts.size > 1 ? " and other reasons" : "")
  );
}
