import "@lottiefiles/creator-plugins-ui/styles.css";
import "./styles/index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import { createGateways } from "./gateways";
import { AppProvider } from "./state/AppContext";

// Gateway selection handshakes with the plugin sandbox (≤ ~400ms) before
// first render so the UI never flashes mock data inside Creator.
void createGateways().then((gateways) => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AppProvider gateways={gateways}>
        <App gateways={gateways} />
      </AppProvider>
    </StrictMode>,
  );
});
