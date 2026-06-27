import { describe, expect, it } from "vitest";
import { demoScenarios } from "./sample-data";
import { buildEvidenceIndex } from "./extractors";
import { validateVerificationReport } from "./report-validation";
import { generateVerificationReport } from "./verifier";
import type { PullRequestInput, VerificationReport } from "./types";

describe("generateVerificationReport", () => {
  it("redacts source metadata and strips URL query data before report surfaces", () => {
    const report = generateVerificationReport({
      title: "Fix auth token=super-secret-value",
      url: "https://user:ghp_secret_should_not_leak@github.com/acme/repo/pull/12?token=sk-secret#files",
      author: "bot-token=super-secret-value",
      baseBranch: "main",
      headBranch: "agent/secret=super-secret-value",
      description: "Implemented validation.",
      taskText: "Acceptance criteria: add validation.",
      changedFiles: [],
      checks: [],
      logs: []
    } satisfies PullRequestInput);

    const serialized = JSON.stringify(report.source);
    expect(report.source.url).toBe("https://github.com/acme/repo/pull/12");
    expect(serialized).not.toContain("super-secret-value");
    expect(serialized).not.toContain("ghp_secret_should_not_leak");
    expect(serialized).not.toContain("sk-secret");
    expect(serialized).not.toContain("#files");
  });

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

  it("does not mark CI passed from non-execution checks only", () => {
    const report = generateVerificationReport({
      title: "Fix malformed origin handling",
      description: "Handled malformed Origin headers and added a regression test.",
      taskText: "Acceptance criteria: handle malformed Origin headers and include regression coverage.",
      changedFiles: [
        {
          path: "packages/next/src/server/app-render/action-handler.ts",
          additions: 6,
          deletions: 2,
          status: "modified",
          patch: "+ if (!isValidOriginHeader(origin)) return rejectAction()"
        },
        {
          path: "test/e2e/app-dir/actions-allowed-origins/app-action-malformed-origin.test.ts",
          additions: 18,
          deletions: 0,
          status: "modified",
          patch: "+ it('handles malformed origin headers', async () => {})"
        }
      ],
      checks: [
        { name: "Socket Security coverage tests report", status: "passed", summary: "Project report passed after policy tests" },
        { name: "Vercel Preview tests", status: "passed", summary: "Preview smoke tests completed" },
        { name: "Vercel - Code Owners", status: "passed", summary: "There are no code owners defined" }
      ],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.ciStatus).toBe("unknown");
    expect(report.limitations.join(" ")).toContain("Check status is unknown or incomplete");
    expect(report.requirements.some((requirement) => requirement.status === "met")).toBe(false);
  });

  it("does not mark test/build failed from non-execution check failures", () => {
    const report = generateVerificationReport({
      title: "Fix malformed origin handling",
      description: "Handled malformed Origin headers and added a regression test.",
      taskText: "Acceptance criteria: handle malformed Origin headers and include regression coverage.",
      changedFiles: [
        {
          path: "packages/next/src/server/app-render/action-handler.ts",
          additions: 6,
          deletions: 2,
          status: "modified",
          patch: "+ if (!isValidOriginHeader(origin)) return rejectAction()"
        },
        {
          path: "test/e2e/app-dir/actions-allowed-origins/app-action-malformed-origin.test.ts",
          additions: 18,
          deletions: 0,
          status: "modified",
          patch: "+ it('handles malformed origin headers', async () => {})"
        }
      ],
      checks: [
        { name: "Socket Security: Project Report", status: "failed", summary: "Project report found dependency risks" },
        { name: "Vercel - Code Owners", status: "passed", summary: "There are no code owners defined" }
      ],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.ciStatus).toBe("unknown");
    expect(report.summary.priority).toBe("high");
    expect(report.summary.topRisks).toContain("Static or merge-gate checks failed outside test/build proof.");
    expect(report.requirements.flatMap((requirement) => requirement.gaps).join(" ")).not.toContain("CI has a failing check");
    expect(report.reviewPriority).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "Static or merge-gate checks",
          priority: "high",
          reason: "A non-test/build check failed; review merge policy separately from requirement and execution proof.",
          evidenceRefs: expect.arrayContaining(["ev_5"])
        })
      ])
    );
    expect(report.reprompt.prompt).toContain("Address failing static or merge-gate checks separately");
  });

  it("does not classify CI policy or build provenance gates as test/build execution failures", () => {
    const report = generateVerificationReport({
      title: "Fix malformed origin handling",
      description: "Handled malformed Origin headers and added a regression test.",
      taskText: "Acceptance criteria: handle malformed Origin headers and include regression coverage.",
      changedFiles: [
        {
          path: "packages/next/src/server/app-render/action-handler.ts",
          additions: 6,
          deletions: 2,
          status: "modified",
          patch: "+ if (!isValidOriginHeader(origin)) return rejectAction()"
        },
        {
          path: "test/e2e/app-dir/actions-allowed-origins/app-action-malformed-origin.test.ts",
          additions: 18,
          deletions: 0,
          status: "modified",
          patch: "+ it('handles malformed origin headers', async () => {})"
        }
      ],
      checks: [
        { name: "CI policy", status: "failed", summary: "merge policy failed" },
        { name: "build provenance attestation", status: "failed", summary: "attestation was not created" }
      ],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.ciStatus).toBe("unknown");
    expect(report.summary.priority).toBe("high");
    expect(report.summary.topRisks).toContain("Static or merge-gate checks failed outside test/build proof.");
    expect(report.requirements.flatMap((requirement) => requirement.gaps).join(" ")).not.toContain("CI has a failing check");
    expect(report.reviewPriority.some((item) => item.path === "Test/build checks")).toBe(false);
  });

  it("preserves failure evidence refs when check labels are redacted", () => {
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
        }
      ],
      checks: [
        {
          name: "unit tests ghp_abcdefghijklmnopqrstuvwxyz123456",
          status: "failed",
          summary: "invoice export test failed"
        }
      ],
      logs: []
    } satisfies PullRequestInput);
    const blocker = report.reviewPriority.find((item) => item.path === "Test/build checks");

    expect(JSON.stringify(report)).not.toContain("ghp_");
    expect(report.testing.ciStatus).toBe("failed");
    expect(blocker?.evidenceRefs?.length).toBeGreaterThan(0);
    expect(refsToEvidence(report, blocker?.evidenceRefs ?? []).some((item) => item.kind === "check")).toBe(true);
  });

  it("marks test/build passed when execution-relevant checks pass", () => {
    const report = generateVerificationReport({
      title: "Fix malformed origin handling",
      description: "Handled malformed Origin headers and added a regression test.",
      taskText: "Acceptance criteria: handle malformed Origin headers and include regression coverage.",
      changedFiles: [
        {
          path: "packages/next/src/server/app-render/action-handler.ts",
          additions: 6,
          deletions: 2,
          status: "modified",
          patch: "+ if (!isValidOriginHeader(origin)) return rejectAction()"
        },
        {
          path: "test/e2e/app-dir/actions-allowed-origins/app-action-malformed-origin.test.ts",
          additions: 18,
          deletions: 0,
          status: "modified",
          patch: "+ it('handles malformed origin headers', async () => {})"
        }
      ],
      checks: [
        { name: "build", status: "passed", summary: "Build succeeded" },
        { name: "integration tests", status: "passed", summary: "Origin header tests passed" }
      ],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.ciStatus).toBe("passed");
  });

  it("keeps passing execution evidence on met requirements when diff refs hit the cap", () => {
    const report = generateVerificationReport({
      title: "Validate export evidence report",
      description: "Implemented export evidence report validation.",
      taskText: "Acceptance criteria: validate export evidence report.",
      changedFiles: Array.from({ length: 7 }, (_value, index) => ({
        path: `src/reports/exportEvidenceReport${index}.ts`,
        additions: 8,
        deletions: 1,
        status: "modified" as const,
        patch: "+ validateExportEvidenceReport(exportEvidenceReport)"
      })),
      checks: [
        {
          name: "CI test/build evidence verification",
          status: "passed",
          summary: "validate export evidence report tests passed"
        }
      ],
      logs: []
    } satisfies PullRequestInput);
    const requirement = report.requirements[0];
    const requirementEvidence = refsToEvidence(report, requirement?.evidenceRefs ?? []);
    const validation = validateVerificationReport(report, { mode: "full" });

    expect(requirement?.status).toBe("met");
    expect(requirementEvidence.some((item) => item.kind === "check" && item.summary.startsWith("Status: passed"))).toBe(true);
    expect(validation).toEqual({ valid: true, errors: [] });
  });

  it("does not trust passing words when execution status is unknown", () => {
    const report = generateVerificationReport({
      title: "Add invoice export",
      description: "Added invoice export and tested it.",
      taskText: "Acceptance criteria: add invoice export and tests.",
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
      checks: [
        {
          name: "unit tests: passed",
          status: "unknown",
          summary: "This check name says passed, but GitHub status is unknown."
        }
      ],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.ciStatus).toBe("unknown");
    expect(report.requirements[0]?.status).toBe("partial");
    expect(report.requirements[0]?.gaps.join(" ")).toContain("no passing test check or log");
    expect(report.claims.find((claim) => /tested/i.test(claim.text))?.supported).toBe(false);
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

  it("keeps config changes visible as execution-proof gaps", () => {
    const report = generateVerificationReport({
      title: "Update pylint option parsing",
      description: "Updated setup.cfg parsing and added config coverage.",
      taskText: "Acceptance criteria: support the new config option and include regression coverage.",
      changedFiles: [
        {
          path: "setup.cfg",
          additions: 3,
          deletions: 1,
          status: "modified",
          patch: "+ new-option=yes"
        },
        {
          path: "tests/config/test_config.py",
          additions: 12,
          deletions: 1,
          status: "modified",
          patch: "+ def test_new_option_is_loaded(): pass"
        }
      ],
      checks: [],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.missingTests.some((item) => item.path === "setup.cfg")).toBe(true);
    expect(report.testing.missingTests.find((item) => item.path === "setup.cfg")?.why).toMatch(/Test evidence changed|no passing test check or log/);
  });

  it("keeps all implementation files when execution proof is missing", () => {
    const changedFiles = Array.from({ length: 10 }, (_value, index) => ({
      path: `src/module_${index}.py`,
      additions: 2,
      deletions: 1,
      status: "modified" as const,
      patch: `+ def behavior_${index}(): return ${index}`
    }));
    const report = generateVerificationReport({
      title: "Update module behavior",
      description: "Updated several behavior modules and added a visible test artifact.",
      taskText: "Acceptance criteria: update module behavior and include regression coverage.",
      changedFiles: [
        ...changedFiles,
        {
          path: "tests/test_modules.py",
          additions: 5,
          deletions: 0,
          status: "modified",
          patch: "+ def test_modules(): pass"
        }
      ],
      checks: [],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.missingTests.map((item) => item.path)).toEqual(changedFiles.map((file) => file.path));
  });

  it("treats a related patched test file as partial evidence, not implementation proof", () => {
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

    expect(report.requirements[0]?.status).toBe("partial");
    expect(report.requirements[0]?.status).not.toBe("met");
    expect(report.requirements[0]?.gaps.join(" ")).toContain("matching test artifact changed");
    expect(report.requirements[0]?.reviewerNote).toContain("test-file changes");
  });

  it("does not treat unrelated patched test files as requirement evidence", () => {
    const report = generateVerificationReport({
      title: "Add inline reset error",
      description: "Updated unrelated billing tests.",
      taskText: "Acceptance criteria: show inline error for invalid reset email.",
      changedFiles: [
        {
          path: "src/features/billing/BillingPanel.test.tsx",
          additions: 18,
          deletions: 0,
          status: "modified",
          patch: "+ it('renders the billing total', async () => {})"
        }
      ],
      checks: [{ name: "unit tests", status: "passed", summary: "BillingPanel tests passed" }],
      logs: []
    } satisfies PullRequestInput);

    expect(report.requirements[0]?.status).not.toBe("partial");
    expect(report.requirements[0]?.status).not.toBe("met");
  });

  it("keeps unmatched small-PR requirements unclear while preserving missing-test evidence", () => {
    const report = generateVerificationReport({
      title: "Fix latex parsing of nested fractions",
      description: "Updated string rendering around nested powers.",
      taskText: "Latex parsing of fractions yields wrong expression due to missing brackets in the denominator.",
      changedFiles: [
        {
          path: "sympy/printing/str.py",
          additions: 1,
          deletions: 1,
          status: "modified",
          patch: "+ isinstance(item.base, (Mul, Pow))"
        },
        {
          path: "sympy/printing/tests/test_str.py",
          additions: 2,
          deletions: 0,
          status: "modified",
          patch: "+ assert str(Mul(x, Pow(1/y, -1, evaluate=False), evaluate=False)) == 'x/(1/y)'"
        }
      ],
      checks: [],
      logs: []
    } satisfies PullRequestInput);

    expect(report.requirements.every((requirement) => requirement.status === "unclear" || requirement.status === "missing")).toBe(true);
    expect(report.requirements[0]?.status).not.toBe("met");
    expect(report.requirements[0]?.gaps.join(" ")).toContain("No changed-file evidence");
    expect(report.testing.missingTests.map((item) => item.path)).toContain("sympy/printing/str.py");
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

  it("cites failed execution evidence on requirement findings even without keyword overlap", () => {
    const report = generateVerificationReport({
      title: "Validate invoice export",
      description: "Implemented invoice export validation.",
      taskText: "Acceptance criteria: validate invoice export format.",
      changedFiles: [
        {
          path: "src/billing/invoiceExport.ts",
          additions: 8,
          deletions: 2,
          status: "modified",
          patch: "+ export function invoiceExport() { return csv }"
        }
      ],
      checks: [
        {
          name: "unit tests",
          status: "failed",
          summary: "1 suite failed"
        }
      ],
      logs: []
    } satisfies PullRequestInput);
    const failedRefs = refsToEvidence(report, report.requirements[0]?.evidenceRefs ?? [])
      .filter((item) => item.kind === "check" && item.summary.startsWith("Status: failed"));

    expect(report.requirements[0]?.gaps.join(" ")).toContain("CI has a failing check");
    expect(failedRefs.map((item) => item.label)).toContain("unit tests");
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
