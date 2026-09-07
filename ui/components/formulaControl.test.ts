/**
 * The step formula control's whole decision surface: which verb a stored
 * formula names, what text a verb stores, what happens to the number when the
 * verb changes, and what a typed operator does to both. The control itself
 * only renders these answers.
 */
import { describe, expect, it } from "vitest";

import { evalTerm, parseFormula } from "../../engine/formula";

import {
  absorbLeadingOperator,
  controlOf,
  convertControl,
  convertOperand,
  describeControl,
  divideBlocked,
  multiplyBlocked,
  OP_ORDER,
  textOf,
  type FormulaOp,
} from "./formulaControl";

describe("controlOf", () => {
  it("reads a scale of 0 as Set to", () => {
    expect(controlOf("500")).toEqual({ op: "=", operand: "500" });
    expect(controlOf("0")).toEqual({ op: "=", operand: "0" });
    expect(controlOf("-30")).toEqual({ op: "=", operand: "-30" });
  });

  it("reads a scale of 1 as Add or Subtract by the offset's sign", () => {
    expect(controlOf("v + 30")).toEqual({ op: "+", operand: "30" });
    expect(controlOf("v - 1")).toEqual({ op: "-", operand: "1" });
    // Plain `v` is the identity: add nothing.
    expect(controlOf("v")).toEqual({ op: "+", operand: "0" });
  });

  it("reads a bare scale as Multiply by, and a short reciprocal as Divide by", () => {
    expect(controlOf("v * 2")).toEqual({ op: "*", operand: "2" });
    // The engine only ever STORES a multiply, so Divide by has to be read
    // back out of the scale or the verb the user chose would never come back.
    expect(controlOf("v * 0.5")).toEqual({ op: "/", operand: "2" });
    expect(controlOf("v / 4")).toEqual({ op: "/", operand: "4" });
    // A reciprocal two decimals cannot write is a multiply, not a divide by
    // 3.00.
    expect(controlOf("v * 0.3333333")).toEqual({ op: "*", operand: "0.33" });
    // A negative scale reads as a multiply: "divide by -1" spells `-v` and
    // nobody thinks in it.
    expect(controlOf("-v")).toEqual({ op: "*", operand: "-1" });
  });

  it("names no verb for an expression the verbs cannot show", () => {
    expect(controlOf("v * 2 + 10")).toEqual({ op: null, operand: "v * 2 + 10" });
    expect(controlOf("v * v")).toEqual({ op: null, operand: "v * v" });
    expect(controlOf("")).toEqual({ op: null, operand: "" });
    expect(controlOf("30 +")).toEqual({ op: null, operand: "30 +" });
  });
});

describe("textOf", () => {
  it("writes engine grammar for every verb", () => {
    expect(textOf("=", "500")).toBe("500");
    expect(textOf("+", "30")).toBe("v + 30");
    expect(textOf("-", "1")).toBe("v - 1");
    expect(textOf("*", "2")).toBe("v * 2");
    expect(textOf("/", "2")).toBe("v / 2");
  });

  it("writes a blank field for a blank operand, whatever the verb", () => {
    // So a cleared box refuses with "Enter a value" rather than a syntax
    // complaint about the `v +` it would otherwise leave behind.
    for (const op of OP_ORDER) expect(textOf(op, "  ")).toBe("");
  });

  it("round-trips every verb through controlOf", () => {
    const pairs: [FormulaOp, string][] = [
      ["=", "500"],
      ["=", "-30"],
      ["+", "30"],
      ["-", "1"],
      ["*", "2"],
      ["/", "2"],
    ];
    for (const [op, operand] of pairs) {
      expect(controlOf(textOf(op, operand)), `${op} ${operand}`).toEqual({ op, operand });
    }
  });
});

describe("convertOperand", () => {
  // The recorded start value: a drag from 100 to 130 opens as `v + 30`.
  const at = 100;

  it("turns a relative operand into the value it lands on", () => {
    expect(convertOperand("+", "=", "30", at)).toBe("130");
    expect(convertOperand("-", "=", "30", at)).toBe("70");
    expect(convertOperand("*", "=", "2", at)).toBe("200");
    expect(convertOperand("/", "=", "2", at)).toBe("50");
  });

  it("turns an exact value into the change that reaches it", () => {
    expect(convertOperand("=", "+", "130", at)).toBe("30");
    // The absolute delta; convertControl puts it under the verb the user chose.
    expect(convertOperand("=", "+", "70", at)).toBe("30");
    expect(convertOperand("=", "*", "130", at)).toBe("1.3");
    expect(convertOperand("=", "/", "50", at)).toBe("2");
  });

  it("converts between the four relative verbs through the same value", () => {
    expect(convertOperand("*", "+", "2", at)).toBe("100");
    expect(convertOperand("+", "*", "100", at)).toBe("2");
    expect(convertOperand("/", "+", "2", at)).toBe("50");
    expect(convertOperand("*", "/", "2", at)).toBe("0.5");
  });

  it("converts a raw expression through its value at the recorded start", () => {
    expect(convertOperand(null, "=", "v * 2 + 10", at)).toBe("210");
    expect(convertOperand(null, "+", "v * 2 + 10", at)).toBe("110");
  });

  it("falls back to a no-op operand when the field cannot be read", () => {
    expect(convertOperand(null, "=", "v * v", at)).toBe("0");
    expect(convertOperand(null, "*", "v * v", at)).toBe("1");
  });

  it("cannot scale from a recorded 0, and says so with a 1", () => {
    // The items are aria-disabled in this case; the guard is the belt.
    expect(convertOperand("+", "*", "30", 0)).toBe("1");
    expect(convertOperand("+", "/", "30", 0)).toBe("1");
  });

  it("converts against 0 when the step recorded no start value", () => {
    // A keyframes step records a run of values and none of them is what `v`
    // holds at replay time, so it carries no `at`.
    expect(convertOperand("+", "=", "30")).toBe("30");
    expect(convertOperand("=", "+", "30")).toBe("30");
  });
});

describe("convertControl", () => {
  it("always lands on the verb the user chose", () => {
    for (const from of OP_ORDER) {
      for (const to of OP_ORDER) {
        expect(convertControl(from, to, "30", 100).op, `${from} → ${to}`).toBe(to);
      }
    }
  });

  it("keeps the number inside a family: Add ↔ Subtract, Multiply ↔ Divide", () => {
    expect(convertControl("+", "-", "30", 100)).toEqual({ op: "-", operand: "30" });
    expect(convertControl("-", "+", "30", 100)).toEqual({ op: "+", operand: "30" });
    expect(convertControl("*", "/", "2", 100)).toEqual({ op: "/", operand: "2" });
    expect(convertControl("/", "*", "2", 100)).toEqual({ op: "*", operand: "2" });
    expect(convertControl("+", "+", "30", 100)).toEqual({ op: "+", operand: "30" });
  });

  it("converts the number through the recorded value across families", () => {
    expect(convertControl("+", "=", "30", 100)).toEqual({ op: "=", operand: "130" });
    expect(convertControl("=", "+", "130", 100)).toEqual({ op: "+", operand: "30" });
    // The magnitude, under the verb chosen — Subtract 30 from Set to 70.
    expect(convertControl("=", "-", "70", 100)).toEqual({ op: "-", operand: "30" });
    expect(convertControl("=", "*", "130", 100)).toEqual({ op: "*", operand: "1.3" });
    expect(convertControl("=", "/", "50", 100)).toEqual({ op: "/", operand: "2" });
    expect(convertControl("*", "+", "2", 100)).toEqual({ op: "+", operand: "100" });
  });

  it("keeps the value the field lands on when the verb crosses a family", () => {
    // Within the two decimals the operand is printed to: `v / 0.77` lands
    // on 129.87, not 130.
    const at = 100;
    for (const to of ["=", "*", "/"] as const) {
      const next = convertControl("+", to, "30", at);
      const parsed = parseFormula(textOf(next.op, next.operand));
      expect(parsed.ok, `${to}`).toBe(true);
      if (!parsed.ok) continue;
      expect(evalTerm(parsed.term, at), `${to}`).toBeCloseTo(130, 0);
    }
  });
});

describe("multiplyBlocked / divideBlocked", () => {
  it("blocks Multiply by from a recorded 0", () => {
    expect(multiplyBlocked(0)).toBe(true);
    expect(multiplyBlocked(100)).toBe(false);
    expect(multiplyBlocked(undefined)).toBe(false);
  });

  it("blocks Divide by from a recorded 0 and onto a value of 0", () => {
    expect(divideBlocked({ op: "+", operand: "30" }, 0)).toBe(true);
    expect(divideBlocked({ op: "=", operand: "0" }, 100)).toBe(true);
    expect(divideBlocked({ op: "+", operand: "30" }, 100)).toBe(false);
  });
});

describe("absorbLeadingOperator", () => {
  it("takes a leading operator into the verb and out of the box", () => {
    expect(absorbLeadingOperator("+5", "=")).toEqual({ op: "+", operand: "5" });
    expect(absorbLeadingOperator("*2", "+")).toEqual({ op: "*", operand: "2" });
    expect(absorbLeadingOperator("/2", "+")).toEqual({ op: "/", operand: "2" });
    expect(absorbLeadingOperator("=500", "+")).toEqual({ op: "=", operand: "500" });
  });

  it("takes the typographic operators too", () => {
    expect(absorbLeadingOperator("×2", "+")).toEqual({ op: "*", operand: "2" });
    expect(absorbLeadingOperator("÷2", "+")).toEqual({ op: "/", operand: "2" });
    expect(absorbLeadingOperator("−5", "+")).toEqual({ op: "-", operand: "5" });
  });

  it("keeps a leading minus as a negative number under Set to", () => {
    // `-30` is a value you can set a property to; under every other verb it
    // is Subtract.
    expect(absorbLeadingOperator("-30", "=")).toEqual({ op: "=", operand: "-30" });
    expect(absorbLeadingOperator("-30", "+")).toEqual({ op: "-", operand: "30" });
  });

  it("drops to Formula as soon as a letter appears", () => {
    expect(absorbLeadingOperator("v + 30", "+")).toEqual({ op: null, operand: "v + 30" });
    expect(absorbLeadingOperator("v * 2 + 10", "=")).toEqual({
      op: null,
      operand: "v * 2 + 10",
    });
  });

  it("leaves plain digits under the verb that is already chosen", () => {
    expect(absorbLeadingOperator("30", "+")).toEqual({ op: "+", operand: "30" });
    expect(absorbLeadingOperator("", "*")).toEqual({ op: "*", operand: "" });
    expect(absorbLeadingOperator("1.", "=")).toEqual({ op: "=", operand: "1." });
  });
});

describe("describeControl", () => {
  it("prints a formula in the control's own words", () => {
    expect(describeControl("v + 30")).toBe("Add 30");
    expect(describeControl("v - 1")).toBe("Subtract 1");
    expect(describeControl("500")).toBe("Set to 500");
    expect(describeControl("v * 2")).toBe("Multiply by 2");
    expect(describeControl("v / 2")).toBe("Divide by 2");
  });

  it("names an expression no verb can show as a formula", () => {
    expect(describeControl("v * 2 + 10")).toBe("Formula v * 2 + 10");
  });
});

describe("operand rounding", () => {
  it("prints two decimals", () => {
    expect(controlOf("v + 1.2422")).toEqual({ op: "+", operand: "1.24" });
    expect(convertOperand("=", "*", "133.7", 100)).toBe("1.34");
  });

  it("spends more digits rather than print an operand that means nothing", () => {
    // `+ 0` shifts nothing and `× 1` scales nothing: an operand two decimals
    // would flatten onto one of those gets the digits it needs instead.
    expect(controlOf("v + 0.00004")).toEqual({ op: "+", operand: "0.00004" });
    expect(controlOf("v * 1.00001")).toEqual({ op: "*", operand: "1.00001" });
  });

  it("stores the operand as typed, however many decimals that is", () => {
    // Rounding is for the numbers the CONTROL derived. A number the user
    // typed is theirs.
    expect(textOf("+", "1.245")).toBe("v + 1.245");
    expect(textOf("=", "0.123456")).toBe("0.123456");
  });
});
