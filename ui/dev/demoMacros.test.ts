/**
 * The demo macros are seed DATA, not decoration: dev sessions record over
 * them, simplify them, pin them and press Play. This file pins their SHAPE —
 * ids, labels, params, disabled steps, the mode each one will replay in.
 *
 * The replay proof lives in `sandbox/demoMacros.replay.test.ts`, not here: it
 * needs the playback orchestrator, and this project deliberately has no
 * `creator` global (tsconfig.ui.json vs tsconfig.sandbox.json). Changing a
 * macro's steps means re-running both.
 */
import { describe, expect, it } from "vitest";

import { editableValueOf } from "../../engine/editing";
import { describePlaybackMode } from "../../engine/playbackMode";
import { enabledSteps } from "../gateways/types";
import { buildDemoMacros } from "./demoMacros";

const macros = buildDemoMacros(1_700_000_000_000);

describe("demo macros are well-formed", () => {
  it("ships ten macros with unique names and fresh ids on every build", () => {
    expect(macros).toHaveLength(10);
    expect(new Set(macros.map((macro) => macro.name)).size).toBe(10);
    const again = buildDemoMacros(1_700_000_000_000);
    expect(again.map((macro) => macro.id)).not.toEqual(macros.map((macro) => macro.id));
    // ...but the content is stable, so a reload is the same seed set
    expect(again.map((macro) => macro.name)).toEqual(macros.map((macro) => macro.name));
  });

  it("gives every step a kind, a label and a real payload", () => {
    for (const macro of macros) {
      expect(macro.steps.length, macro.name).toBeGreaterThan(0);
      for (const step of macro.steps) {
        expect(step.id, macro.name).toBeTruthy();
        expect(step.kind, macro.name).toBeTruthy();
        expect(step.label, macro.name).toBeTruthy();
        expect(step.payload, macro.name).toHaveProperty("op");
      }
      expect(new Set(macro.steps.map((step) => step.id)).size).toBe(macro.steps.length);
    }
  });

  it("pins params to real, enabled, editable steps", () => {
    const pinned = macros.filter((macro) => macro.params !== undefined);
    expect(pinned.length).toBeGreaterThan(0);
    for (const macro of pinned) {
      for (const param of macro.params!) {
        const step = macro.steps.find((candidate) => candidate.id === param.stepId);
        expect(step, `${macro.name} · ${param.label}`).toBeDefined();
        expect(step!.disabled, `${macro.name} · ${param.label}`).toBeUndefined();
        expect(editableValueOf(step!), `${macro.name} · ${param.label}`).not.toBeNull();
        expect(param.label.length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps disabled steps out of what playback sends", () => {
    const withDisabled = macros.filter((macro) =>
      macro.steps.some((step) => step.disabled === true),
    );
    expect(withDisabled.map((macro) => macro.name)).toEqual([
      "Masked spotlight",
      "Parametric slide",
    ]);
    for (const macro of withDisabled) {
      expect(enabledSteps(macro).length).toBeLessThan(macro.steps.length);
    }
  });

  it("covers both playback modes", () => {
    const modes = Object.fromEntries(
      macros.map((macro) => [macro.name, describePlaybackMode(macro).mode]),
    );
    expect(modes).toEqual({
      "Bounce & settle": "targets",
      "Brand recolor pro": "targets",
      "Cross-kind chaos": "targets",
      "Pop-in duplicates": "targets",
      "Storyboard shuffle": "scene",
      "Nest & break": "scene",
      "Type reveal": "scene",
      "Masked spotlight": "targets",
      "Style stamp": "targets",
      "Parametric slide": "targets",
    });
  });
});

