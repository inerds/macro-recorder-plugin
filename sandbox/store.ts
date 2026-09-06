import { isMacroShape, type Macro } from "../engine/macro";

const KEY_PREFIX = "macro:";

function storageKey(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

/**
 * Last reading of `creator.clientStorage.usedQuota` — bytes this plugin's
 * store holds.
 *
 * It is cached rather than read on demand because `hello` MUST answer in the
 * same invocation (docs/architecture.md, "the one hard runtime constraint"):
 * the sandbox has no job pump, so an awaited value cannot reach a synchronous
 * reply. Every native-backed clientStorage call refreshes it, which is enough
 * to keep it current — the store only changes through this module.
 *
 * `usedQuota` is typed in creator-api-types 1.0.1 as a METHOD
 * (`usedQuota(): Promise<number>`) and is not live verified, so it stays
 * feature-detected; a number-valued property is accepted too. Absence is a
 * normal outcome, not an error.
 */
let usedQuota: number | undefined;

// Primed at plugin eval, which Creator DOES pump (evalCodeAsync), so the
// first `hello` of a session can already carry a figure.
void readUsedQuota();

/** The last known byte count, or undefined on a host that cannot say. */
export function lastUsedQuota(): number | undefined {
  return usedQuota;
}

async function readUsedQuota(): Promise<number | undefined> {
  try {
    const surface = (creator.clientStorage as unknown as { usedQuota?: unknown }).usedQuota;
    const value =
      typeof surface === "function" ? await surface.call(creator.clientStorage) : surface;
    if (typeof value === "number" && Number.isFinite(value)) {
      usedQuota = value;
      return value;
    }
  } catch {
    // host without the surface — see docs/runtime-api.md
  }
  return undefined;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "";
}

export async function listMacros(): Promise<Macro[]> {
  const keys = await creator.clientStorage.keys();
  const macros: Macro[] = [];
  for (const key of keys) {
    if (!key.startsWith(KEY_PREFIX)) continue;
    const value = await creator.clientStorage.get(key);
    if (isMacroShape(value) && typeof (value as Macro).id === "string") {
      macros.push(value as Macro);
    }
  }
  macros.sort((a, b) => a.createdAt - b.createdAt);
  // The keys() promise above has already pumped the queue, so this settles.
  await readUsedQuota();
  return macros;
}

export async function saveMacro(macro: Macro): Promise<void> {
  try {
    await creator.clientStorage.set(storageKey(macro.id), macro);
    await readUsedQuota();
  } catch (error) {
    // `set` rejects for more than one reason, and "Storage full — delete a
    // macro first" is bad advice for any of the others: it sends the user to
    // delete work over a failure deleting nothing will fix. Say it only when
    // the host itself names the cap — either in its message, or by reporting
    // a store that already holds bytes while giving no message at all. Any
    // other rejection surfaces the host's own words, which is what a trace
    // needs to be diagnosable. (The host exposes bytes USED and no maximum,
    // so the cap can never be measured directly — runtime-api.md.)
    const message = messageOf(error);
    const used = await readUsedQuota();
    // Deliberately narrow: "storage" or "full" alone match unrelated host
    // failures ("plugin storage unavailable"), and mis-blaming the cap is the
    // exact mistake this replaces.
    const namesTheCap = /quota|exceed|storage full|storage limit|out of space|no space/i.test(
      message,
    );
    if (namesTheCap || (!message && typeof used === "number" && used > 0)) {
      throw new Error("Storage full — delete a macro first");
    }
    throw new Error(message || "Couldn't save the macro. Try again.");
  }
}

export async function renameMacro(id: string, name: string): Promise<void> {
  const value = await creator.clientStorage.get(storageKey(id));
  if (!isMacroShape(value)) throw new Error("Macro not found");
  await creator.clientStorage.set(storageKey(id), { ...(value as Macro), name });
}

export async function removeMacro(id: string): Promise<void> {
  await creator.clientStorage.delete(storageKey(id));
  await readUsedQuota();
}
