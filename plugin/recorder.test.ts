/**
 * Recording-session diagnostics tests, driven by the shared fake scene and a
 * stubbed `creator` global — mirrors plugin/playback.test.ts's setup.
 *
 * Focus: recordStop()'s "recorded nothing" debug fallback
 * (plugin/recorder.ts:341-353). The comment there says it exists to diagnose
 * a debug session that recorded NOTHING — but the guard only looks at the
 * FINAL tick's delta, not the whole session, so a session that captured real
 * steps mid-way and then ends on a quiet tick still gets the fallback,
 * silently swapping the (correct) empty-tick pair for a whole-session pair
 * that contradicts `steps: []`.
 */
import { afterEach, describe, expect, it } from "vitest";

import { makeIds, makeNode } from "../shared/testing/fakeScene";
import { recordDiscard, recordStart, recordStop, recordTick } from "./recorder";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

function makeSceneRoot(nextId: (p: string) => string, layers: Any[]) {
  const scene: Any = {
    id: nextId("scene"),
    name: "Main Scene",
    layers,
  };
  return scene;
}

function stubCreator(scene: Any) {
  (globalThis as Any).creator = {
    activeScene: scene,
    selection: { nodes: [] },
    ui: { postMessage() {}, onMessage() {}, show() {} },
  };
}

afterEach(() => {
  recordDiscard();
  delete (globalThis as Any).creator;
});

describe("recordStop's whole-session debug fallback", () => {
  it("does NOT attach the whole-session snapshot pair when the session recorded steps earlier, even though the final tick was quiet (bug: fallback keys off the last tick, not the session)", () => {
    const nextId = makeIds();
    const layer = makeNode("Layer A", { props: { position: { x: 0, y: 0 } } }, nextId);
    const scene = makeSceneRoot(nextId, [layer]);
    stubCreator(scene);

    recordStart({ debug: true });

    // Tick 1: a real edit happens — this tick's delta carries its own,
    // narrow debug pair (prev/next spanning just this tick).
    layer.position.staticValue = { x: 10, y: 10 };
    const tick1 = recordTick(1);
    expect(tick1.steps.length).toBeGreaterThan(0);
    expect(tick1.debug).toBeDefined();

    // recordStop's own internal collectDelta() is the final "tick" here, and
    // nothing changed since tick 1 — it produces zero steps, which is the
    // condition the buggy fallback keys off.
    const result = recordStop();

    expect(result.steps).toEqual([]);
    // This is the bug under test: the session recorded a step at tick 1, so
    // the "recorded nothing" fallback must not fire for the final, merely
    // QUIET tick. Currently it does — debug.prev/next get silently replaced
    // with the whole-session snapshot pair, which disagrees with `steps: []`
    // (diffing prev/next reproduces the tick-1 step, not nothing).
    expect(result.debug).toBeUndefined();
  });

  it("attaches the whole-session snapshot pair when the session truly recorded nothing across every tick", () => {
    const nextId = makeIds();
    const layer = makeNode("Layer A", { props: { position: { x: 0, y: 0 } } }, nextId);
    const scene = makeSceneRoot(nextId, [layer]);
    stubCreator(scene);

    recordStart({ debug: true });

    const tick1 = recordTick(1);
    expect(tick1.steps).toEqual([]);
    expect(tick1.debug).toBeUndefined();

    const result = recordStop();

    expect(result.steps).toEqual([]);
    expect(result.debug).toBeDefined();
    // Whole-session pair: with no edits across the session, prev and next
    // should be structurally identical (both describe the untouched scene).
    expect(result.debug?.prev).toEqual(result.debug?.next);
    expect(result.debug?.prev.layers[0]?.props.position?.static).toEqual({ x: 0, y: 0 });
  });
});
