import { isMacroShape, type Macro } from "../engine/macro";

const KEY_PREFIX = "macro:";

function storageKey(id: string): string {
  return `${KEY_PREFIX}${id}`;
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
  return macros;
}

export async function saveMacro(macro: Macro): Promise<void> {
  try {
    await creator.clientStorage.set(storageKey(macro.id), macro);
  } catch {
    throw new Error("Storage full — delete a macro first");
  }
}

export async function renameMacro(id: string, name: string): Promise<void> {
  const value = await creator.clientStorage.get(storageKey(id));
  if (!isMacroShape(value)) throw new Error("Macro not found");
  await creator.clientStorage.set(storageKey(id), { ...(value as Macro), name });
}

export async function removeMacro(id: string): Promise<void> {
  await creator.clientStorage.delete(storageKey(id));
}
