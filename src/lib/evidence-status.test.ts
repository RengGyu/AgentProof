import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { isTestFile } from "./extractors";
import { isExecutionEvidenceSignal, isFailedAmbiguousActionsExecutionSignal } from "./evidence-status";
import { generateVerificationReport } from "./verifier";
import type { CheckStatus, PriorityLevel, PullRequestInput } from "./types";

type MatrixCase = {
  id: string;
  description: string;
  input: Pick<PullRequestInput, "taskText" | "description" | "changedFiles" | "checks" | "logs" | "limitations">;
  expected: {
    testBuildStatus: CheckStatus;
    priority?: PriorityLevel;
    allowedTestBuildStatuses?: CheckStatus[];
    mustNotBe?: CheckStatus[];
    executionEvidenceFound: boolean;
    selfReportedTestingFound?: boolean;
    changedTestFilesFound?: boolean;
    nonExecutionStatusesExcluded: boolean;
    limitationIncludes: string[];
  };
};

type MatrixFixture = {
  schemaVersion: "evidence-status-matrix.v1";
  privacy: "synthetic-evidence-status-matrix-no-private-data";
  status: "synthetic_regression_fixture";
  cases: MatrixCase[];
};

const fixture = JSON.parse(
  readFileSync(new URL("../../eval/fixtures/evidence-status-matrix.json", import.meta.url), "utf8")
) as MatrixFixture;

const requiredCaseIds = [
  "ci-build-test-success",
  "static-only-passed-checks",
  "lint-typecheck-only",
  "workflow-tests-failure",
  "build-and-test-workflow-failure",
  "generic-build-and-test-workflow-failure-with-passed-subjobs",
  "docs-readthedocs-only",
  "deploy-preview-only",
  "stats-cancelled-only",
  "security-check-only",
  "self-reported-tests-only",
  "changed-test-file-only",
  "changed-test-file-plus-self-report",
  "mixed-relevant-failure-and-success",
  "stats-cancelled-plus-build-and-test-success",
  "codecov-project-failure-only",
  "codecov-failure-plus-unit-tests-passed",
  "changelog-cancelled-only",
  "changelog-cancelled-plus-unit-tests-passed",
  "optional-failed-workflow-plus-unit-tests-passed",
  "real-unit-test-failure-with-codecov-docs-failure",
  "real-build-failure-with-changelog-cancelled",
  "provider-only-failed-status",
  "provider-tests-failure-summary",
  "metadata-timeout-plus-known-failure",
  "python-tox-workflow-failure",
  "metadata-timeout-with-no-known-execution"
];

describe("evidence status ontology matrix", () => {
  it("keeps the fixture bounded and complete", () => {
    expect(fixture.schemaVersion).toBe("evidence-status-matrix.v1");
    expect(fixture.privacy).toBe("synthetic-evidence-status-matrix-no-private-data");
    expect(fixture.status).toBe("synthetic_regression_fixture");
    expect(fixture.cases.map((testCase) => testCase.id)).toEqual(requiredCaseIds);

    const serialized = JSON.stringify(fixture);
    expect(serialized).not.toContain("github.com/");
    expect(serialized).not.toContain("ext-001");
    expect(serialized).not.toContain("sk-");
    expect(serialized).not.toContain("ghp_");
    expect(serialized).not.toContain("github_pat_");
    expect(serialized).not.toContain("BEGIN PRIVATE KEY");
  });

  it.each(fixture.cases.map((testCase) => [testCase.id, testCase] as const))(
    "%s classifies deterministic test/build evidence",
    (_id, testCase) => {
      const input = inputForCase(testCase);
      const report = generateVerificationReport(input);
      const allowedStatuses = testCase.expected.allowedTestBuildStatuses ?? [testCase.expected.testBuildStatus];

      expect(allowedStatuses).toContain(report.testing.ciStatus);
      if (!testCase.expected.allowedTestBuildStatuses) {
        expect(report.testing.ciStatus).toBe(testCase.expected.testBuildStatus);
      }

      for (const forbidden of testCase.expected.mustNotBe ?? []) {
        expect(report.testing.ciStatus).not.toBe(forbidden);
      }
      if (testCase.expected.priority) {
        expect(report.summary.priority).toBe(testCase.expected.priority);
      }

      expect(hasCollectedExecutionEvidence(testCase.input)).toBe(testCase.expected.executionEvidenceFound);
      if (testCase.expected.selfReportedTestingFound !== undefined) {
        expect(detectSelfReportedTesting(testCase.input.description)).toBe(testCase.expected.selfReportedTestingFound);
      }
      if (testCase.expected.changedTestFilesFound !== undefined) {
        expect(testCase.input.changedFiles.some((file) => isTestFile(file.path))).toBe(
          testCase.expected.changedTestFilesFound
        );
      }
      expect(nonExecutionStatusesWereExcluded(testCase, report.testing.ciStatus)).toBe(
        testCase.expected.nonExecutionStatusesExcluded
      );

      for (const limitation of testCase.expected.limitationIncludes) {
        expect(report.limitations).toContain(limitation);
      }
    }
  );
});

describe("execution status classifier guardrails", () => {
  const jobUrl = "https://github.com/acme/project/actions/runs/100/job/200";

  it("excludes Codecov, changelog, optional, and provider-only gates from execution evidence", () => {
    expect(isExecutionEvidenceSignal("codecov/project", "Coverage decreased below threshold.")).toBe(false);
    expect(isExecutionEvidenceSignal("Check Changelog Entry", "Cancelled before release note validation.")).toBe(false);
    expect(isExecutionEvidenceSignal("buildkite/rails", "Buildkite pipeline failed.")).toBe(false);
    expect(isFailedAmbiguousActionsExecutionSignal("Check Changelog Entry", "failed", jobUrl, "Cancelled.")).toBe(false);
    expect(isFailedAmbiguousActionsExecutionSignal("Optional browser smoke", "failed", jobUrl, "Allowed failure.")).toBe(false);
  });

  it("keeps real test/build and opaque matrix failures as execution evidence", () => {
    expect(isExecutionEvidenceSignal("Unit tests", "Pytest failed.")).toBe(true);
    expect(isExecutionEvidenceSignal("Build and Test", "Workflow failed.")).toBe(true);
    expect(isExecutionEvidenceSignal("buildkite/rails", "Rails test suite failed.")).toBe(true);
    expect(isFailedAmbiguousActionsExecutionSignal("PANDAS_FUTURE_INFER_STRING=0", "failed", jobUrl, "Matrix job failed.")).toBe(true);
  });
});

function inputForCase(testCase: MatrixCase): PullRequestInput {
  return {
    title: testCase.description,
    url: undefined,
    taskSource: "issue",
    taskText: testCase.input.taskText,
    description: testCase.input.description,
    changedFiles: testCase.input.changedFiles,
    checks: testCase.input.checks,
    logs: testCase.input.logs,
    limitations: testCase.input.limitations
  };
}

function hasCollectedExecutionEvidence(input: MatrixCase["input"]): boolean {
  return input.checks.some((check) =>
    check.status !== "unknown" && (
      isExecutionEvidenceSignal(check.name, check.summary ?? "", check.url) ||
      isFailedAmbiguousActionsExecutionSignal(check.name, check.status, check.url, check.summary ?? "")
    )
  ) || input.logs.some((log) =>
    Boolean(log.status) && log.status !== "unknown" && (
      isExecutionEvidenceSignal(log.source, log.text, log.url) ||
      isFailedAmbiguousActionsExecutionSignal(log.source, log.status, log.url, log.text)
    )
  );
}

function detectSelfReportedTesting(description: string): boolean {
  return /\b(?:tests?|pytest|vitest|jest|playwright|cypress)\b.+\b(?:passed|success|successfully|ran|run)\b/i.test(description) ||
    /\b(?:passed|success|successfully|ran|run)\b.+\b(?:tests?|pytest|vitest|jest|playwright|cypress)\b/i.test(description);
}

function nonExecutionStatusesWereExcluded(testCase: MatrixCase, actualStatus: CheckStatus): boolean {
  const nonExecutionStatuses = [
    ...testCase.input.checks.filter((check) =>
      !isExecutionEvidenceSignal(check.name, check.summary ?? "", check.url) &&
      !isFailedAmbiguousActionsExecutionSignal(check.name, check.status, check.url, check.summary ?? "")
    ),
    ...testCase.input.logs.filter((log) =>
      !isExecutionEvidenceSignal(log.source, log.text, log.url) &&
      !isFailedAmbiguousActionsExecutionSignal(log.source, log.status, log.url, log.text)
    )
  ];

  if (nonExecutionStatuses.length === 0) {
    return true;
  }

  if (!testCase.expected.executionEvidenceFound) {
    return actualStatus === "unknown";
  }

  return true;
}
