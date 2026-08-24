/**
 * Interface-theme relay — the official ThemeProvider sync pattern from
 * docs.lottiefiles.com/en/creator-plugins/ui-library/components/theme-provider:
 * the sandbox reads `creator.ui.theme` ({ tokens, themeName }) and forwards
 * it — plus every `change:theme` event — to the iframe as
 * `{ type: "change:theme", tokens, themeName }`.
 *
 * BOTH surfaces are absent from the published typings, and our live event
 * introspection (RUNTIME-API.md item 10) saw no change:* events at all, so
 * every touch is feature-detected: a host without them never sends the
 * message and the UI keeps its dark fallback. Absence is a normal outcome.
 */

interface HostTheme {
  tokens?: Record<string, string>;
  themeName?: string;
}

function asHostTheme(value: unknown): HostTheme | null {
  if (!value || typeof value !== "object") return null;
  const { tokens, themeName } = value as HostTheme;
  const out: HostTheme = {};
  if (tokens && typeof tokens === "object") out.tokens = tokens;
  if (typeof themeName === "string") out.themeName = themeName;
  return out.tokens || out.themeName ? out : null;
}

function post(theme: HostTheme): void {
  try {
    creator.ui.postMessage({
      type: "change:theme",
      tokens: theme.tokens,
      themeName: theme.themeName,
    });
  } catch {
    // iframe not up yet — the hello-handshake resend covers the normal boot
  }
}

/** Read the host's current theme (if this host exposes one) and forward it. */
export function sendTheme(): void {
  try {
    const ui = creator.ui as unknown as { theme?: unknown };
    const theme = asHostTheme(ui.theme);
    if (theme) post(theme);
  } catch {
    // unreadable theme surface — absence is normal
  }
}

/** Subscribe to host theme changes, when the host has the event at all. */
export function watchTheme(): void {
  try {
    const on = (creator as unknown as { on?: unknown }).on;
    if (typeof on !== "function") return;
    (on as (event: string, cb: (payload: unknown) => void) => void).call(
      creator,
      "change:theme",
      (payload: unknown) => {
        const theme = asHostTheme(payload);
        if (theme) post(theme);
        else sendTheme();
      },
    );
  } catch {
    // host without change:theme — see RUNTIME-API.md item 10
  }
}
