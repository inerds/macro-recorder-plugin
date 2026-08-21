import { creator } from "@lottiefiles/vite-plugin-creator";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { traceServer } from "./scripts/trace-server";

export default defineConfig({
  plugins: [react(), tailwindcss(), creator(), traceServer()],
});
