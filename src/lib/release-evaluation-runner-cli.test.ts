import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeReleaseCandidateResultV1 } from "./release-evaluation-runner";

const configuredInputPath = process.env.AGENTPROOF_RELEASE_EVAL_CASES;
const configuredOutputPath = process.env.AGENTPROOF_RELEASE_EVAL_OUTPUT;
if (configuredInputPath || configuredOutputPath) {
  if (!configuredInputPath || !configuredOutputPath) throw new Error("Both release evaluation paths are required.");
  writeReleaseCandidateResultV1(configuredInputPath, configuredOutputPath);
}

describe("release evaluation candidate runner CLI harness", () => {
  it("writes a version-1 opaque result to an explicit separate output directory", () => {
    const inputRoot = mkdtempSync(join(tmpdir(), "agentproof-release-candidate-input-"));
    const outputRoot = mkdtempSync(join(tmpdir(), "agentproof-release-candidate-output-"));
    const inputPath = join(inputRoot, "cases.json");
    const outputPath = join(outputRoot, "candidates.json");
    try {
      writeFileSync(inputPath, JSON.stringify(visibleDevelopmentPayload()));

      writeReleaseCandidateResultV1(inputPath, outputPath);

      const output = JSON.parse(readFileSync(outputPath, "utf8"));
      expect(output).toMatchObject({ version: 1, cases: [{ version: 1, caseId: "opaque-cli-case" }] });
      expect(output.cases).toHaveLength(1);
      expect(JSON.stringify(output)).not.toContain("repositoryName");
    } finally {
      rmSync(inputRoot, { recursive: true, force: true });
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it("rejects an output path that overwrites the explicit input", () => {
    const root = mkdtempSync(join(tmpdir(), "agentproof-release-candidate-"));
    const inputPath = join(root, "cases.json");
    try {
      writeFileSync(inputPath, JSON.stringify(visibleDevelopmentPayload()));
      expect(() => writeReleaseCandidateResultV1(inputPath, inputPath)).toThrow("output path");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function visibleDevelopmentPayload() {
  return {
    version: 1,
    cases: [{
      version: 1,
      caseId: "opaque-cli-case",
      requirementOrdinals: [0],
      input: {
        title: "Visible development input",
        description: "",
        taskText: "Add a health check.",
        taskSource: "issue",
        changedFiles: [{ path: "src/health.ts", status: "added", patch: "+export const health = () => 'ok';" }],
        checks: [],
        logs: []
      }
    }]
  };
}
