import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoScenarios } from "./sample-data";
import {
  clearSavedReportsForTests,
  cleanupExpiredReports,
  createSavedReport,
  getSavedReport,
  getSavedReportStoreStatus,
  MAX_SERVER_REPORTS,
  SavedReportStoreError
} from "./server-report-store";
import { generateVerificationReport } from "./verifier";

describe("server report store", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AGENTPROOF_REPORTS_SUPABASE_URL;
    delete process.env.AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.AGENTPROOF_REPORTS_TABLE;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    global.fetch = originalFetch;
  });

  afterEach(() => {
    clearSavedReportsForTests();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  it("stores only the summary-safe report projection", async () => {
    const fullReport = generateVerificationReport(demoScenarios["scope-creep"]);
    fullReport.evidenceIndex.push({
      id: "ev_annotation_secret",
      kind: "check",
      label: "unit tests",
      summary: "Check annotations: failure at src/private/auth.test.ts:42. raw_details annotation message with ghp_secret_should_not_leak",
      confidence: 0.9
    });
    fullReport.claims.push({
      id: "claim_annotation_secret",
      text: "Annotation raw_details retained sk-secret_should_not_leak",
      evidenceRefs: ["ev_annotation_secret"],
      supported: false
    });
    fullReport.reprompt.prompt = "raw_details re-prompt with github_pat_secret_should_not_leak";
    fullReport.summary.oneLine = "Summary mentions sk-secret_should_not_leak";
    fullReport.requirements[0].requirementText = "Requirement mentions github_pat_secret_should_not_leak";
    fullReport.testing.missingTests.push({ path: "src/test.ts", why: "Needs test", evidenceRefs: [] });
    fullReport.reviewPriority.push({ path: "src/review.ts", reason: "Needs review", priority: "medium" });
    fullReport.testing.missingTests[0].why = "Missing test reason with token=secret_should_not_leak";
    fullReport.reviewPriority[0].reason = "Review reason with https://hooks.slack.com/services/T000/B000/secret";
    const saved = await createSavedReport(fullReport);
    const serialized = JSON.stringify(saved.report);

    expect(saved.report.evidenceIndex).toEqual([]);
    expect(saved.report.claims).toEqual([]);
    expect(saved.report.reprompt.prompt).toContain("Shared summary links omit re-prompt text");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("raw_details");
    expect(serialized).not.toContain("src/private/auth.test.ts:42");
    expect(serialized).not.toContain("ghp_secret_should_not_leak");
    expect(serialized).not.toContain("sk-secret_should_not_leak");
    expect(serialized).not.toContain("github_pat_secret_should_not_leak");
    expect(serialized).not.toContain("secret_should_not_leak");
    expect(serialized).not.toContain("hooks.slack.com/services");
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain(fullReport.reprompt.prompt);
    expect(saved.report.limitations).toContain(
      "Shared report omits raw evidence, patch/log excerpts, claims, and re-prompt text."
    );
  });

  it("expires and deletes old reports", async () => {
    const fullReport = generateVerificationReport(demoScenarios.clean);
    const saved = await createSavedReport(fullReport, -1);

    expect(await getSavedReport(saved.id)).toBeNull();
    expect(cleanupExpiredReports()).toBe(0);
  });

  it("caps in-memory saved reports by removing oldest entries", async () => {
    const report = generateVerificationReport(demoScenarios.clean);
    const saved = [];

    for (let index = 0; index < MAX_SERVER_REPORTS + 1; index += 1) {
      saved.push(await createSavedReport(report));
    }

    expect(await getSavedReport(saved[0].id)).toBeNull();
    expect(await getSavedReport(saved.at(-1)?.id ?? "")).not.toBeNull();
  });

  it("reports in-memory fallback when durable env is absent", () => {
    expect(getSavedReportStoreStatus()).toMatchObject({
      mode: "memory",
      configured: false,
      durable: false,
      durability: "short-lived-in-memory"
    });
  });

  it("uses Supabase REST when report store env is configured", async () => {
    process.env.AGENTPROOF_REPORTS_SUPABASE_URL = "https://agentproof-test.supabase.co";
    process.env.AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    process.env.AGENTPROOF_REPORTS_TABLE = "saved_reports_test";
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.evidenceIndex.push({
      id: "ev_secret",
      kind: "log",
      label: "raw log",
      summary: "Patch excerpt with ghp_secret_should_not_leak",
      confidence: 0.6
    });
    report.reprompt.prompt = "raw re-prompt with sk-secret_should_not_leak";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const row = JSON.parse(String(init?.body));

      return Response.json([row]);
    });
    global.fetch = fetchMock as typeof fetch;

    const saved = await createSavedReport(report);
    const [url, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    const serializedBody = JSON.stringify(body);

    expect(url).toBe("https://agentproof-test.supabase.co/rest/v1/saved_reports_test");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer service-role-secret");
    expect(saved.report.evidenceIndex).toEqual([]);
    expect(serializedBody).not.toContain("Patch excerpt");
    expect(serializedBody).not.toContain("ghp_secret_should_not_leak");
    expect(serializedBody).not.toContain("sk-secret_should_not_leak");
    expect(body.report.claims).toEqual([]);
    expect(body.report.reprompt.prompt).toContain("Shared summary links omit re-prompt text");
    expect(getSavedReportStoreStatus()).toMatchObject({
      mode: "supabase",
      configured: true,
      durable: true,
      durability: "summary-only-supabase",
      table: "saved_reports_test"
    });
  });

  it("returns null for expired Supabase reports and deletes them", async () => {
    process.env.AGENTPROOF_REPORTS_SUPABASE_URL = "https://agentproof-test.supabase.co";
    process.env.AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    const report = generateVerificationReport(demoScenarios.clean);
    const expiredRow = {
      id: "expired_report",
      created_at: new Date(Date.now() - 2000).toISOString(),
      expires_at: new Date(Date.now() - 1000).toISOString(),
      report
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json([expiredRow]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    global.fetch = fetchMock as typeof fetch;

    await expect(getSavedReport("expired_report")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("id=eq.expired_report");
    expect(fetchMock.mock.calls[1][1]?.method).toBe("DELETE");
  });

  it("does not call Supabase for unsafe saved report ids", async () => {
    process.env.AGENTPROOF_REPORTS_SUPABASE_URL = "https://agentproof-test.supabase.co";
    process.env.AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    const fetchMock = vi.fn();
    global.fetch = fetchMock as typeof fetch;

    await expect(getSavedReport("../secret")).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when configured Supabase storage is unavailable", async () => {
    process.env.AGENTPROOF_REPORTS_SUPABASE_URL = "https://agentproof-test.supabase.co";
    process.env.AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    global.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as typeof fetch;

    await expect(createSavedReport(generateVerificationReport(demoScenarios.clean))).rejects.toThrow(SavedReportStoreError);
  });
});
