import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { isTestFile } from "./extractors";
import {
  isExecutionEvidenceItemSignal,
  isExecutionEvidenceSignal,
  isFailedAmbiguousActionsExecutionSignal
} from "./evidence-status";
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
  "metadata-timeout-with-no-known-execution",
  "non-observed-test-prose"
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

  it.each([
    ["State Label Contract Test", "Status: passed. Contract test completed.", "passed"],
    ["contract test / state label", "Status: passed. pnpm test completed.", "passed"],
    ["Policy Guard Contract Test", "Status: failed. Contract test failed.", "failed"],
    ["Policy Gate Contract Test", "Status: failed. Contract test failed.", "failed"],
    ["Policy Gate", "Status: failed. pnpm test failed.", "failed"],
    ["CONTRACT TEST: guard policy", "Status: failed. vitest failed.", "failed"],
    ["Deployment Unit Test", "Status: passed. pnpm test completed. Coverage report uploaded.", "passed"],
    ["Security Contract Test", "Status: failed. Integration test failed for security behavior.", "failed"],
    ["Documentation Integration Test", "Status: passed. Integration test passed for docs rendering.", "passed"],
    ["Coverage Regression Test", "Status: failed. pnpm test failed before coverage report upload.", "failed"],
    ["Unit Test", "Status: passed. Security review test passed.", "passed"],
    ["Preview E2E Test", "Status: failed. E2E test failed for preview behavior.", "failed"],
    ["Dependency Integration Test", "Status: passed. integration test passed for dependency behavior.", "passed"],
    ["Optional Unit Test", "Status: pending. unit test still running.", "pending"]
  ])("recognizes real contract execution regardless of label/policy word order or casing: %s", (name, summary, expected) => {
    expect(isExecutionEvidenceSignal(name, summary)).toBe(true);
    expect(generateVerificationReport(inputForChecks([{ name, status: expected as CheckStatus, summary }])).testing.ciStatus).toBe(expected);
  });

  it.each([
    ["Label Automation Test", "passed", "Status: passed. pnpm test completed."],
    ["automated labels / contract test", "failed", "Status: failed. vitest failed."],
    ["Static Test Report", "passed", "Status: passed. pnpm test completed."],
    ["Label Test Results", "failed", "Status: failed. pnpm test failed."],
    ["CI", "passed", "Status: passed. Policy note quotes: pnpm test completed."],
    ["CI", "failed", "Status: failed. security report annotation: pnpm test completed."]
  ])("does not promote automation or static narratives: %s", (name, status, summary) => {
    expect(isExecutionEvidenceSignal(name, summary)).toBe(false);
    expect(generateVerificationReport(inputForChecks([{ name, status: status as CheckStatus, summary }])).testing.ciStatus).toBe("unknown");
  });

  it.each([
    ["State Label Contract Test", "Status: passed. Preview deployment published."],
    ["Policy Guard Contract Test", "Status: passed. Static report published."],
    ["Unit Test", "Status: passed. label automation completed."]
  ])("lets an explicit non-execution summary veto an otherwise test-like check title: %s", (name, summary) => {
    expect(isExecutionEvidenceSignal(name, summary)).toBe(false);
    expect(generateVerificationReport(inputForChecks([{ name, status: "passed", summary }])).testing.ciStatus).toBe("unknown");
  });

  it.each([
    ["  STATE LABEL CONTRACT TEST  ", "Status: passed. Unit test completed."],
    ["state / label / contract / test", "Status: passed. pnpm test completed."],
    ["POLICY-GUARD CONTRACT TEST", "Status: passed. test completed."]
  ])("keeps strong execution classification stable under generic text transforms: %s", (name, summary) => {
    expect(isExecutionEvidenceSignal(name, summary)).toBe(true);
  });

  it.each([
    ["CI policy", "Status: passed. Policy requires pnpm test."],
    ["CI policy", "Status: failed. Tests must run before merge."],
    ["CI policy", "Status: passed. Configured to run pnpm test."],
    ["CI policy", "Status: pending. Expected pnpm test after deployment."],
    ["CI policy", "Status: passed. The workflow will run unit tests."],
    ["CI policy", "Status: passed. Tests must be run before merge."],
    ["CI policy", "Status: passed. Unit tests should be run before deployment."],
    ["CI policy", "Status: failed. Integration tests are required to run."],
    ["CI policy", "Status: pending. E2E tests are expected to be run."],
    ["CI policy", "Status: passed. Tests must be run before merge: passed."],
    ["CI policy", "Status: passed. Policy requires pnpm test. pnpm test passed."],
    ["CI policy", "Status: passed. pnpm test is required before merge."],
    ["CI policy", "Status: pending. pnpm test is planned after approval."],
    ["CI policy", "Status: passed. Please run pnpm test locally."],
    ["CI policy", "Status: passed. Command example: pnpm test."],
    ["CI policy", "Status: passed. Documentation: pnpm test."],
    ["policy/check", "Status: failed. POLICY_REQUIRES_PNPM_TEST"]
  ])("does not treat policy, configuration, or planned execution language as execution evidence: %s", (name, summary) => {
    expect(isExecutionEvidenceSignal(name, summary)).toBe(false);
  });

  it.each([
    ["CI", "Status: passed. Tests were not run."],
    ["Unit Test", "Status: passed. Test did not run."],
    ["Any Opaque Test", "Status: passed. No tests executed."],
    ["Integration Test", "Status: passed. Tests skipped."],
    ["CI", "Status: passed. Example: pnpm test passed."],
    ["Unit Test", "Status: passed. Documentation: pnpm test passed."],
    ["CI", "Status: failed. If pnpm test failed, inspect the command output."],
    ["Any Contract Test", "Status: passed. Hypothetical: pnpm test passed."],
    ["CI", "Status: passed. Tests would pass if run."],
    ["Unit Test", "Status: passed. No test execution occurred."],
    ["CI", "Status: passed. Tests cannot run in this environment."],
    ["Unit Test", "Status: passed. Tests failed to run."],
    ["Any Contract Test", "Status: passed. Test execution unavailable."],
    ["CI", "Status: passed. Tests may pass if run."],
    ["Unit Test", "Status: passed. This is a sample pnpm test passed output."],
    ["Unit Test", "Status: passed. Tests have not run."],
    ["Unit Test", "Status: passed. Test result is hypothetical: passed."],
    ["CI", "Status: passed. Tests could not run."],
    ["Unit Test", "Status: passed. Tests cannot execute."],
    ["Unit Test", "Status: passed. Tests did not execute."],
    ["Unit Test", "Status: passed. Tests are not running."],
    ["Unit Test", "Status: passed. Tests haven’t run."],
    ["CI", "Status: passed. This sample output: pnpm test passed."],
    ["CI", "Status: passed. Example output shows pnpm test passed."],
    ["Unit Test", "Status: passed. Tests aren’t running."],
    ["Unit Test", "Status: passed. Tests weren’t run."],
    ["Unit Test", "Status: passed. Test couldn’t run."],
    ["Unit Test", "Status: passed. Tests won’t run."],
    ["Unit Test", "Status: passed. No tests have run."],
    ["Unit Test", "Status: passed. No test result is available."],
    ["Unit Test", "Status: passed. Tests failed before starting."],
    ["Unit Test", "Status: passed. The test was never started."]
  ])("rejects negated, example, documentation, and hypothetical execution prose regardless of a test-like title: %s", (name, summary) => {
    expect(isExecutionEvidenceSignal(name, summary)).toBe(false);
    expect(generateVerificationReport(inputForChecks([{ name, status: "passed", summary }])).testing.ciStatus).toBe("unknown");
  });

  it.each([
    ["CI", "passed", "Status: passed. pnpm test exited with code 0.", "passed"],
    ["CI", "failed", "Status: failed. pnpm test exited with code 1.", "failed"],
    ["CI", "failed", "Status: failed. pnpm test exit code 2.", "failed"],
    ["CI", "failed", "Status: failed. pnpm test exited with code 256.", "failed"],
    ["Opaque Test", "pending", "Status: pending. pnpm test is running.", "pending"],
    ["Preview E2E Test", "pending", "Status: pending. E2E test timed out.", "pending"],
    ["CI", "failed", "Status: failed. pnpm test timeout after 30 seconds.", "failed"],
    ["Optional Unit Test", "pending", "Status: pending. Unit test run cancelled.", "pending"]
  ])("recognizes observed execution result grammar while provider state remains the final truth: %s", (name, providerStatus, summary, expectedStatus) => {
    expect(isExecutionEvidenceItemSignal(name, providerStatus, "", summary)).toBe(true);
    expect(generateVerificationReport(inputForChecks([{ name, status: providerStatus as CheckStatus, summary }])).testing.ciStatus).toBe(expectedStatus);
  });

  it.each([
    ["Test", "Status: passed.", "passed"],
    ["Test", "Status: failed.", "failed"],
    ["Test", "Status: pending.", "pending"],
    ["Test", "Status: unknown.", "unknown"]
  ])("uses the provider conclusion rather than inventing an execution outcome: %s", (name, summary, status) => {
    expect(isExecutionEvidenceSignal(name, summary)).toBe(true);
    expect(generateVerificationReport(inputForChecks([{ name, status: status as CheckStatus, summary }])).testing.ciStatus).toBe(status);
  });

  it("keeps mixed execution aggregation invariant under non-execution insertion and order changes", () => {
    const execution = { name: "Arbitrary Integration Test", status: "failed" as CheckStatus, summary: "Status: failed. integration test failed." };
    const nonExecution = { name: "Preview deployment", status: "passed" as CheckStatus, summary: "Status: passed. Preview deployed." };
    const policy = { name: "Policy", status: "failed" as CheckStatus, summary: "Status: failed. Policy requires pnpm test." };

    expect(generateVerificationReport(inputForChecks([execution, nonExecution, policy])).testing.ciStatus).toBe("failed");
    expect(generateVerificationReport(inputForChecks([policy, nonExecution, execution, nonExecution])).testing.ciStatus).toBe("failed");
  });

  it.each([
    ["MATRIX_VALUE=1", "failed", jobUrl, "Matrix job failed.", true],
    ["MATRIX_VALUE=1", "pending", jobUrl, "Matrix job pending.", true],
    ["MATRIX_VALUE=1", "passed", jobUrl, "Matrix job passed.", false],
    ["MATRIX_VALUE=1", "unknown", jobUrl, "Matrix job unknown.", false],
    ["MATRIX_VALUE=1", "failed", jobUrl, "Matrix job cancelled.", false],
    ["MATRIX_VALUE=1", "pending", jobUrl, "Matrix job canceled.", false],
    ["MATRIX_VALUE=1", "failed", jobUrl, "Unit test run cancelled.", true],
    ["MATRIX_VALUE=1", "failed", "https://github.com/acme/project/actions/runs/100", "Matrix job failed.", false],
    ["MATRIX_VALUE=1", "failed", "https://example.test/job/200", "Matrix job failed.", false]
  ])("keeps Actions matrix fallback bounded by state and exact job URL", (name, status, locator, summary, expected) => {
    expect(isFailedAmbiguousActionsExecutionSignal(name, status, locator, summary)).toBe(expected);
  });

  it.each([
    ["Opaque Unit Test", "passed", "Status: passed. unit test passed.", "", true],
    ["Opaque Dependency Integration Test", "failed", "Status: failed. integration test failed.", "", true],
    ["PREVIEW_E2E=1", "pending", "Status: pending. Matrix job pending.", jobUrl, true],
    ["CI", "passed", "Status: passed. pnpm test exited with code 0.", "", true],
    ["CI", "failed", "Status: failed. pnpm test exited with code 1.", "", true],
    ["CI", "pending", "Status: pending. pnpm test is running.", "", true],
    ["Unit Test", "passed", "Status: passed. Tests were not run.", "", false],
    ["CI", "failed", "Status: failed. If pnpm test failed, inspect output.", jobUrl, false],
    ["Policy", "failed", "Status: failed. pnpm test is required.", jobUrl, false]
  ])("uses the same status-aware shared classifier for check and log evidence: %s", (label, status, text, locator, expected) => {
    expect(isExecutionEvidenceItemSignal(label, status, locator, text)).toBe(expected);
    const checkReport = generateVerificationReport(inputForChecks([{ name: label, status: status as CheckStatus, summary: text, url: locator || undefined }]));
    const logReport = generateVerificationReport({
      ...inputForChecks([]),
      logs: [{ source: label, status: status as CheckStatus, text, url: locator || undefined }]
    });

    expect(checkReport.testing.ciStatus).toBe(logReport.testing.ciStatus);
  });

  it("does not depend on a known check name when explicit execution syntax is present", () => {
    for (const opaqueName of ["spruce-17", "delta_900", "quartz-x4"]) {
      expect(isExecutionEvidenceSignal(`${opaqueName} contract test`, "Status: passed. pnpm test completed.")).toBe(true);
      expect(isExecutionEvidenceSignal(`contract test / ${opaqueName}`, "Status: passed. vitest completed.")).toBe(true);
    }
  });

  it.each([
    ["LABEL_AUTOMATION=1", "failed", "Matrix job failed."],
    ["POLICY=1", "failed", "Matrix job failed."],
    ["PREVIEW=1", "pending", "Matrix job pending."]
  ])("keeps non-execution Actions matrix metadata excluded: %s", (name, status, summary) => {
    expect(isFailedAmbiguousActionsExecutionSignal(name, status, jobUrl, summary)).toBe(false);
  });
});

function inputForChecks(checks: PullRequestInput["checks"]): PullRequestInput {
  return {
    title: "Synthetic execution classification",
    taskSource: "issue",
    taskText: "Preserve deterministic execution evidence classification.",
    description: "Synthetic regression input.",
    changedFiles: [],
    checks,
    logs: [],
    limitations: []
  };
}

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
