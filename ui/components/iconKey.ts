/**
 * The quiet icon key — squared-off outlined chrome shared by every small
 * icon-only control that sits on a row (play / play-options / overflow, and
 * the step lane's actions). Hand-rolled because the library Button is too
 * tall for a 24px row; defined once so hover/focus/disabled treatment and
 * the 7px radius can't drift between surfaces.
 *
 * 22px, not 24: three of these sit side by side on a 300px row with a 4px
 * gap, and at 24px the ~14px glyphs read as three separate objects 26px
 * apart while the macro name truncated (user report, 2026-09-04). The hit
 * area stays comfortably above the glyph; the cluster now reads as one.
 */
export const ICON_KEY_CLASS =
  "press flex size-[22px] shrink-0 cursor-pointer items-center justify-center rounded-[7px] text-muted-foreground transition-[background-color,color,scale,box-shadow] duration-150 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none hover:bg-secondary hover:text-foreground hover:shadow-[inset_0_0_0_1px_rgba(42,38,35,0.18)] active:scale-[0.96] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";
