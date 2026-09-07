/**
 * The two pure decisions behind the formula fields' accessibility: which box
 * is marked invalid, and which of the two naming schemes a row uses. The
 * markup they drive lives in the components; these are the answers it asks
 * for, and they are what a change would break first.
 */
import { describe, expect, it } from "vitest";

import { FORMULA_ERRORS } from "../../engine/formula";
import { isMultiField } from "./ConfigureSheet";
import { formulaError, formulaFieldErrors } from "./StepValueEditor";

describe("formulaFieldErrors", () => {
  it("names only the fields that refuse", () => {
    const value = { kind: "formula", fields: { x: "v + 10", y: "v * v" } } as const;
    expect(formulaFieldErrors(value)).toEqual({ y: FORMULA_ERRORS.nonLinear });
    // The line under the boxes says the first of them; the boxes themselves
    // are marked one by one, so a good x is never marked invalid.
    expect(formulaError(value)).toBe(FORMULA_ERRORS.nonLinear);
  });

  it("is empty for a clean formula and for every other value kind", () => {
    expect(formulaFieldErrors({ kind: "formula", fields: { value: "100" } })).toEqual({});
    expect(formulaFieldErrors({ kind: "number", value: 10 })).toEqual({});
    expect(formulaFieldErrors(null)).toEqual({});
  });
});

describe("isMultiField", () => {
  it("is true for the editors that name each box themselves", () => {
    // These lay out one input per component, and each already carries the
    // component name plus the label. A <label htmlFor> on the first of them
    // would name that one input twice, so the row labels the group instead.
    expect(isMultiField({ kind: "vector", value: { x: 1, y: 2 } })).toBe(true);
    expect(isMultiField({ kind: "formula", fields: { x: "v", y: "v" } })).toBe(true);
  });

  it("is false for the editors that hold exactly one unnamed box", () => {
    expect(isMultiField({ kind: "formula", fields: { value: "v + 10" } })).toBe(false);
    expect(isMultiField({ kind: "number", value: 10 })).toBe(false);
    expect(isMultiField({ kind: "text", value: "SCREEN" })).toBe(false);
    expect(isMultiField({ kind: "color", value: { r: 0, g: 0, b: 0 } })).toBe(false);
    expect(isMultiField({ kind: "boolean", value: true })).toBe(false);
  });
});
