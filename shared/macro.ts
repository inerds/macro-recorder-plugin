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
  /** true = the user switched this step off; playback skips it. */
  disabled?: true;
}

/** A step whose value the user is asked for on every play (gizmo knob). */
export interface MacroParam {
  stepId: string;
  label: string;
}

export interface Macro {
  id: string;
  name: string;
  createdAt: number;
  steps: MacroStep[];
  /** The recorded layer — replay falls back to it when nothing is selected. */
  source?: { nodeId: string; nodeName?: string };
  /** Steps exposed as parameters on apply (feature 4). */
  params?: MacroParam[];
  /** Default play options a row starts with (newly recorded macros save
   *  `{ atPlayhead: true }`); the row's popover can still change them. */
  playOptions?: { atPlayhead?: boolean; staggerFrames?: number; repeat?: number };
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
  const idMap = new Map<string, string>();
  const steps = source.steps.map((step) => {
    const id = makeId();
    if (typeof step.id === "string") idMap.set(step.id, id);
    const copy: MacroStep = { ...step, id };
    if (copy.disabled !== true) delete copy.disabled;
    return copy;
  });
  const macro: Macro = {
    id: makeId(),
    name: source.name,
    createdAt: Date.now(),
    steps,
  };
  if (Array.isArray(source.params)) {
    // Param pins reference step ids, which were just regenerated — remap.
    const params: MacroParam[] = [];
    for (const param of source.params as unknown[]) {
      if (typeof param !== "object" || param === null) continue;
      const { stepId, label } = param as Record<string, unknown>;
      const mapped = typeof stepId === "string" ? idMap.get(stepId) : undefined;
      if (mapped && typeof label === "string") params.push({ stepId: mapped, label });
    }
    if (params.length > 0) macro.params = params;
  }
  if (
    source.source &&
    typeof source.source === "object" &&
    typeof source.source.nodeId === "string"
  ) {
    macro.source = { ...source.source };
  }
  if (source.playOptions && typeof source.playOptions === "object") {
    const { atPlayhead, staggerFrames, repeat } = source.playOptions as Record<string, unknown>;
    const playOptions: NonNullable<Macro["playOptions"]> = {};
    if (atPlayhead === true) playOptions.atPlayhead = true;
    if (typeof staggerFrames === "number" && staggerFrames > 0)
      playOptions.staggerFrames = staggerFrames;
    if (typeof repeat === "number" && repeat > 1) playOptions.repeat = repeat;
    if (Object.keys(playOptions).length > 0) macro.playOptions = playOptions;
  }
  return macro;
}
