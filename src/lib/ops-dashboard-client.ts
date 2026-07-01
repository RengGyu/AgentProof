export function opsTokenHeaders(token: string): HeadersInit {
  const trimmed = token.trim();
  return trimmed ? { "x-agentproof-ops-token": trimmed } : {};
}

export function opsGitHubAppStatusUrl(): string {
  return "/api/ops/github-app/status";
}

export function opsDeadLetterUrl(limit = 25): string {
  const params = new URLSearchParams({
    limit: String(clampLimit(limit))
  });

  return `/api/ops/analysis-jobs/dead-letter?${params.toString()}`;
}

export function opsDrillGateUrl(): string {
  return "/api/ops/drill-gate";
}

export function opsTenantDeletionPlanUrl(tenantId: string): string {
  const params = new URLSearchParams({
    tenantId: tenantId.trim()
  });

  return `/api/ops/tenants/deletion?${params.toString()}`;
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return 25;
  return Math.min(Math.max(Math.trunc(value), 1), 100);
}
