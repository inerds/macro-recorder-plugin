import type { Json } from "../engine/json";
import type { MacroStep } from "../engine/macro";
import type { RecordScope } from "../engine/scope";
import type { SceneSnapshot } from "../engine/snapshot";

type AnyProxy = any;

export interface RecordingSession {
  scene: AnyProxy;
  lastSnapshot: SceneSnapshot;
  /** Snapshot at record.start — for whole-session debug diffs. */
  firstSnapshot: SceneSnapshot;
  /** Dev diagnostics opted into at record.start. */
  debug: boolean;
  /** What this session watches. Fixed from the selection at record.start,
   *  then grown by the layers the recording itself creates. */
  scope: RecordScope;
  /** Payloads dropped so far as outside the scope — cumulative, so the panel
   *  can show a running count instead of a per-tick blip. */
  ignored: number;
  /** Debug: the keyframe-surface probe has already run this session. */
  keyframeProbed?: boolean;
  /** Any tick or keyframe capture emitted a step this session — gates
   *  recordStop's "recorded nothing" whole-session debug fallback. */
  stepped?: boolean;
  /** The "you switched scenes" step has already been emitted — it is a
   *  standing condition, not a per-tick event, so it is said once. */
  sceneSwitchNoted?: boolean;
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
  /**
   * Per-target overrides of `origins`, per pathKey — what `rebaseAfterWrite`
   * re-anchors a path to once an absolute write LANDS on that target. It is
   * per target because the write itself is: a target whose property is
   * keyframed takes nothing and keeps the shared origin, and moving that
   * origin for everyone would aim the other targets' later relative steps at
   * a value only one of them reached.
   */
  originsByTarget: Record<string, Json>[];
  /** Per-target current values at begin, per pathKey. */
  baselines: Record<string, Json>[];
  /** Keyframe frame shift: currentFrame − the macro's earliest keyframe
   *  (apply-at-playhead). 0 when not requested. */
  frameOffsetBase: number;
  /** Extra frame shift per target index (targets mode cascade). */
  staggerFrames: number;
  /** This is Repeat pass 0 — the only pass that delays layers. */
  firstPass: boolean;
  /**
   * Keyframe-free macros only: how far to move each target's in point.
   * `base` is the absolute in point the first target gets (at playhead);
   * absent means each target keeps its own. `perTarget` is added per target
   * index. `null` means this run delays nothing.
   */
  delay: { base?: number; perTarget: number } | null;
  /** Why stagger did nothing this run — reported against the first target. */
  staggerNote?: string;
  /** What `playbackBegin` dropped from the selection (shapes) — reported
   *  against the first target, once, alongside staggerNote. */
  selectionNote?: string;
  /** The delay pass already ran, so step 0 never repeats it. */
  onceDone?: boolean;
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
