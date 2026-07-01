import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./TenantSetupPanel.tsx", import.meta.url), "utf8");

describe("TenantSetupPanel product and privacy boundary", () => {
  it("does not use browser storage for invite tokens or tenant setup state", () => {
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
    expect(source).not.toContain("document.cookie");
  });

  it("uses the tenant session endpoint without putting invite tokens in the JSON payload helper", () => {
    expect(source).toContain("/api/tenants/session");
    expect(source).toContain("tenantSessionPayload({ tenantId })");
    expect(source).not.toContain("tenantSessionPayload({ tenantId, inviteToken })");
  });

  it("does not introduce raw PR evidence or generic review surfaces", () => {
    const forbiddenCopy = [
      "PR evidence",
      "Read token",
      "Write token",
      "Logs",
      "Agent Claims",
      "Evidence Index",
      "Agent Re-prompt",
      "Copy PR Comment",
      "Post Comment",
      "auto-merge",
      "merge-blocking",
      "generic code review",
      "rawDiff",
      "evidenceIndex",
      "report body"
    ];

    for (const text of forbiddenCopy) {
      expect(source).not.toContain(text);
    }
  });

  it("keeps marker comments explicit instead of approval-oriented", () => {
    expect(source).toContain("Marker comments");
    expect(source).not.toContain("Approve");
    expect(source).not.toContain("Merge");
  });

  it("surfaces Slack summaries as opt-in metadata without provider configuration", () => {
    expect(source).toContain("slackNotificationsEnabled");
    expect(source).toContain("Slack summaries");
    expect(source).not.toContain("Slack webhook");
    expect(source).not.toContain("webhookUrl");
    expect(source).not.toContain("workspaceId");
    expect(source).not.toContain("channelId");
  });

  it("uses read-only usage status instead of quota reservation paths", () => {
    expect(source).toContain("tenantUsageUrl");
    expect(source).not.toContain("reserveUsageQuota");
    expect(source).not.toContain("idempotency");
  });

  it("uses summary-only setup warning rollups without raw setup internals", () => {
    expect(source).toContain("buildTenantSetupWarningRollup");
    expect(source).toContain("Setup Warnings");
    expect(source).toContain("Tenant setup warning summary");
    expect(source).toContain("Loaded summary signals only");
    expect(source).toContain("repository payloads");
    expect(source).toContain("raw evidence");
    expect(source).toContain("Blocking {setupWarningRollup.counts.critical}");
    expect(source).not.toContain("setupRawPayload");
    expect(source).not.toContain("providerCustomerId");
    expect(source).not.toContain("installationToken");
    expect(source).not.toContain("githubToken");
    expect(source).not.toContain("serviceRole");
    expect(source).not.toContain("webhookPayload");
    expect(source).not.toContain("rawDiff");
    expect(source).not.toContain("rawLog");
  });

  it("uses account summary metadata without full auth, billing, or contact fields", () => {
    expect(source).toContain("tenantAccountUrl");
    expect(source).toContain("Tenant Account");
    expect(source).toContain("tenant-account-summary-only");
    expect(source).toContain("Owners {accountStatus.roleCounts.owner}");
    expect(source).toContain("Admins {accountStatus.roleCounts.admin}");
    expect(source).toContain("Members {accountStatus.roleCounts.member}");
    expect(source).toContain("membersTruncated");
    expect(source).toContain("memberCount}{accountStatus.account.membersTruncated ? \"+\" : \"\"}");
    expect(source).not.toContain("email");
    expect(source).not.toContain("billing");
    expect(source).not.toContain("customerId");
    expect(source).not.toContain("subscription");
    expect(source).not.toContain("oauth");
    expect(source).not.toContain("accessToken");
    expect(source).not.toContain("refreshToken");
    expect(source).not.toContain("sessionHash");
    expect(source).not.toContain("memberInviteToken");
  });

  it("uses plan access summaries without provider identifiers or raw evidence", () => {
    expect(source).toContain("tenantEntitlementsUrl");
    expect(source).toContain("Plan Access");
    expect(source).toContain("plan-entitlement-summary-only");
    expect(source).toContain("Tenant plan access summary");
    expect(source).not.toContain("providerCustomerId");
    expect(source).not.toContain("subscriptionId");
    expect(source).not.toContain("payment");
    expect(source).not.toContain("rawDiff");
    expect(source).not.toContain("rawLog");
  });

  it("uses summary-only verification activity without raw audit internals", () => {
    expect(source).toContain("tenantAuditActivityUrl");
    expect(source).toContain("Recent Verification Activity");
    expect(source).not.toContain("tenantAuditUrl");
    expect(source).not.toContain("signature");
    expect(source).not.toContain("savedReportUrl");
    expect(source).not.toContain("commentBody");
    expect(source).not.toContain("privateKey");
    expect(source).not.toContain("serviceRole");
    expect(source).not.toContain("webhookPayload");
    expect(source).not.toContain("rawPayload");
    expect(source).not.toContain("rawBody");
  });

  it("uses summary-only audit export copy without provider ids or raw audit internals", () => {
    expect(source).toContain("tenantAuditExportUrl");
    expect(source).toContain("Audit Export");
    expect(source).toContain("Export JSON");
    expect(source).toContain("tenant-audit-export-summary-only");
    expect(source).toContain("Summary-only tenant events");
    expect(source).not.toContain("AI code review");
    expect(source).not.toContain("raw audit log");
    expect(source).not.toContain("download evidence");
    expect(source).not.toContain("full report");
    expect(source).not.toContain("signature");
    expect(source).not.toContain("savedReportUrl");
    expect(source).not.toContain("commentBody");
    expect(source).not.toContain("privateKey");
    expect(source).not.toContain("serviceRole");
    expect(source).not.toContain("webhookPayload");
    expect(source).not.toContain("rawPayload");
    expect(source).not.toContain("rawBody");
  });

  it("uses summary-only recent reports without report access internals", () => {
    expect(source).toContain("tenantReportsUrl");
    expect(source).toContain("Recent Summary Reports");
    expect(source).toContain("Summary report priority filter");
    expect(source).toContain("Summary report status filter");
    expect(source).toContain("Report search");
    expect(source).toContain("All priorities");
    expect(source).toContain("Missing tests");
    expect(source).toContain("Scope check");
    expect(source).toContain("Weak evidence");
    expect(source).toContain("filterBasis?: \"tenant_recent_summary\" | \"tenant_recent_summary_sample\"");
    expect(source).not.toContain("accessToken");
    expect(source).not.toContain("access_token_hash");
    expect(source).not.toContain("reportKey");
    expect(source).not.toContain("savedReportUrl");
    expect(source).not.toContain("commentBody");
    expect(source).not.toContain("rawLog");
    expect(source).not.toContain("rawPatch");
    expect(source).not.toContain("AI code review");
    expect(source).not.toContain("Approve");
    expect(source).not.toContain("Merge");
  });

  it("uses summary-only analysis jobs without queue or worker internals", () => {
    expect(source).toContain("tenantAnalysisJobsUrl");
    expect(source).toContain("Recent Analysis Jobs");
    expect(source).toContain("analysisJobFilter");
    expect(source).toContain("Analysis job summary");
    expect(source).toContain("Failed {analysisJobSummary.counts.failed}");
    expect(source).toContain("Recent sample {analysisJobSummary.sampled}");
    expect(source).toContain("Needs attention");
    expect(source).not.toContain("`attempts ${job.attempts}`");
    expect(source).not.toContain("job.errorSummary");
    expect(source).not.toContain("idempotency_key_hash");
    expect(source).not.toContain("delivery_id");
    expect(source).not.toContain("savedReportUrl");
    expect(source).not.toContain("commentUrl");
    expect(source).not.toContain("commentBody");
    expect(source).not.toContain("installationToken");
    expect(source).not.toContain("githubToken");
    expect(source).not.toContain("serviceRole");
    expect(source).not.toContain("webhookPayload");
  });

  it("surfaces tenant deletion preview as count-only dry run without destructive controls", () => {
    expect(source).toContain("tenantDeletionPreviewUrl");
    expect(source).toContain("Data Deletion Preview");
    expect(source).toContain("tenant-deletion-preview-counts-only");
    expect(source).toContain("Dry run");
    expect(source).toContain("known records");
    expect(source).toContain("GitHub installations");
    expect(source).toContain("Webhook deliveries");
    expect(source).toContain("manual removal required");
    expect(source).toContain("policy review required");
    expect(source).toContain("policy blocked");
    expect(source).not.toContain("Delete Tenant");
    expect(source).not.toContain("Confirm Delete");
    expect(source).not.toContain("destructive: true");
    expect(source).not.toContain("reportBody");
    expect(source).not.toContain("rawDiff");
    expect(source).not.toContain("rawLog");
    expect(source).not.toContain("serviceRole");
    expect(source).not.toContain("supabase");
  });
});
