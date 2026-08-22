import { buildStep, type StepPayload } from "../../shared/steps";
import type { MacroStep } from "../types";
import type { RecorderGateway } from "./types";

export type RecorderScenario = "burst" | "long" | "silent";

const LAYER = { id: "mock-layer", name: "Rectangle 1" };

/**
 * Real StepPayloads (labels come from the same `buildStep` as production),
 * so demo mode exercises Simplify (two consecutive position edits), step
 * editing and parameter pins exactly as a recording would.
 */
const BURST_SCRIPT: StepPayload[] = [
  { op: "set-static", path: ["position"], before: { x: 100, y: 120 }, after: { x: 160, y: 120 }, layer: LAYER },
  { op: "set-static", path: ["position"], before: { x: 160, y: 120 }, after: { x: 200, y: 120 }, layer: LAYER },
  { op: "set-static", path: ["rotation"], before: 0, after: 45, layer: LAYER },
  { op: "set-static", path: ["fills", 0, "color"], before: { r: 40, g: 40, b: 40 }, after: { r: 255, g: 90, b: 0 }, layer: LAYER },
  { op: "keyframes", path: ["position"], added: [{ frame: 60, value: { x: 200, y: 120 } }], removed: [], changed: [], layer: LAYER },
  { op: "set-static", path: ["strokes", 0, "width"], before: 2, after: 4, layer: LAYER },
  { op: "set-plain", path: ["visible"], before: true, after: false, layer: LAYER },
];

const LONG_SCRIPT: StepPayload[] = Array.from({ length: 20 }, (_, i) => {
  const cycle: StepPayload[] = [
    { op: "set-static", path: ["position"], before: { x: 100 + i * 10, y: 120 }, after: { x: 110 + i * 10, y: 120 }, layer: LAYER },
    { op: "set-static", path: ["fills", 0, "color"], before: { r: i * 12, g: 80, b: 120 }, after: { r: i * 12 + 12, g: 80, b: 120 }, layer: LAYER },
    { op: "keyframes", path: ["scale"], added: [{ frame: i * 5, value: { x: 1, y: 1 } }], removed: [], changed: [], layer: LAYER },
    { op: "set-static", path: ["strokes", 0, "width"], before: i, after: i + 1, layer: LAYER },
  ];
  return cycle[i % cycle.length]!;
});

/**
 * Emits scripted steps on a timer while "recording" so the UI's recording
 * state is fully demonstrable without the Creator API.
 */
export class MockRecorderGateway implements RecorderGateway {
  private listeners = new Set<(step: MacroStep) => void>();
  private captured: MacroStep[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  private scenario: RecorderScenario;
  private intervalMs: number;

  constructor(scenario: RecorderScenario = "burst", intervalMs = 800) {
    this.scenario = scenario;
    this.intervalMs = intervalMs;
  }

  setScenario(scenario: RecorderScenario) {
    this.scenario = scenario;
  }

  async start(): Promise<null> {
    this.captured = [];
    if (this.scenario === "silent") return null;
    const script = this.scenario === "long" ? LONG_SCRIPT : BURST_SCRIPT;
    let index = 0;
    this.timer = setInterval(() => {
      const step = buildStep(script[index % script.length]!);
      index += 1;
      this.captured.push(step);
      this.listeners.forEach((cb) => cb(step));
      if (this.scenario === "long" && index >= LONG_SCRIPT.length) {
        this.clearTimer();
      }
      if (this.scenario === "burst" && index >= BURST_SCRIPT.length) {
        this.clearTimer();
      }
    }, this.intervalMs);
    return null;
  }

  /** Manually emit one step (driven from the DebugStrip). */
  emitNow(): void {
    const step = buildStep(BURST_SCRIPT[this.captured.length % BURST_SCRIPT.length]!);
    this.captured.push(step);
    this.listeners.forEach((cb) => cb(step));
  }

  /** Final delta — mock steps were all emitted live, so nothing extra. */
  async stop(): Promise<MacroStep[]> {
    this.clearTimer();
    return [];
  }

  discard(): void {
    this.clearTimer();
    this.captured = [];
  }

  onStep(callback: (step: MacroStep) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private clearTimer() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
