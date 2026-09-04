# Macro Recorder v0.5.0

**Turn your repetitive edits into one-click macros — record, then apply to any layer.**

Second shared build. Unzip it, add the folder as a plugin in Lottie Creator,
and you're recording. Existing macros carry over unchanged.

## Highlights

- **A new deck.** The reels are redrawn after a studio reel-to-reel: spun
  metal, three spokes, tape laced around guide rollers, and a nameplate that
  shows the version. Play and record turn the reels with the tape; rewind
  turns them back.
- **Spin the reels.** When the deck is at rest, drag a reel and let go. Both
  reels coast, the tape highlight runs with them, and the counter runs like a
  tape counter until they settle. While a recording or a playback runs, the
  reels belong to the deck.
- **Clearer steps.** Each step reads as its property and its new value, for
  example `position.x → 160`. The previous value is in the tooltip, so a
  narrow row never cuts the property name.
- **Tidier panel.** One chevron per macro row, the row number stays while you
  rename, Import is an icon on the Saved macros header, and the Simplify
  count is a plain readout. In a narrow panel the macro name gets the row and
  play options move to the ⋮ menu.
- **One list, one look.** The review step list sits in the same well as the
  live feed, and the sentence above it names what the macro applies to,
  including the recorded layer.

## Fixed in this build

- The deck's edges, corners and light now hold at the 300px panel size:
  one hairline per edge, corners that nest, and a soft centre light instead
  of a diagonal band between the reels.
- Dragging across the panel no longer paints a text selection. Fields keep
  it.
- The disabled Import key is a flat cream key, not a faded red one.

## Known limitations (host plugin API)

Some things the host doesn't yet expose to plugins. These record fine, but
they can't fully replay — the panel notes it when they don't:

- Nesting layers into a new scene: replay creates the scene layer, but can't
  move layers into it.
- Color tokens: replay applies the resolved color, not the token binding.
- Per-fill opacity, rectangle corner roundness, and timeline keyframe
  selection ("Add selected").

These light up automatically as the host's API grows.
