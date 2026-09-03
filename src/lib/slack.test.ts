import { describe, expect, it } from "vitest";
import { demoScenarios } from "./sample-data";
import { expectNoSelectionSentinels, transientSelectionFixture } from "./general-pr-selection-sentinels.test-fixture";
import {
  analysisQueueAlertsToSlackPayload,
  isAllowedSlackWebhookUrl,
  neutralizeSlackMentions,
  reportToSlackPayload
} from "./slack";
import { generateVerificationReport, generateVerificationReportV2, generateVerificationReportV2FromInput } from "./verifier";
import type { AnalysisJobQueueSummary } from "./analysis-jobs";
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

describe("slack helpers", () => {
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
    const payload = JSON.stringify(reportToSlackPayload(report));

    expect(payload).toContain("Enhanced planning policy");
    expect(payload).not.toContain("hybrid_requirement_planner");
    expect(payload).not.toContain("gpt-5-mini");
    expect(payload).not.toContain("a".repeat(64));
  });
  it("formats summary-only payloads", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.summary.oneLine = "@channel verify github_pat_secret_should_not_leak_1234567890";
    report.summary.topRisks = ["Risk has sk-secret_should_not_leak"];
    report.testing.missingTests.push({
      path: "src/github_pat_secret_should_not_leak_1234567890/test.ts",
      why: "Needs api_key=secret_should_not_leak",
      evidenceRefs: []
    });
    report.reviewPriority.push({
      path: "src/review.ts",
      reason: "Review has https://hooks.slack.com/services/T000/B000/secret",
      priority: "high"
    });
    report.claims.push({
      id: "claim_raw",
      text: "Added raw claim that should not leave the report boundary.",
      evidenceRefs: [],
      supported: false
    });
    const payloadText = JSON.stringify(reportToSlackPayload(report, "https://agentproof.example/reports/1"));

    expect(payloadText).not.toContain("Patch excerpt");
    expect(payloadText).not.toContain(report.reprompt.prompt);
    expect(payloadText).not.toContain("Added raw claim");
    expect(payloadText).not.toContain("github_pat_secret");
    expect(payloadText).not.toContain("sk-secret");
    expect(payloadText).not.toContain("hooks.slack.com/services");
    expect(payloadText).not.toContain("secret_should_not_leak");
    expect(payloadText).toContain("[redacted]");
    expect(payloadText).toContain("@​channel");
    expect(payloadText).toContain("Test/build:");
    expect(payloadText).toContain("summary report");
  });

  it("keeps a strict v2 outcome separate from supported observations", () => {
    const input: PullRequestInput = {
      title: "Return an isolated label",
      description: "",
      taskText: "Return an isolated label.",
      taskSource: "issue",
      changedFiles: [{ path: "src/label.ts", status: "added", patch: "+ export const label = () => 'ok';" }],
      checks: [{ name: "label tests", status: "passed", summary: "label tests passed" }],
      logs: [],
    };
    const contract = {
        version: 2,
        scope: "complete_objective_set",
        objectives: [{
          id: "label",
          objective: "Return an isolated label.",
          criteria: [{
            id: "label_value",
            type: "return_value",
            label: "Return the expected label.",
            adapter: { id: "node_export_scalar.v1", modulePath: "src/label.ts", exportName: "label", moduleFormat: "esm" },
            cases: [{ id: "expected", input: true, expected: "ok" }]
          }]
        }]
      };
    const report = generateVerificationReportV2({
      input,
      contractSource: { kind: "provided_requirement", contract },
      binding: {
        sourceKind: "provided_requirement",
        sourceIdentity: "manual:slack-v2",
        sourceContent: JSON.stringify(contract),
        headSha: "a".repeat(40),
        baseSha: "b".repeat(40)
      }
    });

    const payload = JSON.stringify(reportToSlackPayload(report));

    expect(report.requirements[0]).toMatchObject({ status: "unclear", evidenceStatus: "partial" });
    expect(payload).toContain("Unclear against approved contract");
    expect(payload).toContain("Observed evidence: Partially supported");
    expect(payload).toContain("Evidence details are omitted from this portable summary.");
    expect(payload).not.toContain("Supported against approved contract");
  });

  it("includes only the target-free ordinary-PR assessment in a Slack summary", () => {
    const report = generateVerificationReportV2FromInput(demoScenarios.clean);
    report.generalPrAssessmentSummary = {
      version: 1,
      mode: "ordinary_pr",
      sourceState: "pr_author_claim",
      overallConclusion: "evidence_partial",
      counts: { evidence_supported: 0, evidence_partial: 1, not_demonstrated: 0, contradicted: 0, blocked: 0, not_assessable: 0 },
      reasonCodes: ["author_claim_requires_confirmation", "semantic_observer_unavailable", "target_relation_unresolved"],
      observations: { version: 1, inventory: { state: "complete", changedArtifacts: 2, changedTestCandidates: 1 }, links: { state: "proposed", linkedObjectives: 1, supports: 1, tests: 0, implements: 0, contradicts: 0 }, coverage: { source: "complete", evidence: "sampled" } }
    };
    Object.assign(report.generalPrAssessmentSummary as Record<string, unknown>, {
      diagnostics: { ledgerDigest: "ledgerDigest", semanticOutput: "semantic output", workflowIdentity: "workflowIdentity", token: "github_pat_private", ...transientSelectionFixture() },
      targets: [{ sourceBindingRef: "sourceBindingRef", sourceSpanRefs: ["sourceSpanRefs"] }]
    });
    Object.assign(report.generalPrAssessmentSummary.observations as object, { diagnostics: "private-observation-sentinel" });

    const payload = JSON.stringify(reportToSlackPayload(report));

    expect(payload).toContain("Ordinary PR evidence assessment");
    expect(payload).toContain("Partial observations; objective fulfillment remains unconfirmed");
    expect(payload).toContain("Partial evidence: 1");
    expect(payload).toContain("Semantic assessment was unavailable.");
    expect(payload).toContain("The target-to-evidence relation remains unresolved.");
    expect(payload).toContain("Observed changed artifacts: 2");
    expect(payload).not.toContain("private-observation-sentinel");
    for (const forbidden of PRIVATE_ASSESSMENT_TERMS) expect(payload).not.toContain(forbidden);
    expectNoSelectionSentinels(payload);
  });

  it("escapes Slack markdown link delimiters in report URLs", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    const payloadText = JSON.stringify(reportToSlackPayload(report, "https://agentproof.example/reports/1|bad>"));

    expect(payloadText).toContain("https://agentproof.example/reports/1%7Cbad%3E");
    expect(payloadText).not.toContain("1|bad>");
  });

  it("neutralizes broad Slack mentions", () => {
    expect(neutralizeSlackMentions("@channel <!here> @teammate")).toBe("@​channel @​here @​teammate");
  });

  it("only allows Slack incoming webhook URLs", () => {
    expect(isAllowedSlackWebhookUrl("https://hooks.slack.com/services/T/B/C")).toBe(true);
    expect(isAllowedSlackWebhookUrl("https://example.com/services/T/B/C")).toBe(false);
  });

  it("formats analysis queue alerts as aggregate-only payloads", () => {
    const summary = {
        privacy: "analysis-job-queue-summary-only",
        sampled: 3,
        truncated: false,
        counts: {
          queued: 1,
          processing: 1,
          completed: 0,
          failed_retryable: 0,
          failed_terminal: 1
        },
        due: 1,
        delayedRetry: 0,
        staleProcessing: 1,
        oldestQueuedAgeSeconds: 1000,
        ...transientSelectionFixture()
      } as unknown as AnalysisJobQueueSummary;
    const payloadText = JSON.stringify(analysisQueueAlertsToSlackPayload({
      summary,
      alerts: [
        {
          code: "analysis_queue_failed_terminal",
          severity: "warning",
          metric: "counts.failed_terminal",
          count: 1,
          threshold: 1
        },
        {
          code: "analysis_queue_backlog",
          severity: "warning",
          metric: "oldestQueuedAgeSeconds",
          count: 1000,
          threshold: 900
        }
      ]
    }));

    expect(payloadText).toContain("analysis queue WARNING");
    expect(payloadText).toContain("Failed terminal: 1");
    expect(payloadText).toContain("analysis_queue_backlog");
    expect(payloadText).toContain("Summary-only ops alert");
    expect(payloadText).not.toContain("RengGyu/AgentProof");
    expect(payloadText).not.toContain("tenant_a");
    expect(payloadText).not.toContain("https://github.com");
    expect(payloadText).not.toContain("evidenceIndex");
    expect(payloadText).not.toContain("claims");
    expect(payloadText).not.toContain("reprompt");
    expect(payloadText).not.toContain("Patch excerpt");
    expect(payloadText).not.toContain("github_pat_");
    expectNoSelectionSentinels(payloadText);
  });
});
