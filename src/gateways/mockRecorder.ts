import type { MacroStep, StepKind } from "../types";
import { newId } from "../utils/id";
import type { RecorderGateway } from "./types";

export type RecorderScenario = "burst" | "long" | "silent";

type ScriptedStep = { kind: StepKind; label: string };

const BURST_SCRIPT: ScriptedStep[] = [
  { kind: "transform", label: "Transform · x → 200" },
  { kind: "transform", label: "Transform · rotation → 45°" },
  { kind: "fill", label: "Fill → #FF5A00" },
  { kind: "keyframe", label: "Keyframe · position @ frame 60" },
  { kind: "stroke", label: "Stroke · width → 4" },
  { kind: "layer", label: "Layer · opacity → 60%" },
];

const LONG_SCRIPT: ScriptedStep[] = Array.from({ length: 20 }, (_, i) => {
  const cycle: ScriptedStep[] = [
    { kind: "transform", label: `Transform · x → ${100 + i * 10}` },
    { kind: "fill", label: `Fill → hsl(${i * 18} 80% 50%)` },
    { kind: "keyframe", label: `Keyframe · scale @ frame ${i * 5}` },
    { kind: "stroke", label: `Stroke · width → ${i + 1}` },
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
      const scripted = script[index % script.length]!;
      index += 1;
      const step: MacroStep = {
        id: newId(),
        kind: scripted.kind,
        label: scripted.label,
        payload: { mock: true },
      };
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
    const scripted = BURST_SCRIPT[this.captured.length % BURST_SCRIPT.length]!;
    const step: MacroStep = {
      id: newId(),
      kind: scripted.kind,
      label: scripted.label,
      payload: { mock: true },
    };
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
