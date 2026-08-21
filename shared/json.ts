export type Json = number | string | boolean | null | Json[] | { [key: string]: Json };

const MAX_DEPTH = 8;

/**
 * Deep-copies a value read from a live Creator proxy into plain JSON-safe
 * data. Anything uncloneable (functions, cyclic refs beyond the depth cap)
 * becomes null so snapshots and RPC payloads stay structured-clone/JSON safe.
 */
export function toJson(value: unknown, depth = 0): Json {
  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === "number") return Number.isFinite(value as number) ? (value as number) : null;
  if (t === "string" || t === "boolean") return value as string | boolean;
  if (depth >= MAX_DEPTH) return null;
  if (Array.isArray(value)) return value.map((item) => toJson(item, depth + 1));
  if (t === "object") {
    const out: { [key: string]: Json } = {};
    for (const key of Object.keys(value as object)) {
      try {
        out[key] = toJson((value as Record<string, unknown>)[key], depth + 1);
      } catch {
        // unreadable property — omit
      }
    }
    return out;
  }
  return null;
}

const EPSILON = 1e-6;

/** Deep equality with a numeric epsilon, over JSON-safe values. */
export function jsonEqual(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) < EPSILON;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => jsonEqual(item, b[i]!));
  }
  if (
    a !== null &&
    b !== null &&
    typeof a === "object" &&
    typeof b === "object" &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => jsonEqual(a[key]!, (b as Record<string, Json>)[key] ?? null));
  }
  return false;
}
