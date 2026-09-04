/**
 * Id generator safe in every runtime this project has:
 * - Creator's UI iframe (opaque origin — no crypto.randomUUID)
 * - the QuickJS plugin sandbox (no crypto global at all)
 * - normal browsers and node/vitest.
 */
export function newId(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
