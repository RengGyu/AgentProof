import {
  clearTenantAdminSessionCookie,
  createTenantAdminSession,
  GitHubOnboardingError
} from "@/lib/github-onboarding";
import { noStoreJson, parseJsonSafely, utf8ByteLength } from "@/lib/http";

const MAX_SESSION_REQUEST_BYTES = 10_000;

interface TenantSessionRequest {
  tenantId?: unknown;
}

export async function POST(request: Request) {
  const bodyText = await request.text();
  if (utf8ByteLength(bodyText) > MAX_SESSION_REQUEST_BYTES) {
    return noStoreJson({
      error: "Tenant session request is too large.",
      code: "tenant_session_payload_too_large"
    }, { status: 413 });
  }

  const body = parseJsonSafely<TenantSessionRequest>(bodyText);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
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
      return noStoreJson({
        error: "Tenant session requires a valid tenant-bound invite token.",
        code: "tenant_session_unauthorized"
      }, { status: 401 });
    }

    throw error;
  }
}

export async function DELETE() {
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
