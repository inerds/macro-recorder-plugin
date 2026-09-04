import { isMacroShape, parseImportedMacro } from "../../engine/macro";
import type { Macro } from "../types";
import { newId } from "../utils/id";
import type { MacroStore } from "./types";

const STORAGE_KEY = "macro-recorder:macros";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/**
 * Creator mounts plugin UIs in an `<iframe sandbox="allow-scripts">` (opaque
 * origin), where merely touching localStorage throws a SecurityError. Fall
 * back to in-memory storage there — macros won't survive a reload until the
 * real creator.clientStorage engine is wired in.
 */
function safeLocalStorage(): StorageLike {
  try {
    const probe = "macro-recorder:probe";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    console.warn(
      "[macro-recorder] localStorage unavailable (sandboxed iframe) — using in-memory storage",
    );
    const data = new Map<string, string>();
    return {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
    };
  }
}

/**
 * localStorage-backed store for UI-first development.
 * Swaps to creator.clientStorage when the real plugin engine is wired up.
 */
export class LocalMacroStore implements MacroStore {
  private storage: StorageLike;

  constructor(storage?: StorageLike) {
    this.storage = storage ?? safeLocalStorage();
  }

  private read(): Macro[] {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (m): m is Macro => isMacroShape(m) && typeof (m as Macro).id === "string",
      );
    } catch {
      return [];
    }
  }

  private write(macros: Macro[]): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(macros));
  }

  async list(): Promise<Macro[]> {
    return this.read();
  }

  async save(macro: Macro): Promise<void> {
    const macros = this.read();
    const index = macros.findIndex((m) => m.id === macro.id);
    if (index >= 0) macros[index] = macro;
    else macros.push(macro);
    this.write(macros);
  }

  async rename(id: string, name: string): Promise<void> {
    this.write(this.read().map((m) => (m.id === id ? { ...m, name } : m)));
  }

  async remove(id: string): Promise<void> {
    this.write(this.read().filter((m) => m.id !== id));
  }

  async importMacro(json: string): Promise<Macro> {
    const macro = parseImportedMacro(json, newId);
    await this.save(macro);
    return macro;
  }

  exportMacro(macro: Macro): string {
    return JSON.stringify(macro, null, 2);
  }
}
