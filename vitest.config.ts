import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "scripts/build-eval-pack.test.mjs",
      "scripts/promote-eval-fixture.test.mjs",
      "scripts/smoke-github-comment.test.mjs",
      "scripts/smoke-github-webhook.test.mjs",
      "scripts/smoke-github-webhook-live.test.mjs",
      "scripts/ops-drill-gate-readiness.test.mjs",
      "scripts/smoke-analyze-pr-url.test.mjs",
      "scripts/smoke-real-pr-evaluation.test.mjs",
      "scripts/external-pr-pilot-smoke.test.mjs",
      "scripts/external-pr-pilot-labels.test.mjs",
      "scripts/reviewer-validation-fixture.test.mjs",
      "scripts/p0-beta-readiness.test.mjs",
      "scripts/llm-proof-planner-eval-metadata.test.mjs",
      "scripts/llm-proof-planner-human-ab-core.test.mjs"
    ]
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
});
