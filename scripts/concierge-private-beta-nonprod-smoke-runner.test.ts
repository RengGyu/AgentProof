import { describe, expect, it } from "vitest";
import { generateVerificationReport } from "../src/lib/verifier";
import { validateVerificationReport } from "../src/lib/report-validation";
import { runConciergeNonProductionSmoke } from "./concierge-private-beta-nonprod-smoke.js";

const endpoint = "https://beta.example.test/api/tenants/concierge/analyze";

const cases = [
  { scenario: "single_linked_issue_passing", caseId: "case_1111111111111111", tenantId: "tenant-a", installationId: 1, repositoryId: 10, repositoryFullName: "opaque/repo-a", pullRequestNumber: 11, expectedOriginalTaskStatus: "available", expectedCiStatus: "passed" },
  { scenario: "task_unavailable_or_ambiguous", caseId: "case_2222222222222222", tenantId: "tenant-b", installationId: 2, repositoryId: 20, repositoryFullName: "opaque/repo-b", pullRequestNumber: 12, expectedOriginalTaskStatus: "ambiguous", expectedCiStatus: "passed" },
  { scenario: "failed_or_unavailable_check", caseId: "case_3333333333333333", tenantId: "tenant-c", installationId: 3, repositoryId: 30, repositoryFullName: "opaque/repo-c", pullRequestNumber: 13, expectedOriginalTaskStatus: "available", expectedCiStatus: "failed" }
] as const;

describe("non-production Concierge smoke runner", () => {
  it("runs the exact HTTP boundary, validates the full runtime report, and accepts arbitrary ordered cases", async () => {
    const requests: RequestInit[] = [];
    const result = await runConciergeNonProductionSmoke({
      baseUrl: "https://beta.example.test",
      approvedOrigin: "https://beta.example.test",
      sessionCookie: "test-session-not-printed",
      cases: [cases[2], cases[0], cases[1]],
      fetchImpl: async (_url, init) => {
        requests.push(init ?? {});
        const request = JSON.parse(String(init?.body)) as { repositoryFullName: string; pullRequestNumber: number };
        const item = cases.find((candidate) => candidate.repositoryFullName === request.repositoryFullName && candidate.pullRequestNumber === request.pullRequestNumber);
        if (!item) throw new Error("unexpected bounded request");
        return smokeResponse(validEnvelope(item, `${requests.length}`.repeat(64)));
      }
    });

    expect(result.exitCode).toBe(0);
    expect(result.summary).toMatchObject({ caseCount: 3, passedCount: 3 });
    expect(requests).toHaveLength(3);
    expect(requests.every((request) => request.redirect === "error" && (request.headers as Record<string, string>).Origin === "https://beta.example.test")).toBe(true);
    expect(JSON.stringify(result.summary)).not.toContain("test-session-not-printed");
    expect(requests.every((request) => !("x-vercel-protection-bypass" in (request.headers as Record<string, string>)))).toBe(true);
  });

  it("sends a bypass only to the approved origin and never echoes it in the bounded summary", async () => {
    const requests: RequestInit[] = [];
    const bypass = "test-bypass-not-printed";
    const result = await runConciergeNonProductionSmoke({
      baseUrl: "https://beta.example.test",
      approvedOrigin: "https://beta.example.test",
      sessionCookie: "bounded-session",
      vercelProtectionBypass: bypass,
      cases,
      fetchImpl: async (_url, init) => {
        requests.push(init ?? {});
        const request = JSON.parse(String(init?.body)) as { repositoryFullName: string; pullRequestNumber: number };
        const item = cases.find((candidate) => candidate.repositoryFullName === request.repositoryFullName && candidate.pullRequestNumber === request.pullRequestNumber);
        if (!item) throw new Error("unexpected request");
        return smokeResponse(validEnvelope(item, `${item.installationId}`.repeat(64)));
      }
    });

    expect(result.exitCode).toBe(0);
    expect(requests).toHaveLength(3);
    expect(requests.every((request) => (request.headers as Record<string, string>)["x-vercel-protection-bypass"] === bypass)).toBe(true);
    expect(JSON.stringify(result.summary)).not.toContain(bypass);
  });

  it("rejects a bypass before fetch for an unapproved origin", async () => {
    let fetchCalls = 0;
    const result = await runConciergeNonProductionSmoke({
      baseUrl: "https://wrong.example.test",
      approvedOrigin: "https://beta.example.test",
      sessionCookie: "bounded-session",
      vercelProtectionBypass: "test-bypass-not-printed",
      cases,
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error("must not fetch");
      }
    });

    expect(result.exitCode).toBe(2);
    expect(fetchCalls).toBe(0);
  });

  it("fails a 200 response with an invalid nested report instead of trusting the envelope", async () => {
    const result = await runConciergeNonProductionSmoke({
      baseUrl: "https://beta.example.test",
      approvedOrigin: "https://beta.example.test",
      sessionCookie: "bounded-session",
      cases,
      fetchImpl: async (_url, init) => {
        const request = JSON.parse(String(init?.body)) as { repositoryFullName: string; pullRequestNumber: number };
        const item = cases.find((candidate) => candidate.repositoryFullName === request.repositoryFullName && candidate.pullRequestNumber === request.pullRequestNumber);
        if (!item) throw new Error("unexpected request");
        const body = validEnvelope(item, `${item.installationId}`.repeat(64));
        if (item.caseId === cases[0].caseId) (body.report as Record<string, unknown>).accuracyVerified = true;
        return smokeResponse(body);
      }
    });

    expect(result.exitCode).toBe(1);
    expect(result.summary).toMatchObject({ passedCount: 2 });
  });

  it("uses exit 2 when individually valid reports reuse a telemetry case hash", async () => {
    const result = await runConciergeNonProductionSmoke({
      baseUrl: "https://beta.example.test",
      approvedOrigin: "https://beta.example.test",
      sessionCookie: "bounded-session",
      cases,
      fetchImpl: async (_url, init) => {
        const request = JSON.parse(String(init?.body)) as { repositoryFullName: string; pullRequestNumber: number };
        const item = cases.find((candidate) => candidate.repositoryFullName === request.repositoryFullName && candidate.pullRequestNumber === request.pullRequestNumber);
        if (!item) throw new Error("unexpected request");
        return smokeResponse(validEnvelope(item, "d".repeat(64)));
      }
    });

    expect(result.exitCode).toBe(2);
    expect(result.summary).toMatchObject({ passedCount: 3 });
  });
});

function validEnvelope(item: typeof cases[number], caseIdOrHash: string): Record<string, unknown> {
  const headSha = "a".repeat(40);
  const originalTask = item.expectedOriginalTaskStatus === "ambiguous"
    ? { version: 1 as const, status: "ambiguous" as const, sourceType: "none" as const, reason: "multiple_linked_issues" as const }
    : { version: 1 as const, status: "available" as const, sourceType: "linked_issue" as const, reason: "none" as const, sourceRef: "github_issue:42" };
  const report = generateVerificationReport({
    url: `https://github.com/${item.repositoryFullName}/pull/${item.pullRequestNumber}`,
    title: "Bounded synthetic private PR",
    description: "Reference context only.",
    taskSource: originalTask.status === "available" ? "issue" : undefined,
    taskText: originalTask.status === "available" ? "The endpoint must reject unauthenticated requests and include a targeted test." : "",
    originalTask,
    changedFiles: [{ path: "src/feature.ts", status: "modified", patch: "+ bounded change" }],
    checks: [{ name: "test", status: item.expectedCiStatus, summary: `Status: ${item.expectedCiStatus}`, url: `https://github.com/${item.repositoryFullName}/actions/runs/1` }],
    logs: [],
    limitations: ["Raw CI logs were not fetched or stored."],
    sourceProvenance: { version: 1, origin: "github_snapshot", headSha, evidenceCapturedAt: "2026-07-15T00:00:00.000Z", inputFingerprint: { version: 1, algorithm: "sha256", value: "b".repeat(64), coverage: "github_metadata" } }
  });
  expect(validateVerificationReport(report, { mode: "full", requireSourceProvenance: true })).toEqual({ valid: true, errors: [] });
  return {
    report,
    caseIdOrHash,
    capabilities: { manualAnalysisEnabled: true, globalKillSwitch: false, llmEnabled: false, webhookAutomationEnabled: false, saveReportsEnabled: false, publicShareEnabled: false, githubCommentEnabled: false, slackEnabled: false, billingEnabled: false, fullHistoryEnabled: false },
    privacy: "transient-full-report-no-durable-save",
    sideEffects: { llm: false, save: false, share: false, comment: false, slack: false, webhook: false },
    sideEffectTelemetry: { version: "concierge-side-effect-telemetry.v1", caseIdOrHash, sourceHeadSha: headSha, observation: "runtime_instrumented", counts: { llm: 0, comment: 0, slack: 0, share: 0, save: 0, webhook: 0 } }
  };
}

function smokeResponse(body: Record<string, unknown>): Response {
  const response = new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "private, no-store", "referrer-policy": "no-referrer" }
  });
  return {
    status: response.status,
    redirected: false,
    url: endpoint,
    headers: response.headers,
    body: response.body
  } as Response;
}
