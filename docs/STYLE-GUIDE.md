# Documentation style guide

All documentation in this project follows two standards:

- **ASD-STE100 (Simplified Technical English)** for sentence construction
  and vocabulary discipline.
- **Google developer documentation style guide** for voice, formatting,
  and mechanics.

When the two disagree, Google style wins on formatting and STE wins on
sentence construction. This guide is the short, project-specific merge.
Apply it to every Markdown document. Code comments and UI copy have their
own rules and are out of scope.

## Sentence construction (STE)

- Use the active voice. Write "The recorder captures the change", not
  "The change is captured".
- Use the present tense for behavior. Use the past tense only for history
  (changelogs, logs, trace evidence).
- Write one instruction per sentence.
- Keep instructions to 20 words or fewer. Keep descriptive sentences to
  25 words or fewer.
- Start a warning or a precondition before the instruction it protects.
- Use articles ("the", "a") — do not drop them for brevity.
- Give each word one meaning, and use one word for each meaning. See the
  terminology table.
- Prefer simple verbs: use, make, show, start, stop, apply, record. Avoid
  phrasal verbs when a simple verb exists ("start", not "kick off").
- Avoid noun clusters longer than three words. Break them with "of" or
  "for".

## Voice and mechanics (Google style)

- Address the reader as "you". Reserve "we" for the project's decisions in
  internal docs.
- Do not write "please", "simply", "just", "easy", or "note that".
- Use sentence case for all headings.
- Use the Oxford comma.
- Use numbered lists for sequences, and bulleted lists for sets.
- Introduce every list and table with a sentence that ends in a colon or a
  period.
- Format file names, paths, commands, flags, and identifiers as `code`.
- Write link text that names the target ("see `LIMITATIONS.md`"), never
  "click here".
- Spell out a number that starts a sentence; otherwise use numerals.

## Terminology

Use these words, and only these words, for these meanings:

| Term | Meaning | Do not use |
|---|---|---|
| macro | A saved, replayable recording | script, action, preset |
| step | One recorded operation inside a macro | action, event, entry |
| record | Capture edits into steps | capture (except keyframe capture) |
| capture | Pull existing keyframes or style into a recording | — |
| replay, playback | Apply a macro's steps | run, execute, perform |
| target | The layer a step applies to on replay | destination, subject |
| host | The Lottie Creator application | Creator app, platform (alone) |
| sandbox | The QuickJS plugin runtime | VM, engine (alone) |
| panel | The plugin's UI | app, window |
| note | A reported non-apply or adaptation | warning, message |
| skip | A deliberate, noted non-apply | ignore, drop |
| trace | A recorded diagnostic bundle in `traces/` | log, dump |

## Structure

- State what a document is for in its first paragraph.
- Put the most important information first in each section.
- In tables, keep cells to one sentence or a fragment. Move reasoning to
  body text.
- Keep evidence with its claim: a limitation names its trace, a fix names
  its cause.

## What this guide does not change

- Technical facts, file paths, identifiers, trace names, and numbers are
  content, not style. A style edit must never change them.
- Marketing copy that the project owner approved (taglines) stays
  verbatim.
- `CLAUDE.md` keeps its reasoning ("the why") — style edits tighten its
  sentences but must not remove rationale.
