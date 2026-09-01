import { describe, expect, it } from "vitest";
import { AGENTPROOF_COMMENT_MARKER, reportToGitHubComment, reportToMarkdown } from "./markdown";
import { demoScenarios } from "./sample-data";
import { generateVerificationReport } from "./verifier";
import { generateVerificationReportV2, generateVerificationReportV2FromInput } from "./verifier";
import type { PullRequestInput } from "./types";

const PRIVATE_ASSESSMENT_TERMS = [
  "sourceSpanRefs",
  "sourceBindingRef",
  "ledgerDigest",
  "semantic output",
  "workflowIdentity",
  "github_pat_",
  "diagnostics",
  "targets"
];

describe("reportToGitHubComment", () => {
  it("omits private proof receipts from Markdown and GitHub comments", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    const requirementId = report.requirements[0]!.requirementId;
    Object.assign(report.proofGraph, {
      sourceBindings: [{
        version: 1,
        kind: "requirement_source_binding",
        id: "PRIVATE_SOURCE_BINDING",
        requirementId,
        spanId: "sp_1_2",
        seedId: "1".repeat(64),
        groupId: "grp_1",
        source: "issue",
        ordinal: 1
      }],
      exactHeadTargetReceipts: [{
        id: "PRIVATE_EXACT_TARGET",
        version: 1,
        kind: "exact_head_target",
        headSha: "2".repeat(40),
        targetPathDigest: "3".repeat(64),
        targetBlobSha: "PRIVATE_TARGET_BLOB_SHA",
        exportKind: "named",
        canonicalBindingDigest: "4".repeat(64)
      }],
      testRelationReceipts: [{
        id: "PRIVATE_TEST_RELATION",
        version: 1,
        kind: "test_relation",
        requirementId,
        exactHeadTargetReceiptRef: "PRIVATE_EXACT_TARGET",
        testEvidenceRef: "PRIVATE_TEST_REF",
        executionEvidenceRef: "PRIVATE_EXECUTION_REF"
      }],
      failedCheckAssociations: [{
        version: 1,
        kind: "failed_check_association",
        requirementId,
        checkEvidenceRef: "PRIVATE_CHECK_REF",
        state: "unknown",
        basis: "identity_incomplete"
      }]
    });

    const output = `${reportToMarkdown(report)}\n${reportToGitHubComment(report)}`;
    for (const privateValue of [
      "PRIVATE_SOURCE_BINDING",
      "PRIVATE_EXACT_TARGET",
      "PRIVATE_TARGET_BLOB_SHA",
      "PRIVATE_TEST_RELATION",
      "PRIVATE_TEST_REF",
      "PRIVATE_EXECUTION_REF",
      "PRIVATE_CHECK_REF"
    ]) {
      expect(output).not.toContain(privateValue);
    }
  });

  it("separates v2 no-contract outcomes from observed implementation and execution evidence", () => {
    const report = generateVerificationReportV2FromInput(demoScenarios.clean);
    const markdown = reportToMarkdown(report);
    const comment = reportToGitHubComment(report);
    const output = `${markdown}\n${comment}`;

    expect(output).toContain("Strict verification contract");
    expect(output).toContain("**Outcome policy:** No approved verification contract; observed evidence does not establish the requirement outcome.");
    expect(output).toContain("**Observed evidence:** implementation, targeted tests, and execution are listed below.");
    expect(markdown.match(/Approved verification contract is missing\./g)).toHaveLength(1);
    expect(comment.match(/Approved verification contract is missing\./g)).toHaveLength(1);
    expect(output).not.toContain("Outcome was not assessed against an approved verification contract.");
  });

  it("renders the target-free ordinary-PR assessment without turning it into a contract outcome", () => {
    const report = generateVerificationReportV2FromInput(demoScenarios.clean);
    report.generalPrAssessmentSummary = {
      version: 1,
      mode: "ordinary_pr",
      sourceState: "pr_author_claim",
      overallConclusion: "evidence_partial",
      counts: { evidence_supported: 0, evidence_partial: 1, not_demonstrated: 0, contradicted: 0, blocked: 0, not_assessable: 0 },
      reasonCodes: ["author_claim_requires_confirmation", "semantic_observer_unavailable", "target_relation_unresolved"]
    };
    Object.assign(report.generalPrAssessmentSummary as Record<string, unknown>, {
      diagnostics: { ledgerDigest: "ledgerDigest", semanticOutput: "semantic output", workflowIdentity: "workflowIdentity", token: "github_pat_private" },
      targets: [{ sourceBindingRef: "sourceBindingRef", sourceSpanRefs: ["sourceSpanRefs"] }]
    });

    const output = `${reportToMarkdown(report)}\n${reportToGitHubComment(report)}`;

    expect(output).toContain("Ordinary PR evidence assessment");
    expect(output).toContain("Evidence partially supports the stated change");
    expect(output).toContain("PR description claim — reviewer confirmation needed");
    expect(output).toContain("Partial evidence: 1");
    expect(output).toContain("Semantic assessment was unavailable.");
    expect(output).toContain("The target-to-evidence relation remains unresolved.");
    for (const forbidden of PRIVATE_ASSESSMENT_TERMS) expect(output).not.toContain(forbidden);
  });

  it("uses the strict v2 outcome rather than high observed coverage on every Markdown surface", () => {
    const contract = {
      version: 2,
      scope: "complete_objective_set",
      objectives: [{
        id: "visibility_label",
        objective: "Return a repository visibility label.",
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
          cases: [{ id: "private", input: true, expected: "Private repository" }]
        }]
      }]
    };
    const input: PullRequestInput = {
      title: "Add repository visibility label",
      description: "Adds a visibility helper and focused tests.",
      taskText: "Return a repository visibility label.",
      taskSource: "issue",
      changedFiles: [{
        path: "src/repositories/repository-visibility.js",
        status: "added",
        patch: "+ export const repositoryVisibilityLabel = () => 'Private repository';"
      }],
      checks: [{ name: "repository visibility tests", status: "passed", summary: "Repository visibility tests passed." }],
      logs: [],
    };
    const report = generateVerificationReportV2({
      input,
      contractSource: { kind: "provided_requirement", contract },
      binding: {
        sourceKind: "provided_requirement",
        sourceIdentity: "manual:markdown-v2",
        sourceContent: JSON.stringify(contract),
        headSha: "a".repeat(40),
        baseSha: "b".repeat(40)
      }
    });

    const output = `${reportToMarkdown(report)}\n${reportToGitHubComment(report)}`;

    expect(report.requirements[0]).toMatchObject({ status: "unclear", evidenceStatus: "partial" });
    expect(output).toContain("Unclear against approved contract");
    expect(output).toContain("Required criterion evidence was incomplete or unavailable.");
    expect(output).toContain("Observed evidence: Partially supported");
    expect(output).not.toContain("OUTCOME: MET");
  });

  it("renders enhanced planning as neutral policy copy only", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    report.planner = {
      version: 1,
      contractVersion: "hybrid_requirement_planner.v1",
      schemaVersion: "agentproof_requirement_span_plan_v1",
      promptVersion: "2026-08-12.v1",
      model: "gpt-5-mini",
      inputHash: "a".repeat(64)
    };
    const output = `${reportToMarkdown(report)}\n${reportToGitHubComment(report)}`;

    expect(output).toContain("Enhanced planning policy");
    expect(output).not.toContain("hybrid_requirement_planner");
    expect(output).not.toContain("gpt-5-mini");
    expect(output).not.toContain("a".repeat(64));
  });
  it("creates a concise PR comment with a marker and no re-prompt by default", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    const comment = reportToGitHubComment(report);

    expect(comment).toContain(AGENTPROOF_COMMENT_MARKER);
    expect(comment).toContain("## AgentProof Evidence Check");
    expect(comment).toContain("**Priority:** HIGH");
    expect(comment).toContain("### Requirement Coverage");
    expect(comment).toContain("### Verification Priority");
    expect(comment).not.toContain("<summary>Agent re-prompt</summary>");
    expect(comment.length).toBeLessThan(5000);
  });

  it("renders resolved provenance for report findings", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    const markdown = reportToMarkdown(report);
    const comment = reportToGitHubComment(report);

    expect(markdown).toContain("source=diff");
    expect(markdown).toContain("locator=src/features/auth/PasswordResetForm.tsx");
    expect(markdown).toContain("confidence=85%");
    expect(markdown).toContain("text=modified src/features/auth/PasswordResetForm.tsx");
    expect(markdown).toContain("- Test/build:");
    expect(markdown).toContain("src/server/auth/sessionExpiry.ts is risk-sensitive");
    expect(markdown).toContain("Provenance: ev_");
    expect(markdown).toContain("source=changed_file");
    expect(markdown).toContain("locator=src/server/auth/sessionExpiry.ts");
    expect(markdown).toContain("Evidence: ev_");
    expect(comment).toContain("### Scope");
    expect(comment).toContain("**Test/Build:**");
    expect(comment).toContain("Provenance: changed_file `src/server/auth/sessionExpiry.ts`");
    expect(comment).toContain("Evidence: ev_");
    expect(comment).toContain("diff src/features/auth/PasswordResetForm.tsx 85%");
  });

  it("can include the re-prompt when explicitly requested and neutralizes mentions", () => {
    const report = generateVerificationReport({
      ...demoScenarios["scope-creep"],
      taskText: "Acceptance criteria: notify @team about invalid email tests."
    });
    const comment = reportToGitHubComment(report, { includeReprompt: true });

    expect(comment).toContain("<summary>Agent re-prompt</summary>");
    expect(comment).not.toContain("@team");
    expect(comment).toContain("@\u200Bteam");
  });

  it("includes capped evidence limitations in PR comments", () => {
    const report = generateVerificationReport({
      ...demoScenarios.clean,
      limitations: [
        "Live GitHub evidence could not be collected: GitHub API rate limit was reached. Report uses pasted evidence only.",
        "GitHub changed-file evidence was capped at 300 files.",
        "No CI or test logs were available.",
        "Fourth limitation.",
        "Fifth limitation should be omitted."
      ]
    });
    const comment = reportToGitHubComment(report);

    expect(comment).toContain("### Evidence Limits");
    expect(comment).toContain("Live GitHub evidence could not be collected");
    expect(comment).toContain("Fourth limitation.");
    expect(comment).not.toContain("Fifth limitation should be omitted.");
  });

  it("surfaces redacted execution evidence while excluding non-execution gates", () => {
    const report = generateVerificationReport({
      ...demoScenarios.clean,
      checks: [
        {
          name: "unit tests",
          status: "passed",
          summary: "Vitest passed with token=ghp_123456789012345678901234"
        },
        {
          name: "next build",
          status: "failed",
          summary: "Build failed after Authorization: Bearer abcdefghijklmnop"
        },
        {
          name: "Vercel Preview tests",
          status: "passed",
          summary: "Deployment preview is ready after smoke tests"
        },
        {
          name: "security coverage scan",
          status: "failed",
          summary: "SAST found a coverage policy issue"
        }
      ],
      logs: [
        {
          source: "playwright e2e",
          status: "pending",
          text: "Waiting for browser run with sk-testsecret1234"
        }
      ]
    });
    const markdown = reportToMarkdown(report);
    const comment = reportToGitHubComment(report);
    const markdownExecution = sectionBetween(markdown, "## Execution Evidence", "## Verification Priority");
    const commentExecution = sectionBetween(comment, "### Execution Evidence", "### Evidence Limits");

    expect(markdownExecution).toContain("**FAILED**");
    expect(markdownExecution).toContain("**PENDING**");
    expect(markdownExecution).toContain("**PASSED**");
    expect(markdownExecution).toContain("next build");
    expect(markdownExecution).toContain("playwright e2e");
    expect(markdownExecution).toContain("unit tests");
    expect(markdownExecution).not.toContain("Vercel Preview tests");
    expect(markdownExecution).not.toContain("security coverage scan");
    expect(markdownExecution).not.toContain("ghp_123456789012345678901234");
    expect(markdownExecution).not.toContain("Authorization: Bearer abcdefghijklmnop");
    expect(markdownExecution).not.toContain("sk-testsecret1234");

    expect(commentExecution).toContain("**FAILED**");
    expect(commentExecution).toContain("**PENDING**");
    expect(commentExecution).toContain("**PASSED**");
    expect(commentExecution).not.toContain("Vercel Preview tests");
    expect(commentExecution).not.toContain("security coverage scan");
  });

  it("renders failed check locations without raw annotation messages", () => {
    const report = generateVerificationReport({
      ...demoScenarios.clean,
      checks: [
        {
          name: "unit tests",
          status: "failed",
          summary:
            "Vitest failed. Check annotations: failure at src/private/auth.test.ts:42, warning at src/lib/verifier.test.ts:77, failure at src/app/api/analyze/route.test.ts:31. Raw annotation messages and raw annotation details omitted."
        }
      ],
      logs: []
    });
    const markdown = reportToMarkdown(report);
    const comment = reportToGitHubComment(report);
    const markdownExecution = sectionBetween(markdown, "## Execution Evidence", "## Verification Priority");
    const commentExecution = sectionBetween(comment, "### Execution Evidence", "### Evidence Limits");

    expect(markdownExecution).toContain("**FAILED**");
    expect(markdownExecution).toContain("Failure locations:");
    expect(markdownExecution).toContain("failure at src/private/auth.test.ts:42");
    expect(markdownExecution).toContain("warning at src/lib/verifier.test.ts:77");
    expect(markdownExecution).not.toContain("Raw annotation messages");
    expect(markdownExecution).not.toContain("raw_details");

    expect(commentExecution).toContain("**FAILED**");
    expect(commentExecution).toContain("Failure locations:");
    expect(commentExecution).toContain("`src/private/auth.test.ts:42`");
    expect(commentExecution).toContain("+1 more");
    expect(commentExecution).not.toContain("Raw annotation messages");
    expect(commentExecution).not.toContain("raw_details");
  });

  it("redacts and neutralizes malicious markdown before export or PR comment output", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    const malicious = [
      "Fix ```",
      "</details><script>alert(1)</script>",
      "@team [click](javascript:alert(1))",
      "token=github_pat_abcdefghijklmnopqrstuvwxyz123456",
      "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
    ].join("\n");

    report.source.title = malicious;
    report.summary.oneLine = malicious;
    report.summary.topRisks = [malicious];
    report.requirements[0].requirementText = malicious;
    report.requirements[0].gaps = [malicious];
    report.evidenceIndex[0].summary = malicious;
    report.reprompt.prompt = [
      "Please fix the issue.",
      "```",
      "</details>",
      "@everyone",
      'password: "super-secret-password"'
    ].join("\n");
    report.limitations = [malicious, "namespace.secret=prod-secret-value"];

    const markdown = reportToMarkdown(report);
    const comment = reportToGitHubComment(report, { includeReprompt: true });

    for (const output of [markdown, comment]) {
      expect(output).toContain("[redacted]");
      expect(output).toContain("@\u200Bteam");
      expect(output).toContain("@\u200Beveryone");
      expect(output).toContain("]\u200B(javascript");
      expect(output).not.toContain("@team");
      expect(output).not.toContain("@everyone");
      expect(output).not.toContain("](javascript");
      expect(output).not.toContain("github_pat_");
      expect(output).not.toContain("wJalrXUtnFEMI");
      expect(output).not.toContain("super-secret-password");
      expect(output).not.toContain("prod-secret-value");
      expect(output).not.toContain("<script>");
      expect(output).toContain("&lt;/details&gt;");
      expect(output.match(/```/g) ?? []).toHaveLength(2);
    }

    expect(markdown).not.toContain("</details>");
    expect(comment.match(/<\/details>/g) ?? []).toHaveLength(1);
  });
});

function sectionBetween(value: string, start: string, end: string): string {
  const startIndex = value.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);

  const endIndex = value.indexOf(end, startIndex + start.length);

  return endIndex === -1 ? value.slice(startIndex) : value.slice(startIndex, endIndex);
}
