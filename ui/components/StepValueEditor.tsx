import {
  cn,
  Checkbox,
  DropdownContent,
  DropdownItem,
  DropdownRoot,
  DropdownTrigger,
  Input,
  NumberInput,
} from "@lottiefiles/creator-plugins-ui";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type RefObject } from "react";

import type { EditableValue } from "../../engine/editing";
import { parseFormula } from "../../engine/formula";
import {
  absorbLeadingOperator,
  controlOf,
  convertControl,
  divideBlocked,
  FORMULA_VERB,
  multiplyBlocked,
  OP_ORDER,
  OP_TITLES,
  textOf,
  type FormulaControl,
  type FormulaOp,
} from "./formulaControl";

/**
 * The sr-only legend for a formula row. The verb button names the action a
 * word at a time, and this is the distinction the whole menu draws — set a
 * value, or change the one that is there. The always-visible sentence it
 * replaced said what `v` was, which is a fact the user no longer has to know:
 * `v` is on no menu item.
 */
export const FORMULA_LEGEND = "Set exactly, or change the current value";

/** The example a box in raw-expression mode shows when it is empty. */
export const FORMULA_PLACEHOLDER = "v + 10";

/**
 * What is wrong with each formula field that does not parse, keyed the way
 * the fields are. Empty for a value of any other kind.
 *
 * Per field, because `aria-invalid` belongs on the box that is actually
 * wrong: a vector whose `y` refuses must not mark `x` invalid too.
 */
export function formulaFieldErrors(
  value: EditableValue | null | undefined,
): Record<string, string> {
  if (!value || value.kind !== "formula") return {};
  const out: Record<string, string> = {};
  for (const [key, text] of Object.entries(value.fields)) {
    const parsed = parseFormula(text);
    if (!parsed.ok) out[key] = parsed.error;
  }
  return out;
}

/**
 * The first field that does not parse, and what is wrong with it — null when
 * every field parses, and for every other value kind.
 *
 * The editor is fully controlled, so the caller owns the draft and the caller
 * is the one that refuses to save it. One function, so the line under the
 * fields and the blocked save can never disagree.
 */
export function formulaError(value: EditableValue | null | undefined): string | null {
  if (!value || value.kind !== "formula") return null;
  const errors = formulaFieldErrors(value);
  for (const key of Object.keys(value.fields)) {
    if (errors[key] !== undefined) return errors[key]!;
  }
  return null;
}

export interface StepValueEditorProps {
  value: EditableValue;
  onChange: (value: EditableValue) => void;
  /**
   * Accessible name for the value. Rendered sr-only for the kinds that have
   * no visible label of their own — unless `id` is given, in which case the
   * caller's own <label htmlFor> names the field.
   */
  label: string;
  /** Bound to the first field so an external <label htmlFor> can target it. */
  id?: string;
  autoFocus?: boolean;
  /**
   * True while a formula row's verb menu is open. The menu is portalled, so
   * focus leaves the editor's own subtree to reach it — a host that commits
   * on blur (StepRow) has to know that this one is not the user moving on.
   */
  onMenuOpenChange?: (open: boolean) => void;
}

type Rgb = { r: number; g: number; b: number };

function channel(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, "0");
}

/** Recorded colors are 0-255 per channel (see engine/labels.ts). */
export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Accepts "#rgb" and "#rrggbb", with or without the hash. Null when unparseable. */
export function hexToRgb(hex: string): Rgb | null {
  const raw = hex.trim().replace(/^#/, "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

const SWATCH_CLASS =
  "size-6 shrink-0 cursor-pointer overflow-hidden rounded border border-border bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-[3px] [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:rounded-[3px] [&::-moz-color-swatch]:border-0";

/**
 * One editor per EditableValue kind, shared by the step rows and the
 * pre-play parameter form. Fully controlled — the caller owns the draft and
 * decides when a change is committed.
 */
export function StepValueEditor({
  value,
  onChange,
  label,
  id,
  autoFocus,
  onMenuOpenChange,
}: StepValueEditorProps) {
  // NumberInput and Checkbox both drop `autoFocus`; focus the first field
  // ourselves so an inline edit is typeable the moment it opens.
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  // The formula rows carry an sr-only legend for the row group and, when a
  // field refuses, one error line under them. Both need ids the markup can
  // point back at.
  const helpPrefix = useId();
  const legendId = `${helpPrefix}-legend`;
  const errorId = `${helpPrefix}-error`;

  useEffect(() => {
    if (!autoFocus) return;
    const field = firstFieldRef.current;
    if (!field) return;
    field.focus();
    if (field.type === "color") {
      // A color field's first move is always the picker — pop it open so
      // "set a color, play" is one gesture. showPicker() needs transient
      // user activation and refuses in cross-origin iframes; when it
      // declines (e.g. inside Creator), the focused swatch still opens on
      // Enter/Space, so failure costs nothing.
      try {
        field.showPicker?.();
      } catch {
        // focus alone is the fallback
      }
    } else if (field.type !== "checkbox") {
      field.select?.();
    }
  }, [autoFocus, value.kind]);

  switch (value.kind) {
    case "number":
      // NumberInputProps takes no aria-label; an implicit <label> does it.
      return (
        <label className="flex items-center">
          {!id && <span className="sr-only">{label}</span>}
          <NumberInput
            ref={firstFieldRef}
            {...(id ? { id } : {})}
            value={value.value}
            onChange={(next) => onChange({ kind: "number", value: next })}
            decimals={2}
            className="mono h-6 w-24"
          />
        </label>
      );

    case "boolean":
      return (
        <Checkbox
          {...(id ? { id } : {})}
          ref={(node) => {
            firstFieldRef.current = (node as HTMLInputElement | null) ?? null;
          }}
          checked={value.value}
          onCheckedChange={(next) => onChange({ kind: "boolean", value: next })}
          aria-label={label}
        />
      );

    case "text":
      return (
        <Input
          ref={firstFieldRef}
          {...(id ? { id } : {})}
          value={value.value}
          className="h-6 min-w-0 text-12"
          aria-label={label}
          onChange={(event) => onChange({ kind: "text", value: event.target.value })}
        />
      );

    case "color": {
      const hex = rgbToHex(value.value);
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          <input
            ref={firstFieldRef}
            {...(id ? { id } : {})}
            type="color"
            value={hex}
            aria-label={label}
            className={SWATCH_CLASS}
            onChange={(event) => {
              const rgb = hexToRgb(event.target.value);
              if (rgb) onChange({ kind: "color", value: rgb });
            }}
          />
          <Input
            value={hex}
            aria-label={`${label} — hex`}
            spellCheck={false}
            className="mono h-6 w-24 text-11 uppercase"
            onChange={(event) => {
              const rgb = hexToRgb(event.target.value);
              if (rgb) onChange({ kind: "color", value: rgb });
            }}
          />
        </span>
      );
    }

    case "vector": {
      const keys = Object.keys(value.value);
      return (
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {keys.map((key, index) => (
            <label key={key} className="flex min-w-0 items-center gap-1">
              <span className="instrument">
                {key}
                <span className="sr-only"> {label}</span>
              </span>
              <NumberInput
                {...(index === 0 ? { ref: firstFieldRef } : {})}
                {...(index === 0 && id ? { id } : {})}
                value={value.value[key] ?? 0}
                onChange={(next) =>
                  onChange({
                    kind: "vector",
                    value: { ...value.value, [key]: next },
                  })
                }
                decimals={2}
                className="mono h-6 w-16 min-w-0"
              />
            </label>
          ))}
        </span>
      );
    }

    case "formula": {
      const keys = Object.keys(value.fields);
      // A scalar property holds one unnamed term; a vector holds one per
      // component, and the component name is what tells the two rows apart.
      const scalar = keys.length === 1 && keys[0] === "value";
      // Per field, so the box that is actually wrong is the one marked
      // invalid — the line below says what is wrong with the first of them.
      const failed = formulaFieldErrors(value);
      const error = formulaError(value);
      return (
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span id={legendId} className="sr-only">
            {FORMULA_LEGEND}
          </span>
          {keys.map((key, index) => (
            <FormulaRow
              key={key}
              {...(scalar ? {} : { name: key })}
              label={scalar ? label : `${key} ${label}`}
              text={value.fields[key] ?? ""}
              at={value.at?.[key]}
              legendId={legendId}
              {...(error ? { describedBy: errorId } : {})}
              invalid={failed[key] !== undefined}
              {...(index === 0 ? { inputRef: firstFieldRef } : {})}
              {...(index === 0 && id ? { id } : {})}
              {...(onMenuOpenChange ? { onMenuOpenChange } : {})}
              onText={(next) =>
                // `at` travels with the value: it is the editor's anchor, and
                // dropping it here would make an untouched parameter look
                // edited to `applyParamValues`.
                onChange({ ...value, fields: { ...value.fields, [key]: next } })
              }
            />
          ))}
          {/* Muted, never red: red on this panel means an action or a
              failure, and an unfinished expression is neither. Shown only
              when a field refuses — the verb says what the control does, so
              there is no standing sentence under it. */}
          {error && (
            <p id={errorId} className="text-11 text-muted-foreground">
              {error}
            </p>
          )}
        </span>
      );
    }
  }
}

/** Why a verb is off. Both cases are a 0 the arithmetic cannot come back from. */
function blockedTitle(op: FormulaOp, at: number | undefined): string {
  if (at === 0) return op === "*" ? "Can't multiply from 0" : "Can't divide from 0";
  return "Can't divide to 0";
}

interface FormulaRowProps {
  /** The component's name (`x`, `y`); absent on a scalar property's one row. */
  name?: string;
  /** Accessible name for the row group and the box. */
  label: string;
  /** The field's stored text, in engine grammar. */
  text: string;
  /** The recorded value `v` stood for, for converting between the verbs. */
  at?: number;
  legendId: string;
  /** The error line, while there is one. */
  describedBy?: string;
  invalid: boolean;
  /** Set on the first row when the caller's own <label htmlFor> names it. */
  id?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  onText: (text: string) => void;
  /** Raised while the verb menu is open; see StepValueEditorProps. */
  onMenuOpenChange?: (open: boolean) => void;
}

/**
 * One component's control: a verb and one number box over one stored string.
 *
 * The verb is derived from that string, not stored beside it, so a formula
 * that came back from the engine names what it does. Two pieces of local
 * state sit on top of that derivation:
 *
 * - `draft`, the control the user last acted on, kept only while it still
 *   spells exactly what is stored: without it, clearing the box under `Add`
 *   would store a blank field, read back as Formula, and change the verb
 *   under the user's own cursor.
 * - `raw`, set by the Formula item. A user who asks for the expression box
 *   over `v + 30` keeps it, even though `Add` could show that text.
 */
function FormulaRow({
  name,
  label,
  text,
  at,
  legendId,
  describedBy,
  invalid,
  id,
  inputRef,
  onText,
  onMenuOpenChange,
}: FormulaRowProps) {
  const [draft, setDraft] = useState<FormulaControl | null>(null);
  const [raw, setRaw] = useState(false);
  const derived = controlOf(text);
  const shown = raw
    ? { op: null, operand: text }
    : draft !== null && draft.op !== null && textOf(draft.op, draft.operand) === text
      ? draft
      : derived;

  const write = (next: FormulaControl) => {
    setDraft(next.op === null ? null : next);
    // A verb the box itself produced — a typed `*2` — takes the row back out
    // of the expression box.
    setRaw(next.op === null);
    onText(next.op === null ? next.operand : textOf(next.op, next.operand));
  };

  const offMultiply = multiplyBlocked(at);
  const offDivide = divideBlocked(shown, at);

  /**
   * One menu item: the verb, with a check on the one that is in force.
   * `blocked` is the reason the arithmetic cannot reach it, when it cannot.
   */
  const item = (
    key: string,
    verb: string,
    current: boolean,
    choose: () => void,
    blocked?: string,
  ) => (
    <DropdownItem
      key={key}
      // aria-disabled, not the library's `disabled`: that one sets
      // `pointer-events: none`, which takes the title — the reason — with it.
      {...(blocked ? { "aria-disabled": true, title: blocked } : {})}
      {...(blocked ? { className: "cursor-default opacity-50" } : {})}
      onSelect={() => {
        if (blocked) return;
        choose();
      }}
    >
      <Check className={cn("size-3", !current && "invisible")} strokeWidth={2.5} aria-hidden />
      {verb}
    </DropdownItem>
  );

  return (
    <span
      className="flex min-w-0 items-center gap-1.5"
      role="group"
      aria-label={label}
      aria-describedby={legendId}
    >
      {name !== undefined && (
        // A fixed column so a vector's two rows line their verbs up. The name
        // is in the group's and the box's accessible names already.
        <span className="instrument w-[10px] shrink-0" aria-hidden>
          {name}
        </span>
      )}
      <DropdownRoot {...(onMenuOpenChange ? { onOpenChange: onMenuOpenChange } : {})}>
        {/* The button's text IS its accessible name; the group beside it
            carries the component and the step. */}
        <DropdownTrigger className="press key-verb shrink-0">
          <span>{shown.op === null ? FORMULA_VERB : OP_TITLES[shown.op]}</span>
          <ChevronDown aria-hidden />
        </DropdownTrigger>
        <DropdownContent align="start" sideOffset={4} className="min-w-32">
          {OP_ORDER.map((op) => {
            const off = (op === "*" && offMultiply) || (op === "/" && offDivide);
            return item(
              op,
              OP_TITLES[op],
              shown.op === op,
              () => write(convertControl(shown.op, op, shown.operand, at)),
              off ? blockedTitle(op, at) : undefined,
            );
          })}
          {/* The expression the verbs were hiding, in the box: what is stored
              already IS engine grammar, so there is nothing to convert. */}
          {item("formula", `${FORMULA_VERB}…`, shown.op === null, () => {
            setDraft(null);
            setRaw(true);
          })}
        </DropdownContent>
      </DropdownRoot>
      <Input
        {...(inputRef ? { ref: inputRef } : {})}
        {...(id ? { id } : {})}
        value={shown.op === null ? text : shown.operand}
        // The box holds a number: the verb took the operator, so a decimal
        // keypad now offers everything it takes. Autocorrect stays off for
        // the expression mode, where a `v` must survive a phone keyboard.
        inputMode="decimal"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        {...(shown.op === null ? { placeholder: FORMULA_PLACEHOLDER } : {})}
        {...(id ? {} : { "aria-label": label })}
        {...(describedBy ? { "aria-describedby": describedBy } : {})}
        {...(invalid ? { "aria-invalid": true } : {})}
        // 64px for an operand — the 80px verb and the box still fit beside
        // the X column at 300px. A whole expression gets the rest of the
        // line, because `v * 2 + 10` does not fit in an operand's box.
        className={cn(
          // `.mono` already sets tabular figures; a utility beside it would
          // say the same thing twice.
          "mono h-6 text-12",
          shown.op === null ? "min-w-[72px] flex-1" : "w-16 min-w-0",
        )}
        onChange={(event) => write(absorbLeadingOperator(event.target.value, shown.op))}
      />
    </span>
  );
}
