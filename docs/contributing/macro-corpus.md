# The macro corpus

A macro outlives the code that recorded it. Creator keeps it in
`clientStorage`, and a user keeps the JSON they exported. Every shape this
plugin has ever saved is therefore a shape it must still read, label, edit,
simplify, and replay.

`engine/testing/macros/*.json` is that history: one fixture per era of the
saved shape, oldest first. Two suites run over the whole set on every
`pnpm test`:

- `engine/corpus.test.ts` — validation, import, labels, the review sheet's
  editor, Simplify, and parameter pinning.
- `sandbox/corpus.replay.test.ts` — playback through the real orchestrator
  against the fake scene in `engine/testing/fakeScene.ts`.

The split follows the demo macros: playback needs the `creator` global, which
only `tsconfig.sandbox.json` knows about.

## The rule

When the saved shape changes, ADD a fixture for the new shape. Never edit an
old one, and never delete one. An old fixture is evidence of what a user's
storage holds, and editing it deletes the only test that a real saved macro
still works.

This is why the panel went blank on 2026-09-07: the formula build read the
first cut's `apply` strings as terms, `editableValueOf` threw inside a row
render, and React unmounted the tree. The corpus makes that a failing test.

## Add a fixture

1. Name the file `NN-<slug>.json`, one higher than the newest.
2. Give it a `_corpus` block:

   ```json
   {
     "_corpus": {
       "era": "<slug>",
       "introduced": "<commit or tag> (<date>), first shipped in <tag>",
       "note": "What is different about this shape."
     }
   }
   ```

   `isMacroShape` and `parseImportedMacro` ignore an unknown top-level key,
   so `_corpus` rides along in the macro the tests validate — which is the
   point: a store hands back whatever it was given.

3. Write the macro exactly as that era saved it. A field the era did not have
   yet is ABSENT, not null. A value the era wrote in an older form stays in
   that form.
4. Address the layers the fake scene holds: `Hero Square`, `Orbit Dot`, and
   `Caption`. `sandbox/corpus.replay.test.ts#makeCorpusScene` builds them, and
   the layer references resolve through the recorded NAME, as they do on a
   real host.
5. Add one assertion in `sandbox/corpus.replay.test.ts` on a value the scene
   ends up holding. A fixture that only proves "nothing threw" does not prove
   the shape still replays.
6. Make the fixture DISCRIMINATE. A recorded pair that produces the same
   result under the new rule and under the old one tests nothing — give the
   step recorded values that the default class would land somewhere else.

A shape the current engine cannot replay declares what it reports, rather
than being left out:

```json
"_corpus": { "replay": { "failures": ["this step can't be replayed (unrecognized format)"] } }
```

## The current fixture

The newest fixture is the shape `buildStep` writes today, and
`engine/corpus.test.ts` asserts every one of its steps still equals what
`buildStep` produces. A change to the payload union, to `kindOf`, or to
`labelOf` fails that check — which is the signal to add a new fixture, not to
edit this one.

To regenerate it, write a throwaway test beside `engine/steps.ts` that calls
`buildStep` on the payloads you want, stamps stable ids, and writes the JSON;
run it with `pnpm vitest run`, then delete it. Node APIs are unavailable to
the checked-in `engine/` sources, which is why the generator is a throwaway.

## Coverage

`engine/corpus.test.ts` lists every `op` in the `StepPayload` union and fails
until a fixture carries each one. A new op needs a fixture before that check
passes.
