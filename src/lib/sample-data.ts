import type { DemoScenarioId, PullRequestInput } from "./types";

const base: Pick<PullRequestInput, "author" | "baseBranch" | "headBranch"> = {
  author: "ai-agent[bot]",
  baseBranch: "main",
  headBranch: "agent/evidence-demo"
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
      {
        path: "src/features/auth/PasswordResetForm.tsx",
        additions: 38,
        deletions: 9,
        status: "modified",
        patch: "+ if (!isValidEmail(email)) setError('Enter a valid email address')\n+ return sendPasswordReset(email)"
      },
      { path: "src/features/auth/passwordReset.ts", additions: 21, deletions: 4, status: "modified" },
      {
        path: "src/features/auth/PasswordResetForm.test.tsx",
        additions: 64,
        deletions: 0,
        status: "added",
        patch: "+ it('shows an inline error for invalid email', async () => {})\n+ it('keeps the valid reset path working', async () => {})"
      }
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
      "Added validation, inline error handling, rate limiting, and cleaned up auth session behavior while touching shared auth utilities.",
    changedFiles: [
      {
        path: "src/features/auth/PasswordResetForm.tsx",
        additions: 34,
        deletions: 8,
        status: "modified",
        patch: "+ if (!isValidEmail(email)) setError('Enter a valid email address')"
      },
      { path: "src/features/auth/passwordReset.ts", additions: 18, deletions: 3, status: "modified" },
      {
        path: "src/features/auth/PasswordResetForm.test.tsx",
        additions: 22,
        deletions: 0,
        status: "added",
        patch: "+ it('rejects invalid email before submit', async () => {})"
      },
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
    title: "Add invoice CSV export",
    url: "https://github.com/example/billing-app/pull/44",
    taskText:
      "Add invoice CSV export. Acceptance criteria: let admins export the current invoice table as CSV; include invoice number, customer, amount, and status columns; show an inline error when export permissions fail; add tests for CSV generation and permission errors.",
    description:
      "Added the invoice CSV export button and permission error handling. No test files were changed because the export helper is small.",
    changedFiles: [
      {
        path: "src/billing/InvoiceExportButton.tsx",
        additions: 52,
        deletions: 8,
        status: "modified",
        patch:
          "+ const result = await exportInvoicesToCsv(selectedInvoices)\n+ if (!result.ok) setError('You do not have permission to export invoices')"
      },
      {
        path: "src/billing/exportInvoiceCsv.ts",
        additions: 36,
        deletions: 0,
        status: "added",
        patch:
          "+ return rows.map((invoice) => [invoice.number, invoice.customerName, invoice.amount, invoice.status].join(','))"
      }
    ],
    checks: [
      { name: "lint", status: "passed", summary: "No lint errors" },
      { name: "typecheck", status: "passed", summary: "TypeScript passed" }
    ],
    logs: [{ source: "unit tests", status: "unknown", text: "No unit-test log was provided for this PR." }]
  },
  "failed-ci": {
    ...base,
    title: "Validate workspace invite emails",
    url: "https://github.com/example/collab-app/pull/45",
    taskText:
      "Validate workspace invite emails. Acceptance criteria: reject malformed invite emails before sending; keep valid invites working; add tests for invalid and valid invite paths.",
    description:
      "Added invite email validation and tests for invalid invite addresses.",
    changedFiles: [
      {
        path: "src/team/InviteMemberForm.tsx",
        additions: 39,
        deletions: 12,
        status: "modified",
        patch: "+ if (!isValidInviteEmail(email)) setError('Enter a valid invite email')"
      },
      {
        path: "src/team/InviteMemberForm.test.tsx",
        additions: 48,
        deletions: 0,
        status: "added",
        patch:
          "+ it('shows inline error for malformed invite emails', async () => {})\n+ it('submits a valid invite email', async () => {})"
      }
    ],
    checks: [
      { name: "lint", status: "passed", summary: "No lint errors" },
      { name: "unit tests", status: "failed", summary: "1 failing test in InviteMemberForm" }
    ],
    logs: [
      {
        source: "unit tests",
        status: "failed",
        text: "FAIL InviteMemberForm.test.tsx\nExpected inline error to be visible, received null"
      }
    ]
  },
  "vague-task": {
    ...base,
    title: "Improve project dashboard",
    url: "https://github.com/example/ops-app/pull/46",
    taskText: "Improve the project dashboard so teams understand work faster.",
    description: "Made several UX improvements to the dashboard summary and empty-state copy.",
    changedFiles: [
      {
        path: "src/dashboard/DashboardHome.tsx",
        additions: 31,
        deletions: 22,
        status: "modified",
        patch: "+ <h1>Projects needing attention</h1>\n+ <ProjectSummary density=\"compact\" />"
      },
      {
        path: "src/dashboard/dashboardCopy.ts",
        additions: 14,
        deletions: 6,
        status: "modified",
        patch: "+ export const emptyStateCopy = 'No blocked work needs review right now.'"
      }
    ],
    checks: [{ name: "unit tests", status: "unknown", summary: "No check data was provided" }],
    logs: []
  }
};
