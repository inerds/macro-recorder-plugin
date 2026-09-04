# Design system

The panel wears one committed look: a vintage reel-to-reel deck above a rack of
saved macros, on cream paper. This document is the rule set behind it — the
token delivery mechanism, the control hierarchy, the deck's light and motion
layers, and the rack's readout grammar. Every rule here is load-bearing: each
one records a specific failure that the current shape prevents.

All CSS lives in `ui/styles/index.css`, with the hero's rules in
`ui/styles/deck.css` (imported from `index.css`, so the build still inlines
one stylesheet). The architecture behind the panel is in
[`architecture.md`](architecture.md).

## The skin — one committed look, and how it wins

`ui/theme/vintageTokens.ts` exports `VINTAGE_TOKENS`, passed to the library's
`ThemeProvider` in `app.tsx`. That provider writes every `--*` key of its
`tokens` prop as an **inline custom property on `<html>`**, which outranks both
`:root` and `.dark` in the library's `theme.css`. Consequences, all
load-bearing:

- `VINTAGE_TOKENS` **must stay a module-level constant**. The provider removes
  and re-applies the whole set whenever the object identity changes; building
  it in a render would repaint the panel on every render.
- It must override *every* key `theme.css` defines (`--chart-*` and
  `--sidebar-*` included) or an unset one falls back to library teal.
- Creator's interface theme touches exactly ONE pixel surface: the
  `.host-frame` gutter. The relay is the official ThemeProvider sync
  pattern (ui-library docs): `sandbox/theme.ts` reads `creator.ui.theme` and
  subscribes to `change:theme` (both feature-detected — absent from typings
  AND from our live introspection, runtime-api.md item 10), forwarding
  `{ type: "change:theme", tokens, themeName }` on boot, on `hello`, and on
  every change. Three consumers, resolution chain kept identical in all:
  the index.html head script (pre-React paint of `--host-frame-bg` on
  `<html>`), `useHostBackground()` (inline on the frame div), and the CSS
  fallback (theme.css's dark `hsl(198 16.7% 11.8)`, hardcoded because every
  live token is repainted cream). Order: pushed `--background`/`background`/
  `--base`/`base` token → `isLight`/`themeName` → fallback. The panel itself
  never flips: no `dark` class toggle, no transition freeze — and no
  transition on the frame either, a theme flip should snap. ThemeProvider
  is NOT theme support — it is the token delivery mechanism above; removing
  it reverts the panel to library teal.
- `.host-frame` is an 8px gutter around `.panel-root`, which becomes a plate
  on it: 10px radius, `overflow: clip`, one seat shadow. The gutter costs
  16px of height, so panel-height math (collapse threshold, README's
  develop-at size) is against the panel, not the window.
- All CSS lives in `ui/styles/index.css`; the build inlines one file. No
  network assets, system font stacks only (`--font-sans`, `--font-mono` are
  overridden too).
- **Three radius tiers, by what the surface is** (2026-09-04): raised paper
  10px (the panel plate, cards, notices, dialogs, menus, toasts); keys 7px
  (every key and icon key); wells 4px (the rack, the step strip, text
  fields, swatches). The deck keeps its own smaller set (window 6, keys 4,
  LCD 3) because it is a dark moulded object, not paper. The library derives
  its radii from `--radius`, so `index.css` pins the ones that land off-tier
  (menu popup, text fields, the number field's wrapper). Menu items are 6px:
  concentric inside the 10px popup with its 4px padding. The step strip was
  8px — a fourth tier — and the rack 4; a well inside a 4px well with 4px
  padding, or inside a 10px card with a 6px inset, wants 4.
- Small red text uses `--ink-red-text` (#B5301F, 5.2:1), never `--primary`
  (#C8382B) — that one is for fills. Red is never a readout: the Simplify
  count (`5 → 3`) is muted ink at weight 500, because a red number beside a
  key reads as a warning (2026-09-03 audit). The red section titles
  (`REVIEW & SAVE`, `LIVE STEPS`) are a deliberate mode cue and stay.
- A dead red key on the cream surface is `.key.key-red:disabled`: flat
  cream, muted legend, hairline edge, no travel — the deck's "a dead key is a
  dark key" rule translated to paper. The library's `disabled:opacity-50`
  made it a pink key that users kept pressing.
- The list header's Import is icon-only (`aria-label` + `title` carry the
  name): as a bold word it outranked `SAVED MACROS` beside it. Success signals (the completion flash)
  use `--lamp-green` (#5C9457); red on this panel always means action or
  failure, never "done". Muted body copy is `--muted-foreground`
  (#6B635B); instrument labels are `--label-fg` (#5E564F).
- `.key`, `.key-quiet`, `.card`, `.instrument`, `.mono`, `.lamp` are the
  skin's vocabulary. `.key` is written as `.key.key` on purpose: the
  library's `Button` merges its `size="sm"` utilities
  (`h-6 px-3 rounded font-normal`) onto the same element via
  `tailwind-merge`, and a single class would lose on source order alone.
  `.key-quiet.key-quiet` is doubled for the same reason.
- **Controls rank by how much chrome they wear: primary = red key
  (`.key.key-red`), secondary = cream key (`.key.key-outline`), tertiary =
  quiet (`.key-quiet`) — instrument type on nothing at all, no ink edge and
  no drop.** At most one red key per surface. A standalone utility (Import
  in the list header, Simplify in a drawer header) is tertiary: it must not
  outrank the decision beside it. Quiet controls take their feedback from
  `.press`'s scale, never key travel — travel needs a shadow to travel into,
  and a quiet control has none.
- **`--ring` is ink (#2A2623), not red.** Focus is "you are here", never an
  action, and red on this panel means "this does something". It used to be
  `#C8382B`, which made every `focus-visible:ring-ring` — the macro row's
  disclosure most visibly — look like a designed red state marker.

## The deck

`ui/components/deck/` — rendered once in `app.tsx`, above the mode switch, on
**every** screen. It owns the Record/Stop transport, the step counter, the
recording clock, the status lamp, and the state word.

- `deckState.ts` is pure and table-tested: `deriveDeckState(input, flags, now)`
  over `{mode, playbackError}` plus two timestamps. `rewind` and `done` are
  deliberately **not** reducer state — they are decorations with a stopwatch,
  and the reducer has no business knowing about them. `useDeckState` owns the
  flags in a ref and is keyed on the single boolean "is playing", so React's
  double-invoked mount effects can't swallow an edge.
- **The reels never carry information on their own.** Every state they show is
  also the lamp's colour and the label's word, which is what makes
  `@media (prefers-reduced-motion: reduce) { .reel { animation: none } }` an
  acceptable fallback rather than a loss. Keep that invariant when adding
  states.
- **The hero is ONE chassis, not a card holding a plate.** It has no title
  block (the panel's name is the sr-only `<h1>`) and no cream frame:
  `.deck-chassis` *is* the faceplate, with `.deck-window` bezelled into it and
  the transport row — lamp + state word, RECORD, STOP, LCD counter — sitting
  directly on it. Controls on a dark ground need the `.key-plate` /
  `.key-plate-red` variant (light keycap, dark bezel) rather than `.key`,
  which is cream-surface only. The recording clock shares the LCD pane with
  the counter (see `.deck-clock` below); the state word is the reduced-motion
  state channel so it is the last thing allowed to truncate. Two nested
  surfaces cost two sets of padding — that collapse is what took the hero
  from 203px to 156px on a 300x520 panel.
- **The stage is a studio deck's faceplate, drawn to a reference photo
  (2026-09-03).** `ReelDeck.tsx` builds it from constants: two R=44 reels
  centred at y=47, each a spun-silver flange (radial gradient + alternating
  1.5-unit rings) with three parallel-sided spokes, and the cut-outs between
  them generated by `cutoutPath` — an annular sector whose corners are
  filleted by placing the fillet centres on the sector shrunk by `CORNER`,
  so every arc meets its edge tangentially. The cut-outs are a mask on the
  flange and are ALSO stroked over it (dark line, plus a 0.5-unit-offset
  light line) so the edge reads as machined thickness. The bolted hub, the
  axle cap and the wound pack all sit inside the rotating `.reel` group;
  the `#reel-light` sheen circle sits OUTSIDE it, because a reflection stays
  with the lamp while the reel turns. The tape is ONE threaded path, the
  way a deck is laced (user correction, 2026-09-03 — two separate runs made
  the supply reel look like it fed tape out both ways): off the supply
  pack's outer-left side, around the bottom-left guide roller, along the
  bottom behind the nameplate, around the bottom-right roller, up onto the
  take-up pack's outer-right side. Pack-to-roller runs are computed
  external tangents (`tangent()`), and the wraps sit one unit outside the
  roller rim to stay visible. Tape is drawn FIRST so it passes behind reels,
  rollers and plate. **Forward is counter-clockwise**: the tape runs under
  the reels, so forward travel drags each bottom edge rightward, and
  deck.css maps recording/playing/done to `reel-ccw` and rewind to
  `reel-cw`; the shimmer's dash offset runs the same left-to-right. Change
  the lacing and re-derive both. A SECOND short run (`RETURN_PATH`) goes
  from the take-up pack's bottom over the nameplate's shoulders to the
  supply pack's bottom, authored right-to-left so its shimmer travels
  opposite to the outer tape (user decision, 2026-09-03: the two runs read
  as one loop going round, not two lines sliding the same way). Rollers
  stay at every size (a wrap around
  nothing reads as a kink); only the nameplate (name + `__APP_VERSION__`)
  and the bottom screws are `.deck-furniture` that a short panel drops.
- **One light source: high, slightly left.** Every highlight in the deck sits
  on a top edge, every occlusion on a bottom edge, and the one specular —
  `.deck-window::after`'s sheen, a soft radial from the window's top-left
  corner — comes from the same lamp. That consistency, not any single
  gradient, is what makes the chassis, glass, caps, lamp, and LCD read as
  one moulded object. Adding a bottom highlight or a sweep from another
  side quietly undoes the whole effect, so match the lamp before adding a
  surface. NO diagonal bands: the old 118deg glass stripe and the chassis'
  100deg raking highlight had percentage stops, which fade nicely on a wide
  window and collapse into a 40px "ray of light" between the reels on a
  274px one (user reports, 2026-09-03/04). A corner radial fades the same
  at every width. The light itself is `.deck-stage`'s background: a BROAD
  centred ellipse (`72% 105% at 50% 46%`, #38332F → #0D0C0B) pooling
  behind the reels — the user's ask was "a soft faded light in the centre",
  and a flat plate read as dead. Keep it an ellipse in stage percentages.
- **The reels can be spun by hand (user ask, 2026-09-03: "like a DJ").**
  `useReelSpin` (deck/) owns the gesture; `spinPhysics.ts` is the pure,
  table-tested part. Decisions: BOTH reels turn together (a drag anywhere on
  the stage maps to the pointer's angle around the nearest reel centre, so
  dragging the left reel's bottom edge rightward turns both forward =
  negative `rotate`); release COASTS with `v *= exp(-dt/650ms)` and stops
  under 0.02 deg/ms (no coast under reduced motion); allowed ONLY while
  `deckState` is `idle` or `paused` — every other state animates `rotate`
  from CSS and two owners of one property is a fight. The hook writes
  inline `rotate` on both `.reel`s and `stroke-dashoffset` on both
  `.tape-shimmer`s per frame (no React state per frame), toggles
  `data-spinning` on the stage (CSS lights the shimmer), and on any
  enabled→false transition strips the inline styles so the CSS animation
  resumes from 0. The shimmer offset is `angle * 18/40` — SAME sign as the
  angle, because forward is a negative rotate AND a decreasing offset. The
  LCD shows a 4-digit tape counter (`tapeCounter`, counts UP for forward)
  while spinning; the real count stays in an sr-only span and the stage
  stays `aria-hidden` — it is an easter egg, not a control.
- **The edges are one hairline each at panel size.** A 5px gutter is all
  that separates the chassis edge from the window bezel, so every extra
  line there stacks into a ridge: the chassis draws ONE lit top hairline
  (`::after` chamfers only the right and bottom), the chassis gradient is
  nearly flat (a lighter top band read as a second frame), and the stage
  recess is shallow (`inset 0 2px 5px`). The window radius is 6px, not 8:
  `.panel-root` carves a 10px corner around the square chassis, and a
  window 5px in from that edge only nests at ~5-6px — 8 left an uneven
  sliver in every corner (Creator screenshot, 2026-09-03).
- **The window has glass over it.** `.deck-window::after` is a specular band
  plus a corner vignette, `pointer-events: none`, at `z-index: 2`. Its alpha
  is capped at .065 on purpose: the reels' legibility cost real work (see the
  collapse-threshold note) and a prettier sheen is not worth dimming them.
  Verify reel width and deg/250ms after touching it.
- **Never give `#root` a z-index.** `position: relative` alone lifts it above
  the fixed paper-grain overlay. A z-index there creates a stacking context
  that buries every portalled popover: Base UI renders menus into a portal
  div after `#root` whose positioner is `z-auto`, and the menu's own `z-50`
  does nothing because that element is `position: static`. The symptom is a
  dropdown that opens, looks fine, and ignores clicks — because the panel is
  painted on top of it and `elementFromPoint` returns the row underneath. A
  scripted `.click()` still "works" (it skips hit-testing), so this bug hides
  from naive automation; probe it with `document.elementFromPoint`.
- **Dialogs must not slide.** The component library centres `DialogContent`
  by layout (resting `transform: none`) but still ships shadcn's
  translate-based entrance (`slide-in-from-left-1/2`,
  `slide-in-from-top-[48%]`), which assumes the dialog is centred BY that
  transform. Mismatched, it flies in diagonally from ~138px left and ~121px
  up — outside the panel. `index.css` zeroes `--tw-enter/exit-translate-*`
  for `[role="dialog"]`, leaving the intended zoom + fade.
- **The transport row is `1fr auto 1fr`.** Status legend in the first track,
  key pair in the middle, recording clock in the third. Equal outer tracks
  are what keep the keys centred on the CHASSIS rather than on the space the
  readouts left over. It only fits because the `REC` legend shrank the pair
  to ~122px, leaving ~84px per gutter against the ~73px the legend needs; at
  <=286px the legend gives up tracking and size (never letters — it is the
  reduced-motion state channel) to stay clear of the keys.
- `.deck-keys` is an auto-flow column grid with `grid-auto-columns: 1fr`, so
  RECORD and STOP are exactly equal width whatever their labels say. The
  clock and the step counter share ONE recessed pane (`.lcd`, with
  `.deck-clock` as a divided segment inside it) in the row's trailing track —
  the way a deck's counter window carries time and count together. Keep them
  in one pane: two panes side by side read as two instruments, and the
  trailing gutter is only ~84px wide at 300px.
- The faceplate's lower legend is the package version, which `vite.config.ts`
  injects as `__APP_VERSION__` (declared in `ui/vite-env.d.ts`), so it can
  never drift from what shipped.
- **The Record key's visible legend is `REC`, its accessible name is
  `Record`** (aria-label). Consequence for the headless driver: `walk.mjs`
  finds the key by aria-label, but its FIRST assertion matches `/record/i`
  against *textContent*, which now only the EmptyState's Record button
  satisfies. That check therefore passes only while the macro list is empty —
  true for every driver run, since it starts on a fresh profile. If that
  assertion ever starts failing, the skin is not broken; the check is
  asserting on visible text the skin deliberately abbreviated.
- **The chassis is full-bleed and square-cornered.** It renders as a direct
  child of `.panel-root` with no padded wrapper, so it meets the panel edges
  the way a faceplate meets its case; its corners are square; the rounding
  happens one level up, where `.panel-root`'s `overflow: clip` carves the
  plate's 10px radius out of it against the dark `.host-frame` gutter. `.deck-stage`'s
  height is then tuned against the BLED window width so the drawing is
  width-limited rather than height-limited: window = panel - 2x chassis
  padding, and `height = 110 * (window / 272)` (117px at a 300px panel). Get
  this wrong and the reels quietly letterbox inside the glass instead of
  filling it — widening the chassis on its own buys nothing.
- Deck CSS lives in **`ui/styles/deck.css`**, imported from `index.css`
  (Vite still inlines one stylesheet). Anything reused outside the hero —
  `.key`, `.card`, `.instrument`, `.mono` — stays in `index.css`.
- Rotation is the CSS `rotate` property on the reel groups with
  `transform-box: fill-box; transform-origin: center` — so probe it with
  `getComputedStyle(el).rotate`, NOT `.transform`, which stays `none`. State
  travels as `data-deck` on `.deck-stage`; the stage `div` carries the dark
  plate and the SVG only the mechanism.
- **The collapse threshold is a real breakpoint, not a round number.**
  `@container panel (max-height: 352px)` (needs `container: panel / size` on
  `.panel-root`) is set where the *list* stops working — hero ~156px, list
  needs ~150px for its header, a row, and a peek. Re-derive it whenever the
  hero's height changes. It was 520px once,
  which is exactly the panel height README tells you to develop at, so the
  hero rendered collapsed at every realistic size and the reels were sliced
  through the middle. When it does collapse the stage scales the drawing DOWN
  to 72px (`meet`, letterboxed onto the plate colour) rather than cropping
  it: a half reel reads as texture and gives the rotation nothing to register
  against.
- Three motion layers, per the deck's own rule that no single one is
  load-bearing: **primary** = reel rotation (linear — a reel is a spinner, the
  one thing exempt from "never linear"); **secondary** = `.tape-shimmer`, a
  dashed stroke travelling the tape path, which is the only element that can
  express *direction* (three-fold symmetric reels cannot); **ambient** = the
  `::after` warm glow while recording. `REWIND_MS`/`DONE_MS` in `deckState.ts`
  must stay equal to the `[data-deck]` animation durations in `deck.css` or
  the reels stop mid-turn.
- The recording screen's bottom CTA is **Stop** (red key), with Discard as
  the outline secondary beside it — the same grammar as the review bar it
  hands off to (user decision, 2026-08-24; this retired the earlier
  "exactly one Stop" rule). Both Stops perform the same action; drivers that
  match Stop by name must scope to the deck's `data-testid="stop-button"`
  or the bar's `stop-recording-button`.

- Pseudo-element budget on the hero is fully spent: `.deck-chassis::before`
  (scanline grain + raking highlight) / `::after` (chamfer bevel);
  `.deck-window::after` (the one glass layer — never add a second sheen on
  `.deck-stage`, the reels dim under two); `.deck-stage::after` (recording
  glow, z 0, under the SVG at z 1); `.key-plate::after` (keycap side wall);
  `.lcd::after` (phosphor scanlines). A new layer needs a new element.

## The rack — the macro list as one seated panel

`.rack` / `.rack-row` / `.rack-drawer` in `index.css`. The list is a single
shallow well holding rows that butt together, not N cards with N borders and
N drop shadows: fewer edges reads quieter AND matches the deck's object
language. Two rules keep it coherent:

- **It is a console readout, not a list of cards.** Rows divide with a dotted
  rule and each macro's name is followed by a right-aligned two-digit step
  count, the way an instrument list does; names are `--font-mono`
  and `.rack-num` is lit (`--primary` plus a glow, not the small-text red —
  the glow is what carries it at that weight). The monospace grid is what
  makes it read as equipment; setting the names back in the sans face is what
  would quietly undo it.
- **Closed rows shed furniture below a 262px PANEL, never at Creator's
  300px window.** `@container panel (max-width: 262px)` hides `.rack-lead`,
  `.rack-count` and the play-options key on closed rows; the deck's 286px
  breakpoint is the wrong one for this — the panel sits inside an 8px gutter
  and measures 284px at a 300px window, so 286 is always on there (that slip
  shipped for one capture). The overflow menu picks up "Play options…" at
  the same width via `useNarrowPanel()` (a ResizeObserver on `.panel-root`,
  `NARROW_PANEL_PX` = 262, kept equal to the CSS) because the menu is
  portalled out of the container query's reach. Open cards keep everything.
- **Step rows show PROPERTY → RESULT; the before value is sr-only.**
  `labelPartsOf` (engine/labels.ts) splits a label into path/before/after
  only when re-joining reproduces the stored label byte-for-byte (imported
  v1 macros may carry labels their payload no longer emits); otherwise the
  row falls back to splitting at the last arrow. The result is capped at
  50% of the line so a long value never pushes the property to "Trans…".
  A three-piece row with the before visible was tried and rejected: at
  250px a before squeezed to "(…" is noise where the property should be.
- **Counts are bare mono readouts everywhere** — the list header's
  `10 · 42`, each row's `05`, and the recording header's `02 steps`. The
  recording count was the one bordered pill on the panel; it is not.
- **The whole closed row is the hover surface, and there is no leader.**
  `.rack-row:not(.rack-row-open):hover` lifts the row to the card colour
  with a 0.2 hairline, darkens the chevron, and lights the name the way the
  number is lit at rest — weight 600 (mono bold keeps the advance, so nothing
  reflows), a light edge under the strokes and a faint ink glow, the
  letterpress-on-paper look (user ask, 2026-09-04: "more hardware-ish"); the
  disclosure button carries no hover of its own (a tint on just the name read as a loose
  highlight floating in the row), and a first pass one tone above the card
  was too strong for the paper. The dotted leader between the name and the
  count is gone (user decision, 2026-09-04): with dotted row separators it
  made two dotted lines per row and the list read as busy. `.rack-lead`
  stays as the flex spacer that right-aligns the count; the pairing is
  carried by proximity.
- **One 4px gap on the row, and the keys are 22px.** The lid is
  `[number] [chevron name …leader count] [play] [options] [⋯]` with a single
  `gap-1` between every element and 6px side padding; the chevron carries no
  extra margin. The quiet icon keys (`ICON_KEY_CLASS`) are 22px, not 24: at
  24px with 6px gaps the ~14px glyphs sat 26px apart and read as three
  objects while the name truncated to "Bounce & se…" at 300px (user report,
  2026-09-04). A hairline key group and a two-key row were rendered and
  rejected — the group adds an edge per row, the two-key row hides the
  options behind a tap.
- **The two-digit count is `aria-hidden`, with the words beside it.** "04"
  spoken aloud is meaningless, and `walk.mjs` asserts the row's text contains
  "N steps" — so the readout is decorative and an `sr-only` "4 steps" carries
  the meaning. Keep both.
- **The open macro POPS OUT as a card** (user concept, 2026-08-24):
  `.rack-row-open` lifts out of the rack with 6px margins and the paper-card
  treatment. Its NEIGHBOURS keep their dotted rules (`:has(+ .rack-row-open)`
  gives the row above a bottom rule, since the card cannot carry a top one
  across its rounded corners): with the rules removed the rows above and
  below lost their edges and the card read as nested between them (user
  report, 2026-09-04). Its lid drops
  the play/options/overflow cluster and shows ONE disclosure cue — the
  leading chevron beside the number, rotated (user decision, 2026-09-03: the
  earlier trailing ChevronUp made two arrows point at each other) — except
  while THAT macro plays, when the stop key stays so it never unmounts under
  focus. While playback is PAUSED on an error the lid's stop square goes
  quiet grey: the warn-box below owns the red STOP. Card body:
  `StepListHeader` (the header is `Steps (N)` on every surface; the layer
  name is sr-only there and, on the review screen, spoken in the hint
  sentence — inline it truncated to "on Rectan…") + the
  `.step-strip` + a footer that is the card's control row: a PLAY key leads
  it (user ask, 2026-08-25 — the open card carries every lid ability), the
  ×N repeat readout (label sr-only — no width for it), and the play-options
  + overflow triggers, which live on the lid when closed and in the footer
  when open (never both). The footer key mirrors the lid's mount rule:
  while THAT macro plays it stays mounted and swaps to Stop (two stops on
  the open card, same grammar as the recording screen's pair). Duration in
  FRAMES (via `engine/steps.ts#keyframeSpan` — the UI never learns fps, a
  timecode would be a lie) rides the play key's `title` and an sr-only
  span; it lost its visible seat to the key.
- **Steps are ONE `.step-strip`** (one `bg-card` surface, 8px radius,
  `overflow: clip`, dotted rules between rows). Rows keep `bg-card`
  individually because `StepRow`'s hover action lane paints `bg-inherit` and
  needs a solid ground. `RecordingView`'s feed AND the review screen seat
  the strip in a `rack rack-drawer` well (one list, one dressing, 2026-09-03
  audit); the pop-out card's interior is uniform card.
  The drawer's playback-mode hint is a `quietHint` (tooltip + sr-only);
  visible `hints` remain only on the review screen.

