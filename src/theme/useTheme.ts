import { useEffect, useState } from "react";

export interface ThemeState {
  /** What Creator says it is showing — observed, never applied. */
  isDark: boolean;
  /** Creator-pushed CSS variable overrides, if any — observed, never applied. */
  tokens: Record<string, string>;
}

interface ThemeMessage {
  type?: string;
  themeName?: string;
  isLight?: boolean;
  tokens?: Record<string, string>;
}

/**
 * The panel wears ONE committed skin (see `vintageTokens.ts`), so this hook no
 * longer drives anything: it keeps listening to Creator's theme relay purely
 * so the current host theme is observable (diagnostics, and a future
 * "match Creator" escape hatch). It does not toggle the `dark` class and does
 * not apply the pushed tokens — `ThemeProvider` gets VINTAGE_TOKENS instead.
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

  return { isDark, tokens };
}
