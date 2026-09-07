/**
 * Interface-theme relay — the official ThemeProvider sync pattern from
 * docs.lottiefiles.com/en/creator-plugins/ui-library/components/theme-provider:
 * the sandbox reads `creator.ui.theme` ({ tokens, themeName }) and forwards
 * it — plus every `change:theme` event — to the iframe as
 * `{ type: "change:theme", tokens, themeName }`.
 *
 * BOTH surfaces are typed in creator-api-types 1.0.1 (`UIAPI.theme:
 * ThemeTokens`, and `change:theme` in the event union). Neither is live
 * verified yet — our event introspection (docs/runtime-api.md item 10) saw no
 * change:* events at all — so every touch stays feature-detected: a host that
 * predates the surface never sends the message and the UI keeps its dark
 * fallback. Absence is a normal outcome, not an error.
 *
 * `ThemeTokens` also carries `isLight` — the host's own answer to the only
 * question the UI asks of the theme (which way does the gutter go?). It is
 * relayed alongside the tokens so the UI never has to read "dark" out of a
 * theme NAME when the host already knows.
 */

interface HostTheme {
  tokens?: Record<string, string>;
  themeName?: string;
  isLight?: boolean;
}

function asHostTheme(value: unknown): HostTheme | null {
  if (!value || typeof value !== "object") return null;
  const { tokens, themeName, isLight } = value as HostTheme;
  const out: HostTheme = {};
  if (tokens && typeof tokens === "object") out.tokens = tokens;
  if (typeof themeName === "string") out.themeName = themeName;
  if (typeof isLight === "boolean") out.isLight = isLight;
  return out.tokens || out.themeName || out.isLight !== undefined ? out : null;
}

function post(theme: HostTheme): void {
  try {
    creator.ui.postMessage({
      type: "change:theme",
      tokens: theme.tokens,
      themeName: theme.themeName,
      isLight: theme.isLight,
    });
  } catch {
    // iframe not up yet — the hello-handshake resend covers the normal boot
  }
}

/** Read the host's current theme (if this host exposes one) and forward it. */
export function sendTheme(): void {
  try {
    const theme = asHostTheme(creator.ui.theme);
    if (theme) post(theme);
  } catch {
    // unreadable theme surface — absence is normal
  }
}

/** Subscribe to host theme changes, when the host has the event at all. */
export function watchTheme(): void {
  try {
    // Typed since 1.0.1, still feature-detected: a host that predates the
    // event bus has no `on` at all.
    if (typeof creator.on !== "function") return;
    creator.on("change:theme", (payload) => {
      const theme = asHostTheme(payload);
      if (theme) post(theme);
      else sendTheme();
    });
  } catch {
    // host without change:theme — see docs/runtime-api.md item 10
  }
}
