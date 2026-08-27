import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import { mergePastedEvidenceForAnalysis } from "./github";
import { validateVerificationReport } from "./report-validation";
import { resolveRuntimeReportValidation } from "./report-runtime-validation";
import type { AnalyzeRequest, PullRequestInput, RequirementProofAxis, VerificationReportV2 } from "./types";
import { generateVerificationReportV2, generateVerificationReportV2FromInput } from "./verifier";

const HEAD_SHA = "a".repeat(40);
const BASE_SHA = "b".repeat(40);
const IMPLEMENTATION_PATH = "src/repositories/name.js";
const TEST_PATH = "test/repository-name.test.js";
const OBJECTIVE = "Implement repositoryName(value) normalization and add regression tests for repositoryName(value) formatting.";
const LOCAL_AXIS_SUBJECTS = new Set<RequirementProofAxis["subject"]>([
  "implementation",
  "targeted_test",
  "execution"
]);
const LOCAL_AXIS_ORDER = ["implementation", "targeted_test", "execution"] as const;

describe("pasted evidence authority transitions", () => {
  it.each([
    ["files only", { changedFiles: "src/repositories/pasted-name.js" }],
    ["checks only", { checks: "repository name regression tests: passed" }],
    ["logs only", { logs: "repository name regression tests: passed" }],
    ["files, checks, and logs", {
      changedFiles: "src/repositories/pasted-name.js\ntest/pasted-name.test.js",
      checks: "repository name regression tests: passed",
      logs: "repository name regression tests: passed"
    }]
  ] satisfies Array<[string, AnalyzeRequest]>)
    ("makes pasted $0 conservative", (_name, request) => withReceiptV2(() => {
      const live = livePositiveInput();
      const merged = mergePastedEvidenceForAnalysis(live, request);
      const report = generateVerificationReportV2FromInput(merged);
      const finding = report.requirements[0];
      const localAxes = localObservationAxes(finding?.proofAxes ?? []);

      expect(merged.sourceProvenance).toMatchObject({
        origin: "pasted_evidence",
        inputFingerprint: { coverage: "pasted_metadata" },
        changedFileInventory: { completeness: "incomplete" }
      });
      expect(merged.sourceProvenance?.headSha).toBeUndefined();
      expect(merged.sourceProvenance?.baseSha).toBeUndefined();
      expect(merged.sourceProvenance?.executionSuites).toBeUndefined();
      expect(merged.verificationContractSourceV2).toBeUndefined();
      expect(merged.verificationContractBindingV2).toBeUndefined();
      expect(merged.verificationCriterionEvidenceV2).toBeUndefined();
      expect(merged.requirementSourceIdentityHash).toBeUndefined();
      expect(merged.resolvedHeadModules).toBeUndefined();
      expect(merged.executionSuites).toBeUndefined();
      expect(merged.checks.every((check) => check.workflowExecutionIdentity === undefined)).toBe(true);
      expect(localAxes.map((axis) => [axis.subject, axis.state])).toEqual([
        ["implementation", "incomplete"],
        ["targeted_test", "incomplete"],
        ["execution", "incomplete"]
      ]);
      expect(localAxes.some((axis) => axis.evidenceRefs.length > 0)).toBe(true);
      expect(localAxes.find((axis) => axis.subject === "execution")?.evidenceRefs).toEqual([]);
      expect(report.proofGraph.nodes[0]?.executionEvidenceRefs).toEqual([]);
      expect(report.proofGraph.failedCheckAssociations?.some((association) => association.state === "linked") ?? false).toBe(false);
      expect(finding?.status).not.toBe("met");
      expect(finding?.evidenceStatus).not.toBe("met");
      expect(report.verificationContract).toMatchObject({ state: "absent", source: null, objectives: [] });
    }));

  it("keeps a pure live GitHub input and its local positive unchanged", () => withReceiptV2(() => {
    const live = livePositiveInput();
    const merged = mergePastedEvidenceForAnalysis(live, {});
    const report = generateVerificationReportV2FromInput(merged);
    const localAxes = localObservationAxes(report.requirements[0]?.proofAxes ?? []);

    expect(merged).toEqual(live);
    expect(merged.sourceProvenance).toMatchObject({
      origin: "github_snapshot",
      headSha: HEAD_SHA,
      baseSha: BASE_SHA,
      changedFileInventory: { completeness: "complete", headSha: HEAD_SHA }
    });
    expect(merged.verificationContractSourceV2).toBe(live.verificationContractSourceV2);
    expect(merged.verificationContractBindingV2).toBe(live.verificationContractBindingV2);
    expect(merged.verificationCriterionEvidenceV2).toBe(live.verificationCriterionEvidenceV2);
    expect(merged.requirementSourceIdentityHash).toBe(live.requirementSourceIdentityHash);
    expect(merged.resolvedHeadModules).toBe(live.resolvedHeadModules);
    expect(merged.executionSuites).toBe(live.executionSuites);
    expect(merged.checks[0]?.workflowExecutionIdentity).toBeDefined();
    expect(localAxes.map((axis) => [axis.subject, axis.state])).toEqual([
      ["implementation", "satisfied"],
      ["targeted_test", "satisfied"],
      ["execution", "satisfied"]
    ]);
    expect(report.proofGraph.nodes[0]?.executionEvidenceRefs.length).toBeGreaterThan(0);
    expect(report.verificationContract.state).toBe("authoritative");
  }));

  it("does not change authority for task-text and description edits alone", () => {
    const live = livePositiveInput();
    const merged = mergePastedEvidenceForAnalysis(live, {
      taskText: "Updated task wording.",
      prDescription: "Updated PR description."
    });

    expect(merged.sourceProvenance).toBe(live.sourceProvenance);
    expect(merged.verificationContractSourceV2).toBe(live.verificationContractSourceV2);
    expect(merged.verificationContractBindingV2).toBe(live.verificationContractBindingV2);
    expect(merged.executionSuites).toBe(live.executionSuites);
    expect(merged.checks[0]?.workflowExecutionIdentity).toBeDefined();
  });

  it("ignores retained active contract inputs when provenance is pasted evidence", () => {
    const input = pastedDocumentationInput(true);
    const report = generateVerificationReportV2FromInput(input);
    const directReport = generateVerificationReportV2({
      input,
      contractSource: input.verificationContractSourceV2!,
      binding: input.verificationContractBindingV2!
    });
    const runtime = resolveRuntimeReportValidation({
      boundary: "generated_private_full",
      input,
      report: directReport,
      requireV2: true
    });

    expect(report.verificationContract).toMatchObject({ state: "absent", source: null, objectives: [] });
    expect(report.requirements.every((requirement) => requirement.status === "unclear")).toBe(true);
    expect(directReport.verificationContract).toMatchObject({ state: "absent", source: null, objectives: [] });
    expect(directReport.requirements.every((requirement) => requirement.status === "unclear")).toBe(true);
    const runtimeContractState = runtime.valid
      ? (runtime.report as Partial<VerificationReportV2>).verificationContract?.state
      : undefined;
    expect(runtimeContractState === "authoritative" || runtimeContractState === "author_claim").toBe(false);
  });

  it("makes every task-documentation proof axis incomplete under pasted provenance", () => {
    const input = pastedDocumentationInput(false);
    const report = generateVerificationReportV2FromInput(input);
    const finding = report.requirements[0];
    const runtime = resolveRuntimeReportValidation({
      boundary: "generated_private_full",
      input,
      report,
      requireV2: true
    });

    expect(finding?.proofAxes).not.toHaveLength(0);
    expect(finding?.proofAxes?.every((axis) => axis.state === "incomplete")).toBe(true);
    expect(finding?.evidenceStatus).toBe("partial");
    expect(finding?.status).toBe("unclear");
    expect(validateVerificationReport(report, { mode: "v2_full" })).toEqual({ valid: true, errors: [] });
    expect(runtime).toMatchObject({ valid: true });
  });

  it("makes every PR-description documentation proof axis incomplete under pasted provenance", () => {
    const input = pastedDocumentationInput(false, "author_claim");
    const report = generateVerificationReportV2FromInput(input);
    const finding = report.requirements[0];

    expect(report.proofGraph.nodes[0]?.sourceQuality).toBe("author_claim");
    expect(finding?.proofAxes).not.toHaveLength(0);
    expect(finding?.proofAxes?.every((axis) => axis.state === "incomplete")).toBe(true);
    expect(["partial", "unclear"]).toContain(finding?.evidenceStatus);
    expect(finding?.status).not.toBe("met");
    expect(validateVerificationReport(report, { mode: "v2_full" })).toEqual({ valid: true, errors: [] });
  });
});

function pastedDocumentationInput(
  retainContractInputs: boolean,
  source: "task" | "author_claim" = "task"
): PullRequestInput {
  const contract = documentationContract();
  return {
    title: "Document reset",
    description: source === "author_claim"
      ? "### Acceptance criteria\nDocument the local reset command with reproducible steps."
      : "Documents the local reset command.",
    taskText: source === "task" ? "Document the local reset command." : "",
    ...(source === "task" ? { taskSource: "issue" as const } : {}),
    changedFiles: [{ path: "docs/reset.md", status: "modified", patch: "+Run pnpm test." }],
    checks: [],
    logs: [],
    ...(retainContractInputs ? {
      requirementSourceIdentityHash: "e".repeat(64),
      verificationContractSourceV2: { kind: "provided_requirement" as const, contract },
      verificationContractBindingV2: {
        sourceKind: "provided_requirement" as const,
        sourceIdentity: "manual:pasted-reset:1",
        sourceContent: JSON.stringify(contract),
        headSha: HEAD_SHA,
        baseSha: BASE_SHA
      },
      verificationCriterionEvidenceV2: {
        artifactBlobs: [{ path: "docs/reset.md", content: "Stop the server.\nRun pnpm test." }]
      }
    } : {}),
    sourceProvenance: {
      version: 1,
      origin: "pasted_evidence",
      changedFileInventory: { version: 1, completeness: "incomplete" },
      evidenceCapturedAt: "2026-08-22T00:00:00.000Z",
      inputFingerprint: {
        version: 1,
        algorithm: "sha256",
        value: "f".repeat(64),
        coverage: "pasted_metadata"
      }
    }
  };
}

function documentationContract() {
  return {
    version: 2,
    scope: "complete_objective_set",
    objectives: [{
      id: "reset_doc",
      objective: "Document the local reset command.",
      criteria: [{
        id: "reset_literal",
        type: "artifact",
        label: "The reset document includes the exact test command.",
        paths: ["docs/reset.md"],
        artifact: { kind: "documentation_literal", literal: "Run pnpm test." }
      }]
    }]
  };
}

function livePositiveInput(): PullRequestInput {
  const moduleSource = "export function repositoryName(value) { return String(value).toLowerCase(); }";
  const contract = {
    version: 2,
    scope: "complete_objective_set",
    objectives: [{
      id: "repository_name",
      objective: OBJECTIVE,
      criteria: [{
        id: "repository_name_value",
        type: "return_value",
        label: "The helper returns the normalized repository name.",
        adapter: {
          id: "node_export_scalar.v1",
          modulePath: IMPLEMENTATION_PATH,
          exportName: "repositoryName",
          moduleFormat: "esm"
        },
        cases: [{ id: "mixed_case", input: "AgentProof", expected: "agentproof" }]
      }]
    }]
  };
  return {
    url: "https://github.com/acme/repo/pull/12",
    title: "Normalize repository names",
    description: "Implements repository name normalization with a regression test.",
    taskText: OBJECTIVE,
    taskSource: "issue",
    requirementSourceIdentityHash: "c".repeat(64),
    verificationContractSourceV2: { kind: "provided_requirement", contract },
    verificationContractBindingV2: {
      sourceKind: "provided_requirement",
      sourceIdentity: "manual:repository-name:1",
      sourceContent: JSON.stringify(contract),
      headSha: HEAD_SHA,
      baseSha: BASE_SHA
    },
    verificationCriterionEvidenceV2: { artifactBlobs: [] },
    changedFiles: [
      {
        path: IMPLEMENTATION_PATH,
        status: "modified",
        patch: `+${moduleSource}`
      },
      {
        path: TEST_PATH,
        status: "modified",
        patch: [
          "+import { repositoryName } from '../src/repositories/name.js';",
          "+test('normalizes repository names', () => { expect(repositoryName('AgentProof')).toBe('agentproof'); });"
        ].join("\n")
      }
    ],
    checks: [{
      name: "repository name regression tests",
      status: "passed",
      summary: "Repository name normalization tests passed.",
      workflowExecutionIdentity: {
        version: 1,
        kind: "workflow_execution_identity",
        workflowPath: ".github/workflows/ci.yml",
        workflowName: "CI",
        workflowId: 101,
        runId: 202,
        runAttempt: 1,
        jobId: 303,
        jobName: "repository name regression tests",
        headSha: HEAD_SHA,
        checkEvidenceRef: "ev_5"
      }
    }],
    logs: [{
      source: "GitHub Actions job: repository name regression tests",
      status: "passed",
      text: "Repository name normalization tests passed."
    }],
    executionSuites: [{
      headSha: HEAD_SHA,
      status: "passed",
      executionSource: "GitHub Actions job: repository name regression tests",
      runner: "node_test",
      scope: "repository_discovery",
      testPaths: [TEST_PATH]
    }],
    resolvedHeadModules: [{
      version: 1,
      kind: "resolved_head_module",
      headSha: HEAD_SHA,
      path: IMPLEMENTATION_PATH,
      blobSha: gitBlobSha(moduleSource),
      source: moduleSource
    }],
    limitations: [],
    sourceProvenance: {
      version: 1,
      origin: "github_snapshot",
      headSha: HEAD_SHA,
      baseSha: BASE_SHA,
      changedFileInventory: { version: 1, completeness: "complete", headSha: HEAD_SHA },
      executionSuites: [{
        headSha: HEAD_SHA,
        status: "passed",
        executionSource: "GitHub Actions job: repository name regression tests",
        runner: "node_test",
        scope: "repository_discovery",
        testPaths: [TEST_PATH]
      }],
      evidenceCapturedAt: "2026-08-22T00:00:00.000Z",
      inputFingerprint: {
        version: 1,
        algorithm: "sha256",
        value: "d".repeat(64),
        coverage: "github_metadata"
      }
    }
  };
}

function withReceiptV2<T>(run: () => T): T {
  const previous = process.env.AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE;
  process.env.AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE = "receipt_v2";
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE;
    else process.env.AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE = previous;
  }
}

function localObservationAxes(axes: readonly RequirementProofAxis[]): RequirementProofAxis[] {
  return axes
    .filter((axis) => LOCAL_AXIS_SUBJECTS.has(axis.subject) && axis.role !== "criterion")
    .sort((left, right) => LOCAL_AXIS_ORDER.indexOf(left.subject as typeof LOCAL_AXIS_ORDER[number]) - LOCAL_AXIS_ORDER.indexOf(right.subject as typeof LOCAL_AXIS_ORDER[number]));
}

function gitBlobSha(source: string): string {
  return createHash("sha1")
    .update(`blob ${Buffer.byteLength(source, "utf8")}\0`)
    .update(source)
    .digest("hex");
}
