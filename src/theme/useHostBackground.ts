import { useEffect, useState } from "react";

interface ThemeMessage {
  type?: string;
  themeName?: string;
  isLight?: boolean;
  tokens?: Record<string, string>;
}

/**
 * The one place Creator's pushed theme is APPLIED: the `.host-frame` gutter
 * around the panel wears the host's interface background so the plate sits
 * on whatever chrome Creator is actually showing. The panel itself still
 * wears its one committed skin (VINTAGE_TOKENS) and never flips.
 *
 * The message is the official ThemeProvider sync shape — the sandbox relay
 * (plugin/theme.ts) forwards `{ type: "change:theme", tokens, themeName }`
 * per the ui-library docs; the legacy `{ type: "theme", isLight }` shape is
 * still accepted for the harness. Resolution order: pushed background/base
 * token → themeName / isLight → null, which leaves the CSS fallback (dark)
 * in charge — standalone dev has no host to match.
 *
 * KEEP IN SYNC with the pre-React head script in index.html, which runs the
 * same resolution to paint the gutter before the bundle loads.
 */
const LIGHT_BG = "hsl(0 0% 100%)"; // theme.css :root --background
const DARK_BG = "hsl(198 16.7% 11.8%)"; // theme.css .dark --background

function resolveBackground(data: ThemeMessage): string | null {
  const pushed =
    data.tokens?.["--background"] ??
    data.tokens?.["background"] ??
    data.tokens?.["--base"] ??
    data.tokens?.["base"];
  if (typeof pushed === "string" && pushed.trim()) return pushed;
  if (typeof data.isLight === "boolean") return data.isLight ? LIGHT_BG : DARK_BG;
  if (typeof data.themeName === "string") {
    if (/light/i.test(data.themeName)) return LIGHT_BG;
    if (/dark/i.test(data.themeName)) return DARK_BG;
  }
  return null;
}

export function useHostBackground(): string | null {
  const [background, setBackground] = useState<string | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = (event.data?.pluginMessage ?? event.data) as ThemeMessage;
      if (!data || typeof data !== "object") return;
      const isTheme =
        data.type === "change:theme" ||
        data.type === "theme" ||
        typeof data.isLight === "boolean" ||
        (data.tokens && typeof data.tokens === "object");
      if (!isTheme) return;
      const resolved = resolveBackground(data);
      if (resolved) setBackground(resolved);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return background;
}
