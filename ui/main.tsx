// The library's stylesheet stays, webfont and all. Dropping it in favour of
// `@source`-scanning the library's dist does remove the DM Sans request the
// skin never uses — but the library's components are styled with
// `data-open:animate-in fade-in-0 zoom-in-95`, and `animate-in` is not a core
// Tailwind utility: it comes from a plugin only the library's own build has.
// Scanning finds the class names and generates nothing, so every dialog, menu,
// popover and toast loses its entrance. See docs/design-system.md.
import "@lottiefiles/creator-plugins-ui/styles.css";
import "./styles/index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import { createGateways, type GatewaysBundle } from "./gateways";
import { LocalMacroStore } from "./gateways/localMacroStore";
import { MockPlaybackGateway } from "./gateways/mockPlayback";
import { MockRecorderGateway } from "./gateways/mockRecorder";
import { AppProvider } from "./state/AppContext";

function render(gateways: GatewaysBundle, demoEngine: boolean) {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AppProvider gateways={gateways}>
        <App gateways={gateways} {...(demoEngine ? { demoEngine } : {})} />
      </AppProvider>
    </StrictMode>,
  );
}

/**
 * Mock gateways, built here rather than by `createGateways` — this is the
 * path where that function itself threw.
 */
function fallbackGateways(): GatewaysBundle {
  const recorder = new MockRecorderGateway();
  const playback = new MockPlaybackGateway();
  return {
    kind: "mock",
    recorder,
    playback,
    store: new LocalMacroStore(),
    mocks: { recorder, playback },
  };
}

// Gateway selection handshakes with the plugin sandbox (≤ ~400ms) before
// first render so the UI never flashes mock data inside Creator.
void createGateways().then(
  (gateways) => {
    render(gateways, false);
  },
  (error: unknown) => {
    // A rejected handshake used to leave `#root` empty for the whole session:
    // a blank plugin panel with nothing to read and nothing to press. The
    // demo engine is still a working panel, and the banner in app.tsx says
    // what it is. An empty panel is never the answer.
    console.error("[macro-recorder] gateway selection failed", error);
    try {
      render(fallbackGateways(), true);
    } catch (fallbackError: unknown) {
      console.error("[macro-recorder] demo engine failed too", fallbackError);
      const root = document.getElementById("root");
      if (root) {
        root.textContent =
          "Macro Recorder could not start. Remove and re-add the plugin in Creator.";
        root.setAttribute("role", "alert");
        root.setAttribute("style", "padding:12px;font:12px/1.5 system-ui,sans-serif");
      }
    }
  },
);
