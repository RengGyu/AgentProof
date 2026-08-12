import type { AnalysisJobRow } from "./analysis-jobs";

export type HybridWorkerProtocol =
  | "legacy"
  | "hybrid_submit"
  | "hybrid_retrieve"
  | "hybrid_fallback";

type ProtocolJob = Pick<AnalysisJobRow,
  "hybrid_planner_requested" | "planner_contract_version" | "planner_input_hash" |
  "provider_response_id" | "provider_status" | "provider_poll_attempts" |
  "provider_submitted_at" | "provider_expires_at" | "provider_webhook_id_hash" |
  "provider_webhook_received_at" | "semantic_retry_attempts" |
  "prior_provider_response_id" | "prior_provider_submitted_at" | "prior_provider_expires_at">;

/** Keeps the legacy continuation and hybrid capability states disjoint. */
export function resolveHybridWorkerProtocol(
  job: ProtocolJob,
  tenantPilotControlled: boolean
): HybridWorkerProtocol {
  if (!tenantPilotControlled) return "legacy";
  if (!Object.hasOwn(job, "planner_contract_version") || !Object.hasOwn(job, "planner_input_hash")) {
    return "hybrid_fallback";
  }
  if (!Object.hasOwn(job, "hybrid_planner_requested") || typeof job.hybrid_planner_requested !== "boolean") {
    return "hybrid_fallback";
  }
  const version = job.planner_contract_version;
  const hash = job.planner_input_hash;
  const legacyPair = version === null && hash === null;
  if (job.hybrid_planner_requested === false) {
    return legacyPair ? "legacy" : "hybrid_fallback";
  }
  if (legacyPair) {
    return hasProviderContinuation(job) ? "hybrid_fallback" : "hybrid_submit";
  }
  if (version !== "hybrid_requirement_planner.v1" || typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) {
    return "hybrid_fallback";
  }
  if (job.semantic_retry_attempts || job.prior_provider_response_id || job.prior_provider_submitted_at || job.prior_provider_expires_at) {
    return "hybrid_fallback";
  }
  if (job.provider_response_id) {
    return job.provider_status === "queued" || job.provider_status === "in_progress"
      ? "hybrid_retrieve"
      : "hybrid_fallback";
  }
  if (job.provider_status || job.provider_submitted_at || job.provider_expires_at ||
      job.provider_webhook_id_hash || job.provider_webhook_received_at ||
      (job.provider_poll_attempts ?? 0) > 0) {
    return "hybrid_fallback";
  }
  return "hybrid_submit";
}

function hasProviderContinuation(job: ProtocolJob): boolean {
  return job.provider_response_id != null || job.provider_status != null ||
    job.provider_submitted_at != null || job.provider_expires_at != null ||
    job.provider_webhook_id_hash != null || job.provider_webhook_received_at != null ||
    job.prior_provider_response_id != null || job.prior_provider_submitted_at != null ||
    job.prior_provider_expires_at != null ||
    (job.provider_poll_attempts ?? 0) > 0 || (job.semantic_retry_attempts ?? 0) > 0;
}
