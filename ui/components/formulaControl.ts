/**
 * The mapping between a step's stored formula text and the control the user
 * sees: a verb menu (Set to, Add, Subtract, Multiply, Divide, Formula)
 * and one number box.
 *
 * Storage does not change — a field still holds engine grammar (`"v + 30"`,
 * `"500"`) and `engine/formula.ts` is still the only parser. This module is
 * the translation in both directions, kept pure so the control itself stays a
 * thin render of what these functions answer.
 *
 * A verb is selected when the stored text is one of the five shapes a verb
 * can show. Anything else — `v * 2 + 10`, half-typed text, a paste the parser
 * refuses — is Formula, and the box shows the expression as it stands.
 */
import {
  DECIMALS,
  expandExponent,
  evalTerm,
  parseFormula,
  roundKeepingMeaning,
} from "../../engine/formula";

/** The five verbs that take a number. `Formula` is the absence of one. */
export type FormulaOp = "=" | "+" | "-" | "*" | "/";

/** What the control shows for one field: a verb, or none, and the box. */
export interface FormulaControl {
  /** Null when the box holds a full expression no verb can show. */
  op: FormulaOp | null;
  /** The operand for a verb; the raw expression when there is none. */
  operand: string;
}

/**
 * What each verb is called, on the menu and on the button. Words, not the
 * glyphs this control used to wear: `X = + 30` reads as an equation, and the
 * user reported it as one (2026-09-07).
 */
/**
 * The verbs as the trigger and the menu show them. "Multiply" and "Divide"
 * drop their "by": the number beside the verb says it, and the two extra
 * words were what made the trigger wider than the box it governs.
 */
export const OP_TITLES: Record<FormulaOp, string> = {
  "=": "Set to",
  "+": "Add",
  "-": "Subtract",
  "*": "Multiply",
  "/": "Divide",
};

/** The same verbs as a sentence reads them, for the play form's hint. */
export const OP_SENTENCE: Record<FormulaOp, string> = {
  "=": "Set to",
  "+": "Add",
  "-": "Subtract",
  "*": "Multiply by",
  "/": "Divide by",
};

/** The sixth item: no verb, a whole expression in the box. */
export const FORMULA_VERB = "Formula";

/** The verbs in menu order — the source for both the render and the tests. */
export const OP_ORDER: readonly FormulaOp[] = ["=", "+", "-", "*", "/"];

/**
 * The values an operand must never be ROUNDED onto, per verb. A `+ 0.00004`
 * printed as `+ 0` shifts nothing and a `× 1.00001` printed as `× 1` scales
 * nothing — the same rule `formatFormula` follows, applied to the number the
 * box shows.
 */
function landmarks(op: FormulaOp): readonly number[] {
  return op === "*" || op === "/" ? [0, 1] : [0];
}

/**
 * A number the box can show and `parseFormula` can read back: two decimals
 * unless that would change what the operand MEANS, never exponent form. The
 * tokenizer reads digits and a point and nothing else, so `1e+21` would come
 * back as a number, an unknown name and a number — `expandExponent`
 * (engine/formula.ts) spells it out instead.
 */
function num(n: number, op: FormulaOp): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = roundKeepingMeaning(n, landmarks(op));
  if (rounded === 0) return "0";
  const text = String(rounded);
  return text.includes("e") || text.includes("E") ? expandExponent(text) : text;
}

/** True when `n` needs two decimals or fewer to be written exactly. */
function isShortDecimal(n: number): boolean {
  return Number.isFinite(n) && Number(n.toFixed(DECIMALS)) === n;
}

/**
 * The control for one field's stored text.
 *
 * The rules follow the term, not the spelling, so text that came back from
 * `formatFormula` picks the same verb it went in with:
 *
 * - scale 0 — the term ignores `v` — is `Set to`, with the offset as the
 *   operand.
 * - scale 1 is `Add` or `Subtract`, by the offset's sign, with `|offset|` as
 *   the operand.
 * - offset 0 with any other scale is `Multiply by`; a scale between 0 and 1
 *   whose reciprocal is a short decimal is `Divide by` instead, because
 *   "divide by 2" is what the user chose and `× 0.5` is only how the engine
 *   stores it.
 * - everything else is Formula.
 */
export function controlOf(text: string): FormulaControl {
  const parsed = parseFormula(text);
  if (!parsed.ok) return { op: null, operand: text };
  const { scale, offset } = parsed.term;
  if (scale === 0) return { op: "=", operand: num(offset, "=") };
  if (scale === 1) {
    return offset < 0
      ? { op: "-", operand: num(-offset, "-") }
      : { op: "+", operand: num(offset, "+") };
  }
  if (offset === 0) {
    // Only a positive scale reads as a division. `-v` is `× -1`: a `÷ -1`
    // spells the same arithmetic and nobody thinks in it.
    const reciprocal = 1 / scale;
    if (scale > 0 && scale < 1 && isShortDecimal(reciprocal)) {
      return { op: "/", operand: num(reciprocal, "/") };
    }
    return { op: "*", operand: num(scale, "*") };
  }
  return { op: null, operand: text };
}

/**
 * Engine grammar for a verb and its operand. The operand is stored AS TYPED:
 * a user who means `1.245` gets `1.245`, and only the printing of a number
 * the control derived is rounded.
 *
 * A blank operand becomes a blank field rather than `v + `, so a cleared box
 * refuses with "Enter a value" — what is wrong is that nothing is there, not
 * that the syntax is bad.
 */
export function textOf(op: FormulaOp, operand: string): string {
  const trimmed = operand.trim();
  if (trimmed === "") return "";
  if (op === "=") return trimmed;
  return `v ${op} ${trimmed}`;
}

/** The value a control produces when `v` is `at`, or null when it cannot be read. */
function valueAt(control: FormulaControl, at: number): number | null {
  const text = control.op === null ? control.operand : textOf(control.op, control.operand);
  const parsed = parseFormula(text);
  if (!parsed.ok) return null;
  const value = evalTerm(parsed.term, at);
  return Number.isFinite(value) ? value : null;
}

/**
 * The operand that keeps a field MEANING the same when the verb changes,
 * measured at the recorded value `at`.
 *
 * A user who recorded a drag to 130 from 100 and chooses `Set to` wants
 * `130`, not the `30` that was in the box: the number has to stay about the
 * same edit. `at` defaults to 0 — a keyframes step records a run of values
 * and none of them is the one `v` stands for at replay time, so it carries no
 * `at` and `Set to` converts against nothing.
 *
 * The `Add`/`Subtract` result is the ABSOLUTE delta; `convertControl` picks
 * which of the two verbs the sign calls for.
 */
export function convertOperand(
  from: FormulaOp | null,
  to: FormulaOp,
  operandText: string,
  at = 0,
): string {
  const value = valueAt({ op: from, operand: operandText }, at);
  // A field the parser refuses has no value to carry over; the verb still
  // takes, and it takes an operand that changes nothing.
  if (value === null) return to === "*" || to === "/" ? "1" : "0";
  if (to === "=") return num(value, "=");
  if (to === "+" || to === "-") return num(Math.abs(value - at), to);
  if (to === "*") return at === 0 ? "1" : num(value / at, "*");
  return value === 0 || at === 0 ? "1" : num(at / value, "/");
}

/** The verbs that share a number: a delta, or a factor. */
function family(op: FormulaOp | null): "shift" | "scale" | "set" | null {
  if (op === "+" || op === "-") return "shift";
  if (op === "*" || op === "/") return "scale";
  if (op === "=") return "set";
  return null;
}

/**
 * The verb AND the operand a conversion lands on. The verb the user chose
 * ALWAYS wins — a menu that answers "Subtract" with "Add" is a menu that
 * does not work (2026-09-07: the first cut re-derived Add/Subtract from the
 * delta's sign, so Subtract could never be chosen). Inside a family the
 * number stays as typed: Add 30 → Subtract 30, Multiply 2 → Divide 2; that
 * changes what the step does, and it is exactly the change the user asked
 * for. Across families the number is converted through the recorded value
 * so it stays meaningful: Add 30 at 100 → Set to 130, Set to 70 at 100 →
 * Subtract 30 (the magnitude, under the verb chosen).
 */
export function convertControl(
  from: FormulaOp | null,
  to: FormulaOp,
  operandText: string,
  at = 0,
): { op: FormulaOp; operand: string } {
  if (from === to) return { op: to, operand: operandText };
  const same = family(from) !== null && family(from) === family(to);
  if (same) {
    const parsed = Number(operandText);
    return {
      op: to,
      operand: Number.isFinite(parsed) ? operandText : convertOperand(from, to, operandText, at),
    };
  }
  return { op: to, operand: convertOperand(from, to, operandText, at) };
}

/** True when `Multiply by` cannot express the field: nothing times 0 is anything but 0. */
export function multiplyBlocked(at: number | undefined): boolean {
  return at === 0;
}

/** True when `Divide by` cannot express the field: it would divide by 0 on one side. */
export function divideBlocked(control: FormulaControl, at: number | undefined): boolean {
  if (at === 0) return true;
  const value = valueAt(control, at ?? 0);
  return value === 0;
}

const OPERATOR_CHARS: Record<string, FormulaOp> = {
  "=": "=",
  "+": "+",
  "-": "-",
  "−": "-",
  "*": "*",
  "×": "*",
  "/": "/",
  "÷": "/",
};

/**
 * What the box holds after the user typed or pasted `typed`, given the verb
 * that is selected now.
 *
 * Three rules, in order:
 *
 * 1. Text with a letter in it is a full expression — `v * 2 + 10` pasted over
 *    the operand — so the verb becomes Formula and the text stands as typed.
 * 2. A leading operator selects the verb it names and leaves the box. Typing
 *    `*2` in a box showing `30` selects `Multiply by` and leaves `2`.
 * 3. In `Set to` a leading `-` is a negative number, not `Subtract`: `-30`
 *    is a value you can set a property to.
 */
export function absorbLeadingOperator(typed: string, currentOp: FormulaOp | null): FormulaControl {
  if (/[a-zA-Z]/.test(typed)) return { op: null, operand: typed };
  const head = typed.trimStart()[0];
  const op = head === undefined ? undefined : OPERATOR_CHARS[head];
  if (op === undefined) return { op: currentOp, operand: typed };
  if (op === "-" && currentOp === "=") return { op: "=", operand: typed };
  const rest = typed.trimStart().slice(1);
  return { op, operand: rest.trimStart() };
}

/**
 * A field's formula in the control's own words, for a helper line that has no
 * menu to show — `Add 30`, `Set to 500`, `Multiply by 2`. Text no verb can
 * show reads back as `Formula` and the expression.
 */
export function describeControl(text: string): string {
  const control = controlOf(text);
  return control.op === null
    ? `${FORMULA_VERB} ${control.operand}`.trim()
    : `${OP_SENTENCE[control.op]} ${control.operand}`;
}
