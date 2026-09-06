import { LocalMacroStore } from "./localMacroStore";
import { MockPlaybackGateway } from "./mockPlayback";
import { MockRecorderGateway } from "./mockRecorder";
import { ENGINE_REV } from "../../engine/protocol";
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

/** Background re-handshake: brisk while the sandbox is probably still
 *  booting, then a slow heartbeat that costs one postMessage per tick. */
const REHANDSHAKE_FAST_MS = 1_000;
const REHANDSHAKE_FAST_WINDOW_MS = 20_000;
const REHANDSHAKE_SLOW_MS = 5_000;

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
 * Keep asking for `hello` after the fallback to mocks, and reboot onto the
 * real engine the moment the sandbox answers.
 *
 * The `sandbox-ready` notify below cannot cover this inside Creator: the
 * sandbox posts it at plugin-eval time, when the iframe does not exist yet,
 * so the host drops it — the only host that ever delivers it is one that
 * re-evaluates plugin.js under a live iframe. A UI that lost the ~600 ms
 * race (a cold sandbox, a slow first paint) otherwise sits in demo mode for
 * the whole session with nothing but a manual plugin reload to get out.
 *
 * Only a UI inside a frame retries. A standalone tab (`pnpm dev` at :5173,
 * sandbox-test.html) has no host above it and its mocks are the point, so
 * polling there would be a timer that can never succeed. There is no
 * "use the mocks" dev-strip setting to honour — mock mode is only ever
 * reached by this handshake failing.
 */
function retryHandshake(rpc: RpcClient): void {
  if (window.self === window.top) return;
  const startedAt = Date.now();
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    rpc.call("hello", {}, HANDSHAKE_ATTEMPT_MS).then(
      () => {
        // Same recovery as `sandbox-ready`: the gateway choice is made once,
        // before the first render, so a reload is what swaps it.
        stopped = true;
        window.location.reload();
      },
      () => {
        if (stopped) return;
        const elapsed = Date.now() - startedAt;
        const delay =
          elapsed < REHANDSHAKE_FAST_WINDOW_MS ? REHANDSHAKE_FAST_MS : REHANDSHAKE_SLOW_MS;
        window.setTimeout(tick, delay);
      },
    );
  };
  window.setTimeout(tick, REHANDSHAKE_FAST_MS);
  // Nothing to reload once the page is going away.
  window.addEventListener("pagehide", () => {
    stopped = true;
  });
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
  retryHandshake(rpc);

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
