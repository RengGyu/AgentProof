import { AuditLogError } from "@/lib/audit-log";
import { buildTenantAuditExport, normalizeTenantAuditExportLimit } from "@/lib/audit-export";
import { verifyTenantAccess } from "@/lib/tenant-admin-access";
import { noStoreJson } from "@/lib/http";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId");
  const inviteToken = request.headers.get("x-agentproof-beta-invite-token") ?? undefined;
  const limit = normalizeTenantAuditExportLimitFromParam(url.searchParams.get("limit"));
  const access = await verifyTenantAccess({
    tenantId,
    inviteToken,
    cookieHeader: request.headers.get("cookie")
  });

  if (!access.authorized || !access.tenantId) {
    return noStoreJson({
      error: "Tenant audit export requires valid tenant authorization.",
      code: "tenant_audit_export_unauthorized"
    }, { status: 401 });
  }
  const authorizedTenantId = access.tenantId;

  try {
    const payload = await buildTenantAuditExport({
      tenantId: authorizedTenantId,
      limit
    });

    return noStoreJson(payload, {
      headers: {
        "Content-Disposition": `attachment; filename="agentproof-audit-${authorizedTenantId}.json"`,
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    if (error instanceof AuditLogError) {
      return noStoreJson({
        error: "Tenant audit export is unavailable.",
        code: "tenant_audit_export_unavailable"
      }, { status: 503 });
    }

    throw error;
  }
}

function normalizeTenantAuditExportLimitFromParam(value: string | null): number {
  if (!value || !/^\d{1,3}$/.test(value)) return normalizeTenantAuditExportLimit(undefined);

  return normalizeTenantAuditExportLimit(Number(value));
}
