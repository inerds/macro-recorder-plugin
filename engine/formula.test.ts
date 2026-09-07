import { describe, expect, it } from "vitest";

import {
  FORMULA_ERRORS,
  applyFormula,
  evalTerm,
  formatFormula,
  parseFormula,
  termsOf,
} from "./formula";
import type { StepPayload } from "./steps";

const layer = { id: "L1", name: "Rect" };

function term(text: string) {
  const r = parseFormula(text);
  if (!r.ok) throw new Error(`${text}: ${r.error}`);
  return r.term;
}

function fails(text: string): string {
  const r = parseFormula(text);
  if (r.ok) throw new Error(`${text} parsed to ${JSON.stringify(r.term)}`);
  return r.error;
}

describe("parseFormula", () => {
  it("reads the forms from the plan", () => {
    expect(term("100")).toEqual({ scale: 0, offset: 100 });
    expect(term("v + 10")).toEqual({ scale: 1, offset: 10 });
    expect(term("v * 2")).toEqual({ scale: 2, offset: 0 });
    expect(term("v * 2 + 10")).toEqual({ scale: 2, offset: 10 });
    expect(term("v + 10/2")).toEqual({ scale: 1, offset: 5 });
    expect(term("v - 45")).toEqual({ scale: 1, offset: -45 });
  });

  it("handles precedence, parentheses, unary minus, spacing, and the long name", () => {
    expect(term("2*(v+1)")).toEqual({ scale: 2, offset: 2 });
    expect(term("(v + 1) * 2 - 3")).toEqual({ scale: 2, offset: -1 });
    expect(term("-v + 10")).toEqual({ scale: -1, offset: 10 });
    expect(term("-5")).toEqual({ scale: 0, offset: -5 });
    expect(term("--5")).toEqual({ scale: 0, offset: 5 });
    expect(term("  v/4  ")).toEqual({ scale: 0.25, offset: 0 });
    expect(term("current + 1")).toEqual({ scale: 1, offset: 1 });
    expect(term("V*3")).toEqual({ scale: 3, offset: 0 });
    expect(term("v × 2 − 1")).toEqual({ scale: 2, offset: -1 });
    expect(term("1.5 + .5")).toEqual({ scale: 0, offset: 2 });
  });

  it("refuses what is not linear in v, or not arithmetic at all", () => {
    expect(fails("")).toBe(FORMULA_ERRORS.empty);
    expect(fails("   ")).toBe(FORMULA_ERRORS.empty);
    expect(fails("v * v")).toBe(FORMULA_ERRORS.nonLinear);
    expect(fails("(v+1)*(v+1)")).toBe(FORMULA_ERRORS.nonLinear);
    expect(fails("10 / v")).toBe(FORMULA_ERRORS.divideByV);
    expect(fails("v / 0")).toBe(FORMULA_ERRORS.divideByZero);
    expect(fails("v / (2 - 2)")).toBe(FORMULA_ERRORS.divideByZero);
    expect(fails("abc")).toBe(FORMULA_ERRORS.syntax);
    expect(fails("x + 1")).toBe(FORMULA_ERRORS.syntax);
    expect(fails("v +")).toBe(FORMULA_ERRORS.syntax);
    expect(fails("(v + 1")).toBe(FORMULA_ERRORS.syntax);
    expect(fails("v 2")).toBe(FORMULA_ERRORS.syntax);
    expect(fails("1.2.3")).toBe(FORMULA_ERRORS.syntax);
    expect(fails("v ^ 2")).toBe(FORMULA_ERRORS.syntax);
  });
});

describe("formatFormula", () => {
  it("prints what the user would have typed", () => {
    expect(formatFormula({ scale: 0, offset: 100 })).toBe("100");
    expect(formatFormula({ scale: 0, offset: -5 })).toBe("-5");
    expect(formatFormula({ scale: 1, offset: 0 })).toBe("v");
    expect(formatFormula({ scale: 1, offset: 10 })).toBe("v + 10");
    expect(formatFormula({ scale: 1, offset: -5 })).toBe("v - 5");
    expect(formatFormula({ scale: 2, offset: 0 })).toBe("v * 2");
    expect(formatFormula({ scale: 2, offset: 10 })).toBe("v * 2 + 10");
    expect(formatFormula({ scale: 0.5, offset: -3 })).toBe("v * 0.5 - 3");
    expect(formatFormula({ scale: -1, offset: 10 })).toBe("-v + 10");
    expect(formatFormula({ scale: 1.24223, offset: 0 })).toBe("v * 1.24");
    expect(formatFormula({ scale: 0, offset: -0 })).toBe("0");
  });

  it("round-trips through the parser", () => {
    for (const scale of [0, 1, -1, 2, 0.5, 1.25]) {
      for (const offset of [0, 10, -5, 0.75]) {
        const t = { scale, offset };
        expect(term(formatFormula(t))).toEqual(t);
      }
    }
  });

  it("spends more digits rather than round a term onto a different meaning", () => {
    // Two decimals is the display precision. Applying it BEFORE the `v` and
    // `+ 0` shorthands would turn a small multiply into a set, a near-1
    // multiply into no multiply at all, and a small shift into nothing.
    expect(formatFormula({ scale: 0.00004, offset: 0 })).toBe("v * 0.00004");
    expect(formatFormula({ scale: 1.00001, offset: 0 })).toBe("v * 1.00001");
    expect(formatFormula({ scale: 1, offset: 0.00004 })).toBe("v + 0.00004");
    expect(formatFormula({ scale: 2, offset: 1e-6 })).toBe("v * 2 + 0.000001");
    expect(formatFormula({ scale: 1, offset: -1e-6 })).toBe("v - 0.000001");
  });

  it("prints plain digits, never exponent notation", () => {
    // "1e+21" reaches the tokenizer as a number, an unknown name and a
    // number — the box would refuse the text it had just written itself.
    expect(formatFormula({ scale: 1, offset: 1e21 })).toBe("v + 1000000000000000000000");
    expect(formatFormula({ scale: 0, offset: -1e21 })).toBe("-1000000000000000000000");
    expect(formatFormula({ scale: 1e21, offset: 0 })).toBe("v * 1000000000000000000000");
  });

  it("keeps every awkward term readable, and of the same kind", () => {
    const kindOf = (t: { scale: number; offset: number }) =>
      t.scale === 0 ? "set" : t.scale === 1 ? "shift" : "scale";
    const close = (a: number, b: number) => Math.abs(a - b) <= Math.abs(b) * 1e-9 + 1e-12;
    const cases = [
      { scale: 0.00004, offset: 0 },
      { scale: 1.00001, offset: 0 },
      { scale: 1, offset: 0.00004 },
      { scale: 2, offset: 1e-6 },
      { scale: 1, offset: 1e21 },
      { scale: -0.00004, offset: -1e-6 },
      { scale: 1e-7, offset: 1e-7 },
    ];
    for (const t of cases) {
      const back = term(formatFormula(t));
      expect(kindOf(back)).toBe(kindOf(t));
      expect(close(back.scale, t.scale)).toBe(true);
      expect(close(back.offset, t.offset)).toBe(true);
    }
  });
});

describe("parseFormula refuses what it cannot parse safely", () => {
  it("caps the input length instead of walking a pathological expression", () => {
    // A recursive-descent parser takes one stack frame per "(", and 5 000 of
    // them overflow it. A refusal is the answer, never a thrown RangeError.
    expect(fails(`${"(".repeat(5000)}v${")".repeat(5000)}`)).toBe(FORMULA_ERRORS.tooLong);
    expect(fails(`v + ${"1".repeat(200)}`)).toBe(FORMULA_ERRORS.tooLong);
    // 200 characters is the cap, and everything under it still parses.
    expect(term(`${"(".repeat(90)}v${")".repeat(90)} + 1`)).toEqual({ scale: 1, offset: 1 });
    expect(term(`v + ${"0".repeat(195)}1`)).toEqual({ scale: 1, offset: 1 });
  });
});

describe("termsOf and applyFormula", () => {
  const setStatic = (
    path: (string | number)[],
    before: unknown,
    after: unknown,
    apply?: unknown,
  ): StepPayload =>
    ({
      op: "set-static",
      path,
      before,
      after,
      layer,
      ...(apply ? { apply } : {}),
    }) as StepPayload;

  it("derives the default term from the recorded values", () => {
    expect(termsOf(setStatic(["rotation"], 0, 45))).toEqual({ scale: 1, offset: 45 });
    expect(termsOf(setStatic(["rotation"], 45, 0))).toEqual({ scale: 0, offset: 0 });
    expect(termsOf(setStatic(["scale"], { x: 100, y: 100 }, { x: 200, y: 50 }))).toEqual({
      x: { scale: 2, offset: 0 },
      y: { scale: 0.5, offset: 0 },
    });
    expect(termsOf(setStatic(["scale"], { x: 50, y: 50 }, { x: 100, y: 100 }))).toEqual({
      x: { scale: 0, offset: 100 },
      y: { scale: 0, offset: 100 },
    });
    expect(termsOf(setStatic(["position"], { x: 80.5, y: 10 }, { x: 100, y: 10 }))).toEqual({
      x: { scale: 1, offset: 19.5 },
      y: { scale: 1, offset: 0 },
    });
  });

  it("treats a multiply from zero as exact", () => {
    expect(termsOf(setStatic(["scale"], { x: 0, y: 100 }, { x: 50, y: 200 }))).toEqual({
      x: { scale: 0, offset: 50 },
      y: { scale: 0, offset: 200 },
    });
  });

  it("returns an explicit formula as is, and nothing for an ineligible step", () => {
    const explicit = { x: { scale: 2, offset: 1 }, y: { scale: 1, offset: 0 } };
    expect(termsOf(setStatic(["position"], { x: 0, y: 0 }, { x: 5, y: 0 }, explicit))).toBe(
      explicit,
    );
    expect(termsOf(setStatic(["opacity"], 100, 50))).toBeUndefined();
    expect(termsOf(setStatic(["shapes", 0, "position"], { x: 0 }, { x: 1 }))).toBeUndefined();
    expect(
      termsOf({ op: "set-plain", path: ["visible"], before: true, after: false, layer }),
    ).toBeUndefined();
  });

  it("defaults a keyframes step to v", () => {
    expect(
      termsOf({ op: "keyframes", path: ["position"], added: [], removed: [], changed: [], layer }),
    ).toEqual({ scale: 1, offset: 0 });
  });

  it("applies a formula to a current value per component", () => {
    expect(evalTerm({ scale: 2, offset: 10 }, 30)).toBe(70);
    expect(applyFormula({ scale: 0, offset: 0 }, 30)).toBe(0);
    expect(
      applyFormula({ x: { scale: 1, offset: 10 }, y: { scale: 0, offset: 5 } }, { x: 310, y: 20 }),
    ).toEqual({
      x: 320,
      y: 5,
    });
    // A component with no term passes through; non-numeric input passes through.
    expect(applyFormula({ x: { scale: 1, offset: 10 } }, { x: 1, y: 2 })).toEqual({ x: 11, y: 2 });
    expect(applyFormula({ scale: 1, offset: 10 }, "n/a")).toBe("n/a");
  });
});
