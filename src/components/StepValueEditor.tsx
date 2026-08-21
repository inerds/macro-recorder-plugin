import { Checkbox, Input, NumberInput } from "@lottiefiles/creator-plugins-ui";

import type { EditableValue } from "../../shared/editing";

export interface StepValueEditorProps {
  value: EditableValue;
  onChange: (value: EditableValue) => void;
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

/**
 * One editor per EditableValue kind, shared by the step rows and the
 * pre-play parameter form. Fully controlled — the caller owns the draft and
 * decides when a change is committed.
 */
export function StepValueEditor({ value, onChange, autoFocus }: StepValueEditorProps) {
  switch (value.kind) {
    case "number":
      // NumberInputProps takes no aria-label; an implicit <label> does it.
      return (
        <label className="flex items-center">
          <span className="sr-only">Value</span>
          <NumberInput
            value={value.value}
            onChange={(next) => onChange({ kind: "number", value: next })}
            decimals={2}
            align="left"
            className="h-6 w-24"
          />
        </label>
      );

    case "boolean":
      return (
        <Checkbox
          checked={value.value}
          onCheckedChange={(next) => onChange({ kind: "boolean", value: next })}
          autoFocus={autoFocus}
          aria-label="Value"
        />
      );

    case "text":
      return (
        <Input
          value={value.value}
          autoFocus={autoFocus}
          className="h-6 min-w-0 flex-1 text-12"
          aria-label="Value"
          onChange={(event) => onChange({ kind: "text", value: event.target.value })}
        />
      );

    case "color": {
      const hex = rgbToHex(value.value);
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          <input
            type="color"
            value={hex}
            autoFocus={autoFocus}
            aria-label="Color"
            className="size-6 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
            onChange={(event) => {
              const rgb = hexToRgb(event.target.value);
              if (rgb) onChange({ kind: "color", value: rgb });
            }}
          />
          <Input
            value={hex}
            aria-label="Hex color"
            spellCheck={false}
            className="h-6 w-24 font-mono text-11 uppercase"
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
          {keys.map((key) => (
            <label key={key} className="flex items-center gap-1">
              <span className="text-10 uppercase text-muted-foreground">{key}</span>
              <NumberInput
                value={value.value[key] ?? 0}
                onChange={(next) =>
                  onChange({
                    kind: "vector",
                    value: { ...value.value, [key]: next },
                  })
                }
                decimals={2}
                align="left"
                className="h-6 w-20"
              />
            </label>
          ))}
        </span>
      );
    }
  }
}
