import { createHash, randomUUID } from "crypto";
import { containsSecretPattern, redactSecrets } from "./redact";
import { authorizeTenantRepositoryGrantAsync } from "./tenant-control-plane";
import { assertTenantDeletionNotActiveAsync } from "./tenant-deletion-state";

export const DEFAULT_ANALYSIS_JOBS_TABLE = "agentproof_analysis_jobs";
export const MAX_MEMORY_ANALYSIS_JOBS = 1000;
export const DEFAULT_ANALYSIS_JOB_LEASE_MS = 10 * 60 * 1000;
export const DEFAULT_ANALYSIS_JOB_RETRY_AFTER_MS = 2 * 60 * 1000;
export const DEFAULT_ANALYSIS_JOB_MAX_ATTEMPTS = 5;
export const MAX_ANALYSIS_JOB_ERROR_SUMMARY_LENGTH = 500;
export const MAX_ANALYSIS_JOB_QUEUE_SUMMARY_ROWS = 1000;
export const MAX_TENANT_ANALYSIS_JOB_ROLLUP_ROWS = 1000;
export const MAX_ANALYSIS_JOB_DEAD_LETTER_SUMMARY_ROWS = 1000;
export const MAX_ANALYSIS_JOB_DEAD_LETTER_ERROR_CODES = 10;

export type AnalysisJobStatus = "queued" | "processing" | "completed" | "failed_retryable" | "failed_terminal";
export type AnalysisJobStatusFilter = "all" | "active" | "failed" | "completed";

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

export interface AnalysisJobClaimResult {
  job: AnalysisJobRow | null;
  store: "memory" | "supabase";
  durable: boolean;
}

export interface CompleteAnalysisJobInput {
  id: string;
  resultSummary?: AnalysisJobResultSummary;
  now?: Date;
}

export interface FailAnalysisJobInput {
  id: string;
  retryable: boolean;
  code: string;
  summary: string;
  now?: Date;
  retryAfterMs?: number;
  maxAttempts?: number;
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
  save_report: boolean;
  comment: boolean;
  attempts: number;
  created_at: string;
  updated_at: string;
  run_after: string;
  locked_at?: string | null;
  completed_at?: string | null;
  error_code?: string | null;
  error_summary?: string | null;
  result_summary?: AnalysisJobResultSummary | null;
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
  "save_report",
  "comment",
  "attempts",
  "created_at",
  "updated_at",
  "run_after",
  "locked_at",
  "completed_at",
  "error_code",
  "error_summary",
  "result_summary"
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
  "attempts",
  "created_at",
  "updated_at",
  "run_after",
  "completed_at",
  "error_code",
  "error_summary",
  "result_summary"
].join(",");

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
    await createSupabaseAnalysisJob(config, row);
    return {
      id: row.id,
      status: "queued",
      store: "supabase",
      durable: true
    };
  }

  if (!truthy(env.AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY)) {
    throw new AnalysisJobQueueError("Analysis job durable store is not configured.");
  }

  createMemoryAnalysisJob(row);
  return {
    id: row.id,
    status: "queued",
    store: "memory",
    durable: false
  };
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

export async function completeAnalysisJob(
  input: CompleteAnalysisJobInput,
  env = process.env
): Promise<boolean> {
  if (!analysisJobQueueEnabled(env)) {
    throw new AnalysisJobQueueError("Analysis job queue is not enabled.");
  }

  const config = getAnalysisJobStoreConfig(env);
  const now = input.now ?? new Date();
  const update = {
    status: "completed" as const,
    updated_at: now.toISOString(),
    completed_at: now.toISOString(),
    locked_at: null,
    error_code: null,
    error_summary: null,
    result_summary: input.resultSummary ? sanitizeAnalysisJobResultSummary(input.resultSummary) : null
  };

  assertAnalysisJobIsPrivate(update);

  if (config) {
    return Boolean(await patchSupabaseAnalysisJob(config, input.id, update, { currentStatus: "processing" }));
  }

  if (!truthy(env.AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY)) {
    throw new AnalysisJobQueueError("Analysis job durable store is not configured.");
  }

  return updateMemoryAnalysisJob(input.id, "processing", update);
}

export async function failAnalysisJob(
  input: FailAnalysisJobInput,
  env = process.env
): Promise<boolean> {
  if (!analysisJobQueueEnabled(env)) {
    throw new AnalysisJobQueueError("Analysis job queue is not enabled.");
  }

  const config = getAnalysisJobStoreConfig(env);
  const now = input.now ?? new Date();
  const retryAfterMs = safeDurationMs(input.retryAfterMs, DEFAULT_ANALYSIS_JOB_RETRY_AFTER_MS);
  const maxAttempts = Math.max(1, Math.min(20, input.maxAttempts ?? DEFAULT_ANALYSIS_JOB_MAX_ATTEMPTS));

  if (config) {
    const row = await getSupabaseAnalysisJobById(config, input.id);
    if (!row || row.status !== "processing") return false;
    const update = toAnalysisJobFailureUpdate(input, row.attempts, maxAttempts, now, retryAfterMs);
    return Boolean(await patchSupabaseAnalysisJob(config, input.id, update, { currentStatus: "processing" }));
  }

  if (!truthy(env.AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY)) {
    throw new AnalysisJobQueueError("Analysis job durable store is not configured.");
  }

  const row = analysisJobStore().find((job) => job.id === input.id);
  if (!row || row.status !== "processing") return false;

  const update = toAnalysisJobFailureUpdate(input, row.attempts, maxAttempts, now, retryAfterMs);
  return updateMemoryAnalysisJob(input.id, "processing", update);
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

  if (read.url && read.serviceRoleKey) {
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
  if (read.url || read.serviceRoleKey) {
    if (!read.url) missingEnv.push("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL or SUPABASE_URL");
    if (!read.serviceRoleKey) {
      missingEnv.push("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY");
    }
  }

  if (truthy(env.AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY)) {
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
    save_report: input.saveReport === true,
    comment: input.comment === true,
    attempts: 0,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    run_after: now.toISOString(),
    locked_at: null,
    completed_at: null,
    error_code: null,
    error_summary: null,
    result_summary: null
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

async function createSupabaseAnalysisJob(config: AnalysisJobStoreConfig, row: AnalysisJobRow) {
  const response = await fetch(`${config.url}/rest/v1/${encodeURIComponent(config.table)}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify(row)
  });

  if (!response.ok) {
    throw new AnalysisJobQueueError(`Analysis job store failed with HTTP ${response.status}.`);
  }
}

function createMemoryAnalysisJob(row: AnalysisJobRow) {
  analysisJobStore().push(row);
  while (analysisJobStore().length > MAX_MEMORY_ANALYSIS_JOBS) {
    analysisJobStore().shift();
  }
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
    if (job.tenant_id !== tenantId) continue;
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
    .filter((job) => job.tenant_id === tenantId)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, limit)
    .map((job) => ({ status: job.status }));
}

async function listSupabaseAnalysisJobSummaryRows(
  config: AnalysisJobStoreConfig,
  limit: number
): Promise<AnalysisJobQueueSummaryRow[]> {
  const params = new URLSearchParams([
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
    .slice()
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
    .filter((job) => job.status === "failed_terminal")
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

    if (claimed) return claimed;
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

  return patchSupabaseAnalysisJob(config, stale.id, toClaimedAnalysisJobUpdate(stale, now), {
    currentStatus: "processing",
    currentUpdatedAt: stale.updated_at,
    returnRepresentation: true
  });
}

function claimMemoryAnalysisJob(now: Date, leaseMs: number): AnalysisJobRow | null {
  const store = analysisJobStore();
  const due = store.find((job) => isDueQueuedJob(job, now));
  const staleBefore = now.getTime() - leaseMs;
  const stale = due ?? store.find((job) => isStaleProcessingJob(job, staleBefore));

  if (!stale) return null;

  Object.assign(stale, toClaimedAnalysisJobUpdate(stale, now));
  assertAnalysisJobIsPrivate(stale);

  return { ...stale };
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

  const job = row as AnalysisJobRow;
  assertAnalysisJobIsPrivate(job);
  return job;
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

  const job = row as AnalysisJobRow;
  assertAnalysisJobIsPrivate(job);
  return job;
}

async function patchSupabaseAnalysisJob(
  config: AnalysisJobStoreConfig,
  id: string,
  update: Partial<AnalysisJobRow>,
  options: {
    currentStatus?: AnalysisJobStatus;
    currentUpdatedAt?: string;
    returnRepresentation?: boolean;
  } = {}
): Promise<AnalysisJobRow | null> {
  assertAnalysisJobIsPrivate(update);

  const params = new URLSearchParams([
    ["id", `eq.${id}`],
    ["select", ANALYSIS_JOB_SELECT]
  ]);

  if (options.currentStatus) {
    params.append("status", `eq.${options.currentStatus}`);
  }

  if (options.currentUpdatedAt) {
    params.append("updated_at", `eq.${options.currentUpdatedAt}`);
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

  const job = row as AnalysisJobRow;
  assertAnalysisJobIsPrivate(job);
  return job;
}

function updateMemoryAnalysisJob(
  id: string,
  currentStatus: AnalysisJobStatus,
  update: Partial<AnalysisJobRow>
): boolean {
  assertAnalysisJobIsPrivate(update);
  const row = analysisJobStore().find((job) => job.id === id && job.status === currentStatus);
  if (!row) return false;

  Object.assign(row, update);
  assertAnalysisJobIsPrivate(row);
  return true;
}

function toClaimedAnalysisJobUpdate(row: AnalysisJobRow, now: Date): Partial<AnalysisJobRow> {
  return {
    status: "processing",
    attempts: Math.max(0, Number(row.attempts) || 0) + 1,
    updated_at: now.toISOString(),
    locked_at: now.toISOString(),
    completed_at: null,
    error_code: null,
    error_summary: null,
    result_summary: null
  };
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
    result_summary: null
  };

  assertAnalysisJobIsPrivate(update);
  return update;
}

function toTenantAnalysisJobSummary(row: AnalysisJobRow): TenantAnalysisJobSummary {
  const result = row.result_summary
    ? {
      priority: safeOptionalSummarySlug(row.result_summary.priority),
      evidenceCoverage: safeOptionalPercent(row.result_summary.evidenceCoverage),
      savedReport: row.result_summary.savedReport
        ? {
          privacy: safeOptionalSummarySlug(row.result_summary.savedReport.privacy),
          durability: safeOptionalSummarySlug(row.result_summary.savedReport.durability)
        }
        : undefined,
      comment: row.result_summary.comment
        ? {
          action: safeOptionalSummarySlug(row.result_summary.comment.action)
        }
        : undefined
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
      comment: row.comment
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
  return (job.status === "queued" || job.status === "failed_retryable") &&
    new Date(job.run_after).getTime() <= now.getTime();
}

function isStaleProcessingJob(job: AnalysisJobRow, staleBeforeMs: number): boolean {
  if (job.status !== "processing" || !job.locked_at) return false;
  return new Date(job.locked_at).getTime() < staleBeforeMs;
}

function supabaseAnalysisJobHeaders(config: AnalysisJobStoreConfig): HeadersInit {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`
  };
}

function getAnalysisJobStoreConfig(env = process.env): AnalysisJobStoreConfig | null {
  const status = getAnalysisJobQueueStatus(env);
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
