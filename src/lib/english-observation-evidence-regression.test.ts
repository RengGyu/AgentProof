import { describe, expect, it } from "vitest";
import type { PullRequestInput, RequirementFinding, RequirementProofAxis } from "./types";
import { generateVerificationReport, generateVerificationReportV2FromInput } from "./verifier";

const HEAD_SHA = "a".repeat(40);
const BASE_SHA = "b".repeat(40);

describe("frozen English observation evidence regressions", () => {
  it("keeps an absent-contract outcome unclear without replacing the local observation gap", () => {
    const noContract = generateVerificationReportV2FromInput(searchEmptyStateInput());

    expect(noContract.verificationContract.state).toBe("absent");
    expect(noContract.requirements.every((item) => item.status === "unclear")).toBe(true);
    expect(noContract.verificationContract.gaps).toEqual([
      expect.objectContaining({ kind: "verification_contract_missing" })
    ]);
    expect(noContract.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind))
      .toContain("interaction_proof_missing");
    expect(noContract.requirements[0]?.gaps.join(" ")).toMatch(/interaction/i);
    expect(noContract.requirements[0]?.gaps).not.toContain("Approved verification contract is missing.");
  });

  it("keeps an invalid-contract outcome unclear without replacing the local observation gap", () => {
    const invalidContract = generateVerificationReportV2FromInput(searchEmptyStateInput({
      verificationContractSourceV2: {
        kind: "provided_requirement",
        contract: { version: 2, scope: "complete_objective_set", objectives: [] }
      },
      verificationContractBindingV2: {
        sourceKind: "provided_requirement",
        sourceIdentity: "manual:synthetic-requirement:1",
        sourceContent: "invalid synthetic contract",
        headSha: HEAD_SHA,
        baseSha: BASE_SHA
      }
    }));

    expect(invalidContract.verificationContract.state).toBe("invalid");
    expect(invalidContract.requirements.every((item) => item.status === "unclear")).toBe(true);
    expect(invalidContract.verificationContract.gaps).toEqual([
      expect.objectContaining({ kind: "verification_contract_invalid" })
    ]);
    expect(invalidContract.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind))
      .toContain("interaction_proof_missing");
    expect(invalidContract.requirements[0]?.gaps.join(" ")).toMatch(/interaction/i);
    expect(invalidContract.requirements[0]?.gaps).not.toContain("Verification contract could not be validated.");
  });

  it("keeps helper-only reviewer visibility incomplete without visual evidence", () => {
    const visualOnly = generateVerificationReportV2FromInput(syntheticInput({
      title: "Show important review checks",
      description: "Adds a checks-panel helper and unit test.",
      taskText: "Important checks should be visible before review starts.",
      changedFiles: [
        {
          path: "src/review/ChecksPanel.tsx",
          status: "modified",
          patch: "+ export function ChecksPanel() { return <section>Important checks</section>; }"
        },
        {
          path: "test/checks-panel.test.tsx",
          status: "modified",
          patch: [
            "+ import { ChecksPanel } from '../src/review/ChecksPanel';",
            "+ test('returns the important checks helper', () => { expect(ChecksPanel()).toBeTruthy(); });"
          ].join("\n")
        }
      ],
      checks: [{ name: "checks panel unit tests", status: "passed", summary: "Checks panel unit tests passed." }]
    }));

    expect(visualOnly.requirements[0]?.status).toBe("unclear");
    expect(visualOnly.requirements[0]?.evidenceStatus).toBe("partial");
    expect(axis(visualOnly.requirements[0], "visual")).toMatchObject({
      state: "incomplete",
      evidenceRefs: []
    });
    expect(visualOnly.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind))
      .toContain("visual_proof_missing");
  });

  it("inherits satisfied CI and execution from one bounded workflow antecedent", () => {
    const workflowContinuation = generateVerificationReport(syntheticInput({
      title: "Pin the validation workflow runtime",
      description: "Updates the validation workflow.",
      taskText: [
        "Acceptance criteria:",
        "- Add the validation CI workflow.",
        "- It must configure the validation CI workflow to use Node.js 22 and run npm test."
      ].join("\n"),
      changedFiles: [{
        path: ".github/workflows/validation.yml",
        status: "modified",
        patch: "+ name: Validation CI\n+ uses: actions/setup-node@v4\n+ node-version: 22\n+ run: npm test"
      }],
      checks: [{ name: "Validation CI", status: "passed", summary: "Node.js 22 npm test passed." }]
    }));
    const continuation = workflowContinuation.requirements[1];

    expect(continuation?.proofAxes).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: "ci_configuration", state: "satisfied" }),
      expect.objectContaining({ subject: "execution", state: "satisfied" })
    ]));
    expect(continuation?.proofAxes?.some((item) => item.subject === "implementation")).toBe(false);
    expect(workflowContinuation.proofGraph.nodes[1]?.deterministicRelation).toEqual({
      version: 1,
      kind: "workflow_antecedent",
      antecedentRequirementId: workflowContinuation.requirements[0]!.requirementId
    });
  });

  it("does not inherit CI identity from competing workflow antecedents", () => {
    const ambiguousContinuation = generateVerificationReport(syntheticInput({
      title: "Configure validation workflows",
      description: "Updates two workflows.",
      taskText: [
        "Acceptance criteria:",
        "- Add the validation CI workflow.",
        "- Add the release CI workflow.",
        "- It must use Node.js 22 and run npm test."
      ].join("\n"),
      changedFiles: [{
        path: "src/validation-runner.ts",
        status: "modified",
        patch: "+ export const validationRunner = { node: 22, command: 'npm test' };"
      }],
      checks: [{ name: "Validation runner tests", status: "passed", summary: "Node.js 22 npm test passed." }]
    }));
    const ambiguous = ambiguousContinuation.requirements.at(-1);

    expect(ambiguousContinuation.proofGraph.nodes.at(-1)?.deterministicRelation).toBeUndefined();
    expect(ambiguous?.proofAxes?.some((item) => item.subject === "ci_configuration")).toBe(false);
    expect(ambiguous?.proofAxes?.map((item) => item.subject)).toEqual([
      "implementation",
      "execution"
    ]);
  });

  it("accepts an exact import with two literal cases and exact-head discovered execution", () => {
    const exactIdentity = generateVerificationReportV2FromInput(bothPathsInput());
    const exactFinding = exactIdentity.requirements.at(-1);

    expect(exactIdentity.verificationContract.state).toBe("absent");
    expect(exactFinding).toMatchObject({ status: "unclear", evidenceStatus: "met" });
    expect(axis(exactFinding, "targeted_test")).toMatchObject({ state: "satisfied" });
    expect(axis(exactFinding, "execution")).toMatchObject({ state: "satisfied" });
    expect(exactIdentity.proofGraph.nodes.at(-1)).toMatchObject({
      caseCoverageReceipt: expect.objectContaining({
        version: 1,
        distinctLiteralCaseCount: 2
      })
    });
  });

  it.each([
    {
      name: "no direct import",
      overrides: { testPatch: twoCaseTestPatch("", "repositoryVisibilityLabel") }
    },
    {
      name: "a barrel import",
      overrides: {
        testPatch: twoCaseTestPatch(
          "import { repositoryVisibilityLabel } from '../src/repositories/index.js';",
          "repositoryVisibilityLabel"
        )
      }
    },
    {
      name: "ambiguous implementation identity",
      overrides: {
        additionalChangedFiles: [{
          path: "src/repositories/repository-visibility-legacy.js",
          status: "modified" as const,
          patch: "+ export function repositoryVisibilityLabel(isPrivate) { return isPrivate ? 'Private repository' : 'Public repository'; }"
        }]
      }
    },
    {
      name: "stale-head suite execution",
      overrides: { suiteHeadSha: "f".repeat(40) }
    },
    {
      name: "filtered suite execution",
      overrides: { suiteScope: "explicit_paths" as const }
    }
  ])("fails closed for $name", ({ overrides }) => {
    const report = generateVerificationReportV2FromInput(bothPathsInput(overrides));
    const finding = report.requirements.at(-1);

    expect(finding?.status).toBe("unclear");
    expect(finding?.evidenceStatus).not.toBe("met");
    expect(finding?.proofAxes?.some((item) => item.state === "incomplete")).toBe(true);
    expect(report.proofGraph.nodes.at(-1)?.gapSignals.map((gap) => gap.kind))
      .toContain("missing_targeted_test");
    expect(report.proofGraph.nodes.at(-1)).not.toHaveProperty("caseCoverageReceipt");
  });
});

function axis(
  finding: RequirementFinding | undefined,
  subject: RequirementProofAxis["subject"]
): RequirementProofAxis | undefined {
  return finding?.proofAxes?.find((candidate) => candidate.subject === subject);
}

function syntheticInput(overrides: Partial<PullRequestInput>): PullRequestInput {
  return {
    title: "Synthetic observation evidence regression",
    description: "Local synthetic evidence only.",
    taskText: "",
    taskSource: "issue",
    changedFiles: [],
    checks: [],
    logs: [],
    sourceProvenance: {
      version: 1,
      origin: "github_snapshot",
      headSha: HEAD_SHA,
      baseSha: BASE_SHA,
      changedFileInventory: {
        version: 1,
        completeness: "complete",
        headSha: HEAD_SHA
      },
      evidenceCapturedAt: "2026-08-14T00:00:00.000Z",
      inputFingerprint: {
        version: 1,
        algorithm: "sha256",
        value: "c".repeat(64),
        coverage: "github_metadata"
      }
    },
    ...overrides
  };
}

function searchEmptyStateInput(overrides: Partial<PullRequestInput> = {}): PullRequestInput {
  return syntheticInput({
    title: "Add repository search empty state",
    description: "Adds empty-state behavior and a focused logic test.",
    taskText: "Search results must show an empty-state message when no repositories match.",
    changedFiles: [
      {
        path: "src/repositories/RepositorySearch.js",
        status: "modified",
        patch: "+ export function emptyStateMessage() { return 'No repositories found'; }"
      },
      {
        path: "test/repository-search.test.js",
        status: "modified",
        patch: [
          "+ import { emptyStateMessage } from '../src/repositories/RepositorySearch.js';",
          "+ test('returns the empty state message', () => { expect(emptyStateMessage()).toBe('No repositories found'); });"
        ].join("\n")
      }
    ],
    checks: [{ name: "repository search tests", status: "passed", summary: "Repository search tests passed." }],
    logs: [{ source: "repository search tests", status: "passed", text: "Repository search tests passed." }],
    executionSuites: [{
      headSha: HEAD_SHA,
      status: "passed",
      executionSource: "repository search tests",
      runner: "node_test",
      scope: "repository_discovery",
      testPaths: ["test/repository-search.test.js"]
    }],
    ...overrides
  });
}

interface BothPathsOverrides {
  testPatch?: string;
  additionalChangedFiles?: PullRequestInput["changedFiles"];
  suiteHeadSha?: string;
  suiteScope?: "repository_discovery" | "explicit_paths" | "unknown";
}

function bothPathsInput(overrides: BothPathsOverrides = {}): PullRequestInput {
  const implementationPath = "src/repositories/repository-visibility.js";
  const testPath = "test/repository-visibility.test.js";
  const testPatch = overrides.testPatch ?? twoCaseTestPatch(
    "import { repositoryVisibilityLabel } from '../src/repositories/repository-visibility.js';",
    "repositoryVisibilityLabel"
  );

  return syntheticInput({
    title: "Cover both repository visibility paths",
    description: "Adds repository visibility behavior and focused tests.",
    taskText: [
      "Acceptance criteria:",
      "- Add repositoryVisibilityLabel(isPrivate) for Private and Public repository values and add focused automated tests for both boolean paths."
    ].join("\n"),
    changedFiles: [
      {
        path: implementationPath,
        status: "modified",
        patch: "+ export function repositoryVisibilityLabel(isPrivate) { return isPrivate ? 'Private repository' : 'Public repository'; }"
      },
      ...(overrides.additionalChangedFiles ?? []),
      { path: testPath, status: "modified", patch: testPatch }
    ],
    checks: [{ name: "repository visibility tests", status: "passed", summary: "Repository visibility tests passed." }],
    logs: [{ source: "repository visibility tests", status: "passed", text: "Repository visibility tests passed." }],
    executionSuites: [{
      headSha: overrides.suiteHeadSha ?? HEAD_SHA,
      status: "passed",
      executionSource: "repository visibility tests",
      runner: "node_test",
      scope: overrides.suiteScope ?? "repository_discovery",
      testPaths: [testPath]
    }]
  });
}

function twoCaseTestPatch(importLine: string, exportName: string): string {
  return [
    "+ import assert from 'node:assert/strict';",
    ...(importLine ? [`+ ${importLine}`] : []),
    `+ test('private repository', () => { assert.equal(${exportName}(true), 'Private repository'); });`,
    `+ test('public repository', () => { assert.equal(${exportName}(false), 'Public repository'); });`
  ].join("\n");
}
