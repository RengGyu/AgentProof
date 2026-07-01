export type TenantSetupWarningSeverity = "critical" | "warning" | "info";

export interface TenantSetupWarning {
  key: string;
  severity: TenantSetupWarningSeverity;
  label: string;
  detail: string;
  action: string;
}

export interface TenantSetupWarningRollup {
  privacy: "tenant-setup-warning-rollup-summary-only";
  basis: "loaded_dashboard_summaries";
  counts: Record<TenantSetupWarningSeverity, number> & { total: number };
  warnings: TenantSetupWarning[];
  next: "load_setup_summaries" | "fix_blocking_setup" | "review_setup_warnings" | "ready_for_first_report";
}

export interface TenantSetupAccountInput {
  account: {
    status: string;
    configured: boolean;
  };
  roleCounts: {
    owner: number;
    admin: number;
    member: number;
  };
}

export interface TenantSetupEntitlementInput {
  quota: {
    state: string;
    configured: boolean;
    enforced: boolean;
  };
  repositories: {
    state: string;
    connectedRepositoryCount?: number;
    analysisEnabledCount?: number;
  };
  features: Array<{
    key: string;
    state: string;
    enabled: boolean;
  }>;
}

export interface TenantSetupRepositoryHealthInput {
  status: string;
  githubAccess: string;
}

export interface TenantSetupUsageInput {
  state: string;
}

export interface TenantSetupAnalysisJobSummaryInput {
  counts: {
    failed: number;
    terminal: number;
    active: number;
  };
}

export interface TenantSetupWarningInput {
  account?: TenantSetupAccountInput | null;
  entitlements?: TenantSetupEntitlementInput | null;
  repositoryHealth?: TenantSetupRepositoryHealthInput[];
  usage?: TenantSetupUsageInput[];
  analysisJobs?: TenantSetupAnalysisJobSummaryInput | null;
}

export function buildTenantSetupWarningRollup(input: TenantSetupWarningInput): TenantSetupWarningRollup {
  const warnings: TenantSetupWarning[] = [
    ...accountWarnings(input.account),
    ...entitlementWarnings(input.entitlements),
    ...repositoryHealthWarnings(input.repositoryHealth),
    ...usageWarnings(input.usage),
    ...analysisJobWarnings(input.analysisJobs)
  ];
  const counts = {
    critical: warnings.filter((item) => item.severity === "critical").length,
    warning: warnings.filter((item) => item.severity === "warning").length,
    info: warnings.filter((item) => item.severity === "info").length,
    total: warnings.length
  };

  return {
    privacy: "tenant-setup-warning-rollup-summary-only",
    basis: "loaded_dashboard_summaries",
    counts,
    warnings,
    next: nextWarningAction(counts)
  };
}

function accountWarnings(account: TenantSetupAccountInput | null | undefined): TenantSetupWarning[] {
  if (!account) {
    return [warning("account_not_loaded", "info", "Account summary not loaded", "Load the tenant account summary before setup review.", "Load Account")];
  }

  if (account.account.status === "suspended" || account.account.status === "deleted") {
    return [warning("account_not_active", "critical", "Tenant account is not active", "Account status blocks reliable evidence report activation.", "Review Account")];
  }

  if (!account.account.configured || account.account.status === "unknown") {
    return [warning("account_metadata_incomplete", "warning", "Tenant account metadata is incomplete", "Account summary is still invite-only or unavailable.", "Configure Account")];
  }

  if (account.roleCounts.owner < 1) {
    return [warning("owner_missing", "warning", "No owner role in account summary", "At least one owner should be visible in summary metadata.", "Review Members")];
  }

  return [];
}

function entitlementWarnings(entitlements: TenantSetupEntitlementInput | null | undefined): TenantSetupWarning[] {
  if (!entitlements) {
    return [warning("plan_access_not_loaded", "info", "Plan access summary not loaded", "Load plan access before reviewing feature readiness.", "Load Access")];
  }

  const warnings: TenantSetupWarning[] = [];
  if (entitlements.repositories.state === "not_configured" || (entitlements.repositories.connectedRepositoryCount ?? 0) < 1) {
    warnings.push(warning("repository_grants_missing", "critical", "No connected repository ready", "Connect at least one repository grant for PR verification.", "Grant Repository"));
  } else if ((entitlements.repositories.analysisEnabledCount ?? 0) < 1) {
    warnings.push(warning("repository_analysis_disabled", "critical", "No repository has analysis enabled", "Enable evidence reports on at least one repository.", "Enable Analysis"));
  } else if (entitlements.repositories.state === "unavailable") {
    warnings.push(warning("repository_summary_unavailable", "warning", "Repository grant summary unavailable", "Repository setup could not be summarized from loaded metadata.", "Reload Settings"));
  }

  if (entitlements.quota.state === "exhausted") {
    warnings.push(warning("quota_exhausted", "critical", "Verification quota is exhausted", "Quota blocks new evidence report runs before provider work starts.", "Review Usage"));
  } else if (["not_configured", "unavailable", "unclear"].includes(entitlements.quota.state)) {
    warnings.push(warning("quota_unclear", "warning", "Verification quota state is not ready", "Quota status should be clear before design partner activation.", "Review Usage"));
  }

  const blockedFeatureCount = entitlements.features.filter((feature) =>
    feature.key !== "slack_summaries" &&
    ["disabled", "unavailable", "unclear"].includes(feature.state)
  ).length;
  if (blockedFeatureCount > 0) {
    warnings.push(warning("feature_gates_blocked", "warning", "Feature access has blocked items", `${blockedFeatureCount} loaded feature gates need review.`, "Review Plan"));
  }

  return warnings;
}

function repositoryHealthWarnings(repositoryHealth: TenantSetupRepositoryHealthInput[] | undefined): TenantSetupWarning[] {
  if (!repositoryHealth || repositoryHealth.length === 0) {
    return [warning("repository_health_not_loaded", "info", "Repository health not loaded", "Load repository health before first report activation.", "Load Health")];
  }

  const criticalStatuses = new Set([
    "disabled",
    "analysis-disabled",
    "installation-suspended",
    "installation-deleted",
    "app-credentials-not-ready",
    "github-inaccessible"
  ]);
  const warningStatuses = new Set(["github-rate-limited", "github-unavailable"]);
  const notCheckedCount = repositoryHealth.filter((item) => item.status === "github-not-checked").length;
  const criticalCount = repositoryHealth.filter((item) => criticalStatuses.has(item.status)).length;
  const warningCount = repositoryHealth.filter((item) => warningStatuses.has(item.status)).length;
  const warnings: TenantSetupWarning[] = [];

  if (criticalCount > 0) {
    warnings.push(warning("repository_health_blocking", "critical", "Repository setup has blocking health checks", `${criticalCount} repositories need setup fixes.`, "Fix Repositories"));
  }
  if (warningCount > 0) {
    warnings.push(warning("repository_health_provider_warning", "warning", "Repository provider checks need retry", `${warningCount} repositories have provider access warnings.`, "Retry Probe"));
  }
  if (notCheckedCount > 0) {
    warnings.push(warning("repository_health_not_checked", "info", "Live repository access not checked", `${notCheckedCount} repositories have metadata-only health status.`, "Probe Access"));
  }

  return warnings;
}

function usageWarnings(usage: TenantSetupUsageInput[] | undefined): TenantSetupWarning[] {
  if (!usage || usage.length === 0) return [];

  const exhaustedCount = usage.filter((item) => item.state === "exhausted").length;
  if (exhaustedCount < 1) return [];

  return [warning("usage_exhausted", "critical", "Usage summary has exhausted quota", `${exhaustedCount} usage summaries are exhausted.`, "Review Usage")];
}

function analysisJobWarnings(analysisJobs: TenantSetupAnalysisJobSummaryInput | null | undefined): TenantSetupWarning[] {
  if (!analysisJobs) return [];

  if (analysisJobs.counts.terminal > 0) {
    return [warning("analysis_jobs_terminal", "warning", "Analysis jobs need attention", `${analysisJobs.counts.terminal} terminal analysis jobs are in the recent sample.`, "Review Jobs")];
  }

  if (analysisJobs.counts.failed > 0) {
    return [warning("analysis_jobs_failed", "info", "Recent analysis jobs include failures", `${analysisJobs.counts.failed} failed jobs are visible in the summary sample.`, "Review Jobs")];
  }

  return [];
}

function warning(
  key: string,
  severity: TenantSetupWarningSeverity,
  label: string,
  detail: string,
  action: string
): TenantSetupWarning {
  return { key, severity, label, detail, action };
}

function nextWarningAction(counts: TenantSetupWarningRollup["counts"]): TenantSetupWarningRollup["next"] {
  if (counts.critical > 0) return "fix_blocking_setup";
  if (counts.warning > 0) return "review_setup_warnings";
  if (counts.info > 0) return "load_setup_summaries";

  return "ready_for_first_report";
}
