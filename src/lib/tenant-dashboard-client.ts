import { redactSecrets } from "./redact";

export type TenantRepositorySettingKey =
  | "enabled"
  | "analysisEnabled"
  | "saveReportsEnabled"
  | "commentEnabled"
  | "slackNotificationsEnabled";

export function tenantInviteHeaders(inviteToken: string): HeadersInit {
  const token = inviteToken.trim();
  return token ? { "x-agentproof-beta-invite-token": token } : {};
}

export function tenantSessionPayload(input: { tenantId: string }): {
  tenantId: string;
} {
  return {
    tenantId: input.tenantId.trim()
  };
}

export function tenantSettingsUrl(tenantId: string): string {
  const params = new URLSearchParams({ tenantId: tenantId.trim() });

  return `/api/tenants/repositories?${params.toString()}`;
}

export function tenantHealthUrl(
  tenantId: string,
  options: { probeGitHub?: boolean; repositoryId?: number; pullRequestNumber?: number } = {}
): string {
  const params = new URLSearchParams({ tenantId: tenantId.trim() });

  if (options.probeGitHub) params.set("probe", "github");
  if (isPositiveInteger(options.repositoryId)) params.set("repositoryId", String(options.repositoryId));
  if (isPositiveInteger(options.pullRequestNumber)) params.set("pullRequestNumber", String(options.pullRequestNumber));

  return `/api/tenants/repositories/health?${params.toString()}`;
}

export function tenantUsageUrl(tenantId: string): string {
  const params = new URLSearchParams({ tenantId: tenantId.trim() });

  return `/api/tenants/usage?${params.toString()}`;
}

export function tenantAccountUrl(tenantId: string): string {
  const params = new URLSearchParams({ tenantId: tenantId.trim() });

  return `/api/tenants/account?${params.toString()}`;
}

export function tenantEntitlementsUrl(tenantId: string): string {
  const params = new URLSearchParams({ tenantId: tenantId.trim() });

  return `/api/tenants/entitlements?${params.toString()}`;
}

export type TenantReportPriorityFilter = "all" | "blocker" | "high" | "medium" | "low";
export type TenantReportStatusFilter = "all" | "missing_tests" | "scope_creep" | "weak_evidence";

export interface TenantReportUrlOptions {
  priority?: TenantReportPriorityFilter;
  status?: TenantReportStatusFilter;
  query?: string;
}

export function tenantReportsUrl(tenantId: string, limit = 10, options: TenantReportUrlOptions = {}): string {
  const params = new URLSearchParams({
    tenantId: tenantId.trim(),
    limit: String(Math.min(Math.max(Math.trunc(limit), 1), 25))
  });

  if (options.priority && options.priority !== "all") params.set("priority", options.priority);
  if (options.status && options.status !== "all") params.set("status", options.status);
  const query = sanitizeTenantReportQuery(options.query);
  if (query) params.set("query", query);

  return `/api/tenants/reports?${params.toString()}`;
}

export function tenantAnalysisJobsUrl(
  tenantId: string,
  limit = 10,
  status: "all" | "active" | "failed" | "completed" = "all"
): string {
  const params = new URLSearchParams({
    tenantId: tenantId.trim(),
    limit: String(Math.min(Math.max(Math.trunc(limit), 1), 25))
  });

  if (status !== "all") params.set("status", status);

  return `/api/tenants/analysis-jobs?${params.toString()}`;
}

export function tenantDeletionPreviewUrl(tenantId: string): string {
  const params = new URLSearchParams({ tenantId: tenantId.trim() });

  return `/api/tenants/deletion-preview?${params.toString()}`;
}

export function tenantAuditActivityUrl(tenantId: string, limit = 10): string {
  const params = new URLSearchParams({
    tenantId: tenantId.trim(),
    limit: String(Math.min(Math.max(Math.trunc(limit), 1), 25))
  });

  return `/api/tenants/audit-activity?${params.toString()}`;
}

export function tenantAuditExportUrl(tenantId: string, limit = 100): string {
  const params = new URLSearchParams({
    tenantId: tenantId.trim(),
    limit: String(normalizeTenantAuditExportClientLimit(limit))
  });

  return `/api/tenants/audit-export?${params.toString()}`;
}

export function tenantOnboardingStartPayload(tenantId: string): { tenantId: string } {
  return { tenantId: tenantId.trim() };
}

export function tenantSettingsPatchPayload(input: {
  tenantId: string;
  installationId: number;
  repositoryId: number;
  setting: TenantRepositorySettingKey;
  value: boolean;
}): {
  tenantId: string;
  installationId: number;
  repositoryId: number;
  settings: Partial<Record<TenantRepositorySettingKey, boolean>>;
} {
  return {
    tenantId: input.tenantId.trim(),
    installationId: input.installationId,
    repositoryId: input.repositoryId,
    settings: { [input.setting]: input.value }
  };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function normalizeTenantAuditExportClientLimit(value: number): number {
  if (!Number.isFinite(value)) return 100;

  return Math.min(Math.max(Math.trunc(value), 1), 250);
}

function sanitizeTenantReportQuery(value: string | undefined): string {
  if (!value) return "";

  return stripReportFilterForbiddenTerms(redactReportFilterSecrets(redactSecrets(value)))
    .replace(/[^a-zA-Z0-9_.:/#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function redactReportFilterSecrets(value: string): string {
  return value.replace(/\b(?:key|api_key|token|secret|password)\s*[:=]\s*["']?[^"'\s]+/gi, "[redacted]");
}

function stripReportFilterForbiddenTerms(value: string): string {
  return value.replace(
    /\b(rawDiff|rawLog|rawPatch|evidenceIndex|claims|reprompt|reportBody|savedReportUrl|commentBody|payload|serviceRole|service-role|table)\b/gi,
    " "
  );
}
