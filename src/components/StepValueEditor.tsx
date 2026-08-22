import { Checkbox, Input, NumberInput } from "@lottiefiles/creator-plugins-ui";
import { useEffect, useRef } from "react";

import type { EditableValue } from "../../shared/editing";

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
}

type Rgb = { r: number; g: number; b: number };

function channel(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}

/** Recorded colors are 0-255 per channel (see shared/labels.ts). */
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
  "size-6 shrink-0 cursor-pointer overflow-hidden rounded-sm border border-border bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-[2px] [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:rounded-[2px] [&::-moz-color-swatch]:border-0";

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
}: StepValueEditorProps) {
  // NumberInput and Checkbox both drop `autoFocus`; focus the first field
  // ourselves so an inline edit is typeable the moment it opens.
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!autoFocus) return;
    const field = firstFieldRef.current;
    if (!field) return;
    field.focus();
    if (field.type !== "color" && field.type !== "checkbox") {
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
  }
}
