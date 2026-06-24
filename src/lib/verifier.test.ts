import { describe, expect, it } from "vitest";
import { demoScenarios } from "./sample-data";
import { generateVerificationReport } from "./verifier";
import type { PullRequestInput } from "./types";

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
});
