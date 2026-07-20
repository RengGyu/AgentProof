import { describe, expect, it } from "vitest";
import { inspectSmokeResponse, validateApprovedSmokeOrigin, validateSmokeCases, validateSmokeHttpBoundary, validateSmokeTelemetrySet } from "./concierge-private-beta-nonprod-smoke-contract.mjs";
import { generateVerificationReport } from "../src/lib/verifier.ts";
import { validateVerificationReport } from "../src/lib/report-validation.ts";

const cases = [
  { scenario: "single_linked_issue_passing", caseId: "case_1111111111111111", tenantId: "tenant-a", installationId: 1, repositoryId: 10, repositoryFullName: "opaque/repo-a", pullRequestNumber: 11, expectedHeadSha: "a".repeat(40), expectedOriginalTaskStatus: "available", expectedCiStatus: "passed" },
  { scenario: "task_unavailable_or_ambiguous", caseId: "case_2222222222222222", tenantId: "tenant-a", installationId: 1, repositoryId: 10, repositoryFullName: "opaque/repo-a", pullRequestNumber: 12, expectedHeadSha: "b".repeat(40), expectedOriginalTaskStatus: "ambiguous", expectedCiStatus: "passed" },
  { scenario: "failed_or_unavailable_check", caseId: "case_3333333333333333", tenantId: "tenant-a", installationId: 1, repositoryId: 10, repositoryFullName: "opaque/repo-a", pullRequestNumber: 13, expectedHeadSha: "c".repeat(40), expectedOriginalTaskStatus: "available", expectedCiStatus: "failed" }
];
const report = {
  source: { url: "https://github.com/opaque/repo-a/pull/11", provenance: { headSha: "b".repeat(40) }, originalTask: { status: "available" } }, testing: { ciStatus: "passed" }, requirements: [{ status: "unclear" }],
  evidenceIndex: [{ id: "opaque-ref" }],
  proofGraph: { version: 1, nodes: [{ gapSignals: [{ kind: "missing_execution", evidenceRefs: ["opaque-ref"] }] }], context: [], summary: { requirementCount: 1, requirementsWithImplementation: 1, requirementsWithTargetedTests: 0, requirementsWithExecution: 0, requirementsWithGaps: 1, gapCount: 1 } },
  decisionCard: { version: 1, topGap: { gapKey: "opaque-gap", kind: "missing_execution", evidenceRefs: ["opaque-ref"] }, testBuildStatus: "passed", firstInspectionPoints: [{ href: "https://github.com/opaque/repo-a/blob/abc/file.ts", evidenceRefs: ["opaque-ref"] }], reprompt: { gapKey: "opaque-gap", basedOnGapKind: "missing_execution", evidenceRefs: ["opaque-ref"], prompt: "Run the cited target." } }
};
const envelope = {
  report, caseIdOrHash: "a".repeat(64),
  privacy: "transient-full-report-no-durable-save",
  sideEffects: { llm: false, save: false, share: false, comment: false, slack: false, webhook: false },
  capabilities: { manualAnalysisEnabled: true, globalKillSwitch: false, llmEnabled: false, webhookAutomationEnabled: false, saveReportsEnabled: false, publicShareEnabled: false, githubCommentEnabled: false, slackEnabled: false, billingEnabled: false, fullHistoryEnabled: false },
  sideEffectTelemetry: { version: "concierge-side-effect-telemetry.v1", caseIdOrHash: "a".repeat(64), sourceHeadSha: "b".repeat(40), observation: "runtime_instrumented", counts: { llm: 0, comment: 0, slack: 0, share: 0, save: 0, webhook: 0 } }
};

describe("non-production Concierge smoke contract", () => {
  it("requires the three distinct private-like scenarios and target PRs", () => {
    expect(validateSmokeCases(cases)).toBe(true);
    expect(validateSmokeCases([...cases.slice(0, 2), { ...cases[2], scenario: "single_linked_issue_passing" }])).toBe(false);
    expect(validateSmokeCases([...cases.slice(0, 2), { ...cases[2], pullRequestNumber: 11 }])).toBe(false);
    expect(validateSmokeCases([...cases.slice(0, 2), { ...cases[2], caseId: cases[0].caseId }])).toBe(false);
    expect(validateSmokeCases([...cases.slice(0, 2), { ...cases[2], tenantId: "other-tenant", repositoryId: cases[0].repositoryId, pullRequestNumber: 11 }])).toBe(false);
    expect(validateSmokeCases([...cases.slice(0, 2), { ...cases[2], repositoryId: 999, repositoryFullName: "OPAQUE/REPO-A", pullRequestNumber: 11 }])).toBe(false);
    expect(validateSmokeCases(cases.map(({ expectedHeadSha: _head, ...item }) => item))).toBe(false);
    expect(validateSmokeCases(cases.map((item) => ({ ...item, expectedHeadSha: "not-a-git-sha" })))).toBe(false);
    expect(validateSmokeCases(cases.map((item) => ({ ...item, expectedHeadSha: "a".repeat(39) })))).toBe(false);
    expect(validateSmokeCases(cases.map((item) => ({ ...item, expectedHeadSha: "a".repeat(41) })))).toBe(false);
    expect(validateSmokeCases(cases.map((item) => ({ ...item, expectedHeadSha: "A".repeat(40) })))).toBe(false);
    expect(validateSmokeCases(cases.map((item) => ({ ...item, expectedHeadSha: 40 })))).toBe(false);
    expect(validateSmokeCases(cases.map((item) => ({ ...item, rawEvidence: "diff --git a/a b/a" })))).toBe(false);
    expect(validateSmokeCases([cases[2], cases[0], cases[1]])).toBe(true);
    expect(validateSmokeCases(cases.map((item, index) => ({ ...item, caseId: `case_${String(index + 21).repeat(16)}`, tenantId: `tenant-z${index}`, repositoryId: 200 + index, repositoryFullName: `owner-z${index}/repo-z${index}`, pullRequestNumber: 80 + index })))).toBe(true);
  });
  it("requires an explicitly approved HTTPS origin", () => {
    expect(validateApprovedSmokeOrigin("https://beta.example.test/", "https://beta.example.test")).toBe("https://beta.example.test");
    expect(validateApprovedSmokeOrigin("http://beta.example.test", "http://beta.example.test")).toBeNull();
    expect(validateApprovedSmokeOrigin("https://other.example.test", "https://beta.example.test")).toBeNull();
  });
  it("requires an evidence-bound Decision Card and limits unavailable task cases", () => {
    const firstEnvelope = {
      ...envelope,
      report: { ...report, source: { ...report.source, provenance: { headSha: cases[0].expectedHeadSha } } },
      sideEffectTelemetry: { ...envelope.sideEffectTelemetry, sourceHeadSha: cases[0].expectedHeadSha }
    };
    expect(inspectSmokeResponse(cases[0], 200, firstEnvelope, true)).toMatchObject({ status: "passed", decisionCardValid: true });
    expect(inspectSmokeResponse({ ...cases[0], expectedHeadSha: "c".repeat(40) }, 200, envelope, true).status).toBe("failed");
    expect(inspectSmokeResponse({ ...cases[0], expectedHeadSha: `${"b".repeat(39)}0` }, 200, envelope, true).status).toBe("failed");
    expect(inspectSmokeResponse({ ...cases[1], expectedOriginalTaskStatus: "available" }, 200, { ...envelope, report: { ...report, requirements: [{ status: "met" }], decisionCard: { ...report.decisionCard, reprompt: { ...report.decisionCard.reprompt, evidenceRefs: ["unknown"] } } } }, true)).toMatchObject({ status: "failed", decisionCardValid: false });
    expect(inspectSmokeResponse(cases[0], 200, { ...envelope, report: { ...report, source: { ...report.source, url: "https://github.com/other/repo/pull/11" } } }, true).status).toBe("failed");
  });
  it("accepts an honest zero-gap card and rejects inconsistent null states", () => {
    const zeroGapReport = {
      ...report,
      source: { ...report.source, provenance: { headSha: cases[0].expectedHeadSha } },
      proofGraph: { ...report.proofGraph, nodes: report.proofGraph.nodes.map((node) => ({ ...node, gapSignals: [] })), summary: { ...report.proofGraph.summary, requirementsWithGaps: 0, gapCount: 0 } },
      decisionCard: { ...report.decisionCard, topGap: null, reprompt: null }
    };
    const zeroGapEnvelope = {
      ...envelope,
      report: zeroGapReport,
      sideEffectTelemetry: { ...envelope.sideEffectTelemetry, sourceHeadSha: cases[0].expectedHeadSha }
    };
    expect(inspectSmokeResponse(cases[0], 200, zeroGapEnvelope, true)).toMatchObject({ status: "passed", decisionCardValid: true });
    expect(inspectSmokeResponse(cases[0], 200, { ...zeroGapEnvelope, report: { ...zeroGapReport, proofGraph: { summary: { gapCount: 1 } } } }, true)).toMatchObject({ status: "failed", decisionCardValid: false });
    expect(inspectSmokeResponse(cases[0], 200, { ...zeroGapEnvelope, report: { ...zeroGapReport, decisionCard: { ...zeroGapReport.decisionCard, reprompt: report.decisionCard.reprompt } } }, true)).toMatchObject({ status: "failed", decisionCardValid: false });
    expect(inspectSmokeResponse(cases[0], 200, { ...zeroGapEnvelope, report: { ...zeroGapReport, decisionCard: { ...zeroGapReport.decisionCard, topGap: report.decisionCard.topGap } } }, true)).toMatchObject({ status: "failed", decisionCardValid: false });
  });
  it("accepts a naturally generated zero-gap report through full validation and the smoke envelope", () => {
    const item = { ...cases[0], expectedHeadSha: "e".repeat(40) };
    const generated = generateVerificationReport({
      title: "Validate export evidence report", description: "Implemented export evidence report validation.",
      taskText: "Acceptance criteria: validate export evidence report.", url: "https://github.com/opaque/repo-a/pull/11",
      originalTask: { version: 1, status: "available", sourceType: "explicit_task", reason: "none" },
      changedFiles: [{ path: "src/reports/exportEvidenceReport.ts", additions: 8, deletions: 1, status: "modified", patch: "+ validateExportEvidenceReport(exportEvidenceReport)" }],
      checks: [{ name: "CI test/build evidence verification", status: "passed", summary: "validate export evidence report tests passed" }], logs: [],
      sourceProvenance: { version: 1, origin: "github_snapshot", headSha: item.expectedHeadSha, evidenceCapturedAt: "2026-07-20T00:00:00.000Z", inputFingerprint: { version: 1, algorithm: "sha256", value: "0".repeat(64), coverage: "github_metadata" } }
    });
    const validation = validateVerificationReport(generated, { mode: "full", requireSourceProvenance: true });
    expect(generated.proofGraph.summary.gapCount).toBe(0);
    expect(validation).toEqual({ valid: true, errors: [] });
    const generatedEnvelope = {
      ...envelope, report: generated,
      sideEffectTelemetry: { ...envelope.sideEffectTelemetry, sourceHeadSha: item.expectedHeadSha }
    };
    expect(inspectSmokeResponse(item, 200, generatedEnvelope, validation.valid)).toMatchObject({ status: "passed", decisionCardValid: true });
  });
  it("rejects unknown response fields, telemetry drift, duplicate case hashes, and nonzero calls", () => {
    expect(inspectSmokeResponse(cases[0], 200, { ...envelope, accuracyVerified: true }, true).status).toBe("failed");
    expect(inspectSmokeResponse(cases[0], 200, { ...envelope, capabilities: { ...envelope.capabilities, safe: true } }, true).status).toBe("failed");
    const { sideEffectTelemetry: _telemetry, ...missingTelemetry } = envelope;
    expect(inspectSmokeResponse(cases[0], 200, missingTelemetry, true)).toMatchObject({ status: "failed", telemetryValid: false });
    expect(inspectSmokeResponse(cases[0], 200, { ...envelope, sideEffectTelemetry: { ...envelope.sideEffectTelemetry, counts: { ...envelope.sideEffectTelemetry.counts, llm: 1 } } }, true)).toMatchObject({ status: "failed", telemetryValid: false });
    expect(inspectSmokeResponse(cases[0], 200, { ...envelope, sideEffectTelemetry: { ...envelope.sideEffectTelemetry, sourceHeadSha: "c".repeat(40) } }, true)).toMatchObject({ status: "failed", telemetryValid: false });
    expect(validateSmokeTelemetrySet([{ caseIdOrHash: "a".repeat(64) }, { caseIdOrHash: "a".repeat(64) }, { caseIdOrHash: "b".repeat(64) }])).toBe(false);
    expect(validateSmokeTelemetrySet([{ caseIdOrHash: "a".repeat(64) }, { caseIdOrHash: "b".repeat(64) }, { caseIdOrHash: "c".repeat(64) }])).toBe(true);
    expect(validateSmokeTelemetrySet([{ caseIdOrHash: "a".repeat(64), rawEvidence: "diff --git" }, { caseIdOrHash: "b".repeat(64) }, { caseIdOrHash: "c".repeat(64) }])).toBe(false);
  });
  it("requires a non-redirected JSON no-store response at the exact approved endpoint", () => {
    const endpoint = "https://beta.example.test/api/tenants/concierge/analyze";
    const response = { redirected: false, url: endpoint, headers: new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", "referrer-policy": "no-referrer", "content-length": "100" }) };
    expect(validateSmokeHttpBoundary(response, endpoint)).toBe(true);
    expect(validateSmokeHttpBoundary({ ...response, redirected: true }, endpoint)).toBe(false);
    expect(validateSmokeHttpBoundary({ ...response, headers: new Headers({ "content-type": "application/json", "cache-control": "public", "referrer-policy": "no-referrer" }) }, endpoint)).toBe(false);
  });
});
