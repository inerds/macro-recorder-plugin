import type { Json } from "./json";
import type { Macro, MacroStep } from "./macro";
import type { Path, SceneSnapshot } from "./snapshot";
import type { LayerRef } from "./steps";

export const PROTOCOL_VERSION = 3;

/**
 * Engine revision, bumped on every sandbox-side behaviour change. Creator
 * evaluates plugin.js once at plugin load and never re-fetches it, so a UI
 * served fresh by Vite can silently run against a stale engine — which made a
 * whole batch of traces misleading. hello returns this so the UI can warn.
 */
export const ENGINE_REV = "2026-09-07.2";

/**
 * What a note says about its step. `skip` means the step did not fully apply;
 * `info` means it applied, after an adaptation worth reporting. The panel
 * counts skips only, so a successful adaptation is never reported as a skip.
 * Absent on a note from an older sandbox — read that as `skip`.
 */
export type NoteKind = "info" | "skip";

export type RpcRequest = { t: "req"; id: number; method: RpcMethod; params: unknown };
export type RpcResponse =
  | { t: "res"; id: number; ok: true; result: unknown }
  | { t: "res"; id: number; ok: false; error: string };
export type RpcNotify = { t: "notify"; event: "sandbox-ready" };
export type RpcMessage = RpcRequest | RpcResponse | RpcNotify;

export type RpcMethod =
  | "hello"
  | "store.list"
  | "store.save"
  | "store.rename"
  | "store.remove"
  | "record.start"
  | "record.tick"
  | "record.captureKeyframes"
  | "record.stop"
  | "record.discard"
  | "selection.peek"
  | "playback.begin"
  | "playback.step"
  | "playback.end";

/**
 * Dev-only diagnostics. The sandbox attaches these ONLY when the UI opts in
 * per session (`debug: true` on record.start / playback.begin), so a
 * production UI that never asks gets byte-identical responses.
 */

/**
 * A standing offer, recomputed each tick, to pull an existing layer's
 * timeline keyframes into the recording. Present only while exactly ONE
 * non-SCENE top-level layer with keyframes is selected.
 */
export interface CaptureOffer {
  layerId: string;
  layerName?: string;
  /** Animated paths in the layer's subtree with >=1 keyframe. */
  pathCount: number;
  /** Total keyframes across those paths. */
  keyframeCount: number;
  /**
   * Present ONLY when `creator.selection.keyframes` read back as an array
   * (feature detection — the surface is typed but never live-verified):
   * the count of selected entries matching THIS layer's keyframes by
   * frame(+value). Absent = surface missing; 0 = surface live, selection
   * belongs to another layer.
   */
  selectedCount?: number;
}

/**
 * What a recording watches, as reported to the panel. Decided once, at
 * `record.start`, from the selection: layers selected → those layers only
 * (a selected shape resolves to its owning top-level layer); nothing
 * selected → the whole scene. `fallback: "unresolved"` marks a non-empty
 * selection that matched no layer of the active scene, so the recording
 * fell back to the whole scene. `selection.peek` reports the same shape
 * for the idle deck's readout.
 */
export type ScopeReport =
  | { kind: "scene"; fallback?: "unresolved" }
  | { kind: "layers"; layers: LayerRef[] };

/** The scene-snapshot pair a tick's steps were derived from. */
export interface RecordDebug {
  prev: SceneSnapshot;
  next: SceneSnapshot;
  /** Payloads this tick dropped as outside the recording's layer scope. */
  ignored?: number;
  /** Attached on the first tick that emits a position keyframe step: the
   *  live keyframe proxy's real surface (do spatial tangents exist?). */
  keyframeIntrospection?: Json;
}

/** One target's state at a path, as the sandbox actually reads it. */
export interface TargetProbe {
  target: string;
  /** Value at the touched path; null when absent or unreadable. */
  value: Json | null;
  animated: boolean;
  /**
   * The target's keyframes at that path, ascending by frame. Values are
   * included deliberately: frames alone can't distinguish "value updated in
   * place" from "nothing happened", which makes silent no-ops undetectable.
   */
  keyframes: { frame: number; value: Json; easing?: Json }[];
  /** Paint counts, so add-fill / add-stroke steps have something observable. */
  fills: number;
  strokes: number;
  /** Set when the probe itself could not resolve the path. */
  unreadable?: string;
}

/** Per-target before/after state around one applied step. */
export interface PlaybackStepDebug {
  op: string;
  path?: Path;
  before: TargetProbe[];
  after: TargetProbe[];
  /** Sandbox breadcrumbs for undocumented host calls — never user-facing. */
  breadcrumbs?: string[];
}

/** Param/result contracts per method (documentation + call-site typing). */
export interface RpcContracts {
  hello: {
    params: Record<string, never>;
    result: {
      protocolVersion: number;
      rev?: string;
      /** Bytes this plugin's clientStorage holds, when the host can say —
       *  `creator.clientStorage.usedQuota` is feature-detected, so a host
       *  without it simply omits this. No UI reads it yet. */
      usedQuota?: number;
    };
  };
  "store.list": { params: Record<string, never>; result: Macro[] };
  "store.save": { params: { macro: Macro }; result: null };
  "store.rename": { params: { id: string; name: string }; result: null };
  "store.remove": { params: { id: string }; result: null };
  "record.start": {
    params: { debug?: boolean };
    result: {
      nodeId: string;
      nodeName?: string;
      /** Debug-only: raw introspection of the node's first paint, to find
       *  where the host stores properties the typings omit (fill opacity). */
      paintIntrospection?: Json;
      /** Debug-only: one keyframe proxy's real surface (spatial tangents?). */
      keyframeIntrospection?: Json;
      /** Debug-only: first RECTANGLE's surface + where corner rounding lives. */
      shapeIntrospection?: Json;
      /** Debug-only: creator.selection's real surface — is `.keyframes` live? */
      selectionIntrospection?: Json;
      /** What this recording watches. See ScopeReport. */
      scope: ScopeReport;
      /** Diagnostic only: how many nodes were selected when recording began.
       *  Older traces read it; the panel no longer does. */
      selectionCount?: number;
    };
  };
  "record.tick": {
    params: { seq: number };
    result: {
      seq: number;
      steps: MacroStep[];
      /** See CaptureOffer — absent when no single keyframed layer is selected. */
      captureOffer?: CaptureOffer;
      /** Payloads dropped so far this session as outside the layer scope —
       *  cumulative, so the panel shows a running count. 0 in scene scope. */
      ignored: number;
      /** Present only on a tick that GREW the scope — a duplicate, a new
       *  layer, a nest's scene layer — so the panel names what it watches
       *  now, not what it started with. Never present in scene scope. */
      scope?: ScopeReport;
      /** Diagnostic only: live selection size. The panel no longer reads it. */
      selectionCount?: number;
      debug?: RecordDebug;
    };
  };
  "record.captureKeyframes": {
    params: { layerId: string; scope: "all" | "selected" };
    result: { steps: MacroStep[] };
  };
  "record.stop": {
    params: Record<string, never>;
    result: { steps: MacroStep[]; debug?: RecordDebug };
  };
  "record.discard": { params: Record<string, never>; result: null };
  /**
   * What `record.start` WOULD watch right now, for the idle deck's readout.
   * Touches no session state. `scope: null` means there is no active scene.
   * The sandbox has no timers, so the panel polls this while idle.
   */
  "selection.peek": {
    params: Record<string, never>;
    result: { scope: ScopeReport | null; sceneName?: string };
  };
  "playback.begin": {
    params: {
      steps: MacroStep[];
      sourceNodeId?: string;
      /** Shift every keyframe so the macro's earliest one lands on the
       *  timeline's current frame. */
      atPlayhead?: boolean;
      /** Targets mode: additional frame shift per selected layer (i × n). */
      staggerFrames?: number;
      /**
       * Which Repeat ×N pass this is, 0-based. Absent means 0. A
       * keyframe-free macro delays its layers on the first pass only, so the
       * delay does not compound across repeats.
       */
      iteration?: number;
      debug?: boolean;
    };
    result: {
      total: number;
      targetCount: number;
      /** Frame shift applied to the first target (atPlayhead only). */
      frameOffset?: number;
    };
  };
  "playback.step": {
    params: { index: number };
    result: {
      index: number;
      failures: { target: string; message: string }[];
      /** Deliberate non-failures: what a target didn't need or couldn't take. */
      notes?: { target: string; message: string; kind?: NoteKind }[];
      debug?: PlaybackStepDebug;
    };
  };
  "playback.end": { params: Record<string, never>; result: null };
}

/** Well-known error strings the UI branches on. */
export const RPC_ERRORS = {
  noSelection: "no-selection",
  nodeGone: "node-gone",
  /** capture scope "selected": the host reported no matching selected keyframes. */
  noSelectedKeyframes: "no-selected-keyframes",
} as const;

export function isRpcMessage(value: unknown): value is RpcMessage {
  if (value === null || typeof value !== "object") return false;
  const t = (value as { t?: unknown }).t;
  return t === "req" || t === "res" || t === "notify";
}
