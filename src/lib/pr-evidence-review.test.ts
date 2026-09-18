import { describe, expect, it } from "vitest";
import type { VerificationReport, VerificationReportV2 } from "./types";
import { buildDashboardPrEvidenceReview, buildExactGitHubFileUrl, buildPrEvidenceReview } from "./pr-evidence-review";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);

function report(overrides: Partial<VerificationReportV2> = {}): VerificationReportV2 {
  return {
    analysisId: "review-fixture",
    createdAt: "2026-09-15T00:00:00.000Z",
    analysisContext: "linked_issue",
    source: {
      title: "Review fixture",
      url: "https://github.com/acme/widget/pull/42",
      provenance: {
        version: 1,
        origin: "github_snapshot",
        headSha: HEAD,
        baseSha: BASE,
        evidenceCapturedAt: "2026-09-15T00:00:00.000Z",
        inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" },
      },
    },
    summary: { oneLine: "Evidence needs review.", confidence: 0.5, priority: "medium", evidenceCoverage: 50, topRisks: [] },
    requirements: [{
      requirementId: "req_1",
      requirementText: "Reject expired reset links.",
      status: "met",
      evidenceStatus: "met",
      evidenceRefs: ["ev_code", "ev_test", "ev_check"],
      gaps: [],
      reviewerNote: "Review evidence.",
      confidence: 0.8,
      proofAxes: [
        { subject: "implementation", polarity: "present", state: "satisfied", evidenceRefs: ["ev_code"], collectionBasis: "matching_artifact_evidence" },
        { subject: "targeted_test", polarity: "present", state: "satisfied", evidenceRefs: ["ev_test"], collectionBasis: "matching_artifact_evidence" },
        { subject: "execution", polarity: "present", state: "satisfied", evidenceRefs: ["ev_check"], collectionBasis: "passing_suite_execution" },
      ],
    }],
    claims: [],
    scope: { suspected: false, outOfScopeFiles: [], reasons: [] },
    testing: { ciStatus: "passed", lintStatus: "unknown", typecheckStatus: "unknown", missingTests: [] },
    reviewPriority: [],
    proofGraph: {
      version: 1,
      nodes: [{
        requirementId: "req_1",
        requirementText: "Reject expired reset links.",
        sourceRole: "core_requirement",
        sourceQuality: "linked_issue",
        sourceSection: null,
        contextRoles: [],
        status: "met",
        confidence: 0.8,
        implementationEvidenceRefs: ["ev_code"],
        targetedTestEvidenceRefs: ["ev_test"],
        executionEvidenceRefs: ["ev_check"],
        gapSignals: [],
        firstFiles: ["src/reset.ts", "src/reset.test.ts"],
      }],
      context: [],
      summary: { requirementCount: 1, requirementsWithImplementation: 1, requirementsWithTargetedTests: 1, requirementsWithExecution: 1, requirementsWithGaps: 0, gapCount: 0 },
    },
    reprompt: { targetAgent: "codex", prompt: "Review the evidence." },
    evidenceIndex: [
      { id: "ev_issue", kind: "task", label: "Linked issue", summary: "Issue requirements.", confidence: 0.95 },
      { id: "ev_code", kind: "diff", label: "src/reset.ts", locator: "src/reset.ts", codeLocation: { path: "src/reset.ts", side: "head", revisionSha: HEAD }, summary: "modified src/reset.ts (+3/-1).", confidence: 0.85 },
      { id: "ev_test", kind: "test", label: "src/reset.test.ts", locator: "src/reset.test.ts", codeLocation: { path: "src/reset.test.ts", side: "head", revisionSha: HEAD }, summary: "renamed src/reset.test.ts (+4/-0). Test evidence file.", confidence: 0.85 },
      { id: "ev_check", kind: "check", label: "unit tests", locator: "https://github.com/acme/widget/actions/runs/7", summary: "Status: passed. unit tests", confidence: 0.9 },
    ],
    limitations: [],
    reportSchemaVersion: "verification-report.v2",
    verificationContract: { version: 2, policy: "strict_typed_contract", state: "absent", source: null, gaps: [{ kind: "verification_contract_missing", message: "Approved verification contract is missing." }], objectives: [], integrity: null },
    generalPrAssessmentSummary: {
      version: 1,
      mode: "ordinary_pr",
      sourceState: "linked_issue",
      overallConclusion: "evidence_supports_stated_change",
      counts: { evidence_supported: 1, evidence_partial: 0, not_demonstrated: 0, contradicted: 0, blocked: 0, not_assessable: 0 },
      reasonCodes: ["implementation_evidence_observed", "test_artifact_observed", "exact_execution_passed"],
    },
    ...overrides,
  } as VerificationReportV2;
}

describe("PR-to-Evidence review projection", () => {
  it("uses only exact requirement-local firstFiles as candidate fallback when code refs are absent", () => {
    const base = report();
    const input = report({
      requirements: [{ ...base.requirements[0]!, evidenceRefs: ["ev_check"], proofAxes: [] }],
      proofGraph: { ...base.proofGraph, nodes: [{ ...base.proofGraph.nodes[0]!, implementationEvidenceRefs: [], targetedTestEvidenceRefs: [], executionEvidenceRefs: [], firstFiles: ["src/reset.ts", "src/reset.test.ts", "reset.ts"] }] },
    });
    for (const review of [buildPrEvidenceReview(input), buildDashboardPrEvidenceReview({ report: input })!]) {
      expect(review.objectives[0]).toMatchObject({ code: [{ evidenceId: "ev_code", relation: "candidate" }], tests: [{ evidenceId: "ev_test", relation: "candidate" }], nextInspection: "Inspect src/reset.ts." });
    }
    input.proofGraph.nodes[0]!.firstFiles = ["reset.ts"];
    input.reviewPriority = [{ path: "src/reset.ts", priority: "high", reason: "global only", evidenceRefs: [] }];
    for (const review of [buildPrEvidenceReview(input), buildDashboardPrEvidenceReview({ report: input })!]) {
      expect(review.objectives[0]?.code).toEqual([]);
      expect(review.objectives[0]?.nextInspection).toContain("actions/runs/7");
    }
  });

  it("keeps explicit code refs ahead of firstFiles and orders first inspection code then test then execution", () => {
    const base = report();
    base.proofGraph.nodes[0]!.firstFiles = ["src/unrelated.ts"];
    base.evidenceIndex.push({ id: "other", kind: "diff", label: "src/unrelated.ts", locator: "src/unrelated.ts", confidence: 0.5, summary: "Other change" });
    for (const review of [buildPrEvidenceReview(base), buildDashboardPrEvidenceReview({ report: base })!]) {
      expect(review.objectives[0]?.code.map((item) => item.evidenceId)).toEqual(["ev_code"]);
      expect(review.objectives[0]?.nextInspection).toBe("Inspect src/reset.ts.");
    }
    for (const [refs, expected] of [[['ev_test', 'ev_check'], 'Inspect src/reset.test.ts.'], [['ev_check'], 'Inspect https://github.com/acme/widget/actions/runs/7.'], [[], 'Link unconfirmed; inspect collected changes separately.']] as const) {
      const input = report({ requirements: [{ ...base.requirements[0]!, evidenceRefs: [...refs], proofAxes: [] }], proofGraph: { ...base.proofGraph, nodes: [] } });
      for (const review of [buildPrEvidenceReview(input), buildDashboardPrEvidenceReview({ report: input })!]) {
        expect(review.objectives[0]?.nextInspection).toBe(expected);
        expect(review.nextInspection).toBe(expected);
      }
    }
  });

  it("groups linked-issue evidence without turning report status into a fulfillment verdict", () => {
    const review = buildPrEvidenceReview(report());

    expect(review).toMatchObject({
      mode: "objectives",
      source: { kind: "linked_issue", label: "Linked issue requirement source", authority: "issue_source" },
      objectives: [{
        id: "req_1",
        text: "Reject expired reset links.",
        code: [{ evidenceId: "ev_code", relation: "observed", url: `https://github.com/acme/widget/blob/${HEAD}/src/reset.ts` }],
        tests: [{ evidenceId: "ev_test", relation: "observed", url: `https://github.com/acme/widget/blob/${HEAD}/src/reset.test.ts` }],
        execution: [{ evidenceId: "ev_check", relation: "observed", executionMeaning: "Repository suite passed; individual test execution is not established." }],
      }],
    });
    expect(JSON.stringify(review)).not.toContain('"status":"met"');
    expect(JSON.stringify(review)).not.toContain("fulfilled");
  });

  it("keeps displayed Issue requirements linked to their canonical source when assessment selected the PR title", () => {
    const input = report({
      analysisContext: "linked_issue",
      generalPrAssessmentSummary: {
        ...report().generalPrAssessmentSummary!,
        sourceState: "pr_author_claim",
        reasonCodes: ["author_claim_requires_confirmation"]
      }
    });

    expect(buildPrEvidenceReview(input).source).toEqual({
      kind: "linked_issue",
      label: "Linked issue requirement source",
      authority: "issue_source"
    });
    expect(buildDashboardPrEvidenceReview({ analysisContext: "linked_issue", report: input })?.source).toEqual({
      kind: "linked_issue",
      label: "Linked issue requirement source",
      authority: "issue_source"
    });
  });

  it("derives provided and mixed source labels from displayed requirement provenance", () => {
    const provided = report({
      analysisContext: "provided_requirement",
      generalPrAssessmentSummary: { ...report().generalPrAssessmentSummary!, sourceState: "pr_author_claim" }
    });
    const mixed = report({
      analysisContext: "linked_issue",
      requirements: [
        report().requirements[0]!,
        { ...report().requirements[0]!, requirementId: "req_2", requirementText: "Document the change.", sourceAuthority: "pr_description" }
      ],
      generalPrAssessmentSummary: { ...report().generalPrAssessmentSummary!, sourceState: "pr_author_claim" }
    });

    expect(buildPrEvidenceReview(provided).source).toEqual({
      kind: "provided_requirement",
      label: "Provided requirement source",
      authority: "provided_source"
    });
    expect(buildPrEvidenceReview(mixed).source).toEqual({
      kind: "mixed",
      label: "Linked issue and PR author sources",
      authority: "mixed_sources"
    });

    const providedMixed = report({ ...mixed, analysisContext: "provided_requirement" });
    expect(buildPrEvidenceReview(providedMixed).source).toEqual({
      kind: "mixed",
      label: "Provided requirement and PR author sources",
      authority: "mixed_sources"
    });

    const { analysisContext: _analysisContext, ...unknownReport } = mixed;
    expect(buildDashboardPrEvidenceReview({ report: unknownReport })?.source).toEqual({
      kind: "mixed",
      label: "Mixed requirement sources",
      authority: "mixed_sources"
    });
  });

  it("does not infer missing displayed provenance from assessment source state", () => {
    const input = report();
    const { analysisContext: _context, ...unknown } = input;
    for (const summary of [undefined, input.generalPrAssessmentSummary, { ...input.generalPrAssessmentSummary!, sourceState: "mixed" as const }]) {
      const candidate = { ...unknown, generalPrAssessmentSummary: summary };
      expect(buildPrEvidenceReview(candidate as VerificationReport).source).toBeNull();
      expect(buildDashboardPrEvidenceReview({ report: candidate })?.source).toBeNull();
    }
  });

  it("reserves verified for deterministic relation receipts", () => {
    const base = report();
    const input = report({
      proofGraph: {
        ...base.proofGraph,
        nodes: [{
          ...base.proofGraph.nodes[0]!,
          caseCoverageReceipt: {
            version: 1,
            implementationEvidenceRef: "ev_code",
            testEvidenceRef: "ev_test",
            distinctLiteralCaseCount: 2,
          },
        }],
        executionBindingReceipts: [{
          id: "exec_binding_1",
          version: 2,
          kind: "execution_binding",
          requirementId: "req_1",
          testEvidenceRef: "ev_test",
          executionEvidenceRef: "ev_check",
          headBindingDigest: "digest",
          scope: "exact_test",
        }],
      },
    });

    expect(buildPrEvidenceReview(input).objectives[0]).toMatchObject({
      code: [{ relation: "verified" }],
      tests: [{ relation: "verified" }],
      execution: [{ relation: "verified" }],
    });
  });

  it("does not apply a target-level verified label to every evidence reference", () => {
    const input = report({
      generalPrAssessment: {
        ...report().generalPrAssessmentSummary!,
        targets: [{
          version: 1,
          targetId: "target_1",
          sourceBindingRef: "source_1",
          sourceAuthority: "linked_issue",
          sourceSpanRefs: ["span_1"],
          requirementId: "req_1",
          admissionBasis: "explicit_structure",
          claimRole: "behavioral_objective",
          conclusion: "evidence_supported",
          reasonCodes: ["implementation_evidence_observed"],
          evidenceRefs: ["ev_code", "ev_test"],
          relationLevels: ["verified", "observed"],
          headBound: true,
        }],
      },
    });

    expect(buildPrEvidenceReview(input).objectives[0]).toMatchObject({
      code: [{ relation: "observed" }],
      tests: [{ relation: "observed" }],
    });
  });

  it("labels no-issue objectives as PR-author claims and keeps LLM-only links as candidates", () => {
    const input = report({
      analysisContext: "unlinked_pr",
      requirements: [{ ...report().requirements[0]!, sourceAuthority: "pr_description", proofAxes: [] }],
      proofGraph: { ...report().proofGraph, nodes: [{ ...report().proofGraph.nodes[0]!, implementationEvidenceRefs: [], targetedTestEvidenceRefs: [], executionEvidenceRefs: [] }] },
      semantic: {
        requirement_evidence_relations: [{ requirement_id: "req_1", evidence_id: "ev_code", relation: "direct_support", rationale: "Possible relation.", uncertainty: "medium" }],
        requirement_assessments: [], evidence_gaps: [], review_targets: [], remediation_requests: [], uncertainties: [],
      },
      generalPrAssessmentSummary: { ...report().generalPrAssessmentSummary!, sourceState: "pr_author_claim", reasonCodes: ["author_claim_requires_confirmation"] },
    });

    expect(buildPrEvidenceReview(input)).toMatchObject({
      source: { kind: "pr_author_claim", label: "PR author objective / claim", authority: "author_claim" },
      objectives: [{ code: [{ evidenceId: "ev_code", relation: "candidate" }] }],
    });
  });

  it("shows only collected change evidence when no requirements exist", () => {
    const input = report({
      requirements: [],
      generalPrAssessmentSummary: {
        ...report().generalPrAssessmentSummary!,
        sourceState: "missing",
        overallConclusion: "no_assessable_claims",
        counts: { evidence_supported: 0, evidence_partial: 0, not_demonstrated: 0, contradicted: 0, blocked: 0, not_assessable: 0 },
        reasonCodes: ["source_missing"],
      },
    });
    const review = buildPrEvidenceReview(input);

    expect(review.mode).toBe("change_summary");
    expect(review.source).toBeNull();
    expect(review.objectives).toEqual([]);
    expect(review.changes.map((item) => item.evidenceId)).toEqual(["ev_code", "ev_test", "ev_check"]);
    expect(JSON.stringify(review)).not.toMatch(/fallback requirement|unknown purpose|missing description/i);
  });

  it("binds file links only to a validated revision, path, side, and explicit line", () => {
    expect(buildExactGitHubFileUrl({ repositoryFullName: "acme/widget", revisionSha: HEAD, path: "src/reset.ts", line: 12 }))
      .toBe(`https://github.com/acme/widget/blob/${HEAD}/src/reset.ts#L12`);
    expect(buildExactGitHubFileUrl({ repositoryFullName: "acme/widget", revisionSha: BASE, path: "src/old.ts" }))
      .toBe(`https://github.com/acme/widget/blob/${BASE}/src/old.ts`);
    expect(buildExactGitHubFileUrl({ repositoryFullName: "acme/widget", revisionSha: "abc123", path: "src/reset.ts" })).toBeUndefined();
    expect(buildExactGitHubFileUrl({ repositoryFullName: "acme/widget", revisionSha: HEAD, path: "../secret.ts" })).toBeUndefined();
    expect(buildExactGitHubFileUrl({ repositoryFullName: "acme/widget/extra", revisionSha: HEAD, path: "src/reset.ts" })).toBeUndefined();
    expect(buildExactGitHubFileUrl({ repositoryFullName: "./widget", revisionSha: HEAD, path: "src/reset.ts" })).toBeUndefined();
    expect(buildExactGitHubFileUrl({ repositoryFullName: "acme/widget", revisionSha: HEAD, path: "src/./reset.ts" })).toBeUndefined();
    expect(buildExactGitHubFileUrl({ repositoryFullName: "acme/widget", revisionSha: HEAD, path: "src/reset.ts", line: 0 })).toBeUndefined();

    const removed = report({ evidenceIndex: [{ id: "ev_code", kind: "diff", label: "src/old.ts", locator: "src/old.ts", codeLocation: { path: "src/old.ts", side: "base" }, summary: "removed src/old.ts (+0/-4).", confidence: 0.85 }] });
    const renamed = report({ evidenceIndex: [{ id: "ev_code", kind: "diff", label: "src/new.ts", locator: "src/new.ts", codeLocation: { path: "src/new.ts", previousPath: "src/old.ts", side: "head" }, summary: "renamed src/new.ts (+1/-1).", confidence: 0.85 }] });
    expect(buildPrEvidenceReview(removed).objectives[0]?.code[0]?.url).toBe(`https://github.com/acme/widget/blob/${BASE}/src/old.ts`);
    expect(buildPrEvidenceReview(renamed).objectives[0]?.code[0]?.url).toBe(`https://github.com/acme/widget/blob/${HEAD}/src/new.ts`);
  });

  it("omits a guessed file link when saved-report metadata cannot establish its side", () => {
    const saved = report({
      source: { title: "GitHub pull request evidence report" },
      evidenceIndex: [{ id: "ev_code", kind: "diff", label: "Evidence ev_code", locator: "src/reset.ts", summary: "Bounded evidence metadata.", confidence: 0 }],
    });

    const review = buildPrEvidenceReview(saved, { repositoryFullName: "acme/widget", headSha: HEAD });
    expect(review.objectives[0]?.code[0]).toMatchObject({ evidenceId: "ev_code", relation: "observed" });
    expect(review.objectives[0]?.code[0]?.url).toBeUndefined();
  });

  it("rejects mismatched revisions, locators, and unrelated or credentialed execution URLs", () => {
    const mismatchedRevision = report({ evidenceIndex: [{ id: "ev_code", kind: "diff", label: "src/reset.ts", locator: "src/reset.ts", codeLocation: { path: "src/reset.ts", side: "head", revisionSha: BASE }, summary: "modified", confidence: 1 }] });
    const mismatchedPath = report({ evidenceIndex: [{ id: "ev_code", kind: "diff", label: "src/reset.ts", locator: "src/other.ts", codeLocation: { path: "src/reset.ts", side: "head", revisionSha: HEAD }, summary: "modified", confidence: 1 }] });
    const foreignCheck = report({ evidenceIndex: [{ id: "ev_check", kind: "check", label: "check", locator: "https://github.com/other/repo/actions/runs/7", summary: "Status: failed.", confidence: 1 }] });
    const credentialedCheck = report({ evidenceIndex: [{ id: "ev_check", kind: "check", label: "check", locator: "https://user:pass@github.com/acme/widget/actions/runs/7", summary: "Status: failed.", confidence: 1 }] });

    expect(buildPrEvidenceReview(mismatchedRevision).objectives[0]?.code[0]?.url).toBeUndefined();
    expect(buildPrEvidenceReview(mismatchedPath).objectives[0]?.code[0]?.url).toBeUndefined();
    expect(buildPrEvidenceReview(foreignCheck).objectives[0]?.execution[0]?.url).toBeUndefined();
    expect(buildPrEvidenceReview(credentialedCheck).objectives[0]?.execution[0]?.url).toBeUndefined();
  });
});
