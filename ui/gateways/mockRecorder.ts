import type { CaptureOffer, ScopeReport } from "../../engine/protocol";
import { buildStep, type StepPayload } from "../../engine/steps";
import type { MacroStep } from "../types";
import type { RecorderGateway, RecordingSource, ScopePreview } from "./types";

export type RecorderScenario = "burst" | "long" | "silent" | "keyframes";

const LAYER = { id: "mock-layer", name: "Rectangle 1" };

const SCENE_NAME = "Scene 1";

/** Every scenario but "silent" records the one mock layer. */
const LAYER_SCOPE: ScopeReport = { kind: "layers", layers: [LAYER] };

/** "silent" is the whole-scene demo: nothing selected, so nothing is dropped
 *  for being out of scope — except that this mock drops three, on a timer,
 *  so the chip's counter is reachable without the Creator API. */
const SCENE_SCOPE: ScopeReport = { kind: "scene" };

/**
 * Real StepPayloads (labels come from the same `buildStep` as production),
 * so demo mode exercises Simplify (two consecutive position edits), step
 * editing and parameter pins exactly as a recording would.
 */
const BURST_SCRIPT: StepPayload[] = [
  {
    op: "set-static",
    path: ["position"],
    before: { x: 100, y: 120 },
    after: { x: 160, y: 120 },
    layer: LAYER,
  },
  {
    op: "set-static",
    path: ["position"],
    before: { x: 160, y: 120 },
    after: { x: 200, y: 120 },
    layer: LAYER,
  },
  { op: "set-static", path: ["rotation"], before: 0, after: 45, layer: LAYER },
  {
    op: "set-static",
    path: ["fills", 0, "color"],
    before: { r: 40, g: 40, b: 40 },
    after: { r: 255, g: 90, b: 0 },
    layer: LAYER,
  },
  {
    op: "keyframes",
    path: ["position"],
    added: [{ frame: 60, value: { x: 200, y: 120 } }],
    removed: [],
    changed: [],
    layer: LAYER,
  },
  { op: "set-static", path: ["strokes", 0, "width"], before: 2, after: 4, layer: LAYER },
  { op: "set-plain", path: ["visible"], before: true, after: false, layer: LAYER },
];

/**
 * "keyframes" scenario: a quiet recording where the selected layer already
 * has timeline animation — demonstrates the capture-offer affordance.
 * Real payloads through the real buildStep, like everything mock (invariant).
 */
const CAPTURE_OFFER: CaptureOffer = {
  layerId: LAYER.id,
  layerName: LAYER.name,
  pathCount: 3,
  keyframeCount: 6, // keyframes only — statics ride Add all regardless
  selectedCount: 2,
};

const CAPTURE_ALL_SCRIPT: StepPayload[] = [
  {
    op: "keyframes",
    path: ["position"],
    added: [
      { frame: 0, value: { x: 100, y: 120 }, easing: "LINEAR" },
      { frame: 30, value: { x: 220, y: 120 } },
      { frame: 60, value: { x: 220, y: 240 } },
    ],
    removed: [],
    changed: [],
    layer: LAYER,
  },
  {
    op: "keyframes",
    path: ["opacity"],
    added: [
      { frame: 0, value: 0 },
      { frame: 20, value: 100 },
    ],
    removed: [],
    changed: [],
    layer: LAYER,
  },
  {
    op: "keyframes",
    path: ["fills", 0, "color"],
    added: [{ frame: 45, value: { r: 255, g: 90, b: 0 } }],
    removed: [],
    changed: [],
    layer: LAYER,
  },
  // Full-state capture: the whole fill (kind included) as replace-paint,
  // then statics and content flags as before === after payloads.
  {
    op: "replace-paint",
    path: ["fills", 0],
    spec: {
      kind: "gradient",
      gradientType: "GRADIENT_RADIAL",
      stops: { animated: false, static: [{ offset: 0, color: { r: 255, g: 90, b: 0 } }] },
    },
    layer: LAYER,
  },
  { op: "set-static", path: ["rotation"], before: 15, after: 15, layer: LAYER },
  { op: "set-static", path: ["strokes", 0, "width"], before: 3, after: 3, layer: LAYER },
  { op: "set-plain", path: ["blendMode"], before: "multiply", after: "multiply", layer: LAYER },
];

/** The "selected" subset: the two position keyframes a user picked. */
const CAPTURE_SELECTED_SCRIPT: StepPayload[] = [
  {
    op: "keyframes",
    path: ["position"],
    added: [
      { frame: 0, value: { x: 100, y: 120 }, easing: "LINEAR" },
      { frame: 30, value: { x: 220, y: 120 } },
    ],
    removed: [],
    changed: [],
    layer: LAYER,
  },
];

const LONG_SCRIPT: StepPayload[] = Array.from({ length: 20 }, (_, i) => {
  const cycle: StepPayload[] = [
    {
      op: "set-static",
      path: ["position"],
      before: { x: 100 + i * 10, y: 120 },
      after: { x: 110 + i * 10, y: 120 },
      layer: LAYER,
    },
    {
      op: "set-static",
      path: ["fills", 0, "color"],
      before: { r: i * 12, g: 80, b: 120 },
      after: { r: i * 12 + 12, g: 80, b: 120 },
      layer: LAYER,
    },
    {
      op: "keyframes",
      path: ["scale"],
      added: [{ frame: i * 5, value: { x: 1, y: 1 } }],
      removed: [],
      changed: [],
      layer: LAYER,
    },
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
  private offerListeners = new Set<(offer: CaptureOffer | null) => void>();
  private ignoredListeners = new Set<(count: number) => void>();
  private captured: MacroStep[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private ignoredTimer: ReturnType<typeof setInterval> | null = null;

  private scenario: RecorderScenario;
  private intervalMs: number;

  constructor(scenario: RecorderScenario = "burst", intervalMs = 800) {
    this.scenario = scenario;
    this.intervalMs = intervalMs;
  }

  setScenario(scenario: RecorderScenario) {
    this.scenario = scenario;
  }

  async start(): Promise<RecordingSource> {
    this.captured = [];
    if (this.scenario === "keyframes") {
      // Quiet feed; the story is the standing offer.
      setTimeout(() => {
        this.offerListeners.forEach((cb) => cb(CAPTURE_OFFER));
      }, this.intervalMs);
      return { nodeId: LAYER.id, nodeName: LAYER.name, scope: LAYER_SCOPE };
    }
    if (this.scenario === "silent") {
      // Demos the whole-scene chip and its running ignored counter.
      let ignored = 0;
      this.ignoredTimer = setInterval(() => {
        ignored += 1;
        this.ignoredListeners.forEach((cb) => cb(ignored));
        if (ignored >= 3) this.clearIgnoredTimer();
      }, this.intervalMs);
      return { nodeId: "mock-scene", nodeName: SCENE_NAME, scope: SCENE_SCOPE };
    }
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
    return { nodeId: LAYER.id, nodeName: LAYER.name, scope: LAYER_SCOPE };
  }

  /** The resting panel's readout: what pressing Record would watch. */
  async peekScope(): Promise<ScopePreview> {
    return {
      scope: this.scenario === "silent" ? SCENE_SCOPE : LAYER_SCOPE,
      sceneName: SCENE_NAME,
    };
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
    this.offerListeners.forEach((cb) => cb(null));
    return [];
  }

  discard(): void {
    this.clearTimer();
    this.offerListeners.forEach((cb) => cb(null));
    this.captured = [];
  }

  async captureKeyframes(_layerId: string, scope: "all" | "selected"): Promise<MacroStep[]> {
    const script = scope === "all" ? CAPTURE_ALL_SCRIPT : CAPTURE_SELECTED_SCRIPT;
    const steps = script.map(buildStep);
    this.captured.push(...steps);
    return steps;
  }

  onIgnoredCount(callback: (count: number) => void): () => void {
    this.ignoredListeners.add(callback);
    return () => this.ignoredListeners.delete(callback);
  }

  onCaptureOffer(callback: (offer: CaptureOffer | null) => void): () => void {
    this.offerListeners.add(callback);
    return () => this.offerListeners.delete(callback);
  }

  onStep(callback: (step: MacroStep) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private clearTimer() {
    this.clearIgnoredTimer();
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private clearIgnoredTimer() {
    if (this.ignoredTimer !== null) {
      clearInterval(this.ignoredTimer);
      this.ignoredTimer = null;
    }
  }
}
