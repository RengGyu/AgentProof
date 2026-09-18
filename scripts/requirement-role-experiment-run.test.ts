import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createOpenAIRequirementRoleExperimentProvider, loadOpenAIKeyFromEnvFile } from "./requirement-role-experiment-live";
import {
  REQUIREMENT_ROLE_EXPERIMENT_TOTAL_TIMEOUT_MS,
  REQUIREMENT_ROLE_EXPERIMENT_WRAPPER_TIMEOUT_MS,
  runRequirementRoleExperiment,
} from "./requirement-role-experiment";

const inputPath = process.env.REQUIREMENT_ROLE_EXPERIMENT_INPUT;
const live = process.env.REQUIREMENT_ROLE_EXPERIMENT_LIVE === "1";
it.skipIf(!inputPath)("writes only a new sanitized experiment result", async () => {
  const corpus: unknown = JSON.parse(readFileSync(inputPath!, "utf8"));
  const output = process.env.REQUIREMENT_ROLE_EXPERIMENT_OUTPUT!;
  const provider = live
    ? createOpenAIRequirementRoleExperimentProvider({ apiKey: loadOpenAIKeyFromEnvFile(process.env.REQUIREMENT_ROLE_EXPERIMENT_KEY_FILE!), journalPath: process.env.REQUIREMENT_ROLE_EXPERIMENT_JOURNAL! })
    : undefined;
  const fd = openSync(output, "wx", 0o600);
  try {
    const result = await runRequirementRoleExperiment(corpus, {
      modelProfile: {
        model: process.env.REQUIREMENT_ROLE_EXPERIMENT_MODEL!,
        promptVersion: "requirement-role-experiment.v1",
        inputFieldPolicyVersion: live ? "live-source-role-research.v1" : "offline-source-role-research.v1",
      },
      provider,
      totalTimeoutMs: live ? REQUIREMENT_ROLE_EXPERIMENT_TOTAL_TIMEOUT_MS : undefined,
    });
    writeFileSync(fd, `${JSON.stringify(result, null, 2)}\n`);
    expect(result.actualCallCount).toBeLessThanOrEqual(30);
    expect(result.actualCallCount === 0).toBe(!live);
  } finally {
    closeSync(fd);
  }
}, live ? REQUIREMENT_ROLE_EXPERIMENT_WRAPPER_TIMEOUT_MS : 5_000);
