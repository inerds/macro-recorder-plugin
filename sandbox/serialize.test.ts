/**
 * Serializer tests for the SCENE-level surface — the layer/shape channels are
 * covered end-to-end through recorder.test.ts and applier.test.ts.
 *
 * Every read in serialize.ts is defensive, so the cases that matter are the
 * ones where the host is unhelpful: a member it does not carry, a getter that
 * throws, a value in the wrong shape. Each must be OMITTED, because the
 * differ treats absent as "say nothing" — never as a change to null.
 */
import { describe, expect, it } from "vitest";

import { serializeScene } from "./serialize";

type Any = any;

function sceneRoot(overrides: Record<string, Any> = {}) {
  return {
    id: "scene-1",
    name: "Main Scene",
    size: { width: 1920, height: 1080 },
    backgroundColor: { r: 255, g: 255, b: 255 },
    framerate: 30,
    duration: 5,
    layers: [] as Any[],
    ...overrides,
  };
}

describe("serializeScene — settings", () => {
  it("reads the five plain members 1.0.1 Scene declares", () => {
    expect(serializeScene(sceneRoot()).settings).toEqual({
      name: "Main Scene",
      size: { width: 1920, height: 1080 },
      backgroundColor: { r: 255, g: 255, b: 255 },
      framerate: 30,
      duration: 5,
    });
  });

  it("keeps a null background — a transparent scene is a VALUE, not an absence", () => {
    expect(serializeScene(sceneRoot({ backgroundColor: null })).settings).toMatchObject({
      backgroundColor: null,
    });
  });

  it("omits a member the host doesn't carry rather than recording null", () => {
    const scene: Any = sceneRoot();
    delete scene.framerate;
    delete scene.backgroundColor;
    const settings = serializeScene(scene).settings!;
    expect("framerate" in settings).toBe(false);
    expect("backgroundColor" in settings).toBe(false);
    expect(settings.duration).toBe(5);
  });

  it("omits a member whose getter throws", () => {
    const scene: Any = sceneRoot();
    Object.defineProperty(scene, "duration", {
      get() {
        throw new Error("locked");
      },
    });
    expect("duration" in serializeScene(scene).settings!).toBe(false);
  });

  it("omits a size that isn't {width, height} numbers", () => {
    expect("size" in serializeScene(sceneRoot({ size: { x: 10, y: 20 } })).settings!).toBe(false);
    expect("size" in serializeScene(sceneRoot({ size: "1920x1080" })).settings!).toBe(false);
  });

  it("omits a colour missing a channel", () => {
    const settings = serializeScene(sceneRoot({ backgroundColor: { r: 1, g: 2 } })).settings!;
    expect("backgroundColor" in settings).toBe(false);
  });
});
