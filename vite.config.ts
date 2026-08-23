import { creator } from "@lottiefiles/vite-plugin-creator";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { traceServer } from "./scripts/trace-server";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react(), tailwindcss(), creator(), traceServer()],
  // The deck's nameplate reads this. Injected rather than hard-coded so the
  // faceplate can never drift from the released version.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
});
