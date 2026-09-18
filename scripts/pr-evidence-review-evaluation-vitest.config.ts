import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["scripts/pr-evidence-review-evaluation.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000
  },
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } }
});
