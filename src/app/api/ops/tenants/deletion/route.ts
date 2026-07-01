import { noStoreJson, parseJsonSafely } from "@/lib/http";
import { verifyOpsRequest } from "@/lib/ops-auth";
import { TENANT_DATA_RETENTION_POLICY } from "@/lib/tenant-retention-policy";
import {
  blockTenantDeletionNewWork,
  buildTenantDeletionExecutionPlan,
  purgeTenantDeletionAnalysisJobsWhenSafe,
  purgeTenantDeletionSavedReportsWhenSafe,
  runTenantDeletionGuardedStep,
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
    retentionPolicyReviewed?: unknown;
    retentionPolicyVersion?: unknown;
  }>(await request.text());

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return noStoreJson({
      error: "Tenant deletion request must be a JSON object.",
      code: "tenant_deletion_payload_invalid"
    }, { status: 400 });
  }

  if (
    body.action !== "block_new_work" &&
    body.action !== "purge_saved_reports" &&
    body.action !== "purge_analysis_jobs" &&
    body.action !== "run_guarded_deletion_step"
  ) {
    return noStoreJson({
      error: "Tenant deletion action is not supported.",
      code: "tenant_deletion_action_unsupported"
    }, { status: 422 });
  }

  if (isDestructiveTenantDeletionAction(body.action) && !hasReviewedRetentionPolicy(body)) {
    return noStoreJson({
      error: "Tenant deletion requires explicit retention policy review before destructive work.",
      code: "tenant_deletion_retention_policy_review_required",
      policyVersion: TENANT_DATA_RETENTION_POLICY.version,
      privacy: "tenant-deletion-policy-review-metadata-only"
    }, { status: 409 });
  }

  try {
    const result = await runTenantDeletionAction({
      tenantId: body.tenantId,
      action: body.action
    });
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

function isDestructiveTenantDeletionAction(action: unknown): boolean {
  return action === "purge_saved_reports"
    || action === "purge_analysis_jobs"
    || action === "run_guarded_deletion_step";
}

function hasReviewedRetentionPolicy(input: {
  retentionPolicyReviewed?: unknown;
  retentionPolicyVersion?: unknown;
}): boolean {
  return input.retentionPolicyReviewed === true
    && input.retentionPolicyVersion === TENANT_DATA_RETENTION_POLICY.version;
}

async function runTenantDeletionAction(input: { tenantId?: unknown; action: unknown }) {
  if (input.action === "block_new_work") {
    return blockTenantDeletionNewWork({ tenantId: input.tenantId });
  }

  if (input.action === "purge_saved_reports") {
    const block = await blockTenantDeletionNewWork({ tenantId: input.tenantId });
    if (block.status !== "completed") return block;

    return purgeTenantDeletionSavedReportsWhenSafe({
      tenantId: input.tenantId,
      newWorkBlocked: true
    });
  }

  if (input.action === "purge_analysis_jobs") {
    const block = await blockTenantDeletionNewWork({ tenantId: input.tenantId });
    if (block.status !== "completed") return block;

    return purgeTenantDeletionAnalysisJobsWhenSafe({
      tenantId: input.tenantId,
      newWorkBlocked: true
    });
  }

  return runTenantDeletionGuardedStep({ tenantId: input.tenantId });
}
