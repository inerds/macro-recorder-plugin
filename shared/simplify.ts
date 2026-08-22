import { jsonEqual, type Json } from "./json";
import { labelOf } from "./labels";
import type { MacroStep } from "./macro";
import { pathKey, type KfSnap } from "./snapshot";
import { kindOf, type StepPayload } from "./steps";

/**
 * Collapses the micro-steps a 500ms tick loop produces while the user drags
 * one control: runs of value edits on the same property become a single
 * first→last step, and keyframe edits on one property fold into one net
 * delta. Pure and order-preserving; steps it doesn't understand pass through
 * untouched. Manual (a button), never automatic — a user who wants every
 * intermediate value keeps them.
 */

const FRAME_EPSILON = 1e-6;

type Mergeable = Extract<StepPayload, { op: "set-static" | "set-plain" | "keyframes" }>;

function payloadOf(step: MacroStep): StepPayload | null {
  const payload = step.payload;
  if (typeof payload !== "object" || payload === null) return null;
  if (typeof (payload as { op?: unknown }).op !== "string") return null;
  return payload as StepPayload;
}

function isMergeable(payload: StepPayload): payload is Mergeable {
  return payload.op === "set-static" || payload.op === "set-plain" || payload.op === "keyframes";
}

/** Same property on the same layer — the unit a run is grouped by. */
function propertyKey(payload: Mergeable): string {
  return `${payload.layer?.id ?? ""}|${pathKey(payload.path)}`;
}

function sameFrame(a: number, b: number): boolean {
  return Math.abs(a - b) < FRAME_EPSILON;
}

function sameSnap(a: KfSnap, b: KfSnap): boolean {
  return (
    sameFrame(a.frame, b.frame) &&
    jsonEqual(a.value, b.value) &&
    jsonEqual(a.easing ?? null, b.easing ?? null)
  );
}

type KfPayload = Extract<StepPayload, { op: "keyframes" }>;

/**
 * Folds `next` onto `prev` so the result describes the net keyframe change.
 * Each entry of `next` is matched against what `prev` already says about
 * that frame: an add after a remove is an in-place change, a remove after an
 * add cancels it, a change after an add rewrites the add, chained changes
 * keep the first `before` and the last `after`.
 */
function foldKeyframes(prev: KfPayload, next: KfPayload): KfPayload {
  const added = prev.added.map((s) => ({ ...s }));
  const removed = prev.removed.map((s) => ({ ...s }));
  const changed = prev.changed.map((c) => ({ before: { ...c.before }, after: { ...c.after } }));

  const addedAt = (f: number) => added.findIndex((s) => sameFrame(s.frame, f));
  const removedAt = (f: number) => removed.findIndex((s) => sameFrame(s.frame, f));
  const changedTo = (f: number) => changed.findIndex((c) => sameFrame(c.after.frame, f));

  for (const snap of next.added) {
    const r = removedAt(snap.frame);
    if (r >= 0) {
      const [before] = removed.splice(r, 1);
      changed.push({ before: before!, after: { ...snap } });
      continue;
    }
    const a = addedAt(snap.frame);
    if (a >= 0) added[a] = { ...snap };
    else {
      const c = changedTo(snap.frame);
      if (c >= 0) changed[c]!.after = { ...snap };
      else added.push({ ...snap });
    }
  }

  for (const snap of next.removed) {
    const a = addedAt(snap.frame);
    if (a >= 0) {
      added.splice(a, 1);
      continue;
    }
    const c = changedTo(snap.frame);
    if (c >= 0) {
      const [change] = changed.splice(c, 1);
      removed.push(change!.before);
      continue;
    }
    removed.push({ ...snap });
  }

  for (const change of next.changed) {
    const a = addedAt(change.before.frame);
    if (a >= 0) {
      added[a] = { ...change.after };
      continue;
    }
    const c = changedTo(change.before.frame);
    if (c >= 0) {
      changed[c]!.after = { ...change.after };
      continue;
    }
    changed.push({ before: { ...change.before }, after: { ...change.after } });
  }

  return {
    ...prev,
    added,
    removed,
    changed: changed.filter((c) => !sameSnap(c.before, c.after)),
  };
}

function isNoOp(payload: Mergeable): boolean {
  if (payload.op === "keyframes") {
    return payload.added.length === 0 && payload.removed.length === 0 && payload.changed.length === 0;
  }
  return jsonEqual(payload.before, payload.after);
}

function relabel(step: MacroStep, payload: StepPayload): MacroStep {
  return { ...step, kind: kindOf(payload), label: labelOf(payload), payload };
}

export function simplifySteps(steps: MacroStep[]): MacroStep[] {
  const out: MacroStep[] = [];
  // Index into `out` of the latest step per property key — the merge
  // candidate. Cleared by barriers (below) so a run never reaches across
  // something that could change what the property means.
  const latest = new Map<string, number>();

  for (const step of steps) {
    const payload = payloadOf(step);
    if (!payload || !isMergeable(payload) || step.disabled) {
      // Structural and scene ops re-index paths and rebind layers; a
      // disabled step is the user's call and stays exactly where it is.
      out.push(step);
      latest.clear();
      continue;
    }

    const key = propertyKey(payload);
    const at = latest.get(key);
    const prevPayload = at !== undefined ? (payloadOf(out[at]!) as Mergeable) : null;

    if (prevPayload && prevPayload.op !== payload.op) {
      // Static edit after keyframe edit (or vice versa) on one property —
      // the meaning of the value changed; keep both, start a new run.
      out.push(step);
      latest.set(key, out.length - 1);
      continue;
    }

    if (!prevPayload) {
      out.push(step);
      latest.set(key, out.length - 1);
      continue;
    }

    let merged: Mergeable;
    if (payload.op === "keyframes") {
      merged = foldKeyframes(prevPayload as KfPayload, payload);
    } else {
      merged = { ...prevPayload, after: payload.after as Json } as Mergeable;
    }

    if (isNoOp(merged)) {
      out.splice(at!, 1);
      latest.delete(key);
      // Indices after the removed slot shift down by one.
      for (const [k, v] of latest) if (v > at!) latest.set(k, v - 1);
      continue;
    }
    out[at!] = relabel(out[at!]!, merged);
  }

  return out;
}
