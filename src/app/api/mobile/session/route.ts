import { noStoreJson } from "@/lib/http";
import { mobileCookieFromRequest, revokeMobileSession } from "@/lib/mobile-auth";
import { resolveTenantAuthAccess, TenantAuthStoreError } from "@/lib/tenant-auth";

export async function GET(request: Request) {
  const cookieHeader = mobileCookieFromRequest(request);
  if (!cookieHeader) return noStoreJson({ signedIn: false }, { status: 401 });
  try {
    const access = await resolveTenantAuthAccess({ cookieHeader, expectedSource: "mobile" });
    return noStoreJson({ signedIn: access.authorized, role: access.role }, { status: access.authorized ? 200 : 401 });
  } catch (error) {
    if (error instanceof TenantAuthStoreError) return noStoreJson({ code: "mobile_session_unavailable" }, { status: 503 });
    throw error;
  }
}

export async function DELETE(request: Request) {
  try {
    return await revokeMobileSession(request) ? noStoreJson({ ok: true }) : noStoreJson({ code: "mobile_session_invalid" }, { status: 401 });
  } catch (error) {
    if (error instanceof TenantAuthStoreError) return noStoreJson({ code: "mobile_session_unavailable" }, { status: 503 });
    throw error;
  }
}
