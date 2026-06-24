import { describe, expect, it } from "vitest";
import { demoScenarios } from "./sample-data";
import { generateVerificationReport } from "./verifier";
import type { PullRequestInput, VerificationReport } from "./types";

describe("generateVerificationReport", () => {
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
