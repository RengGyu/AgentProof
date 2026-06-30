import { noStoreJson, parseJsonSafely } from "@/lib/http";
import { verifyOpsRequest } from "@/lib/ops-auth";
import {
  blockTenantDeletionNewWork,
  buildTenantDeletionExecutionPlan,
  TenantDeletionExecutionError
} from "@/lib/tenant-deletion-execution";

export async function GET(request: Request) {
  const auth = verifyOpsRequest(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId");

  if (!tenantId) {
    return noStoreJson({
      error: "Tenant deletion plan requires a tenant id.",
      code: "tenant_deletion_tenant_required"
    }, { status: 422 });
  }

  try {
    const plan = await buildTenantDeletionExecutionPlan({ tenantId });
    return noStoreJson(plan);
  } catch (error) {
    if (error instanceof TenantDeletionExecutionError) {
      return noStoreJson({
        error: "Tenant deletion plan input is invalid.",
        code: "tenant_deletion_input_invalid"
      }, { status: 422 });
    }

    throw error;
  }
}

export async function POST(request: Request) {
  const auth = verifyOpsRequest(request);
  if (!auth.ok) return auth.response;

  const body = parseJsonSafely<{
    tenantId?: unknown;
    action?: unknown;
  }>(await request.text());

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return noStoreJson({
      error: "Tenant deletion request must be a JSON object.",
      code: "tenant_deletion_payload_invalid"
    }, { status: 400 });
  }

  if (body.action !== "block_new_work") {
    return noStoreJson({
      error: "Tenant deletion action is not supported.",
      code: "tenant_deletion_action_unsupported"
    }, { status: 422 });
  }

  try {
    const result = await blockTenantDeletionNewWork({ tenantId: body.tenantId });
    return noStoreJson(result);
  } catch (error) {
    if (error instanceof TenantDeletionExecutionError) {
      return noStoreJson({
        error: "Tenant deletion block input is invalid.",
        code: "tenant_deletion_input_invalid"
      }, { status: 422 });
    }

    throw error;
  }
}
