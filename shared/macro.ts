import type { StepKind } from "./steps";

export interface MacroStep {
  id: string;
  kind: StepKind;
  /** Human-readable label, e.g. "Transform · position.x 100 → 200" */
  label: string;
  /** StepPayload for real recordings; opaque for mocks. */
  payload: unknown;
  /** false = observable but the plugin API cannot replay it (e.g. reorder). */
  replayable?: false;
}

export interface Macro {
  id: string;
  name: string;
  createdAt: number;
  steps: MacroStep[];
  /** The recorded layer — replay falls back to it when nothing is selected. */
  source?: { nodeId: string; nodeName?: string };
}

const STEP_KINDS: readonly string[] = [
  "transform",
  "fill",
  "stroke",
  "keyframe",
  "layer",
  "shape",
  "mask",
  "other",
];

function isMacroStepShape(value: unknown): value is Omit<MacroStep, "id"> {
  if (typeof value !== "object" || value === null) return false;
  const step = value as Record<string, unknown>;
  return typeof step.label === "string" && STEP_KINDS.includes(step.kind as string);
}

export function isMacroShape(value: unknown): value is Omit<Macro, "id"> {
  if (typeof value !== "object" || value === null) return false;
  const macro = value as Record<string, unknown>;
  return (
    typeof macro.name === "string" &&
    macro.name.length > 0 &&
    Array.isArray(macro.steps) &&
    macro.steps.every(isMacroStepShape)
  );
}

/**
 * Parses exported macro JSON, regenerating ids. Throws user-facing errors.
 * Tolerates v1 exports: a legacy `mode` field is discarded (playback now has
 * one semantics), and v1 payload ops still replay.
 */
export function parseImportedMacro(json: string, makeId: () => string): Macro {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Not a valid JSON file");
  }
  if (!isMacroShape(parsed)) {
    throw new Error("File is not a valid macro");
  }
  const source = parsed as Macro & { mode?: unknown };
  const macro: Macro = {
    id: makeId(),
    name: source.name,
    createdAt: Date.now(),
    steps: source.steps.map((step) => ({ ...step, id: makeId() })),
  };
  if (
    source.source &&
    typeof source.source === "object" &&
    typeof source.source.nodeId === "string"
  ) {
    macro.source = { ...source.source };
  }
  return macro;
}
