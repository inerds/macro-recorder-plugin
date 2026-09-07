/**
 * Recording-session diagnostics tests, driven by the shared fake scene and a
 * stubbed `creator` global — mirrors sandbox/playback.test.ts's setup.
 *
 * Focus: recordStop()'s "recorded nothing" debug fallback
 * (sandbox/recorder.ts:341-353). The comment there says it exists to diagnose
 * a debug session that recorded NOTHING — but the guard only looks at the
 * FINAL tick's delta, not the whole session, so a session that captured real
 * steps mid-way and then ends on a quiet tick still gets the fallback,
 * silently swapping the (correct) empty-tick pair for a whole-session pair
 * that contradicts `steps: []`.
 */
import { afterEach, describe, expect, it } from "vitest";

import { makeIds, makeNode } from "../engine/testing/fakeScene";
import { recordDiscard, recordStart, recordStop, recordTick } from "./recorder";

type Any = any;

function makeSceneRoot(nextId: (p: string) => string, layers: Any[]) {
  const scene: Any = {
    id: nextId("scene"),
    name: "Main Scene",
    layers,
  };
  // The host seats every top-level layer in the scene; `clone()` needs that
  // link to insert the copy beside its source, the way a duplicate arrives.
  for (const layer of layers) layer.parent = scene;
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

  // Traces 2026-09-04T03-51-20-511_record.json and
  // 2026-09-04T03-47-27-725_record.json (sandboxRev 2026-08-26.52): a
  // debug session whose only steps came from record.captureKeyframes
  // (scope "all") still gets the "recorded nothing" fallback, because
  // recordCaptureKeyframes returns real MacroSteps but never sets
  // recording.stepped (only collectDelta does). recordStop then staples the
  // whole-session snapshot pair onto an empty final delta, and the trace
  // claims the session dropped its diff even though captureKeyframes
  // reported real steps.
  it("does NOT attach the whole-session snapshot pair after record.captureKeyframes(scope 'all') returned steps (bug: recordCaptureKeyframes never sets recording.stepped)", async () => {
    const nextId = makeIds();
    const layer = makeNode("Layer A", { props: { position: { x: 0, y: 0 } } }, nextId);
    layer.position.addKeyframes([
      { frame: 0, value: { x: 0, y: 0 } },
      { frame: 30, value: { x: 9, y: 9 } },
    ]);
    const scene = makeSceneRoot(nextId, [layer]);
    stubCreator(scene);

    const { recordCaptureKeyframes } = await import("./recorder");

    recordStart({ debug: true });

    const { steps } = recordCaptureKeyframes({ layerId: String(layer.id), scope: "all" });
    expect(steps.length).toBeGreaterThan(0);

    // No further edits happen — record.stop's own internal collectDelta()
    // sees a quiet scene and produces zero steps, which is the condition the
    // buggy fallback keys off.
    const result = recordStop();

    expect(result.steps).toEqual([]);
    // This is the bug under test: the session recorded real keyframe-capture
    // steps, so the "recorded nothing" fallback must not fire. Currently it
    // does, because recordCaptureKeyframes never marks recording.stepped.
    expect(result.debug).toBeUndefined();
  });
});

describe("selection:keyframes event fallback", () => {
  // Live sessions proved the polled getter is a permanently EMPTY array on
  // the real host; the typed selection:keyframes event is the remaining
  // route. The recorder caches the latest event payload and the offer /
  // capture read it when the getter has nothing.
  function stubCreatorWithEvents(scene: Any) {
    const handlers: Record<string, (e: Any) => void> = {};
    (globalThis as Any).creator = {
      activeScene: scene,
      selection: { nodes: [], keyframes: [] }, // getter live but empty — the observed host shape
      on(type: string, cb: (e: Any) => void) {
        handlers[type] = cb;
      },
      ui: { postMessage() {}, onMessage() {}, show() {} },
    };
    return handlers;
  }

  async function setup() {
    const nextId = makeIds();
    const layer = makeNode(
      "Flower",
      { props: { position: { x: 0, y: 0 } } },
      nextId,
    );
    layer.position.addKeyframes([
      { frame: 0, value: { x: 0, y: 0 } },
      { frame: 30, value: { x: 9, y: 9 } },
    ]);
    const scene = makeSceneRoot(nextId, [layer]);
    const handlers = stubCreatorWithEvents(scene);
    const { initSelectionEvents, recordCaptureKeyframes } = await import("./recorder");
    initSelectionEvents();
    (globalThis as Any).creator.selection.nodes = [layer];
    recordStart({});
    return { layer, handlers, recordCaptureKeyframes };
  }

  it("event entries feed selectedCount when the getter polls empty", async () => {
    const { handlers, layer } = await setup();
    expect(recordTick(1).captureOffer?.selectedCount).toBe(0);

    // Host pushes the selection through the event (PluginEvent {type, data}).
    handlers["selection:keyframes"]?.({
      type: "selection:keyframes",
      data: [{ id: "k1", frame: 30, value: { x: 9, y: 9 } }],
    });
    const offer = recordTick(2).captureOffer;
    expect(offer?.layerId).toBe(layer.id);
    expect(offer?.selectedCount).toBe(1);
  });

  it("scope=selected captures the event-selected keyframes", async () => {
    const { handlers, layer, recordCaptureKeyframes } = await setup();
    handlers["selection:keyframes"]?.({
      type: "selection:keyframes",
      data: [{ id: "k1", frame: 30, value: { x: 9, y: 9 } }],
    });
    recordTick(1);
    const { steps } = recordCaptureKeyframes({ layerId: String(layer.id), scope: "selected" });
    expect(steps).toHaveLength(1);
    const payload = steps[0]!.payload as Any;
    expect(payload.op).toBe("keyframes");
    expect(payload.added).toEqual([{ frame: 30, value: { x: 9, y: 9 } }]);
  });

  it("an emptying event clears the cache (deselection)", async () => {
    const { handlers } = await setup();
    handlers["selection:keyframes"]?.({
      type: "selection:keyframes",
      data: [{ id: "k1", frame: 30, value: { x: 9, y: 9 } }],
    });
    expect(recordTick(1).captureOffer?.selectedCount).toBe(1);
    handlers["selection:keyframes"]?.({ type: "selection:keyframes", data: [] });
    expect(recordTick(2).captureOffer?.selectedCount).toBe(0);
  });
});

describe("the recording is pinned to the scene it started in", () => {
  it("keeps recording the pinned scene and says so ONCE when the active scene changes", () => {
    const nextId = makeIds();
    const layer = makeNode("Layer A", { props: { position: { x: 0, y: 0 } } }, nextId);
    const pinned = makeSceneRoot(nextId, [layer]);
    stubCreator(pinned);

    recordStart({});

    // The user switches scenes mid-recording.
    const other = makeSceneRoot(nextId, [makeNode("Elsewhere", {}, nextId)]);
    (globalThis as Any).creator.activeScene = other;

    layer.position.staticValue = { x: 10, y: 10 };
    const tick1 = recordTick(1);

    // The edit in the PINNED scene is still recorded...
    expect(
      tick1.steps.some((s: Any) => s.payload?.op === "set-static"),
    ).toBe(true);
    // ...and the switch is reported, exactly once.
    const noted = tick1.steps.filter((s: Any) => s.payload?.op === "not-replayable");
    expect(noted).toHaveLength(1);
    expect(noted[0]!.replayable).toBe(false);
    expect(noted[0]!.label).toMatch(/Main Scene/);

    layer.position.staticValue = { x: 20, y: 20 };
    const tick2 = recordTick(2);
    expect(tick2.steps.some((s: Any) => s.payload?.op === "not-replayable")).toBe(false);
  });

  it("says nothing while the active scene is still the recorded one", () => {
    const nextId = makeIds();
    const layer = makeNode("Layer A", { props: { position: { x: 0, y: 0 } } }, nextId);
    const scene = makeSceneRoot(nextId, [layer]);
    stubCreator(scene);

    recordStart({});
    layer.position.staticValue = { x: 10, y: 10 };
    const tick = recordTick(1);
    expect(tick.steps.every((s: Any) => s.payload?.op !== "not-replayable")).toBe(true);
  });

  it("does not let the switch note alone suppress recordStop's whole-session debug fallback", () => {
    const nextId = makeIds();
    const scene = makeSceneRoot(nextId, [makeNode("Layer A", {}, nextId)]);
    stubCreator(scene);

    recordStart({ debug: true });
    (globalThis as Any).creator.activeScene = makeSceneRoot(nextId, []);
    const tick = recordTick(1);
    expect(tick.steps).toHaveLength(1); // the note, and nothing else

    const result = recordStop();
    expect(result.debug).toBeDefined();
  });
});

describe("recording scope", () => {
  /** Layer A (with a rectangle), Layer B, Layer C — a scene worth scoping. */
  function scopedScene() {
    const nextId = makeIds();
    const a = makeNode("Layer A", { props: { position: { x: 0, y: 0 } } }, nextId);
    const rect = a.createRectangle({ size: { width: 80, height: 60 } });
    const b = makeNode("Layer B", { props: { position: { x: 100, y: 0 } } }, nextId);
    const c = makeNode("Layer C", { props: { position: { x: 200, y: 0 } } }, nextId);
    const scene = makeSceneRoot(nextId, [a, b, c]);
    stubCreator(scene);
    return { a, b, c, rect, scene, nextId };
  }

  function select(...nodes: Any[]) {
    (globalThis as Any).creator.selection.nodes = nodes;
  }

  const opsOf = (steps: Any[]) => steps.map((step) => step.payload?.op);

  it("scopes the recording to the layer that owns the selected shape, and drops edits elsewhere", () => {
    const { a, b, rect } = scopedScene();
    select(rect);

    const started = recordStart({});
    expect(started.scope).toEqual({ kind: "layers", layers: [{ id: a.id, name: "Layer A" }] });
    // A single-layer scope names THAT layer as the macro's source, so a
    // no-selection replay lands on the layer it was recorded from.
    expect(started.nodeId).toBe(a.id);
    expect(started.nodeName).toBe("Layer A");

    b.position.staticValue = { x: 110, y: 0 };
    const tick1 = recordTick(1);
    expect(tick1.steps).toEqual([]);
    expect(tick1.ignored).toBe(1);

    a.position.staticValue = { x: 10, y: 0 };
    const tick2 = recordTick(2);
    expect(opsOf(tick2.steps)).toEqual(["set-static"]);
    // Cumulative: the count is a running total, not this tick's blip.
    expect(tick2.ignored).toBe(1);
  });

  it("records the whole scene, and says why, when the selection is not in this scene", () => {
    const { scene, nextId } = scopedScene();
    select(makeNode("Elsewhere", {}, nextId));

    const started = recordStart({});
    expect(started.scope).toEqual({ kind: "scene", fallback: "unresolved" });
    expect(started.nodeId).toBe(scene.id);
  });

  it("records the whole scene with no fallback marker when nothing is selected", () => {
    const { a, b } = scopedScene();

    expect(recordStart({}).scope).toEqual({ kind: "scene" });
    a.position.staticValue = { x: 10, y: 0 };
    b.position.staticValue = { x: 110, y: 0 };
    const tick = recordTick(1);
    expect(tick.steps).toHaveLength(2);
    expect(tick.ignored).toBe(0);
  });

  it("records a duplicate of the scoped layer, and the edits made to the copy", () => {
    const { a, rect } = scopedScene();
    select(rect);
    recordStart({});

    const copy = a.clone();
    const tick1 = recordTick(1);
    expect(opsOf(tick1.steps)).toEqual(["add-layer"]);
    expect((tick1.steps[0]!.payload as Any).cloneOf?.id).toBe(a.id);
    expect(tick1.ignored).toBe(0);
    // The tick that grew the scope reports it, so the panel names both layers.
    expect(tick1.scope).toEqual({
      kind: "layers",
      layers: [
        { id: a.id, name: "Layer A" },
        { id: copy.id, name: copy.name },
      ],
    });

    copy.position.staticValue = { x: 50, y: 50 };
    const tick2 = recordTick(2);
    expect(opsOf(tick2.steps)).toEqual(["set-static"]);
    expect((tick2.steps[0]!.payload as Any).layer?.id).toBe(copy.id);
    // Unchanged scope: nothing to report.
    expect(tick2.scope).toBeUndefined();
  });

  it("records a duplicate of an unwatched layer, but still ignores that layer's own edits", () => {
    const { b, rect } = scopedScene();
    select(rect);
    recordStart({});

    b.clone();
    const tick1 = recordTick(1);
    expect(opsOf(tick1.steps)).toEqual(["add-layer"]);
    expect((tick1.steps[0]!.payload as Any).cloneOf?.id).toBe(b.id);

    b.position.staticValue = { x: 111, y: 0 };
    const tick2 = recordTick(2);
    expect(tick2.steps).toEqual([]);
    expect(tick2.ignored).toBe(1);
  });

  it("ignores a scene setting in layer scope and records it in scene scope", () => {
    const { rect, scene } = scopedScene();
    select(rect);
    recordStart({});
    scene.name = "Renamed";
    const scoped = recordTick(1);
    expect(scoped.steps).toEqual([]);
    expect(scoped.ignored).toBe(1);
    recordDiscard();

    select();
    recordStart({});
    scene.name = "Renamed again";
    const whole = recordTick(1);
    expect(opsOf(whole.steps)).toEqual(["set-scene"]);
    expect(whole.ignored).toBe(0);
  });

  it("records a reorder that moved the scoped layer, and ignores a swap of two others", () => {
    const { a, b, c, rect, scene } = scopedScene();
    select(rect);
    recordStart({});

    scene.layers = [b, c, a];
    const moved = recordTick(1);
    expect(opsOf(moved.steps)).toEqual(["reorder-layers"]);

    scene.layers = [c, b, a];
    const swapped = recordTick(2);
    expect(swapped.steps).toEqual([]);
    expect(swapped.ignored).toBe(1);
  });

  it("does not widen the scope when the selection changes mid-recording", () => {
    const { b, rect } = scopedScene();
    select(rect);
    recordStart({});

    select(b);
    b.position.staticValue = { x: 110, y: 0 };
    const tick1 = recordTick(1);
    expect(tick1.steps).toEqual([]);
    expect(tick1.ignored).toBe(1);

    b.position.staticValue = { x: 120, y: 0 };
    const tick2 = recordTick(2);
    expect(tick2.ignored).toBe(2);
  });

  it("offers no keyframe capture for a keyframed layer outside the scope", () => {
    const { a, b, rect } = scopedScene();
    a.position.addKeyframes([
      { frame: 0, value: { x: 0, y: 0 } },
      { frame: 30, value: { x: 9, y: 9 } },
    ]);
    b.position.addKeyframes([
      { frame: 0, value: { x: 100, y: 0 } },
      { frame: 30, value: { x: 190, y: 9 } },
    ]);
    select(rect);
    recordStart({});

    select(b);
    expect(recordTick(1).captureOffer).toBeUndefined();
    // The scoped layer still gets the offer — the scope is the only filter.
    select(a);
    expect(recordTick(2).captureOffer?.layerId).toBe(a.id);
  });
});

describe("selectionPeek", () => {
  it("names the layer the current selection would record", async () => {
    const nextId = makeIds();
    const a = makeNode("Layer A", {}, nextId);
    const rect = a.createRectangle({ size: { width: 80, height: 60 } });
    const scene = makeSceneRoot(nextId, [a, makeNode("Layer B", {}, nextId)]);
    stubCreator(scene);
    const { selectionPeek } = await import("./recorder");

    expect(selectionPeek()).toEqual({ scope: { kind: "scene" }, sceneName: "Main Scene" });

    (globalThis as Any).creator.selection.nodes = [rect];
    expect(selectionPeek()).toEqual({
      scope: { kind: "layers", layers: [{ id: a.id, name: "Layer A" }] },
      sceneName: "Main Scene",
    });
  });

  it("leaves no session behind — peeking never starts or disturbs a recording", async () => {
    const nextId = makeIds();
    const a = makeNode("Layer A", { props: { position: { x: 0, y: 0 } } }, nextId);
    const scene = makeSceneRoot(nextId, [a]);
    stubCreator(scene);
    const { selectionPeek } = await import("./recorder");

    selectionPeek();
    // No recording was started, so a tick has nothing to report.
    expect(recordTick(1)).toEqual({ seq: 1, steps: [], ignored: 0 });

    recordStart({});
    selectionPeek();
    a.position.staticValue = { x: 10, y: 0 };
    expect(recordTick(2).steps).toHaveLength(1);
  });

  it("reports no scope at all without an active scene", async () => {
    stubCreator(undefined);
    const { selectionPeek } = await import("./recorder");
    expect(selectionPeek()).toEqual({ scope: null });
  });
});
