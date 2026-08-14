import { describe, expect, it } from "vitest";
import { demoScenarios } from "./sample-data";
import { buildEvidenceIndex } from "./extractors";
import { validateVerificationReport } from "./report-validation";
import {
  buildRequirementEvidenceRelevanceIndex,
  buildVerifierEvidenceLookup,
  generateVerificationReport,
  generateVerificationReportV2
} from "./verifier";
import type { EvidenceItem, PullRequestInput, Requirement, VerificationReport } from "./types";

describe("generateVerificationReport", () => {
  it("keeps PR #24-style evidence observations but caps outcome at unclear without an approved contract", () => {
    const input: PullRequestInput = {
      title: "Improve repository overview",
      description: "Adds a reviewer action helper.",
      taskText: "The repository overview should be more useful for reviewers.",
      taskSource: "issue",
      changedFiles: [{ path: "src/repositories/OverviewAction.js", status: "modified", patch: "+ export const overviewActionLabel = () => 'Review repository';" }],
      checks: [{ name: "repository overview tests", status: "passed", summary: "Repository overview tests passed." }],
      logs: []
    };

    const report = generateVerificationReportV2({
      input,
      contractSource: {
        kind: "linked_issue",
        title: input.taskText,
        body: ""
      },
      binding: {
        sourceKind: "linked_issue",
        sourceIdentity: "github:repository:42:issue:23",
        sourceContent: input.taskText,
        headSha: "a".repeat(40),
        baseSha: "b".repeat(40)
      }
    });

    expect(report).toMatchObject({
      reportSchemaVersion: "verification-report.v2",
      verificationContract: { state: "absent" }
    });
    expect(report.requirements[0]).toMatchObject({ status: "unclear" });
    expect(report.requirements[0]?.proofAxes).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: "implementation", state: "satisfied" })
    ]));
  });

  it("keeps an explicit return-value contract unavailable until an attested executor result exists", () => {
    const contract = {
      version: 2,
      scope: "complete_objective_set",
      objectives: [{
        id: "visibility_label",
        objective: "Return a repository visibility label for both boolean states.",
        criteria: [{
          id: "boolean_labels",
          type: "return_value",
          label: "Return the label for each visibility value.",
          adapter: {
            id: "node_export_scalar.v1",
            modulePath: "src/repositories/repository-visibility.js",
            exportName: "repositoryVisibilityLabel",
            moduleFormat: "esm"
          },
          cases: [
            { id: "private", input: true, expected: "Private repository" },
            { id: "public", input: false, expected: "Public repository" }
          ]
        }]
      }]
    };
    const report = generateVerificationReportV2({
      input: {
        title: "Add repository visibility label",
        description: "Adds a visibility helper and focused tests.",
        taskText: "Return a repository visibility label for both boolean states.",
        taskSource: "issue",
        changedFiles: [{ path: "src/repositories/repository-visibility.js", status: "added", patch: "+ export const repositoryVisibilityLabel = (isPrivate) => isPrivate ? 'Private repository' : 'Public repository';" }],
        checks: [{ name: "repository visibility tests", status: "passed", summary: "Repository visibility tests passed." }],
        logs: []
      },
      contractSource: { kind: "provided_requirement", contract },
      binding: {
        sourceKind: "provided_requirement",
        sourceIdentity: "manual:verification-contract:1",
        sourceContent: JSON.stringify(contract),
        headSha: "a".repeat(40),
        baseSha: "b".repeat(40)
      }
    });

    expect(report.requirements[0]).toMatchObject({ status: "unclear" });
    expect(report.verificationContract.objectives[0]?.criterionResults).toEqual([
      expect.objectContaining({ state: "unavailable" })
    ]);
    expect(validateVerificationReport(report, { mode: "v2_full" })).toEqual({ valid: true, errors: [] });
  });

  it("produces met for an authoritative documentation contract with exact head evidence", () => {
    const contract = {
      version: 2,
      scope: "complete_objective_set",
      objectives: [{
        id: "reset_doc",
        objective: "Document the local reset command.",
        criteria: [{
          id: "reset_literal",
          type: "artifact",
          label: "The reset document includes the exact test command.",
          paths: ["docs/reset.md"],
          artifact: { kind: "documentation_literal", literal: "Run npm test." }
        }]
      }]
    };
    const headSha = "a".repeat(40);
    const report = generateVerificationReportV2({
      input: {
        title: "Document reset",
        description: "Documents the reset command.",
        taskText: "Document the local reset command.",
        taskSource: "issue",
        changedFiles: [{
          path: "docs/reset.md",
          status: "modified",
          patch: "+Run npm test."
        }],
        checks: [],
        logs: [],
        verificationCriterionEvidenceV2: {
          artifactBlobs: [{ path: "docs/reset.md", content: "Stop the server.\nRun npm test." }]
        },
        sourceProvenance: {
          version: 1,
          origin: "github_snapshot",
          headSha,
          baseSha: "b".repeat(40),
          changedFileInventory: { version: 1, completeness: "complete", headSha },
          evidenceCapturedAt: "2026-08-13T00:00:00.000Z",
          inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" }
        }
      },
      contractSource: { kind: "provided_requirement", contract },
      binding: {
        sourceKind: "provided_requirement",
        sourceIdentity: "manual:verification-contract:documentation",
        sourceContent: JSON.stringify(contract),
        headSha,
        baseSha: "b".repeat(40)
      }
    });

    expect(report.requirements[0]).toMatchObject({ status: "met", gaps: [] });
    expect(report.verificationContract.objectives[0]?.criterionResults).toEqual([
      expect.objectContaining({ state: "satisfied" })
    ]);
    expect(JSON.stringify(report)).not.toContain("Stop the server.");
    expect(validateVerificationReport(report, { mode: "v2_full" })).toEqual({ valid: true, errors: [] });

    const forged = structuredClone(report);
    forged.verificationContract.objectives[0]!.criterionResults[0]!.evidenceRefs = [];
    expect(validateVerificationReport(forged, { mode: "v2_full" }).valid).toBe(false);

    const forgedReturnValue = structuredClone(report);
    const forgedCriterion = forgedReturnValue.verificationContract.objectives[0]!.criteria[0]!;
    forgedCriterion.type = "return_value";
    delete forgedCriterion.artifactKind;
    expect(validateVerificationReport(forgedReturnValue, { mode: "v2_full" }).valid).toBe(false);
  });

  it("indexes requirement/evidence relevance with one source-text scan per evidence item", () => {
    const requirements = Array.from({ length: 12 }, (_, index): Requirement => ({
      id: `req_${index}`,
      text: `Add bounded cache behavior ${index}.`,
      source: "task",
      sourceQuality: "requirement_language",
      keywords: ["bounded", "cache", `behavior-${index}`],
      priority: "must",
      role: "core_requirement",
      sourceSection: null,
      contextRoles: []
    }));
    const evidence = Array.from({ length: 200 }, (_, index): EvidenceItem => ({
      id: `ev_${index}`,
      kind: "diff",
      label: `src/cache-${index}.ts`,
      summary: `Patch excerpt: bounded cache behavior-${index}`,
      confidence: 0.9
    }));

    const index = buildRequirementEvidenceRelevanceIndex(requirements, evidence, {
      checks: [],
      logs: []
    });
    expect(index.evidenceTextScanCount).toBe(evidence.length);
    for (const requirement of requirements) {
      const first = index.forRequirement(requirement);
      const second = index.forRequirement(requirement);
      expect(second).toBe(first);
    }
    expect(index.evidenceTextScanCount).toBe(evidence.length);
  });
  it("preserves exact substring match order, strength, and canonical overlap in the relevance index", () => {
    const requirement: Requirement = {
      id: "req_equivalence",
      text: "Add bounded cache invalidation tests.",
      source: "task",
      sourceQuality: "requirement_language",
      keywords: ["bounded", "cache", "invalidation", "test"],
      priority: "must",
      role: "core_requirement",
      sourceSection: null,
      contextRoles: []
    };
    const evidence: EvidenceItem[] = [
      { id: "ev_1", kind: "task", label: "Original task", summary: requirement.text, confidence: 0.95 },
      { id: "ev_2", kind: "diff", label: "src/cache.ts", summary: "bounded invalidation implementation", confidence: 0.85 },
      { id: "ev_3", kind: "test", label: "src/cache.test.ts", summary: "cache test", confidence: 0.85 },
      { id: "ev_4", kind: "check", label: "tests", summary: "Status: passed. unrelated suite", confidence: 0.9 },
      { id: "ev_5", kind: "diff", label: "src/theme.ts", summary: "unrelated color work", confidence: 0.85 }
    ];

    const relevance = buildRequirementEvidenceRelevanceIndex([requirement], evidence, {
      checks: [{ name: "tests", status: "passed", summary: "unrelated suite" }],
      logs: []
    }).forRequirement(requirement);
    const naive = evidence.flatMap((item) => {
      const text = `${item.label} ${item.summary}`.toLowerCase();
      const hits = requirement.keywords.filter((keyword) => text.includes(keyword));
      if (hits.length === 0) return [];
      const meaningful = hits.filter((keyword) => keyword.length >= 4 && keyword !== "test");
      const canProve = ["diff", "test", "log", "check"].includes(item.kind);
      return [{
        item,
        match: {
          score: hits.length,
          meaningfulScore: meaningful.length,
          strong: canProve && (meaningful.length >= 2 || meaningful.some((keyword) => keyword.length >= 8))
        }
      }];
    });

    expect(relevance.matches).toEqual(naive);
    expect(evidence.map((item) => relevance.canonicalOverlap(item))).toEqual([true, true, true, false, false]);

    const legacyCaseSensitiveKeyword = { ...requirement, id: "req_upper", keywords: ["CACHE"] };
    expect(buildRequirementEvidenceRelevanceIndex([legacyCaseSensitiveKeyword], evidence, {
      checks: [],
      logs: []
    }).forRequirement(legacyCaseSensitiveKeyword).matches).toEqual([]);
  });

  it("builds path and provenance lookup once without rescanning evidence for each changed file", () => {
    const size = 2_048;
    let numericReads = 0;
    const evidence = new Proxy(
      Array.from({ length: size }, (_, index): EvidenceItem => ({
        id: `ev_${index}`,
        kind: "diff",
        label: `src/file-${index}.ts`,
        locator: `src/file-${index}.ts`,
        summary: `Patch excerpt for file ${index}`,
        confidence: 0.9
      })),
      {
        get(target, property, receiver) {
          if (typeof property === "string" && /^\d+$/.test(property)) numericReads += 1;
          return Reflect.get(target, property, receiver);
        }
      }
    );

    const lookup = buildVerifierEvidenceLookup(evidence);
    const readsAfterBuild = numericReads;
    for (let index = 0; index < size; index += 1) {
      const refs = lookup.refsForPath(`src/file-${index}.ts`);
      expect(refs).toEqual([`ev_${index}`]);
      expect(lookup.provenanceForRefs(refs)).toEqual([
        expect.objectContaining({ evidenceRef: `ev_${index}`, sourceType: "diff" })
      ]);
    }

    expect(readsAfterBuild).toBeLessThanOrEqual(size + 1);
    expect(numericReads).toBe(readsAfterBuild);
  });

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

  it("redacts secret-looking paths and non-execution check names from full report surfaces", () => {
    const report = generateVerificationReport({
      title: "Fix export validation",
      description: "Implemented export validation.",
      taskText: "Acceptance criteria: validate export payloads.",
      changedFiles: [
        {
          path: "src/billing/AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY/export.ts",
          additions: 12,
          deletions: 1,
          status: "modified",
          patch: "+ export function validateExportPayload() { return true }"
        }
      ],
      checks: [
        {
          name: "Socket Security token=github_pat_abcdefghijklmnopqrstuvwxyz123456",
          status: "failed",
          summary: "Static security policy failed with Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret"
        }
      ],
      logs: []
    } satisfies PullRequestInput);
    const serialized = JSON.stringify(report);

    expect(validateVerificationReport(report).valid).toBe(true);
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain("wJalrXUtnFEMI");
    expect(serialized).not.toContain("github_pat_");
    expect(serialized).not.toContain("eyJhbGciOi");
    expect(report.reprompt.prompt).not.toContain("github_pat_");
    expect(report.testing.missingTests[0]?.path).toContain("[redacted]");
    expect(report.evidenceIndex.some((item) => item.label.includes("[redacted]"))).toBe(true);
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
    const invalidEmailTestRequirement = report.requirements.find((requirement) =>
      requirement.requirementText === "add tests for invalid email"
    );

    expect(invalidEmailTestRequirement?.status).toBe("partial");
    expect(invalidEmailTestRequirement?.gaps.join(" ")).toContain("targeted test-file evidence");
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
    expect(report.limitations.join(" ")).toContain("Public check/status metadata was available, but no test/build execution evidence was found.");
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

  it("does not mark requirements met from failed annotation-bearing execution evidence", () => {
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
          name: "unit tests",
          status: "failed",
          summary:
            "Vitest failed. Check annotations: failure at src/app/api/analyze/route.test.ts:42. Raw annotation messages and raw annotation details omitted."
        }
      ],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.ciStatus).toBe("failed");
    expect(report.summary.priority).toBe("blocker");
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

  it("marks test/build passed from public workflow job metadata with passing test/build steps", () => {
    const report = generateVerificationReport({
      title: "Strip pure CSS chunk imports",
      description: "Fixes CSS chunk imports and updates tests.",
      taskText: "Acceptance criteria: fix CSS chunk imports when chunkImportMap is enabled.",
      changedFiles: [
        {
          path: "packages/vite/src/node/plugins/importAnalysisBuild.ts",
          additions: 12,
          deletions: 4,
          status: "modified",
          patch: "+ removePureCssChunkImports(chunkImportMap)"
        },
        {
          path: "playground/css/vite.config.js",
          additions: 5,
          deletions: 1,
          status: "modified",
          patch: "+ chunkImportMap: true"
        }
      ],
      checks: [{ name: "CI", status: "passed", summary: "Workflow completed successfully." }],
      logs: [
        {
          source: "GitHub Actions job: Build&Test: node-24, ubuntu-latest",
          status: "passed",
          text: "GitHub Actions job Build&Test: node-24, ubuntu-latest: passed. Steps: Test unit: passed; pnpm build: passed"
        }
      ],
      limitations: [
        "Public GitHub Actions metadata showed passing build/test jobs; raw log archives were not fetched or stored."
      ]
    } satisfies PullRequestInput);

    expect(report.testing.ciStatus).toBe("passed");
    expect(report.limitations.join(" ")).toContain("Public GitHub Actions metadata showed passing build/test jobs");
    expect(report.limitations.join(" ")).not.toContain("No CI or test logs were available");
  });

  it("keeps passed execution status when skipped aggregator checks are unknown", () => {
    const report = generateVerificationReport({
      title: "Strip pure CSS chunk imports",
      description: "Fixes CSS chunk imports and updates tests.",
      taskText: "Acceptance criteria: fix CSS chunk imports when chunkImportMap is enabled.",
      changedFiles: [
        {
          path: "packages/vite/src/node/plugins/importAnalysisBuild.ts",
          additions: 12,
          deletions: 4,
          status: "modified",
          patch: "+ removePureCssChunkImports(chunkImportMap)"
        }
      ],
      checks: [
        { name: "Build & Test Failed", status: "unknown", summary: "Skipped aggregator check." },
        { name: "Build&Test: node-24, ubuntu-latest", status: "passed", summary: "Build&Test matrix passed." }
      ],
      logs: [
        {
          source: "GitHub Actions job: Build&Test: node-24, ubuntu-latest",
          status: "passed",
          text: "GitHub Actions job Build&Test: node-24, ubuntu-latest: passed. Steps: Test unit: passed; pnpm build: passed"
        },
        {
          source: "GitHub Actions job: Build & Test Failed",
          status: "unknown",
          text: "GitHub Actions job Build & Test Failed: unknown"
        }
      ]
    } satisfies PullRequestInput);

    expect(report.testing.ciStatus).toBe("passed");
  });

  it("keeps failed Build&Test job metadata as blocker execution evidence", () => {
    const report = generateVerificationReport({
      title: "Preload CSS for nested dynamic imports",
      description: "Fixes nested dynamic import CSS preload handling.",
      taskText: "Acceptance criteria: preserve CSS preload dependencies for nested dynamic imports.",
      changedFiles: [
        {
          path: "packages/vite/src/node/plugins/importAnalysisBuild.ts",
          additions: 12,
          deletions: 4,
          status: "modified",
          patch: "+ preloadCssForNestedDynamicImports()"
        },
        {
          path: "playground/preload/__tests__/nested-dynamic-import.spec.ts",
          additions: 12,
          deletions: 0,
          status: "added",
          patch: "+ test('preloads css for nested dynamic imports', async () => {})"
        }
      ],
      checks: [],
      logs: [
        {
          source: "GitHub Actions job: Build&Test: node-24, windows-latest",
          status: "failed",
          text: "GitHub Actions job Build&Test: node-24, windows-latest: failed. Steps: Test unit: failed; pnpm build: passed"
        }
      ],
      limitations: [
        "Public GitHub Actions metadata showed failing build/test jobs; raw log archives were not fetched or stored."
      ]
    } satisfies PullRequestInput);

    expect(report.testing.ciStatus).toBe("failed");
    expect(report.summary.priority).toBe("blocker");
    expect(report.summary.topRisks).toContain("Test/build execution failed, so the PR is not proven ready.");
  });

  it("lets relevant workflow failure override passing sub-signals", () => {
    const report = generateVerificationReport({
      title: "Fix cache item size accounting",
      description: "Fixes LRU cache accounting and includes build evidence.",
      taskText: "Acceptance criteria: include URL key length in LRU cache size accounting.",
      changedFiles: [
        {
          path: "packages/next/src/server/lib/lru-cache.ts",
          additions: 8,
          deletions: 2,
          status: "modified",
          patch: "+ size += key.length"
        }
      ],
      checks: [
        {
          name: "Build&Test",
          status: "failed",
          summary: "Workflow-level Build&Test failed."
        },
        {
          name: "unit tests",
          status: "passed",
          summary: "A narrower unit test job passed."
        }
      ],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.ciStatus).toBe("failed");
    expect(report.summary.priority).toBe("blocker");
    expect(report.reviewPriority[0]?.path).toBe("Test/build checks");
  });

  it("treats tox workflow metadata as failed test execution evidence", () => {
    const report = generateVerificationReport({
      title: "Fix pytest compatibility",
      description: "Fixes compatibility with new pytest behavior.",
      taskText: "Acceptance criteria: keep Flask test suite compatible with pytest.",
      changedFiles: [
        {
          path: "tests/test_basic.py",
          additions: 4,
          deletions: 1,
          status: "modified",
          patch: "+ def test_pytest_compat(): pass"
        }
      ],
      checks: [
        {
          name: "Tests",
          status: "failed",
          summary: "uv run tox failed."
        }
      ],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.ciStatus).toBe("failed");
    expect(report.summary.priority).toBe("blocker");
  });

  it("treats opaque failed GitHub Actions matrix jobs as execution failures", () => {
    const report = generateVerificationReport({
      title: "Fix dataframe copy-on-write mutation",
      description: "Fixes copy-on-write handling and expands constructor tests.",
      taskText: "Acceptance criteria: prevent derived dataframes from mutating the original index and include regression coverage.",
      changedFiles: [
        {
          path: "src/core/internals/construction.py",
          additions: 12,
          deletions: 4,
          status: "modified",
          patch: "+ track copy references for dataframe constructor"
        },
        {
          path: "tests/copy_view/test_constructors.py",
          additions: 16,
          deletions: 1,
          status: "modified",
          patch: "+ def test_dataframe_constructor_preserves_index_copy(): pass"
        }
      ],
      checks: [
        {
          name: "Unit Tests",
          status: "passed",
          summary: "Unit test matrix passed.",
          url: "https://github.com/example/project/actions/runs/100/job/200"
        },
        {
          name: "PANDAS_FUTURE_INFER_STRING=0",
          status: "failed",
          summary: "Matrix job failed on the head commit.",
          url: "https://github.com/example/project/actions/runs/100/job/201"
        }
      ],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.ciStatus).toBe("failed");
    expect(report.summary.priority).toBe("blocker");
    expect(report.summary.topRisks).toContain("Test/build execution failed, so the PR is not proven ready.");
    expect(report.reviewPriority[0]).toEqual(expect.objectContaining({ path: "Test/build checks", priority: "blocker" }));
    expect(refsToEvidence(report, report.reviewPriority[0]?.evidenceRefs ?? []).map((item) => item.label)).toContain("PANDAS_FUTURE_INFER_STRING=0");
    expect(report.testing.ciStatus).toBe("failed");
    expect(report.proofGraph.nodes.some((node) =>
      node.gapSignals.some((gap) => gap.kind === "failed_execution" && gap.severity === "blocker")
    )).toBe(true);
  });

  it("keeps opaque failed statuses without GitHub Actions job URLs out of test/build status", () => {
    const report = generateVerificationReport({
      title: "Fix dataframe copy-on-write mutation",
      description: "Fixes copy-on-write handling and expands constructor tests.",
      taskText: "Acceptance criteria: prevent derived dataframes from mutating the original index and include regression coverage.",
      changedFiles: [
        {
          path: "src/core/internals/construction.py",
          additions: 12,
          deletions: 4,
          status: "modified",
          patch: "+ track copy references for dataframe constructor"
        },
        {
          path: "tests/copy_view/test_constructors.py",
          additions: 16,
          deletions: 1,
          status: "modified",
          patch: "+ def test_dataframe_constructor_preserves_index_copy(): pass"
        }
      ],
      checks: [
        {
          name: "Unit Tests",
          status: "passed",
          summary: "Unit test matrix passed.",
          url: "https://github.com/example/project/actions/runs/100/job/200"
        },
        {
          name: "PANDAS_FUTURE_INFER_STRING=0",
          status: "failed",
          summary: "Opaque commit status failed without job metadata.",
          url: "https://ci.example.invalid/status/opaque"
        }
      ],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.ciStatus).toBe("passed");
    expect(report.summary.topRisks).toContain("Static or merge-gate checks failed outside test/build proof.");
    expect(report.reviewPriority.some((item) => item.path === "Static or merge-gate checks")).toBe(true);
    expect(report.proofGraph.nodes.some((node) =>
      node.gapSignals.some((gap) => gap.kind === "failed_execution")
    )).toBe(false);
  });

  it("keeps self-reported tests and changed test files from proving test/build status", () => {
    const report = generateVerificationReport({
      title: "Validate timeout type before passing to urllib3",
      description: "Fixes #5185. Testing: all tests passed locally.",
      taskText: "Acceptance criteria: return a clearer error for invalid timeout values.",
      changedFiles: [
        {
          path: "src/requests/adapters.py",
          additions: 8,
          deletions: 1,
          status: "modified",
          patch: "+ if isinstance(timeout, bool): raise ValueError('Invalid timeout')"
        },
        {
          path: "tests/test_requests.py",
          additions: 10,
          deletions: 0,
          status: "modified",
          patch: "+ def test_invalid_bool_timeout(): pass"
        }
      ],
      checks: [
        {
          name: "docs/readthedocs.org:requests",
          status: "passed",
          summary: "Read the Docs build passed."
        }
      ],
      logs: [],
      limitations: [
        "Public commit status metadata was available, but only non-execution statuses were found.",
        "Raw CI logs were not fetched or stored."
      ]
    } satisfies PullRequestInput);

    expect(report.testing.ciStatus).toBe("unknown");
    expect(report.limitations.join(" ")).toContain("Public commit status metadata was available, but only non-execution statuses were found.");
    expect(report.limitations.join(" ")).toContain("Confidence is based only on issue, diff, and test-artifact evidence");
    expect(report.requirements.some((requirement) => requirement.status === "met")).toBe(false);
  });

  it("keeps self-reported tests with implementation-only changes from proving test/build status", () => {
    const report = generateVerificationReport({
      title: "HTTPDigestAuth handles bytes credentials",
      description: "Fixes #6102. Testing: pytest passed locally.",
      taskText: "Acceptance criteria: handle bytes credentials in HTTPDigestAuth.",
      changedFiles: [
        {
          path: "src/requests/auth.py",
          additions: 8,
          deletions: 2,
          status: "modified",
          patch: "+ if isinstance(username, bytes): username = username.decode('latin1')"
        }
      ],
      checks: [
        {
          name: "docs/readthedocs.org:requests",
          status: "passed",
          summary: "Read the Docs build passed."
        }
      ],
      logs: [],
      limitations: [
        "Public commit status metadata was available, but only non-execution statuses were found.",
        "Raw CI logs were not fetched or stored."
      ]
    } satisfies PullRequestInput);

    expect(report.testing.ciStatus).toBe("unknown");
    expect(report.testing.missingTests.map((item) => item.path)).toContain("src/requests/auth.py");
    expect(report.summary.priority).toBe("high");
  });

  it("surfaces missing targeted proof for native crash fixes without test files", () => {
    const report = generateVerificationReport({
      title: "Restore menu self keep alive",
      description: [
        "Fixes a crash when replacing an open application menu.",
        "Since the original change did not have tests, there may be no tests for this aspect of the system.",
        "I am open to suggestions about where tests could be added."
      ].join(" "),
      taskText: [
        "Linked issue: replacing the application menu while it is open causes a segfault on Windows.",
        "Expected behavior: Menu.setApplicationMenu should not crash while the user interacts with an open menu.",
        "Actual behavior: the Menu object can be garbage-collected before the menu closes."
      ].join("\n"),
      changedFiles: [
        {
          path: "shell/browser/api/electron_api_menu.cc",
          additions: 10,
          deletions: 2,
          status: "modified",
          patch: "+ keep_alive_.Reset(isolate, wrapper);"
        },
        {
          path: "shell/browser/api/electron_api_menu.h",
          additions: 2,
          deletions: 1,
          status: "modified",
          patch: "+ v8::Global<v8::Object> keep_alive_;"
        }
      ],
      checks: [
        {
          name: "Build&Test",
          status: "passed",
          summary: "Build and test workflow passed."
        }
      ],
      logs: []
    } satisfies PullRequestInput);

    const gapKinds = report.proofGraph.nodes.flatMap((node) => node.gapSignals.map((gap) => gap.kind));

    expect(report.testing.ciStatus).toBe("passed");
    expect(report.testing.missingTests.map((item) => item.path)).toContain("shell/browser/api/electron_api_menu.cc");
    expect(gapKinds).toContain("missing_targeted_test");
    expect(gapKinds).toContain("self_reported_test_gap");
    expect(report.summary.priority).toBe("high");
    expect(report.summary.topRisks).toContain("Requirement-level proof graph found missing targeted proof.");
    expect(report.reviewPriority.some((item) => item.path === "shell/browser/api/electron_api_menu.cc")).toBe(true);
  });

  it("keeps template metadata out of requirements while preserving source roles in the proof graph", () => {
    const report = generateVerificationReport({
      title: "Restore menu self keep alive",
      description: "Fixes a crash when replacing an open application menu.",
      taskSource: "issue",
      taskText: [
        "### Preflight Checklist",
        "[x] I have read the contributing guidelines.",
        "### Electron Version",
        "38.0.0-nightly",
        "### Actual behavior",
        "Replacing menu while open causes a segfault on Windows.",
        "### Expected behavior",
        "Menu.setApplicationMenu should not crash while the user interacts with an open menu."
      ].join("\n"),
      changedFiles: [
        {
          path: "shell/browser/api/electron_api_menu.cc",
          additions: 10,
          deletions: 2,
          status: "modified",
          patch: "+ keep_alive_.Reset(isolate, wrapper);"
        }
      ],
      checks: [{ name: "Build&Test", status: "passed", summary: "Build and test workflow passed." }],
      logs: []
    } satisfies PullRequestInput);
    const requirementText = report.requirements.map((requirement) => requirement.requirementText).join("\n");
    const node = report.proofGraph.nodes[0];

    expect(requirementText).toContain("Menu.setApplicationMenu should not crash");
    expect(requirementText).not.toMatch(/Preflight|Electron Version|contributing guidelines/i);
    expect(node).toEqual(expect.objectContaining({
      sourceRole: "core_requirement",
      sourceQuality: "expected_behavior",
      sourceSection: "Expected behavior"
    }));
    expect(node?.contextRoles).toContain("problem_context");
    expect(report.proofGraph.context.some((context) => context.role === "environment_context")).toBe(true);
    expect(report.proofGraph.context.some((context) => context.role === "problem_context" && /segfault/.test(context.text))).toBe(true);
  });

  it("clears native missing-test findings only when targeted native tests and execution evidence are present", () => {
    const report = generateVerificationReport({
      title: "Restore menu self keep alive",
      description: "Fixes a crash when replacing an open application menu and adds a targeted native test.",
      taskText: "Acceptance criteria: prevent the menu replacement crash and cover the regression with a targeted test.",
      changedFiles: [
        {
          path: "shell/browser/api/electron_api_menu.cc",
          additions: 10,
          deletions: 2,
          status: "modified",
          patch: "+ keep_alive_.Reset(isolate, wrapper);"
        },
        {
          path: "shell/browser/api/electron_api_menu_unittest.cc",
          additions: 18,
          deletions: 0,
          status: "added",
          patch: "+ TEST_F(MenuTest, ReplacingOpenMenuKeepsMenuAlive) {}"
        }
      ],
      checks: [
        {
          name: "native unit tests",
          status: "passed",
          summary: "electron_api_menu_unittest passed."
        }
      ],
      logs: []
    } satisfies PullRequestInput);
    const proofNode = report.proofGraph.nodes.find((node) =>
      node.implementationEvidenceRefs.some((ref) =>
        refsToEvidence(report, [ref]).some((item) => item.locator === "shell/browser/api/electron_api_menu.cc")
      )
    );

    expect(report.testing.ciStatus).toBe("passed");
    expect(report.testing.missingTests.map((item) => item.path)).not.toContain("shell/browser/api/electron_api_menu.cc");
    expect(proofNode?.targetedTestEvidenceRefs).toEqual([]);
    expect(proofNode?.executionEvidenceRefs.length).toBeGreaterThan(0);
    expect(proofNode?.gapSignals.some((gap) => gap.kind === "missing_targeted_test")).toBe(true);
  });

  it("prioritizes concrete file paths over repeated generic requirement labels", () => {
    const report = generateVerificationReport({
      title: "Fix digest auth credentials",
      description: "Updates digest auth credential handling.",
      taskText: "Acceptance criteria: handle bytes credentials in HTTPDigestAuth and preserve request behavior.",
      changedFiles: [
        {
          path: "src/requests/auth.py",
          additions: 8,
          deletions: 2,
          status: "modified",
          patch: "+ if isinstance(username, bytes): username = username.decode('latin1')"
        }
      ],
      checks: [],
      logs: []
    } satisfies PullRequestInput);

    const firstFiles = report.reviewPriority.slice(0, 4).map((item) => item.path);

    expect(firstFiles).toContain("src/requests/auth.py");
    expect(firstFiles.filter((path) => path === "Requirement evidence")).toHaveLength(0);
  });

  it("keeps requirement-linked files ahead of an unrelated README marker", () => {
    const report = generateVerificationReport({
      title: "Add repository slug formatter",
      description: [
        "This PR validates a review pipeline.",
        "### Requirements",
        "- Add repositorySlug(repository) that returns owner/name when both values are present.",
        "- Return unknown/repository when an owner or name is unavailable.",
        "- Add focused tests for the normal and fallback paths."
      ].join("\n"),
      taskText: "",
      changedFiles: [
        { path: "README.md", additions: 1, deletions: 0, status: "modified", patch: "+ <!-- webhook marker -->" },
        { path: "src/repositories/repository.js", additions: 7, deletions: 0, status: "modified", patch: "+ export function repositorySlug(repository) { return repository.owner && repository.name ? `${repository.owner}/${repository.name}` : 'unknown/repository'; }" },
        { path: "test/baseline.test.js", additions: 10, deletions: 0, status: "modified", patch: "+ test('formats repository slug', () => {});" }
      ],
      checks: [{ name: "unit-tests", status: "passed", summary: "Unit tests passed." }],
      logs: []
    } satisfies PullRequestInput);

    expect(report.requirements).toHaveLength(3);
    expect(report.reviewPriority.map((item) => item.path)).toContain("src/repositories/repository.js");
    expect(report.reviewPriority.map((item) => item.path)).not.toContain("README.md");
  });

  it("does not prioritize an unrelated implementation over linked documentation evidence", () => {
    const report = generateVerificationReport({
      title: "Document local setup",
      description: "### Requirements\n- Document local setup instructions.",
      taskText: "",
      changedFiles: [
        { path: "src/auth/session.js", additions: 2, deletions: 1, status: "modified", patch: "+ const sessionVersion = 2;" },
        { path: "docs/local-setup.md", additions: 5, deletions: 0, status: "added", patch: "+ # Local setup\n+ Run pnpm install." }
      ],
      checks: [],
      logs: []
    } satisfies PullRequestInput);

    expect(report.reviewPriority[0]?.path).toBe("docs/local-setup.md");
    expect(report.reviewPriority[0]?.path).not.toBe("src/auth/session.js");
  });

  it("evaluates PR-body-only intent without treating it as an authoritative requirement", () => {
    const report = generateVerificationReport({
      title: "Preserve URL params",
      description: [
        "### Acceptance criteria",
        "The widget should preserve search params.",
        "### Testing",
        "I verified the unit tests pass."
      ].join("\n"),
      taskText: "",
      changedFiles: [
        {
          path: "src/widget/url-params.ts",
          additions: 4,
          deletions: 1,
          status: "modified",
          patch: "+ preserveSearchParams(params)"
        }
      ],
      checks: [{ name: "unit tests", status: "passed", summary: "unit tests passed" }],
      logs: []
    } satisfies PullRequestInput);
    const node = report.proofGraph.nodes[0];

    expect(node?.sourceQuality).toBe("author_claim");
    expect(report.requirements[0]?.status).not.toBe("met");
    expect(report.limitations.join(" ")).toContain("No original task text was provided");
    expect(report.proofGraph.context.some((context) =>
      context.role === "author_claim" && /preserve search params/i.test(context.text)
    )).toBe(true);
  });

  it("treats unavailable changed-file evidence as inconclusive instead of missing implementation", () => {
    const report = generateVerificationReport({
      title: "Strip relative paths",
      description: "Fix path traversal-like relative path handling.",
      taskText: "Expected behavior: JoinPath should strip relative path components consistently.",
      changedFiles: [],
      checks: [],
      logs: [],
      limitations: ["GitHub changed-file evidence unavailable: request timed out or network failed."]
    } satisfies PullRequestInput);
    const gapKinds = report.proofGraph.nodes.flatMap((node) => node.gapSignals.map((gap) => gap.kind));

    expect(gapKinds).toContain("evidence_unavailable");
    expect(gapKinds).not.toContain("missing_implementation");
    expect(report.requirements[0]?.status).toBe("unclear");
    expect(report.summary.topRisks.join(" ")).toContain("implementation proof is unavailable");
  });

  it("treats a requirement-matched source file without a patch as unavailable evidence", () => {
    const report = generateVerificationReport({
      title: "Add repository visibility label",
      description: "",
      taskText: "Add repository visibility labels.",
      changedFiles: [{
        path: "src/repositories/repository-visibility.js",
        status: "added"
      }],
      checks: [],
      logs: []
    } satisfies PullRequestInput);
    const node = report.proofGraph.nodes[0];
    const requirement = report.requirements[0];

    expect(requirement?.proofAxes?.find((axis) => axis.subject === "implementation"))
      .toMatchObject({ state: "incomplete", collectionBasis: "incomplete_changed_file_inventory" });
    expect(node?.gapSignals.map((gap) => gap.kind)).toContain("evidence_unavailable");
    expect(node?.gapSignals.map((gap) => gap.kind)).not.toContain("missing_implementation");
  });

  it("keeps normal bug proof gaps at medium when CI passes", () => {
    const report = generateVerificationReport({
      title: "Fix stale cache output",
      description: "Fixes stale output when CSS changes.",
      taskText: "Expected behavior: the CSS watcher should return fresh output when input CSS changes.",
      changedFiles: [
        {
          path: "packages/postcss/src/cache.ts",
          additions: 6,
          deletions: 2,
          status: "modified",
          patch: "+ cacheKey = hash(inputCss)"
        }
      ],
      checks: [{ name: "Build&Test", status: "passed", summary: "Build and test workflow passed." }],
      logs: []
    } satisfies PullRequestInput);
    expect(report.testing.missingTests.map((item) => item.path)).toContain("packages/postcss/src/cache.ts");
    expect(report.summary.priority).toBe("medium");
    expect(report.summary.priority).not.toBe("high");
  });

  it("caps requirement evidence refs before runtime validation", () => {
    const report = generateVerificationReport({
      title: "Add import coverage",
      description: "Updates import coverage.",
      taskText: "Acceptance criteria: add tests for import coverage.",
      changedFiles: Array.from({ length: 75 }, (_value, index) => ({
        path: `src/import/import-coverage-${index}.ts`,
        additions: 2,
        deletions: 1,
        status: "modified" as const,
        patch: "+ importCoverage()"
      })),
      checks: [],
      logs: []
    } satisfies PullRequestInput);
    const validation = validateVerificationReport(report, { mode: "full" });

    expect(report.requirements[0]?.evidenceRefs.length).toBeLessThanOrEqual(50);
    expect(report.limitations.join(" ")).toContain("evidence references were capped at 50");
    expect(validation).toEqual({ valid: true, errors: [] });
  });

  it("keeps every capped implementation-axis reference on its proof node", () => {
    const report = generateVerificationReport({
      title: "Add retry policy handling",
      description: "",
      taskText: "Acceptance criteria: add retry policy handling.",
      changedFiles: [
        ...Array.from({ length: 4 }, (_value, index) => ({
          path: `docs/retry-policy-${index}.md`,
          status: "modified" as const,
          patch: "+ retry policy handling"
        })),
        ...Array.from({ length: 8 }, (_value, index) => ({
          path: `src/retry-policy-${index}.ts`,
          status: "modified" as const,
          patch: "+ export function retryPolicyHandling() {}"
        }))
      ],
      checks: [],
      logs: []
    } satisfies PullRequestInput);
    const finding = report.requirements[0];
    const node = report.proofGraph.nodes[0];
    const implementationAxis = finding?.proofAxes?.find((axis) => axis.subject === "implementation");

    expect(implementationAxis?.state).toBe("satisfied");
    expect(implementationAxis?.evidenceRefs.every((ref) => node?.implementationEvidenceRefs.includes(ref))).toBe(true);
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
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

  it("keeps suite-linked execution evidence in a met requirement after artifact references are capped", () => {
    const headSha = "a".repeat(40);
    const report = generateVerificationReport({
      title: "Add export evidence report",
      description: "",
      taskText: "Acceptance criteria: add export evidence report.",
      changedFiles: [
        {
          path: "README.md",
          status: "modified" as const,
          patch: "+ Export evidence report usage"
        },
        {
          path: "src/reports/export-evidence-report.ts",
          status: "modified" as const,
          patch: "+ export function exportEvidenceReport() {}"
        },
        ...Array.from({ length: 60 }, (_value, index) => ({
          path: `docs/reports/export-evidence-report-${index}.md`,
          status: "modified" as const,
          patch: "+ Export evidence report reference"
        })),
        {
          path: "test/export-evidence-report.test.ts",
          status: "added" as const,
          patch: "+ import { exportEvidenceReport } from '../src/reports/export-evidence-report';\n+ test('exports evidence report', () => { exportEvidenceReport(); })"
        }
      ],
      checks: [{ name: "unit-tests", status: "passed", summary: "Unit tests passed." }],
      logs: [{ source: "GitHub Actions job: unit-tests", status: "passed", text: "Steps: Run node --test: passed." }],
      sourceProvenance: githubInventoryProvenance(headSha),
      executionSuites: [{
        status: "passed",
        headSha,
        executionSource: "GitHub Actions job: unit-tests",
        runner: "node_test",
        scope: "repository_discovery",
        testPaths: ["test/export-evidence-report.test.ts"]
      }]
    } satisfies PullRequestInput);
    const finding = report.requirements[0];
    const evidence = refsToEvidence(report, finding?.evidenceRefs ?? []);

    expect(finding?.status).toBe("met");
    expect(evidence.some((item) => item.kind === "log" && item.summary.startsWith("Status: passed"))).toBe(true);
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
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
    expect(report.reviewPriority.some((item) => item.path === "src/users/settings.ts")).toBe(true);
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
          patch: "+ import { InvoiceExportButton } from './InvoiceExportButton';\n+ it('exports invoices from the export button', async () => { InvoiceExportButton({}); })"
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
    expect(report.requirements[0]?.gaps.join(" ")).not.toContain("failing check");
  });

  it("does not cite failed execution evidence on requirement findings without keyword overlap", () => {
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

    expect(report.requirements[0]?.gaps.join(" ")).not.toContain("CI has a failing check");
    expect(failedRefs.map((item) => item.label)).not.toContain("unit tests");
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
    expect(scopeReport.scope.provenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidenceRef: expect.stringMatching(/^ev_/),
          sourceType: "changed_file",
          locator: "src/server/auth/sessionExpiry.ts",
          confidence: expect.any(Number),
          evidenceText: expect.stringContaining("src/server/auth/sessionExpiry.ts")
        })
      ])
    );
    expect(scopeReport.scope.provenance?.every((item) => item.evidenceText.length <= 240)).toBe(true);

    const missingTestReport = generateVerificationReport(demoScenarios["missing-tests"]);
    const missingTest = missingTestReport.testing.missingTests[0];
    const missingEvidence = refsToEvidence(missingTestReport, missingTest?.evidenceRefs ?? []);

    expect(missingTest?.path).toBe("src/billing/InvoiceExportButton.tsx");
    expect(missingEvidence.some((item) => item.locator === missingTest?.path)).toBe(true);
    expect(missingTest?.provenance?.some((item) =>
      item.evidenceRef.startsWith("ev_") &&
      (item.sourceType === "changed_file" || item.sourceType === "diff") &&
      item.locator === "src/billing/InvoiceExportButton.tsx" &&
      typeof item.confidence === "number" &&
      item.evidenceText.includes("src/billing/InvoiceExportButton.tsx")
    )).toBe(true);
    expect(missingTest?.provenance?.every((item) => item.evidenceText.length <= 240)).toBe(true);
  });

  it("does not require implementation or another targeted test for a test-only objective with test and execution evidence", () => {
    const report = generateVerificationReport({
      title: "Add retry queue regression coverage",
      description: "Adds a regression test for retry queue synchronization.",
      taskText: "Acceptance criteria: add a regression test for retry queue synchronization.",
      changedFiles: [
        { path: "src/queues/retry-queue.ts", status: "modified", patch: "+ export function retryQueue() {}" },
        {
          path: "src/queues/retry-queue.test.ts",
          additions: 12,
          deletions: 0,
          status: "modified",
          patch: "+ import { retryQueue } from './retry-queue';\n+ it('retries failed synchronization jobs', async () => { retryQueue(); })"
        }
      ],
      checks: [{ name: "Test", status: "passed", summary: "Retry queue regression test passed." }],
      logs: []
    } satisfies PullRequestInput);

    const node = report.proofGraph.nodes[0];

    expect(node?.targetedTestEvidenceRefs.length).toBeGreaterThan(0);
    expect(node?.executionEvidenceRefs.length).toBeGreaterThan(0);
    expect(node?.gapSignals.map((gap) => gap.kind)).not.toContain("missing_implementation");
    expect(node?.gapSignals.map((gap) => gap.kind)).not.toContain("missing_targeted_test");
  });

  it("keeps implementation and targeted-test expectations for a behavior objective that also asks for tests", () => {
    const report = generateVerificationReport({
      title: "Cover retry queue synchronization",
      description: "Adds regression coverage for retry queue synchronization.",
      taskText: "Acceptance criteria: retry failed synchronization jobs and add regression tests.",
      changedFiles: [{
        path: "src/queues/retry-queue.test.ts",
        additions: 12,
        deletions: 0,
        status: "modified",
        patch: "+ it('retries failed synchronization jobs', async () => {})"
      }],
      checks: [{ name: "Test", status: "passed", summary: "Retry queue regression test passed." }],
      logs: []
    } satisfies PullRequestInput);

    const node = report.proofGraph.nodes[0];

    expect(node?.gapSignals.map((gap) => gap.kind)).toContain("missing_implementation");
    expect(node?.gapSignals.map((gap) => gap.kind)).toContain("missing_targeted_test");
  });

  it("keeps behavior proof when an add-support objective also explicitly asks for tests", () => {
    const report = generateVerificationReport({
      title: "Add retry queue support coverage",
      description: "Adds regression coverage for retry queue support.",
      taskText: "Acceptance criteria: add support for retry queue synchronization and add regression tests.",
      changedFiles: [{
        path: "src/queues/retry-queue.test.ts",
        additions: 12,
        deletions: 0,
        status: "modified",
        patch: "+ it('retries failed synchronization jobs', async () => {})"
      }],
      checks: [{ name: "Test", status: "passed", summary: "Retry queue regression test passed." }],
      logs: []
    } satisfies PullRequestInput);

    const gaps = report.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind);

    expect(gaps).toContain("missing_implementation");
    expect(gaps).toContain("missing_targeted_test");
  });

  it("keeps documentation and CI proof independent from targeted tests and recognizes Korean test-only objectives", () => {
    const documentation = generateVerificationReport({
      title: "Document retry queue setup",
      description: "Documents retry queue setup.",
      taskText: "Acceptance criteria: must document retry queue setup.",
      changedFiles: [{ path: "docs/retry-queue.md", additions: 8, deletions: 0, status: "modified", patch: "+ Retry queue setup" }],
      checks: [],
      logs: []
    } satisfies PullRequestInput);
    const ci = generateVerificationReport({
      title: "Add retry queue CI workflow",
      description: "Adds retry queue CI workflow.",
      taskText: "Acceptance criteria: add retry queue CI workflow.",
      changedFiles: [{ path: ".github/workflows/retry-queue.yml", additions: 8, deletions: 0, status: "modified", patch: "+ name: Retry queue CI" }],
      checks: [{ name: "CI", status: "passed", summary: "Retry queue CI workflow test suite passed." }],
      logs: []
    } satisfies PullRequestInput);
    const koreanTest = generateVerificationReport({
      title: "재시도 큐 회귀 테스트 추가",
      description: "재시도 큐 동기화 회귀 테스트를 추가합니다.",
      taskText: "수용 기준: 재시도 큐 동기화 회귀 테스트를 추가합니다.",
      changedFiles: [{ path: "src/queues/재시도-큐.test.ts", additions: 8, deletions: 0, status: "modified", patch: "+ it('재시도 큐 동기화', async () => {})" }],
      checks: [{ name: "Test", status: "passed", summary: "Retry queue regression test passed." }],
      logs: []
    } satisfies PullRequestInput);

    expect(documentation.proofGraph.nodes[0]?.implementationEvidenceRefs.length).toBeGreaterThan(0);
    expect(documentation.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind)).not.toContain("missing_implementation");
    expect(documentation.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind)).not.toContain("missing_targeted_test");
    expect(documentation.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind)).not.toContain("missing_execution");
    expect(ci.proofGraph.nodes[0]?.implementationEvidenceRefs.length).toBeGreaterThan(0);
    expect(ci.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind)).not.toContain("missing_implementation");
    expect(ci.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind)).not.toContain("missing_targeted_test");
    expect(ci.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind)).not.toContain("missing_execution");
    expect(koreanTest.proofGraph.nodes[0]?.requirementText).toContain("테스트");
    expect(koreanTest.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind)).not.toContain("missing_implementation");
    expect(koreanTest.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind)).toContain("missing_targeted_test");
  });

  it("evaluates explicit Korean test, documentation, and CI objectives by their matching artifact contract", () => {
    const koreanTest = generateVerificationReport({
      title: "재시도 큐 회귀 테스트 추가",
      description: "재시도 큐 동기화 회귀 테스트를 추가합니다.",
      taskText: "수용 기준: 재시도 큐 동기화 회귀 테스트를 추가합니다.",
      changedFiles: [{ path: "src/queues/재시도-큐.test.ts", additions: 8, deletions: 0, status: "modified", patch: "+ it('재시도 큐 동기화', async () => {})" }],
      checks: [{ name: "Test", status: "passed", summary: "Retry queue regression test passed." }],
      logs: []
    } satisfies PullRequestInput);
    const documentation = generateVerificationReport({
      title: "Document retry queue setup",
      description: "Documents retry queue setup.",
      taskText: "Acceptance criteria: document retry queue setup.",
      changedFiles: [{ path: "docs/retry-queue.md", additions: 8, deletions: 0, status: "modified", patch: "+ Retry queue setup" }],
      checks: [],
      logs: []
    } satisfies PullRequestInput);
    const ci = generateVerificationReport({
      title: "Add retry queue CI workflow",
      description: "Adds retry queue CI workflow.",
      taskText: "Acceptance criteria: add retry queue CI workflow.",
      changedFiles: [{ path: ".github/workflows/retry-queue.yml", additions: 8, deletions: 0, status: "modified", patch: "+ name: Retry queue CI" }],
      checks: [{ name: "CI", status: "passed", summary: "Retry queue CI workflow test suite passed." }],
      logs: []
    } satisfies PullRequestInput);

    expect(koreanTest.requirements[0]?.status).not.toBe("unclear");
    expect(koreanTest.requirements[0]?.gaps.join(" ")).toMatch(/asks for tests|targeted test-file evidence/i);
    expect(documentation.requirements[0]?.gaps.join(" ")).not.toMatch(/matching test, log, or check|asks for tests/i);
    expect(ci.requirements[0]?.evidenceRefs.length).toBeGreaterThan(0);
    expect(ci.requirements[0]?.gaps.join(" ")).not.toMatch(/matching test, log, or check|asks for tests/i);
  });

  it("proves an absence-only requirement from a complete changed-file inventory without execution", () => {
    const sourceProvenance = githubInventoryProvenance();
    const report = generateVerificationReport({
      title: "Keep the change test-only",
      description: "Adds test coverage only.",
      taskText: "Acceptance criteria: do not change implementation code.",
      changedFiles: [{ path: "src/queues/retry-queue.test.ts", status: "modified", patch: "+ it('retries', () => {})" }],
      checks: [],
      logs: [],
      sourceProvenance
    } satisfies PullRequestInput);

    expect(report.requirements[0]).toMatchObject({
      status: "met",
      proofAxes: [{
        subject: "implementation",
        polarity: "absent",
        state: "satisfied",
        collectionBasis: "complete_changed_file_inventory"
      }]
    });
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("records a deterministic violation when forbidden implementation is present", () => {
    const report = generateVerificationReport({
      title: "Keep the change test-only",
      description: "Updates retry handling.",
      taskText: "Acceptance criteria: do not change implementation code.",
      changedFiles: [{ path: "src/queues/retry-queue.ts", status: "modified", patch: "+ export const retry = true" }],
      checks: [],
      logs: []
    } satisfies PullRequestInput);

    expect(report.requirements[0]?.status).not.toBe("met");
    expect(report.requirements[0]?.proofAxes).toEqual([
      expect.objectContaining({ subject: "implementation", polarity: "absent", state: "violated" })
    ]);
    expect(report.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind)).toContain("forbidden_implementation_present");
    expect(report.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.message).join(" ")).toContain("forbids implementation changes");
  });

  it.each([
    "GitHub changed-file evidence was capped at 120 files.",
    "GitHub changed-file evidence unavailable: request timed out or network failed."
  ])("keeps absence proof incomplete when inventory is incomplete: %s", (limitation) => {
    const report = generateVerificationReport({
      title: "Keep the change test-only",
      description: "Adds test coverage only.",
      taskText: "Acceptance criteria: do not change implementation code.",
      changedFiles: [{ path: "src/queues/retry-queue.test.ts", status: "modified", patch: "+ it('retries', () => {})" }],
      checks: [],
      logs: [],
      limitations: [limitation]
    } satisfies PullRequestInput);

    expect(report.requirements[0]?.status).toBe("unclear");
    expect(report.requirements[0]?.proofAxes).toEqual([
      expect.objectContaining({
        subject: "implementation",
        polarity: "absent",
        state: "incomplete",
        collectionBasis: "incomplete_changed_file_inventory"
      })
    ]);
  });

  it("requires every test and absence axis in a mixed requirement", () => {
    const sourceProvenance = githubInventoryProvenance();
    const passing = generateVerificationReport({
      title: "Add retry coverage only",
      description: "Adds retry coverage only.",
      taskText: "Acceptance criteria: add regression tests for retry queue without changing implementation code.",
      changedFiles: [{ path: "src/queues/retry-queue.test.ts", status: "modified", patch: "+ it('retries failed jobs', () => {})" }],
      checks: [{ name: "Test", status: "passed", summary: "Retry queue regression tests passed." }],
      logs: [],
      sourceProvenance
    } satisfies PullRequestInput);
    const violated = generateVerificationReport({
      title: "Add retry coverage only",
      description: "Adds retry coverage and implementation.",
      taskText: "Acceptance criteria: add regression tests for retry queue without changing implementation code.",
      changedFiles: [
        { path: "src/queues/retry-queue.test.ts", status: "modified", patch: "+ it('retries failed jobs', () => {})" },
        { path: "src/queues/retry-queue.ts", status: "modified", patch: "+ export const retry = true" }
      ],
      checks: [{ name: "Test", status: "passed", summary: "Retry queue regression tests passed." }],
      logs: [],
      sourceProvenance
    } satisfies PullRequestInput);

    expect(passing.requirements[0]?.status).not.toBe("met");
    expect(passing.requirements[0]?.proofAxes).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: "targeted_test", polarity: "present", state: "violated" }),
      expect.objectContaining({ subject: "execution", polarity: "present", state: "satisfied" }),
      expect.objectContaining({ subject: "implementation", polarity: "absent", state: "satisfied" })
    ]));
    expect(violated.requirements[0]?.status).not.toBe("met");
    expect(violated.requirements[0]?.proofAxes).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: "implementation", polarity: "absent", state: "violated" })
    ]));
  });

  it.each([
    {
      text: "Document retry queue setup without changing implementation code.",
      file: { path: "docs/retry-queue.md", status: "modified" as const, patch: "+ Retry queue setup" },
      checks: [] as PullRequestInput["checks"],
      subjects: ["documentation", "implementation"]
    },
    {
      text: "Add retry queue CI workflow without changing implementation code.",
      file: { path: ".github/workflows/retry-queue.yml", status: "modified" as const, patch: "+ name: Retry queue CI" },
      checks: [{ name: "CI", status: "passed" as const, summary: "Retry queue CI test suite passed." }],
      subjects: ["ci_configuration", "execution", "implementation"]
    }
  ])("keeps $subjects proof axes independent", ({ text, file, checks, subjects }) => {
    const report = generateVerificationReport({
      title: text,
      description: text,
      taskText: `Acceptance criteria: ${text}`,
      changedFiles: [file],
      checks,
      logs: [],
      sourceProvenance: githubInventoryProvenance()
    } satisfies PullRequestInput);

    expect(report.requirements[0]?.status).toBe("met");
    expect(report.requirements[0]?.proofAxes?.map((axis) => axis.subject)).toEqual(subjects);
    expect(report.requirements[0]?.proofAxes?.every((axis) => axis.state === "satisfied")).toBe(true);
  });

  it.each([
    { name: "missing provenance", sourceProvenance: undefined },
    {
      name: "pasted provenance",
      sourceProvenance: {
        ...githubInventoryProvenance(),
        origin: "pasted_evidence" as const,
        headSha: undefined,
        baseSha: undefined,
        inputFingerprint: { ...githubInventoryProvenance().inputFingerprint, coverage: "pasted_metadata" as const }
      }
    },
    { name: "wrong inventory head", sourceProvenance: githubInventoryProvenance("a".repeat(40), "b".repeat(40)) }
  ])("does not prove absence from $name", ({ sourceProvenance }) => {
    const report = generateVerificationReport({
      title: "Keep the change test-only",
      description: "Adds test coverage only.",
      taskText: "Acceptance criteria: do not change implementation code.",
      changedFiles: [{ path: "src/queues/retry-queue.test.ts", status: "modified", patch: "+ it('retries', () => {})" }],
      checks: [],
      logs: [],
      ...(sourceProvenance ? { sourceProvenance } : {})
    } satisfies PullRequestInput);

    expect(report.requirements[0]?.status).toBe("unclear");
    expect(report.requirements[0]?.proofAxes).toEqual([
      expect.objectContaining({ polarity: "absent", state: "incomplete", collectionBasis: "incomplete_changed_file_inventory" })
    ]);
  });

  it("does not satisfy execution from an unrelated repository-global passing check", () => {
    const report = generateVerificationReport({
      title: "Add retry queue behavior",
      description: "Adds retry queue behavior.",
      taskText: "Acceptance criteria: retry failed synchronization jobs.",
      changedFiles: [{ path: "src/queues/retry.ts", status: "modified", patch: "+ export function retryFailedSynchronization() {}" }],
      checks: [{ name: "Payments tests", status: "passed", summary: "Payments checkout tests passed." }],
      logs: []
    } satisfies PullRequestInput);

    expect(report.requirements[0]?.proofAxes).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: "execution", state: "incomplete", evidenceRefs: [] })
    ]));
    expect(report.requirements[0]?.status).not.toBe("met");
  });

  it("does not turn a context-only failed execution check into a requirement blocker", () => {
    const report = generateVerificationReport({
      title: "Add settings-panel tests",
      description: "Payments test output is attached as external context.",
      taskText: [
        "Acceptance criteria: add settings panel tests.",
        "External reference: payments test output is available."
      ].join("\n"),
      changedFiles: [{ path: "src/settings/Panel.test.tsx", status: "modified", patch: "+ it('renders settings panel', () => {})" }],
      checks: [{ name: "Payments tests", status: "failed", summary: "Payments tests failed." }],
      logs: []
    } satisfies PullRequestInput);

    expect(report.requirements[0]?.proofAxes).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: "execution", state: "incomplete", evidenceRefs: [] })
    ]));
    expect(report.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind)).not.toContain("failed_execution");
  });

  it("violates execution only for a canonical or opaque failed check", () => {
    const canonical = generateVerificationReport({
      title: "Add settings-panel tests",
      description: "Adds settings-panel coverage.",
      taskText: "Acceptance criteria: add settings panel tests.",
      changedFiles: [{ path: "src/settings/Panel.test.tsx", status: "modified", patch: "+ it('renders settings panel', () => {})" }],
      checks: [{ name: "Settings panel tests", status: "failed", summary: "Settings panel tests failed." }],
      logs: []
    } satisfies PullRequestInput);
    const opaque = generateVerificationReport({
      title: "Add settings-panel tests",
      description: "Adds settings-panel coverage.",
      taskText: "Acceptance criteria: add settings panel tests.",
      changedFiles: [{ path: "src/settings/Panel.test.tsx", status: "modified", patch: "+ it('renders settings panel', () => {})" }],
      checks: [{
        name: "PANDAS_FUTURE_INFER_STRING=0",
        status: "failed",
        summary: "Matrix job failed on the head commit.",
        url: "https://github.com/example/project/actions/runs/100/job/201"
      }],
      logs: []
    } satisfies PullRequestInput);

    for (const report of [canonical, opaque]) {
      expect(report.requirements[0]?.proofAxes).toEqual(expect.arrayContaining([
        expect.objectContaining({ subject: "execution", state: "violated", collectionBasis: "failed_execution" })
      ]));
      expect(report.proofGraph.nodes[0]?.gapSignals).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "failed_execution", severity: "blocker" })
      ]));
      expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
    }
  });

  it("keeps visual proof matched to its own requirement", () => {
    const report = generateVerificationReport({
      title: "Verify two responsive surfaces",
      description: "Updates settings and billing surfaces.",
      taskText: [
        "Acceptance criteria: keep the settings panel readable at 375px.",
        "Acceptance criteria: keep the billing card readable at 375px."
      ].join("\n"),
      changedFiles: [
        { path: "src/settings/Panel.tsx", status: "modified", patch: "+ return <section>settings panel</section>" },
        { path: "src/billing/Card.tsx", status: "modified", patch: "+ return <section>billing card</section>" }
      ],
      checks: [{ name: "Browser QA settings panel", status: "passed", summary: "Status: passed. Settings panel visual viewport check passed." }],
      logs: []
    } satisfies PullRequestInput);

    const settings = report.requirements.find((item) => /settings panel/i.test(item.requirementText));
    const billing = report.requirements.find((item) => /billing card/i.test(item.requirementText));
    expect(settings?.proofAxes?.find((axis) => axis.subject === "visual")?.state).toBe("satisfied");
    expect(billing?.proofAxes?.find((axis) => axis.subject === "visual")?.state).toBe("incomplete");
    expect(billing?.proofAxes?.find((axis) => axis.subject === "visual")?.evidenceRefs).toEqual([]);
  });

  it("does not let context-only keywords satisfy execution or visual proof axes", () => {
    const execution = generateVerificationReport({
      title: "Add settings-panel tests",
      description: "Payments test output is attached as external context.",
      taskText: [
        "Acceptance criteria: add settings panel tests.",
        "External reference: payments test output is available."
      ].join("\n"),
      changedFiles: [{ path: "src/settings/Panel.test.tsx", status: "modified", patch: "+ it('renders settings panel', () => {})" }],
      checks: [{ name: "Payments tests", status: "passed", summary: "Payments tests passed." }],
      logs: []
    } satisfies PullRequestInput);
    const visual = generateVerificationReport({
      title: "Keep settings panel readable",
      description: "Visual evidence references the billing card.",
      taskText: [
        "Acceptance criteria: keep the settings panel readable at 375px.",
        "Visual reference: billing card screenshot at 375px."
      ].join("\n"),
      changedFiles: [{ path: "src/settings/Panel.tsx", status: "modified", patch: "+ return <section>settings panel</section>" }],
      checks: [{ name: "Browser QA billing card", status: "passed", summary: "Status: passed. Billing card visual viewport check passed." }],
      logs: []
    } satisfies PullRequestInput);

    expect(execution.requirements[0]?.proofAxes).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: "execution", state: "incomplete", evidenceRefs: [] })
    ]));
    expect(visual.requirements[0]?.proofAxes).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: "visual", state: "incomplete", evidenceRefs: [] })
    ]));
    expect(execution.requirements[0]?.status).not.toBe("met");
    expect(visual.requirements[0]?.status).not.toBe("met");
    expect(validateVerificationReport(execution, { mode: "full" })).toEqual({ valid: true, errors: [] });
    expect(validateVerificationReport(visual, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("satisfies canonical requirement-text execution and visual matches without changing proof axes", () => {
    const report = generateVerificationReport({
      title: "Keep settings panel readable with regression coverage",
      description: "Adds settings-panel coverage.",
      taskText: "Acceptance criteria: keep the settings panel readable at 375px and add settings panel regression tests.",
      changedFiles: [
        { path: "src/settings/Panel.tsx", status: "modified", patch: "+ return <section>settings panel</section>" },
        { path: "src/settings/Panel.test.tsx", status: "modified", patch: "+ it('renders settings panel', () => {})" }
      ],
      checks: [
        { name: "Settings panel regression tests", status: "passed", summary: "Settings panel regression tests passed." },
        { name: "Browser QA settings panel", status: "passed", summary: "Status: passed. Settings panel visual viewport check passed." }
      ],
      logs: []
    } satisfies PullRequestInput);
    const axes = structuredClone(report.requirements[0]?.proofAxes);

    expect(report.requirements[0]?.proofAxes).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: "execution", state: "satisfied" }),
      expect.objectContaining({ subject: "visual", state: "satisfied" })
    ]));
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
    expect(report.requirements[0]?.proofAxes).toEqual(axes);
  });

  it("keeps docs-only static proof met and ignores unrelated failed execution", () => {
    const input = {
      title: "Document retry queue setup",
      description: "Documents retry queue setup.",
      taskText: "Acceptance criteria: document retry queue setup.",
      changedFiles: [{ path: "docs/retry-queue.md", additions: 8, deletions: 0, status: "modified" as const, patch: "+ Retry queue setup" }],
      checks: [],
      logs: []
    } satisfies PullRequestInput;
    const artifactOnly = generateVerificationReport(input);
    const withUnrelatedFailure = generateVerificationReport({
      ...input,
      checks: [{ name: "Unrelated integration", status: "failed", summary: "Unrelated integration workflow failed." }]
    });

    expect(artifactOnly.requirements[0]).toMatchObject({ status: "met", gaps: [] });
    expect(validateVerificationReport(artifactOnly, { mode: "full" })).toEqual({ valid: true, errors: [] });
    expect(withUnrelatedFailure.requirements[0]).toMatchObject({ status: "met", gaps: [] });
  });

  it("does not attach an unrelated failed execution signal to every requirement", () => {
    const baseInput = {
      title: "Add retry handling and tests",
      description: "Adds retry handling and tests, plus CI workflow coverage.",
      taskText: [
        "Acceptance criteria: add retry handling and tests.",
        "Acceptance criteria: add retry queue CI workflow."
      ].join("\n"),
      changedFiles: [
        { path: "src/queues/retry.ts", additions: 8, deletions: 0, status: "modified", patch: "+ export function retry() {}" },
        { path: "src/queues/retry.test.ts", additions: 8, deletions: 0, status: "modified", patch: "+ it('retries', () => {})" },
        { path: ".github/workflows/retry.yml", additions: 8, deletions: 0, status: "modified", patch: "+ name: Retry CI" }
      ],
      checks: [],
      logs: []
    } satisfies PullRequestInput;

    for (const check of [
      { name: "Payments integration tests", status: "failed" as const, summary: "Payments integration tests failed." },
      { name: "Docs build", status: "failed" as const, summary: "Documentation build failed." }
    ]) {
      const report = generateVerificationReport({ ...baseInput, checks: [check] });
      expect(report.requirements.every((requirement) => !requirement.gaps.join(" ").includes("CI has a failing check"))).toBe(true);
      expect(report.proofGraph.nodes.every((node) => !node.gapSignals.some((gap) => gap.kind === "failed_execution"))).toBe(true);
    }
  });

  it("keeps a generic failed test visible at report level without assigning it to a requirement", () => {
    const report = generateVerificationReport({
      title: "Add retry handling and tests",
      description: "Adds retry handling and tests.",
      taskText: "Acceptance criteria: add retry handling and tests.",
      changedFiles: [
        { path: "src/queues/retry.ts", additions: 8, deletions: 0, status: "modified", patch: "+ export function retry() {}" },
        { path: "src/queues/retry.test.ts", additions: 8, deletions: 0, status: "modified", patch: "+ it('retries', () => {})" }
      ],
      checks: [{ name: "unit tests", status: "failed", summary: "One test failed." }],
      logs: []
    } satisfies PullRequestInput);

    expect(report.testing.ciStatus).toBe("failed");
    expect(report.requirements[0]?.gaps.join(" ")).not.toContain("CI has a failing check");
    expect(report.proofGraph.nodes[0]?.gapSignals.some((gap) => gap.kind === "failed_execution")).toBe(false);
  });

  it("does not treat a domain-prefixed pasted-log failure as repository-wide", () => {
    const report = generateVerificationReport({
      title: "Add retry handling and tests",
      description: "Adds retry handling and tests.",
      taskText: "Acceptance criteria: add retry handling and tests.",
      changedFiles: [
        { path: "src/queues/retry.ts", additions: 8, deletions: 0, status: "modified", patch: "+ export function retry() {}" },
        { path: "src/queues/retry.test.ts", additions: 8, deletions: 0, status: "modified", patch: "+ it('retries', () => {})" }
      ],
      checks: [],
      logs: [{ source: "pasted logs", status: "failed", text: "Payments integration tests failed" }]
    } satisfies PullRequestInput);

    expect(report.requirements[0]?.gaps.join(" ")).not.toContain("CI has a failing check");
    expect(report.proofGraph.nodes[0]?.gapSignals.some((gap) => gap.kind === "failed_execution")).toBe(false);
  });

  it("requires every explicit documentation, CI, and test proof axis instead of choosing one objective kind", () => {
    const documentationAndTest = generateVerificationReport({
      title: "Document retry queue and add coverage",
      description: "Documents retry queue setup and adds regression coverage.",
      taskText: "Acceptance criteria: document retry queue setup and add a regression test.",
      changedFiles: [{ path: "docs/retry-queue.md", additions: 8, deletions: 0, status: "modified", patch: "+ Retry queue setup" }],
      checks: [],
      logs: []
    } satisfies PullRequestInput);
    const ciAndTest = generateVerificationReport({
      title: "Add retry queue workflow and coverage",
      description: "Adds CI workflow and regression coverage.",
      taskText: "Acceptance criteria: add a retry queue CI workflow and a regression test.",
      changedFiles: [{ path: ".github/workflows/retry-queue.yml", additions: 8, deletions: 0, status: "modified", patch: "+ name: Retry queue CI" }],
      checks: [{ name: "CI", status: "passed", summary: "Retry queue CI workflow test suite passed." }],
      logs: []
    } satisfies PullRequestInput);
    const koreanDocumentationAndTest = generateVerificationReport({
      title: "재시도 큐 문서와 회귀 테스트",
      description: "재시도 큐 문서를 추가하고 회귀 테스트를 추가합니다.",
      taskText: "수용 기준: 재시도 큐 문서를 추가하고 회귀 테스트를 추가합니다.",
      changedFiles: [{ path: "docs/retry-queue.md", additions: 8, deletions: 0, status: "modified", patch: "+ Retry queue setup" }],
      checks: [],
      logs: []
    } satisfies PullRequestInput);

    for (const report of [documentationAndTest, ciAndTest, koreanDocumentationAndTest]) {
      const gaps = report.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind);
      expect(gaps).toContain("missing_targeted_test");
      expect(gaps).not.toContain("missing_implementation");
    }
  });

  it("uses a targeted-test gap when an explicit test-only criterion lacks a test artifact", () => {
    const report = generateVerificationReport(demoScenarios["missing-tests"]);
    const testObjective = report.proofGraph.nodes.find((node) => /add tests? for csv generation/i.test(node.requirementText));

    expect(testObjective?.gapSignals.map((gap) => gap.kind)).toContain("missing_targeted_test");
    expect(testObjective?.gapSignals.map((gap) => gap.kind)).not.toContain("missing_implementation");
  });

  it("does not require visual proof for non-visual formatting behavior", () => {
    const report = generateVerificationReport({
      title: "Normalize invoice references",
      description: "Trim and uppercase invoice references before display.",
      taskText: "Normalize invoice references before display.",
      changedFiles: [
        { path: "src/billing/invoice-reference.js", additions: 8, deletions: 0, status: "modified", patch: "+ return value.trim().toUpperCase();" },
        { path: "test/invoice-reference.test.js", additions: 8, deletions: 0, status: "modified", patch: "+ expect(normalizeInvoiceReference(' ab ')).toBe('AB');" }
      ],
      checks: [{ name: "unit-tests", status: "passed", summary: "Invoice reference tests passed." }],
      logs: []
    } satisfies PullRequestInput);

    expect(report.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind)).not.toContain("visual_proof_missing");
  });

  it("links an unfiltered generic suite to a changed requirement test only through a verified suite observation", () => {
    const input = {
      title: "Add repository search empty state",
      description: "Adds repository search empty-state behavior.",
      taskText: "Search results must show an empty-state message when no repositories match.",
      changedFiles: [
        { path: "src/repositories/RepositorySearch.js", additions: 10, deletions: 0, status: "added", patch: "+ export function emptyStateMessage() {}" },
        { path: "test/repository-search.test.js", additions: 12, deletions: 0, status: "added", patch: "+ import { emptyStateMessage } from '../src/repositories/RepositorySearch.js';\n+ test('shows an empty state', () => { emptyStateMessage(); })" }
      ],
      checks: [{ name: "unit-tests", status: "passed", summary: "Unit tests passed." }],
      logs: [{ source: "GitHub Actions job: unit-tests", status: "passed", text: "GitHub Actions job unit-tests: passed. Steps: Run npm test: passed." }],
      sourceProvenance: githubInventoryProvenance("c".repeat(40)),
      executionSuites: [{
        status: "passed",
        headSha: "c".repeat(40),
        executionSource: "GitHub Actions job: unit-tests",
        runner: "node_test",
        scope: "repository_discovery",
        testPaths: ["test/repository-search.test.js"]
      }]
    } as PullRequestInput;

    const report = generateVerificationReport(input);
    const execution = report.requirements[0]?.proofAxes?.find((axis) => axis.subject === "execution");

    expect(execution).toMatchObject({
      state: "satisfied",
      collectionBasis: "passing_suite_execution"
    });
    expect(report.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind)).not.toContain("missing_execution");
  });

  it.each([
    {
      name: "no implementation import",
      testPatch: "+test('formats a name', () => { expect(customerDisplayName(false)).toBe('Ada'); });",
      extraImplementationPaths: []
    },
    {
      name: "barrel import",
      testPatch: [
        "+import { customerDisplayName } from '../src/index.js';",
        "+test('formats a name', () => { expect(customerDisplayName(false)).toBe('Ada'); });"
      ].join("\n"),
      extraImplementationPaths: []
    },
    {
      name: "ambiguous implementation targets",
      testPatch: [
        "+import { customerDisplayName } from '../src/customers/display-name.js';",
        "+test('formats a name', () => { expect(customerDisplayName(false)).toBe('Ada'); });"
      ].join("\n"),
      extraImplementationPaths: ["src/legacy/customer-display-name.js"]
    }
  ])("does not attach an ordinary targeted test through $name", ({ testPatch, extraImplementationPaths }) => {
    const headSha = "f".repeat(40);
    const testPath = "test/customer-display-name.test.js";
    const report = generateVerificationReport({
      title: "Add customer display-name tests",
      description: "Adds focused customer display-name coverage.",
      taskText: "Acceptance criteria: add focused customer display-name tests.",
      taskSource: "issue",
      changedFiles: [
        {
          path: "src/customers/display-name.js",
          status: "modified",
          patch: "+export function customerDisplayName() { return 'Ada'; }"
        },
        ...extraImplementationPaths.map((path) => ({
          path,
          status: "modified" as const,
          patch: "+export function customerDisplayName() { return 'Legacy Ada'; }"
        })),
        { path: testPath, status: "modified", patch: testPatch }
      ],
      checks: [{ name: "unit-tests", status: "passed", summary: "Unit tests passed." }],
      logs: [{ source: "GitHub Actions job: unit-tests", status: "passed", text: "npm test passed." }],
      sourceProvenance: githubInventoryProvenance(headSha),
      executionSuites: [{
        headSha,
        status: "passed",
        executionSource: "GitHub Actions job: unit-tests",
        runner: "node_test",
        scope: "repository_discovery",
        testPaths: [testPath]
      }]
    } satisfies PullRequestInput);
    const finding = report.requirements[0];
    const node = report.proofGraph.nodes[0];

    expect(node?.targetedTestEvidenceRefs).toEqual([]);
    expect(finding?.proofAxes).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: "targeted_test", state: "violated" }),
      expect.objectContaining({ subject: "execution", state: "incomplete" })
    ]));
    expect(finding?.status).not.toBe("met");
  });

  it("retains a directly imported related test but keeps both-path coverage incomplete with one asserted call", () => {
    const report = generateVerificationReport(customerDisplayNameBothPathsInput({
      testPatch: [
        "+import assert from 'node:assert/strict';",
        "+import { customerDisplayName } from '../src/customers/display-name.js';",
        "+test('formats a short name', () => { assert.equal(customerDisplayName(false), 'Ada'); });"
      ].join("\n")
    }));
    const finding = report.requirements[0];
    const relatedPaths = refsToEvidence(report, report.proofGraph.nodes[0]?.targetedTestEvidenceRefs ?? [])
      .map((item) => item.locator);

    expect(relatedPaths).toContain("test/customer-display-name.test.js");
    expect(finding?.proofAxes).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: "targeted_test", state: "incomplete" })
    ]));
    expect(report.proofGraph.nodes[0]?.gapSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "missing_targeted_test",
        message: expect.stringMatching(/two distinct direct assertion cases.*exact-head suite/i)
      })
    ]));
    expect(finding?.status).not.toBe("met");
  });

  it("completes both-path coverage with two distinct asserted direct calls and an exact-head suite", () => {
    const report = generateVerificationReport(customerDisplayNameBothPathsInput({
      testPatch: [
        "+import assert from 'node:assert/strict';",
        "+import { customerDisplayName } from '../src/customers/display-name.js';",
        "+test('formats a short name', () => { assert.equal(customerDisplayName(false), 'Ada'); });",
        "+test('formats a full name', () => { assert.equal(customerDisplayName(true), 'Ada Lovelace'); });"
      ].join("\n")
    }));
    const finding = report.requirements[0];
    const node = report.proofGraph.nodes[0] as typeof report.proofGraph.nodes[number] & {
      caseCoverageReceipt?: {
        version: number;
        implementationEvidenceRef: string;
        testEvidenceRef: string;
        distinctLiteralCaseCount: number;
      };
    };

    expect(finding?.proofAxes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        subject: "targeted_test",
        state: "satisfied",
        collectionBasis: "direct_assertion_case_coverage"
      }),
      expect.objectContaining({
        subject: "execution",
        state: "satisfied",
        collectionBasis: "passing_suite_execution"
      })
    ]));
    expect(finding?.status).toBe("met");
    expect(node.caseCoverageReceipt).toEqual({
      version: 1,
      implementationEvidenceRef: expect.stringMatching(/^ev_/),
      testEvidenceRef: expect.stringMatching(/^ev_/),
      distinctLiteralCaseCount: 2
    });
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it.each([
    {
      name: "stale-head suite",
      executionSuites: [{
        headSha: "e".repeat(40),
        status: "passed" as const,
        executionSource: "GitHub Actions job: unit-tests",
        runner: "node_test" as const,
        scope: "repository_discovery" as const,
        testPaths: ["test/customer-display-name.test.js"]
      }]
    },
    {
      name: "filtered explicit-path suite",
      executionSuites: [{
        headSha: "d".repeat(40),
        status: "passed" as const,
        executionSource: "GitHub Actions job: unit-tests",
        runner: "node_test" as const,
        scope: "explicit_paths" as const,
        testPaths: ["test/customer-display-name.test.js"]
      }]
    }
  ])("keeps both-path coverage incomplete for a $name", ({ executionSuites }) => {
    const report = generateVerificationReport(customerDisplayNameBothPathsInput({ executionSuites }));
    const finding = report.requirements[0];

    expect(report.proofGraph.nodes[0]?.targetedTestEvidenceRefs.length).toBeGreaterThan(0);
    expect(finding?.proofAxes).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: "targeted_test", state: "incomplete" }),
      expect.objectContaining({ subject: "execution", state: "incomplete" })
    ]));
    expect(finding?.status).not.toBe("met");
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("keeps explicit search UI behavior partial when only logic and suite execution are linked", () => {
    const headSha = "d".repeat(40);
    const report = generateVerificationReport({
      title: "Add repository search empty state",
      description: "Adds search behavior.",
      taskText: "Search results must show an empty-state message when no repositories match.",
      changedFiles: [
        { path: "src/repositories/RepositorySearch.js", additions: 8, deletions: 0, status: "added", patch: "+ export function emptyStateMessage() {}" },
        { path: "test/repository-search.test.js", additions: 8, deletions: 0, status: "added", patch: "+ import { emptyStateMessage } from '../src/repositories/RepositorySearch.js';\n+ test('empty state', () => { emptyStateMessage(); })" }
      ],
      checks: [{ name: "unit-tests", status: "passed", summary: "Unit tests passed." }],
      logs: [{ source: "GitHub Actions job: unit-tests", status: "passed", text: "Steps: Run node --test: passed." }],
      executionSuites: [{ headSha, status: "passed", executionSource: "GitHub Actions job: unit-tests", runner: "node_test", scope: "repository_discovery", testPaths: ["test/repository-search.test.js"] }],
      sourceProvenance: githubInventoryProvenance(headSha)
    } satisfies PullRequestInput);

    const axes = report.requirements[0]?.proofAxes ?? [];
    expect(axes).toContainEqual(expect.objectContaining({ subject: "execution", state: "satisfied" }));
    expect(axes).toContainEqual(expect.objectContaining({ subject: "interaction", state: "incomplete" }));
    expect(report.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind)).toContain("interaction_proof_missing");
    expect(report.requirements[0]?.status).toBe("partial");
  });

  it("requires visual proof only for an explicit visual acceptance criterion", () => {
    const report = generateVerificationReport({
      title: "Keep compact settings readable",
      description: "Keep the compact settings panel readable at 375px.",
      taskText: "Keep the compact settings panel readable at 375px.",
      changedFiles: [{ path: "src/settings/CompactPanel.css", additions: 8, deletions: 0, status: "modified", patch: "+ .panel { overflow-wrap: anywhere; }" }],
      checks: [{ name: "unit-tests", status: "passed", summary: "Settings tests passed." }],
      logs: []
    } satisfies PullRequestInput);

    expect(report.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind)).toContain("visual_proof_missing");
  });

  it("prioritizes an explicit visual-proof gap above generic missing execution", () => {
    const report = generateVerificationReport({
      title: "Keep compact settings readable",
      description: "Keep the compact settings panel readable at 375px.",
      taskText: "Keep the compact settings panel readable at 375px.",
      changedFiles: [{ path: "src/settings/CompactPanel.css", additions: 8, deletions: 0, status: "modified", patch: "+ .panel { overflow-wrap: anywhere; }" }],
      checks: [],
      logs: []
    } satisfies PullRequestInput);
    const gaps = report.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind) ?? [];

    expect(gaps.indexOf("visual_proof_missing")).toBeLessThan(gaps.indexOf("missing_execution"));
  });

  it("does not attach an unrelated generic failed check to a requirement", () => {
    const report = generateVerificationReport({
      title: "Format customer display name",
      description: "Format and trim the customer display name.",
      taskText: "Format and trim the customer display name.",
      changedFiles: [
        { path: "src/customers/display-name.js", additions: 8, deletions: 0, status: "modified", patch: "+ return name.trim();" },
        { path: "test/customer-display-name.test.js", additions: 8, deletions: 0, status: "modified", patch: "+ expect(displayName(' Ada ')).toBe('Ada');" }
      ],
      checks: [
        { name: "display-name tests", status: "passed", summary: "Customer display name tests passed." },
        { name: "integration tests", status: "failed", summary: "CSV import integration failed." }
      ],
      logs: []
    } satisfies PullRequestInput);

    expect(report.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind)).not.toContain("failed_execution");
    expect(report.testing.ciStatus).toBe("failed");
  });

  it("treats a no-implementation-change constraint as an independent proof obligation", () => {
    const report = generateVerificationReport({
      title: "Add connection label regression tests",
      description: "Add tests. Do not change implementation code.",
      taskText: "Acceptance criteria:\n- Add a regression test for connectionLabel.\n- Do not change implementation code.",
      changedFiles: [{ path: "test/connection-label.test.js", additions: 8, deletions: 0, status: "modified", patch: "+ expect(connectionLabel(false)).toBe('Connected');" }],
      checks: [{ name: "unit-tests", status: "passed", summary: "Connection label tests passed." }],
      logs: [],
      sourceProvenance: githubInventoryProvenance()
    } satisfies PullRequestInput);

    const noChange = report.proofGraph.nodes.find((node) => /Do not change implementation/i.test(node.requirementText));
    expect(noChange?.gapSignals.map((gap) => gap.kind)).not.toContain("missing_implementation");
    expect(report.requirements.find((item) => item.requirementId === noChange?.requirementId)?.status).not.toBe("unclear");
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

function githubInventoryProvenance(headSha = "a".repeat(40), inventoryHeadSha = headSha): NonNullable<PullRequestInput["sourceProvenance"]> {
  return {
    version: 1,
    origin: "github_snapshot",
    headSha,
    baseSha: "b".repeat(40),
    evidenceCapturedAt: "2026-08-11T00:00:00.000Z",
    changedFileInventory: {
      version: 1,
      completeness: "complete",
      headSha: inventoryHeadSha
    },
    inputFingerprint: {
      version: 1,
      algorithm: "sha256",
      value: "c".repeat(64),
      coverage: "github_metadata"
    }
  };
}

function customerDisplayNameBothPathsInput(overrides: {
  testPatch?: string;
  executionSuites?: NonNullable<PullRequestInput["executionSuites"]>;
} = {}): PullRequestInput {
  const headSha = "d".repeat(40);
  return {
    title: "Cover both customer display-name paths",
    description: "Adds focused customer display-name tests.",
    taskText: "Acceptance criteria: add focused tests for both paths of customer display-name formatting.",
    taskSource: "issue",
    changedFiles: [
      {
        path: "src/customers/display-name.js",
        status: "modified",
        patch: "+export function customerDisplayName(includeFamilyName) { return includeFamilyName ? 'Ada Lovelace' : 'Ada'; }"
      },
      {
        path: "test/customer-display-name.test.js",
        status: "modified",
        patch: overrides.testPatch ?? [
          "+import assert from 'node:assert/strict';",
          "+import { customerDisplayName } from '../src/customers/display-name.js';",
          "+test('formats a short name', () => { assert.equal(customerDisplayName(false), 'Ada'); });",
          "+test('formats a full name', () => { assert.equal(customerDisplayName(true), 'Ada Lovelace'); });"
        ].join("\n")
      }
    ],
    checks: [{ name: "unit-tests", status: "passed", summary: "Unit tests passed." }],
    logs: [{
      source: "GitHub Actions job: unit-tests",
      status: "passed",
      text: "GitHub Actions job unit-tests: passed. Steps: Run npm test: passed."
    }],
    sourceProvenance: githubInventoryProvenance(headSha),
    executionSuites: overrides.executionSuites ?? [{
      headSha,
      status: "passed",
      executionSource: "GitHub Actions job: unit-tests",
      runner: "node_test",
      scope: "repository_discovery",
      testPaths: ["test/customer-display-name.test.js"]
    }]
  };
}
