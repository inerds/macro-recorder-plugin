import { useEffect, useState } from "react";

export interface ThemeState {
  isDark: boolean;
  /** Creator-pushed CSS variable overrides, if any. */
  tokens: Record<string, string>;
  toggle: () => void;
}

interface ThemeMessage {
  type?: string;
  themeName?: string;
  isLight?: boolean;
  tokens?: Record<string, string>;
}

/**
 * Theme source of truth:
 * - Inside Creator, a theme pluginMessage (change:theme relay) drives dark
 *   mode and token overrides.
 * - Standalone (dev in a browser tab), falls back to prefers-color-scheme
 *   with a manual toggle (used by the DebugStrip).
 */
export function useTheme(): ThemeState {
  const [isDark, setIsDark] = useState<boolean>(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-color-scheme: dark)").matches,
  );
  const [tokens, setTokens] = useState<Record<string, string>>({});

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = (event.data?.pluginMessage ?? event.data) as ThemeMessage;
      if (!data || typeof data !== "object") return;
      const isTheme =
        data.type === "theme" ||
        typeof data.isLight === "boolean" ||
        (data.tokens && typeof data.tokens === "object");
      if (!isTheme) return;
      if (typeof data.isLight === "boolean") setIsDark(!data.isLight);
      if (data.tokens) setTokens(data.tokens);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  return { isDark, tokens, toggle: () => setIsDark((d) => !d) };
}
