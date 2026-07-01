import { verifyTenantAccess } from "@/lib/tenant-admin-access";
import { noStoreJson } from "@/lib/http";
import { buildTenantDeletionPreview } from "@/lib/tenant-deletion-preview";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId");

  const access = await verifyTenantAccess({
    tenantId,
    inviteToken: request.headers.get("x-agentproof-beta-invite-token") ?? undefined,
    cookieHeader: request.headers.get("cookie")
  });

  if (!access.authorized || !access.tenantId) {
    return noStoreJson({
      error: "Tenant deletion preview requires valid tenant authorization.",
      code: "tenant_deletion_preview_unauthorized"
    }, { status: 401 });
  }

  const preview = await buildTenantDeletionPreview({ tenantId: access.tenantId });

  return noStoreJson(preview);
}
