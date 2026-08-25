import { describe, expect, it } from "vitest";
import {
  evaluateMaterializedCriterionV2,
  evaluateVerificationCriterionV2,
  type VerificationCriterionEvidenceV2
} from "./verification-criterion-evaluator-v2";
import { materializeVerificationContractV2, parseVerificationContractV2 } from "./verification-contract-v2";

const headSha = "a".repeat(40);

describe("evaluateVerificationCriterionV2", () => {
  it("satisfies a documentation literal only from the exact head artifact", () => {
    const criterion = documentationCriterion();
    const evidence: VerificationCriterionEvidenceV2 = {
      headSha,
      artifactBlobs: [{
        path: "docs/reset.md",
        headSha,
        content: "Stop the local server.\nRun npm test."
      }],
      changedFileInventory: { completeness: "complete", paths: ["docs/reset.md"] },
      evidenceRefsByPath: { "docs/reset.md": ["ev_changed_file"] },
      artifactEvidenceRefsByPath: { "docs/reset.md": ["ev_1"] }
    };

    expect(evaluateVerificationCriterionV2(criterion, evidence)).toEqual({
      criterionId: "reset_instructions",
      state: "satisfied",
      proofAxisRefs: [],
      evidenceRefs: ["ev_1"],
      gapKinds: []
    });
  });

  it("does not satisfy a documentation literal from a missing or mismatched head artifact", () => {
    const criterion = documentationCriterion();
    const evidence: VerificationCriterionEvidenceV2 = {
      headSha,
      artifactBlobs: [{ path: "docs/reset.md", headSha, content: "Stop the local server." }],
      changedFileInventory: { completeness: "complete", paths: ["docs/reset.md"] },
      evidenceRefsByPath: { "docs/reset.md": ["ev_changed_file"] },
      artifactEvidenceRefsByPath: { "docs/reset.md": ["ev_1"] }
    };

    expect(evaluateVerificationCriterionV2(criterion, evidence)).toMatchObject({
      criterionId: "reset_instructions",
      state: "violated",
      evidenceRefs: ["ev_1"],
      gapKinds: ["missing_implementation"]
    });
  });

  it("does not treat a stale artifact blob as exact-head documentation evidence", () => {
    const criterion = documentationCriterion();
    const evidence = {
      headSha,
      artifactBlobs: [{ path: "docs/reset.md", headSha: "b".repeat(40), content: "Run npm test." }],
      changedFileInventory: { completeness: "complete" as const, paths: ["docs/reset.md"] },
      evidenceRefsByPath: { "docs/reset.md": ["ev_changed_file"] },
      artifactEvidenceRefsByPath: { "docs/reset.md": ["ev_artifact"] }
    } as VerificationCriterionEvidenceV2 & {
      artifactEvidenceRefsByPath: Record<string, string[]>;
    };

    expect(evaluateVerificationCriterionV2(criterion, evidence)).toMatchObject({
      state: "unavailable",
      evidenceRefs: []
    });
  });

  it("does not treat an over-limit artifact blob as documentation evidence", () => {
    const criterion = documentationCriterion();
    const evidence = {
      headSha,
      artifactBlobs: [{ path: "docs/reset.md", headSha, content: `${"x".repeat(64 * 1024)}\nRun npm test.` }],
      changedFileInventory: { completeness: "complete" as const, paths: ["docs/reset.md"] },
      evidenceRefsByPath: { "docs/reset.md": ["ev_changed_file"] },
      artifactEvidenceRefsByPath: { "docs/reset.md": ["ev_artifact"] }
    } as VerificationCriterionEvidenceV2 & {
      artifactEvidenceRefsByPath: Record<string, string[]>;
    };

    expect(evaluateVerificationCriterionV2(criterion, evidence)).toMatchObject({
      state: "unavailable",
      evidenceRefs: []
    });
  });

  it("does not satisfy absence from an incomplete changed-file inventory", () => {
    const criterion = absenceCriterion();
    const evidence: VerificationCriterionEvidenceV2 = {
      headSha,
      artifactBlobs: [],
      changedFileInventory: { completeness: "incomplete", paths: [] },
      evidenceRefsByPath: {}
    };

    expect(evaluateVerificationCriterionV2(criterion, evidence)).toEqual({
      criterionId: "no_runtime_change",
      state: "unavailable",
      proofAxisRefs: [],
      evidenceRefs: [],
      gapKinds: ["evidence_unavailable"]
    });
  });

  it("marks absence violated when a new or old changed path enters the prohibited scope", () => {
    const criterion = absenceCriterion();
    const evidence: VerificationCriterionEvidenceV2 = {
      headSha,
      artifactBlobs: [],
      changedFileInventory: {
        completeness: "complete",
        paths: ["src/runtime/new.ts"],
        previousPaths: ["src/runtime/old.ts"]
      },
      evidenceRefsByPath: {
        "src/runtime/new.ts": ["ev_2"],
        "src/runtime/old.ts": ["ev_2"]
      }
    };

    expect(evaluateVerificationCriterionV2(criterion, evidence)).toEqual({
      criterionId: "no_runtime_change",
      state: "violated",
      proofAxisRefs: [],
      evidenceRefs: ["ev_2"],
      gapKinds: ["forbidden_implementation_present"]
    });
  });

  it("does not trust a caller-like Vitest result that asserts its own job tuple", () => {
    const criterion = testCaseCriterion();
    const evidence = {
      headSha,
      artifactBlobs: [],
      changedFileInventory: { completeness: "complete" as const, paths: ["test/repository-name.test.ts"] },
      evidenceRefsByPath: { "test/repository-name.test.ts": ["ev_test"] },
      exactTestCaseExecutions: [{
        version: 1,
        kind: "vitest_json_test_case",
        testPath: "test/repository-name.test.ts",
        passedTestIds: ["repositoryName > returns the repository name unchanged"],
        artifactEvidenceRef: "ev_test_result",
        workflow: {
          workflowPath: ".github/workflows/test.yml",
          workflowId: 101,
          runId: 202,
          runAttempt: 2,
          jobId: 303,
          headSha,
          conclusion: "success" as const,
          checkEvidenceRef: "ev_check"
        }
      }]
    } satisfies VerificationCriterionEvidenceV2 & {
      exactTestCaseExecutions: ExactVitestExecutionFixture[];
    };

    expect(evaluateVerificationCriterionV2(criterion, evidence)).toEqual({
      criterionId: "repository_name_case",
      state: "unavailable",
      proofAxisRefs: [],
      evidenceRefs: [],
      gapKinds: ["evidence_unavailable"]
    });
  });

  it("does not treat a successful GitHub workflow identity as workflow criterion proof", () => {
    const evidence = {
      headSha,
      artifactBlobs: [],
      changedFileInventory: { completeness: "complete" as const, paths: [".github/workflows/ci.yml"] },
      evidenceRefsByPath: { ".github/workflows/ci.yml": ["ev_workflow"] },
      workflowExecution: {
        workflowPath: ".github/workflows/ci.yml",
        workflowName: "CI",
        workflowId: 101,
        runId: 202,
        runAttempt: 1,
        jobId: 303,
        jobName: "test",
        headSha,
        checkEvidenceRef: "ev_check",
        conclusion: "success" as const
      }
    } satisfies VerificationCriterionEvidenceV2 & {
      workflowExecution: WorkflowExecutionFixture;
    };

    expect(evaluateVerificationCriterionV2(workflowJobCriterion(), evidence)).toEqual({
      criterionId: "ci_job",
      state: "unavailable",
      proofAxisRefs: [],
      evidenceRefs: [],
      gapKinds: ["evidence_unavailable"]
    });
  });

  it("does not treat matching code, tests, and passing global CI as return-value proof", () => {
    const evidence = {
      headSha,
      artifactBlobs: [],
      changedFileInventory: {
        completeness: "complete" as const,
        paths: ["src/repositories/repository-visibility.js", "test/repository-visibility.test.js"]
      },
      evidenceRefsByPath: {
        "src/repositories/repository-visibility.js": ["ev_implementation"],
        "test/repository-visibility.test.js": ["ev_test"]
      },
      passingGlobalCheckRef: "ev_check"
    } satisfies VerificationCriterionEvidenceV2 & {
      passingGlobalCheckRef: string;
    };

    expect(evaluateVerificationCriterionV2(returnValueCriterion(), evidence)).toEqual({
      criterionId: "private_label",
      state: "unavailable",
      proofAxisRefs: [],
      evidenceRefs: [],
      gapKinds: ["evidence_unavailable"]
    });
  });

  it("keeps a static positive unavailable unless its closed capability is enabled", () => {
    const parsed = parseVerificationContractV2({
      kind: "provided_requirement",
      contract: {
        version: 2,
        scope: "complete_objective_set",
        objectives: [{ id: "reset", objective: "Document reset.", criteria: [documentationCriterion()] }]
      }
    });
    if (parsed.state !== "authoritative") throw new Error("expected a contract");
    const criterion = materializeVerificationContractV2(parsed, "a".repeat(64)).objectives[0]!.criteria[0]!;
    const evidence: VerificationCriterionEvidenceV2 = {
      headSha,
      artifactBlobs: [{ path: "docs/reset.md", headSha, content: "Run npm test." }],
      changedFileInventory: { completeness: "complete", paths: ["docs/reset.md"] },
      evidenceRefsByPath: { "docs/reset.md": ["ev_changed_file"] },
      artifactEvidenceRefsByPath: { "docs/reset.md": ["ev_1"] }
    };

    expect(evaluateMaterializedCriterionV2({ criterion, bindingDigest: "a".repeat(64), evidence, capabilities: new Set() }))
      .toMatchObject({ state: "unavailable", evidenceRefs: ["ev_1"], gapKinds: ["evidence_unavailable"] });
    expect(evaluateMaterializedCriterionV2({ criterion, bindingDigest: "a".repeat(64), evidence, capabilities: new Set(["documentation_literal"]) }))
      .toMatchObject({ state: "satisfied", evidenceRefs: ["ev_1"] });
  });
});

function documentationCriterion() {
  const parsed = parseVerificationContractV2({
    kind: "provided_requirement",
    contract: {
      version: 2,
      scope: "complete_objective_set",
      objectives: [{
        id: "reset",
        objective: "Document the local reset command.",
        criteria: [{
          id: "reset_instructions",
          type: "artifact",
          label: "The reset document includes the test command.",
          paths: ["docs/reset.md"],
          artifact: { kind: "documentation_literal", literal: "Run npm test." }
        }]
      }]
    }
  });
  if (parsed.state !== "authoritative") throw new Error("expected a contract");
  const criterion = parsed.contract.objectives[0]?.criteria[0];
  if (!criterion || criterion.type !== "artifact") throw new Error("expected documentation criterion");
  return criterion;
}

function absenceCriterion() {
  const parsed = parseVerificationContractV2({
    kind: "provided_requirement",
    contract: {
      version: 2,
      scope: "complete_objective_set",
      objectives: [{
        id: "runtime",
        objective: "Do not change the runtime directory.",
        criteria: [{
          id: "no_runtime_change",
          type: "absence",
          label: "No runtime paths change.",
          prohibitedKind: "path_change",
          scope: [{ kind: "prefix", path: "src/runtime/" }]
        }]
      }]
    }
  });
  if (parsed.state !== "authoritative") throw new Error("expected a contract");
  const criterion = parsed.contract.objectives[0]?.criteria[0];
  if (!criterion || criterion.type !== "absence") throw new Error("expected absence criterion");
  return criterion;
}

function testCaseCriterion() {
  const parsed = parseVerificationContractV2({
    kind: "provided_requirement",
    contract: {
      version: 2,
      scope: "complete_objective_set",
      objectives: [{
        id: "repository_name",
        objective: "Keep the repository name helper covered.",
        criteria: [{
          id: "repository_name_case",
          type: "artifact",
          label: "The exact repository-name test passes.",
          paths: ["test/repository-name.test.ts"],
          artifact: { kind: "test_case", testId: "repositoryName > returns the repository name unchanged" }
        }]
      }]
    }
  });
  if (parsed.state !== "authoritative") throw new Error("expected a contract");
  const criterion = parsed.contract.objectives[0]?.criteria[0];
  if (!criterion || criterion.type !== "artifact") throw new Error("expected test-case criterion");
  return criterion;
}

function workflowJobCriterion() {
  const parsed = parseVerificationContractV2({
    kind: "provided_requirement",
    contract: {
      version: 2,
      scope: "complete_objective_set",
      objectives: [{
        id: "ci",
        objective: "Run the approved CI job.",
        criteria: [{
          id: "ci_job",
          type: "artifact",
          label: "The test job succeeds.",
          paths: [".github/workflows/ci.yml"],
          artifact: { kind: "workflow_job", workflowName: "CI", jobName: "test" }
        }]
      }]
    }
  });
  if (parsed.state !== "authoritative") throw new Error("expected a contract");
  const criterion = parsed.contract.objectives[0]?.criteria[0];
  if (!criterion || criterion.type !== "artifact") throw new Error("expected workflow criterion");
  return criterion;
}

function returnValueCriterion() {
  const parsed = parseVerificationContractV2({
    kind: "provided_requirement",
    contract: {
      version: 2,
      scope: "complete_objective_set",
      objectives: [{
        id: "visibility_label",
        objective: "Return the private repository label.",
        criteria: [{
          id: "private_label",
          type: "return_value",
          label: "The private branch returns the expected label.",
          adapter: {
            id: "node_export_scalar.v1",
            modulePath: "src/repositories/repository-visibility.js",
            exportName: "repositoryVisibilityLabel",
            moduleFormat: "esm"
          },
          cases: [{ id: "private", input: true, expected: "Private repository" }]
        }]
      }]
    }
  });
  if (parsed.state !== "authoritative") throw new Error("expected a contract");
  const criterion = parsed.contract.objectives[0]?.criteria[0];
  if (!criterion || criterion.type !== "return_value") throw new Error("expected return-value criterion");
  return criterion;
}

interface ExactVitestExecutionFixture {
  version: 1;
  kind: "vitest_json_test_case";
  testPath: string;
  passedTestIds: string[];
  artifactEvidenceRef: string;
  workflow: {
    workflowPath: string;
    workflowId: number;
    runId: number;
    runAttempt: number;
    jobId: number;
    headSha: string;
    conclusion: "success";
    checkEvidenceRef: string;
  };
}

interface WorkflowExecutionFixture {
  workflowPath: string;
  workflowName: string;
  workflowId: number;
  runId: number;
  runAttempt: number;
  jobId: number;
  jobName: string;
  headSha: string;
  checkEvidenceRef: string;
  conclusion: "success";
}
