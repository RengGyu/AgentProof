import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSavedReport, createVerifiedSavedReport, getSavedReport, listTenantSavedReports, cleanupExpiredSavedReports, purgeTenantSavedReportsForDeletion } from "./server-report-store";
import { generateVerificationReportV2FromInput } from "./verifier";
import { demoScenarios } from "./sample-data";
import { createAutomationSavedReport } from "./github-app-side-effects";

const identity = { tenantId: "tenant_retention", installationId: 42, repositoryId: 9, pullRequestNumber: 7, headSha: "a".repeat(40) };
const retained = { ...identity, retention: "until-deletion" as const };
let row: any;
let calls: Array<{ url: URL; init: RequestInit }>;
beforeEach(() => {
  calls = []; row = null;
  vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_URL", "https://store.invalid");
  vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY", "test-key");
  vi.stubEnv("AGENTPROOF_REPORTS_TABLE", "agentproof_saved_reports");
  vi.stubEnv("AGENTPROOF_REPORT_SIGNING_SECRET", "test-report-signing-secret-that-is-long-enough");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: new URL(url), init });
    if (url.includes("/rpc/")) {
      const p = JSON.parse(String(init.body));
      row = Object.fromEntries(Object.entries(p).map(([key, value]) => [key.slice(2), value]));
      return Response.json([row]);
    }
    return Response.json(row ? [row] : [], { headers: { "Content-Range": "0-0/1" } });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("writes a signed sanitized tenant PR version with no expiry and reopens it", async () => {
  const saved = await createVerifiedSavedReport(generateVerificationReportV2FromInput(demoScenarios.clean), retained);
  expect(row.expires_at).toBeNull();
  expect(saved.expiresAt).toBeNull();
  expect(saved.report.authenticity?.trust).toBe("verified_agentproof");
  expect(JSON.stringify(row)).not.toContain("privateReceiptBundleV2");
  expect(row.report.evidenceIndex.every((item: any) => !item.summary && !item.excerpt && !item.content)).toBe(true);
  expect(saved.report.claims).toEqual([]);
  const loaded = await getSavedReport(saved.id, { tenantId: identity.tenantId });
  expect(loaded?.id).toBe(saved.id);
  expect(loaded?.report).toEqual(saved.report);
  expect(await getSavedReport(saved.id, { tenantId: "tenant_other" })).toBeNull();
});
it("lists retained history by tenant/repository/PR with paging and includes null expiry", async () => {
  await createVerifiedSavedReport(generateVerificationReportV2FromInput(demoScenarios.clean), retained);
  const reports = await listTenantSavedReports({ tenantId: identity.tenantId, repositoryId: 9, pullRequestNumber: 7, offset: 50, limit: 50 });
  expect(reports).toHaveLength(1);
  const params = calls.at(-1)!.url.searchParams;
  expect(params.get("tenant_id")).toBe("eq.tenant_retention");
  expect(params.get("repository_id")).toBe("eq.9");
  expect(params.get("pull_request_number")).toBe("eq.7");
  expect(params.get("offset")).toBe("50");
  expect(params.get("or")).toMatch(/^\(expires_at\.is\.null,expires_at\.gt\./);
  expect(params.has("expires_at")).toBe(false);
});
it("never reports Saved for a missing durable write acknowledgement", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json([]));
  await expect(createVerifiedSavedReport(generateVerificationReportV2FromInput(demoScenarios.clean), retained)).rejects.toThrow();
});
it("requires durable storage and complete trusted PR identity for until-deletion retention", async () => {
  await expect(createSavedReport(generateVerificationReportV2FromInput(demoScenarios.clean), retained)).rejects.toThrow();
  await expect(createVerifiedSavedReport(generateVerificationReportV2FromInput(demoScenarios.clean), { retention: "until-deletion", tenantId: identity.tenantId })).rejects.toThrow();
  vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_URL", ""); vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY", ""); vi.stubEnv("SUPABASE_URL", ""); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  await expect(createVerifiedSavedReport(generateVerificationReportV2FromInput(demoScenarios.clean), retained)).rejects.toThrow();
});
it("keeps TTL on unrelated share reports; cleanup excludes null expiry but account purge has no expiry filter", async () => {
  const share = await createSavedReport(generateVerificationReportV2FromInput(demoScenarios.clean));
  expect(Date.parse(share.expiresAt!) - Date.parse(share.createdAt)).toBe(86400000);
  await cleanupExpiredSavedReports();
  const cleanup = [...calls].reverse().find(call => call.init.method === "DELETE")!;
  expect(cleanup.url.searchParams.get("expires_at")).toMatch(/^lte\./);
  await purgeTenantSavedReportsForDeletion({ tenantId: identity.tenantId });
  const purge = [...calls].reverse().find(call => call.init.method === "DELETE")!;
  expect(purge.url.searchParams.get("tenant_id")).toBe("eq.tenant_retention");
  expect(purge.url.searchParams.has("expires_at")).toBe(false);
});
it("retains newly generated durable GitHub automation reports in the same versioned store", async () => {
  vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
  const saved = await createAutomationSavedReport(generateVerificationReportV2FromInput(demoScenarios.clean), { ...identity, requestUrl: "https://app.invalid" });
  expect(saved?.expiresAt).toBeNull();
  expect(row.expires_at).toBeNull();
});
