import {
  clearTenantAdminSessionCookie,
  createTenantAdminSession,
  GitHubOnboardingError
} from "@/lib/github-onboarding";
import { recordAuditEvent } from "@/lib/audit-log";
import { csrfFailureResponse, verifySameOriginMutationRequest } from "@/lib/csrf";
import { noStoreJson, parseJsonSafely, utf8ByteLength } from "@/lib/http";

const MAX_SESSION_REQUEST_BYTES = 10_000;

interface TenantSessionRequest {
  tenantId?: unknown;
}

export async function POST(request: Request) {
  const csrf = verifySameOriginMutationRequest(request);
  if (!csrf.ok) {
    await recordTenantSessionFailure({ statusCode: 403, code: csrf.code });
    return csrfFailureResponse();
  }

  const bodyText = await request.text();
  if (utf8ByteLength(bodyText) > MAX_SESSION_REQUEST_BYTES) {
    await recordTenantSessionFailure({ statusCode: 413, code: "payload_too_large" });
    return noStoreJson({
      error: "Tenant session request is too large.",
      code: "tenant_session_payload_too_large"
    }, { status: 413 });
  }

  const body = parseJsonSafely<TenantSessionRequest>(bodyText);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    await recordTenantSessionFailure({ statusCode: 400, code: "payload_invalid" });
    return noStoreJson({
      error: "Tenant session request must be a JSON object.",
      code: "tenant_session_payload_invalid"
    }, { status: 400 });
  }

  const inviteToken = request.headers.get("x-agentproof-beta-invite-token") ?? undefined;

  try {
    const session = createTenantAdminSession({
      tenantId: body.tenantId,
      inviteToken
    });

    return noStoreJson({
      ok: true,
      tenantId: session.tenantId,
      expiresAt: session.expiresAt,
      privacy: "tenant-admin-session-cookie-only",
      next: "use_session_cookie"
    }, {
      headers: {
        "Set-Cookie": session.sessionCookie
      }
    });
  } catch (error) {
    if (error instanceof GitHubOnboardingError) {
      await recordTenantSessionFailure({
        tenantId: body.tenantId,
        statusCode: 401,
        code: "invite_invalid"
      });
      return noStoreJson({
        error: "Tenant session requires a valid tenant-bound invite token.",
        code: "tenant_session_unauthorized"
      }, { status: 401 });
    }

    throw error;
  }
}

export async function DELETE(request: Request) {
  const csrf = verifySameOriginMutationRequest(request);
  if (!csrf.ok) {
    await recordTenantSessionFailure({ statusCode: 403, code: csrf.code });
    return csrfFailureResponse();
  }

  return noStoreJson({
    ok: true,
    deleted: true,
    privacy: "tenant-admin-session-cookie-only"
  }, {
    headers: {
      "Set-Cookie": clearTenantAdminSessionCookie()
    }
  });
}

async function recordTenantSessionFailure(input: {
  tenantId?: unknown;
  statusCode: number;
  code: string;
}) {
  try {
    await recordAuditEvent({
      action: "tenant_session_failed",
      result: "failed",
      actor: "system",
      tenantId: typeof input.tenantId === "string" ? input.tenantId : undefined,
      statusCode: input.statusCode,
      code: input.code
    });
  } catch {
    // Tenant auth responses stay bounded even when audit storage is unavailable.
  }
}
