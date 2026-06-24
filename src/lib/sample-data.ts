import type { DemoScenarioId, PullRequestInput } from "./types";

const base: Pick<PullRequestInput, "author" | "baseBranch" | "headBranch"> = {
  author: "ai-agent[bot]",
  baseBranch: "main",
  headBranch: "agent/password-reset"
};

export const demoScenarios: Record<DemoScenarioId, PullRequestInput> = {
  clean: {
    ...base,
    title: "Add password reset email validation",
    url: "https://github.com/example/saas-app/pull/42",
    taskText:
      "Add password reset email validation. Acceptance criteria: validate email format before sending reset email; show a helpful inline error for invalid email; keep existing successful reset flow; add tests for invalid and valid email paths.",
    description:
      "Implemented password reset email format validation, inline error messaging, and tests for invalid and valid reset flows.",
    changedFiles: [
      { path: "src/features/auth/PasswordResetForm.tsx", additions: 38, deletions: 9, status: "modified" },
      { path: "src/features/auth/passwordReset.ts", additions: 21, deletions: 4, status: "modified" },
      { path: "src/features/auth/PasswordResetForm.test.tsx", additions: 64, deletions: 0, status: "added" }
    ],
    checks: [
      { name: "lint", status: "passed", summary: "No lint errors" },
      { name: "typecheck", status: "passed", summary: "TypeScript passed" },
      { name: "unit tests", status: "passed", summary: "Password reset tests passed" }
    ],
    logs: [{ source: "unit tests", status: "passed", text: "PasswordResetForm invalid email path passed\nPasswordResetForm valid email path passed" }]
  },
  "scope-creep": {
    ...base,
    title: "Add password reset email validation",
    url: "https://github.com/example/saas-app/pull/43",
    taskText:
      "Add password reset email validation. Acceptance criteria: validate email format before sending reset email; show a helpful inline error for invalid email; add tests for invalid email.",
    description:
      "Added validation and cleaned up auth session behavior while touching shared auth utilities.",
    changedFiles: [
      { path: "src/features/auth/PasswordResetForm.tsx", additions: 34, deletions: 8, status: "modified" },
      { path: "src/features/auth/passwordReset.ts", additions: 18, deletions: 3, status: "modified" },
      { path: "src/features/auth/PasswordResetForm.test.tsx", additions: 22, deletions: 0, status: "added" },
      { path: "src/server/auth/sessionExpiry.ts", additions: 47, deletions: 33, status: "modified" },
      { path: "src/server/auth/permissions.ts", additions: 12, deletions: 19, status: "modified" }
    ],
    checks: [
      { name: "lint", status: "passed", summary: "No lint errors" },
      { name: "unit tests", status: "passed", summary: "Auth tests passed" }
    ],
    logs: [{ source: "unit tests", status: "passed", text: "Password reset invalid email test passed" }]
  },
  "missing-tests": {
    ...base,
    title: "Add password reset email validation",
    url: "https://github.com/example/saas-app/pull/44",
    taskText:
      "Add password reset email validation. Acceptance criteria: validate email format before sending reset email; show inline error; add tests for invalid and valid paths.",
    description:
      "Added email validation and inline errors. No test files were changed because behavior is simple.",
    changedFiles: [
      { path: "src/features/auth/PasswordResetForm.tsx", additions: 42, deletions: 11, status: "modified" },
      { path: "src/features/auth/passwordReset.ts", additions: 16, deletions: 2, status: "modified" }
    ],
    checks: [
      { name: "lint", status: "passed", summary: "No lint errors" },
      { name: "typecheck", status: "passed", summary: "TypeScript passed" }
    ],
    logs: [{ source: "unit tests", status: "unknown", text: "No unit-test log was provided for this PR." }]
  },
  "failed-ci": {
    ...base,
    title: "Add password reset email validation",
    url: "https://github.com/example/saas-app/pull/45",
    taskText:
      "Add password reset email validation. Acceptance criteria: validate email format; preserve successful reset; add tests.",
    description:
      "Added validation and tests for password reset email handling.",
    changedFiles: [
      { path: "src/features/auth/PasswordResetForm.tsx", additions: 35, deletions: 10, status: "modified" },
      { path: "src/features/auth/PasswordResetForm.test.tsx", additions: 51, deletions: 0, status: "added" }
    ],
    checks: [
      { name: "lint", status: "passed", summary: "No lint errors" },
      { name: "unit tests", status: "failed", summary: "1 failing test in PasswordResetForm" }
    ],
    logs: [{ source: "unit tests", status: "failed", text: "FAIL PasswordResetForm.test.tsx\nExpected inline error to be visible, received null" }]
  },
  "vague-task": {
    ...base,
    title: "Improve reset flow",
    url: "https://github.com/example/saas-app/pull/46",
    taskText: "Improve the password reset flow so users have fewer problems.",
    description: "Made several UX improvements to the reset flow and auth copy.",
    changedFiles: [
      { path: "src/features/auth/PasswordResetForm.tsx", additions: 29, deletions: 24, status: "modified" },
      { path: "src/features/auth/resetEmailCopy.ts", additions: 17, deletions: 8, status: "modified" }
    ],
    checks: [{ name: "unit tests", status: "unknown", summary: "No check data was provided" }],
    logs: []
  }
};
