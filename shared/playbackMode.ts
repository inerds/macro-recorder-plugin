import type { MacroStep } from "./macro";
import type { StepPayload } from "./steps";

/**
 * How a macro will be replayed, derived from its steps alone.
 *
 * This mirrors `chooseMode` in plugin/playback.ts so the UI can say what a
 * macro applies to BEFORE it runs. The sandbox also weighs the live
 * selection; here we describe the selection-present case, which is the one
 * worth explaining ("applies to the selected layers"). Keep the rule in
 * step with plugin/playback.ts#chooseMode.
 */
export interface PlaybackModeDescription {
  mode: "targets" | "scene";
  /** Distinct layers the macro expects to already exist when it runs. */
  layerCount: number;
}

function payloadOf(step: MacroStep): StepPayload | null {
  const payload = step.payload as StepPayload | undefined;
  return payload && typeof payload === "object" && "op" in payload ? payload : null;
}

export function describePlaybackMode(macro: {
  steps: readonly MacroStep[];
}): PlaybackModeDescription {
  const referenced = new Set<string>();
  const createdIds = new Set<string>();
  const cloneSources = new Set<string>();
  let unretargetableSceneOps = false;

  // Disabled steps never reach the sandbox, so they never sway the mode.
  for (const step of macro.steps) {
    if (step.disabled === true) continue;
    const payload = payloadOf(step);
    if (!payload) continue;
    if (payload.op === "add-layer") {
      createdIds.add(payload.spec.nodeId);
      if (payload.cloneOf) cloneSources.add(payload.cloneOf.id);
      else unretargetableSceneOps = true; // fresh layers are scene structure
    } else if (
      payload.op === "remove-layer" ||
      payload.op === "break-scene" ||
      payload.op === "nest-layers" ||
      payload.op === "reorder-layers"
    ) {
      unretargetableSceneOps = true;
    }
    const ref = "layer" in payload ? payload.layer : undefined;
    if (ref) referenced.add(ref.id);
  }

  const preExisting = new Set<string>();
  for (const id of [...referenced, ...cloneSources]) {
    if (!createdIds.has(id)) preExisting.add(id);
  }
  const layerCount = preExisting.size;

  if (!unretargetableSceneOps && layerCount <= 1) return { mode: "targets", layerCount };
  if (unretargetableSceneOps || layerCount > 1 || createdIds.size > 0) {
    return { mode: "scene", layerCount };
  }
  return { mode: "targets", layerCount };
}

/** One-line explanation of what a replay of this macro will touch. */
export function playbackModeHint(description: PlaybackModeDescription): string {
  if (description.mode === "targets") {
    return "Applies to selected layers, or the recorded one";
  }
  return description.layerCount === 1
    ? "Scene script — finds 1 layer by name"
    : `Scene script — finds ${description.layerCount} layers by name`;
}
