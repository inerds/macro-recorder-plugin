import type { Json } from "../shared/json";
import type { MacroStep } from "../shared/macro";
import type { SceneSnapshot } from "../shared/snapshot";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyProxy = any;

export interface RecordingSession {
  scene: AnyProxy;
  lastSnapshot: SceneSnapshot;
  /** Snapshot at record.start — for whole-session debug diffs. */
  firstSnapshot: SceneSnapshot;
  /** Dev diagnostics opted into at record.start. */
  debug: boolean;
  /** Debug: the keyframe-surface probe has already run this session. */
  keyframeProbed?: boolean;
}

export interface PlaybackSession {
  /** "targets": every step applies to each selected layer (single-layer and
   *  legacy macros). "scene": each step resolves its own layer by binding. */
  mode: "targets" | "scene";
  targets: AnyProxy[];
  targetNames: string[];
  /** Scene-mode: recorded layer id -> live proxy (incl. layers created
   *  during THIS replay by add-layer steps). */
  layerByRecordedId: Map<string, AnyProxy>;
  /** Targets-mode retargeted duplication: the recorded layer id playing the
   *  "source" role — bound to each selected target. */
  sourceRoleId?: string;
  /** Per-target: recorded layer id -> proxy created during THIS replay
   *  (clones made by retargeted add-layer steps). */
  targetMaps?: Map<string, AnyProxy>[];
  steps: MacroStep[];
  /** Recorded node's first-touch value per pathKey. */
  origins: Record<string, Json>;
  /** Per-target current values at begin, per pathKey. */
  baselines: Record<string, Json>[];
  /** Keyframe frame shift: currentFrame − the macro's earliest keyframe
   *  (apply-at-playhead). 0 when not requested. */
  frameOffsetBase: number;
  /** Extra frame shift per target index (targets mode cascade). */
  staggerFrames: number;
  /** Dev diagnostics opted into at playback.begin. */
  debug: boolean;
}

export const session: {
  recording: RecordingSession | null;
  playback: PlaybackSession | null;
} = {
  recording: null,
  playback: null,
};
