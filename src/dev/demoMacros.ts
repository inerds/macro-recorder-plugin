import type { Macro } from "../../shared/macro";
import { buildStep, type StepPayload } from "../../shared/steps";
import { newId } from "../utils/id";

/**
 * Demo macros for dev sessions. Built from REAL StepPayloads through the same
 * `buildStep` a recording uses, so they replay (targets mode — one recorded
 * layer each), simplify, edit and pin exactly like captured macros do. Keep
 * them on `buildStep`: hand-written labels with empty payloads only look
 * right until someone presses Play.
 */
const LAYER = { id: "demo-layer", name: "Rectangle 1" };

const DEMO_SCRIPTS: Array<{ name: string; steps: StepPayload[] }> = [
  {
    name: "Bounce in",
    steps: [
      { op: "set-static", path: ["position"], before: { x: 100, y: 120 }, after: { x: 100, y: 0 }, layer: LAYER },
      { op: "keyframes", path: ["position"], added: [{ frame: 0, value: { x: 100, y: 0 } }, { frame: 30, value: { x: 100, y: 120 } }], removed: [], changed: [], layer: LAYER },
      { op: "keyframes", path: ["opacity"], added: [{ frame: 0, value: 0 }, { frame: 20, value: 100 }], removed: [], changed: [], layer: LAYER },
    ],
  },
  {
    name: "Brand recolor with a very long name that truncates",
    steps: [
      { op: "set-static", path: ["fills", 0, "color"], before: { r: 40, g: 40, b: 40 }, after: { r: 255, g: 90, b: 0 }, layer: LAYER },
      { op: "set-static", path: ["strokes", 0, "color"], before: { r: 0, g: 0, b: 0 }, after: { r: 0, g: 43, b: 73 }, layer: LAYER },
      { op: "set-static", path: ["strokes", 0, "width"], before: 2, after: 3, layer: LAYER },
    ],
  },
  {
    name: "Spin + fade",
    steps: [
      { op: "set-static", path: ["rotation"], before: 0, after: 360, layer: LAYER },
      { op: "keyframes", path: ["rotation"], added: [{ frame: 0, value: 0 }, { frame: 60, value: 360 }], removed: [], changed: [], layer: LAYER },
      { op: "keyframes", path: ["opacity"], added: [{ frame: 60, value: 0 }], removed: [], changed: [], layer: LAYER },
      { op: "set-plain", path: ["visible"], before: true, after: false, layer: LAYER },
    ],
  },
];

/** Fresh ids on every call so repeated loads never collide in the store. */
export function buildDemoMacros(now = Date.now()): Macro[] {
  return DEMO_SCRIPTS.map((script, index) => ({
    id: newId(),
    name: script.name,
    // Staggered so the list's newest-first order is stable.
    createdAt: now - (DEMO_SCRIPTS.length - index) * 60_000,
    steps: script.steps.map(buildStep),
    source: { nodeId: LAYER.id, nodeName: LAYER.name },
  }));
}
