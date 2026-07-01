import { verifyTenantAccess } from "@/lib/tenant-admin-access";
import { csrfFailureResponse, verifySameOriginMutationRequest } from "@/lib/csrf";
import { noStoreJson, parseJsonSafely, utf8ByteLength } from "@/lib/http";
import {
  readTenantAccountSummary,
  TenantAccountLifecycleError,
  TenantAccountStoreError,
  updateTenantMemberLifecycle
} from "@/lib/tenant-accounts";

const MAX_ACCOUNT_MUTATION_REQUEST_BYTES = 20_000;
const ACCOUNT_MEMBER_PATCH_KEYS = new Set(["tenantId", "memberId", "role", "status"]);

interface TenantAccountMemberPatchRequest {
  tenantId?: unknown;
  memberId?: unknown;
  role?: unknown;
  status?: unknown;
}

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

export async function PATCH(request: Request) {
  const csrf = verifySameOriginMutationRequest(request);
  if (!csrf.ok) return csrfFailureResponse();

  const bodyText = await request.text();
  if (utf8ByteLength(bodyText) > MAX_ACCOUNT_MUTATION_REQUEST_BYTES) {
    return noStoreJson({
      error: "Tenant account member lifecycle request is too large.",
      code: "tenant_account_member_lifecycle_payload_too_large"
    }, { status: 413 });
  }

  const body = parseJsonSafely<TenantAccountMemberPatchRequest>(bodyText);
  if (!body || typeof body !== "object" || Array.isArray(body) || !hasOnlyKnownKeys(body, ACCOUNT_MEMBER_PATCH_KEYS)) {
    return noStoreJson({
      error: "Tenant account member lifecycle request must be a bounded JSON object.",
      code: "tenant_account_member_lifecycle_payload_invalid"
    }, { status: 400 });
  }

  const inviteToken = request.headers.get("x-agentproof-beta-invite-token") ?? undefined;
  const access = await verifyTenantAccess({
    tenantId: body.tenantId,
    inviteToken,
    cookieHeader: request.headers.get("cookie")
  });

  if (!access.authorized || !access.tenantId) {
    return noStoreJson({
      error: "Tenant account member lifecycle requires valid tenant authorization.",
      code: "tenant_account_member_lifecycle_unauthorized"
    }, { status: 401 });
  }

  if (access.method !== "durable-session" || (access.role !== "owner" && access.role !== "admin")) {
    return noStoreJson({
      error: "Tenant account member lifecycle requires durable owner or admin auth.",
      code: "tenant_account_member_lifecycle_durable_auth_required"
    }, { status: 403 });
  }

  try {
    const member = await updateTenantMemberLifecycle({
      tenantId: access.tenantId,
      memberId: body.memberId,
      role: body.role,
      status: body.status
    });

    return noStoreJson({
      ok: true,
      tenantId: access.tenantId,
      member,
      privacy: "tenant-account-member-lifecycle-metadata-only",
      next: "member_lifecycle_saved"
    });
  } catch (error) {
    if (error instanceof TenantAccountLifecycleError) {
      return tenantAccountLifecycleErrorResponse(error);
    }

    if (error instanceof TenantAccountStoreError) {
      return noStoreJson({
        error: "Tenant account member lifecycle storage is unavailable.",
        code: "tenant_account_member_lifecycle_unavailable"
      }, { status: 503 });
    }

    throw error;
  }
}

function tenantAccountLifecycleErrorResponse(error: TenantAccountLifecycleError) {
  if (error.code === "member_not_found") {
    return noStoreJson({
      error: "Tenant account member was not found.",
      code: "tenant_account_member_not_found"
    }, { status: 404 });
  }

  if (error.code === "last_owner_required") {
    return noStoreJson({
      error: "Tenant account must keep at least one active owner.",
      code: "tenant_account_last_owner_required"
    }, { status: 409 });
  }

  if (error.code === "account_not_active") {
    return noStoreJson({
      error: "Tenant account is not active for member lifecycle changes.",
      code: "tenant_account_not_active"
    }, { status: 409 });
  }

  return noStoreJson({
    error: "Tenant account member lifecycle request is invalid.",
    code: "tenant_account_member_lifecycle_invalid"
  }, { status: 422 });
}

function hasOnlyKnownKeys(value: object, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}
