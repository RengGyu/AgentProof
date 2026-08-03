import { noStoreJson } from "@/lib/http";
import { resolveTenantAuthAccess, TenantAuthStoreError } from "@/lib/tenant-auth";

export async function GET(request: Request) {
  try {
    const access = await resolveTenantAuthAccess({ cookieHeader: request.headers.get("cookie") });
    return noStoreJson({ ok: true, signedIn: access.authorized, role: access.role, privacy: "session-status-only" });
  } catch (error) {
    if (error instanceof TenantAuthStoreError) return noStoreJson({ error: "Session storage is unavailable.", code: "tenant_auth_unavailable" }, { status: 503 });
    throw error;
  }
}
