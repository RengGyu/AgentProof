import {
  clearTenantAuthSessionCookie,
  createTenantAuthSession,
  revokeTenantAuthSession,
  TenantAuthError,
  TenantAuthStoreError
} from "@/lib/tenant-auth";
import { noStoreJson, parseJsonSafely, utf8ByteLength } from "@/lib/http";

const MAX_AUTH_SESSION_REQUEST_BYTES = 10_000;

interface TenantAuthSessionRequest {
  tenantId?: unknown;
  memberId?: unknown;
}

export async function POST(request: Request) {
  const bodyText = await request.text();
  if (utf8ByteLength(bodyText) > MAX_AUTH_SESSION_REQUEST_BYTES) {
    return noStoreJson({
      error: "Tenant auth session request is too large.",
      code: "tenant_auth_session_payload_too_large"
    }, { status: 413 });
  }

  const body = parseJsonSafely<TenantAuthSessionRequest>(bodyText);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return noStoreJson({
      error: "Tenant auth session request must be a JSON object.",
      code: "tenant_auth_session_payload_invalid"
    }, { status: 400 });
  }

  const bootstrapToken = request.headers.get("x-agentproof-tenant-auth-token");

  try {
    const session = await createTenantAuthSession({
      tenantId: body.tenantId,
      memberId: body.memberId,
      bootstrapToken
    });

    return noStoreJson({
      ok: true,
      tenantId: session.tenantId,
      memberId: session.memberId,
      role: session.role,
      expiresAt: session.expiresAt,
      privacy: "tenant-auth-session-cookie-only",
      next: "use_session_cookie"
    }, {
      headers: {
        "Set-Cookie": session.sessionCookie
      }
    });
  } catch (error) {
    if (error instanceof TenantAuthStoreError) {
      return noStoreJson({
        error: "Tenant auth session storage is unavailable.",
        code: "tenant_auth_session_unavailable"
      }, { status: 503 });
    }

    if (error instanceof TenantAuthError) {
      return noStoreJson({
        error: "Tenant auth session requires a valid active member bootstrap credential.",
        code: "tenant_auth_session_unauthorized"
      }, { status: 401 });
    }

    throw error;
  }
}

export async function DELETE(request: Request) {
  try {
    await revokeTenantAuthSession({ cookieHeader: request.headers.get("cookie") });
  } catch (error) {
    if (!(error instanceof TenantAuthStoreError)) throw error;
  }

  return noStoreJson({
    ok: true,
    deleted: true,
    privacy: "tenant-auth-session-cookie-only"
  }, {
    headers: {
      "Set-Cookie": clearTenantAuthSessionCookie()
    }
  });
}
