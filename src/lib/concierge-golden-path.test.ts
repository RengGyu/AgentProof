import { describe, expect, it } from "vitest";
import { generateVerificationReport } from "./verifier";
import { validateVerificationReport } from "./report-validation";
import type { PullRequestInput, VerificationReport } from "./types";

function input(overrides: Partial<PullRequestInput> = {}): PullRequestInput {
  return {
    url: "https://github.com/acme/private/pull/17",
    title: "Private PR",
    description: "Implemented the requested behavior and everything is verified.",
    taskSource: "task",
    taskText: "The export endpoint must reject unauthenticated requests and include a targeted test.",
    originalTask: { version: 1, status: "available", sourceType: "explicit_task", reason: "none" },
    changedFiles: [
      { path: "src/export.ts", status: "modified", patch: "+ reject unauthenticated export request" },
      { path: "src/export.test.ts", status: "modified", patch: "+ test rejects unauthenticated request" }
    ],
    checks: [{ name: "test", status: "passed", summary: "Status: passed; export targeted test passed", url: "https://github.com/acme/private/actions/runs/9" }],
    logs: [],
    limitations: ["Raw CI logs were not fetched or stored."],
    sourceProvenance: { version: 1, origin: "github_snapshot", headSha: "a".repeat(40), evidenceCapturedAt: "2026-07-14T00:00:00.000Z", inputFingerprint: { version: 1, algorithm: "sha256", value: "b".repeat(64), coverage: "github_metadata" } },
    ...overrides
  };
}

describe("concierge pre-human private-like cases", () => {
  it("validates a single authoritative linked issue with passing checks", () => {
    const report = generateVerificationReport(input({ taskSource: "issue", originalTask: { version: 1, status: "available", sourceType: "linked_issue", reason: "none", sourceRef: "github_issue:42" } }));
    expect(validateVerificationReport(report, { mode: "full", requireSourceProvenance: true })).toEqual({ valid: true, errors: [] });
    expect(report.source.originalTask?.status).toBe("available");
  });

  it.each(["unavailable", "ambiguous"] as const)("never reports met when the original task is %s", (status) => {
    const report = generateVerificationReport(input({
      taskText: "",
      taskSource: undefined,
      originalTask: status === "unavailable"
        ? { version: 1, status, sourceType: "none", reason: "not_linked" }
        : { version: 1, status, sourceType: "none", reason: "multiple_linked_issues" }
    }));
    expect(report.requirements.filter((item) => item.status === "met")).toHaveLength(0);
    expect(report.requirements.some((item) => item.requirementText.includes("everything is verified"))).toBe(false);
    expect(report.decisionCard?.firstInspectionPoints.length).toBeGreaterThan(0);
    expect(validateVerificationReport(report, { mode: "full", requireSourceProvenance: true }).valid).toBe(true);
  });

  it("keeps failed execution as a deterministic blocker", () => {
    const report = generateVerificationReport(input({ checks: [{ name: "test", status: "failed", summary: "Status: failed", url: "https://github.com/acme/private/actions/runs/10" }] }));
    expect(report.testing.ciStatus).toBe("failed");
    expect(report.summary.priority).toBe("blocker");
    expect(report.decisionCard?.topGap?.kind).toBe("failed_execution");
  });

  it("binds the top gap, inspection links, and re-prompt to deterministic evidence", () => {
    const report = generateVerificationReport(input({ checks: [] }));
    const ids = new Set(report.evidenceIndex.map((item) => item.id));
    expect(report.decisionCard?.topGap?.evidenceRefs.every((ref) => ids.has(ref))).toBe(true);
    expect(report.decisionCard?.reprompt?.evidenceRefs).toEqual(report.decisionCard?.topGap?.evidenceRefs);
    for (const point of report.decisionCard?.firstInspectionPoints ?? []) {
      expect(point.href).toMatch(/^https:\/\/github\.com\/acme\/private\//);
      expect(point.evidenceRefs.every((ref) => ids.has(ref))).toBe(true);
    }
  });

  it("rejects a tampered Decision Card even when the cited evidence exists", () => {
    const report = structuredClone(generateVerificationReport(input({ checks: [] }))) as VerificationReport;
    if (!report.decisionCard?.topGap) throw new Error("fixture needs a deterministic gap");
    report.decisionCard.topGap.summary = "Invented safe claim.";
    expect(validateVerificationReport(report, { mode: "full" }).errors).toContain("decisionCard must match the deterministic Decision Card builder output.");
  });

  it("changes no deterministic truth when evidence arrays are permuted", () => {
    const first = generateVerificationReport(input());
    const second = generateVerificationReport(input({ changedFiles: [...input().changedFiles].reverse(), checks: [...input().checks].reverse() }));
    expect(second.testing).toEqual(first.testing);
    expect(second.requirements.map(({ status, gaps }) => ({ status, gaps }))).toEqual(first.requirements.map(({ status, gaps }) => ({ status, gaps })));
  });
});
