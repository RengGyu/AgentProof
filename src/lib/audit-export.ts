import { listTenantAuditEvents, type TenantAuditActivitySummary } from "./audit-log";

export const TENANT_AUDIT_EXPORT_SCHEMA_VERSION = "2026-07-01";
export const TENANT_AUDIT_EXPORT_PRIVACY = "tenant-audit-export-summary-only";
export const DEFAULT_TENANT_AUDIT_EXPORT_LIMIT = 100;
export const MAX_TENANT_AUDIT_EXPORT_LIMIT = 250;

export interface TenantAuditExportEvent {
  id: string;
  createdAt: string;
  actor: TenantAuditActivitySummary["actor"];
  action: TenantAuditActivitySummary["action"];
  result: TenantAuditActivitySummary["result"];
  repositoryFullName?: string;
  pullRequestNumber?: number;
  headShaPrefix?: string;
  deliveryIdPrefix?: string;
  statusCode?: number;
  webhookAction?: string;
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

export interface TenantAuditExport {
  ok: true;
  tenantId: string;
  generatedAt: string;
  schemaVersion: typeof TENANT_AUDIT_EXPORT_SCHEMA_VERSION;
  privacy: typeof TENANT_AUDIT_EXPORT_PRIVACY;
  events: TenantAuditExportEvent[];
  count: number;
  limit: number;
  truncated: boolean;
}

export async function buildTenantAuditExport(
  input: { tenantId: string; limit?: number; now?: Date },
  env = process.env
): Promise<TenantAuditExport> {
  const limit = normalizeTenantAuditExportLimit(input.limit);
  const rows = await listTenantAuditEvents({ tenantId: input.tenantId, limit: limit + 1 }, env);
  const events = rows.slice(0, limit).map(toExportEvent);

  return {
    ok: true,
    tenantId: input.tenantId,
    generatedAt: (input.now ?? new Date()).toISOString(),
    schemaVersion: TENANT_AUDIT_EXPORT_SCHEMA_VERSION,
    privacy: TENANT_AUDIT_EXPORT_PRIVACY,
    events,
    count: events.length,
    limit,
    truncated: rows.length > limit
  };
}

function toExportEvent(row: TenantAuditActivitySummary): TenantAuditExportEvent {
  return dropUndefined({
    id: row.id,
    createdAt: row.createdAt,
    actor: row.actor,
    action: row.action,
    result: row.result,
    repositoryFullName: row.repositoryFullName,
    pullRequestNumber: row.pullRequestNumber,
    headShaPrefix: row.headShaPrefix,
    deliveryIdPrefix: row.deliveryIdPrefix,
    statusCode: row.statusCode,
    webhookAction: row.webhookAction,
    code: row.code,
    priority: row.priority,
    evidenceCoverage: row.evidenceCoverage,
    savedReport: objectWithDefinedValues({
      privacy: row.savedReport?.privacy,
      durability: row.savedReport?.durability
    }),
    comment: objectWithDefinedValues({
      action: row.comment?.action
    })
  });
}

export function normalizeTenantAuditExportLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return DEFAULT_TENANT_AUDIT_EXPORT_LIMIT;
  }

  return Math.min(value, MAX_TENANT_AUDIT_EXPORT_LIMIT);
}

function objectWithDefinedValues<T extends Record<string, unknown>>(value: T): Partial<T> | undefined {
  const cleaned = dropUndefined(value);
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

function dropUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
