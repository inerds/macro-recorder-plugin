/**
 * The one line a run leaves behind. The count is the claim it makes, so the
 * kinds decide it: an adaptation that WORKED must never be reported as a
 * skipped step (the stagger delay note, which every staggered run emits).
 */
import { describe, expect, it } from "vitest";

import { summarizePlaybackNotes } from "./playbackNotes";

const note = (index: number, target: string, reason: string) =>
  `Step ${index} · ${target}: ${reason}`;

describe("summarizePlaybackNotes", () => {
  it("counts the skips alone when a run has both kinds", () => {
    const notes = [
      note(1, "A", "delayed this layer by 4 frames — in point 0 → 4"),
      note(1, "B", "delayed this layer by 8 frames — in point 0 → 8"),
      note(2, "A", "fills[0] not found on this layer — skipped"),
      note(3, "A", "fills[0] not found on this layer — skipped"),
    ];
    expect(summarizePlaybackNotes(notes, ["info", "info", "skip", "skip"])).toBe(
      "2 steps adapted or skipped — fills[0] not found on this layer — skipped (2 times)",
    );
  });

  it("says adjusted, not skipped, when every note is an adaptation that worked", () => {
    const notes = [
      note(1, "A", "delayed this layer by 4 frames — in point 0 → 4"),
      note(1, "B", "delayed this layer by 8 frames — in point 0 → 8"),
    ];
    expect(summarizePlaybackNotes(notes, ["info", "info"])).toBe(
      "2 steps adjusted — delayed this layer by 4 frames — in point 0 → 4 and other reasons",
    );
  });

  it("names the step and its target when there is one note", () => {
    expect(summarizePlaybackNotes([note(3, "Hero", "this layer can't take masks — skipped")])).toBe(
      "Step 3 (Hero): this layer can't take masks — skipped",
    );
  });

  it("reads a note with no kind as a skip, so an old sandbox still reports", () => {
    const notes = [note(1, "A", "no fill here — skipped"), note(2, "A", "no fill here — skipped")];
    expect(summarizePlaybackNotes(notes)).toBe(
      "2 steps adapted or skipped — no fill here — skipped (2 times)",
    );
  });
});
