import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), token: vi.fn(), head: vi.fn(), build: vi.fn(), reserve: vi.fn(), finish: vi.fn(), generate: vi.fn(), validate: vi.fn(), createTelemetry: vi.fn(), validateTelemetry: vi.fn()
}));
vi.mock("@/lib/concierge-private-beta", () => ({
  conciergeRuntimeDefaults: () => ({ manualAnalysisEnabled: true, globalKillSwitch: false, llmEnabled: false, webhookAutomationEnabled: false, saveReportsEnabled: false, publicShareEnabled: false, githubCommentEnabled: false, slackEnabled: false, billingEnabled: false, fullHistoryEnabled: false }),
  authorizeConciergeAccess: mocks.authorize
}));
vi.mock("@/lib/github-app", () => ({ createGitHubInstallationAccessToken: mocks.token }));
vi.mock("@/lib/github", () => ({ buildGitHubPullRequestInput: mocks.build, fetchGitHubPullRequestHead: mocks.head }));
vi.mock("@/lib/concierge-analysis-store", () => ({ getConciergeAnalysisStoreStatus: () => ({ configured: true, durable: true }), buildConciergeRequestKey: () => "a".repeat(64), reserveConciergeAnalysis: mocks.reserve, finishConciergeAnalysis: mocks.finish }));
vi.mock("@/lib/verifier", () => ({ generateVerificationReport: mocks.generate }));
vi.mock("@/lib/report-validation", () => ({ validateVerificationReport: mocks.validate }));
vi.mock("@/lib/concierge-side-effect-telemetry", () => ({ createConciergeSideEffectTelemetry: mocks.createTelemetry, validateZeroConciergeSideEffectTelemetry: mocks.validateTelemetry }));

import { POST } from "./route";

const body = { tenantId: "tenant_alpha", installationId: 101, repositoryId: 202, repositoryFullName: "acme/private", pullRequestNumber: 17, requestId: "12345678-1234-1234-1234-123456789abc" };
function request() { return new Request("https://agentproof.test/api/tenants/concierge/analyze", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://agentproof.test", cookie: "session=x" }, body: JSON.stringify(body) }); }

describe("concierge analyze route boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.head.mockResolvedValue("a".repeat(40)); mocks.reserve.mockResolvedValue({ outcome: "reserved" }); mocks.finish.mockResolvedValue(true); mocks.validate.mockReturnValue({ valid: true, errors: [] });
    mocks.createTelemetry.mockReturnValue({ snapshot: () => ({ version: "concierge-side-effect-telemetry.v1", caseIdOrHash: "a".repeat(64), sourceHeadSha: "a".repeat(40), observation: "runtime_instrumented", counts: { llm: 0, comment: 0, slack: 0, share: 0, save: 0, webhook: 0 } }) });
    mocks.validateTelemetry.mockReturnValue(true);
  });

  it("rejects unauthorized requests before token or evidence fetch", async () => {
    mocks.authorize.mockResolvedValue({ authorized: false, reason: "installation_not_active" });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.head).not.toHaveBeenCalled();
    expect(mocks.build).not.toHaveBeenCalled();
  });

  it("returns a transient report with every optional side effect off", async () => {
    mocks.authorize.mockResolvedValue({ authorized: true, tenantId: "tenant_alpha", memberId: "member_x", installationId: 101, repositoryId: 202, repositoryFullName: "acme/private" });
    mocks.token.mockResolvedValue("transient-token"); mocks.build.mockResolvedValue({}); mocks.generate.mockReturnValue({ analysisId: "opaque" });
    const response = await POST(request());
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.privacy).toBe("transient-full-report-no-durable-save");
    expect(json.sideEffects).toEqual({ llm: false, save: false, share: false, comment: false, slack: false, webhook: false });
    expect(json.sideEffectTelemetry).toEqual({ version: "concierge-side-effect-telemetry.v1", caseIdOrHash: "a".repeat(64), sourceHeadSha: "a".repeat(40), observation: "runtime_instrumented", counts: { llm: 0, comment: 0, slack: 0, share: 0, save: 0, webhook: 0 } });
    expect(mocks.token).toHaveBeenCalledTimes(1);
    expect(mocks.head).toHaveBeenCalledTimes(2);
    expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ outcome: "completed" }));
  });

  it("does not fetch full evidence for a duplicate same-head request", async () => {
    mocks.authorize.mockResolvedValue({ authorized: true, tenantId: "tenant_alpha", memberId: "member_x", installationId: 101, repositoryId: 202, repositoryFullName: "acme/private" });
    mocks.token.mockResolvedValue("transient-token"); mocks.reserve.mockResolvedValue({ outcome: "duplicate" });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(mocks.build).not.toHaveBeenCalled();
  });

  it("does not return a report when the PR head changes", async () => {
    mocks.authorize.mockResolvedValue({ authorized: true, tenantId: "tenant_alpha", memberId: "member_x", installationId: 101, repositoryId: 202, repositoryFullName: "acme/private" });
    mocks.token.mockResolvedValue("transient-token"); mocks.build.mockResolvedValue({}); mocks.generate.mockReturnValue({ analysisId: "opaque" });
    mocks.head.mockResolvedValueOnce("a".repeat(40)).mockResolvedValueOnce("b".repeat(40));
    const response = await POST(request());
    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload).toMatchObject({ code: "head_changed" });
    expect(payload.report).toBeUndefined();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed", reason: "head_changed" }));
  });

  it("stops delivery when the grant is removed during evidence collection", async () => {
    mocks.authorize
      .mockResolvedValueOnce({ authorized: true, tenantId: "tenant_alpha", memberId: "member_x", installationId: 101, repositoryId: 202, repositoryFullName: "acme/private" })
      .mockResolvedValueOnce({ authorized: false, reason: "repository_grant_disabled" });
    mocks.token.mockResolvedValue("transient-token"); mocks.build.mockResolvedValue({}); mocks.generate.mockReturnValue({ analysisId: "opaque" });
    const response = await POST(request());
    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload).toMatchObject({ code: "repository_grant_disabled" });
    expect(payload.report).toBeUndefined();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed", reason: "repository_grant_disabled" }));
  });

  it("blocks delivery when a revoked-grant failure cannot be recorded durably", async () => {
    mocks.authorize
      .mockResolvedValueOnce({ authorized: true, tenantId: "tenant_alpha", memberId: "member_x", installationId: 101, repositoryId: 202, repositoryFullName: "acme/private" })
      .mockResolvedValueOnce({ authorized: false, reason: "repository_grant_disabled" });
    mocks.token.mockResolvedValue("transient-token"); mocks.build.mockResolvedValue({}); mocks.generate.mockReturnValue({ analysisId: "opaque" }); mocks.finish.mockResolvedValue(false);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "terminal_record_unavailable" });
  });

  it("records a failed terminal state when completion cannot be recorded", async () => {
    mocks.authorize.mockResolvedValue({ authorized: true, tenantId: "tenant_alpha", memberId: "member_x", installationId: 101, repositoryId: 202, repositoryFullName: "acme/private" });
    mocks.token.mockResolvedValue("transient-token"); mocks.build.mockResolvedValue({}); mocks.generate.mockReturnValue({ analysisId: "opaque" });
    mocks.finish.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "completion_record_unavailable" });
    expect(mocks.finish).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: "failed", reason: "completion_record_unavailable" }));
  });

  it("blocks report delivery and records failed when request telemetry is nonzero or malformed", async () => {
    mocks.authorize.mockResolvedValue({ authorized: true, tenantId: "tenant_alpha", memberId: "member_x", installationId: 101, repositoryId: 202, repositoryFullName: "acme/private" });
    mocks.token.mockResolvedValue("transient-token"); mocks.build.mockResolvedValue({}); mocks.generate.mockReturnValue({ analysisId: "opaque" });
    mocks.validateTelemetry.mockReturnValue(false);
    const response = await POST(request());
    const payload = await response.json();
    expect(response.status).toBe(503);
    expect(payload).toEqual({ error: "Concierge side-effect telemetry rejected delivery.", code: "side_effect_telemetry_invalid" });
    expect(payload.report).toBeUndefined();
    expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed", reason: "side_effect_telemetry_invalid" }));
    expect(mocks.finish).not.toHaveBeenCalledWith(expect.objectContaining({ outcome: "completed" }));
  });

  it("blocks error delivery when a head-drift failure cannot be recorded", async () => {
    mocks.authorize.mockResolvedValue({ authorized: true, tenantId: "tenant_alpha", memberId: "member_x", installationId: 101, repositoryId: 202, repositoryFullName: "acme/private" });
    mocks.token.mockResolvedValue("transient-token"); mocks.build.mockResolvedValue({}); mocks.generate.mockReturnValue({ analysisId: "opaque" });
    mocks.head.mockResolvedValueOnce("a".repeat(40)).mockResolvedValueOnce("b".repeat(40)); mocks.finish.mockResolvedValue(false);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "terminal_record_unavailable" });
  });

  it.each(["401", "403", "404", "429", "500", "timeout"])("returns only a bounded failure for GitHub %s", async (failure) => {
    mocks.authorize.mockResolvedValue({ authorized: true, tenantId: "tenant_alpha", memberId: "member_x", installationId: 101, repositoryId: 202, repositoryFullName: "acme/private" });
    mocks.token.mockRejectedValue(new Error(`provider ${failure}: secret-body-must-not-leak`));
    const response = await POST(request());
    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(JSON.stringify(payload)).toBe('{"error":"Private PR evidence could not be collected.","code":"github_evidence_unavailable"}');
    expect(payload.report).toBeUndefined();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.build).not.toHaveBeenCalled();
  });
});
