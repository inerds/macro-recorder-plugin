import type { Json } from "./json";
import type { Macro, MacroStep } from "./macro";
import type { Path, SceneSnapshot } from "./snapshot";

export const PROTOCOL_VERSION = 3;

/**
 * Engine revision, bumped on every sandbox-side behaviour change. Creator
 * evaluates plugin.js once at plugin load and never re-fetches it, so a UI
 * served fresh by Vite can silently run against a stale engine — which made a
 * whole batch of traces misleading. hello returns this so the UI can warn.
 */
export const ENGINE_REV = "2026-08-22.36";

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
  | "record.stop"
  | "record.discard"
  | "playback.begin"
  | "playback.step"
  | "playback.end";

/**
 * Dev-only diagnostics. The sandbox attaches these ONLY when the UI opts in
 * per session (`debug: true` on record.start / playback.begin), so a
 * production UI that never asks gets byte-identical responses.
 */

/** The scene-snapshot pair a tick's steps were derived from. */
export interface RecordDebug {
  prev: SceneSnapshot;
  next: SceneSnapshot;
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
  keyframes: { frame: number; value: Json }[];
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
}

/** Param/result contracts per method (documentation + call-site typing). */
export interface RpcContracts {
  hello: {
    params: Record<string, never>;
    result: { protocolVersion: number; rev?: string };
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
    };
  };
  "record.tick": {
    params: { seq: number };
    result: { seq: number; steps: MacroStep[]; debug?: RecordDebug };
  };
  "record.stop": {
    params: Record<string, never>;
    result: { steps: MacroStep[]; debug?: RecordDebug };
  };
  "record.discard": { params: Record<string, never>; result: null };
  "playback.begin": {
    params: {
      steps: MacroStep[];
      sourceNodeId?: string;
      /** Shift every keyframe so the macro's earliest one lands on the
       *  timeline's current frame. */
      atPlayhead?: boolean;
      /** Targets mode: additional frame shift per selected layer (i × n). */
      staggerFrames?: number;
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
      notes?: { target: string; message: string }[];
      debug?: PlaybackStepDebug;
    };
  };
  "playback.end": { params: Record<string, never>; result: null };
}

/** Well-known error strings the UI branches on. */
export const RPC_ERRORS = {
  noSelection: "no-selection",
  nodeGone: "node-gone",
} as const;

export function isRpcMessage(value: unknown): value is RpcMessage {
  if (value === null || typeof value !== "object") return false;
  const t = (value as { t?: unknown }).t;
  return t === "req" || t === "res" || t === "notify";
}
