import { describe, expect, it } from "vitest";
import { demoScenarios } from "./sample-data";
import { buildEvidenceIndex } from "./extractors";
import { generateVerificationReport } from "./verifier";
import type { PullRequestInput, VerificationReport } from "./types";

describe("generateVerificationReport", () => {
  it("classifies patched test files as test evidence", () => {
    const evidence = buildEvidenceIndex("", "", [
      {
        path: "src/features/auth/PasswordResetForm.test.tsx",
        additions: 8,
        deletions: 0,
        status: "modified",
        patch: "+ it('shows inline error', async () => {})"
      }
    ], [], []);

    expect(evidence[0]?.kind).toBe("test");
    expect(evidence[0]?.summary).toContain("Patch excerpt");
  });

  it("does not mark a requirement met from a filename-only match", () => {
    const report = generateVerificationReport({
      title: "Add billing validation",
      description: "Added billing validation.",
      taskText: "Acceptance criteria: validate billing email format.",
      changedFiles: [
        {
          path: "src/billing/validation.ts",
          additions: 10,
          deletions: 2,
          status: "modified"
        }
      ],
      checks: [],
      logs: []
    } satisfies PullRequestInput);

    expect(report.requirements[0]?.status).not.toBe("met");
    expect(report.requirements[0]?.gaps.join(" ")).toContain("no diff, test, or log evidence");
  });

  it("flags missing tests for behavior-affecting files", () => {
    const report = generateVerificationReport({
      title: "Add password reset validation",
      description: "Added password reset validation.",
      taskText: "Acceptance criteria: add tests for invalid email.",
      changedFiles: [
        {
          path: "src/features/auth/PasswordResetForm.tsx",
          additions: 10,
          deletions: 2,
          status: "modified",
          patch: "+ if (!email.includes('@')) setError('Invalid email')"
        }
      ],
      checks: [{ name: "lint", status: "passed" }],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.missingTests).toHaveLength(1);
    expect(report.requirements[0]?.status).toBe("partial");
    expect(report.requirements[0]?.gaps.join(" ")).toContain("asks for tests");
  });

  it("recognizes demo test evidence for the invalid email acceptance criterion", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);

    expect(report.requirements[2]?.requirementText).toBe("add tests for invalid email");
    expect(report.requirements[2]?.status).toBe("met");
  });

  it("does not mark test requirements met from test-file patches without passing execution evidence", () => {
    const report = generateVerificationReport({
      title: "Add invalid email tests",
      description: "Added invalid email tests.",
      taskText: "Acceptance criteria: add tests for invalid email.",
      changedFiles: [
        {
          path: "src/features/auth/PasswordResetForm.test.tsx",
          additions: 8,
          deletions: 0,
          status: "modified",
          patch: "+ it.skip('rejects invalid email', async () => {})"
        }
      ],
      checks: [],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.ciStatus).toBe("unknown");
    expect(report.requirements[0]?.status).toBe("partial");
    expect(report.requirements[0]?.gaps.join(" ")).toContain("no passing test check or log");
    expect(report.summary.evidenceCoverage).toBeLessThan(100);
    expect(report.summary.confidence).toBeLessThan(0.85);
  });

  it("does not mark a requirement met from one broad keyword in a diff", () => {
    const report = generateVerificationReport({
      title: "Fix user settings",
      description: "Updated user settings.",
      taskText: "Acceptance criteria: reset billing invoice delivery schedule.",
      changedFiles: [
        {
          path: "src/users/settings.ts",
          additions: 6,
          deletions: 1,
          status: "modified",
          patch: "+ // reset local user preferences after save"
        }
      ],
      checks: [{ name: "unit tests", status: "passed" }],
      logs: []
    } satisfies PullRequestInput);

    expect(report.requirements[0]?.status).not.toBe("met");
    expect(report.reviewPriority.some((item) => item.path === "Requirement evidence")).toBe(true);
  });

  it("does not mark a requirement met from diff-only implementation evidence", () => {
    const report = generateVerificationReport({
      title: "Add billing validation",
      description: "Implemented billing email validation.",
      taskText: "Acceptance criteria: validate billing email format before submit.",
      changedFiles: [
        {
          path: "src/billing/BillingForm.tsx",
          additions: 12,
          deletions: 2,
          status: "modified",
          patch: "+ if (!isValidBillingEmail(email)) setError('Enter a valid billing email')"
        }
      ],
      checks: [],
      logs: []
    } satisfies PullRequestInput);

    expect(report.requirements[0]?.status).toBe("partial");
    expect(report.requirements[0]?.gaps.join(" ")).toContain("no matching test, log, or check evidence");
  });

  it("does not let unrelated passing tests hide missing implementation coverage", () => {
    const report = generateVerificationReport({
      title: "Add password reset validation",
      description: "Added password reset validation and updated billing tests.",
      taskText: "Acceptance criteria: validate password reset email before submit.",
      changedFiles: [
        {
          path: "src/features/auth/PasswordResetForm.tsx",
          additions: 12,
          deletions: 2,
          status: "modified",
          patch: "+ if (!isValidEmail(email)) setError('Enter a valid email address')"
        },
        {
          path: "src/features/billing/BillingPanel.test.tsx",
          additions: 8,
          deletions: 1,
          status: "modified",
          patch: "+ it('renders billing panel totals', async () => {})"
        }
      ],
      checks: [{ name: "unit tests", status: "passed", summary: "BillingPanel tests passed" }],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.missingTests).toHaveLength(1);
    expect(report.testing.missingTests[0]?.path).toBe("src/features/auth/PasswordResetForm.tsx");
    expect(report.testing.missingTests[0]?.why).toContain("none clearly maps");
  });

  it("does not treat a patched test file as implementation proof", () => {
    const report = generateVerificationReport({
      title: "Add inline reset error",
      description: "Added inline reset error tests.",
      taskText: "Acceptance criteria: show inline error for invalid reset email.",
      changedFiles: [
        {
          path: "src/features/auth/PasswordResetForm.test.tsx",
          additions: 18,
          deletions: 0,
          status: "modified",
          patch: "+ it('shows inline error for invalid reset email', async () => {})"
        }
      ],
      checks: [{ name: "unit tests", status: "passed", summary: "PasswordResetForm tests passed" }],
      logs: []
    } satisfies PullRequestInput);

    expect(report.requirements[0]?.status).not.toBe("met");
    expect(report.requirements[0]?.gaps.join(" ")).toContain("No changed-file evidence");
  });

  it("clears missing tests when matching test evidence and passing execution exist", () => {
    const report = generateVerificationReport({
      title: "Add invoice export",
      description: "Added invoice export.",
      taskText: "Acceptance criteria: add invoice export.",
      changedFiles: [
        {
          path: "src/billing/invoiceExport.ts",
          additions: 20,
          deletions: 1,
          status: "modified",
          patch: "+ export function invoiceExport() { return csv }"
        },
        {
          path: "src/billing/invoiceExport.test.ts",
          additions: 16,
          deletions: 0,
          status: "added",
          patch: "+ it('exports invoice CSV', async () => {})"
        }
      ],
      checks: [{ name: "unit tests", status: "passed", summary: "invoiceExport tests passed" }],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.missingTests.some((item) => item.path === "src/billing/invoiceExport.ts")).toBe(false);
  });

  it("keeps vague tasks unclear instead of treating path overlap as proof", () => {
    const report = generateVerificationReport(demoScenarios["vague-task"]);

    expect(report.requirements[0]?.status).toBe("unclear");
    expect(report.requirements[0]?.confidence).toBeLessThanOrEqual(0.25);
    expect(report.scope.suspected).toBe(false);
    expect(report.limitations).toContain("At least one requirement needs human interpretation.");
  });

  it("does not support agent claims from filename-only changed-file evidence", () => {
    const report = generateVerificationReport({
      title: "Update billing validation",
      description: "Updated billing validation.",
      taskText: "Acceptance criteria: validate billing email format.",
      changedFiles: [
        {
          path: "src/billing/validation.ts",
          additions: 5,
          deletions: 1,
          status: "modified"
        }
      ],
      checks: [],
      logs: []
    } satisfies PullRequestInput);

    expect(report.claims[0]?.supported).toBe(false);
    expect(report.claims[0]?.evidenceRefs).toEqual([]);
  });

  it("does not support tested claims without passing check or log evidence", () => {
    const report = generateVerificationReport({
      title: "Test reset validation",
      description: "Tested password reset validation.",
      taskText: "Acceptance criteria: validate expired reset tokens.",
      changedFiles: [
        {
          path: "src/features/auth/reset.test.ts",
          additions: 8,
          deletions: 0,
          status: "modified",
          patch: "+ it('rejects expired reset tokens', () => {})"
        }
      ],
      checks: [],
      logs: []
    } satisfies PullRequestInput);

    expect(report.claims[0]?.text).toBe("Tested password reset validation");
    expect(report.claims[0]?.supported).toBe(false);
    expect(report.claims[0]?.evidenceRefs).toEqual([]);
  });

  it("penalizes summary coverage and confidence for scope, missing tests, and failed CI", () => {
    const clean = generateVerificationReport(demoScenarios.clean);
    const scope = generateVerificationReport(demoScenarios["scope-creep"]);
    const failed = generateVerificationReport(demoScenarios["failed-ci"]);

    expect(scope.summary.evidenceCoverage).toBeLessThan(100);
    expect(scope.summary.confidence).toBeLessThan(clean.summary.confidence);
    expect(failed.summary.priority).toBe("blocker");
    expect(failed.summary.confidence).toBeLessThanOrEqual(0.45);
  });

  it("does not escalate clean demo risk-sensitive files to high priority by default", () => {
    const report = generateVerificationReport(demoScenarios.clean);

    expect(report.summary.priority).not.toBe("high");
    if (report.summary.topRisks.join(" ").includes("No major blocker")) {
      expect(report.summary.priority).toBe("low");
    }
  });

  it("never emits met with evidence gaps", () => {
    const report = generateVerificationReport({
      title: "Add billing validation",
      description: "Implemented billing email validation.",
      taskText: "Acceptance criteria: validate billing email format before submit.",
      changedFiles: [
        {
          path: "src/billing/BillingForm.tsx",
          additions: 12,
          deletions: 2,
          status: "modified",
          patch: "+ if (!isValidBillingEmail(email)) setError('Enter a valid billing email')"
        }
      ],
      checks: [],
      logs: []
    } satisfies PullRequestInput);

    expect(report.requirements.filter((finding) => finding.status === "met").every((finding) => finding.gaps.length === 0)).toBe(true);
  });

  it("treats failed pasted logs as failed CI evidence", () => {
    const report = generateVerificationReport({
      title: "Add export button",
      description: "Added export button.",
      taskText: "Acceptance criteria: add CSV export button.",
      changedFiles: [
        {
          path: "src/components/ExportButton.tsx",
          additions: 12,
          deletions: 0,
          status: "added",
          patch: "+ export function ExportButton() { return <button>Export CSV</button> }"
        }
      ],
      checks: [],
      logs: [{ source: "pasted logs", status: "failed", text: "unit tests failed" }]
    } satisfies PullRequestInput);

    expect(report.testing.ciStatus).toBe("failed");
    expect(report.summary.priority).toBe("blocker");
    expect(report.requirements[0]?.gaps.join(" ")).toContain("failing check");
  });

  it("keeps generated findings tied to evidence refs or explicit gaps", () => {
    for (const input of Object.values(demoScenarios)) {
      const report = generateVerificationReport(input);

      for (const requirement of report.requirements) {
        expect(requirement.evidenceRefs.length > 0 || requirement.gaps.length > 0).toBe(true);
        expectRefsResolve(report, requirement.evidenceRefs);
      }

      for (const missingTest of report.testing.missingTests) {
        expect(missingTest.evidenceRefs.length).toBeGreaterThan(0);
        expectRefsResolve(report, missingTest.evidenceRefs);
      }

      if (report.scope.suspected) {
        expect(report.scope.evidenceRefs?.length ?? 0).toBeGreaterThan(0);
        expectRefsResolve(report, report.scope.evidenceRefs ?? []);
      }

      for (const priority of report.reviewPriority) {
        expect(priority.evidenceRefs?.length ?? 0).toBeGreaterThan(0);
        expectRefsResolve(report, priority.evidenceRefs ?? []);
      }
    }
  });

  it("cites changed-file evidence for scope creep and missing-test findings", () => {
    const scopeReport = generateVerificationReport(demoScenarios["scope-creep"]);
    const scopeEvidence = refsToEvidence(scopeReport, scopeReport.scope.evidenceRefs ?? []);

    expect(scopeEvidence.map((item) => item.locator)).toEqual(
      expect.arrayContaining(["src/server/auth/sessionExpiry.ts", "src/server/auth/permissions.ts"])
    );

    const missingTestReport = generateVerificationReport(demoScenarios["missing-tests"]);
    const missingTest = missingTestReport.testing.missingTests[0];
    const missingEvidence = refsToEvidence(missingTestReport, missingTest?.evidenceRefs ?? []);

    expect(missingTest?.path).toBe("src/features/auth/PasswordResetForm.tsx");
    expect(missingEvidence.some((item) => item.locator === missingTest?.path)).toBe(true);
  });
});

function expectRefsResolve(report: VerificationReport, refs: string[]) {
  const evidenceById = new Map(report.evidenceIndex.map((item) => [item.id, item]));

  for (const ref of refs) {
    const evidence = evidenceById.get(ref);

    expect(evidence, `Expected ${ref} to resolve`).toBeDefined();
    expect(evidence?.kind).toBeTruthy();
    expect(evidence?.summary.length).toBeGreaterThan(0);
    expect(evidence?.summary.length).toBeLessThanOrEqual(3000);
    expect(typeof evidence?.confidence).toBe("number");
    expect(evidence?.locator ?? evidence?.label).toBeTruthy();
  }
}

function refsToEvidence(report: VerificationReport, refs: string[]) {
  const evidenceById = new Map(report.evidenceIndex.map((item) => [item.id, item]));

  return refs.map((ref) => evidenceById.get(ref)).filter((item): item is VerificationReport["evidenceIndex"][number] => Boolean(item));
}
