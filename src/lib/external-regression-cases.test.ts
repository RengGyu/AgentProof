import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { validateVerificationReport } from "./report-validation";
import type { CheckStatus, PriorityLevel, PullRequestInput, RequirementStatus } from "./types";
import { generateVerificationReport } from "./verifier";

type ExecutableAssertion = {
  id: string;
  caseId: string;
  input?: PullRequestInput;
  inputFactory?: {
    kind: "many-evidence-refs";
    changedFileCount: number;
  };
  expected: {
    testBuildStatus?: CheckStatus;
    mustNotTestBuildStatuses?: CheckStatus[];
    priority?: PriorityLevel;
    validation?: "valid";
    maxRequirementEvidenceRefs?: number;
    maxMetRequirements?: number;
    missingTestCountAtLeast?: number;
    topRiskIncludes?: string;
    requiredProofGapKinds?: string[];
    requiredReviewPriorityPaths?: string[];
    maxRequirementConfidence?: number;
    requiredRequirementStatuses?: RequirementStatus[];
    requiredLimitations?: string[];
  };
};

type ExternalRegressionFixture = {
  privacy: "external-regression-cases-summary-only";
  status: "regression_metadata_needs_human_labeling";
  readinessEvidence: false;
  cases: Array<{ id: string; manualLabelStatus: "not_labeled" }>;
  executableAssertions: ExecutableAssertion[];
};

const fixture = JSON.parse(
  readFileSync(new URL("../../eval/external-regression-cases.json", import.meta.url), "utf8")
) as ExternalRegressionFixture;

describe("external regression executable assertions", () => {
  it("keeps external regression metadata summary-only and unlabelled", () => {
    expect(fixture.privacy).toBe("external-regression-cases-summary-only");
    expect(fixture.status).toBe("regression_metadata_needs_human_labeling");
    expect(fixture.readinessEvidence).toBe(false);
    expect(fixture.cases.every((testCase) => testCase.manualLabelStatus === "not_labeled")).toBe(true);

    const serialized = JSON.stringify(fixture);
    expect(serialized).not.toContain("github_pat_");
    expect(serialized).not.toContain("ghp_");
    expect(serialized).not.toContain("sk-");
    expect(serialized).not.toContain("fullLog");
    expect(serialized).not.toContain("rawDiff");
    expect(serialized).not.toContain("rawPrompt");
  });

  it("has one executable assertion for each regression case", () => {
    const caseIds = new Set(fixture.cases.map((testCase) => testCase.id));
    const executableCaseIds = new Set(fixture.executableAssertions.map((assertion) => assertion.caseId));

    expect(executableCaseIds).toEqual(caseIds);
  });

  it.each(fixture.executableAssertions.map((assertion) => [assertion.id, assertion] as const))(
    "%s holds for the current verifier",
    (_id, assertion) => {
      const report = generateVerificationReport(inputForAssertion(assertion));
      const expected = assertion.expected;

      if (expected.testBuildStatus) {
        expect(report.testing.ciStatus).toBe(expected.testBuildStatus);
      }

      for (const forbiddenStatus of expected.mustNotTestBuildStatuses ?? []) {
        expect(report.testing.ciStatus).not.toBe(forbiddenStatus);
      }

      if (expected.priority) {
        expect(report.summary.priority).toBe(expected.priority);
      }

      if (expected.validation === "valid") {
        expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
      }

      if (expected.maxRequirementEvidenceRefs !== undefined) {
        expect(Math.max(...report.requirements.map((requirement) => requirement.evidenceRefs.length))).toBeLessThanOrEqual(
          expected.maxRequirementEvidenceRefs
        );
      }

      if (expected.maxMetRequirements !== undefined) {
        expect(report.requirements.filter((requirement) => requirement.status === "met").length).toBeLessThanOrEqual(
          expected.maxMetRequirements
        );
      }

      if (expected.requiredRequirementStatuses) {
        expect(report.requirements.length).toBeGreaterThan(0);
        expect(report.requirements.every((requirement) =>
          expected.requiredRequirementStatuses?.includes(requirement.status)
        )).toBe(true);
      }

      if (expected.maxRequirementConfidence !== undefined) {
        expect(Math.max(...report.requirements.map((requirement) => requirement.confidence))).toBeLessThanOrEqual(
          expected.maxRequirementConfidence
        );
      }

      if (expected.missingTestCountAtLeast !== undefined) {
        expect(report.testing.missingTests.length).toBeGreaterThanOrEqual(expected.missingTestCountAtLeast);
      }

      if (expected.topRiskIncludes) {
        expect(report.summary.topRisks.join(" ")).toContain(expected.topRiskIncludes);
      }

      for (const proofGapKind of expected.requiredProofGapKinds ?? []) {
        expect(report.proofGraph.nodes.flatMap((node) => node.gapSignals.map((gap) => gap.kind))).toContain(proofGapKind);
      }

      for (const reviewPath of expected.requiredReviewPriorityPaths ?? []) {
        expect(report.reviewPriority.map((item) => item.path)).toContain(reviewPath);
      }

      for (const limitation of expected.requiredLimitations ?? []) {
        expect(report.limitations).toContain(limitation);
      }
    }
  );
});

function inputForAssertion(assertion: ExecutableAssertion): PullRequestInput {
  if (assertion.input) {
    return assertion.input;
  }

  if (assertion.inputFactory?.kind === "many-evidence-refs") {
    return {
      title: "Many evidence refs",
      taskSource: "issue",
      taskText: "Acceptance criteria: add tests for import coverage.",
      description: "Adds import coverage.",
      changedFiles: Array.from({ length: assertion.inputFactory.changedFileCount }, (_value, index) => ({
        path: `src/import/import-coverage-${index}.ts`,
        status: "modified",
        patch: "importCoverage()"
      })),
      checks: [],
      logs: []
    };
  }

  throw new Error(`Unknown executable assertion input for ${assertion.id}.`);
}
