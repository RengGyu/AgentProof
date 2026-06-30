import { randomUUID } from "crypto";
import { containsSecretPattern, redactSecrets } from "./redact";

export const DEFAULT_AUDIT_EVENTS_TABLE = "agentproof_audit_events";
export const MAX_MEMORY_AUDIT_EVENTS = 1000;

export type AuditEventAction =
  | "github_app_analysis_completed"
  | "github_app_analysis_failed"
  | "github_app_duplicate_skipped"
  | "github_app_grant_denied"
  | "github_app_idempotency_unavailable"
  | "github_app_not_ready"
  | "github_app_quota_blocked"
  | "github_app_quota_unavailable";

export type AuditEventResult = "blocked" | "completed" | "failed" | "skipped";

export interface AuditEventInput {
  action: AuditEventAction;
  result: AuditEventResult;
  actor?: "github_app" | "system";
  tenantId?: string;
  repositoryFullName?: string;
  installationId?: number;
  pullRequestNumber?: number;
  headSha?: string;
  githubDeliveryId?: string;
  webhookAction?: string;
  statusCode?: number;
  code?: string;
  priority?: string;
  evidenceCoverage?: number;
  savedReport?: {
    privacy?: string;
    durability?: string;
  };
  comment?: {
    action?: string;
  };
}

export interface AuditEventRow {
  id: string;
  created_at: string;
  actor: "github_app" | "system";
  action: AuditEventAction;
  result: AuditEventResult;
  tenant_id?: string | null;
  repository_full_name?: string | null;
  installation_id?: number | null;
  pull_request_number?: number | null;
  head_sha_prefix?: string | null;
  request_id?: string | null;
  status_code?: number | null;
  metadata: Record<string, unknown>;
}

export interface AuditLogStoreStatus {
  mode: "memory" | "supabase";
  configured: boolean;
  durable: boolean;
  table: string;
  missingEnv: string[];
}

interface AuditLogStoreConfig {
  url: string;
  serviceRoleKey: string;
  table: string;
}

type GlobalWithAuditLog = typeof globalThis & {
  __agentproofAuditEvents?: AuditEventRow[];
};

const FORBIDDEN_AUDIT_KEYS = [
  "access_token",
  "agent_claims",
  "authorization",
  "body",
  "claims",
  "comment_body",
  "comment_url",
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
  "saved_report_url",
  "secret",
  "signature",
  "token",
  "url",
  "webhook_payload"
];

export class AuditLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditLogError";
  }
}

export class AuditPrivacyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditPrivacyError";
  }
}

export async function recordAuditEvent(input: AuditEventInput, env = process.env): Promise<AuditEventRow> {
  const row = toAuditEventRow(input);
  assertAuditEventIsPrivate(row);
  const config = getAuditLogStoreConfig(env);

  if (config) {
    await createSupabaseAuditEvent(config, row);
  } else {
    createMemoryAuditEvent(row);
  }

  return row;
}

export function getAuditLogStoreStatus(env = process.env): AuditLogStoreStatus {
  const read = readAuditLogStoreEnv(env);

  if (read.url && read.serviceRoleKey) {
    return {
      mode: "supabase",
      configured: true,
      durable: true,
      table: read.table,
      missingEnv: []
    };
  }

  const missingEnv: string[] = [];
  if (read.url || read.serviceRoleKey) {
    if (!read.url) missingEnv.push("AGENTPROOF_AUDIT_SUPABASE_URL or SUPABASE_URL");
    if (!read.serviceRoleKey) {
      missingEnv.push("AGENTPROOF_AUDIT_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY");
    }
  }

  return {
    mode: "memory",
    configured: false,
    durable: false,
    table: read.table,
    missingEnv
  };
}

export function assertAuditEventIsPrivate(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (containsSecretPattern(serialized)) {
    throw new AuditPrivacyError("Audit event contains a secret-like value.");
  }

  if (containsUnsafeAuditString(value)) {
    throw new AuditPrivacyError("Audit event contains an unsafe URL or query value.");
  }

  const unsafeKey = findForbiddenKey(value);
  if (unsafeKey) {
    throw new AuditPrivacyError(`Audit event contains forbidden field ${unsafeKey}.`);
  }
}

export function getAuditEventsForTests(): AuditEventRow[] {
  return [...auditEventStore()];
}

export function clearAuditEventsForTests() {
  auditEventStore().splice(0, auditEventStore().length);
}

function toAuditEventRow(input: AuditEventInput): AuditEventRow {
  const createdAt = new Date();
  const metadata = {
    webhookAction: safeSlug(input.webhookAction),
    code: safeSlug(input.code),
    priority: safeSlug(input.priority),
    evidenceCoverage: safePercent(input.evidenceCoverage),
    savedReport: input.savedReport ? {
      privacy: safeSlug(input.savedReport.privacy),
      durability: safeDurability(input.savedReport.durability)
    } : undefined,
    comment: input.comment ? {
      action: safeSlug(input.comment.action)
    } : undefined
  };

  return {
    id: randomUUID(),
    created_at: createdAt.toISOString(),
    actor: input.actor ?? "github_app",
    action: input.action,
    result: input.result,
    tenant_id: safeTenantId(input.tenantId),
    repository_full_name: safeRepositoryFullName(input.repositoryFullName),
    installation_id: safePositiveInteger(input.installationId),
    pull_request_number: safePositiveInteger(input.pullRequestNumber),
    head_sha_prefix: safeHeadShaPrefix(input.headSha),
    request_id: safeGitHubDeliveryId(input.githubDeliveryId),
    status_code: safeStatusCode(input.statusCode),
    metadata: dropUndefined(metadata)
  };
}

async function createSupabaseAuditEvent(config: AuditLogStoreConfig, row: AuditEventRow) {
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
    throw new AuditLogError(`Audit event store failed with HTTP ${response.status}.`);
  }
}

function createMemoryAuditEvent(row: AuditEventRow) {
  auditEventStore().push(row);
  while (auditEventStore().length > MAX_MEMORY_AUDIT_EVENTS) {
    auditEventStore().shift();
  }
}

function getAuditLogStoreConfig(env = process.env): AuditLogStoreConfig | null {
  const status = getAuditLogStoreStatus(env);
  if (status.missingEnv.length > 0) {
    throw new AuditLogError("Audit log Supabase env is incomplete.");
  }

  if (status.mode !== "supabase") {
    return null;
  }

  const read = readAuditLogStoreEnv(env);
  return {
    url: trimTrailingSlash(read.url),
    serviceRoleKey: read.serviceRoleKey,
    table: read.table
  };
}

function readAuditLogStoreEnv(env = process.env) {
  return {
    url: env.AGENTPROOF_AUDIT_SUPABASE_URL || env.SUPABASE_URL || "",
    serviceRoleKey: env.AGENTPROOF_AUDIT_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "",
    table: env.AGENTPROOF_AUDIT_EVENTS_TABLE || DEFAULT_AUDIT_EVENTS_TABLE
  };
}

function findForbiddenKey(value: unknown, parentKey = ""): string | null {
  if (!value || typeof value !== "object") return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findForbiddenKey(item, parentKey);
      if (found) return found;
    }
    return null;
  }

  for (const [key, nested] of Object.entries(value)) {
    const normalized = normalizeAuditKey(key);
    if (FORBIDDEN_AUDIT_KEYS.includes(normalized)) return key;
    const found = findForbiddenKey(nested, key);
    if (found) return found;
  }

  return null;
}

function containsUnsafeAuditString(value: unknown): boolean {
  if (typeof value === "string") {
    return /[?&](key|token|access_token|secret|signature)=/i.test(value);
  }

  if (!value || typeof value !== "object") return false;

  if (Array.isArray(value)) {
    return value.some(containsUnsafeAuditString);
  }

  return Object.values(value).some(containsUnsafeAuditString);
}

function normalizeAuditKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function auditEventStore() {
  const globalStore = globalThis as GlobalWithAuditLog;
  globalStore.__agentproofAuditEvents ??= [];

  return globalStore.__agentproofAuditEvents;
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

function safeGitHubDeliveryId(value: string | undefined): string | null {
  if (!value) return null;
  return /^[a-f0-9-]{20,80}$/i.test(value) ? value : "unknown";
}

function safeHeadShaPrefix(value: string | undefined): string | null {
  if (!value || !/^[a-f0-9]{6,64}$/i.test(value)) return null;
  return value.slice(0, 12);
}

function safePositiveInteger(value: number | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function safeStatusCode(value: number | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function safePercent(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : undefined;
}

function safeSlug(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = redactSecrets(value).trim();
  return /^[a-z0-9_.:-]{1,80}$/i.test(normalized) ? normalized : "unknown";
}

function safeDurability(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = redactSecrets(value).trim();
  return /^[a-z0-9_.:-]{1,120}$/i.test(normalized) ? normalized : "unknown";
}

function dropUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
