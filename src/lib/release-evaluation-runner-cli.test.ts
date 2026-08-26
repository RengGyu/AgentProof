import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeReleaseCandidateResultV1, writeReleaseCandidateResultV2 } from "./release-evaluation-runner";

const configuredInputPath = process.env.AGENTPROOF_RELEASE_EVAL_CASES;
const configuredOutputPath = process.env.AGENTPROOF_RELEASE_EVAL_OUTPUT;
if (configuredInputPath || configuredOutputPath) {
  if (!configuredInputPath || !configuredOutputPath) throw new Error("Both release evaluation paths are required.");
  writeReleaseCandidateResultV1(configuredInputPath, configuredOutputPath);
}

describe("release evaluation candidate runner CLI harness", () => {
  it("writes a version-2 result without permitting input-output collision", () => {
    const root = mkdtempSync(join(tmpdir(), "agentproof-release-candidate-v2-"));
    const inputPath = join(root, "cases.json");
    const outputPath = join(root, "candidates.json");
    try {
      writeFileSync(inputPath, JSON.stringify(visibleV2Payload()));
      writeReleaseCandidateResultV2(inputPath, outputPath);
      expect(JSON.parse(readFileSync(outputPath, "utf8"))).toMatchObject({ version: 2, cases: [{ version: 2 }] });
      expect(() => writeReleaseCandidateResultV2(inputPath, inputPath)).toThrow("output path");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
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

function visibleV2Payload() {
  const payload = visibleDevelopmentPayload();
  const headSha = "a".repeat(40);
  const contract = {
    version: 2,
    scope: "complete_objective_set",
    objectives: [{
      id: "doc",
      objective: "Document the command.",
      criteria: [{ id: "literal", type: "artifact", label: "Contains command.", paths: ["docs/command.md"], artifact: { kind: "documentation_literal", literal: "Run tests." } }]
    }]
  };
  return {
    version: 2,
    cases: [{
      version: 2,
      caseId: "1".repeat(64),
      input: {
        ...payload.cases[0].input,
        changedFiles: [{ path: "docs/command.md", status: "modified", patch: "+Run tests." }],
        sourceProvenance: {
          version: 1, origin: "github_snapshot", headSha, baseSha: "b".repeat(40),
          changedFileInventory: { version: 1, completeness: "complete", headSha },
          evidenceCapturedAt: "2026-08-26T00:00:00.000Z",
          inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" }
        },
        verificationCriterionEvidenceV2: { artifactBlobs: [{ path: "docs/command.md", headSha, content: "Run tests." }] },
        verificationContractSourceV2: { kind: "provided_requirement", contract },
        verificationContractBindingV2: { sourceKind: "provided_requirement", sourceIdentity: "manual:test", sourceContent: JSON.stringify(contract), headSha, baseSha: "b".repeat(40) }
      }
    }]
  };
}
