import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "scripts/evaluation-pack-summary.test.ts",
      "scripts/build-eval-pack.test.mjs",
      "scripts/promote-eval-fixture.test.mjs"
    ]
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
});
