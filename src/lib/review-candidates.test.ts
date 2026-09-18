import { validateVerificationReport } from "./report-validation";
import { describe, expect, it } from "vitest";
import { generateVerificationReportV2FromInput, generateVerificationReportV2 } from "./verifier";
import { buildPrEvidenceReview, buildDashboardPrEvidenceReview } from "./pr-evidence-review";
import { prepareTenantDetailReportForStorage } from "./server-report-store";
import { decodeTenantPersistedReport, projectTenantPersistedReport, validateTenantPersistedReport } from "./tenant-report-validation";
import { sanitizeReportForShare } from "./report-share";
import type { PullRequestInput, VerificationReportV2 } from "./types";

const HEAD = "a".repeat(40), BASE = "b".repeat(40), SECRET = "candidate-test-only-signing-key-32-characters";
function input(): PullRequestInput {
  return { title: "Session routing", taskSource: "issue", taskText: "Requirements:\n- The retryGateway handler must preserve the retryWindow option.", description: "", changedFiles: [
    { path: "src/gateway.ts", status: "modified", patch: "+ function retryGateway(retryWindow) { return retryWindow; }" },
    { path: "src/misc.ts", status: "modified", patch: "+ function unrelatedFeature() { return 42; }" },
    { path: "tests/gateway.test.ts", status: "modified", patch: "+ expect(retryGateway(4)).toBe(4)" }
  ], checks: [], logs: [], sourceProvenance: { version: 1, origin: "github_snapshot", headSha: HEAD, baseSha: BASE, evidenceCapturedAt: "2026-09-15T00:00:00Z", inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" } } };
}

describe("review-only candidates", () => {
  it("keeps strict results unchanged and creates separately ranked candidates", () => {
    const i = input(), report = generateVerificationReportV2FromInput(i);
    const strict = generateVerificationReportV2({ input: i, contractSource: { kind: "provided_requirement", contract: undefined }, binding: { sourceKind: "provided_requirement", sourceIdentity: "absent", sourceContent: "", headSha: HEAD, baseSha: BASE } });
    const { analysisId: _id, createdAt: _time, reviewCandidates, ...actual } = report;
    const { analysisId: _sid, createdAt: _stime, ...expected } = strict;
    expect(actual).toEqual(expected);
    expect(reviewCandidates).toBeDefined();
    const view = buildPrEvidenceReview(report);
    expect(view.objectives[0]?.code.map(x => [x.label, x.relation])).toEqual([["src/gateway.ts", "observed"]]);
    expect(view.objectives[0]?.tests.map(x => x.label)).toEqual(["tests/gateway.test.ts"]);
    expect(view.objectives[0]?.nextInspection).toBe("Inspect src/gateway.ts.");
  });

  it("retains late identifiers and middle-of-patch features independently of display compaction", () => {
    const i = input();
    i.taskText = "Requirements:\n- The service must retain compatibility across ordinary request processing without modifying existing workflows while retryGateway preserves retryWindow.";
    i.changedFiles[0]!.patch = "// padding\n".repeat(60) + "+ retryGateway(retryWindow);\n" + "// padding\n".repeat(60);
    const report = generateVerificationReportV2FromInput(i);
    expect(report.evidenceIndex.find(x => x.locator === "src/gateway.ts")?.summary).not.toContain("retryGateway");
    expect(buildPrEvidenceReview(report).objectives[0]?.code.map(x => x.label)).toEqual(["src/gateway.ts"]);
  });

  it("abstains on common tokens and never attaches the global priority file", () => {
    const i = input(); i.taskText = "Requirements:\n- The service must handle the request and return a result.";
    i.changedFiles = [{ path: "src/service.ts", status: "modified", patch: "+ function handle(request) { return result; }" }];
    const report = generateVerificationReportV2FromInput(i);
    report.reviewPriority = [{ path: "src/service.ts", priority: "high", reason: "Global priority", evidenceRefs: [] }];
    const view = buildPrEvidenceReview(report);
    expect(report.reviewCandidates!.intentGraph!.edges).toEqual([]);
    expect(view.objectives[0]?.code.every(item=>item.relation==="observed")).toBe(true);
  });

  it("handles structural variants without changing strict objective identity", () => {
    for (const body of ["# Expected outcome\n\nretryGateway should preserve retryWindow.", "**Expected outcome**\n\nretryGateway should preserve retryWindow.", "Requirements:\n- retryGateway must preserve retryWindow (e.g. in repeated calls)."] ) {
      const i = input(); i.taskText = body;
      const r = generateVerificationReportV2FromInput(i);
      expect(r.requirements.length).toBeGreaterThan(0);
      expect(buildPrEvidenceReview(r).objectives.some(x=>x.code.some(y=>y.label === "src/gateway.ts"))).toBe(true);
    }
  });

  it("is invariant to file order and duplicate identifier mentions", () => {
    const i = input();
    const first = buildPrEvidenceReview(generateVerificationReportV2FromInput(i)).objectives[0]!;
    i.changedFiles.reverse();
    i.taskText += " retryGateway retryGateway retryWindow retryWindow";
    const second = buildPrEvidenceReview(generateVerificationReportV2FromInput(i)).objectives[0]!;
    expect(second.code.map(x=>x.label)).toEqual(first.code.map(x=>x.label));
    expect(second.nextInspection).toBe(first.nextInspection);
    expect(new Set(second.code.map(x=>x.evidenceId)).size).toBe(second.code.length);
  });

  it("keeps base/head/rename navigation exact and never guesses missing revisions", () => {
    const i = input();
    i.changedFiles[0]!.status = "removed";
    i.changedFiles[0]!.patch = "- retryGateway(retryWindow);";
    i.changedFiles[2]!.status = "renamed"; i.changedFiles[2]!.previousPath = "tests/old.test.ts";
    const review = buildPrEvidenceReview(generateVerificationReportV2FromInput(i), { repositoryFullName: "acme/widget" });
    expect(review.objectives[0]?.code[0]?.url).toContain(`/blob/${BASE}/src/gateway.ts`);
    expect(review.objectives[0]?.tests[0]?.url).toContain(`/blob/${HEAD}/tests/gateway.test.ts`);
    delete i.sourceProvenance;
    const unbound = buildPrEvidenceReview(generateVerificationReportV2FromInput(i), { repositoryFullName: "acme/widget" });
    expect(unbound.objectives[0]?.code[0]?.url).toBeUndefined();
  });

  it("rejects unknown fields, unknown IDs and duplicate candidates at the boundary", () => {
    const report = generateVerificationReportV2FromInput(input());
    expect(validateVerificationReport(report, { mode: "v2_full" }).valid).toBe(true);
    for (const mutate of [
      (r: VerificationReportV2) => Object.assign(r.reviewCandidates!, { rawCode: "secret" }),
      (r: VerificationReportV2) => { r.reviewCandidates!.requirements[0]!.candidates[0]!.evidenceId = "unknown"; },
      (r: VerificationReportV2) => { const cs = r.reviewCandidates!.requirements[0]!.candidates; cs.push(cs[0]!); },
    ]) {
      const bad = structuredClone(report); mutate(bad);
      expect(validateVerificationReport(bad, { mode: "v2_full" }).valid).toBe(false);
    }
    const legacy = structuredClone(report); delete legacy.reviewCandidates;
    expect(validateVerificationReport(legacy, { mode: "v2_full" }).valid).toBe(true);
  });

  it("preserves candidate order and provenance through tenant save/hydrate without raw text", () => {
    const report = generateVerificationReportV2FromInput(input());
    const safe = prepareTenantDetailReportForStorage(report, "verified_agentproof", SECRET);
    const persisted = projectTenantPersistedReport(safe, SECRET);
    const decoded = decodeTenantPersistedReport(persisted, { signingSecret: SECRET, createdAt: report.createdAt });
    expect(decoded.status).toBe("valid");
    if (decoded.status !== "valid") throw Error("hydrate failed");
    expect((decoded.report as VerificationReportV2).reviewCandidates).toEqual(report.reviewCandidates);
    expect(buildDashboardPrEvidenceReview({ report: decoded.report })?.objectives[0]?.code.map(x => [x.label, x.relation])).toEqual([["src/gateway.ts", "observed"]]);
    expect(JSON.stringify(report.reviewCandidates)).not.toMatch(/function|retryGateway|retryWindow/);
    expect(JSON.stringify(sanitizeReportForShare(report))).not.toContain("reviewCandidates");
    const tampered = structuredClone(persisted);
    tampered.reviewCandidates!.requirements[0]!.candidates[0]!.score++;
    expect(validateTenantPersistedReport(tampered, SECRET).valid).toBe(false);
  });
});
