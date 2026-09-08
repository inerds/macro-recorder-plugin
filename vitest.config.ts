import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // `scripts/` holds the documentation tooling, which runs as plain ESM
    // with no build step, so its tests sit outside the three TypeScript
    // projects that `tsc -b` checks.
    include: [
      "ui/**/*.test.ts",
      "engine/**/*.test.ts",
      "sandbox/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
  },
});
