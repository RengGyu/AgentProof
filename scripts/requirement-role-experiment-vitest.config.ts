import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { pool: "threads", fileParallelism: false, isolate: false, testTimeout: 20_000, include: [
    "scripts/requirement-role-experiment.test.ts",
    "scripts/requirement-role-experiment-objectives.test.ts",
    "scripts/requirement-role-experiment-objectives-run.test.ts",
    "scripts/requirement-role-experiment-live.test.ts",
    "scripts/requirement-role-experiment-cli.test.ts",
    "scripts/requirement-source-ablation.test.ts",
    "scripts/requirement-source-ablation-run.test.ts",
    "src/lib/general-pr-structure.test.ts",
    "src/lib/general-pr-semantic-selection.test.ts",
    "src/lib/general-pr-semantic-observer.test.ts",
    "src/lib/general-pr-semantic-proposal.test.ts",
  ] },
});
