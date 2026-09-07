/**
 * Step formulas — the arithmetic a user types into a transform step's box.
 *
 * One input per component. `v` is the target's current value. A plain
 * number sets the value; `v + 10` shifts it; `v * 2` scales it; `v * 2 + 10`
 * does both. Every expression that is linear in `v` reduces to one pair,
 * `target = scale × v + offset` (`LinearTerm`), and the pair is what a step
 * stores — so "exact", "add", and "multiply" are three points in one space
 * rather than three operators. Anything not linear in `v` (`v * v`,
 * `10 / v`) is refused, as are division by zero, unknown names, and empty
 * input. No references to other properties, layers, or the scene.
 *
 * Pure: text and payloads in, terms out.
 */
import type { Json } from "./json";
import { explicitFormulaOf, hasZeroComponent, operatorEligible, payloadClass } from "./operator";

export { explicitFormulaOf };
import type { Path } from "./snapshot";
import type { LinearTerm, StepFormula, StepPayload } from "./steps";

export const formulaEligible: (path: Path) => boolean = operatorEligible;

export type ParseResult = { ok: true; term: LinearTerm } | { ok: false; error: string };

/** The messages the editor shows. One line each; never a stack trace. */
export const FORMULA_ERRORS = {
  empty: "Enter a value",
  syntax: "Use numbers, v, + - * / and ( )",
  nonLinear: "Only v times a number — v × v isn't linear",
  divideByZero: "Can't divide by zero",
  divideByV: "Can't divide by v",
  tooLong: "Keep it under 200 characters",
} as const;

/**
 * The longest expression the box accepts. A formula a human writes is a few
 * characters; a pasted document is not, and a recursive-descent parser walks
 * one stack frame per nested `(`, so a few thousand of them would overflow
 * the stack instead of returning a refusal. The cap keeps the parser inside
 * a depth every engine handles.
 */
const MAX_LENGTH = 200;

/** The name the current value goes by in the box, plus its long form. */
const VALUE_NAMES = new Set(["v", "current"]);

/** A polynomial in v of degree ≤ 1: a·v + b. */
interface Poly {
  a: number;
  b: number;
}

type Token =
  | { kind: "number"; value: number }
  | { kind: "name"; name: string }
  | { kind: "op"; op: "+" | "-" | "*" | "/" | "(" | ")" };

class FormulaError extends Error {}

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === " " || ch === "\t") {
      i += 1;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "(" || ch === ")") {
      out.push({ kind: "op", op: ch });
      i += 1;
      continue;
    }
    // Typographic operators a user may paste from a label.
    if (ch === "×") {
      out.push({ kind: "op", op: "*" });
      i += 1;
      continue;
    }
    if (ch === "−") {
      out.push({ kind: "op", op: "-" });
      i += 1;
      continue;
    }
    if ((ch >= "0" && ch <= "9") || ch === ".") {
      let j = i;
      while (j < text.length && ((text[j]! >= "0" && text[j]! <= "9") || text[j] === ".")) j += 1;
      const value = Number(text.slice(i, j));
      if (!Number.isFinite(value)) throw new FormulaError(FORMULA_ERRORS.syntax);
      out.push({ kind: "number", value });
      i = j;
      continue;
    }
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")) {
      let j = i;
      while (j < text.length && /[A-Za-z]/.test(text[j]!)) j += 1;
      const name = text.slice(i, j).toLowerCase();
      if (!VALUE_NAMES.has(name)) throw new FormulaError(FORMULA_ERRORS.syntax);
      out.push({ kind: "name", name: "v" });
      i = j;
      continue;
    }
    throw new FormulaError(FORMULA_ERRORS.syntax);
  }
  return out;
}

/**
 * Recursive descent over the usual precedence: sums of products of unary
 * factors. Each level returns a Poly; `*` and `/` check linearity.
 */
class Parser {
  private at = 0;
  private readonly tokens: Token[];

  // A plain field, not a constructor parameter property: the build runs with
  // `erasableSyntaxOnly`, which refuses the shorthand.
  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): Poly {
    const poly = this.sum();
    if (this.at < this.tokens.length) throw new FormulaError(FORMULA_ERRORS.syntax);
    return poly;
  }

  private peek(): Token | undefined {
    return this.tokens[this.at];
  }

  private takeOp(...ops: string[]): string | undefined {
    const tok = this.peek();
    if (tok && tok.kind === "op" && ops.includes(tok.op)) {
      this.at += 1;
      return tok.op;
    }
    return undefined;
  }

  private sum(): Poly {
    let left = this.product();
    for (;;) {
      const op = this.takeOp("+", "-");
      if (!op) return left;
      const right = this.product();
      left =
        op === "+"
          ? { a: left.a + right.a, b: left.b + right.b }
          : { a: left.a - right.a, b: left.b - right.b };
    }
  }

  private product(): Poly {
    let left = this.unary();
    for (;;) {
      const op = this.takeOp("*", "/");
      if (!op) return left;
      const right = this.unary();
      if (op === "*") {
        // Linear × linear is quadratic unless one side is a constant.
        if (left.a !== 0 && right.a !== 0) throw new FormulaError(FORMULA_ERRORS.nonLinear);
        left =
          left.a === 0
            ? { a: left.b * right.a, b: left.b * right.b }
            : { a: left.a * right.b, b: left.b * right.b };
      } else {
        if (right.a !== 0) throw new FormulaError(FORMULA_ERRORS.divideByV);
        if (right.b === 0) throw new FormulaError(FORMULA_ERRORS.divideByZero);
        left = { a: left.a / right.b, b: left.b / right.b };
      }
    }
  }

  private unary(): Poly {
    if (this.takeOp("-")) {
      const inner = this.unary();
      return { a: -inner.a, b: -inner.b };
    }
    if (this.takeOp("+")) return this.unary();
    return this.atom();
  }

  private atom(): Poly {
    const tok = this.peek();
    if (!tok) throw new FormulaError(FORMULA_ERRORS.syntax);
    if (tok.kind === "number") {
      this.at += 1;
      return { a: 0, b: tok.value };
    }
    if (tok.kind === "name") {
      this.at += 1;
      return { a: 1, b: 0 };
    }
    if (tok.kind === "op" && tok.op === "(") {
      this.at += 1;
      const inner = this.sum();
      if (!this.takeOp(")")) throw new FormulaError(FORMULA_ERRORS.syntax);
      return inner;
    }
    throw new FormulaError(FORMULA_ERRORS.syntax);
  }
}

/** Parse one component's text into its term, or say what is wrong with it. */
export function parseFormula(text: string): ParseResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, error: FORMULA_ERRORS.empty };
  if (trimmed.length > MAX_LENGTH) return { ok: false, error: FORMULA_ERRORS.tooLong };
  try {
    const poly = new Parser(tokenize(trimmed)).parse();
    if (!Number.isFinite(poly.a) || !Number.isFinite(poly.b)) {
      return { ok: false, error: FORMULA_ERRORS.syntax };
    }
    // Unary minus on a constant leaves a −0 scale behind; a term is a pair
    // of plain numbers, so normalise it.
    return {
      ok: true,
      term: { scale: poly.a === 0 ? 0 : poly.a, offset: poly.b === 0 ? 0 : poly.b },
    };
  } catch (error) {
    if (error instanceof FormulaError) return { ok: false, error: error.message };
    // A stack overflow from deep nesting is the input's fault, not a bug to
    // crash the panel with. The length cap above makes this unreachable on
    // every engine we know; it stays as the belt.
    if (error instanceof RangeError) return { ok: false, error: FORMULA_ERRORS.syntax };
    throw error;
  }
}

/**
 * Display rounding for the box: two decimals, the same as every other number
 * the panel prints (`round2` in engine/labels.ts, the number fields' own
 * `decimals={2}`). A third decimal on a converted ratio is noise the user
 * did not type.
 */
const DECIMALS = 2;

/**
 * The most digits a box ever shows. Past this the number is noise, and the
 * box has to end somewhere.
 */
const MAX_DECIMALS = 10;

/** The scale values `formatFormula` writes as a word rather than a number. */
const SCALE_LANDMARKS = [0, 1, -1] as const;
const OFFSET_LANDMARKS = [0] as const;

function roundTo(n: number, digits: number): number {
  // toFixed hands back exponent notation above 1e21; Number reads it back.
  return Number(n.toFixed(digits));
}

/**
 * `n` rounded for display without changing what it MEANS.
 *
 * Two decimals is the display precision. A value that two decimals would
 * flatten onto a landmark it is not — a 0.00004 scale onto 0, which turns a
 * multiply into a set; a 1.00001 scale onto 1, which drops the multiply; a
 * 0.00004 offset onto 0, which drops the shift — gets more digits instead,
 * up to ten. Rounding is allowed to lose precision; it is not allowed to
 * lose the arithmetic.
 *
 * Exported because the step control (`ui/components/formulaControl.ts`)
 * prints its own operands and has to obey the same rule.
 */
export function roundKeepingMeaning(n: number, landmarks: readonly number[]): number {
  for (let digits = DECIMALS; digits <= MAX_DECIMALS; digits += 1) {
    const rounded = roundTo(n, digits);
    if (rounded === n || !landmarks.includes(rounded)) return rounded;
  }
  return roundTo(n, MAX_DECIMALS);
}

/**
 * An exponent-form number spelled out in plain digits: `1e+21` becomes
 * `1000000000000000000000`, `1e-7` becomes `0.0000001`. The box round-trips
 * through `parseFormula`, whose tokenizer reads digits and a point and
 * nothing else — `e` would refuse as an unknown name. Exported because the
 * step control (`ui/components/formulaControl.ts`) prints its own operands
 * and has to obey the same rule.
 */
export function expandExponent(text: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(text);
  if (!match) return text;
  const sign = match[1] ?? "";
  const int = match[2]!;
  const frac = match[3] ?? "";
  const exponent = Number(match[4]);
  const digits = int + frac;
  if (exponent >= 0) {
    const point = int.length + exponent;
    return point >= digits.length
      ? `${sign}${digits}${"0".repeat(point - digits.length)}`
      : `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  const zeros = -exponent - int.length;
  return `${sign}0.${"0".repeat(Math.max(0, zeros))}${digits}`;
}

/** A number the box can show and the parser can read back. Never `1e+21`. */
function num(n: number): string {
  if (n === 0) return "0";
  const text = String(n);
  return text.includes("e") || text.includes("E") ? expandExponent(text) : text;
}

/**
 * Parser-readable text for a term: `100`, `v + 10`, `v - 5`, `v * 2`,
 * `v * 2 + 10`, `v * 0.5 - 3`, `-v + 10`. A 1 scale and a 0 offset are
 * left out, so the box shows what the user would have typed.
 *
 * Both numbers are rounded FIRST and the shorthands read the rounded pair,
 * so what the box drops is what the box would have printed — a term is never
 * rounded onto a `v` it does not mean.
 */
export function formatFormula(term: LinearTerm): string {
  const scale = roundKeepingMeaning(term.scale, SCALE_LANDMARKS);
  const offset = roundKeepingMeaning(term.offset, OFFSET_LANDMARKS);
  if (scale === 0) return num(offset);
  const head = scale === 1 ? "v" : scale === -1 ? "-v" : `v * ${num(scale)}`;
  if (offset === 0) return head;
  return offset < 0 ? `${head} - ${num(-offset)}` : `${head} + ${num(offset)}`;
}

export function evalTerm(term: LinearTerm, current: number): number {
  return term.scale * current + term.offset;
}

/**
 * A value a formula can run on component by component: an object whose every
 * value is a number. The applier asks the same question before it reads a
 * live property, so a `{x: 10, y: null}` the host hands back is refused in
 * one place rather than half-applied in another.
 */
export function isNumberRecord(value: Json): value is Record<string, number> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === "number")
  );
}

/** True when `formula` is one term rather than a per-component record. */
export function isScalarFormula(formula: StepFormula): formula is LinearTerm {
  return typeof (formula as LinearTerm).scale === "number";
}

/**
 * A formula that writes the target's own value back — plain `v` on every
 * component. A step spelling it does nothing, whatever its recorded values
 * say, which is what lets Simplify drop it.
 */
export function isIdentityFormula(formula: StepFormula): boolean {
  const identity = (term: LinearTerm) => term.scale === 1 && term.offset === 0;
  return isScalarFormula(formula)
    ? identity(formula)
    : Object.values(formula).every((term) => identity(term));
}

/**
 * The default term a component would replay with when the step carries no
 * formula: the path's class, with the identity heuristic already applied
 * by `payloadClass`. `add` is `after − before`, `multiply` is
 * `after ÷ before`, `exact` is `after`. A multiply from 0 is exact
 * (`payloadClass` already says so).
 */
function defaultTerm(payload: StepPayload, before: number, after: number): LinearTerm {
  const cls = payloadClass(payload);
  if (cls === "additive") return { scale: 1, offset: after - before };
  if (cls === "multiplicative") return { scale: after / before, offset: 0 };
  return { scale: 0, offset: after };
}

/**
 * What each component of a step means right now: its explicit formula, or
 * the default derived from the recorded values. Undefined when the step
 * takes no formula (a deep path, a non-transform op). A keyframes step
 * with no explicit formula defaults per class from its lowest-frame
 * value, which is the origin the relative math anchors to.
 */
export function termsOf(payload: StepPayload): StepFormula | undefined {
  if (payload.op !== "set-static" && payload.op !== "keyframes") return undefined;
  if (!formulaEligible(payload.path)) return undefined;
  const explicit = explicitFormulaOf(payload);
  if (explicit) return explicit;
  if (payload.op === "keyframes") {
    // A keyframes step's default is a class, not a value; the relative math
    // shifts every keyframe by (target − origin). "v" alone is the honest
    // box contents: relative, unchanged.
    return { scale: 1, offset: 0 };
  }
  const { before, after } = payload;
  if (typeof before === "number" && typeof after === "number") {
    return before === 0 && payloadClass(payload) === "multiplicative"
      ? { scale: 0, offset: after }
      : defaultTerm(payload, before, after);
  }
  if (isNumberRecord(before) && isNumberRecord(after)) {
    const out: Record<string, LinearTerm> = {};
    const zeroSomewhere = hasZeroComponent(before) && payloadClass(payload) === "multiplicative";
    for (const key of Object.keys(after)) {
      const b = before[key];
      const a = after[key]!;
      out[key] =
        b === undefined || zeroSomewhere ? { scale: 0, offset: a } : defaultTerm(payload, b, a);
    }
    return out;
  }
  return undefined;
}

/** The term for one component of a formula (a scalar formula ignores the key). */
export function termFor(formula: StepFormula, key: string): LinearTerm | undefined {
  return isScalarFormula(formula) ? formula : formula[key];
}

/**
 * Apply a formula to a current value: a number in, a number out; a vector
 * in, each numeric component through its own term (a component without a
 * term passes through). Non-numeric input passes through untouched.
 */
export function applyFormula(formula: StepFormula, current: Json): Json {
  if (typeof current === "number") {
    const term = isScalarFormula(formula) ? formula : undefined;
    return term ? evalTerm(term, current) : current;
  }
  if (isNumberRecord(current)) {
    const out: Record<string, number> = { ...current };
    for (const key of Object.keys(current)) {
      const term = termFor(formula, key);
      if (term) out[key] = evalTerm(term, current[key]!);
    }
    return out;
  }
  return current;
}
