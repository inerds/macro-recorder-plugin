/**
 * Every macro shape this plugin has ever saved still works.
 *
 * A macro outlives the code that recorded it: Creator keeps it in
 * `clientStorage` and a user keeps the JSON they exported. A change to the
 * step shape that an older macro cannot survive has to fail here, not blank a
 * panel — which is what happened on 2026-09-07, when the formula build read
 * the first cut's `apply` strings as terms (docs/history/improvements.md).
 *
 * The corpus is `engine/testing/macros/*.json`, one fixture per era, and this
 * suite runs the panel's whole data path over each one: validation, import,
 * labels, the review sheet's editor, Simplify, and parameter pinning. The
 * PLAYBACK half lives in `sandbox/corpus.replay.test.ts`, which needs the
 * `creator` global that only `tsconfig.sandbox.json` knows about.
 *
 * Adding a shape means adding a fixture. See
 * `docs/contributing/macro-corpus.md`.
 */
import { describe, expect, it } from "vitest";

import { controlOf } from "../ui/components/formulaControl";
import { applyParamValues, editableValueOf, withEditedValue } from "./editing";
import { parseFormula } from "./formula";
import { labelOf } from "./labels";
import { isMacroShape, parseImportedMacro, type MacroStep } from "./macro";
import { explicitFormulaOf } from "./operator";
import { simplifySteps } from "./simplify";
import { buildStep, kindOf, type StepPayload } from "./steps";
import { CORPUS, CURRENT_FIXTURE } from "./testing/corpus";

/** Text that reads as a rendering bug rather than a label. */
const JUNK = /undefined|\[object Object\]|NaN|\bnull\b/;

function payloadOf(step: MacroStep): StepPayload | null {
  const payload = step.payload;
  if (typeof payload !== "object" || payload === null) return null;
  if (typeof (payload as { op?: unknown }).op !== "string") return null;
  return payload as StepPayload;
}

it("holds a fixture for every era, oldest first", () => {
  expect(CORPUS.length).toBeGreaterThanOrEqual(6);
  const eras = CORPUS.map((each) => each.meta.era);
  expect(new Set(eras).size).toBe(eras.length);
  for (const each of CORPUS) {
    expect(each.meta.introduced, each.file).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(each.meta.note.length, each.file).toBeGreaterThan(20);
  }
});

it("covers every StepPayload op at least once", () => {
  // The union's own arms, read off the one function that must handle all of
  // them: `kindOf` switches on `op` with no default, so this list is the
  // union itself and a new op fails the check until a fixture carries it.
  const ops = new Set<string>();
  for (const each of CORPUS) {
    for (const step of each.macro.steps) {
      const payload = payloadOf(step);
      if (payload) ops.add(payload.op);
    }
  }
  expect([...ops].sort()).toEqual([
    "add-fill",
    "add-layer",
    "add-mask",
    "add-paint",
    "add-shape",
    "add-stroke",
    "add-trim",
    "break-scene",
    "keyframes",
    "nest-layers",
    "not-replayable",
    "remove-layer",
    "remove-mask",
    "remove-paint",
    "remove-shape",
    "remove-trim",
    "reorder-layers",
    "reorder-shapes",
    "replace-paint",
    "set-plain",
    "set-scene",
    "set-static",
  ]);
});

describe.each(CORPUS.map((each) => [each.meta.era, each] as const))(
  "corpus · %s",
  (era, fixture) => {
    const macro = fixture.macro;

    it("is a macro the store recognizes, `_corpus` key and all", () => {
      expect(isMacroShape(macro), fixture.file).toBe(true);
      expect(typeof macro.id).toBe("string");
    });

    it("round-trips through an import", () => {
      let n = 0;
      const imported = parseImportedMacro(fixture.json, () => `${era}-id${++n}`);
      expect(imported.name).toBe(macro.name);
      expect(imported.steps).toHaveLength(macro.steps.length);
      // The import regenerates ids, so compare everything else.
      expect(imported.steps.map((step) => [step.kind, step.label, step.payload])).toEqual(
        macro.steps.map((step) => [step.kind, step.label, step.payload]),
      );
      // A disabled step stays off; the `_corpus` key never survives.
      expect(imported.steps.map((step) => step.disabled === true)).toEqual(
        macro.steps.map((step) => step.disabled === true),
      );
      expect("_corpus" in imported).toBe(false);
      if (macro.params) {
        expect(imported.params).toHaveLength(macro.params.length);
        for (const param of imported.params!) {
          expect(imported.steps.some((step) => step.id === param.stepId)).toBe(true);
        }
      }
      if (macro.playOptions) expect(imported.playOptions).toEqual(macro.playOptions);
      if (macro.source) expect(imported.source).toEqual(macro.source);
    });

    it("labels every step, stored and rebuilt", () => {
      for (const step of macro.steps) {
        expect(step.label, `${fixture.file} · ${step.id}`).toBeTruthy();
        expect(step.label, `${fixture.file} · ${step.id}`).not.toMatch(JUNK);
        const payload = payloadOf(step);
        if (!payload) continue;
        const rebuilt = labelOf(payload);
        expect(rebuilt, `${fixture.file} · ${step.id}`).toBeTruthy();
        expect(rebuilt, `${fixture.file} · ${step.id}`).not.toMatch(JUNK);
        expect(kindOf(payload), `${fixture.file} · ${step.id}`).toBeTruthy();
      }
    });

    it("runs the review sheet's editor on every editable step", () => {
      for (const step of macro.steps) {
        const value = editableValueOf(step);
        if (value === null) continue;
        // Writing a value back must never throw and must keep a label.
        const edited = withEditedValue(step, value);
        expect(edited.label, `${fixture.file} · ${step.id}`).toBeTruthy();
        expect(edited.label, `${fixture.file} · ${step.id}`).not.toMatch(JUNK);
        if (value.kind !== "formula") continue;
        // A formula field has to reach the verb editor as a control it can
        // show, whatever shape the era stored `apply` in.
        for (const [key, text] of Object.entries(value.fields)) {
          expect(text, `${fixture.file} · ${step.id} · ${key}`).toBeTruthy();
          expect(text, `${fixture.file} · ${step.id} · ${key}`).not.toMatch(JUNK);
          expect(parseFormula(text).ok, `${fixture.file} · ${step.id} · ${key}`).toBe(true);
          const control = controlOf(text);
          expect(control.operand, `${fixture.file} · ${step.id} · ${key}`).not.toMatch(JUNK);
        }
      }
    });

    it("simplifies to a macro that still validates", () => {
      const steps = simplifySteps(macro.steps);
      expect(steps.length).toBeLessThanOrEqual(macro.steps.length);
      expect(isMacroShape({ ...macro, steps })).toBe(true);
      for (const step of steps) {
        expect(step.label, `${fixture.file} · ${step.id}`).toBeTruthy();
        expect(step.label, `${fixture.file} · ${step.id}`).not.toMatch(JUNK);
      }
      // Simplify is idempotent: a second pass finds nothing more to fold.
      expect(simplifySteps(steps)).toEqual(steps);
    });

    it("pins the parameters it declares", () => {
      if (!macro.params) {
        expect(macro.params).toBeUndefined();
        return;
      }
      const values: Record<string, ReturnType<typeof editableValueOf>> = {};
      for (const param of macro.params) {
        const step = macro.steps.find((each) => each.id === param.stepId);
        expect(step, `${fixture.file} · ${param.label}`).toBeDefined();
        expect(step!.disabled, `${fixture.file} · ${param.label}`).toBeUndefined();
        const value = editableValueOf(step!);
        expect(value, `${fixture.file} · ${param.label}`).not.toBeNull();
        values[param.stepId] = value;
      }
      // A form nobody typed into leaves every step exactly as it was.
      const untouched = applyParamValues(
        macro,
        values as Record<string, NonNullable<ReturnType<typeof editableValueOf>>>,
      );
      expect(untouched).toEqual(macro.steps);
    });
  },
);

describe("the current fixture", () => {
  it("is what `buildStep` writes today", () => {
    for (const step of CURRENT_FIXTURE.macro.steps) {
      const payload = payloadOf(step);
      expect(payload, step.id).not.toBeNull();
      const built = buildStep(payload!);
      // `buildStep` mints an id; everything else must match the fixture.
      expect({ kind: built.kind, label: built.label, payload: built.payload }, step.id).toEqual({
        kind: step.kind,
        label: step.label,
        payload: step.payload,
      });
      expect(built.replayable, step.id).toBe(step.replayable);
    }
  });
});

describe("the shapes the corpus exists to protect", () => {
  it("reads the first cut's `apply` strings back as the formula they meant", () => {
    const macro = CORPUS.find((each) => each.meta.era === "formula-strings")!.macro;
    const formulas = macro.steps.map((step) => explicitFormulaOf(payloadOf(step)!));
    expect(formulas[0]).toEqual({ x: { scale: 0, offset: 640 }, y: { scale: 0, offset: 480 } });
    expect(formulas[1]).toEqual({ scale: 3, offset: 0 });
    expect(formulas[2]).toEqual({ x: { scale: 1, offset: 30 }, y: { scale: 1, offset: 30 } });
    // A keyframes step drops the string and replays by its class, as it did.
    expect(formulas[3]).toBeUndefined();
  });

  it("shows a legacy `apply` string in the verb editor", () => {
    const macro = CORPUS.find((each) => each.meta.era === "formula-strings")!.macro;
    const value = editableValueOf(macro.steps[1]!);
    expect(value?.kind).toBe("formula");
    const text = (value as { fields: Record<string, string> }).fields.value!;
    expect(controlOf(text)).toEqual({ op: "*", operand: "3" });
  });

  it("keeps a legacy `reorder-layers` payload readable without `layers`", () => {
    const macro = CORPUS.find((each) => each.meta.era === "play-options")!.macro;
    const payload = payloadOf(macro.steps[2]!) as Extract<StepPayload, { op: "reorder-layers" }>;
    expect(payload.layers).toBeUndefined();
    expect(payload.order).toEqual([2, 0, 1]);
  });
});
