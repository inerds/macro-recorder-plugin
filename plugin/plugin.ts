import type { Macro } from "../shared/macro";
import { ENGINE_REV, isRpcMessage, PROTOCOL_VERSION } from "../shared/protocol";
import { playbackBegin, playbackEnd, playbackStep } from "./playback";
import { initSelectionEvents, recordCaptureKeyframes, recordDiscard, recordStart, recordStop, recordTick } from "./recorder";
import { handleMessage, registerHandler } from "./rpc-server";
import { listMacros, removeMacro, renameMacro, saveMacro } from "./store";
import { sendTheme, watchTheme } from "./theme";

// Feature-detected: caches selection:keyframes events for the capture
// offer (the polled getter is empty-in-practice on the live host).
initSelectionEvents();

creator.ui.show({ width: 300, height: 520 });

registerHandler("hello", () => {
  // The docs' "UI is ready" moment: hand the freshly-booted iframe the
  // host's current interface theme alongside the handshake reply.
  sendTheme();
  return { protocolVersion: PROTOCOL_VERSION, rev: ENGINE_REV };
});

registerHandler("store.list", () => listMacros());
registerHandler("store.save", (params) => saveMacro((params as { macro: Macro }).macro));
registerHandler("store.rename", (params) => {
  const { id, name } = params as { id: string; name: string };
  return renameMacro(id, name);
});
registerHandler("store.remove", (params) => removeMacro((params as { id: string }).id));

registerHandler("record.start", (params) =>
  recordStart((params ?? {}) as { debug?: boolean }),
);
registerHandler("record.tick", (params) => recordTick((params as { seq: number }).seq));
registerHandler("record.captureKeyframes", (params) =>
  recordCaptureKeyframes(params as { layerId: string; scope: "all" | "selected" }),
);
registerHandler("record.stop", () => recordStop());
registerHandler("record.discard", () => recordDiscard());

registerHandler("playback.begin", (params) =>
  playbackBegin(params as Parameters<typeof playbackBegin>[0]),
);
registerHandler("playback.step", (params) =>
  playbackStep(params as { index: number }),
);
registerHandler("playback.end", () => playbackEnd());

creator.ui.onMessage((message: unknown) => {
  if (isRpcMessage(message)) {
    handleMessage(message);
  }
});

// Lets a UI that booted before this sandbox (and fell back to mocks) know
// the real engine is available. The iframe usually doesn't exist yet at
// eval time — the host drops the message with a warning; guarded anyway.
try {
  creator.ui.postMessage({ t: "notify", event: "sandbox-ready" });
} catch {
  // ignore — handshake from the UI side covers the normal boot order
}

watchTheme();
sendTheme();
