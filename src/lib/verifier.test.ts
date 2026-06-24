import { describe, expect, it } from "vitest";
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
});
