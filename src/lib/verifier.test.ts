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

  it("does not mark generic CI summaries about preview tests as execution proof", () => {
    const report = generateVerificationReport({
      title: "Fix malformed origin handling",
      description: "Handled malformed Origin headers.",
      taskText: "Acceptance criteria: handle malformed Origin headers.",
      changedFiles: [
        {
          path: "packages/next/src/server/app-render/action-handler.ts",
          additions: 6,
          deletions: 2,
          status: "modified",
          patch: "+ if (!isValidOriginHeader(origin)) return rejectAction()"
        }
      ],
      checks: [
        {
          name: "CI",
          status: "passed",
          summary: "Vercel Preview tests passed after deployment."
        }
      ],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.ciStatus).toBe("unknown");
    expect(report.requirements.some((requirement) => requirement.status === "met")).toBe(false);
    expect(report.requirements[0]?.gaps.join(" ")).toContain("no matching test, log, or check evidence");
  });

  it("does not let security annotation-shaped text clear missing-test evidence", () => {
    const report = generateVerificationReport({
      title: "Tighten analyze route validation",
      description: "Updated analyze route validation.",
      taskText: "Acceptance criteria: reject invalid analyze requests.",
      changedFiles: [
        {
          path: "src/app/api/analyze/route.ts",
          additions: 8,
          deletions: 2,
          status: "modified",
          patch: "+ return jsonNoStore({ error: 'Provide evidence before analysis.' }, 400)"
        }
      ],
      checks: [
        {
          name: "CI",
          status: "passed",
          summary: "Security report annotation: pnpm test src/app/api/analyze/route.test.ts passed"
        }
      ],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.ciStatus).toBe("unknown");
    expect(report.testing.missingTests.map((item) => item.path)).toContain("src/app/api/analyze/route.ts");
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
    expect(report.testing.missingTests[0]?.why).toContain("no targeted test evidence clearly maps");
  });

  it("keeps broad passing test evidence from hiding missing targeted test mapping", () => {
    const report = generateVerificationReport({
      title: "Refresh report workspace",
      description: "Refreshed report UI and ran the project checks.",
      taskText: "Acceptance criteria: improve report layout and keep export actions readable.",
      changedFiles: [
        {
          path: "src/components/ReportView.tsx",
          additions: 24,
          deletions: 8,
          status: "modified",
          patch: "+ export function ReportView() { return <section className=\"report\">evidence</section> }"
        },
        {
          path: "src/lib/markdown.test.ts",
          additions: 8,
          deletions: 1,
          status: "modified",
          patch: "+ it('exports the evidence report markdown', () => {})"
        }
      ],
      checks: [
        { name: "unit tests", status: "passed", summary: "markdown tests passed" },
        { name: "build", status: "passed", summary: "Next.js build passed" }
      ],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.missingTests.some((item) => item.path === "src/components/ReportView.tsx")).toBe(true);
    expect(report.testing.missingTests[0]?.why).toContain("Passing test evidence exists");
    expect(report.summary.topRisks).toContain("Some changed files have broad test evidence, but no targeted test mapping.");
  });

  it("matches API route changes to smoke tests that exercise the same endpoint", () => {
    const report = generateVerificationReport({
      title: "Tighten analyze route validation",
      description: "Updated analyze route validation and smoke coverage.",
      taskText: "Acceptance criteria: reject invalid analyze requests and keep smoke coverage.",
      changedFiles: [
        {
          path: "src/app/api/analyze/route.ts",
          additions: 8,
          deletions: 2,
          status: "modified",
          patch: "+ return jsonNoStore({ error: 'Provide evidence before analysis.' }, 400)"
        },
        {
          path: "scripts/smoke-analyze-pr-url.test.mjs",
          additions: 12,
          deletions: 1,
          status: "modified",
          patch: "+ await fetch(`${baseUrl}/api/analyze`, { method: 'POST', body: JSON.stringify(payload) })"
        }
      ],
      checks: [{ name: "unit tests", status: "passed", summary: "smoke-analyze-pr-url tests passed" }],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.missingTests.some((item) => item.path === "src/app/api/analyze/route.ts")).toBe(false);
  });

  it("does not match API routes to smoke tests for a different endpoint", () => {
    const report = generateVerificationReport({
      title: "Tighten analyze route validation",
      description: "Updated analyze route validation while report save smoke changed.",
      taskText: "Acceptance criteria: reject invalid analyze requests.",
      changedFiles: [
        {
          path: "src/app/api/analyze/route.ts",
          additions: 8,
          deletions: 2,
          status: "modified",
          patch: "+ return jsonNoStore({ error: 'Provide evidence before analysis.' }, 400)"
        },
        {
          path: "scripts/smoke-analyze-pr-url.test.mjs",
          additions: 12,
          deletions: 1,
          status: "modified",
          patch: "+ await fetch(`${baseUrl}/api/reports`, { method: 'POST', body: JSON.stringify(report) })"
        }
      ],
      checks: [{ name: "unit tests", status: "passed", summary: "report save smoke tests passed" }],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.missingTests.map((item) => item.path)).toContain("src/app/api/analyze/route.ts");
  });

  it("does not let generic Next route test names clear unrelated API routes", () => {
    const report = generateVerificationReport({
      title: "Update saved reports route",
      description: "Updated saved reports route while analyze route tests changed.",
      taskText: "Acceptance criteria: update saved report creation.",
      changedFiles: [
        {
          path: "src/app/api/reports/route.ts",
          additions: 10,
          deletions: 2,
          status: "modified",
          patch: "+ return jsonNoStore({ id, privacy: 'summary-only' }, 201)"
        },
        {
          path: "src/app/api/analyze/route.test.ts",
          additions: 12,
          deletions: 1,
          status: "modified",
          patch: "+ expect(await postAnalyze()).toHaveStatus(400)"
        }
      ],
      checks: [{ name: "unit tests", status: "passed", summary: "analyze route tests passed" }],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.missingTests.map((item) => item.path)).toContain("src/app/api/reports/route.ts");
  });

  it("matches API route families to route tests in the same endpoint family", () => {
    const report = generateVerificationReport({
      title: "Update saved reports route",
      description: "Updated saved reports route and route test coverage.",
      taskText: "Acceptance criteria: update saved report creation.",
      changedFiles: [
        {
          path: "src/app/api/reports/route.ts",
          additions: 10,
          deletions: 2,
          status: "modified",
          patch: "+ return jsonNoStore({ id, privacy: 'summary-only' }, 201)"
        },
        {
          path: "src/app/api/reports/route.test.ts",
          additions: 14,
          deletions: 1,
          status: "modified",
          patch: "+ expect(await postReports()).toMatchObject({ privacy: 'summary-only' })"
        }
      ],
      checks: [{ name: "unit tests", status: "passed", summary: "reports route tests passed" }],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.missingTests.some((item) => item.path === "src/app/api/reports/route.ts")).toBe(false);
  });

  it("matches dynamic API routes to smoke tests that call the route prefix", () => {
    const report = generateVerificationReport({
      title: "Update saved report lookup route",
      description: "Updated saved report lookup and smoke coverage.",
      taskText: "Acceptance criteria: fetch saved reports by id.",
      changedFiles: [
        {
          path: "src/app/api/reports/[id]/route.ts",
          additions: 10,
          deletions: 2,
          status: "modified",
          patch: "+ return jsonNoStore({ report, privacy: 'summary-only' }, 200)"
        },
        {
          path: "scripts/smoke-analyze-pr-url.test.mjs",
          additions: 12,
          deletions: 1,
          status: "modified",
          patch: "+ await fetch(`${baseUrl}/api/reports/saved_1`, { method: 'GET' })"
        }
      ],
      checks: [{ name: "unit tests", status: "passed", summary: "saved report smoke tests passed" }],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.missingTests.some((item) => item.path === "src/app/api/reports/[id]/route.ts")).toBe(false);
  });

  it("uses passing CI step evidence that names an unchanged route test file", () => {
    const report = generateVerificationReport({
      title: "Tighten analyze route validation",
      description: "Updated analyze route validation and ran the existing route test.",
      taskText: "Acceptance criteria: reject invalid analyze requests.",
      changedFiles: [
        {
          path: "src/app/api/analyze/route.ts",
          additions: 8,
          deletions: 2,
          status: "modified",
          patch: "+ return jsonNoStore({ error: 'Provide evidence before analysis.' }, 400)"
        }
      ],
      checks: [],
      logs: [
        {
          source: "GitHub Actions job: CI",
          status: "passed",
          text: "GitHub Actions job CI: passed. Steps: pnpm test src/app/api/analyze/route.test.ts: passed"
        }
      ]
    } satisfies PullRequestInput);

    expect(report.testing.missingTests.some((item) => item.path === "src/app/api/analyze/route.ts")).toBe(false);
  });

  it("keeps broad CI test steps from clearing unchanged targeted test mapping", () => {
    const report = generateVerificationReport({
      title: "Refresh report view copy",
      description: "Updated ReportView behavior and ran the full test suite.",
      taskText: "Acceptance criteria: keep ReportView copy actions working.",
      changedFiles: [
        {
          path: "src/components/ReportView.tsx",
          additions: 14,
          deletions: 3,
          status: "modified",
          patch: "+ <button onClick={() => copyText(markdown, 'report')}>Copy Report</button>"
        }
      ],
      checks: [],
      logs: [
        {
          source: "GitHub Actions job: CI",
          status: "passed",
          text: "GitHub Actions job CI: passed. Steps: pnpm test: passed"
        }
      ]
    } satisfies PullRequestInput);

    expect(report.testing.missingTests.map((item) => item.path)).toContain("src/components/ReportView.tsx");
    expect(report.testing.missingTests[0]?.why).toContain("Passing test evidence exists");
  });

  it("uses passing CI step evidence that names an unchanged component test", () => {
    const report = generateVerificationReport({
      title: "Refresh report view copy",
      description: "Updated ReportView behavior and ran the existing component test.",
      taskText: "Acceptance criteria: keep ReportView copy actions working.",
      changedFiles: [
        {
          path: "src/components/ReportView.tsx",
          additions: 14,
          deletions: 3,
          status: "modified",
          patch: "+ <button onClick={() => copyText(markdown, 'report')}>Copy Report</button>"
        }
      ],
      checks: [],
      logs: [
        {
          source: "GitHub Actions job: unit tests",
          status: "passed",
          text: "Vitest passed src/components/ReportView.test.tsx"
        }
      ]
    } satisfies PullRequestInput);

    expect(report.testing.missingTests.some((item) => item.path === "src/components/ReportView.tsx")).toBe(false);
  });

  it("matches component changes to generic test files only when the test patch names the component symbol", () => {
    const report = generateVerificationReport({
      title: "Refresh report view copy",
      description: "Updated ReportView behavior and test coverage.",
      taskText: "Acceptance criteria: keep ReportView copy actions working.",
      changedFiles: [
        {
          path: "src/components/ReportView.tsx",
          additions: 14,
          deletions: 3,
          status: "modified",
          patch: "+ <button onClick={() => copyText(markdown, 'report')}>Copy Report</button>"
        },
        {
          path: "src/lib/verifier.test.ts",
          additions: 10,
          deletions: 1,
          status: "modified",
          patch: "+ expect(renderedReportViewText).toContain('Copy Report')\n+ expect(ReportView).toBeDefined()"
        }
      ],
      checks: [{ name: "unit tests", status: "passed", summary: "ReportView copy tests passed" }],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.missingTests.some((item) => item.path === "src/components/ReportView.tsx")).toBe(false);
  });

  it("keeps component changes visible when a generic test file does not name the component", () => {
    const report = generateVerificationReport({
      title: "Refresh report view copy",
      description: "Updated ReportView behavior while markdown tests changed.",
      taskText: "Acceptance criteria: keep ReportView copy actions working.",
      changedFiles: [
        {
          path: "src/components/ReportView.tsx",
          additions: 14,
          deletions: 3,
          status: "modified",
          patch: "+ <button onClick={() => copyText(markdown, 'report')}>Copy Report</button>"
        },
        {
          path: "src/lib/markdown.test.ts",
          additions: 10,
          deletions: 1,
          status: "modified",
          patch: "+ expect(markdown).toContain('Verification Priority')"
        }
      ],
      checks: [{ name: "unit tests", status: "passed", summary: "markdown tests passed" }],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.missingTests.map((item) => item.path)).toContain("src/components/ReportView.tsx");
  });

  it("does not let generic component test names clear specific behavior components", () => {
    const report = generateVerificationReport({
      title: "Add invoice export button",
      description: "Added invoice export button while generic button tests changed.",
      taskText: "Acceptance criteria: export invoices from the invoice export button.",
      changedFiles: [
        {
          path: "src/billing/InvoiceExportButton.tsx",
          additions: 18,
          deletions: 3,
          status: "modified",
          patch: "+ <button onClick={exportInvoices}>Export invoices</button>"
        },
        {
          path: "src/components/Button.test.tsx",
          additions: 8,
          deletions: 1,
          status: "modified",
          patch: "+ expect(Button).toRenderWithIcon()"
        }
      ],
      checks: [{ name: "unit tests", status: "passed", summary: "Button tests passed" }],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.missingTests.map((item) => item.path)).toContain("src/billing/InvoiceExportButton.tsx");
  });

  it("does not require unit-test evidence for visual-only component changes with browser QA", () => {
    const report = generateVerificationReport({
      title: "Improve mobile report layout",
      description: "Adjusted ReportView spacing and browser QA.",
      taskText: "Acceptance criteria: improve mobile layout without overlapping text/buttons.",
      changedFiles: [
        {
          path: "src/components/ReportView.tsx",
          additions: 18,
          deletions: 6,
          status: "modified",
          patch: "+ <section className=\"report compact-mobile-layout\">\n+ <p className=\"muted\">Evidence stays readable on mobile.</p>"
        }
      ],
      checks: [
        {
          name: "browser QA",
          status: "passed",
          summary: "Playwright mobile viewport confirmed no overlapping text or buttons"
        }
      ],
      logs: []
    } satisfies PullRequestInput);

    expect(report.requirements[0]?.status).toBe("met");
    expect(report.testing.missingTests.some((item) => item.path === "src/components/ReportView.tsx")).toBe(false);
  });

  it("still flags explicit test requirements when only browser QA exists for component changes", () => {
    const report = generateVerificationReport({
      title: "Add responsive report tests",
      description: "Changed ReportView layout and browser QA.",
      taskText: "Acceptance criteria: add responsive ReportView layout tests.",
      changedFiles: [
        {
          path: "src/components/ReportView.tsx",
          additions: 18,
          deletions: 6,
          status: "modified",
          patch: "+ <section className=\"report compact-mobile-layout\">\n+ <p className=\"muted\">Evidence stays readable on mobile.</p>"
        }
      ],
      checks: [
        {
          name: "browser QA",
          status: "passed",
          summary: "Playwright mobile viewport confirmed responsive report layout"
        }
      ],
      logs: []
    } satisfies PullRequestInput);

    expect(report.requirements[0]?.status).toBe("partial");
    expect(report.testing.missingTests.map((item) => item.path)).toContain("src/components/ReportView.tsx");
  });

  it("does not add missing-test findings for docs and style-only changes", () => {
    const report = generateVerificationReport({
      title: "Refresh review handoff docs and mobile styles",
      description: "Updated docs and CSS only.",
      taskText: "Acceptance criteria: improve mobile spacing and review handoff wording.",
      changedFiles: [
        {
          path: "docs/review-handoff.md",
          additions: 8,
          deletions: 2,
          status: "modified",
          patch: "+ Run the demo on mobile and desktop."
        },
        {
          path: "src/app/globals.css",
          additions: 12,
          deletions: 3,
          status: "modified",
          patch: "+ .report-actions { grid-template-columns: 1fr; }"
        }
      ],
      checks: [],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.missingTests).toEqual([]);
  });

  it("treats changed mjs scripts as behavior-affecting when no test evidence exists", () => {
    const report = generateVerificationReport({
      title: "Update analyze smoke script",
      description: "Changed the analyze smoke request parser.",
      taskText: "Acceptance criteria: keep analyze smoke requests valid.",
      changedFiles: [
        {
          path: "scripts/smoke-analyze-pr-url.mjs",
          additions: 14,
          deletions: 5,
          status: "modified",
          patch: "+ const payload = buildAnalyzePayload(process.env.AGENTPROOF_SMOKE_PR_URL)"
        }
      ],
      checks: [],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.missingTests.map((item) => item.path)).toContain("scripts/smoke-analyze-pr-url.mjs");
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

  it("does not flag report UI/docs/style files as scope creep when the task names those surfaces", () => {
    const report = generateVerificationReport({
      title: "Refresh AgentProof report UX",
      description:
        "Reframe the workspace around evidence. Rework report sections. Align export and comment copy.",
      taskText:
        "Refresh AgentProof UI/UX for mobile and portfolio readiness. Acceptance criteria: preserve evidence-based verifier positioning; make the report readable in 30 seconds; improve mobile layout without overlapping text/buttons; keep summary-only privacy boundaries visible; keep GitHub comment/export flows explicit and human-triggered; avoid generic AI code reviewer language.",
      changedFiles: [
        {
          path: "src/app/globals.css",
          additions: 90,
          deletions: 24,
          status: "modified",
          patch: "+ .report-actions { flex-wrap: wrap; }"
        },
        {
          path: "src/components/AnalyzeWorkspace.tsx",
          additions: 45,
          deletions: 18,
          status: "modified",
          patch: "+ <small>Share surfaces stay summary-only; full export is explicit.</small>"
        },
        {
          path: "src/components/ReportView.tsx",
          additions: 120,
          deletions: 42,
          status: "modified",
          patch: "+ <p className=\"eyebrow\">Verification report</p>"
        },
        {
          path: "src/lib/markdown.ts",
          additions: 12,
          deletions: 4,
          status: "modified",
          patch: "+ lines.push('Evidence-based verification report')"
        },
        {
          path: "docs/review-handoff.md",
          additions: 20,
          deletions: 5,
          status: "modified",
          patch: "+ Confirm mobile layout and summary-only sharing."
        }
      ],
      checks: [
        { name: "unit tests", status: "passed", summary: "report tests passed" },
        { name: "build", status: "passed", summary: "Next.js build passed" }
      ],
      logs: []
    } satisfies PullRequestInput);

    expect(report.scope.outOfScopeFiles).not.toEqual(
      expect.arrayContaining([
        "src/app/globals.css",
        "src/components/AnalyzeWorkspace.tsx",
        "src/components/ReportView.tsx",
        "src/lib/markdown.ts",
        "docs/review-handoff.md"
      ])
    );
  });

  it("still flags risky out-of-scope files when patch text only incidentally mentions requirement words", () => {
    const report = generateVerificationReport({
      title: "Add invoice CSV export",
      description: "Added invoice CSV export and cleaned up auth session expiry.",
      taskText: "Acceptance criteria: export invoices as CSV.",
      changedFiles: [
        {
          path: "src/billing/exportInvoiceCsv.ts",
          additions: 24,
          deletions: 2,
          status: "modified",
          patch: "+ export function exportInvoiceCsv() { return csv }"
        },
        {
          path: "src/server/auth/sessionExpiry.ts",
          additions: 12,
          deletions: 4,
          status: "modified",
          patch: "+ // refresh session after invoice export completes"
        }
      ],
      checks: [{ name: "unit tests", status: "passed", summary: "invoice export tests passed" }],
      logs: []
    } satisfies PullRequestInput);

    expect(report.scope.outOfScopeFiles).toContain("src/server/auth/sessionExpiry.ts");
  });

  it("does not require visual QA for functional button requirements with targeted test evidence", () => {
    const report = generateVerificationReport({
      title: "Add invoice export button",
      description: "Added invoice export button and tests.",
      taskText: "Acceptance criteria: add invoice export button and tests.",
      changedFiles: [
        {
          path: "src/billing/InvoiceExportButton.tsx",
          additions: 24,
          deletions: 4,
          status: "modified",
          patch: "+ <button onClick={exportInvoices}>Export invoices</button>"
        },
        {
          path: "src/billing/InvoiceExportButton.test.tsx",
          additions: 18,
          deletions: 0,
          status: "added",
          patch: "+ it('exports invoices from the export button', async () => {})"
        }
      ],
      checks: [{ name: "unit tests", status: "passed", summary: "InvoiceExportButton tests passed" }],
      logs: []
    } satisfies PullRequestInput);

    expect(report.requirements[0]?.status).toBe("met");
    expect(report.requirements[0]?.gaps.join(" ")).not.toContain("visual QA");
  });

  it("keeps visual UX requirements partial without browser or screenshot evidence", () => {
    const report = generateVerificationReport({
      title: "Improve mobile report layout",
      description: "Improved mobile layout and readable buttons.",
      taskText: "Acceptance criteria: improve mobile layout without overlapping text/buttons.",
      changedFiles: [
        {
          path: "src/app/globals.css",
          additions: 24,
          deletions: 6,
          status: "modified",
          patch:
            "+ /* mobile layout: prevent overlapping report text and buttons */\n+ .report-actions { display: grid; grid-template-columns: 1fr; }"
        }
      ],
      checks: [
        { name: "unit tests", status: "passed", summary: "tests passed" },
        { name: "build", status: "passed", summary: "build passed" }
      ],
      logs: []
    } satisfies PullRequestInput);

    expect(report.requirements[0]?.status).toBe("partial");
    expect(report.requirements[0]?.gaps.join(" ")).toContain("visual QA");
    expect(report.requirements[0]?.reviewerNote).toContain("CI/build evidence");
  });

  it("does not treat deployment preview screenshots as visual QA proof", () => {
    const report = generateVerificationReport({
      title: "Improve mobile report layout",
      description: "Improved mobile layout and readable buttons.",
      taskText: "Acceptance criteria: improve mobile layout without overlapping text/buttons.",
      changedFiles: [
        {
          path: "src/app/globals.css",
          additions: 24,
          deletions: 6,
          status: "modified",
          patch:
            "+ /* mobile layout: prevent overlapping report text and buttons */\n+ .report-actions { display: grid; grid-template-columns: 1fr; }"
        }
      ],
      checks: [
        {
          name: "Vercel Preview",
          status: "passed",
          summary: "Deployment screenshot captured mobile viewport after preview build."
        }
      ],
      logs: []
    } satisfies PullRequestInput);

    expect(report.requirements[0]?.status).toBe("partial");
    expect(report.requirements[0]?.gaps.join(" ")).toContain("visual QA");
  });

  it("does not treat preview Playwright report uploads as visual QA proof", () => {
    const report = generateVerificationReport({
      title: "Improve mobile report layout",
      description: "Improved mobile layout and readable buttons.",
      taskText: "Acceptance criteria: improve mobile layout without overlapping text/buttons.",
      changedFiles: [
        {
          path: "src/app/globals.css",
          additions: 24,
          deletions: 6,
          status: "modified",
          patch:
            "+ /* mobile layout: prevent overlapping report text and buttons */\n+ .report-actions { display: grid; grid-template-columns: 1fr; }"
        }
      ],
      checks: [
        {
          name: "Vercel Preview",
          status: "passed",
          summary: "Playwright report uploaded mobile viewport screenshot for deployment preview."
        }
      ],
      logs: []
    } satisfies PullRequestInput);

    expect(report.requirements[0]?.status).toBe("partial");
    expect(report.requirements[0]?.gaps.join(" ")).toContain("visual QA");
  });

  it("marks visual UX requirements met only when implementation and visual QA evidence both match", () => {
    const report = generateVerificationReport({
      title: "Improve mobile report layout",
      description: "Improved mobile layout and readable buttons.",
      taskText: "Acceptance criteria: improve mobile layout without overlapping text/buttons.",
      changedFiles: [
        {
          path: "src/app/globals.css",
          additions: 24,
          deletions: 6,
          status: "modified",
          patch: "+ .report-actions { display: grid; grid-template-columns: 1fr; }\n+ .mobile-layout { overflow-wrap: anywhere; }"
        }
      ],
      checks: [
        {
          name: "browser QA",
          status: "passed",
          summary: "Playwright mobile viewport confirmed no overlapping text or buttons"
        }
      ],
      logs: []
    } satisfies PullRequestInput);

    expect(report.requirements[0]?.status).toBe("met");
    expect(report.requirements[0]?.reviewerNote).toContain("visual QA evidence");
  });

  it("does not let visual QA satisfy an explicit visual test requirement by itself", () => {
    const report = generateVerificationReport({
      title: "Add responsive layout tests",
      description: "Added responsive layout changes and browser QA.",
      taskText: "Acceptance criteria: add responsive layout tests.",
      changedFiles: [
        {
          path: "src/app/globals.css",
          additions: 16,
          deletions: 4,
          status: "modified",
          patch: "+ /* responsive layout changes need tests */\n+ .report-grid { grid-template-columns: 1fr; }"
        }
      ],
      checks: [
        {
          name: "browser QA",
          status: "passed",
          summary: "Playwright mobile viewport confirmed responsive layout"
        }
      ],
      logs: []
    } satisfies PullRequestInput);

    expect(report.requirements[0]?.status).toBe("partial");
    expect(report.requirements[0]?.gaps.join(" ")).toContain("asks for tests");
    expect(report.requirements[0]?.reviewerNote).toContain("Request test evidence");
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

  it("keeps demo scenarios visibly distinct for portfolio evaluation", () => {
    const clean = generateVerificationReport(demoScenarios.clean);
    const scope = generateVerificationReport(demoScenarios["scope-creep"]);
    const missing = generateVerificationReport(demoScenarios["missing-tests"]);
    const failed = generateVerificationReport(demoScenarios["failed-ci"]);
    const vague = generateVerificationReport(demoScenarios["vague-task"]);

    expect(clean.summary.priority).not.toBe("blocker");
    expect(scope.scope.outOfScopeFiles).toEqual(
      expect.arrayContaining(["src/server/auth/sessionExpiry.ts", "src/server/auth/permissions.ts"])
    );
    expect(missing.testing.missingTests.map((item) => item.path)).toEqual(
      expect.arrayContaining(["src/billing/InvoiceExportButton.tsx", "src/billing/exportInvoiceCsv.ts"])
    );
    expect(failed.summary.priority).toBe("blocker");
    expect(failed.testing.ciStatus).toBe("failed");
    expect(vague.requirements[0]?.status).toBe("unclear");
  });

  it("does not escalate clean demo risk-sensitive files to high priority by default", () => {
    const report = generateVerificationReport(demoScenarios.clean);

    expect(report.summary.priority).not.toBe("high");
    if (report.summary.topRisks.join(" ").includes("No major evidence gap")) {
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

    expect(missingTest?.path).toBe("src/billing/InvoiceExportButton.tsx");
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
