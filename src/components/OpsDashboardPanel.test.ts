import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./OpsDashboardPanel.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../app/ops/page.tsx", import.meta.url), "utf8");

describe("OpsDashboardPanel product and privacy boundary", () => {
  it("does not persist operator tokens in browser storage or URLs", () => {
    expect(source).toContain("opsTokenHeaders(opsToken)");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
    expect(source).not.toContain("document.cookie");
    expect(source).not.toContain("token=");
    expect(source).not.toContain("JSON.stringify({ opsToken");
  });

  it("uses only read-only operator summary endpoints", () => {
    expect(source).toContain("opsGitHubAppStatusUrl()");
    expect(source).toContain("opsDeadLetterUrl(25)");
    expect(source).toContain("opsTenantDeletionPlanUrl(deletionTenantId)");
    expect(source).not.toContain("/api/ops/analysis-jobs/run");
    expect(source).not.toContain("/api/ops/analysis-jobs/run-batch");
    expect(source).not.toContain("/api/ops/analysis-jobs/preflight");
    expect(source).not.toContain("/api/ops/analysis-jobs/alerts/slack");
    expect(source).not.toContain("method: \"POST\"");
    expect(source).not.toContain("block_new_work");
  });

  it("renders metadata-only operations signals without raw automation internals", () => {
    const combined = `${source}\n${pageSource}`;
    expect(combined).toContain("bounded metadata");
    expect(combined).toContain("Queue Summary");
    expect(combined).toContain("Dead Letter Summary");
    expect(combined).toContain("Tenant Deletion Plan");
    expect(combined).toContain("analysis-job-queue-summary-only");
    expect(combined).toContain("analysis-job-dead-letter-summary-only");
    expect(combined).toContain("tenant-deletion-execution-plan-metadata-only");
    expect(combined).toContain("json.destructiveDataDeletion !== false");
    expect(combined).not.toContain("repositoryFullName");
    expect(combined).not.toContain("tenant_id");
    expect(combined).not.toContain("installationId");
    expect(combined).not.toContain("pullRequestUrl");
    expect(combined).not.toContain("headSha");
    expect(combined).not.toContain("deliveryId");
    expect(combined).not.toContain("idempotencyKey");
    expect(combined).not.toContain("idempotency_key_hash");
    expect(combined).not.toContain("evidenceIndex");
    expect(combined).not.toContain("rawDiff");
    expect(combined).not.toContain("rawLog");
    expect(combined).not.toContain("reportBody");
    expect(combined).not.toContain("commentBody");
    expect(combined).not.toContain("serviceRole");
    expect(combined).not.toContain("privateKey");
  });

  it("keeps destructive deletion and approval workflows out of the operator screen", () => {
    const combined = `${source}\n${pageSource}`;
    expect(combined).not.toContain("Delete Tenant");
    expect(combined).not.toContain("Confirm Delete");
    expect(combined).not.toContain("Approve");
    expect(combined).not.toContain("Merge");
    expect(combined).not.toContain("auto-merge");
  });
});
