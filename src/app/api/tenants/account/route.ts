import { verifyTenantAccess } from "@/lib/tenant-admin-access";
import { noStoreJson } from "@/lib/http";
import { readTenantAccountSummary } from "@/lib/tenant-accounts";

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
      error: "Tenant account status requires valid tenant authorization.",
      code: "tenant_account_unauthorized"
    }, { status: 401 });
  }

  try {
    const summary = await readTenantAccountSummary({ tenantId: access.tenantId });

    return noStoreJson({
      ok: true,
      tenantId: access.tenantId,
      account: summary.account,
      members: summary.members,
      roleCounts: summary.roleCounts,
      privacy: summary.privacy,
      next: summary.account.configured ? "manage_member_roles" : "configure_account_store"
    });
  } catch {
    return noStoreJson({
      error: "Tenant account status is unavailable.",
      code: "tenant_account_unavailable"
    }, { status: 503 });
  }
}
