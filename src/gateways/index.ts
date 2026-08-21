import { LocalMacroStore } from "./localMacroStore";
import { MockPlaybackGateway } from "./mockPlayback";
import { MockRecorderGateway } from "./mockRecorder";
import { ENGINE_REV } from "../../shared/protocol";
import { trace } from "../dev/trace";
import { RpcClient } from "./rpc/bridge";
import { RpcMacroStore } from "./rpc/macroStore";
import { RpcPlaybackGateway } from "./rpc/playbackGateway";
import { RpcRecorderGateway } from "./rpc/recorderGateway";
import type { MacroStore, PlaybackGateway, RecorderGateway } from "./types";

export interface Gateways {
  recorder: RecorderGateway;
  playback: PlaybackGateway;
  store: MacroStore;
}

export interface GatewaysBundle extends Gateways {
  kind: "rpc" | "mock";
  /** Set when the sandbox answered with an older ENGINE_REV than the UI. */
  staleEngine?: { sandboxRev: string; uiRev: string };
  /** Present only in mock mode — drives the DebugStrip. */
  mocks?: {
    recorder: MockRecorderGateway;
    playback: MockPlaybackGateway;
  };
}

const HANDSHAKE_ATTEMPT_MS = 150;
const HANDSHAKE_ATTEMPTS = 4;

async function handshake(
  rpc: RpcClient,
): Promise<{ connected: boolean; staleEngine?: { sandboxRev: string; uiRev: string } }> {
  for (let attempt = 0; attempt < HANDSHAKE_ATTEMPTS; attempt++) {
    try {
      const hello = await rpc.call("hello", {}, HANDSHAKE_ATTEMPT_MS);
      const sandboxRev = hello.rev ?? "pre-rev";
      trace.setContext({ sandboxRev, uiRev: ENGINE_REV });
      if (sandboxRev !== ENGINE_REV) {
        // Creator evaluates plugin.js once at plugin load. A stale engine
        // makes every session misleading — surface it in the UI, not just
        // the console.
        console.warn(
          `[macro-recorder] plugin engine is STALE (sandbox ${sandboxRev}, ui ${ENGINE_REV}) — remove and re-add the plugin in Creator to reload it`,
        );
        return { connected: true, staleEngine: { sandboxRev, uiRev: ENGINE_REV } };
      }
      return { connected: true };
    } catch {
      // sandbox not (yet) answering — retry
    }
  }
  return { connected: false };
}

/**
 * Single seam between the UI and the engine. Inside Creator the plugin
 * sandbox answers the handshake → real RPC gateways; standalone (browser
 * tab, sandbox-test.html) it times out → mocks + DebugStrip.
 */
export async function createGateways(): Promise<GatewaysBundle> {
  const rpc = new RpcClient();
  const { connected, staleEngine } = await handshake(rpc);

  if (connected) {
    return {
      kind: "rpc",
      ...(staleEngine ? { staleEngine } : {}),
      recorder: new RpcRecorderGateway(rpc),
      playback: new RpcPlaybackGateway(rpc),
      store: new RpcMacroStore(rpc),
    };
  }

  // If the sandbox announces itself after we fell back (plugin code
  // re-evaluated by Creator's dev hot-reload), reboot onto the real engine.
  rpc.onNotify((event) => {
    if (event === "sandbox-ready") window.location.reload();
  });

  const mockRecorder = new MockRecorderGateway();
  const mockPlayback = new MockPlaybackGateway();
  return {
    kind: "mock",
    recorder: mockRecorder,
    playback: mockPlayback,
    store: new LocalMacroStore(),
    mocks: { recorder: mockRecorder, playback: mockPlayback },
  };
}
