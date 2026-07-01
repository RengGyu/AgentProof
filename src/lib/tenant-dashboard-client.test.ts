import { describe, expect, it } from "vitest";
import {
  tenantDeletionPreviewUrl,
  tenantHealthUrl,
  tenantInviteHeaders,
  tenantMutationHeaders,
  tenantAnalysisJobsUrl,
  tenantAccountUrl,
  tenantEntitlementsUrl,
  tenantOnboardingStartPayload,
  tenantAuditActivityUrl,
  tenantAuditExportUrl,
  tenantReportsUrl,
  tenantSessionPayload,
  tenantSettingsPatchPayload,
  tenantSettingsUrl,
  tenantUsageUrl
} from "./tenant-dashboard-client";

describe("tenant dashboard client request helpers", () => {
  it("keeps tenant invite tokens in headers, not settings URLs", () => {
    const headers = tenantInviteHeaders("tenant-secret-token");
    const url = tenantSettingsUrl(" tenant_a ");

    expect(headers).toEqual({ "x-agentproof-beta-invite-token": "tenant-secret-token" });
    expect(url).toBe("/api/tenants/repositories?tenantId=tenant_a");
    expect(url).not.toContain("tenant-secret-token");
    expect(url).not.toContain("invite");
  });

  it("omits blank tenant invite tokens from headers", () => {
    expect(tenantInviteHeaders("  ")).toEqual({});
  });

  it("adds an explicit same-origin marker for tenant mutations without credentials", () => {
    const headers = tenantMutationHeaders();

    expect(headers).toEqual({ "x-agentproof-csrf": "same-origin" });
    expect(JSON.stringify(headers)).not.toContain("token");
    expect(JSON.stringify(headers)).not.toContain("cookie");
    expect(JSON.stringify(headers)).not.toContain("secret");
  });

  it("builds usage status URLs without invite tokens or raw usage internals", () => {
    const url = tenantUsageUrl(" tenant_a ");

    expect(url).toBe("/api/tenants/usage?tenantId=tenant_a");
    expect(url).not.toContain("token");
    expect(url).not.toContain("invite");
    expect(url).not.toContain("idempotency");
    expect(url).not.toContain("service-role");
  });

  it("builds account status URLs without invite tokens or account secrets", () => {
    const url = tenantAccountUrl(" tenant_a ");

    expect(url).toBe("/api/tenants/account?tenantId=tenant_a");
    expect(url).not.toContain("token");
    expect(url).not.toContain("invite");
    expect(url).not.toContain("email");
    expect(url).not.toContain("billing");
    expect(url).not.toContain("service-role");
  });

  it("builds plan access URLs without invite tokens, provider ids, or raw evidence fields", () => {
    const url = tenantEntitlementsUrl(" tenant_a ");

    expect(url).toBe("/api/tenants/entitlements?tenantId=tenant_a");
    expect(url).not.toContain("token");
    expect(url).not.toContain("invite");
    expect(url).not.toContain("customer");
    expect(url).not.toContain("subscription");
    expect(url).not.toContain("provider");
    expect(url).not.toContain("installation");
    expect(url).not.toContain("repositoryId");
    expect(url).not.toContain("rawDiff");
    expect(url).not.toContain("service-role");
  });

  it("builds summary report list URLs without invite tokens or raw report internals", () => {
    const url = tenantReportsUrl(" tenant_a ", 999);
    const filteredUrl = tenantReportsUrl(" tenant_a ", 10, {
      priority: "high",
      status: "missing_tests",
      query: "AgentProof key=secret_should_not_leak rawDiff"
    });

    expect(url).toBe("/api/tenants/reports?tenantId=tenant_a&limit=25");
    expect(filteredUrl).toBe("/api/tenants/reports?tenantId=tenant_a&limit=10&priority=high&status=missing_tests&query=AgentProof+redacted");
    expect(url).not.toContain("token");
    expect(url).not.toContain("invite");
    expect(url).not.toContain("key=");
    expect(url).not.toContain("reportBody");
    expect(url).not.toContain("table");
    expect(url).not.toContain("service-role");
    expect(filteredUrl).not.toContain("invite");
    expect(filteredUrl).not.toContain("accessToken");
    expect(filteredUrl).not.toContain("reportKey");
    expect(filteredUrl).not.toContain("key=");
    expect(filteredUrl).not.toContain("secret_should_not_leak");
    expect(filteredUrl).not.toContain("rawDiff");
    expect(filteredUrl).not.toContain("table");
    expect(filteredUrl).not.toContain("service-role");
  });

  it("builds analysis job status URLs without invite tokens or worker internals", () => {
    const url = tenantAnalysisJobsUrl(" tenant_a ", 999, "failed");

    expect(url).toBe("/api/tenants/analysis-jobs?tenantId=tenant_a&limit=25&status=failed");
    expect(url).not.toContain("token");
    expect(url).not.toContain("invite");
    expect(url).not.toContain("idempotency");
    expect(url).not.toContain("payload");
    expect(url).not.toContain("table");
    expect(url).not.toContain("service-role");
  });

  it("builds deletion preview URLs without invite tokens or destructive controls", () => {
    const url = tenantDeletionPreviewUrl(" tenant_a ");

    expect(url).toBe("/api/tenants/deletion-preview?tenantId=tenant_a");
    expect(url).not.toContain("token");
    expect(url).not.toContain("invite");
    expect(url).not.toContain("delete=true");
    expect(url).not.toContain("confirm");
    expect(url).not.toContain("table");
    expect(url).not.toContain("service-role");
  });

  it("builds bounded audit activity URLs without invite tokens or storage internals", () => {
    const url = tenantAuditActivityUrl(" tenant_a ", 999);

    expect(url).toBe("/api/tenants/audit-activity?tenantId=tenant_a&limit=25");
    expect(url).not.toContain("token");
    expect(url).not.toContain("invite");
    expect(url).not.toContain("payload");
    expect(url).not.toContain("table");
    expect(url).not.toContain("service-role");
  });

  it("builds bounded audit export URLs without invite tokens, provider ids, or raw internals", () => {
    const url = tenantAuditExportUrl(" tenant_a ", 999);
    const minimumUrl = tenantAuditExportUrl(" tenant_a ", -1);
    const malformedUrl = tenantAuditExportUrl(" tenant_a ", Number.NaN);

    expect(url).toBe("/api/tenants/audit-export?tenantId=tenant_a&limit=250");
    expect(minimumUrl).toBe("/api/tenants/audit-export?tenantId=tenant_a&limit=1");
    expect(malformedUrl).toBe("/api/tenants/audit-export?tenantId=tenant_a&limit=100");
    expect(url).not.toContain("token");
    expect(url).not.toContain("invite");
    expect(url).not.toContain("payload");
    expect(url).not.toContain("table");
    expect(url).not.toContain("service-role");
    expect(url).not.toContain("installation");
    expect(url).not.toContain("repositoryId");
    expect(url).not.toContain("savedReportUrl");
    expect(url).not.toContain("rawDiff");
    expect(url).not.toContain("rawLog");
    expect(url).not.toContain("claims");
    expect(url).not.toContain("reprompt");
  });

  it("starts onboarding without putting invite tokens in the JSON body", () => {
    const payload = tenantOnboardingStartPayload(" tenant_a ");

    expect(payload).toEqual({ tenantId: "tenant_a" });
    expect(JSON.stringify(payload)).not.toContain("token");
    expect(JSON.stringify(payload)).not.toContain("invite");
  });

  it("starts tenant admin sessions without putting invite tokens in the JSON body", () => {
    const payload = tenantSessionPayload({ tenantId: " tenant_a " });
    const serialized = JSON.stringify(payload);

    expect(payload).toEqual({ tenantId: "tenant_a" });
    expect(Object.keys(payload)).toEqual(["tenantId"]);
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("invite");
  });

  it("builds metadata-only and explicit GitHub probe health URLs", () => {
    const metadataOnly = tenantHealthUrl("tenant_a");
    const singleProbe = tenantHealthUrl("tenant_a", { probeGitHub: true, repositoryId: 456 });
    const firstReportProbe = tenantHealthUrl("tenant_a", { probeGitHub: true, repositoryId: 456, pullRequestNumber: 42 });
    const broadProbe = tenantHealthUrl("tenant_a", { probeGitHub: true });

    expect(metadataOnly).toBe("/api/tenants/repositories/health?tenantId=tenant_a");
    expect(metadataOnly).not.toContain("probe=github");
    expect(metadataOnly).not.toContain("repositoryId");
    expect(singleProbe).toBe("/api/tenants/repositories/health?tenantId=tenant_a&probe=github&repositoryId=456");
    expect(firstReportProbe).toBe("/api/tenants/repositories/health?tenantId=tenant_a&probe=github&repositoryId=456&pullRequestNumber=42");
    expect(broadProbe).toBe("/api/tenants/repositories/health?tenantId=tenant_a&probe=github");
  });

  it("omits malformed repository ids and pull request numbers from health probe URLs", () => {
    const url = tenantHealthUrl("tenant_a", { probeGitHub: true, repositoryId: 0, pullRequestNumber: 0 });

    expect(url).toBe("/api/tenants/repositories/health?tenantId=tenant_a&probe=github");
    expect(url).not.toContain("repositoryId=0");
    expect(url).not.toContain("pullRequestNumber=0");
  });

  it("builds allowlisted settings PATCH payloads without invite tokens or raw evidence fields", () => {
    const payload = tenantSettingsPatchPayload({
      tenantId: " tenant_a ",
      installationId: 123,
      repositoryId: 456,
      setting: "slackNotificationsEnabled",
      value: true
    });
    const serialized = JSON.stringify(payload);

    expect(payload).toEqual({
      tenantId: "tenant_a",
      installationId: 123,
      repositoryId: 456,
      settings: {
        slackNotificationsEnabled: true
      }
    });
    expect(Object.keys(payload)).toEqual(["tenantId", "installationId", "repositoryId", "settings"]);
    expect(serialized).not.toContain("inviteToken");
    expect(serialized).not.toContain("rawDiff");
    expect(serialized).not.toContain("logs");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
    expect(serialized).not.toContain("webhook");
    expect(serialized).not.toContain("channel");
    expect(serialized).not.toContain("workspace");
  });
});
