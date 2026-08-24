import { readFileSync } from "fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VerificationReportV2 } from "@/lib/types";
import { POST } from "./route";

interface ReplayRow {
  id: string;
  source: "provided" | "linked" | "pr_description";
  identity: "complete" | "missing_path" | "rerun" | "head_drift" | "pagination_cap" | "permission" | "mixed";
  status: number;
  origin?: "github_snapshot" | "pasted_evidence";
  inventory?: "complete" | "incomplete";
}

interface ReplayFixture {
  headSha: string;
  baseSha: string;
  workflowTask: string;
  prBody: string;
  linkedBody: string;
  checkRun: Record<string, unknown>;
  runAttempt: Record<string, unknown>;
  job: Record<string, unknown>;
  rows: ReplayRow[];
}

const fixture = JSON.parse(readFileSync(
  new URL("./__fixtures__/github-snapshot-v2/replay-cases.json", import.meta.url),
  "utf8"
)) as ReplayFixture;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/analyze production-shaped GitHub replay", () => {
  it.each(fixture.rows)("replays $id without false-complete workflow evidence", async (row) => {
    const runAttemptNumber = row.identity === "rerun" ? 2 : 1;
    const runAttempt = {
      ...fixture.runAttempt,
      run_attempt: runAttemptNumber,
      ...(row.identity === "missing_path" ? { path: undefined } : {})
    };
    const job = { ...fixture.job, run_attempt: runAttemptNumber };
    const checkRun = {
      ...fixture.checkRun,
      details_url: `https://github.com/opaque-owner/opaque-repo/actions/runs/4101/attempts/${runAttemptNumber}/job/7101`
    };
    let pullReads = 0;
    const fetchMock = vi.fn((value: string | URL | Request) => {
      const url = String(value);
      if (url.endsWith("/pulls/17")) {
        pullReads += 1;
        return Promise.resolve(Response.json({
          title: "Opaque replay",
          body: row.source === "linked" || row.id === "provided-task-precedence" ? fixture.linkedBody : fixture.prBody,
          url: "https://api.github.com/repos/opaque-owner/opaque-repo/pulls/17",
          base: { ref: "main", sha: fixture.baseSha },
          head: {
            ref: "agent/verify",
            sha: row.identity === "head_drift" && pullReads > 1 ? "c".repeat(40) : fixture.headSha
          }
        }));
      }
      if (url.endsWith("/issues/71")) return Promise.resolve(Response.json({
        title: "Verification workflow",
        body: row.id === "provided-task-precedence"
          ? "Acceptance criteria:\n- Replace an unrelated ignored requirement."
          : fixture.workflowTask
      }));
      if (url.includes("/files?")) return Promise.resolve(Response.json([{
        filename: ".github/workflows/verify.yml",
        status: "modified",
        additions: 3,
        deletions: 0,
        patch: "+ name: Verification\n+ run: npm test"
      }]));
      if (url.includes(`/commits/${fixture.headSha}/check-runs`)) {
        return Promise.resolve(Response.json({ total_count: 1, check_runs: [checkRun] }));
      }
      if (url.endsWith("/status")) return Promise.resolve(Response.json({ statuses: [] }));
      if (url.includes("/check-runs/6101/annotations")) return Promise.resolve(Response.json([]));
      if (url.includes(`/actions/runs/4101/attempts/${runAttemptNumber}/jobs`)) {
        if (row.identity === "pagination_cap") {
          const page = Number(new URL(url).searchParams.get("page") ?? 1);
          return Promise.resolve(Response.json({
            total_count: 301,
            jobs: Array.from({ length: 100 }, (_, index) => page === 1 && index === 0
              ? job
              : {
                ...job,
                id: page * 10000 + index,
                check_run_url: `https://api.github.com/repos/opaque-owner/opaque-repo/check-runs/${page * 10000 + index}`
              })
          }));
        }
        return Promise.resolve(Response.json({ total_count: 1, jobs: [job] }));
      }
      if (url.endsWith(`/actions/runs/4101/attempts/${runAttemptNumber}`)) {
        if (row.identity === "permission") return Promise.resolve(new Response("forbidden", { status: 403 }));
        return Promise.resolve(Response.json(runAttempt));
      }
      if (url.includes("/actions/runs/4101/jobs")) {
        return Promise.resolve(Response.json({ jobs: [job] }));
      }
      return Promise.resolve(new Response("unexpected synthetic endpoint", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const requestBody: Record<string, string> = {
      prUrl: "https://github.com/opaque-owner/opaque-repo/pull/17"
    };
    if (row.source === "provided") requestBody.taskText = fixture.workflowTask;
    if (row.identity === "mixed") requestBody.checks = "pasted unit-test: failed";

    const response = await POST(new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody)
    }));
    const json = await response.json() as { report?: VerificationReportV2; error?: string };

    expect(response.status).toBe(row.status);
    expect(response.status).not.toBe(500);
    if (!json.report) {
      expect(row.identity).toBe("head_drift");
      expect(json.error).toContain("head changed");
      return;
    }

    const report = json.report;
    const requirementIds = report.requirements.map((item) => item.requirementId);
    expect(requirementIds).toEqual(requirementIds.map((_, index) => `req_${index + 1}`));
    expect(report.requirements.map((item) => item.requirementText)).toEqual([
      "Add the verification CI workflow",
      "It must configure the verification CI workflow to run npm test"
    ]);
    expect(report.requirements).toHaveLength(2);
    expect(report.proofGraph.summary.requirementCount).toBe(2);
    expect(report.analysisContext).toBe(row.source === "pr_description" ? "unlinked_pr" : "linked_issue");
    expect(report.proofGraph.nodes.map((node) => node.deterministicRelation?.kind).filter(Boolean))
      .toContain("workflow_antecedent");
    expect(report.proofGraph.privateReceiptBundleV2?.testRelationReceipts ?? []).toHaveLength(0);
    expect(report.proofGraph.privateReceiptBundleV2?.executionBindingReceipts ?? []).toHaveLength(0);
    expect(report.source.provenance?.origin).toBe(row.origin);
    expect(report.source.provenance?.changedFileInventory?.completeness).toBe(row.inventory);
    expect(report.verificationContract.state).toBe("absent");
    expect(report.requirements.every((requirement) => requirement.status === "unclear")).toBe(true);
    expect(report.testing.ciStatus).toBe("failed");

    const associations = report.proofGraph.failedCheckAssociations ?? [];
    const linked = associations.filter((association) => association.state === "linked");
    const workflowNode = report.proofGraph.nodes.find((node) => node.deterministicRelation?.kind === "workflow_antecedent");
    const workflowFinding = report.requirements.find((item) => item.requirementId === workflowNode?.requirementId);
    const executionAxis = workflowFinding?.proofAxes?.find((axis) => axis.subject === "execution");
    const expectsComplete = ["complete", "rerun"].includes(row.identity) && row.origin === "github_snapshot";

    if (expectsComplete) {
      const retainedCheckEvidenceRef = report.evidenceIndex.find((item) => item.kind === "check")?.id;
      expect(linked).toHaveLength(1);
      expect(linked[0]?.basis).toBe("complete_identity_match");
      expect(linked[0]?.checkEvidenceRef).toBe(retainedCheckEvidenceRef);
      expect(executionAxis?.state).toBe("violated");
      expect(workflowFinding?.status).not.toBe("met");
      expect(report.limitations.join(" ")).not.toContain("COLLECTOR_LIMITATION");
    } else {
      expect(linked).toHaveLength(0);
      expect(executionAxis?.state).not.toBe("violated");
      expect(JSON.stringify(associations)).not.toContain("complete_identity_match");
      if (["missing_path", "pagination_cap", "permission"].includes(row.identity)) {
        expect(report.limitations.join(" ")).toContain("COLLECTOR_LIMITATION");
      }
      if (row.identity === "mixed") {
        expect(report.limitations.join(" ")).toContain("Pasted checks replaced live GitHub check evidence");
      }
    }

    expect(associations.length).toBeLessThanOrEqual(50);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("workflowExecutionIdentity");
    expect(serialized).not.toContain("check-run:6101");
    expect(serialized).not.toContain("check_run_url");
  });

  it("keeps the replay fixture opaque, redacted, and free of customer material", () => {
    const serialized = JSON.stringify(fixture);
    expect(serialized).not.toMatch(/github_pat_|ghp_|ghs_|Bearer\s/i);
    expect(serialized).not.toMatch(/api\.github\.com\/repos\/(?!opaque-owner\/opaque-repo)/i);
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("patch\":\"");
  });
});
