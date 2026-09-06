import type { PlayOptions } from "../gateways/types";

/**
 * The one place play options turn into words: "repeat ×2 · stagger 4 frames ·
 * at playhead", or "" for a plain run. The row badge and the pre-play sheet
 * both read from here so they can never describe the same run differently.
 *
 * Every part is lowercase: the readout is one line of settings, not three
 * sentences, and a capital only on the first part made the badge read as a
 * label for the two parts after it.
 */
export function describePlayOptions(options: PlayOptions | undefined): string {
  if (!options) return "";
  const parts: string[] = [];
  if (options.repeat && options.repeat > 1) parts.push(`repeat ×${options.repeat}`);
  if (options.staggerFrames && options.staggerFrames > 0) {
    parts.push(
      `stagger ${options.staggerFrames} ${options.staggerFrames === 1 ? "frame" : "frames"}`,
    );
  }
  if (options.atPlayhead) parts.push("at playhead");
  return parts.join(" · ");
}
