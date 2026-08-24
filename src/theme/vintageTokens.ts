/**
 * The committed skin.
 *
 * `ThemeProvider` writes every key of its `tokens` prop as an inline custom
 * property on `<html>`, which beats both `:root` and `.dark` from the
 * component library's `theme.css`. That is the whole mechanism behind this
 * file: overriding every key the library defines means nothing can fall back
 * to its teal-on-white default, in Creator's light theme or its dark one.
 *
 * MUST stay a module-level constant. ThemeProvider re-applies (and first
 * removes) the whole set whenever the object identity changes, so building it
 * inside a component would repaint the panel on every render.
 */
export const VINTAGE_TOKENS: Record<string, string> = {
  // Surfaces — warm cream paper, white-ish cards.
  "--background": "#EFEBE4",
  "--card": "#F7F4EE",
  "--popover": "#F7F4EE",
  "--sidebar": "#EFEBE4",

  // Ink.
  "--foreground": "#2A2623",
  "--card-foreground": "#2A2623",
  "--popover-foreground": "#2A2623",
  "--accent-foreground": "#2A2623",
  "--secondary-foreground": "#2A2623",
  "--sidebar-foreground": "#2A2623",
  "--sidebar-accent-foreground": "#2A2623",

  // Red is the only action colour. #B5301F is its small-text twin (see
  // --ink-red-text); this one is for fills, where 3:1 is the bar.
  "--primary": "#C8382B",
  "--primary-hover": "#AD2E22",
  "--primary-foreground": "#FFFDF9",
  "--destructive": "#C8382B",
  "--destructive-hover": "#AD2E22",
  "--destructive-foreground": "#FFFDF9",
  "--sidebar-primary": "#C8382B",
  "--sidebar-primary-foreground": "#FFFDF9",

  // Quiet surfaces.
  "--secondary": "#E4DED4",
  "--secondary-hover": "#DAD3C7",
  "--muted": "#E8E3DA",
  "--accent": "#F1ECE3",
  "--sidebar-accent": "#F1ECE3",

  // 4.96:1 on the cream background — the floor for 11px body text.
  "--muted-foreground": "#6B635B",

  "--border": "rgba(42, 38, 35, 0.24)",
  "--input": "rgba(42, 38, 35, 0.24)",
  "--sidebar-border": "rgba(42, 38, 35, 0.24)",
  // Focus is ink, not red: a focus ring is a "you are here", never an action.
  // Red on this panel means "this does something" (REC, Save, Delete), so a
  // red ring on a merely-focused row reads as a state the row does not have.
  "--ring": "#2A2623",
  "--sidebar-ring": "#2A2623",

  // 12 / 10 / 8px once the library's calc() chain is applied.
  "--radius": "0.75rem",

  // Nothing in this panel charts anything, but an unset --chart-* would show
  // up as library teal the moment some component reached for one.
  "--chart-1": "#C8382B",
  "--chart-2": "#8A7A63",
  "--chart-3": "#D9A441",
  "--chart-4": "#5E564F",
  "--chart-5": "#2A2623",

  // System stacks only — the panel loads no fonts over the network.
  "--font-sans":
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  "--font-mono": 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',

  // Skin-only variables. They ride along in the same object so there is one
  // source of truth for the look.
  "--ink": "#2A2623",
  /** 5.2:1 on cream — small red text NEVER uses --primary. */
  "--ink-red-text": "#B5301F",
  "--lamp-amber": "#D9A441",
  "--deck": "#1C1A18",
  "--deck-edge": "#3A3632",
  /** Instrument labels: 4.4:1 at 10px/600, which is over the large-text bar. */
  "--label-fg": "#5E564F",
};
