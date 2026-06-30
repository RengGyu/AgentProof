import { verifyTenantAdminAccess } from "@/lib/github-onboarding";
import { noStoreJson } from "@/lib/http";
import { readTenantEntitlementSummary } from "@/lib/tenant-entitlements";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId");
  const inviteToken = request.headers.get("x-agentproof-beta-invite-token") ?? undefined;
  const access = verifyTenantAdminAccess({
    tenantId,
    inviteToken,
    cookieHeader: request.headers.get("cookie")
  });

  if (!access.authorized || !access.tenantId) {
    return noStoreJson({
      error: "Tenant plan access requires a valid tenant-bound invite token.",
      code: "tenant_entitlements_unauthorized"
    }, { status: 401 });
  }

  try {
    const summary = await readTenantEntitlementSummary({ tenantId: access.tenantId });

    return noStoreJson({
      ok: true,
      tenantId: access.tenantId,
      plan: summary.plan,
      account: summary.account,
      quota: summary.quota,
      repositories: summary.repositories,
      features: summary.features,
      privacy: summary.privacy,
      next: summary.features.some((feature) => feature.enabled) ? "review_plan_access" : "configure_plan_access"
    });
  } catch {
    return noStoreJson({
      error: "Tenant plan access is unavailable.",
      code: "tenant_entitlements_unavailable"
    }, { status: 503 });
  }
}
