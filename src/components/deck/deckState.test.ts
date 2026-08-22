import { describe, expect, it } from "vitest";

import {
  deckLabel,
  deckLamp,
  deriveDeckState,
  type DeckFlags,
  type DeckInput,
  type DeckState,
} from "./deckState";

const NOW = 1_000_000;
const NONE: DeckFlags = { rewindUntil: 0, doneUntil: 0 };
const REWINDING: DeckFlags = { rewindUntil: NOW + 200, doneUntil: 0 };
const FINISHING: DeckFlags = { rewindUntil: 0, doneUntil: NOW + 300 };

const cases: Array<{
  name: string;
  input: DeckInput;
  flags: DeckFlags;
  state: DeckState;
  lamp: "red" | "amber" | null;
  label: string;
}> = [
  {
    name: "idle at rest",
    input: { mode: "idle" },
    flags: NONE,
    state: "idle",
    lamp: null,
    label: "Ready",
  },
  {
    name: "reviewing reads as at rest",
    input: { mode: "reviewing" },
    flags: NONE,
    state: "idle",
    lamp: null,
    label: "Ready",
  },
  {
    name: "configuring reads as at rest",
    input: { mode: "configuring" },
    flags: NONE,
    state: "idle",
    lamp: null,
    label: "Ready",
  },
  {
    name: "recording",
    input: { mode: "recording" },
    flags: NONE,
    state: "recording",
    lamp: "red",
    label: "Recording",
  },
  {
    name: "recording ignores a stale done window",
    input: { mode: "recording" },
    flags: FINISHING,
    state: "recording",
    lamp: "red",
    label: "Recording",
  },
  {
    name: "playing, rewind window open",
    input: { mode: "playing" },
    flags: REWINDING,
    state: "rewind",
    lamp: "red",
    label: "Rewind",
  },
  {
    name: "playing, rewind window closed",
    input: { mode: "playing" },
    flags: NONE,
    state: "playing",
    lamp: "red",
    label: "Playing",
  },
  {
    name: "playing, rewind window expired exactly now",
    input: { mode: "playing" },
    flags: { rewindUntil: NOW, doneUntil: 0 },
    state: "playing",
    lamp: "red",
    label: "Playing",
  },
  {
    name: "a failed step outranks the rewind window",
    input: { mode: "playing", playbackError: true },
    flags: REWINDING,
    state: "paused",
    lamp: "amber",
    label: "Paused",
  },
  {
    name: "idle inside the done window",
    input: { mode: "idle" },
    flags: FINISHING,
    state: "done",
    lamp: null,
    label: "Done",
  },
  {
    name: "idle after the done window",
    input: { mode: "idle" },
    flags: { rewindUntil: 0, doneUntil: NOW },
    state: "idle",
    lamp: null,
    label: "Ready",
  },
];

describe("deriveDeckState", () => {
  for (const testCase of cases) {
    it(`${testCase.name} → ${testCase.state}`, () => {
      const state = deriveDeckState(testCase.input, testCase.flags, NOW);
      expect(state).toBe(testCase.state);
      expect(deckLamp(state)).toBe(testCase.lamp);
      expect(deckLabel(state)).toBe(testCase.label);
    });
  }

  it("every state has a lamp decision and a label", () => {
    const all: DeckState[] = [
      "idle",
      "recording",
      "rewind",
      "playing",
      "paused",
      "done",
    ];
    for (const state of all) {
      expect(deckLabel(state)).toMatch(/^[A-Z]/);
      expect([null, "red", "amber"]).toContain(deckLamp(state));
    }
  });
});
