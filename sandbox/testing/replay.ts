/**
 * The replay harness the macro suites share.
 *
 * `sandbox/demoMacros.replay.test.ts` and `sandbox/corpus.replay.test.ts` both
 * drive their macros through the REAL playback orchestrator against the fake
 * scene in `engine/testing/fakeScene.ts`, so neither suite invents its own
 * idea of what a replay does. Only the scene each one builds differs.
 *
 * It lives under `sandbox/` because it needs the `creator` global, which only
 * `tsconfig.sandbox.json` knows about, and outside `*.test.ts` so importing it
 * does not register another suite's tests.
 */
import type { MacroStep } from "../../engine/macro";
import { playbackBegin, playbackEnd, playbackStep } from "../playback";

// The fake scene is deliberately untyped: it models the host's proxies, which
// the typings describe only in part.
type Any = any;

/** Installs the `creator` global a replay reads its scene and selection from. */
export function stubCreator(scene: Any, selection: Any[]): void {
  (globalThis as Any).creator = {
    activeScene: scene,
    selection: { nodes: selection },
    timeline: { currentFrame: 0 },
    ui: { postMessage() {}, onMessage() {}, show() {} },
  };
}

/** Ends the run and removes the global. Call it from `afterEach`. */
export function endReplay(): void {
  playbackEnd();
  delete (globalThis as Any).creator;
}

export interface ReplayOutcome {
  begin: ReturnType<typeof playbackBegin>;
  failures: { target: string; message: string }[];
  notes: string[];
}

/**
 * Runs every step through `playbackBegin` / `playbackStep`, the same sequence
 * the RPC server drives in Creator, and collects what came back.
 *
 * `notes` are expected and fine: they are the engine reporting a deliberate
 * adaptation or a skip. Only a FAILURE counts as broken.
 */
export function runSteps(
  steps: MacroStep[],
  options: { sourceNodeId?: string; staggerFrames?: number; atPlayhead?: boolean } = {},
): ReplayOutcome {
  const begin = playbackBegin({
    steps,
    ...(options.sourceNodeId ? { sourceNodeId: options.sourceNodeId } : {}),
    ...(options.staggerFrames ? { staggerFrames: options.staggerFrames } : {}),
    ...(options.atPlayhead ? { atPlayhead: true } : {}),
  });
  const failures: { target: string; message: string }[] = [];
  const notes: string[] = [];
  for (let index = 0; index < steps.length; index++) {
    const result = playbackStep({ index });
    failures.push(...result.failures);
    for (const note of result.notes ?? []) notes.push(note.message);
  }
  return { begin, failures, notes };
}
