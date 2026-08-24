import { Button } from "@lottiefiles/creator-plugins-ui";
import { ChevronDown } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import type { MacroStore } from "../gateways/types";
import { buildDemoMacros } from "./demoMacros";

const PRELOAD_KEY = "macro-recorder:dev:preload-demo";

/**
 * Persist the preload toggle where we can. Creator's plugin iframe has an
 * opaque origin where localStorage THROWS, so every access is guarded and the
 * setting simply doesn't survive a reload there — acceptable for a dev knob.
 */
function readPreload(): boolean {
  try {
    return window.localStorage.getItem(PRELOAD_KEY) === "1";
  } catch {
    return false;
  }
}
function writePreload(on: boolean) {
  try {
    if (on) window.localStorage.setItem(PRELOAD_KEY, "1");
    else window.localStorage.removeItem(PRELOAD_KEY);
  } catch {
    // opaque origin — in-memory only
  }
}

export interface DevSettingsProps {
  store: MacroStore;
  macroCount: number;
  onStoreChanged: () => void;
  /** Extra sections shown in the drawer (TraceStrip, mock-mode DebugStrip). */
  children?: ReactNode;
}

/**
 * The ONE dev strip at the panel foot. Gated on `import.meta.env.DEV` alone,
 * so the real `creator.clientStorage` store can be seeded and wiped from
 * inside Creator during a dev session. Everything dev-only lives in this
 * drawer as sections (`children`: TraceStrip always, DebugStrip's mock
 * scenario controls in mock mode) — collapsed, the panel foot is a single
 * quiet header row.
 */
export function DevSettings({ store, macroCount, onStoreChanged, children }: DevSettingsProps) {
  const [open, setOpen] = useState(false);
  const [preload, setPreload] = useState(readPreload);
  const [busy, setBusy] = useState<"load" | "clear" | null>(null);
  const [armed, setArmed] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function loadDemo() {
    setBusy("load");
    try {
      const macros = buildDemoMacros();
      for (const macro of macros) await store.save(macro);
      onStoreChanged();
      flash(`loaded ${macros.length} demo macros`);
    } finally {
      setBusy(null);
    }
  }

  async function clearAll() {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    setBusy("clear");
    try {
      // No bulk delete on the store surface (plugin/store.ts is one
      // clientStorage entry per macro) — list and remove one by one.
      const macros = await store.list();
      for (const macro of macros) await store.remove(macro.id);
      onStoreChanged();
      flash(`removed ${macros.length} macros`);
    } finally {
      setBusy(null);
    }
  }

  function flash(text: string) {
    setNote(text);
    setTimeout(() => setNote(null), 2000);
  }

  // Preload on an empty start: runs once on mount, only when the toggle is
  // on and the store is genuinely empty, so it never stacks duplicates.
  useEffect(() => {
    if (!readPreload()) return;
    let cancelled = false;
    void store.list().then(async (existing) => {
      if (cancelled || existing.length > 0) return;
      for (const macro of buildDemoMacros()) await store.save(macro);
      if (!cancelled) onStoreChanged();
    });
    return () => {
      cancelled = true;
    };
    // Mount-only by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Disarm the clear key if the user walks away from it.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <div
      // relative+z: rack rows are positioned and would paint over this strip
      // (and show through a translucent tint) while scrolling beneath it.
      // The color-mix bakes the old bg-muted/60 look onto a solid ground.
      className="relative z-[1] border-t border-dashed border-border bg-[color:color-mix(in_srgb,var(--muted)_60%,var(--background))] text-11"
    >
      <button
        type="button"
        className="flex w-full cursor-pointer items-center justify-between px-3 py-1 text-muted-foreground transition-colors duration-150 hover:text-foreground"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="instrument">Dev settings</span>
        <span className="flex items-center gap-2">
          {/* The count doubles as the action receipt — one readout, no layout shift. */}
          <span className="mono whitespace-nowrap" role="status" aria-live="polite">
            {note ?? `${macroCount} stored`}
          </span>
          <ChevronDown
            className={`size-3 transition-transform duration-150 ease-[cubic-bezier(0.2,0,0,1)] ${
              open ? "" : "rotate-180"
            }`}
          />
        </span>
      </button>
      {open && (
        <div className="rack-drawer inline-enter flex flex-col gap-2 px-3 py-2">
          {/* Equal tracks so the armed label swap can't shift layout. */}
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="press key key-outline"
              aria-label="Load demo macros"
              disabled={busy !== null}
              onClick={() => void loadDemo()}
            >
              Load demo
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={`press key ${armed ? "key-armed" : "key-outline"}`}
              aria-label={armed ? "Confirm: clear all macros" : "Clear all macros"}
              disabled={busy !== null || macroCount === 0}
              onClick={() => void clearAll()}
            >
              {armed ? "Confirm clear" : "Clear all"}
            </Button>
          </div>
          <label className="flex cursor-pointer items-center justify-between gap-2">
            <span className="instrument">Preload demo when empty</span>
            <input
              type="checkbox"
              className="size-3.5"
              style={{ accentColor: "var(--primary)" }}
              checked={preload}
              onChange={(event) => {
                setPreload(event.target.checked);
                writePreload(event.target.checked);
              }}
            />
          </label>
          {/* Each nested section opens with the rack's dotted rule. */}
          <div className="flex flex-col gap-2 [&>*]:border-t [&>*]:border-dotted [&>*]:border-border [&>*]:pt-2">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
