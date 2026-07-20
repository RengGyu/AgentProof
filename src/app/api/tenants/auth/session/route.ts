import {
  clearTenantAuthSessionCookie,
  createTenantAuthSession,
  revokeTenantAuthSession,
  TenantAuthError,
  TenantAuthStoreError
} from "@/lib/tenant-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import { csrfFailureResponse, verifySameOriginMutationRequest } from "@/lib/csrf";
import { noStoreJson, parseJsonSafely, utf8ByteLength } from "@/lib/http";

const MAX_AUTH_SESSION_REQUEST_BYTES = 10_000;

interface TenantAuthSessionRequest {
  tenantId?: unknown;
  memberId?: unknown;
}

export async function POST(request: Request) {
  const csrf = verifySameOriginMutationRequest(request);
  if (!csrf.ok) {
    await recordTenantAuthFailure({ statusCode: 403, code: csrf.code });
    return csrfFailureResponse();
  }

  const bodyText = await request.text();
  if (utf8ByteLength(bodyText) > MAX_AUTH_SESSION_REQUEST_BYTES) {
    await recordTenantAuthFailure({ statusCode: 413, code: "payload_too_large" });
    return noStoreJson({
      error: "Tenant auth session request is too large.",
      code: "tenant_auth_session_payload_too_large"
    }, { status: 413 });
  }

  const body = parseJsonSafely<TenantAuthSessionRequest>(bodyText);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    await recordTenantAuthFailure({ statusCode: 400, code: "payload_invalid" });
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
      await recordTenantAuthFailure({
        tenantId: body.tenantId,
        statusCode: 503,
        code: "session_store_unavailable"
      });
      return noStoreJson({
        error: "Tenant auth session storage is unavailable.",
        code: "tenant_auth_session_unavailable"
      }, { status: 503 });
    }

    if (error instanceof TenantAuthError) {
      await recordTenantAuthFailure({
        tenantId: body.tenantId,
        statusCode: 401,
        code: "bootstrap_or_member_invalid"
      });
      return noStoreJson({
        error: "Tenant auth session requires a valid active member bootstrap credential.",
        code: "tenant_auth_session_unauthorized"
      }, { status: 401 });
    }

    throw error;
  }
}

export async function DELETE(request: Request) {
  const csrf = verifySameOriginMutationRequest(request);
  if (!csrf.ok) {
    await recordTenantAuthFailure({ statusCode: 403, code: csrf.code });
    return csrfFailureResponse();
  }

  try {
    await revokeTenantAuthSession({ cookieHeader: request.headers.get("cookie") });
  } catch (error) {
    if (!(error instanceof TenantAuthStoreError)) throw error;
    await recordTenantAuthFailure({ statusCode: 503, code: "session_revoke_unconfirmed" });
    return noStoreJson({
      error: "The browser cookie was cleared, but durable session revocation could not be confirmed.",
      code: "tenant_auth_session_revoke_unconfirmed",
      deleted: false
    }, {
      status: 503,
      headers: { "Set-Cookie": clearTenantAuthSessionCookie() }
    });
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

async function recordTenantAuthFailure(input: {
  tenantId?: unknown;
  statusCode: number;
  code: string;
}) {
  try {
    await recordAuditEvent({
      action: "tenant_auth_session_failed",
      result: "failed",
      actor: "system",
      tenantId: typeof input.tenantId === "string" ? input.tenantId : undefined,
      statusCode: input.statusCode,
      code: input.code
    });
  } catch {
    // Auth responses stay bounded even when audit storage is unavailable.
  }
}
