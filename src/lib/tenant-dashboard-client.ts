export type TenantRepositorySettingKey =
  | "enabled"
  | "analysisEnabled"
  | "saveReportsEnabled"
  | "commentEnabled";

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
  options: { probeGitHub?: boolean; repositoryId?: number } = {}
): string {
  const params = new URLSearchParams({ tenantId: tenantId.trim() });

  if (options.probeGitHub) params.set("probe", "github");
  if (isPositiveInteger(options.repositoryId)) params.set("repositoryId", String(options.repositoryId));

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

export function tenantReportsUrl(tenantId: string, limit = 10): string {
  const params = new URLSearchParams({
    tenantId: tenantId.trim(),
    limit: String(Math.min(Math.max(Math.trunc(limit), 1), 25))
  });

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
