import type { ScopeReport } from "../../engine/protocol";

/**
 * The one place a recording scope turns into words. The deck's readout, the
 * recording chip and the review hint all read from here, so they can never
 * describe the same recording differently.
 *
 * Every string is sentence-shaped and unstyled: the deck uppercases its copy
 * in CSS, and the chip supplies its own emphasis.
 */

/**
 * The scope as a noun phrase: "Layer A", "Layer A + 2 more", "3 layers"
 * (nothing named), "whole scene". No leading article — the callers that need
 * one ("the whole scene") add it, and the deck's legend must not carry one.
 */
export function scopeName(scope: ScopeReport | null | undefined): string {
  // A layer scope with no layers cannot be recorded; the sandbox reports the
  // scene instead. Say "whole scene" rather than invent a count of nothing.
  if (!scope || scope.kind === "scene" || scope.layers.length === 0) return "whole scene";
  const [first, ...rest] = scope.layers;
  if (!first?.name) {
    return scope.layers.length === 1 ? "1 layer" : `${scope.layers.length} layers`;
  }
  return rest.length === 0 ? first.name : `${first.name} + ${rest.length} more`;
}

/**
 * The running count of edits dropped as out of scope: "1 change outside
 * Layer A ignored". Empty for zero, so a caller can render it or not on the
 * string alone.
 */
export function ignoredText(count: number, scope: ScopeReport | null | undefined): string {
  if (!Number.isFinite(count) || count <= 0) return "";
  const changes = count === 1 ? "change" : "changes";
  return `${count} ${changes} outside ${ignoredWhere(scope)} ignored`;
}

/** What the ignored edits were outside OF. */
function ignoredWhere(scope: ScopeReport | null | undefined): string {
  if (!scope || scope.kind === "scene" || scope.layers.length === 0) return "the recording";
  // Naming every layer would outgrow the chip; past one, the count carries it.
  if (scope.layers.length > 1) return `the ${scope.layers.length} recorded layers`;
  return scope.layers[0]?.name ?? "the recorded layer";
}
