import { listTenantAuditEvents, AuditLogError } from "@/lib/audit-log";
import { verifyTenantAccess } from "@/lib/tenant-admin-access";
import { noStoreJson } from "@/lib/http";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId");
  const inviteToken = request.headers.get("x-agentproof-beta-invite-token") ?? undefined;
  const limit = normalizeLimit(url.searchParams.get("limit"));
  const access = await verifyTenantAccess({
    tenantId,
    inviteToken,
    cookieHeader: request.headers.get("cookie")
  });

  if (!access.authorized || !access.tenantId) {
    return noStoreJson({
      error: "Tenant audit activity requires valid tenant authorization.",
      code: "tenant_audit_unauthorized"
    }, { status: 401 });
  }
  const authorizedTenantId = access.tenantId;

  try {
    const rows = await listTenantAuditEvents({ tenantId: authorizedTenantId, limit: limit + 1 });
    const activity = rows.slice(0, limit);

    return noStoreJson({
      ok: true,
      tenantId: authorizedTenantId,
      activity,
      count: activity.length,
      truncated: rows.length > limit,
      privacy: "audit-activity-summary-only",
      next: "monitor_activity"
    });
  } catch (error) {
    if (error instanceof AuditLogError) {
      return noStoreJson({
        error: "Tenant audit activity is unavailable.",
        code: "tenant_audit_unavailable"
      }, { status: 503 });
    }

    throw error;
  }
}

function normalizeLimit(value: string | null): number {
  if (!value) return 10;
  if (!/^\d{1,3}$/.test(value)) return 10;

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 25) : 10;
}
