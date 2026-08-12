import { createHash, randomUUID } from "crypto";
import { containsSecretPattern, redactSecrets } from "./redact";
import { authorizeTenantRepositoryGrantAsync } from "./tenant-control-plane";
import { assertTenantDeletionNotActiveAsync } from "./tenant-deletion-state";

export const DEFAULT_ANALYSIS_JOBS_TABLE = "agentproof_analysis_jobs";
export const MAX_MEMORY_ANALYSIS_JOBS = 1000;
export const DEFAULT_ANALYSIS_JOB_LEASE_MS = 10 * 60 * 1000;
export const DEFAULT_ANALYSIS_JOB_DEBOUNCE_MS = 15 * 1000;
export const SEMANTIC_RETRY_SUBMISSION_RECLAIM_MS = 30 * 1000;
export const DEFAULT_ANALYSIS_JOB_RETRY_AFTER_MS = 2 * 60 * 1000;
export const DEFAULT_ANALYSIS_JOB_MAX_ATTEMPTS = 5;
export const MAX_ANALYSIS_JOB_ERROR_SUMMARY_LENGTH = 500;
export const MAX_ANALYSIS_JOB_QUEUE_SUMMARY_ROWS = 1000;
export const MAX_TENANT_ANALYSIS_JOB_ROLLUP_ROWS = 1000;
export const MAX_ANALYSIS_JOB_DEAD_LETTER_SUMMARY_ROWS = 1000;
export const MAX_ANALYSIS_JOB_DEAD_LETTER_ERROR_CODES = 10;
export const MAX_PROVIDER_CONTINUATION_MS = 10 * 60 * 1000;

export type AnalysisJobStatus = "queued" | "processing" | "completed" | "failed_retryable" | "failed_terminal";
export type AnalysisJobStatusFilter = "all" | "active" | "failed" | "completed";
export type AnalysisJobFreshnessState = "current" | "refreshing" | "refresh_failed" | "superseded" | "stale" | "unknown";

export interface AnalysisJobFreshness {
  freshness: AnalysisJobFreshnessState;
  copyEligible: boolean;
}

export interface ResolveAnalysisJobFreshnessInput {
  tenantId?: unknown;
  repositoryId?: unknown;
  pullRequestNumber?: unknown;
  reportHeadSha?: unknown;
  staleAt?: unknown;
}

export interface AnalysisJobQueueStatus {
  enabled: boolean;
  mode: "disabled" | "memory" | "supabase";
  configured: boolean;
  durable: boolean;
  table: string;
  missingEnv: string[];
}

export interface AnalysisJobQueueSummary {
  privacy: "analysis-job-queue-summary-only";
  sampled: number;
  truncated: boolean;
  counts: Record<AnalysisJobStatus, number>;
  due: number;
  delayedRetry: number;
  staleProcessing: number;
  oldestQueuedAgeSeconds?: number;
  oldestRetryAgeSeconds?: number;
}

export interface EnqueueAnalysisJobInput {
  tenantId?: string;
  idempotencyKey: string;
  deliveryId: string;
  event: string;
  action?: string;
  installationId: number;
  repositoryId?: number;
  repositoryFullName: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  headSha: string;
  saveReport: boolean;
  comment: boolean;
  slackSummary?: boolean;
  /** Explicit protocol intent; false preserves the legacy null/null path. */
  hybridPlannerRequested?: boolean;
  now?: Date;
}

export interface AnalysisJobEnqueueResult {
  id: string;
  status: "queued";
  store: "memory" | "supabase";
  durable: boolean;
}

export interface AnalysisJobClaimOptions {
  now?: Date;
  leaseMs?: number;
}

export interface AnalysisJobProviderResponseClaimOptions extends AnalysisJobClaimOptions {
  webhookId: string;
}

export interface AnalysisJobClaimResult {
  job: AnalysisJobRow | null;
  store: "memory" | "supabase";
  durable: boolean;
}

export type AnalysisJobProviderResponseClaimDisposition =
  | "claimed"
  | "not_found"
  | "backoff"
  | "busy"
  | "expired";

export interface AnalysisJobProviderResponseClaimResult extends AnalysisJobClaimResult {
  disposition: AnalysisJobProviderResponseClaimDisposition;
}

export interface CompleteAnalysisJobInput {
  id: string;
  resultSummary?: AnalysisJobResultSummary;
  claimGeneration?: string;
  now?: Date;
}

export interface FenceAnalysisJobSemanticRetryFinalizationInput {
  id: string;
  claimGeneration: string;
  now?: Date;
}

export interface FenceAnalysisJobRevisionInput {
  id: string;
  claimGeneration: string;
  runningRevision: number;
  now?: Date;
}

export type SealAnalysisJobRevisionInput = FenceAnalysisJobRevisionInput;

export interface FailAnalysisJobInput {
  id: string;
  claimGeneration?: string;
  retryable: boolean;
  code: string;
  summary: string;
  now?: Date;
  retryAfterMs?: number;
  maxAttempts?: number;
}

export interface ParkAnalysisJobForProviderInput {
  id: string;
  claimGeneration: string;
  responseId: string;
  providerStatus: "queued" | "in_progress";
  submittedAt: Date;
  expiresAt: Date;
  runAfter: Date;
  now?: Date;
}

export interface MarkAnalysisJobProviderSubmissionInput {
  id: string;
  claimGeneration: string;
  submittedAt: Date;
  expiresAt: Date;
  now?: Date;
}

/**
 * Task 4 storage-only boundary. Task 5 may call this immediately before its
 * single submit seam; this helper never invokes a provider.
 */
export interface BindAnalysisJobPlannerSeedInput {
  id: string;
  claimGeneration: string;
  contractVersion: "hybrid_requirement_planner.v1";
  inputHash: string;
  now?: Date;
}

export type HybridPlannerJobBindingResolution =
  | { disposition: "legacy" }
  | { disposition: "ready"; inputHash: string }
  | { disposition: "fallback" };

export interface MarkAnalysisJobSemanticRetrySubmissionInput {
  id: string;
  claimGeneration: string;
  priorResponseId: string;
  priorSubmittedAt: Date;
  priorExpiresAt: Date;
  submittedAt: Date;
  expiresAt: Date;
  now?: Date;
}

export interface AnalysisJobResultSummary {
  status: "completed";
  repository: string;
  pullRequestNumber: number;
  headSha: string;
  priority: string;
  evidenceCoverage: number;
  savedReport?: {
    privacy?: string;
    durability?: string;
  };
  comment?: {
    action?: string;
  };
  slack?: {
    action?: string;
    privacy?: string;
  };
}

export interface AnalysisJobRow {
  id: string;
  status: AnalysisJobStatus;
  tenant_id?: string | null;
  idempotency_key_hash: string;
  delivery_id?: string | null;
  event: string;
  action?: string | null;
  installation_id: number;
  repository_id?: number | null;
  repository_full_name: string;
  pull_request_number: number;
  pull_request_url: string;
  head_sha: string;
  canonical_key_hash?: string;
  is_historical?: boolean;
  desired_revision?: number;
  running_revision?: number | null;
  sealed_revision?: number | null;
  publication_sealed_at?: string | null;
  sealed_delivery_id?: string | null;
  sealed_event?: string | null;
  sealed_action?: string | null;
  sealed_save_report?: boolean | null;
  sealed_comment?: boolean | null;
  sealed_slack_summary?: boolean | null;
  save_report: boolean;
  comment: boolean;
  slack_summary?: boolean;
  attempts: number;
  created_at: string;
  updated_at: string;
  run_after: string;
  locked_at?: string | null;
  completed_at?: string | null;
  error_code?: string | null;
  error_summary?: string | null;
  result_summary?: AnalysisJobResultSummary | null;
  claim_generation?: string | null;
  provider_response_id?: string | null;
  provider_status?: "submitting" | "queued" | "in_progress" | null;
  provider_poll_attempts?: number;
  provider_submitted_at?: string | null;
  provider_expires_at?: string | null;
  provider_webhook_id_hash?: string | null;
  provider_webhook_received_at?: string | null;
  semantic_retry_attempts?: number;
  prior_provider_response_id?: string | null;
  prior_provider_submitted_at?: string | null;
  prior_provider_expires_at?: string | null;
  /** Internal-only hash pair for a currently bound hybrid planner seed. */
  hybrid_planner_requested?: boolean;
  planner_contract_version?: "hybrid_requirement_planner.v1" | null;
  planner_input_hash?: string | null;
}

export interface TenantAnalysisJobSummary {
  id: string;
  status: AnalysisJobStatus;
  createdAt: string;
  updatedAt: string;
  repositoryFullName: string;
  pullRequestNumber: number;
  headShaPrefix: string;
  action?: string;
  attempts: number;
  runAfter?: string;
  completedAt?: string;
  errorCode?: string;
  errorSummary?: string;
  sideEffects: {
    saveReport: boolean;
    comment: boolean;
    slackSummary?: boolean;
  };
  result?: {
    priority?: string;
    evidenceCoverage?: number;
    savedReport?: {
      privacy?: string;
      durability?: string;
    };
    comment?: {
      action?: string;
    };
    slack?: {
      action?: string;
      privacy?: string;
    };
  };
  privacy: "analysis-job-summary-only";
}

export interface TenantAnalysisJobRollupSummary {
  privacy: "analysis-job-tenant-rollup-summary-only";
  basis: "tenant_recent_sample";
  sampled: number;
  truncated: boolean;
  statusCounts: Record<AnalysisJobStatus, number>;
  counts: {
    active: number;
    failed: number;
    completed: number;
    retrying: number;
    terminal: number;
  };
}

export interface AnalysisJobDeadLetterSummary {
  privacy: "analysis-job-dead-letter-summary-only";
  basis: "failed_terminal_recent_sample";
  sampled: number;
  truncated: boolean;
  sampledTerminalCount: number;
  topErrorCodes: Array<{
    errorCode: string;
    count: number;
  }>;
  oldestTerminalAgeSeconds?: number;
}

export interface TenantAnalysisJobCount {
  count: number;
  store: "none" | "memory" | "supabase";
  durable: boolean;
  configured: boolean;
  disabled?: boolean;
}

export interface TenantActiveAnalysisJobDeletionCount {
  privacy: "analysis-job-active-deletion-count-metadata-only";
  count: number;
  statusCounts: Pick<Record<AnalysisJobStatus, number>, "queued" | "processing" | "failed_retryable">;
  disabled?: boolean;
}

export interface TenantAnalysisJobPurgeResult {
  privacy: "analysis-job-tenant-purge-metadata-only";
  deletedCount: number;
  countBasis: "disabled-store-count" | "exact-memory-delete-count" | "pre-delete-supabase-count";
  store: "none" | "memory" | "supabase";
  durable: boolean;
  configured: boolean;
  disabled?: boolean;
}

interface AnalysisJobStoreConfig {
  url: string;
  serviceRoleKey: string;
  table: string;
}

type GlobalWithAnalysisJobs = typeof globalThis & {
  __agentproofAnalysisJobs?: AnalysisJobRow[];
};

const ANALYSIS_JOB_SELECT = [
  "id",
  "status",
  "tenant_id",
  "idempotency_key_hash",
  "delivery_id",
  "event",
  "action",
  "installation_id",
  "repository_id",
  "repository_full_name",
  "pull_request_number",
  "pull_request_url",
  "head_sha",
  "canonical_key_hash",
  "is_historical",
  "desired_revision",
  "running_revision",
  "sealed_revision",
  "publication_sealed_at",
  "sealed_delivery_id",
  "sealed_event",
  "sealed_action",
  "sealed_save_report",
  "sealed_comment",
  "sealed_slack_summary",
  "save_report",
  "comment",
  "slack_summary",
  "attempts",
  "created_at",
  "updated_at",
  "run_after",
  "locked_at",
  "completed_at",
  "error_code",
  "error_summary",
  "result_summary",
  "claim_generation",
  "provider_response_id",
  "provider_status",
  "provider_poll_attempts",
  "provider_submitted_at",
  "provider_expires_at",
  "provider_webhook_id_hash",
  "provider_webhook_received_at",
  "semantic_retry_attempts",
  "prior_provider_response_id",
  "prior_provider_submitted_at",
  "prior_provider_expires_at",
  "hybrid_planner_requested",
  "planner_contract_version",
  "planner_input_hash"
].join(",");

const TENANT_ANALYSIS_JOB_SELECT = [
  "id",
  "status",
  "action",
  "repository_full_name",
  "pull_request_number",
  "head_sha",
  "save_report",
  "comment",
  "slack_summary",
  "attempts",
  "created_at",
  "updated_at",
  "run_after",
  "completed_at",
  "error_code",
  "error_summary",
  "result_summary"
].join(",");

const FRESHNESS_ANALYSIS_JOB_SELECT = ["status", "head_sha", "created_at"].join(",");

const FORBIDDEN_JOB_KEYS = [
  "access_token",
  "authorization",
  "body",
  "claims",
  "comment_body",
  "diff",
  "evidence_index",
  "evidenceindex",
  "github_token",
  "installation_token",
  "log",
  "logs",
  "payload",
  "patch",
  "private_key",
  "raw",
  "raw_body",
  "raw_diff",
  "raw_log",
  "raw_payload",
  "report",
  "reprompt",
  "secret",
  "comment_url",
  "saved_report_url",
  "signature",
  "token",
  "webhook_payload"
];

export class AnalysisJobQueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisJobQueueError";
  }
}

export class AnalysisJobPrivacyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisJobPrivacyError";
  }
}

export async function enqueueAnalysisJob(
  input: EnqueueAnalysisJobInput,
  env = process.env
): Promise<AnalysisJobEnqueueResult> {
  if (!analysisJobQueueEnabled(env)) {
    throw new AnalysisJobQueueError("Analysis job queue is not enabled.");
  }

  const row = toAnalysisJobRow(input);
  assertAnalysisJobIsPrivate(row);
  await assertTenantDeletionNotActiveAsync({ tenantId: row.tenant_id }, env);
  await assertTenantRepositoryGrantAllowsEnqueue(row, env);
  const config = getAnalysisJobStoreConfig(env);

  if (config) {
    const durableRow = await enqueueOrRefreshSupabaseAnalysisJob(config, row);
    return {
      id: durableRow.id,
      status: "queued",
      store: "supabase",
      durable: true
    };
  }

  if (!truthy(env.AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY)) {
    throw new AnalysisJobQueueError("Analysis job durable store is not configured.");
  }

  const memoryRow = enqueueOrRefreshMemoryAnalysisJob(row);
  return {
    id: memoryRow.id,
    status: "queued",
    store: "memory",
    durable: false
  };
}

export async function fenceAnalysisJobRevision(
  input: FenceAnalysisJobRevisionInput,
  env = process.env
): Promise<boolean> {
  if (!analysisJobQueueEnabled(env)) {
    throw new AnalysisJobQueueError("Analysis job queue is not enabled.");
  }

  const claimGeneration = safeClaimGeneration(input.claimGeneration);
  const runningRevision = safeRevision(input.runningRevision);
  if (!safeAnalysisJobId(input.id) || !claimGeneration || !runningRevision) {
    throw new AnalysisJobQueueError("Analysis job revision fence is invalid.");
  }

  const now = input.now ?? new Date();
  const config = getAnalysisJobStoreConfig(env);
  if (config) {
    return fenceSupabaseAnalysisJobRevision(config, {
      id: input.id,
      claimGeneration,
      runningRevision,
      now
    });
  }

  if (!truthy(env.AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY)) {
    throw new AnalysisJobQueueError("Analysis job durable store is not configured.");
  }

  const row = analysisJobStore().find((job) =>
    job.id === input.id &&
    job.is_historical !== true &&
    job.status === "processing" &&
    job.claim_generation === claimGeneration &&
    job.running_revision === runningRevision
  );
  if (!row) return false;
  if (row.sealed_revision === runningRevision) return true;
  if ((row.desired_revision ?? 1) === runningRevision) return true;

  Object.assign(row, {
    status: "queued" as const,
    attempts: 0,
    updated_at: now.toISOString(),
    locked_at: null,
    completed_at: null,
    error_code: null,
    error_summary: null,
    result_summary: null,
    claim_generation: null,
    running_revision: null,
    sealed_revision: null,
    publication_sealed_at: null,
    ...clearedSealedPublicationPlan(),
    ...clearedProviderContinuation(),
    ...clearedHybridPlannerBinding()
  });
  assertAnalysisJobIsPrivate(row);
  return false;
}

export async function sealAnalysisJobRevision(
  input: SealAnalysisJobRevisionInput,
  env = process.env
): Promise<boolean> {
  if (!analysisJobQueueEnabled(env)) {
    throw new AnalysisJobQueueError("Analysis job queue is not enabled.");
  }
  const claimGeneration = safeClaimGeneration(input.claimGeneration);
  const runningRevision = safeRevision(input.runningRevision);
  if (!safeAnalysisJobId(input.id) || !claimGeneration || !runningRevision) {
    throw new AnalysisJobQueueError("Analysis job publication seal is invalid.");
  }
  const now = input.now ?? new Date();
  const config = getAnalysisJobStoreConfig(env);
  if (config) {
    return sealSupabaseAnalysisJobRevision(config, {
      id: input.id,
      claimGeneration,
      runningRevision,
      now
    });
  }
  if (!truthy(env.AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY)) {
    throw new AnalysisJobQueueError("Analysis job durable store is not configured.");
  }
  const row = analysisJobStore().find((job) =>
    job.id === input.id && job.status === "processing" &&
    job.is_historical !== true &&
    job.claim_generation === claimGeneration && job.running_revision === runningRevision
  );
  if (!row) return false;
  if (row.sealed_revision === runningRevision) return true;
  if (row.sealed_revision != null || (row.desired_revision ?? 1) !== runningRevision) {
    if (row.sealed_revision == null) requeueMemoryAnalysisJobRevision(row, now);
    return false;
  }
  row.sealed_revision = runningRevision;
  row.publication_sealed_at = now.toISOString();
  Object.assign(row, sealedPublicationPlan(row));
  row.updated_at = now.toISOString();
  row.locked_at = now.toISOString();
  assertAnalysisJobIsPrivate(row);
  return true;
}

export async function claimNextAnalysisJob(
  options: AnalysisJobClaimOptions = {},
  env = process.env
): Promise<AnalysisJobClaimResult> {
  if (!analysisJobQueueEnabled(env)) {
    throw new AnalysisJobQueueError("Analysis job queue is not enabled.");
  }

  const config = getAnalysisJobStoreConfig(env);
  const now = options.now ?? new Date();
  const leaseMs = safeDurationMs(options.leaseMs, DEFAULT_ANALYSIS_JOB_LEASE_MS);

  if (config) {
    const job = await claimSupabaseAnalysisJob(config, now, leaseMs);
    return {
      job,
      store: "supabase",
      durable: true
    };
  }

  if (!truthy(env.AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY)) {
    throw new AnalysisJobQueueError("Analysis job durable store is not configured.");
  }

  const job = claimMemoryAnalysisJob(now, leaseMs);
  return {
    job,
    store: "memory",
    durable: false
  };
}

export async function claimAnalysisJobById(
  jobId: string,
  options: AnalysisJobClaimOptions = {},
  env = process.env
): Promise<AnalysisJobClaimResult> {
  if (!analysisJobQueueEnabled(env)) {
    throw new AnalysisJobQueueError("Analysis job queue is not enabled.");
  }

  const normalizedJobId = safeAnalysisJobId(jobId);
  if (!normalizedJobId) {
    throw new AnalysisJobQueueError("Analysis job id is invalid.");
  }

  const config = getAnalysisJobStoreConfig(env);
  const now = options.now ?? new Date();

  if (config) {
    const job = await claimSupabaseAnalysisJobById(config, normalizedJobId, now);
    return {
      job,
      store: "supabase",
      durable: true
    };
  }

  if (!truthy(env.AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY)) {
    throw new AnalysisJobQueueError("Analysis job durable store is not configured.");
  }

  return {
    job: claimMemoryAnalysisJobById(normalizedJobId, now),
    store: "memory",
    durable: false
  };
}

export async function claimAnalysisJobForProviderResponse(
  responseId: string,
  options: AnalysisJobProviderResponseClaimOptions,
  env = process.env
): Promise<AnalysisJobProviderResponseClaimResult> {
  if (!analysisJobQueueEnabled(env)) {
    throw new AnalysisJobQueueError("Analysis job queue is not enabled.");
  }

  const normalizedResponseId = safeProviderResponseId(responseId);
  if (!normalizedResponseId) {
    throw new AnalysisJobQueueError("Analysis job provider response id is invalid.");
  }
  const webhookId = safeOpenAIWebhookId(options.webhookId);
  if (!webhookId) {
    throw new AnalysisJobQueueError("OpenAI webhook id is invalid.");
  }
  const webhookIdHash = hashJobKey(webhookId);

  const config = getAnalysisJobStoreConfig(env);
  const now = options.now ?? new Date();
  const leaseMs = safeDurationMs(options.leaseMs, DEFAULT_ANALYSIS_JOB_LEASE_MS);

  if (config) {
    const result = await claimSupabaseAnalysisJobForProviderResponse(
      config,
      normalizedResponseId,
      webhookIdHash,
      now,
      leaseMs
    );
    return {
      ...result,
      store: "supabase",
      durable: true
    };
  }

  if (!truthy(env.AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY)) {
    throw new AnalysisJobQueueError("Analysis job durable store is not configured.");
  }

  const result = claimMemoryAnalysisJobForProviderResponse(normalizedResponseId, webhookIdHash, now, leaseMs);
  return {
    ...result,
    store: "memory",
    durable: false
  };
}

export async function completeAnalysisJob(
  input: CompleteAnalysisJobInput,
  env = process.env
): Promise<boolean> {
  if (!analysisJobQueueEnabled(env)) {
    throw new AnalysisJobQueueError("Analysis job queue is not enabled.");
  }
  const claimGeneration = safeClaimGeneration(input.claimGeneration);
  if (input.claimGeneration && !claimGeneration) {
    throw new AnalysisJobQueueError("Analysis job completion claim is invalid.");
  }

  const config = getAnalysisJobStoreConfig(env);
  const now = input.now ?? new Date();
  const resultSummary = input.resultSummary ? sanitizeAnalysisJobResultSummary(input.resultSummary) : null;
  const update = {
    status: "completed" as const,
    updated_at: now.toISOString(),
    completed_at: now.toISOString(),
    locked_at: null,
    error_code: null,
    error_summary: null,
    result_summary: resultSummary,
    claim_generation: null,
    running_revision: null,
    sealed_revision: null,
    publication_sealed_at: null,
    ...clearedSealedPublicationPlan(),
    ...clearedProviderContinuation()
  };

  assertAnalysisJobIsPrivate(update);

  if (config) {
    if (!claimGeneration) throw new AnalysisJobQueueError("Analysis job completion claim is invalid.");
    return completeSupabaseAnalysisJob(config, { ...input, claimGeneration }, resultSummary, now);
  }

  if (!truthy(env.AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY)) {
    throw new AnalysisJobQueueError("Analysis job durable store is not configured.");
  }

  const row = analysisJobStore().find((job) =>
    job.id === input.id && job.status === "processing" &&
    job.is_historical !== true &&
    (!claimGeneration || job.claim_generation === claimGeneration)
  );
  if (!row || !row.running_revision) return false;
  const sealed = row.sealed_revision === row.running_revision;
  if ((row.desired_revision ?? 1) !== row.running_revision) {
    if (sealed) {
      requeueMemoryAnalysisJobRevision(row, now);
      return true;
    }
    requeueMemoryAnalysisJobRevision(row, now);
    return false;
  }
  if (row.sealed_revision != null && !sealed) return false;
  Object.assign(row, update);
  assertAnalysisJobIsPrivate(row);
  return true;
}

export async function fenceAnalysisJobSemanticRetryFinalization(
  input: FenceAnalysisJobSemanticRetryFinalizationInput,
  env = process.env
): Promise<AnalysisJobRow | null> {
  if (!analysisJobQueueEnabled(env)) {
    throw new AnalysisJobQueueError("Analysis job queue is not enabled.");
  }

  const claimGeneration = safeClaimGeneration(input.claimGeneration);
  if (!claimGeneration) {
    throw new AnalysisJobQueueError("Analysis job finalization fence is invalid.");
  }

  const now = input.now ?? new Date();
  const config = getAnalysisJobStoreConfig(env);
  if (config) {
    const row = await getSupabaseAnalysisJobById(config, input.id);
    if (!canFenceAnalysisJobSemanticRetryFinalization(row, claimGeneration)) return null;
    return patchSupabaseAnalysisJob(config, input.id, analysisJobSemanticRetryFinalizationFenceUpdate(now), {
      currentStatus: "processing",
      currentUpdatedAt: row.updated_at,
      currentClaimGeneration: claimGeneration,
      currentDesiredRevision: row.desired_revision,
      currentRunningRevision: row.running_revision,
      requireUnsealed: true
    });
  }

  if (!truthy(env.AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY)) {
    throw new AnalysisJobQueueError("Analysis job durable store is not configured.");
  }

  const row = analysisJobStore().find((job) => job.id === input.id && job.is_historical !== true);
  if (!canFenceAnalysisJobSemanticRetryFinalization(row, claimGeneration)) return null;
  Object.assign(row, analysisJobSemanticRetryFinalizationFenceUpdate(now));
  assertAnalysisJobIsPrivate(row);
  return { ...row };
}

export async function markAnalysisJobProviderSubmission(
  input: MarkAnalysisJobProviderSubmissionInput,
  env = process.env
): Promise<AnalysisJobRow | null> {
  if (!analysisJobQueueEnabled(env)) {
    throw new AnalysisJobQueueError("Analysis job queue is not enabled.");
  }

  const claimGeneration = safeClaimGeneration(input.claimGeneration);
  const submittedAt = validDate(input.submittedAt);
  const expiresAt = validDate(input.expiresAt);
  if (
    !claimGeneration ||
    !submittedAt ||
    !expiresAt ||
    expiresAt.getTime() <= submittedAt.getTime() ||
    expiresAt.getTime() - submittedAt.getTime() > MAX_PROVIDER_CONTINUATION_MS
  ) {
    throw new AnalysisJobQueueError("Analysis job provider submission marker is invalid.");
  }

  const now = input.now ?? new Date();
  const update = {
    updated_at: now.toISOString(),
    provider_response_id: null,
    provider_status: "submitting" as const,
    provider_poll_attempts: 0,
    provider_submitted_at: submittedAt.toISOString(),
    provider_expires_at: expiresAt.toISOString()
  };
  const config = getAnalysisJobStoreConfig(env);
  if (config) {
    const row = await getSupabaseAnalysisJobById(config, input.id);
    if (!row || !isUnsealedCurrentRevision(row, claimGeneration) || hasInvalidHybridPlannerBinding(row)) return null;
    return patchSupabaseAnalysisJob(config, input.id, update, {
      currentStatus: "processing",
      currentUpdatedAt: row.updated_at,
      currentClaimGeneration: claimGeneration,
      currentDesiredRevision: row.desired_revision,
      currentRunningRevision: row.running_revision,
      requireUnsealed: true
    });
  }

  if (!truthy(env.AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY)) {
    throw new AnalysisJobQueueError("Analysis job durable store is not configured.");
  }

  const row = analysisJobStore().find((job) =>
    job.id === input.id && isUnsealedCurrentRevision(job, claimGeneration)
  );
  if (!row || hasInvalidHybridPlannerBinding(row)) return null;
  Object.assign(row, update);
  assertAnalysisJobIsPrivate(row);
  return { ...row };
}

export async function bindAnalysisJobPlannerSeed(
  input: BindAnalysisJobPlannerSeedInput,
  env = process.env
): Promise<AnalysisJobRow | null> {
  if (!analysisJobQueueEnabled(env)) throw new AnalysisJobQueueError("Analysis job queue is not enabled.");
  const claimGeneration = safeClaimGeneration(input.claimGeneration);
  const binding = safeHybridPlannerBinding(input.contractVersion, input.inputHash);
  if (!safeAnalysisJobId(input.id) || !claimGeneration || !binding) {
    throw new AnalysisJobQueueError("Analysis job planner seed binding is invalid.");
  }
  const now = input.now ?? new Date();
  const update = {
    updated_at: now.toISOString(),
    planner_contract_version: binding.contractVersion,
    planner_input_hash: binding.inputHash
  };
  assertAnalysisJobIsPrivate(update);
  const config = getAnalysisJobStoreConfig(env);
  if (config) {
    const row = await getSupabaseAnalysisJobById(config, input.id);
    if (!row || !isUnsealedCurrentRevision(row, claimGeneration) || !canBindHybridPlannerSeed(row, binding)) return null;
    if (hasExactHybridPlannerBinding(row, binding)) return { ...row };
    return patchSupabaseAnalysisJob(config, input.id, update, {
      currentStatus: "processing",
      currentUpdatedAt: row.updated_at,
      currentClaimGeneration: claimGeneration,
      currentDesiredRevision: row.desired_revision,
      currentRunningRevision: row.running_revision,
      requireUnsealed: true,
      requireNoProviderContinuation: true,
      requireEmptyHybridPlannerBinding: true
    });
  }
  if (!truthy(env.AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY)) {
    throw new AnalysisJobQueueError("Analysis job durable store is not configured.");
  }
  const row = analysisJobStore().find((job) => job.id === input.id && isUnsealedCurrentRevision(job, claimGeneration));
  if (!row || !canBindHybridPlannerSeed(row, binding)) return null;
  if (hasExactHybridPlannerBinding(row, binding)) return { ...row };
  Object.assign(row, update);
  assertAnalysisJobIsPrivate(row);
  return { ...row };
}

/**
 * Pure transport guard for Task 5. It makes no provider or storage call: a
 * caller must obtain `ready` before its sole submit/retrieve boundary.
 */
export function resolveHybridPlannerJobBinding(
  job: Pick<AnalysisJobRow,
    "status" | "desired_revision" | "running_revision" |
    "hybrid_planner_requested" | "planner_contract_version" | "planner_input_hash" |
    "provider_response_id" | "provider_status" | "provider_poll_attempts" |
    "provider_submitted_at" | "provider_expires_at" | "provider_webhook_id_hash" |
    "provider_webhook_received_at" | "semantic_retry_attempts" |
    "prior_provider_response_id" | "prior_provider_submitted_at" | "prior_provider_expires_at">,
  input: { phase: "submit" | "response"; rebuiltInputHash: unknown; responseInputHash?: unknown }
): HybridPlannerJobBindingResolution {
  if (!hasCurrentAnalysisJobRevision(job)) return { disposition: "fallback" };
  const state = hybridPlannerBindingState(job);
  if (!Object.hasOwn(job, "hybrid_planner_requested") || typeof job.hybrid_planner_requested !== "boolean") {
    return { disposition: "fallback" };
  }
  if (job.hybrid_planner_requested === false) {
    return state.kind === "legacy" && !hasProviderContinuation(job)
      ? { disposition: "legacy" }
      : { disposition: "fallback" };
  }
  if (state.kind === "legacy") {
    return { disposition: "fallback" };
  }
  if (state.kind !== "bound" || typeof input.rebuiltInputHash !== "string" || state.binding.inputHash !== input.rebuiltInputHash) {
    return { disposition: "fallback" };
  }
  if (input.phase === "response" && input.responseInputHash !== state.binding.inputHash) {
    return { disposition: "fallback" };
  }
  return { disposition: "ready", inputHash: state.binding.inputHash };
}

export async function markAnalysisJobSemanticRetrySubmission(
  input: MarkAnalysisJobSemanticRetrySubmissionInput,
  env = process.env
): Promise<AnalysisJobRow | null> {
  if (!analysisJobQueueEnabled(env)) {
    throw new AnalysisJobQueueError("Analysis job queue is not enabled.");
  }

  const transition = semanticRetryTransitionFromInput(input);
  const now = input.now ?? new Date();
  const config = getAnalysisJobStoreConfig(env);
  if (config) {
    const row = await getSupabaseAnalysisJobById(config, input.id);
    if (!row || !isUnsealedCurrentRevision(row, transition.claim_generation) ||
        !canStartSemanticRetry(row, transition, input.claimGeneration)) return null;
    return patchSupabaseAnalysisJob(config, input.id, semanticRetrySubmissionUpdate(transition, now), {
      currentStatus: "processing",
      currentUpdatedAt: row.updated_at,
      currentClaimGeneration: transition.claim_generation,
      currentDesiredRevision: row.desired_revision,
      currentRunningRevision: row.running_revision,
      requireUnsealed: true
    });
  }

  if (!truthy(env.AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY)) {
    throw new AnalysisJobQueueError("Analysis job durable store is not configured.");
  }

  const row = analysisJobStore().find((job) => job.id === input.id && job.is_historical !== true);
  if (!row || !isUnsealedCurrentRevision(row, transition.claim_generation) ||
      !canStartSemanticRetry(row, transition, input.claimGeneration)) return null;
  Object.assign(row, semanticRetrySubmissionUpdate(transition, now));
  assertAnalysisJobIsPrivate(row);
  return { ...row };
}

export async function parkAnalysisJobForProvider(
  input: ParkAnalysisJobForProviderInput,
  env = process.env
): Promise<boolean> {
  if (!analysisJobQueueEnabled(env)) {
    throw new AnalysisJobQueueError("Analysis job queue is not enabled.");
  }

  const continuation = providerContinuationFromInput(input);
  const config = getAnalysisJobStoreConfig(env);
  const now = input.now ?? new Date();

  if (config) {
    const row = await getSupabaseAnalysisJobById(config, input.id);
    if (!row || !isUnsealedCurrentRevision(row, input.claimGeneration)) return false;
    const update = {
      status: "queued" as const,
      attempts: Math.max(0, (row.attempts ?? 1) - 1),
      updated_at: now.toISOString(),
      run_after: continuation.run_after,
      locked_at: null,
      completed_at: null,
      error_code: null,
      error_summary: null,
      result_summary: null,
      claim_generation: null,
      running_revision: null,
      sealed_revision: null,
      publication_sealed_at: null,
      ...clearedSealedPublicationPlan(),
      provider_response_id: continuation.provider_response_id,
      provider_status: continuation.provider_status,
      provider_poll_attempts: Math.min(100, Math.max(0, row.provider_poll_attempts ?? 0) + 1),
      provider_submitted_at: continuation.provider_submitted_at,
      provider_expires_at: continuation.provider_expires_at
    };
    assertAnalysisJobIsPrivate(update);
    return Boolean(await patchSupabaseAnalysisJob(config, input.id, update, {
      currentStatus: "processing",
      currentUpdatedAt: row.updated_at,
      currentClaimGeneration: input.claimGeneration,
      currentDesiredRevision: row.desired_revision,
      currentRunningRevision: row.running_revision,
      requireUnsealed: true
    }));
  }

  if (!truthy(env.AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY)) {
    throw new AnalysisJobQueueError("Analysis job durable store is not configured.");
  }

  const row = analysisJobStore().find((job) =>
    job.id === input.id && isUnsealedCurrentRevision(job, input.claimGeneration)
  );
  if (!row) return false;
  const update = {
    status: "queued" as const,
    attempts: Math.max(0, (row.attempts ?? 1) - 1),
    updated_at: now.toISOString(),
    run_after: continuation.run_after,
    locked_at: null,
    completed_at: null,
    error_code: null,
    error_summary: null,
    result_summary: null,
    claim_generation: null,
    running_revision: null,
    sealed_revision: null,
    publication_sealed_at: null,
    ...clearedSealedPublicationPlan(),
    provider_response_id: continuation.provider_response_id,
    provider_status: continuation.provider_status,
    provider_poll_attempts: Math.min(100, Math.max(0, row.provider_poll_attempts ?? 0) + 1),
    provider_submitted_at: continuation.provider_submitted_at,
    provider_expires_at: continuation.provider_expires_at
  };
  return updateMemoryAnalysisJob(input.id, "processing", update, input.claimGeneration);
}

export async function failAnalysisJob(
  input: FailAnalysisJobInput,
  env = process.env
): Promise<boolean> {
  if (!analysisJobQueueEnabled(env)) {
    throw new AnalysisJobQueueError("Analysis job queue is not enabled.");
  }
  const claimGeneration = safeClaimGeneration(input.claimGeneration);
  if (input.claimGeneration && !claimGeneration) {
    throw new AnalysisJobQueueError("Analysis job failure claim is invalid.");
  }

  const config = getAnalysisJobStoreConfig(env);
  const now = input.now ?? new Date();
  const retryAfterMs = safeDurationMs(input.retryAfterMs, DEFAULT_ANALYSIS_JOB_RETRY_AFTER_MS);
  const maxAttempts = Math.max(1, Math.min(20, input.maxAttempts ?? DEFAULT_ANALYSIS_JOB_MAX_ATTEMPTS));

  if (config) {
    if (!claimGeneration) throw new AnalysisJobQueueError("Analysis job failure claim is invalid.");
    return failSupabaseAnalysisJob(config, { ...input, claimGeneration }, now, retryAfterMs, maxAttempts);
  }

  if (!truthy(env.AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY)) {
    throw new AnalysisJobQueueError("Analysis job durable store is not configured.");
  }

  const row = analysisJobStore().find((job) =>
    job.id === input.id && job.is_historical !== true
  );
  if (!row || row.status !== "processing" || !row.running_revision ||
      (claimGeneration && row.claim_generation !== claimGeneration)) return false;

  const sealed = row.sealed_revision === row.running_revision;
  if ((row.desired_revision ?? 1) !== row.running_revision) {
    requeueMemoryAnalysisJobRevision(row, now);
    return sealed;
  }
  if (row.sealed_revision != null && !sealed) return false;

  const update = toAnalysisJobFailureUpdate(input, row.attempts, maxAttempts, now, retryAfterMs);
  Object.assign(row, update);
  assertAnalysisJobIsPrivate(row);
  return true;
}

export async function listTenantAnalysisJobs(
  input: { tenantId?: unknown; limit?: number; statuses?: AnalysisJobStatus[] },
  env = process.env
): Promise<TenantAnalysisJobSummary[]> {
  const tenantId = typeof input.tenantId === "string" ? safeTenantId(input.tenantId) : null;
  if (!tenantId) {
    throw new AnalysisJobQueueError("Analysis job tenant id is invalid.");
  }

  const limit = normalizeAnalysisJobListLimit(input.limit);
  const statuses = normalizeAnalysisJobStatuses(input.statuses);
  const status = getAnalysisJobQueueStatus(env);
  if (!status.enabled) return [];

  const config = getAnalysisJobStoreConfig(env);
  const rows = config
    ? await listSupabaseTenantAnalysisJobs(config, tenantId, limit, statuses)
    : listMemoryTenantAnalysisJobs(tenantId, limit, statuses);

  return rows.map(toTenantAnalysisJobSummary);
}

/**
 * Resolves a saved report against the newest canonical job for exactly one
 * tenant/repository/PR. The result deliberately contains no job identifier,
 * provider metadata, or newer head SHA.
 */
export async function resolveAnalysisJobFreshness(
  input: ResolveAnalysisJobFreshnessInput,
  env = process.env
): Promise<AnalysisJobFreshness> {
  const tenantId = typeof input.tenantId === "string" ? safeTenantId(input.tenantId) : null;
  const repositoryId = typeof input.repositoryId === "number" ? safePositiveInteger(input.repositoryId) : null;
  const pullRequestNumber = typeof input.pullRequestNumber === "number" ? safePositiveInteger(input.pullRequestNumber) : null;
  const reportHeadSha = typeof input.reportHeadSha === "string" ? safeHeadSha(input.reportHeadSha) : null;
  if (!tenantId || !repositoryId || !pullRequestNumber || !reportHeadSha) {
    throw new AnalysisJobQueueError("Analysis job freshness lookup is invalid.");
  }

  const legacy = typeof input.staleAt === "string" && input.staleAt ? "stale" as const : "current" as const;
  if (!analysisJobQueueEnabled(env)) return { freshness: legacy, copyEligible: legacy === "current" };

  const config = getAnalysisJobStoreConfig(env);
  const lookup = config
    ? await getSupabaseLatestAnalysisJobForFreshness(config, { tenantId, repositoryId, pullRequestNumber })
    : getMemoryLatestAnalysisJobForFreshness({ tenantId, repositoryId, pullRequestNumber });
  if (lookup.ambiguous) return { freshness: "unknown", copyEligible: false };
  const latest = lookup.latest;

  if (!latest) return { freshness: legacy, copyEligible: legacy === "current" };
  if (latest.status === "queued" || latest.status === "processing") return { freshness: "refreshing", copyEligible: false };
  if (latest.status === "failed_retryable" || latest.status === "failed_terminal") return { freshness: "refresh_failed", copyEligible: false };
  if (latest.status !== "completed") return { freshness: "unknown", copyEligible: false };
  return latest.head_sha === reportHeadSha
    ? { freshness: "current", copyEligible: true }
    : { freshness: "superseded", copyEligible: false };
}

export async function countTenantAnalysisJobs(
  input: { tenantId?: unknown },
  env = process.env
): Promise<TenantAnalysisJobCount> {
  const tenantId = typeof input.tenantId === "string" ? safeTenantId(input.tenantId) : null;
  if (!tenantId) {
    throw new AnalysisJobQueueError("Analysis job tenant id is invalid.");
  }

  const status = getAnalysisJobQueueStatus(env);
  if (!status.enabled) {
    return {
      count: 0,
      store: "none",
      durable: false,
      configured: false,
      disabled: true
    };
  }

  if (!status.configured) {
    throw new AnalysisJobQueueError("Analysis job durable store is not configured.");
  }

  const config = getAnalysisJobStoreConfig(env);
  if (config) {
    return {
      count: await countSupabaseTenantAnalysisJobs(config, tenantId),
      store: "supabase",
      durable: true,
      configured: true
    };
  }

  return {
    count: countMemoryTenantAnalysisJobs(tenantId),
    store: "memory",
    durable: false,
    configured: true
  };
}

export async function countTenantActiveAnalysisJobsForDeletion(
  input: { tenantId?: unknown },
  env = process.env
): Promise<TenantActiveAnalysisJobDeletionCount> {
  const tenantId = typeof input.tenantId === "string" ? safeTenantId(input.tenantId) : null;
  if (!tenantId) {
    throw new AnalysisJobQueueError("Analysis job tenant id is invalid.");
  }

  const status = getAnalysisJobQueueStatus(env);
  if (!status.enabled) {
    return {
      privacy: "analysis-job-active-deletion-count-metadata-only",
      count: 0,
      statusCounts: {
        queued: 0,
        processing: 0,
        failed_retryable: 0
      },
      disabled: true
    };
  }

  if (!status.configured) {
    throw new AnalysisJobQueueError("Analysis job durable store is not configured.");
  }

  const config = getAnalysisJobStoreConfig(env);
  const statusCounts = config
    ? await countSupabaseTenantActiveAnalysisJobsByStatus(config, tenantId)
    : countMemoryTenantActiveAnalysisJobsByStatus(tenantId);

  return {
    privacy: "analysis-job-active-deletion-count-metadata-only",
    count: statusCounts.queued + statusCounts.processing + statusCounts.failed_retryable,
    statusCounts
  };
}

export async function purgeTenantAnalysisJobsForDeletion(
  input: { tenantId?: unknown },
  env = process.env
): Promise<TenantAnalysisJobPurgeResult> {
  const tenantId = typeof input.tenantId === "string" ? safeTenantId(input.tenantId) : null;
  if (!tenantId) {
    throw new AnalysisJobQueueError("Analysis job tenant id is invalid.");
  }

  const status = getAnalysisJobQueueStatus(env);
  if (!status.enabled) {
    return {
      privacy: "analysis-job-tenant-purge-metadata-only",
      deletedCount: 0,
      countBasis: "disabled-store-count",
      store: "none",
      durable: false,
      configured: false,
      disabled: true
    };
  }

  if (!status.configured) {
    throw new AnalysisJobQueueError("Analysis job durable store is not configured.");
  }

  const config = getAnalysisJobStoreConfig(env);
  if (config) {
    return {
      privacy: "analysis-job-tenant-purge-metadata-only",
      deletedCount: await purgeSupabaseTenantAnalysisJobs(config, tenantId),
      countBasis: "pre-delete-supabase-count",
      store: "supabase",
      durable: true,
      configured: true
    };
  }

  return {
    privacy: "analysis-job-tenant-purge-metadata-only",
    deletedCount: purgeMemoryTenantAnalysisJobs(tenantId),
    countBasis: "exact-memory-delete-count",
    store: "memory",
    durable: false,
    configured: true
  };
}

export async function getTenantAnalysisJobRollup(
  input: { tenantId?: unknown; limit?: number },
  env = process.env
): Promise<TenantAnalysisJobRollupSummary> {
  const tenantId = typeof input.tenantId === "string" ? safeTenantId(input.tenantId) : null;
  if (!tenantId) {
    throw new AnalysisJobQueueError("Analysis job tenant id is invalid.");
  }

  const limit = normalizeTenantAnalysisJobRollupLimit(input.limit);
  const status = getAnalysisJobQueueStatus(env);
  if (!status.enabled) return summarizeTenantAnalysisJobStatuses([], false);

  const config = getAnalysisJobStoreConfig(env);
  const rows = config
    ? await listSupabaseTenantAnalysisJobStatusRows(config, tenantId, limit + 1)
    : listMemoryTenantAnalysisJobStatusRows(tenantId, limit + 1);

  return summarizeTenantAnalysisJobStatuses(rows.slice(0, limit), rows.length > limit);
}

export async function getAnalysisJobQueueSummary(
  input: { now?: Date; staleAfterMs?: number; limit?: number } = {},
  env = process.env
): Promise<AnalysisJobQueueSummary | null> {
  const status = getAnalysisJobQueueStatus(env);
  if (!status.enabled || !status.configured) return null;

  const now = input.now ?? new Date();
  const staleAfterMs = safeDurationMs(input.staleAfterMs, DEFAULT_ANALYSIS_JOB_LEASE_MS);
  const limit = normalizeAnalysisJobQueueSummaryLimit(input.limit);
  const config = getAnalysisJobStoreConfig(env);
  const rows = config
    ? await listSupabaseAnalysisJobSummaryRows(config, limit)
    : listMemoryAnalysisJobSummaryRows(limit);

  return summarizeAnalysisJobQueue(rows, {
    now,
    staleAfterMs,
    truncated: rows.length >= limit
  });
}

export async function getAnalysisJobDeadLetterSummary(
  input: { now?: Date; limit?: number } = {},
  env = process.env
): Promise<AnalysisJobDeadLetterSummary | null> {
  const status = getAnalysisJobQueueStatus(env);
  if (!status.enabled || !status.configured) return null;

  const now = input.now ?? new Date();
  const limit = normalizeAnalysisJobDeadLetterSummaryLimit(input.limit);
  const config = getAnalysisJobStoreConfig(env);
  const rows = config
    ? await listSupabaseAnalysisJobDeadLetterRows(config, limit + 1)
    : listMemoryAnalysisJobDeadLetterRows(limit + 1);

  return summarizeAnalysisJobDeadLetter(rows.slice(0, limit), {
    now,
    truncated: rows.length > limit
  });
}

export function getAnalysisJobQueueStatus(env = process.env): AnalysisJobQueueStatus {
  const enabled = analysisJobQueueEnabled(env);
  const read = readAnalysisJobStoreEnv(env);
  const canonicalTableConfigured = read.table === DEFAULT_ANALYSIS_JOBS_TABLE;

  if (!enabled) {
    return {
      enabled: false,
      mode: "disabled",
      configured: false,
      durable: false,
      table: read.table,
      missingEnv: []
    };
  }

  if (read.url && read.serviceRoleKey && canonicalTableConfigured) {
    return {
      enabled: true,
      mode: "supabase",
      configured: true,
      durable: true,
      table: read.table,
      missingEnv: []
    };
  }

  const missingEnv: string[] = [];
  if (!canonicalTableConfigured) {
    missingEnv.push(`AGENTPROOF_ANALYSIS_JOBS_TABLE must be ${DEFAULT_ANALYSIS_JOBS_TABLE}`);
  }
  if (read.url || read.serviceRoleKey) {
    if (!read.url) missingEnv.push("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL or SUPABASE_URL");
    if (!read.serviceRoleKey) {
      missingEnv.push("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY");
    }
  }

  if (canonicalTableConfigured && truthy(env.AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY)) {
    return {
      enabled: true,
      mode: "memory",
      configured: true,
      durable: false,
      table: read.table,
      missingEnv
    };
  }

  if (missingEnv.length === 0) {
    missingEnv.push("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL or SUPABASE_URL");
    missingEnv.push("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY");
  }

  return {
    enabled: true,
    mode: "memory",
    configured: false,
    durable: false,
    table: read.table,
    missingEnv
  };
}

export function getAnalysisJobsForTests(): AnalysisJobRow[] {
  return [...analysisJobStore()];
}

export function clearAnalysisJobsForTests() {
  analysisJobStore().splice(0, analysisJobStore().length);
}

export function assertAnalysisJobIsPrivate(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (containsSecretPattern(serialized)) {
    throw new AnalysisJobPrivacyError("Analysis job contains a secret-like value.");
  }

  if (containsUnsafeJobString(value)) {
    throw new AnalysisJobPrivacyError("Analysis job contains an unsafe URL or query value.");
  }

  const unsafeKey = findForbiddenKey(value);
  if (unsafeKey) {
    throw new AnalysisJobPrivacyError(`Analysis job contains forbidden field ${unsafeKey}.`);
  }
}

// Preserve missing database columns as missing so the seed guard can fail
// closed; coercing them to null would incorrectly turn a malformed row into a
// legacy continuation.
function normalizeAnalysisJobRow(value: unknown): AnalysisJobRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = { ...(value as Record<string, unknown>) } as unknown as AnalysisJobRow;
  assertAnalysisJobIsPrivate(row);
  return row;
}

function toAnalysisJobRow(input: EnqueueAnalysisJobInput): AnalysisJobRow {
  const now = input.now ?? new Date();
  const repositoryFullName = safeRepositoryFullName(input.repositoryFullName);
  const pullRequestNumber = safePositiveInteger(input.pullRequestNumber);
  const pullRequestUrl = safeGitHubPullRequestUrl(input.pullRequestUrl, repositoryFullName, pullRequestNumber);
  const headSha = safeHeadSha(input.headSha);
  const installationId = safePositiveInteger(input.installationId);
  const idempotencyHash = hashJobKey(input.idempotencyKey);

  if (!repositoryFullName || !pullRequestNumber || !pullRequestUrl || !headSha || !installationId) {
    throw new AnalysisJobQueueError("Analysis job input is invalid.");
  }

  return {
    id: randomUUID(),
    status: "queued",
    tenant_id: safeTenantId(input.tenantId),
    idempotency_key_hash: idempotencyHash,
    delivery_id: safeGitHubDeliveryId(input.deliveryId),
    event: safeSlug(input.event) ?? "pull_request",
    action: safeSlug(input.action) ?? null,
    installation_id: installationId,
    repository_id: safePositiveInteger(input.repositoryId),
    repository_full_name: repositoryFullName,
    pull_request_number: pullRequestNumber,
    pull_request_url: pullRequestUrl,
    head_sha: headSha,
    canonical_key_hash: canonicalAnalysisJobKey({
      tenantId: safeTenantId(input.tenantId),
      installationId,
      repositoryId: safePositiveInteger(input.repositoryId),
      repositoryFullName,
      pullRequestNumber,
      headSha
    }),
    is_historical: false,
    desired_revision: 1,
    save_report: input.saveReport === true,
    comment: input.comment === true,
    slack_summary: input.slackSummary === true,
    attempts: 0,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    run_after: new Date(now.getTime() + DEFAULT_ANALYSIS_JOB_DEBOUNCE_MS).toISOString(),
    locked_at: null,
    completed_at: null,
    error_code: null,
    error_summary: null,
    result_summary: null,
    claim_generation: null,
    running_revision: null,
    sealed_revision: null,
    publication_sealed_at: null,
    ...clearedSealedPublicationPlan(),
    ...clearedProviderContinuation(),
    hybrid_planner_requested: input.hybridPlannerRequested === true,
    ...clearedHybridPlannerBinding()
  };
}

async function assertTenantRepositoryGrantAllowsEnqueue(row: AnalysisJobRow, env: NodeJS.ProcessEnv) {
  const decision = await authorizeTenantRepositoryGrantAsync({
    installationId: row.installation_id,
    repositoryId: row.repository_id ?? undefined,
    repositoryFullName: row.repository_full_name
  }, env);

  if (!decision.enabled || !decision.required) return;

  if (decision.reason || !decision.grant || !row.tenant_id || decision.grant.tenantId !== row.tenant_id) {
    throw new AnalysisJobQueueError("Analysis job tenant repository grant is not active.");
  }
}

async function enqueueOrRefreshSupabaseAnalysisJob(
  config: AnalysisJobStoreConfig,
  row: AnalysisJobRow
): Promise<Pick<AnalysisJobRow, "id" | "status">> {
  const response = await fetch(`${config.url}/rest/v1/rpc/agentproof_enqueue_analysis_job`, {
    method: "POST",
    cache: "no-store",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify({ job_payload: row })
  });

  if (!response.ok) {
    throw new AnalysisJobQueueError(`Analysis job store failed with HTTP ${response.status}.`);
  }

  const rows = await response.json().catch(() => []) as unknown;
  const durableRow = Array.isArray(rows) ? rows[0] : rows;
  if (!durableRow || typeof durableRow !== "object" || typeof (durableRow as { id?: unknown }).id !== "string") {
    throw new AnalysisJobQueueError("Analysis job store returned an invalid canonical row.");
  }
  assertAnalysisJobIsPrivate(durableRow);
  return durableRow as Pick<AnalysisJobRow, "id" | "status">;
}

function enqueueOrRefreshMemoryAnalysisJob(row: AnalysisJobRow): AnalysisJobRow {
  const existing = analysisJobStore().find((job) =>
    job.canonical_key_hash === row.canonical_key_hash && job.is_historical !== true
  );
  if (existing) {
    const processing = existing.status === "processing";
    Object.assign(existing, {
      tenant_id: row.tenant_id,
      idempotency_key_hash: row.idempotency_key_hash,
      delivery_id: row.delivery_id,
      event: row.event,
      action: row.action,
      installation_id: row.installation_id,
      repository_id: row.repository_id,
      repository_full_name: row.repository_full_name,
      pull_request_number: row.pull_request_number,
      pull_request_url: row.pull_request_url,
      head_sha: row.head_sha,
      save_report: row.save_report,
      comment: row.comment,
      slack_summary: row.slack_summary,
      hybrid_planner_requested: row.hybrid_planner_requested,
      desired_revision: (existing.desired_revision ?? 1) + 1,
      updated_at: row.updated_at,
      run_after: row.run_after,
      completed_at: null,
      error_code: null,
      error_summary: null,
      result_summary: null,
      ...(processing ? {
        ...clearedProviderContinuation(),
        ...clearedHybridPlannerBinding()
      } : {
        status: "queued" as const,
        attempts: 0,
        locked_at: null,
        claim_generation: null,
        running_revision: null,
        sealed_revision: null,
        publication_sealed_at: null,
        ...clearedSealedPublicationPlan(),
        ...clearedProviderContinuation(),
        ...clearedHybridPlannerBinding()
      })
    });
    assertAnalysisJobIsPrivate(existing);
    return { ...existing };
  }

  analysisJobStore().push(row);
  while (analysisJobStore().length > MAX_MEMORY_ANALYSIS_JOBS) {
    analysisJobStore().shift();
  }
  return { ...row };
}

async function fenceSupabaseAnalysisJobRevision(
  config: AnalysisJobStoreConfig,
  input: Required<Omit<FenceAnalysisJobRevisionInput, "now">> & { now: Date }
): Promise<boolean> {
  const response = await fetch(`${config.url}/rest/v1/rpc/agentproof_fence_analysis_job_revision`, {
    method: "POST",
    cache: "no-store",
    headers: {
      ...supabaseAnalysisJobHeaders(config),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      job_id: input.id,
      claim_token: input.claimGeneration,
      claim_revision: input.runningRevision,
      fence_time: input.now.toISOString()
    })
  });
  if (!response.ok) {
    throw new AnalysisJobQueueError(`Analysis job store failed with HTTP ${response.status}.`);
  }
  const rows = await response.json().catch(() => []) as unknown;
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return false;
  assertAnalysisJobIsPrivate(row);
  return true;
}

async function sealSupabaseAnalysisJobRevision(
  config: AnalysisJobStoreConfig,
  input: Required<Omit<SealAnalysisJobRevisionInput, "now">> & { now: Date }
): Promise<boolean> {
  const response = await fetch(`${config.url}/rest/v1/rpc/agentproof_seal_analysis_job_revision`, {
    method: "POST",
    cache: "no-store",
    headers: {
      ...supabaseAnalysisJobHeaders(config),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      job_id: input.id,
      claim_token: input.claimGeneration,
      claim_revision: input.runningRevision,
      seal_time: input.now.toISOString()
    })
  });
  if (!response.ok) throw new AnalysisJobQueueError(`Analysis job store failed with HTTP ${response.status}.`);
  const rows = await response.json().catch(() => []) as unknown;
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return false;
  assertAnalysisJobIsPrivate(row);
  return true;
}

async function completeSupabaseAnalysisJob(
  config: AnalysisJobStoreConfig,
  input: CompleteAnalysisJobInput,
  resultSummary: AnalysisJobResultSummary | null,
  now: Date
): Promise<boolean> {
  const response = await fetch(`${config.url}/rest/v1/rpc/agentproof_complete_analysis_job`, {
    method: "POST",
    cache: "no-store",
    headers: { ...supabaseAnalysisJobHeaders(config), "Content-Type": "application/json" },
    body: JSON.stringify({
      job_id: input.id,
      claim_token: input.claimGeneration ?? null,
      result_payload: resultSummary,
      finish_time: now.toISOString()
    })
  });
  if (!response.ok) throw new AnalysisJobQueueError(`Analysis job store failed with HTTP ${response.status}.`);
  const rows = await response.json().catch(() => []) as unknown;
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return false;
  assertAnalysisJobIsPrivate(row);
  return true;
}

async function failSupabaseAnalysisJob(
  config: AnalysisJobStoreConfig,
  input: FailAnalysisJobInput,
  now: Date,
  retryAfterMs: number,
  maxAttempts: number
): Promise<boolean> {
  const response = await fetch(`${config.url}/rest/v1/rpc/agentproof_fail_analysis_job`, {
    method: "POST",
    cache: "no-store",
    headers: { ...supabaseAnalysisJobHeaders(config), "Content-Type": "application/json" },
    body: JSON.stringify({
      job_id: input.id,
      claim_token: input.claimGeneration ?? null,
      retryable_failure: input.retryable,
      failure_code: safeJobErrorCode(input.code),
      failure_summary: safeJobErrorSummary(input.summary),
      fail_time: now.toISOString(),
      retry_after_ms: retryAfterMs,
      maximum_attempts: maxAttempts
    })
  });
  if (!response.ok) throw new AnalysisJobQueueError(`Analysis job store failed with HTTP ${response.status}.`);
  const rows = await response.json().catch(() => []) as unknown;
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return false;
  assertAnalysisJobIsPrivate(row);
  return true;
}

function requeueMemoryAnalysisJobRevision(row: AnalysisJobRow, now: Date): void {
  Object.assign(row, {
    status: "queued" as const,
    attempts: 0,
    updated_at: now.toISOString(),
    locked_at: null,
    completed_at: null,
    error_code: null,
    error_summary: null,
    result_summary: null,
    claim_generation: null,
    running_revision: null,
    sealed_revision: null,
    publication_sealed_at: null,
    ...clearedSealedPublicationPlan(),
    ...clearedProviderContinuation(),
    ...clearedHybridPlannerBinding()
  });
  assertAnalysisJobIsPrivate(row);
}

async function listSupabaseTenantAnalysisJobs(
  config: AnalysisJobStoreConfig,
  tenantId: string,
  limit: number,
  statuses: AnalysisJobStatus[]
): Promise<AnalysisJobRow[]> {
  const params = new URLSearchParams([
    ["tenant_id", `eq.${tenantId}`],
    ["select", TENANT_ANALYSIS_JOB_SELECT],
    ["order", "created_at.desc"],
    ["limit", String(limit)]
  ]);

  if (statuses.length === 1) {
    params.append("status", `eq.${statuses[0]}`);
  } else if (statuses.length > 1) {
    params.append("status", `in.(${statuses.join(",")})`);
  }

  const response = await fetch(`${config.url}/rest/v1/${encodeURIComponent(config.table)}?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
    headers: supabaseAnalysisJobHeaders(config)
  });

  if (!response.ok) {
    throw new AnalysisJobQueueError(`Analysis job store failed with HTTP ${response.status}.`);
  }

  const rows = await response.json().catch(() => []) as unknown;
  if (!Array.isArray(rows)) return [];

  return rows
    .filter((row): row is AnalysisJobRow => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    .slice(0, limit);
}

type FreshnessAnalysisJobRow = Pick<AnalysisJobRow, "status" | "head_sha" | "created_at">;

async function getSupabaseLatestAnalysisJobForFreshness(
  config: AnalysisJobStoreConfig,
  input: { tenantId: string; repositoryId: number; pullRequestNumber: number }
): Promise<FreshnessAnalysisJobLookup> {
  const params = new URLSearchParams([
    ["tenant_id", `eq.${input.tenantId}`],
    ["repository_id", `eq.${input.repositoryId}`],
    ["pull_request_number", `eq.${input.pullRequestNumber}`],
    ["is_historical", "eq.false"],
    ["select", FRESHNESS_ANALYSIS_JOB_SELECT],
    ["order", "created_at.desc"],
    ["limit", "2"]
  ]);
  const response = await fetch(`${config.url}/rest/v1/${encodeURIComponent(config.table)}?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
    headers: supabaseAnalysisJobHeaders(config)
  });

  if (!response.ok) throw new AnalysisJobQueueError(`Analysis job freshness lookup failed with HTTP ${response.status}.`);
  const rows = await response.json().catch(() => null) as unknown;
  if (!Array.isArray(rows) || rows.length === 0) return { latest: null, ambiguous: false };
  const candidates = rows.slice(0, 2);
  if (!candidates.every(isFreshnessAnalysisJobRow)) throw new AnalysisJobQueueError("Analysis job freshness lookup returned an incomplete row.");
  return freshnessAnalysisJobLookup(candidates);
}

function getMemoryLatestAnalysisJobForFreshness(
  input: { tenantId: string; repositoryId: number; pullRequestNumber: number }
): FreshnessAnalysisJobLookup {
  const rows = analysisJobStore()
    .filter((job) => job.is_historical !== true && job.tenant_id === input.tenantId &&
      job.repository_id === input.repositoryId && job.pull_request_number === input.pullRequestNumber)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, 2);
  if (rows.length === 0) return { latest: null, ambiguous: false };
  if (!rows.every(isFreshnessAnalysisJobRow)) throw new AnalysisJobQueueError("Analysis job freshness lookup returned an incomplete row.");
  return freshnessAnalysisJobLookup(rows);
}

interface FreshnessAnalysisJobLookup {
  latest: FreshnessAnalysisJobRow | null;
  ambiguous: boolean;
}

function freshnessAnalysisJobLookup(rows: FreshnessAnalysisJobRow[]): FreshnessAnalysisJobLookup {
  const latest = rows[0];
  const next = rows[1];
  if (!latest) return { latest: null, ambiguous: false };
  // UUIDv4 cannot establish chronological order. A same-millisecond second
  // head is therefore unsafe to treat as current, regardless of lexical ID.
  if (next && next.created_at === latest.created_at) return { latest: null, ambiguous: true };
  return { latest, ambiguous: false };
}

function isFreshnessAnalysisJobRow(value: unknown): value is FreshnessAnalysisJobRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<FreshnessAnalysisJobRow>;
  return safeAnalysisJobStatus(row.status) !== null &&
    typeof row.head_sha === "string" && safeHeadSha(row.head_sha) !== null &&
    typeof row.created_at === "string" && Number.isFinite(new Date(row.created_at).getTime());
}

async function countSupabaseTenantAnalysisJobs(
  config: AnalysisJobStoreConfig,
  tenantId: string
): Promise<number> {
  const params = new URLSearchParams({
    tenant_id: `eq.${tenantId}`,
    select: "id"
  });
  const response = await fetch(`${config.url}/rest/v1/${encodeURIComponent(config.table)}?${params.toString()}`, {
    method: "HEAD",
    cache: "no-store",
    headers: {
      ...supabaseAnalysisJobHeaders(config),
      Prefer: "count=exact",
      Range: "0-0"
    }
  });

  if (!response.ok) {
    throw new AnalysisJobQueueError(`Analysis job count failed with HTTP ${response.status}.`);
  }

  const count = countFromContentRange(response.headers.get("content-range"));
  if (count === null) {
    throw new AnalysisJobQueueError("Analysis job count returned an invalid range.");
  }

  return count;
}

async function countSupabaseTenantActiveAnalysisJobsByStatus(
  config: AnalysisJobStoreConfig,
  tenantId: string
): Promise<Pick<Record<AnalysisJobStatus, number>, "queued" | "processing" | "failed_retryable">> {
  const [queued, processing, failedRetryable] = await Promise.all([
    countSupabaseTenantAnalysisJobsByStatus(config, tenantId, "queued"),
    countSupabaseTenantAnalysisJobsByStatus(config, tenantId, "processing"),
    countSupabaseTenantAnalysisJobsByStatus(config, tenantId, "failed_retryable")
  ]);

  return {
    queued,
    processing,
    failed_retryable: failedRetryable
  };
}

async function countSupabaseTenantAnalysisJobsByStatus(
  config: AnalysisJobStoreConfig,
  tenantId: string,
  status: AnalysisJobStatus
): Promise<number> {
  const params = new URLSearchParams({
    tenant_id: `eq.${tenantId}`,
    status: `eq.${status}`,
    is_historical: "eq.false",
    select: "id"
  });
  const response = await fetch(`${config.url}/rest/v1/${encodeURIComponent(config.table)}?${params.toString()}`, {
    method: "HEAD",
    cache: "no-store",
    headers: {
      ...supabaseAnalysisJobHeaders(config),
      Prefer: "count=exact",
      Range: "0-0"
    }
  });

  if (!response.ok) {
    throw new AnalysisJobQueueError(`Analysis job active count failed with HTTP ${response.status}.`);
  }

  const count = countFromContentRange(response.headers.get("content-range"));
  if (count === null) {
    throw new AnalysisJobQueueError("Analysis job active count returned an invalid range.");
  }

  return count;
}

async function purgeSupabaseTenantAnalysisJobs(
  config: AnalysisJobStoreConfig,
  tenantId: string
): Promise<number> {
  const deletedCount = await countSupabaseTenantAnalysisJobs(config, tenantId);
  const params = new URLSearchParams({
    tenant_id: `eq.${tenantId}`
  });
  const response = await fetch(`${config.url}/rest/v1/${encodeURIComponent(config.table)}?${params.toString()}`, {
    method: "DELETE",
    cache: "no-store",
    headers: {
      ...supabaseAnalysisJobHeaders(config),
      Prefer: "return=minimal"
    }
  });

  if (!response.ok) {
    throw new AnalysisJobQueueError(`Analysis job tenant purge failed with HTTP ${response.status}.`);
  }

  return deletedCount;
}

async function listSupabaseTenantAnalysisJobStatusRows(
  config: AnalysisJobStoreConfig,
  tenantId: string,
  limit: number
): Promise<AnalysisJobQueueSummaryRow[]> {
  const params = new URLSearchParams([
    ["tenant_id", `eq.${tenantId}`],
    ["is_historical", "eq.false"],
    ["select", "status"],
    ["order", "created_at.desc"],
    ["limit", String(limit)]
  ]);

  const response = await fetch(`${config.url}/rest/v1/${encodeURIComponent(config.table)}?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
    headers: supabaseAnalysisJobHeaders(config)
  });

  if (!response.ok) {
    throw new AnalysisJobQueueError(`Analysis job store failed with HTTP ${response.status}.`);
  }

  const rows = await response.json().catch(() => []) as unknown;
  if (!Array.isArray(rows)) return [];

  return rows
    .filter((row): row is AnalysisJobQueueSummaryRow => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    .slice(0, limit);
}

function listMemoryTenantAnalysisJobs(
  tenantId: string,
  limit: number,
  statuses: AnalysisJobStatus[]
): AnalysisJobRow[] {
  return analysisJobStore()
    .filter((job) => job.tenant_id === tenantId && (statuses.length === 0 || statuses.includes(job.status)))
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, limit);
}

function countMemoryTenantAnalysisJobs(tenantId: string): number {
  return analysisJobStore().filter((job) => job.tenant_id === tenantId).length;
}

function countMemoryTenantActiveAnalysisJobsByStatus(
  tenantId: string
): Pick<Record<AnalysisJobStatus, number>, "queued" | "processing" | "failed_retryable"> {
  const statusCounts = {
    queued: 0,
    processing: 0,
    failed_retryable: 0
  };

  for (const job of analysisJobStore()) {
    if (job.tenant_id !== tenantId || job.is_historical === true) continue;
    if (job.status === "queued" || job.status === "processing" || job.status === "failed_retryable") {
      statusCounts[job.status] += 1;
    }
  }

  return statusCounts;
}

function purgeMemoryTenantAnalysisJobs(tenantId: string): number {
  const originalLength = analysisJobStore().length;
  const retained = analysisJobStore().filter((job) => job.tenant_id !== tenantId);
  analysisJobStore().splice(0, analysisJobStore().length, ...retained);

  return originalLength - retained.length;
}

function listMemoryTenantAnalysisJobStatusRows(tenantId: string, limit: number): AnalysisJobQueueSummaryRow[] {
  return analysisJobStore()
    .filter((job) => job.tenant_id === tenantId && job.is_historical !== true)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, limit)
    .map((job) => ({ status: job.status }));
}

async function listSupabaseAnalysisJobSummaryRows(
  config: AnalysisJobStoreConfig,
  limit: number
): Promise<AnalysisJobQueueSummaryRow[]> {
  const params = new URLSearchParams([
    ["is_historical", "eq.false"],
    ["select", "status,created_at,updated_at,run_after,locked_at"],
    ["order", "created_at.asc"],
    ["limit", String(limit)]
  ]);

  const response = await fetch(`${config.url}/rest/v1/${encodeURIComponent(config.table)}?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
    headers: supabaseAnalysisJobHeaders(config)
  });

  if (!response.ok) {
    throw new AnalysisJobQueueError(`Analysis job store failed with HTTP ${response.status}.`);
  }

  const rows = await response.json().catch(() => []) as unknown;
  if (!Array.isArray(rows)) return [];

  return rows
    .filter((row): row is AnalysisJobQueueSummaryRow => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    .slice(0, limit);
}

async function listSupabaseAnalysisJobDeadLetterRows(
  config: AnalysisJobStoreConfig,
  limit: number
): Promise<AnalysisJobDeadLetterRow[]> {
  const params = new URLSearchParams([
    ["status", "eq.failed_terminal"],
    ["is_historical", "eq.false"],
    ["select", "error_code,updated_at"],
    ["order", "updated_at.asc"],
    ["limit", String(limit)]
  ]);

  const response = await fetch(`${config.url}/rest/v1/${encodeURIComponent(config.table)}?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
    headers: supabaseAnalysisJobHeaders(config)
  });

  if (!response.ok) {
    throw new AnalysisJobQueueError(`Analysis job store failed with HTTP ${response.status}.`);
  }

  const rows = await response.json().catch(() => []) as unknown;
  if (!Array.isArray(rows)) return [];

  return rows
    .filter((row): row is AnalysisJobDeadLetterRow => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    .slice(0, limit);
}

function listMemoryAnalysisJobSummaryRows(limit: number): AnalysisJobQueueSummaryRow[] {
  return analysisJobStore()
    .filter((job) => job.is_historical !== true)
    .sort((left, right) => left.created_at.localeCompare(right.created_at))
    .slice(0, limit)
    .map((job) => ({
      status: job.status,
      created_at: job.created_at,
      updated_at: job.updated_at,
      run_after: job.run_after,
      locked_at: job.locked_at ?? null
    }));
}

function listMemoryAnalysisJobDeadLetterRows(limit: number): AnalysisJobDeadLetterRow[] {
  return analysisJobStore()
    .filter((job) => job.is_historical !== true && job.status === "failed_terminal")
    .sort((left, right) => left.updated_at.localeCompare(right.updated_at))
    .slice(0, limit)
    .map((job) => ({
      error_code: job.error_code,
      updated_at: job.updated_at
    }));
}

async function claimSupabaseAnalysisJob(
  config: AnalysisJobStoreConfig,
  now: Date,
  leaseMs: number
): Promise<AnalysisJobRow | null> {
  const due = await getSupabaseAnalysisJobCandidate(config, {
    statusFilter: "in.(queued,failed_retryable)",
    timestampColumn: "run_after",
    timestampOperator: "lte",
    timestampValue: now.toISOString(),
    order: "run_after.asc"
  });

  if (due) {
    const claimed = await patchSupabaseAnalysisJob(config, due.id, toClaimedAnalysisJobUpdate(due, now), {
      currentStatus: due.status,
      currentUpdatedAt: due.updated_at,
      returnRepresentation: true
    });

    if (claimed) return publicationPlanForClaim(claimed);
  }

  const semanticRetryStaleBefore = new Date(now.getTime() - SEMANTIC_RETRY_SUBMISSION_RECLAIM_MS);
  const uncertainRetry = await getSupabaseSemanticRetrySubmissionCandidate(
    config,
    now,
    semanticRetryStaleBefore
  );
  if (uncertainRetry) {
    const claimed = await patchSupabaseAnalysisJob(config, uncertainRetry.id, toRecoveredSemanticRetryClaimUpdate(uncertainRetry, now), {
      currentStatus: "processing",
      currentUpdatedAt: uncertainRetry.updated_at,
      returnRepresentation: true
    });
    return claimed ? publicationPlanForClaim(claimed) : null;
  }

  const expiredProvider = await getSupabaseExpiredProviderProcessingCandidate(config, now);
  if (expiredProvider) {
    const claimed = await patchSupabaseAnalysisJob(
      config,
      expiredProvider.id,
      toExpiredProviderRecoveryClaimUpdate(expiredProvider, now, leaseMs),
      {
        currentStatus: "processing",
        currentUpdatedAt: expiredProvider.updated_at,
        currentDesiredRevision: expiredProvider.desired_revision,
        currentRunningRevision: expiredProvider.running_revision,
        requireUnsealed: true,
        returnRepresentation: true
      }
    );
    if (claimed) return publicationPlanForClaim(claimed);
  }

  const staleBefore = new Date(now.getTime() - leaseMs);
  const stale = await getSupabaseAnalysisJobCandidate(config, {
    statusFilter: "eq.processing",
    timestampColumn: "locked_at",
    timestampOperator: "lt",
    timestampValue: staleBefore.toISOString(),
    order: "locked_at.asc"
  });

  if (!stale) return null;

  const claimed = await patchSupabaseAnalysisJob(config, stale.id, toClaimedAnalysisJobUpdate(stale, now), {
    currentStatus: "processing",
    currentUpdatedAt: stale.updated_at,
    returnRepresentation: true
  });
  return claimed ? publicationPlanForClaim(claimed) : null;
}

async function claimSupabaseAnalysisJobForProviderResponse(
  config: AnalysisJobStoreConfig,
  responseId: string,
  webhookIdHash: string,
  now: Date,
  leaseMs: number
): Promise<Pick<AnalysisJobProviderResponseClaimResult, "job" | "disposition">> {
  const candidates = await getSupabaseAnalysisJobsByProviderResponse(config, responseId);
  if (candidates.length === 0) return { job: null, disposition: "not_found" };
  const staleBefore = now.getTime() - leaseMs;
  const candidate = candidates[0];
  const disposition = providerContinuationClaimDisposition(candidate, webhookIdHash, now, staleBefore);
  if (disposition !== "claimed") return { job: null, disposition };

  const job = await patchSupabaseAnalysisJob(config, candidate.id, toClaimedAnalysisJobUpdate(candidate, now, webhookIdHash), {
    currentStatus: candidate.status,
    currentUpdatedAt: candidate.updated_at,
    returnRepresentation: true
  });
  return job ? { job: publicationPlanForClaim(job), disposition: "claimed" } : { job: null, disposition: "busy" };
}

async function claimSupabaseAnalysisJobById(
  config: AnalysisJobStoreConfig,
  jobId: string,
  now: Date
): Promise<AnalysisJobRow | null> {
  const candidate = await getSupabaseAnalysisJobById(config, jobId);
  if (!candidate || !isDueQueuedJob(candidate, now)) return null;

  const claimed = await patchSupabaseAnalysisJob(config, candidate.id, toClaimedAnalysisJobUpdate(candidate, now), {
    currentStatus: candidate.status,
    currentUpdatedAt: candidate.updated_at,
    returnRepresentation: true
  });
  return claimed ? publicationPlanForClaim(claimed) : null;
}

function claimMemoryAnalysisJob(now: Date, leaseMs: number): AnalysisJobRow | null {
  const store = analysisJobStore();
  const due = store.find((job) => isDueQueuedJob(job, now));
  if (due) {
    Object.assign(due, toClaimedAnalysisJobUpdate(due, now));
    assertAnalysisJobIsPrivate(due);
    return publicationPlanForClaim(due);
  }

  const semanticRetryStaleBefore = now.getTime() - SEMANTIC_RETRY_SUBMISSION_RECLAIM_MS;
  const uncertainRetry = store.find((job) =>
    isStaleSemanticRetrySubmissionJob(job, now, semanticRetryStaleBefore)
  );
  if (uncertainRetry) {
    Object.assign(uncertainRetry, toRecoveredSemanticRetryClaimUpdate(uncertainRetry, now));
    assertAnalysisJobIsPrivate(uncertainRetry);
    return publicationPlanForClaim(uncertainRetry);
  }

  const expiredProvider = store.find((job) => isExpiredProviderProcessingJob(job, now));
  if (expiredProvider) {
    Object.assign(expiredProvider, toExpiredProviderRecoveryClaimUpdate(expiredProvider, now, leaseMs));
    assertAnalysisJobIsPrivate(expiredProvider);
    return publicationPlanForClaim(expiredProvider);
  }

  const staleBefore = now.getTime() - leaseMs;
  const stale = store.find((job) => isStaleProcessingJob(job, staleBefore));

  if (!stale) return null;

  Object.assign(stale, toClaimedAnalysisJobUpdate(stale, now));
  assertAnalysisJobIsPrivate(stale);

  return publicationPlanForClaim(stale);
}

function claimMemoryAnalysisJobById(jobId: string, now: Date): AnalysisJobRow | null {
  const candidate = analysisJobStore().find((job) => job.id === jobId);
  if (!candidate || !isDueQueuedJob(candidate, now)) return null;

  Object.assign(candidate, toClaimedAnalysisJobUpdate(candidate, now));
  assertAnalysisJobIsPrivate(candidate);
  return publicationPlanForClaim(candidate);
}

function claimMemoryAnalysisJobForProviderResponse(
  responseId: string,
  webhookIdHash: string,
  now: Date,
  leaseMs: number
): Pick<AnalysisJobProviderResponseClaimResult, "job" | "disposition"> {
  const staleBefore = now.getTime() - leaseMs;
  const candidate = analysisJobStore().find((job) =>
    job.is_historical !== true && job.provider_response_id === responseId
  );
  if (!candidate) return { job: null, disposition: "not_found" };
  const disposition = providerContinuationClaimDisposition(candidate, webhookIdHash, now, staleBefore);
  if (disposition !== "claimed") return { job: null, disposition };

  Object.assign(candidate, toClaimedAnalysisJobUpdate(candidate, now, webhookIdHash));
  assertAnalysisJobIsPrivate(candidate);
  return { job: publicationPlanForClaim(candidate), disposition: "claimed" };
}

async function getSupabaseAnalysisJobsByProviderResponse(
  config: AnalysisJobStoreConfig,
  responseId: string
): Promise<AnalysisJobRow[]> {
  const params = new URLSearchParams([
    ["provider_response_id", `eq.${responseId}`],
    ["status", "in.(queued,failed_retryable,processing)"],
    ["is_historical", "eq.false"],
    ["select", ANALYSIS_JOB_SELECT],
    ["limit", "2"]
  ]);

  const response = await fetch(`${config.url}/rest/v1/${encodeURIComponent(config.table)}?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
    headers: supabaseAnalysisJobHeaders(config)
  });

  if (!response.ok) {
    throw new AnalysisJobQueueError(`Analysis job store failed with HTTP ${response.status}.`);
  }

  const rows = await response.json() as unknown;
  if (!Array.isArray(rows)) return [];
  if (rows.length > 1) {
    throw new AnalysisJobQueueError("Analysis job provider response id is not unique.");
  }

  return rows
    .filter((row): row is AnalysisJobRow => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    .map((job) => {
      assertAnalysisJobIsPrivate(job);
      return job;
    });
}

async function getSupabaseAnalysisJobCandidate(
  config: AnalysisJobStoreConfig,
  options: {
    statusFilter: string;
    timestampColumn: "run_after" | "locked_at";
    timestampOperator: "lte" | "lt";
    timestampValue: string;
    order: string;
  }
): Promise<AnalysisJobRow | null> {
  const params = new URLSearchParams([
    ["status", options.statusFilter],
    ["is_historical", "eq.false"],
    [options.timestampColumn, `${options.timestampOperator}.${options.timestampValue}`],
    ["select", ANALYSIS_JOB_SELECT],
    ["order", options.order],
    ["limit", "1"]
  ]);

  const response = await fetch(`${config.url}/rest/v1/${encodeURIComponent(config.table)}?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
    headers: supabaseAnalysisJobHeaders(config)
  });

  if (!response.ok) {
    throw new AnalysisJobQueueError(`Analysis job store failed with HTTP ${response.status}.`);
  }

  const rows = await response.json() as unknown;
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || typeof row !== "object") return null;

  return normalizeAnalysisJobRow(row);
}

async function getSupabaseSemanticRetrySubmissionCandidate(
  config: AnalysisJobStoreConfig,
  now: Date,
  staleBefore: Date
): Promise<AnalysisJobRow | null> {
  const params = new URLSearchParams([
    ["status", "eq.processing"],
    ["is_historical", "eq.false"],
    ["semantic_retry_attempts", "eq.1"],
    ["provider_status", "eq.submitting"],
    ["provider_response_id", "is.null"],
    ["prior_provider_response_id", "not.is.null"],
    ["prior_provider_expires_at", `gt.${now.toISOString()}`],
    ["locked_at", `lt.${staleBefore.toISOString()}`],
    ["select", ANALYSIS_JOB_SELECT],
    ["order", "locked_at.asc"],
    ["limit", "1"]
  ]);

  const response = await fetch(`${config.url}/rest/v1/${encodeURIComponent(config.table)}?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
    headers: supabaseAnalysisJobHeaders(config)
  });
  if (!response.ok) {
    throw new AnalysisJobQueueError(`Analysis job store failed with HTTP ${response.status}.`);
  }

  const rows = await response.json() as unknown;
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || typeof row !== "object") return null;
  const job = normalizeAnalysisJobRow(row);
  if (!job) return null;
  return isStaleSemanticRetrySubmissionJob(job, now, staleBefore.getTime()) ? job : null;
}

async function getSupabaseExpiredProviderProcessingCandidate(
  config: AnalysisJobStoreConfig,
  now: Date
): Promise<AnalysisJobRow | null> {
  const nowIso = now.toISOString();
  const params = new URLSearchParams([
    ["status", "eq.processing"],
    ["is_historical", "eq.false"],
    ["sealed_revision", "is.null"],
    ["running_revision", "not.is.null"],
    ["provider_status", "in.(submitting,queued,in_progress)"],
    ["provider_submitted_at", "not.is.null"],
    ["provider_expires_at", `lte.${nowIso}`],
    ["run_after", `lte.${nowIso}`],
    ["locked_at", "not.is.null"],
    ["select", ANALYSIS_JOB_SELECT],
    ["order", "provider_expires_at.asc"],
    ["limit", "1"]
  ]);

  const response = await fetch(`${config.url}/rest/v1/${encodeURIComponent(config.table)}?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
    headers: supabaseAnalysisJobHeaders(config)
  });
  if (!response.ok) {
    throw new AnalysisJobQueueError(`Analysis job store failed with HTTP ${response.status}.`);
  }

  const rows = await response.json() as unknown;
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || typeof row !== "object") return null;
  const job = normalizeAnalysisJobRow(row);
  if (!job) return null;
  return isExpiredProviderProcessingJob(job, now) ? job : null;
}

async function getSupabaseAnalysisJobById(
  config: AnalysisJobStoreConfig,
  id: string
): Promise<AnalysisJobRow | null> {
  const params = new URLSearchParams([
    ["id", `eq.${id}`],
    ["select", ANALYSIS_JOB_SELECT],
    ["limit", "1"]
  ]);

  const response = await fetch(`${config.url}/rest/v1/${encodeURIComponent(config.table)}?${params.toString()}`, {
    method: "GET",
    cache: "no-store",
    headers: supabaseAnalysisJobHeaders(config)
  });

  if (!response.ok) {
    throw new AnalysisJobQueueError(`Analysis job store failed with HTTP ${response.status}.`);
  }

  const rows = await response.json() as unknown;
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || typeof row !== "object") return null;

  return normalizeAnalysisJobRow(row);
}

async function patchSupabaseAnalysisJob(
  config: AnalysisJobStoreConfig,
  id: string,
  update: Partial<AnalysisJobRow>,
  options: {
    currentStatus?: AnalysisJobStatus;
    currentUpdatedAt?: string;
    currentClaimGeneration?: string;
    currentDesiredRevision?: number;
    currentRunningRevision?: number | null;
    requireUnsealed?: boolean;
    requireNoProviderContinuation?: boolean;
    requireEmptyHybridPlannerBinding?: boolean;
    returnRepresentation?: boolean;
  } = {}
): Promise<AnalysisJobRow | null> {
  assertAnalysisJobIsPrivate(update);

  const params = new URLSearchParams([
    ["id", `eq.${id}`],
    ["is_historical", "eq.false"],
    ["select", ANALYSIS_JOB_SELECT]
  ]);

  if (options.currentStatus) {
    params.append("status", `eq.${options.currentStatus}`);
  }

  if (options.currentUpdatedAt) {
    params.append("updated_at", `eq.${options.currentUpdatedAt}`);
  }

  if (options.currentClaimGeneration) {
    params.append("claim_generation", `eq.${options.currentClaimGeneration}`);
  }
  if (options.currentDesiredRevision != null) {
    params.append("desired_revision", `eq.${options.currentDesiredRevision}`);
  }
  if (options.currentRunningRevision != null) {
    params.append("running_revision", `eq.${options.currentRunningRevision}`);
  }
  if (options.requireUnsealed) {
    params.append("sealed_revision", "is.null");
  }
  if (options.requireNoProviderContinuation) {
    params.append("provider_status", "is.null");
    params.append("provider_response_id", "is.null");
    params.append("provider_submitted_at", "is.null");
    params.append("provider_expires_at", "is.null");
    params.append("provider_webhook_id_hash", "is.null");
    params.append("provider_webhook_received_at", "is.null");
    params.append("semantic_retry_attempts", "eq.0");
    params.append("prior_provider_response_id", "is.null");
    params.append("prior_provider_submitted_at", "is.null");
    params.append("prior_provider_expires_at", "is.null");
  }
  if (options.requireEmptyHybridPlannerBinding) {
    params.append("planner_contract_version", "is.null");
    params.append("planner_input_hash", "is.null");
  }

  const response = await fetch(`${config.url}/rest/v1/${encodeURIComponent(config.table)}?${params.toString()}`, {
    method: "PATCH",
    cache: "no-store",
    headers: {
      ...supabaseAnalysisJobHeaders(config),
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(update)
  });

  if (!response.ok) {
    throw new AnalysisJobQueueError(`Analysis job store failed with HTTP ${response.status}.`);
  }

  const rows = await response.json() as unknown;
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || typeof row !== "object") return null;

  return normalizeAnalysisJobRow(row);
}

function updateMemoryAnalysisJob(
  id: string,
  currentStatus: AnalysisJobStatus,
  update: Partial<AnalysisJobRow>,
  currentClaimGeneration?: string
): boolean {
  assertAnalysisJobIsPrivate(update);
  const row = analysisJobStore().find((job) =>
    job.id === id && job.status === currentStatus && (!currentClaimGeneration || job.claim_generation === currentClaimGeneration)
  );
  if (!row) return false;

  Object.assign(row, update);
  assertAnalysisJobIsPrivate(row);
  return true;
}

function toClaimedAnalysisJobUpdate(
  row: AnalysisJobRow,
  now: Date,
  providerWebhookIdHash?: string,
  preserveExpiredProviderContinuation = false
): Partial<AnalysisJobRow> {
  const desiredRevision = row.desired_revision ?? 1;
  const recoverLatestUnsealedRevision = row.status === "processing" &&
    row.sealed_revision == null && row.running_revision != null &&
    row.running_revision !== desiredRevision;
  return {
    status: "processing",
    claim_generation: randomUUID(),
    running_revision: row.sealed_revision ?? desiredRevision,
    attempts: Math.max(0, Number(row.attempts) || 0) + 1,
    updated_at: now.toISOString(),
    locked_at: now.toISOString(),
    completed_at: null,
    error_code: null,
    error_summary: null,
    result_summary: null,
    ...(recoverLatestUnsealedRevision && !preserveExpiredProviderContinuation ? clearedProviderContinuation() : {}),
    ...(providerWebhookIdHash ? {
      provider_webhook_id_hash: providerWebhookIdHash,
      provider_webhook_received_at: now.toISOString()
    } : {})
  };
}

function toExpiredProviderRecoveryClaimUpdate(
  row: AnalysisJobRow,
  now: Date,
  leaseMs: number
): Partial<AnalysisJobRow> {
  return {
    ...toClaimedAnalysisJobUpdate(row, now, undefined, true),
    run_after: new Date(now.getTime() + leaseMs).toISOString()
  };
}

function toRecoveredSemanticRetryClaimUpdate(
  row: AnalysisJobRow,
  now: Date
): Partial<AnalysisJobRow> {
  const update = {
    ...toClaimedAnalysisJobUpdate(row, now),
    provider_response_id: null,
    provider_status: "in_progress" as const,
    provider_poll_attempts: 0,
    provider_submitted_at: null,
    provider_expires_at: null,
    provider_webhook_id_hash: null,
    provider_webhook_received_at: null,
    semantic_retry_attempts: 1,
    prior_provider_response_id: row.prior_provider_response_id,
    prior_provider_submitted_at: row.prior_provider_submitted_at,
    prior_provider_expires_at: row.prior_provider_expires_at
  };
  assertAnalysisJobIsPrivate(update);
  return update;
}

function toAnalysisJobFailureUpdate(
  input: FailAnalysisJobInput,
  attempts: number,
  maxAttempts: number,
  now: Date,
  retryAfterMs: number
): Partial<AnalysisJobRow> {
  const shouldRetry = input.retryable && attempts < maxAttempts;
  const update = {
    status: shouldRetry ? "failed_retryable" as const : "failed_terminal" as const,
    updated_at: now.toISOString(),
    run_after: shouldRetry
      ? new Date(now.getTime() + retryAfterMs).toISOString()
      : now.toISOString(),
    locked_at: null,
    error_code: safeJobErrorCode(input.code),
    error_summary: safeJobErrorSummary(input.summary),
    result_summary: null,
    claim_generation: null,
    running_revision: null,
    sealed_revision: null,
    publication_sealed_at: null,
    ...clearedSealedPublicationPlan(),
    ...(shouldRetry ? {} : clearedProviderContinuation())
  };

  assertAnalysisJobIsPrivate(update);
  return update;
}

function toTenantAnalysisJobSummary(row: AnalysisJobRow): TenantAnalysisJobSummary {
  const result = row.result_summary
    ? {
      priority: safeOptionalSummarySlug(row.result_summary.priority),
      evidenceCoverage: safeOptionalPercent(row.result_summary.evidenceCoverage),
      ...(row.result_summary.savedReport
        ? {
          savedReport: {
            privacy: safeOptionalSummarySlug(row.result_summary.savedReport.privacy),
            durability: safeOptionalSummarySlug(row.result_summary.savedReport.durability)
          }
        }
        : {}),
      ...(row.result_summary.comment
        ? {
          comment: {
            action: safeOptionalSummarySlug(row.result_summary.comment.action)
          }
        }
        : {}),
      ...(row.result_summary.slack
        ? {
          slack: {
            action: safeOptionalSummarySlug(row.result_summary.slack.action),
            privacy: safeOptionalSummarySlug(row.result_summary.slack.privacy)
          }
        }
        : {})
    }
    : undefined;

  const summary = {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    repositoryFullName: row.repository_full_name,
    pullRequestNumber: row.pull_request_number,
    headShaPrefix: row.head_sha.slice(0, 12),
    action: row.action ?? undefined,
    attempts: row.attempts,
    runAfter: row.run_after,
    completedAt: row.completed_at ?? undefined,
    errorCode: row.error_code ? safeJobErrorCode(row.error_code) : undefined,
    errorSummary: row.error_summary ? safePublicErrorSummary(row.error_summary) : undefined,
    sideEffects: {
      saveReport: row.save_report,
      comment: row.comment,
      ...(row.slack_summary === true ? { slackSummary: true } : {})
    },
    result,
    privacy: "analysis-job-summary-only" as const
  };

  assertAnalysisJobIsPrivate(summary);
  return summary;
}

function sanitizeAnalysisJobResultSummary(summary: AnalysisJobResultSummary): AnalysisJobResultSummary {
  const repository = safeRepositoryFullName(summary.repository);
  const pullRequestNumber = safePositiveInteger(summary.pullRequestNumber);
  const headSha = safeHeadSha(summary.headSha);
  const priority = safeJobErrorCode(summary.priority);
  const evidenceCoverage = typeof summary.evidenceCoverage === "number" && Number.isFinite(summary.evidenceCoverage)
    ? Math.max(0, Math.min(100, Math.round(summary.evidenceCoverage)))
    : 0;

  if (!repository || !pullRequestNumber || !headSha) {
    throw new AnalysisJobQueueError("Analysis job result summary is invalid.");
  }

  const sanitized = {
    status: "completed" as const,
    repository,
    pullRequestNumber,
    headSha,
    priority,
    evidenceCoverage,
    savedReport: summary.savedReport
      ? {
        privacy: summary.savedReport.privacy ? safeJobErrorCode(summary.savedReport.privacy) : undefined,
        durability: summary.savedReport.durability ? safeJobErrorCode(summary.savedReport.durability) : undefined
      }
      : undefined,
    comment: summary.comment
      ? {
        action: summary.comment.action ? safeJobErrorCode(summary.comment.action) : undefined
      }
      : undefined,
    slack: summary.slack
      ? {
        action: summary.slack.action ? safeJobErrorCode(summary.slack.action) : undefined,
        privacy: summary.slack.privacy ? safeJobErrorCode(summary.slack.privacy) : undefined
      }
      : undefined
  };

  assertAnalysisJobIsPrivate(sanitized);
  return sanitized;
}

interface AnalysisJobQueueSummaryRow {
  status?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  run_after?: unknown;
  locked_at?: unknown;
}

interface AnalysisJobDeadLetterRow {
  error_code?: unknown;
  updated_at?: unknown;
}

function summarizeAnalysisJobQueue(
  rows: AnalysisJobQueueSummaryRow[],
  options: { now: Date; staleAfterMs: number; truncated: boolean }
): AnalysisJobQueueSummary {
  const counts = emptyAnalysisJobStatusCounts();
  const nowMs = options.now.getTime();
  const staleBeforeMs = nowMs - options.staleAfterMs;
  let due = 0;
  let delayedRetry = 0;
  let staleProcessing = 0;
  let oldestQueuedAgeSeconds: number | undefined;
  let oldestRetryAgeSeconds: number | undefined;

  for (const row of rows) {
    const status = safeAnalysisJobStatus(row.status);
    if (!status) continue;

    counts[status] += 1;

    const runAfterMs = safeTimeMs(row.run_after);
    const createdMs = safeTimeMs(row.created_at);
    const lockedMs = safeTimeMs(row.locked_at);

    if ((status === "queued" || status === "failed_retryable") && runAfterMs !== null && runAfterMs <= nowMs) {
      due += 1;
    }

    if (status === "failed_retryable") {
      if (runAfterMs !== null && runAfterMs > nowMs) {
        delayedRetry += 1;
      }

      oldestRetryAgeSeconds = oldestAgeSeconds(oldestRetryAgeSeconds, createdMs, nowMs);
    }

    if (status === "queued") {
      oldestQueuedAgeSeconds = oldestAgeSeconds(oldestQueuedAgeSeconds, createdMs, nowMs);
    }

    if (status === "processing" && lockedMs !== null && lockedMs < staleBeforeMs) {
      staleProcessing += 1;
    }
  }

  const summary = {
    privacy: "analysis-job-queue-summary-only" as const,
    sampled: rows.length,
    truncated: options.truncated,
    counts,
    due,
    delayedRetry,
    staleProcessing,
    oldestQueuedAgeSeconds,
    oldestRetryAgeSeconds
  };

  assertAnalysisJobIsPrivate(summary);
  return summary;
}

function summarizeAnalysisJobDeadLetter(
  rows: AnalysisJobDeadLetterRow[],
  options: { now: Date; truncated: boolean }
): AnalysisJobDeadLetterSummary {
  const errorCounts = new Map<string, number>();
  const nowMs = options.now.getTime();
  let oldestTerminalAgeSeconds: number | undefined;

  for (const row of rows) {
    const errorCode = typeof row.error_code === "string" ? safeJobErrorCode(row.error_code) : "unknown";
    errorCounts.set(errorCode, (errorCounts.get(errorCode) ?? 0) + 1);
    oldestTerminalAgeSeconds = oldestAgeSeconds(oldestTerminalAgeSeconds, safeTimeMs(row.updated_at), nowMs);
  }

  const topErrorCodes = [...errorCounts.entries()]
    .sort(([leftCode, leftCount], [rightCode, rightCount]) =>
      rightCount - leftCount || leftCode.localeCompare(rightCode)
    )
    .slice(0, MAX_ANALYSIS_JOB_DEAD_LETTER_ERROR_CODES)
    .map(([errorCode, count]) => ({ errorCode, count }));

  const summary = {
    privacy: "analysis-job-dead-letter-summary-only" as const,
    basis: "failed_terminal_recent_sample" as const,
    sampled: rows.length,
    truncated: options.truncated,
    sampledTerminalCount: rows.length,
    topErrorCodes,
    oldestTerminalAgeSeconds
  };

  assertAnalysisJobIsPrivate(summary);
  return summary;
}

function emptyAnalysisJobStatusCounts(): Record<AnalysisJobStatus, number> {
  return {
    queued: 0,
    processing: 0,
    completed: 0,
    failed_retryable: 0,
    failed_terminal: 0
  };
}

function summarizeTenantAnalysisJobStatuses(
  rows: AnalysisJobQueueSummaryRow[],
  truncated: boolean
): TenantAnalysisJobRollupSummary {
  const statusCounts = emptyAnalysisJobStatusCounts();

  for (const row of rows) {
    const status = safeAnalysisJobStatus(row.status);
    if (status) statusCounts[status] += 1;
  }

  const summary = {
    privacy: "analysis-job-tenant-rollup-summary-only" as const,
    basis: "tenant_recent_sample" as const,
    sampled: rows.length,
    truncated,
    statusCounts,
    counts: {
      active: statusCounts.queued + statusCounts.processing + statusCounts.failed_retryable,
      failed: statusCounts.failed_retryable + statusCounts.failed_terminal,
      completed: statusCounts.completed,
      retrying: statusCounts.failed_retryable,
      terminal: statusCounts.failed_terminal
    }
  };

  assertAnalysisJobIsPrivate(summary);
  return summary;
}

function safeAnalysisJobStatus(value: unknown): AnalysisJobStatus | null {
  if (
    value === "queued" ||
    value === "processing" ||
    value === "completed" ||
    value === "failed_retryable" ||
    value === "failed_terminal"
  ) {
    return value;
  }

  return null;
}

function providerContinuationFromInput(input: ParkAnalysisJobForProviderInput) {
  const responseId = typeof input.responseId === "string" && /^resp_[A-Za-z0-9_-]{1,180}$/.test(input.responseId)
    ? input.responseId
    : null;
  const submittedAt = validDate(input.submittedAt);
  const expiresAt = validDate(input.expiresAt);
  const runAfter = validDate(input.runAfter);
  if (
    !responseId ||
    (input.providerStatus !== "queued" && input.providerStatus !== "in_progress") ||
    !submittedAt ||
    !expiresAt ||
    !runAfter ||
    expiresAt.getTime() <= submittedAt.getTime() ||
    expiresAt.getTime() - submittedAt.getTime() > MAX_PROVIDER_CONTINUATION_MS ||
    runAfter.getTime() > expiresAt.getTime()
  ) {
    throw new AnalysisJobQueueError("Analysis job provider continuation is invalid.");
  }

  return {
    provider_response_id: responseId,
    provider_status: input.providerStatus,
    provider_submitted_at: submittedAt.toISOString(),
    provider_expires_at: expiresAt.toISOString(),
    run_after: runAfter.toISOString()
  };
}

function semanticRetryTransitionFromInput(input: MarkAnalysisJobSemanticRetrySubmissionInput) {
  const claimGeneration = safeClaimGeneration(input.claimGeneration);
  const priorResponseId = safeProviderResponseId(input.priorResponseId);
  const priorSubmittedAt = validDate(input.priorSubmittedAt);
  const priorExpiresAt = validDate(input.priorExpiresAt);
  const submittedAt = validDate(input.submittedAt);
  const expiresAt = validDate(input.expiresAt);
  if (
    !claimGeneration ||
    !priorResponseId ||
    !priorSubmittedAt ||
    !priorExpiresAt ||
    !submittedAt ||
    !expiresAt ||
    priorExpiresAt.getTime() <= priorSubmittedAt.getTime() ||
    priorExpiresAt.getTime() - priorSubmittedAt.getTime() > MAX_PROVIDER_CONTINUATION_MS ||
    expiresAt.getTime() <= submittedAt.getTime() ||
    expiresAt.getTime() - submittedAt.getTime() > MAX_PROVIDER_CONTINUATION_MS ||
    expiresAt.getTime() > priorExpiresAt.getTime()
  ) {
    throw new AnalysisJobQueueError("Analysis job semantic retry submission marker is invalid.");
  }

  return {
    claim_generation: claimGeneration,
    prior_provider_response_id: priorResponseId,
    prior_provider_submitted_at: priorSubmittedAt.toISOString(),
    prior_provider_expires_at: priorExpiresAt.toISOString(),
    provider_submitted_at: submittedAt.toISOString(),
    provider_expires_at: expiresAt.toISOString()
  };
}

function canStartSemanticRetry(
  row: AnalysisJobRow,
  transition: ReturnType<typeof semanticRetryTransitionFromInput>,
  claimGeneration: string
): boolean {
  if (
    row.status !== "processing" ||
    row.claim_generation !== claimGeneration ||
    (row.semantic_retry_attempts ?? 0) !== 0 ||
    row.prior_provider_response_id ||
    row.prior_provider_submitted_at ||
    row.prior_provider_expires_at ||
    row.provider_submitted_at !== transition.prior_provider_submitted_at ||
    row.provider_expires_at !== transition.prior_provider_expires_at
  ) {
    return false;
  }

  return row.provider_response_id === transition.prior_provider_response_id ||
    (row.provider_response_id == null && row.provider_status === "submitting");
}

function semanticRetrySubmissionUpdate(
  transition: ReturnType<typeof semanticRetryTransitionFromInput>,
  now: Date
): Partial<AnalysisJobRow> {
  const update = {
    updated_at: now.toISOString(),
    locked_at: now.toISOString(),
    semantic_retry_attempts: 1,
    prior_provider_response_id: transition.prior_provider_response_id,
    prior_provider_submitted_at: transition.prior_provider_submitted_at,
    prior_provider_expires_at: transition.prior_provider_expires_at,
    provider_response_id: null,
    provider_status: "submitting" as const,
    provider_poll_attempts: 0,
    provider_submitted_at: transition.provider_submitted_at,
    provider_expires_at: transition.provider_expires_at,
    provider_webhook_id_hash: null,
    provider_webhook_received_at: null
  };
  assertAnalysisJobIsPrivate(update);
  return update;
}

function validDate(value: Date): Date | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : null;
}

function clearedProviderContinuation() {
  return {
    provider_response_id: null,
    provider_status: null,
    provider_poll_attempts: 0,
    provider_submitted_at: null,
    provider_expires_at: null,
    provider_webhook_id_hash: null,
    provider_webhook_received_at: null,
    semantic_retry_attempts: 0,
    prior_provider_response_id: null,
    prior_provider_submitted_at: null,
    prior_provider_expires_at: null
  };
}

function clearedHybridPlannerBinding() {
  return {
    planner_contract_version: null,
    planner_input_hash: null
  };
}

function safeHybridPlannerBinding(contractVersion: unknown, inputHash: unknown): {
  contractVersion: "hybrid_requirement_planner.v1";
  inputHash: string;
} | null {
  if (contractVersion !== "hybrid_requirement_planner.v1" || typeof inputHash !== "string" || !/^[a-f0-9]{64}$/.test(inputHash)) return null;
  return { contractVersion, inputHash };
}

function hybridPlannerBindingState(job: Pick<AnalysisJobRow, "planner_contract_version" | "planner_input_hash">):
  | { kind: "legacy" }
  | { kind: "bound"; binding: NonNullable<ReturnType<typeof safeHybridPlannerBinding>> }
  | { kind: "malformed" } {
  if (!Object.hasOwn(job, "planner_contract_version") || !Object.hasOwn(job, "planner_input_hash")) {
    return { kind: "malformed" };
  }
  const version = job.planner_contract_version;
  const hash = job.planner_input_hash;
  if (version === null && hash === null) return { kind: "legacy" };
  const binding = safeHybridPlannerBinding(version, hash);
  return binding ? { kind: "bound", binding } : { kind: "malformed" };
}

function hasInvalidHybridPlannerBinding(job: Pick<AnalysisJobRow,
  "hybrid_planner_requested" | "planner_contract_version" | "planner_input_hash">): boolean {
  if (!Object.hasOwn(job, "hybrid_planner_requested") || typeof job.hybrid_planner_requested !== "boolean") return true;
  const state = hybridPlannerBindingState(job);
  if (job.hybrid_planner_requested === false) return state.kind !== "legacy";
  return state.kind !== "bound";
}

function hasExactHybridPlannerBinding(
  job: Pick<AnalysisJobRow, "planner_contract_version" | "planner_input_hash">,
  binding: NonNullable<ReturnType<typeof safeHybridPlannerBinding>>
): boolean {
  const state = hybridPlannerBindingState(job);
  return state.kind === "bound" && state.binding.contractVersion === binding.contractVersion && state.binding.inputHash === binding.inputHash;
}

function canBindHybridPlannerSeed(
  job: Pick<AnalysisJobRow,
    "hybrid_planner_requested" | "planner_contract_version" | "planner_input_hash" |
    "provider_response_id" | "provider_status" | "provider_poll_attempts" |
    "provider_submitted_at" | "provider_expires_at" | "provider_webhook_id_hash" |
    "provider_webhook_received_at" | "semantic_retry_attempts" |
    "prior_provider_response_id" | "prior_provider_submitted_at" | "prior_provider_expires_at">,
  binding: NonNullable<ReturnType<typeof safeHybridPlannerBinding>>
): boolean {
  if (job.hybrid_planner_requested !== true) return false;
  const state = hybridPlannerBindingState(job);
  return !hasProviderContinuation(job) && (state.kind === "legacy" || hasExactHybridPlannerBinding(job, binding));
}

function hasProviderContinuation(job: Pick<AnalysisJobRow,
  "provider_response_id" | "provider_status" | "provider_poll_attempts" |
  "provider_submitted_at" | "provider_expires_at" | "provider_webhook_id_hash" |
  "provider_webhook_received_at" | "semantic_retry_attempts" |
  "prior_provider_response_id" | "prior_provider_submitted_at" | "prior_provider_expires_at">): boolean {
  return job.provider_response_id != null || job.provider_status != null ||
    job.provider_submitted_at != null || job.provider_expires_at != null ||
    job.provider_webhook_id_hash != null || job.provider_webhook_received_at != null ||
    job.prior_provider_response_id != null || job.prior_provider_submitted_at != null ||
    job.prior_provider_expires_at != null ||
    (typeof job.provider_poll_attempts === "number" && job.provider_poll_attempts > 0) ||
    (typeof job.semantic_retry_attempts === "number" && job.semantic_retry_attempts > 0);
}

function hasCurrentAnalysisJobRevision(job: Pick<AnalysisJobRow, "status" | "desired_revision" | "running_revision">): boolean {
  return job.status === "processing" &&
    typeof job.desired_revision === "number" && Number.isSafeInteger(job.desired_revision) && job.desired_revision > 0 &&
    typeof job.running_revision === "number" && Number.isSafeInteger(job.running_revision) &&
    job.running_revision === job.desired_revision;
}

function sealedPublicationPlan(row: AnalysisJobRow) {
  return {
    sealed_delivery_id: row.delivery_id ?? null,
    sealed_event: row.event,
    sealed_action: row.action ?? null,
    sealed_save_report: row.save_report,
    sealed_comment: row.comment,
    sealed_slack_summary: row.slack_summary === true
  };
}

function clearedSealedPublicationPlan() {
  return {
    sealed_delivery_id: null,
    sealed_event: null,
    sealed_action: null,
    sealed_save_report: null,
    sealed_comment: null,
    sealed_slack_summary: null
  };
}

function publicationPlanForClaim(row: AnalysisJobRow): AnalysisJobRow {
  if (row.sealed_revision == null) return { ...row };
  if (
    row.running_revision !== row.sealed_revision ||
    typeof row.sealed_event !== "string" ||
    typeof row.sealed_save_report !== "boolean" ||
    typeof row.sealed_comment !== "boolean" ||
    typeof row.sealed_slack_summary !== "boolean"
  ) {
    throw new AnalysisJobQueueError("Analysis job sealed publication plan is invalid.");
  }
  const claimed = {
    ...row,
    delivery_id: row.sealed_delivery_id ?? null,
    event: row.sealed_event,
    action: row.sealed_action ?? null,
    save_report: row.sealed_save_report,
    comment: row.sealed_comment,
    slack_summary: row.sealed_slack_summary
  };
  assertAnalysisJobIsPrivate(claimed);
  return claimed;
}

function safeClaimGeneration(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function safeRevision(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function safeTimeMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function oldestAgeSeconds(current: number | undefined, startedAtMs: number | null, nowMs: number): number | undefined {
  if (startedAtMs === null) return current;
  const age = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  return current === undefined ? age : Math.max(current, age);
}

function isDueQueuedJob(job: AnalysisJobRow, now: Date): boolean {
  return job.is_historical !== true &&
    (job.status === "queued" || job.status === "failed_retryable") &&
    new Date(job.run_after).getTime() <= now.getTime();
}

function isStaleProcessingJob(job: AnalysisJobRow, staleBeforeMs: number): boolean {
  if (job.is_historical === true || job.status !== "processing" || !job.locked_at) return false;
  return new Date(job.locked_at).getTime() < staleBeforeMs;
}

function isExpiredProviderProcessingJob(job: AnalysisJobRow, now: Date): boolean {
  const expiresAt = safeTimeMs(job.provider_expires_at);
  const submittedAt = safeTimeMs(job.provider_submitted_at);
  const runAfter = safeTimeMs(job.run_after);
  return job.is_historical !== true &&
    job.status === "processing" &&
    job.sealed_revision == null &&
    job.running_revision != null &&
    (job.provider_status === "submitting" || job.provider_status === "queued" || job.provider_status === "in_progress") &&
    submittedAt !== null &&
    expiresAt !== null && expiresAt <= now.getTime() &&
    runAfter !== null && runAfter <= now.getTime() &&
    safeTimeMs(job.locked_at) !== null;
}

function isStaleSemanticRetrySubmissionJob(
  job: AnalysisJobRow,
  now: Date,
  staleBeforeMs: number
): boolean {
  const priorExpiresAt = safeTimeMs(job.prior_provider_expires_at);
  return job.is_historical !== true &&
    isSemanticRetrySubmissionUncertaintyState(job) &&
    job.sealed_revision == null &&
    job.running_revision != null &&
    job.desired_revision === job.running_revision &&
    priorExpiresAt !== null &&
    priorExpiresAt > now.getTime() &&
    Boolean(job.locked_at) &&
    new Date(job.locked_at!).getTime() < staleBeforeMs;
}

function canFenceAnalysisJobSemanticRetryFinalization(
  job: AnalysisJobRow | null | undefined,
  claimGeneration: string
): job is AnalysisJobRow {
  if (!job) return false;
  return isUnsealedCurrentRevision(job, claimGeneration) &&
    isSemanticRetryFinalizationState(job);
}

function isUnsealedCurrentRevision(job: AnalysisJobRow, claimGeneration: string): boolean {
  return job.is_historical !== true && job.status === "processing" &&
    job.claim_generation === claimGeneration &&
    job.sealed_revision == null &&
    job.running_revision != null &&
    job.desired_revision === job.running_revision;
}

function analysisJobSemanticRetryFinalizationFenceUpdate(
  now: Date
): Partial<AnalysisJobRow> {
  const update = {
    updated_at: now.toISOString(),
    locked_at: now.toISOString(),
    provider_response_id: null,
    provider_status: null,
    provider_poll_attempts: 0,
    provider_submitted_at: null,
    provider_expires_at: null,
    provider_webhook_id_hash: null,
    provider_webhook_received_at: null
  };
  assertAnalysisJobIsPrivate(update);
  return update;
}

function isSemanticRetrySubmissionUncertaintyState(job: AnalysisJobRow): boolean {
  return job.status === "processing" &&
    job.semantic_retry_attempts === 1 &&
    job.provider_response_id == null &&
    job.provider_status === "submitting" &&
    Boolean(job.prior_provider_response_id) &&
    Boolean(job.prior_provider_submitted_at) &&
    Boolean(job.prior_provider_expires_at);
}

function isSemanticRetryFinalizationState(job: AnalysisJobRow): boolean {
  return isSemanticRetrySubmissionUncertaintyState(job) || (
    job.status === "processing" &&
    job.semantic_retry_attempts === 1 &&
    job.provider_response_id == null &&
    job.provider_status === "in_progress" &&
    Boolean(job.prior_provider_response_id) &&
    Boolean(job.prior_provider_submitted_at) &&
    Boolean(job.prior_provider_expires_at)
  );
}

function providerContinuationClaimDisposition(
  job: AnalysisJobRow,
  webhookIdHash: string,
  now: Date,
  staleBeforeMs: number
): AnalysisJobProviderResponseClaimDisposition {
  if (job.is_historical === true || !job.provider_response_id ||
      (job.provider_status !== "queued" && job.provider_status !== "in_progress")) {
    return "not_found";
  }

  const expiresAt = safeTimeMs(job.provider_expires_at);
  if (expiresAt === null || expiresAt <= now.getTime()) return "expired";

  if (job.status === "processing") {
    return isStaleProcessingJob(job, staleBeforeMs) ? "claimed" : "busy";
  }
  if (job.status !== "queued" && job.status !== "failed_retryable") return "not_found";

  if (job.provider_webhook_id_hash !== webhookIdHash) return "claimed";
  const runAfter = safeTimeMs(job.run_after);
  return runAfter !== null && runAfter <= now.getTime() ? "claimed" : "backoff";
}

function safeProviderResponseId(value: unknown): string | null {
  return typeof value === "string" && /^resp_[A-Za-z0-9_-]{1,180}$/.test(value) ? value : null;
}

function safeAnalysisJobId(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function safeOpenAIWebhookId(value: unknown): string | null {
  return typeof value === "string" && /^wh_[A-Za-z0-9_-]{1,180}$/.test(value) ? value : null;
}

function supabaseAnalysisJobHeaders(config: AnalysisJobStoreConfig): HeadersInit {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`
  };
}

function getAnalysisJobStoreConfig(env = process.env): AnalysisJobStoreConfig | null {
  const status = getAnalysisJobQueueStatus(env);
  if (status.table !== DEFAULT_ANALYSIS_JOBS_TABLE) {
    throw new AnalysisJobQueueError("Analysis job canonical table configuration is invalid.");
  }
  if (status.missingEnv.length > 0 && !status.configured) {
    throw new AnalysisJobQueueError("Analysis job Supabase env is incomplete.");
  }

  if (status.mode !== "supabase") {
    return null;
  }

  const read = readAnalysisJobStoreEnv(env);
  return {
    url: trimTrailingSlash(read.url),
    serviceRoleKey: read.serviceRoleKey,
    table: read.table
  };
}

function readAnalysisJobStoreEnv(env = process.env) {
  return {
    url:
      env.AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL ||
      env.SUPABASE_URL ||
      "",
    serviceRoleKey:
      env.AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY ||
      env.SUPABASE_SERVICE_ROLE_KEY ||
      "",
    table: env.AGENTPROOF_ANALYSIS_JOBS_TABLE || DEFAULT_ANALYSIS_JOBS_TABLE
  };
}

function analysisJobQueueEnabled(env = process.env): boolean {
  return truthy(env.AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED);
}

function containsUnsafeJobString(value: unknown): boolean {
  if (typeof value === "string") {
    return /[?&](key|token|access_token|secret|signature)=/i.test(value);
  }

  if (!value || typeof value !== "object") return false;

  if (Array.isArray(value)) {
    return value.some(containsUnsafeJobString);
  }

  return Object.values(value).some(containsUnsafeJobString);
}

function findForbiddenKey(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findForbiddenKey(item);
      if (found) return found;
    }
    return null;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_JOB_KEYS.includes(normalizeKey(key))) return key;
    const found = findForbiddenKey(nested);
    if (found) return found;
  }

  return null;
}

function safeTenantId(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = redactSecrets(value).trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(normalized) ? normalized : null;
}

function safeRepositoryFullName(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = redactSecrets(value).trim();
  return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(normalized) ? normalized.slice(0, 200) : null;
}

function safeGitHubPullRequestUrl(value: string | undefined, repositoryFullName: string | null, pullRequestNumber: number | null): string | null {
  if (!value || !repositoryFullName || !pullRequestNumber) return null;

  try {
    const url = new URL(redactSecrets(value).trim());
    const [, owner, repo, pull, number] = url.pathname.split("/");
    const prNumber = Number(number);

    if (url.search || url.hash) return null;

    if (url.hostname !== "github.com" || pull !== "pull" || !owner || !repo || prNumber !== pullRequestNumber) {
      return null;
    }

    const fullName = `${owner}/${repo}`;
    if (fullName.toLowerCase() !== repositoryFullName.toLowerCase()) return null;

    return `https://github.com/${owner}/${repo}/pull/${pullRequestNumber}`;
  } catch {
    return null;
  }
}

function safeHeadSha(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = redactSecrets(value).trim();
  return /^[a-f0-9]{6,64}$/i.test(normalized) ? normalized : null;
}

function safeGitHubDeliveryId(value: string | undefined): string | null {
  if (!value) return null;
  return /^[a-f0-9-]{20,80}$/i.test(value) ? value : "unknown";
}

function safePositiveInteger(value: number | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function safeSlug(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = redactSecrets(value).trim();
  return /^[a-z0-9_.:-]{1,80}$/i.test(normalized) ? normalized : "unknown";
}

function safeJobErrorCode(value: string): string {
  const normalized = redactSecrets(value).trim();
  if (isProviderLookingIdentifier(normalized)) return "unknown";
  return /^[a-z0-9_.:-]{1,80}$/i.test(normalized) ? normalized : "unknown";
}

function safeJobErrorSummary(value: string): string {
  const withoutSecrets = redactSecrets(value)
    .replace(/authorization\s*:\s*bearer\s+\[redacted\]/gi, "[redacted-header]")
    .replace(/authorization\s*:\s*[^\s]+/gi, "[redacted-header]")
    .replace(/https?:\/\/[^\s<>"']+/gi, (match) => stripUrlQueryAndHash(match))
    .replace(/\s+/g, " ")
    .trim();
  const bounded = withoutSecrets.slice(0, MAX_ANALYSIS_JOB_ERROR_SUMMARY_LENGTH);

  return bounded || "Analysis job failed.";
}

function safePublicErrorSummary(value: string): string | undefined {
  const safe = safeJobErrorSummary(value).slice(0, 240);
  return safe || undefined;
}

function safeOptionalSummarySlug(value: string | undefined): string | undefined {
  return value ? safeJobErrorCode(value) : undefined;
}

function safeOptionalPercent(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : undefined;
}

function normalizeAnalysisJobListLimit(value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? Math.min(value, 25)
    : 10;
}

function normalizeAnalysisJobStatuses(values: AnalysisJobStatus[] | undefined): AnalysisJobStatus[] {
  if (!values) return [];

  const seen = new Set<AnalysisJobStatus>();
  for (const value of values) {
    const status = safeAnalysisJobStatus(value);
    if (status) seen.add(status);
  }

  return [...seen];
}

function normalizeAnalysisJobQueueSummaryLimit(value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? Math.min(value, MAX_ANALYSIS_JOB_QUEUE_SUMMARY_ROWS)
    : MAX_ANALYSIS_JOB_QUEUE_SUMMARY_ROWS;
}

function normalizeTenantAnalysisJobRollupLimit(value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? Math.min(value, MAX_TENANT_ANALYSIS_JOB_ROLLUP_ROWS)
    : MAX_TENANT_ANALYSIS_JOB_ROLLUP_ROWS;
}

function normalizeAnalysisJobDeadLetterSummaryLimit(value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? Math.min(value, MAX_ANALYSIS_JOB_DEAD_LETTER_SUMMARY_ROWS)
    : MAX_ANALYSIS_JOB_DEAD_LETTER_SUMMARY_ROWS;
}

function countFromContentRange(value: string | null): number | null {
  if (!value) return null;
  const total = value.split("/").at(1);
  if (!total || total === "*") return null;
  const count = Number(total);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

function stripUrlQueryAndHash(value: string): string {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, url.pathname === "/" ? "/" : "");
  } catch {
    return "[redacted-url]";
  }
}

function isProviderLookingIdentifier(value: string): boolean {
  return /(^|[^a-z0-9])(acct|cs|cus|evt|in|pi|pm|price|prod|si|sub)_[a-z0-9_:-]+/i.test(value);
}

function safeDurationMs(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.min(value, 24 * 60 * 60 * 1000);
}

function normalizeKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function hashJobKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalAnalysisJobKey(input: {
  tenantId: string | null;
  installationId: number;
  repositoryId: number | null;
  repositoryFullName: string;
  pullRequestNumber: number;
  headSha: string;
}): string {
  return hashJobKey([
    input.tenantId ?? "operator",
    String(input.installationId),
    input.repositoryId ? `id:${input.repositoryId}` : `name:${input.repositoryFullName.toLowerCase()}`,
    String(input.pullRequestNumber),
    input.headSha.toLowerCase()
  ].join("\u001f"));
}

function analysisJobStore() {
  const globalStore = globalThis as GlobalWithAnalysisJobs;
  globalStore.__agentproofAnalysisJobs ??= [];

  return globalStore.__agentproofAnalysisJobs;
}

function truthy(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
