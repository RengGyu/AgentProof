import { verifyTenantAdminAccess } from "@/lib/github-onboarding";
import { noStoreJson } from "@/lib/http";
import { buildTenantDeletionPreview } from "@/lib/tenant-deletion-preview";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId");

  const access = verifyTenantAdminAccess({
    tenantId,
    inviteToken: request.headers.get("x-agentproof-beta-invite-token") ?? undefined,
    cookieHeader: request.headers.get("cookie")
  });

  if (!access.authorized || !access.tenantId) {
    return noStoreJson({
      error: "Tenant deletion preview requires a valid tenant-bound invite token.",
      code: "tenant_deletion_preview_unauthorized"
    }, { status: 401 });
  }

  const preview = await buildTenantDeletionPreview({ tenantId: access.tenantId });

  return noStoreJson(preview);
}
