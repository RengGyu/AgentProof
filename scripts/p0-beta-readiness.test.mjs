import { describe, expect, it } from "vitest";
import { runP0BetaReadiness } from "./p0-beta-readiness.mjs";

describe("p0-beta-readiness", () => {
  it("reports current P0 readiness as blocked by reviewer/manual-label work", () => {
    const result = runP0BetaReadiness({
      root: "/repo",
      readFile: fixtureReader({
        "/repo/eval/fixtures/reviewer-validation.v1.json": JSON.stringify(reviewerFixture()),
        "/repo/eval/fixtures/external-pr-pilot.v1.json": JSON.stringify(externalPilotFixture({ reviewed: false })),
        "/repo/docs/external-pr-pilot.md": externalPilotDoc(),
        "/repo/docs/reviewer-validation-packet.md": reviewerPacketDoc(),
        "/repo/README.md": readme(),
        "/repo/docs/first-real-pr-report.md": "first real PR guide",
        "/repo/docs/linked-issue-ingestion.md": "linked issue ingestion",
        "/repo/docs/deployment-smoke.md": "deployment smoke"
      }),
      exists: () => true
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      privacy: "p0-beta-readiness-summary-only",
      status: "blocked",
      next: "fill_manual_labels_after_reviewer_sessions"
    }));
    expect(result.gates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "external_pr_5_case_pilot",
        status: "blocked",
        counts: expect.objectContaining({ pendingManualLabels: 5 }),
        next: "fill_manual_labels_after_reviewer_sessions"
      }),
      expect.objectContaining({
        key: "reviewer_validation",
        status: "blocked",
        counts: expect.objectContaining({
          outreachSlots: 3,
          readyToSend: 3,
          sentOrScheduled: 0,
          completedSessions: 0,
          realPrUsage: 0
        }),
        next: "send_prepared_reviewer_outreach"
      })
    ]));
    expect(JSON.stringify(result)).not.toContain("github_pat_");
    expect(JSON.stringify(result)).not.toContain("rawDiff");
    expect(JSON.stringify(result)).not.toContain("reviewer@example.com");
  });

  it("reports ready only when pilot labels and real reviewer evidence exist", () => {
    const result = runP0BetaReadiness({
      root: "/repo",
      readFile: fixtureReader({
        "/repo/eval/fixtures/reviewer-validation.v1.json": JSON.stringify(reviewerFixture({
          completed: true
        })),
        "/repo/eval/fixtures/external-pr-pilot.v1.json": JSON.stringify(externalPilotFixture({ reviewed: true })),
        "/repo/docs/external-pr-pilot.md": externalPilotDoc(),
        "/repo/docs/reviewer-validation-packet.md": reviewerPacketDoc(),
        "/repo/README.md": readme(),
        "/repo/docs/first-real-pr-report.md": "first real PR guide",
        "/repo/docs/linked-issue-ingestion.md": "linked issue ingestion",
        "/repo/docs/deployment-smoke.md": "deployment smoke"
      }),
      exists: () => true
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      privacy: "p0-beta-readiness-summary-only",
      status: "ready_for_design_partner_review",
      next: "ready_for_design_partner_review"
    }));
    expect(result.counts).toEqual({
      gates: 4,
      ready: 4,
      blocked: 0,
      unclear: 0
    });
  });

  it("blocks when required P0 docs are missing", () => {
    const result = runP0BetaReadiness({
      root: "/repo",
      readFile: fixtureReader({
        "/repo/eval/fixtures/reviewer-validation.v1.json": JSON.stringify(reviewerFixture()),
        "/repo/eval/fixtures/external-pr-pilot.v1.json": JSON.stringify(externalPilotFixture({ reviewed: true })),
        "/repo/docs/external-pr-pilot.md": externalPilotDoc(),
        "/repo/docs/reviewer-validation-packet.md": reviewerPacketDoc(),
        "/repo/README.md": readme(),
        "/repo/docs/first-real-pr-report.md": "first real PR guide",
        "/repo/docs/linked-issue-ingestion.md": "linked issue ingestion",
        "/repo/docs/deployment-smoke.md": "deployment smoke"
      }),
      exists: (path) => !path.endsWith("docs/linked-issue-ingestion.md")
    });

    expect(result.gates.find((gate) => gate.key === "p0_docs")).toEqual(expect.objectContaining({
      status: "blocked",
      counts: { required: 6, missing: 1 },
      next: "restore_missing_p0_docs"
    }));
    expect(result.next).toBe("restore_missing_p0_docs");
  });
});

function fixtureReader(files) {
  return (path) => {
    if (!(path in files)) {
      throw new Error(`Missing fixture file ${path}`);
    }

    return files[path];
  };
}

function reviewerFixture({ completed = false } = {}) {
  return {
    schemaVersion: "reviewer-validation.v1",
    privacy: "reviewer-validation-metadata-only",
    status: completed ? "reviewer_validation_ready_for_review" : "outreach_prepared_reviewer_usefulness_unclear",
    outreachSlots: ["reviewer-1", "reviewer-2", "reviewer-3"].map((slot) => ({
      slot,
      status: completed ? "scheduled" : "ready-to-send"
    })),
    feedbackRecords: completed
      ? ["reviewer-1", "reviewer-2", "reviewer-3"].map((slot, index) => ({
        slot,
        sessionStatus: "completed",
        prSource: index === 0 ? "public-oss-pr" : "demo-pr",
        reportUsefulness: "useful",
        falseBlockerObserved: "no"
      }))
      : []
  };
}

function externalPilotFixture({ reviewed }) {
  const categories = ["clean_pr", "missing_tests", "scope_creep", "failed_ci", "vague_task_or_visual_gap"];

  return {
    schemaVersion: "external-pr-pilot.v1",
    privacy: "external-pr-pilot-metadata-only",
    cases: categories.map((category, index) => ({
      id: `external-pr-pilot-${index}`,
      category,
      manualLabels: {
        labelStatus: reviewed ? "reviewed" : "pending_reviewer_confirmation"
      }
    }))
  };
}

function externalPilotDoc() {
  return [
    "Latest production runner evidence, 2026-07-03:",
    "Result: `ok: true`, `caseCount: 5`, `qualityGateSummary.ok: true`",
    "Token boundary: `productionTokenForwarded: false` for every case."
  ].join("\n");
}

function reviewerPacketDoc() {
  return "Reviewer validation packet without deferred scope claims.";
}

function readme() {
  return "AgentProof P0 readme without deferred scope claims.";
}
