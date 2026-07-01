import { buildBillingPortalSessionBoundary } from "@/lib/billing-beta";
import { csrfFailureResponse, verifySameOriginMutationRequest } from "@/lib/csrf";
import { noStoreJson, parseJsonSafely, utf8ByteLength } from "@/lib/http";
import { verifyTenantAccess } from "@/lib/tenant-admin-access";

const MAX_BILLING_PORTAL_REQUEST_BYTES = 10_000;
const BILLING_PORTAL_KEYS = new Set(["tenantId"]);

interface TenantBillingPortalRequest {
  tenantId?: unknown;
}

export async function POST(request: Request) {
  const csrf = verifySameOriginMutationRequest(request);
  if (!csrf.ok) return csrfFailureResponse();

  const bodyText = await request.text();
  if (utf8ByteLength(bodyText) > MAX_BILLING_PORTAL_REQUEST_BYTES) {
    return noStoreJson({
      error: "Tenant billing portal request is too large.",
      code: "tenant_billing_portal_payload_too_large"
    }, { status: 413 });
  }

  const body = parseJsonSafely<TenantBillingPortalRequest>(bodyText);
  if (!body || typeof body !== "object" || Array.isArray(body) || !hasOnlyKnownKeys(body, BILLING_PORTAL_KEYS)) {
    return noStoreJson({
      error: "Tenant billing portal request must be a bounded JSON object.",
      code: "tenant_billing_portal_payload_invalid"
    }, { status: 400 });
  }

  const access = await verifyTenantAccess({
    tenantId: body.tenantId,
    inviteToken: request.headers.get("x-agentproof-beta-invite-token") ?? undefined,
    cookieHeader: request.headers.get("cookie")
  });

  if (!access.authorized || !access.tenantId) {
    return noStoreJson({
      error: "Tenant billing portal requires valid tenant authorization.",
      code: "tenant_billing_portal_unauthorized"
    }, { status: 401 });
  }

  if (access.method !== "durable-session" || (access.role !== "owner" && access.role !== "admin")) {
    return noStoreJson({
      error: "Tenant billing portal requires durable owner or admin auth.",
      code: "tenant_billing_portal_durable_auth_required"
    }, { status: 403 });
  }

  const boundary = buildBillingPortalSessionBoundary({ tenantId: access.tenantId });

  return noStoreJson({
    ok: boundary.status === "ready",
    tenantId: access.tenantId,
    billing: boundary,
    privacy: boundary.privacy,
    next: boundary.next
  }, { status: boundary.status === "unavailable" ? 503 : 200 });
}

function hasOnlyKnownKeys(value: object, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}
