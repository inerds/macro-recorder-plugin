/**
 * The macro-corpus: one saved macro per shape this plugin has ever written to
 * `creator.clientStorage`, to `localStorage`, or to an export file.
 *
 * A macro outlives the code that recorded it. Creator keeps it in storage, and
 * a user keeps the JSON they exported, so every shape the plugin has ever
 * saved is a shape it must still read. The fixtures under `macros/` are that
 * history, and `engine/corpus.test.ts` and `sandbox/corpus.replay.test.ts`
 * run the whole panel's data path over each one.
 *
 * The rule for a shape change: ADD a fixture, never edit one. See
 * `docs/contributing/macro-corpus.md`.
 */
import type { Macro } from "../macro";

import v1Legacy from "./macros/01-v1-legacy.json";
import v3Launch from "./macros/02-v3-launch.json";
import kfTangents from "./macros/03-kf-tangents.json";
import paramsDisabled from "./macros/04-params-disabled.json";
import playOptions from "./macros/05-play-options.json";
import reorderVerified from "./macros/06-reorder-verified.json";
import sceneSettings from "./macros/07-scene-settings.json";
import formulaStrings from "./macros/08-formula-strings.json";
import formulaTerms from "./macros/09-formula-terms.json";
import current from "./macros/10-current.json";

/** The `_corpus` block every fixture carries. It is not part of a macro. */
export interface CorpusMeta {
  /** The era's slug — the name a failing case reports. */
  era: string;
  /** The commit or tag that introduced the shape, and its date. */
  introduced: string;
  /** What is different about this shape, in one or two sentences. */
  note: string;
  /**
   * What a replay of this fixture is expected to report. A shape the current
   * engine cannot replay says so HERE, with the message it produces, rather
   * than being left out of the suite.
   */
  replay?: { failures?: string[] };
}

export interface CorpusFixture {
  /** The fixture's file name, for a failure message to name. */
  file: string;
  meta: CorpusMeta;
  /**
   * The macro exactly as that era's store held it, `_corpus` included — an
   * unknown top-level key is what a store hands back, and `isMacroShape` and
   * `parseImportedMacro` both have to tolerate one.
   */
  macro: Macro;
  /** The same fixture as the JSON text an import reads. */
  json: string;
}

type RawFixture = Record<string, unknown> & { _corpus: CorpusMeta };

function fixture(file: string, raw: unknown): CorpusFixture {
  const data = raw as RawFixture;
  return {
    file,
    meta: data._corpus,
    macro: data as unknown as Macro,
    json: JSON.stringify(data),
  };
}

/** Oldest shape first, so a walk of the corpus reads as the history it is. */
export const CORPUS: readonly CorpusFixture[] = [
  fixture("01-v1-legacy.json", v1Legacy),
  fixture("02-v3-launch.json", v3Launch),
  fixture("03-kf-tangents.json", kfTangents),
  fixture("04-params-disabled.json", paramsDisabled),
  fixture("05-play-options.json", playOptions),
  fixture("06-reorder-verified.json", reorderVerified),
  fixture("07-scene-settings.json", sceneSettings),
  fixture("08-formula-strings.json", formulaStrings),
  fixture("09-formula-terms.json", formulaTerms),
  fixture("10-current.json", current),
];

/** The fixture that must match what `buildStep` writes today. */
export const CURRENT_FIXTURE: CorpusFixture = CORPUS[CORPUS.length - 1]!;

export function corpusFixture(era: string): CorpusFixture {
  const found = CORPUS.find((each) => each.meta.era === era);
  if (!found) throw new Error(`no corpus fixture for era "${era}"`);
  return found;
}
