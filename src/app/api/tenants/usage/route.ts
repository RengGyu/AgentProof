import { verifyTenantAccess } from "@/lib/tenant-admin-access";
import { noStoreJson } from "@/lib/http";
import {
  readUsageQuotaStatus,
  UsageQuotaStoreError,
  usageQuotaPublicReason,
  type UsageQuotaStatus
} from "@/lib/usage-quota";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId");
  const inviteToken = request.headers.get("x-agentproof-beta-invite-token") ?? undefined;
  const access = await verifyTenantAccess({
    tenantId,
    inviteToken,
    cookieHeader: request.headers.get("cookie")
  });

  if (!access.authorized || !access.tenantId) {
    return noStoreJson({
      error: "Tenant usage status requires valid tenant authorization.",
      code: "tenant_usage_unauthorized"
    }, { status: 401 });
  }
  const authorizedTenantId = access.tenantId;

  try {
    const quota = await readUsageQuotaStatus({
      tenantId: authorizedTenantId,
      feature: "github_app_analysis"
    });

    return noStoreJson({
      ok: true,
      tenantId: quota.tenantId ?? authorizedTenantId,
      period: quota.period,
      usage: [toPublicUsageSummary(quota)],
      privacy: "usage-summary-only",
      next: quota.configured ? "monitor_quota" : "configure_quota"
    });
  } catch (error) {
    if (error instanceof UsageQuotaStoreError) {
      return noStoreJson({
        error: "Tenant usage quota status is unavailable.",
        code: "tenant_usage_quota_unavailable"
      }, { status: 503 });
    }

    throw error;
  }
}

function toPublicUsageSummary(quota: UsageQuotaStatus) {
  return {
    feature: quota.feature,
    label: "PR evidence reports",
    enforced: quota.enforced,
    configured: quota.configured,
    plan: quota.plan,
    limit: quota.limit,
    used: quota.used,
    remaining: quota.remaining,
    state: usageState(quota),
    note: quota.configured ? undefined : quotaNote(quota)
  };
}

function usageState(quota: UsageQuotaStatus): "available" | "exhausted" | "not-configured" | "not-enforced" {
  if (!quota.enforced) return "not-enforced";
  if (!quota.configured) return "not-configured";
  if ((quota.remaining ?? 0) <= 0) return "exhausted";

  return "available";
}

function quotaNote(quota: UsageQuotaStatus): string {
  if (quota.reason === "quota-store-unavailable") {
    return "Usage quota status is unavailable.";
  }

  return usageQuotaPublicReason(quota.reason);
}
