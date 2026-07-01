"use client";

import {
  AlertTriangle,
  Activity,
  BarChart3,
  CheckCircle2,
  CreditCard,
  Database,
  Download,
  ExternalLink,
  FileText,
  GitBranch,
  Loader2,
  RefreshCcw,
  ShieldCheck,
  SlidersHorizontal,
  UsersRound
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { buildTenantSetupWarningRollup } from "@/lib/tenant-dashboard-warnings";
import {
  tenantHealthUrl,
  tenantInviteHeaders,
  tenantMutationHeaders,
  tenantAnalysisJobsUrl,
  tenantAccountUrl,
  tenantAuditActivityUrl,
  tenantAuditExportUrl,
  tenantBillingPortalPayload,
  tenantDeletionPreviewUrl,
  tenantEntitlementsUrl,
  tenantOnboardingStartPayload,
  tenantReportsUrl,
  tenantSessionPayload,
  tenantSettingsPatchPayload,
  tenantSettingsUrl,
  tenantUsageUrl,
  type TenantReportPriorityFilter,
  type TenantReportStatusFilter,
  type TenantRepositorySettingKey
} from "@/lib/tenant-dashboard-client";

interface RepositorySettings {
  installationId: number;
  repositoryId?: number;
  repositoryFullName: string;
  enabled: boolean;
  analysisEnabled: boolean;
  saveReportsEnabled: boolean;
  commentEnabled: boolean;
  slackNotificationsEnabled: boolean;
}

interface RepositoryHealth extends RepositorySettings {
  status: string;
  githubAccess: string;
  checks: {
    grantActive: boolean;
    analysisEnabled: boolean;
    appCredentialsReady: boolean;
    githubAccess: string;
  };
  firstReport?: FirstReportDiagnostics;
  nextAction: string;
}

interface FirstReportDiagnostics {
  privacy: "first-report-readiness-metadata-only";
  pullRequestNumber: number;
  status: string;
  pullRequestAccess: string;
  changedFiles: {
    status: string;
    count?: number;
    maxFiles: number;
  };
  checksAvailability: {
    status: string;
    sources: Array<"check-runs" | "commit-statuses">;
  };
  nextAction: string;
}

interface InstalledRepository {
  id: number;
  fullName: string;
  private: boolean;
  defaultBranch?: string;
}

interface TenantAccountSummary {
  tenantId: string;
  name: string;
  status: string;
  plan: string;
  configured: boolean;
  memberCount: number;
  membersTruncated: boolean;
}

interface TenantMemberSummary {
  memberId: string;
  role: "owner" | "admin" | "member";
  status: "active" | "invited" | "disabled";
}

interface TenantAccountStatus {
  account: TenantAccountSummary;
  members: TenantMemberSummary[];
  roleCounts: {
    owner: number;
    admin: number;
    member: number;
  };
  privacy: "tenant-account-summary-only";
  next: "manage_member_roles" | "configure_account_store";
}

interface TenantEntitlementFeature {
  key: string;
  label: string;
  state: "enabled" | "disabled" | "not_configured" | "unavailable" | "unclear";
  enabled: boolean;
  reason?: string;
}

interface TenantEntitlementStatus {
  plan: string;
  account: {
    status: string;
    configured: boolean;
    source: "tenant_account_summary" | "unavailable";
  };
  billing: {
    privacy: "billing-beta-summary-only";
    configured: boolean;
    providerBacked: boolean;
    subscriptionStatus: string;
    plan?: string;
    portal: {
      available: boolean;
      mode: "server_redirect_required" | "not_configured";
    };
    webhooks: {
      idempotency: "configured" | "not_configured";
    };
  };
  quota: {
    state: "available" | "exhausted" | "not_configured" | "not_enforced" | "unavailable" | "unclear";
    configured: boolean;
    enforced: boolean;
    limit?: number;
    used?: number;
    remaining?: number;
    plan?: string;
    planMatchesAccount?: boolean;
    planMatchesBilling?: boolean;
  };
  repositories: {
    state: "configured" | "not_configured" | "unavailable";
    connectedRepositoryCount?: number;
    analysisEnabledCount?: number;
    saveReportsEnabledCount?: number;
    commentEnabledCount?: number;
    slackNotificationsEnabledCount?: number;
  };
  features: TenantEntitlementFeature[];
  privacy: "plan-entitlement-summary-only";
  next: "review_plan_access" | "configure_plan_access";
}

interface TenantBillingPortalStatus {
  ok: boolean;
  tenantId: string;
  billing: {
    privacy: "billing-portal-session-boundary-only";
    configured: boolean;
    providerBacked: boolean;
    subscriptionStatus: string;
    plan?: string;
    portal: {
      available: boolean;
      mode: "server_redirect_required" | "not_configured";
    };
    status: "ready" | "not_configured" | "manual_review_required" | "unavailable";
    reason?: string;
    next: string;
  };
  privacy: "billing-portal-session-boundary-only";
  next: string;
}

interface UsageSummary {
  feature: string;
  label: string;
  enforced: boolean;
  configured: boolean;
  plan?: string;
  limit?: number;
  used?: number;
  remaining?: number;
  state: "available" | "exhausted" | "not-configured" | "not-enforced";
  note?: string;
}

interface AuditSummary {
  id: string;
  createdAt: string;
  actor: "github_app" | "system";
  action: string;
  result: string;
  repositoryFullName?: string;
  installationId?: number;
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

interface ReportSummary {
  id: string;
  createdAt: string;
  expiresAt: string;
  sourceTitle: string;
  sourceUrl?: string;
  priority: string;
  evidenceCoverage: number;
  requirementCounts: {
    met: number;
    partial: number;
    missing: number;
    unclear: number;
  };
  testing: {
    ciStatus: string;
    lintStatus: string;
    typecheckStatus: string;
    missingTestCount: number;
  };
  reviewPriorityCount: number;
  scopeCreepSuspected: boolean;
  privacy: "summary-only";
}

interface TenantReportFilterSummary {
  priority: TenantReportPriorityFilter;
  status: TenantReportStatusFilter;
  query?: string;
}

interface AnalysisJobSummary {
  id: string;
  status: string;
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

interface AnalysisJobFilterSummary {
  privacy: "analysis-job-tenant-rollup-summary-only";
  basis: "tenant_recent_sample";
  sampled: number;
  truncated: boolean;
  statusCounts: {
    queued: number;
    processing: number;
    completed: number;
    failed_retryable: number;
    failed_terminal: number;
  };
  counts: {
    active: number;
    failed: number;
    completed: number;
    retrying: number;
    terminal: number;
  };
}

interface TenantDeletionPreviewCategory {
  key: "saved_reports" | "repository_grants" | "github_installations" | "webhook_deliveries" | "analysis_jobs" | "audit_events" | "usage_records";
  status: "ready" | "disabled" | "unavailable" | "manual_review_required";
  count?: number;
  reason?: "store-disabled" | "store-unavailable" | "manual-removal-required" | "policy-review-required" | "policy-blocked";
}

interface TenantDeletionPreview {
  ok: true;
  privacy: "tenant-deletion-preview-counts-only";
  mode: "dry-run";
  destructive: false;
  tenantId: string;
  categories: TenantDeletionPreviewCategory[];
  totals: {
    knownCount: number;
    unavailableCategories: number;
  };
  retentionPolicy: {
    status: "draft";
    version: string;
    note: string;
    coverage: {
      countedCategories: TenantDeletionPreviewCategory["key"][];
      uncountedCategories: Array<{
        key: string;
        reason: "not-stored" | "not-yet-counted";
      }>;
      totalCategories: number;
    };
    deletionPlan?: Array<{
      key: string;
      deletionMode: "not-stored" | "ttl-only" | "automatic" | "manual-review" | "tombstone";
      deletionReadiness: "not-applicable" | "ready" | "manual-review-required" | "blocked";
      retentionWindowDays: number;
      retentionWindowTrigger: string;
      deletionBlockers: string[];
    }>;
  };
  next: "review_retention_policy_before_delete";
}

interface ApiErrorBody {
  error?: string;
  code?: string;
}

interface TenantAuditExportStatus {
  ok: true;
  tenantId: string;
  generatedAt: string;
  schemaVersion: "2026-07-01";
  privacy: "tenant-audit-export-summary-only";
  events: AuditSummary[];
  count: number;
  limit: number;
  truncated: boolean;
}

type PanelMode = "idle" | "loading" | "saving" | "probing";
type AnalysisJobFilter = "all" | "failed" | "active" | "completed";

const settingLabels = {
  enabled: "Grant enabled",
  analysisEnabled: "Run evidence reports",
  saveReportsEnabled: "Save summary links",
  commentEnabled: "Marker comments",
  slackNotificationsEnabled: "Slack summaries"
} satisfies Record<TenantRepositorySettingKey, string>;

export function TenantSetupPanel() {
  const [tenantId, setTenantId] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [sessionActive, setSessionActive] = useState(false);
  const [installationId, setInstallationId] = useState("");
  const [repositories, setRepositories] = useState<RepositorySettings[]>([]);
  const [health, setHealth] = useState<RepositoryHealth[]>([]);
  const [accountStatus, setAccountStatus] = useState<TenantAccountStatus | null>(null);
  const [entitlementStatus, setEntitlementStatus] = useState<TenantEntitlementStatus | null>(null);
  const [usage, setUsage] = useState<UsageSummary[]>([]);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [reportPriorityFilter, setReportPriorityFilter] = useState<TenantReportPriorityFilter>("all");
  const [reportStatusFilter, setReportStatusFilter] = useState<TenantReportStatusFilter>("all");
  const [reportQuery, setReportQuery] = useState("");
  const [reportFilterSummary, setReportFilterSummary] = useState<TenantReportFilterSummary | null>(null);
  const [analysisJobs, setAnalysisJobs] = useState<AnalysisJobSummary[]>([]);
  const [analysisJobFilter, setAnalysisJobFilter] = useState<AnalysisJobFilter>("all");
  const [analysisJobSummary, setAnalysisJobSummary] = useState<AnalysisJobFilterSummary | null>(null);
  const [deletionPreview, setDeletionPreview] = useState<TenantDeletionPreview | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditSummary[]>([]);
  const [installedRepositories, setInstalledRepositories] = useState<InstalledRepository[]>([]);
  const [firstReportPrNumbers, setFirstReportPrNumbers] = useState<Record<number, string>>({});
  const [mode, setMode] = useState<PanelMode>("idle");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string; code?: string } | null>(null);

  const busy = mode !== "idle";
  const healthByRepositoryId = useMemo(() => {
    const map = new Map<number, RepositoryHealth>();
    for (const item of health) {
      if (typeof item.repositoryId === "number") {
        map.set(item.repositoryId, item);
      }
    }

    return map;
  }, [health]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const queryTenantId = params.get("tenantId");
    const queryInstallationId = params.get("installationId");

    if (queryTenantId) setTenantId(queryTenantId);
    if (queryInstallationId) setInstallationId(queryInstallationId);
    if (params.get("githubApp") === "connected") {
      setMessage({ kind: "ok", text: "GitHub App installation connected. Select a repository grant next." });
    }
  }, []);

  async function startInstall() {
    setMode("loading");
    setMessage(null);

    try {
      const json = await requestJson<{ installUrl?: string; error?: string; code?: string }>("/api/github/onboarding/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...tenantMutationHeaders(), ...tenantInviteHeaders(inviteToken) },
        body: JSON.stringify(tenantOnboardingStartPayload(tenantId))
      });

      if (!json.installUrl) {
        throw new PanelRequestError(json.error ?? "GitHub install URL was not returned.", json.code);
      }

      window.location.assign(json.installUrl);
    } catch (error) {
      setMessage(errorMessage(error, "GitHub App installation could not be started."));
    } finally {
      setMode("idle");
    }
  }

  async function startTenantSession() {
    setMode("saving");
    setMessage(null);

    try {
      await requestJson<{
        tenantId?: string;
        expiresAt?: string;
      }>("/api/tenants/session", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...tenantMutationHeaders(), ...tenantInviteHeaders(inviteToken) },
        body: JSON.stringify(tenantSessionPayload({ tenantId }))
      });

      setSessionActive(true);
      setInviteToken("");
      setMessage({ kind: "ok", text: "Tenant admin session started." });
    } catch (error) {
      setMessage(errorMessage(error, "Tenant admin session could not be started."));
    } finally {
      setMode("idle");
    }
  }

  async function endTenantSession() {
    setMode("saving");
    setMessage(null);

    try {
      await requestJson("/api/tenants/session", {
        method: "DELETE",
        headers: tenantMutationHeaders()
      });
      setSessionActive(false);
      setMessage({ kind: "ok", text: "Tenant admin session ended." });
    } catch (error) {
      setMessage(errorMessage(error, "Tenant admin session could not be ended."));
    } finally {
      setMode("idle");
    }
  }

  async function loadInstalledRepositories() {
    setMode("loading");
    setMessage(null);

    try {
      const json = await requestJson<{
        tenantId?: string;
        installationId?: number;
        repositories?: InstalledRepository[];
      }>(`/api/github/onboarding/repositories?installationId=${encodeURIComponent(installationId.trim())}`);

      setInstalledRepositories(Array.isArray(json.repositories) ? json.repositories : []);
      if (json.tenantId) setTenantId(json.tenantId);
      if (typeof json.installationId === "number") setInstallationId(String(json.installationId));
      setMessage({ kind: "ok", text: "Installed repositories loaded as metadata only." });
    } catch (error) {
      setMessage(errorMessage(error, "Installed repositories could not be loaded."));
    } finally {
      setMode("idle");
    }
  }

  async function createRepositoryGrant(repositoryId: number) {
    setMode("saving");
    setMessage(null);

    try {
      const json = await requestJson<{
        repositoryId?: number;
        repositoryFullName?: string;
        error?: string;
        code?: string;
      }>("/api/github/onboarding/repositories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installationId: Number(installationId),
          repositoryId,
          saveReportsEnabled: false,
          commentEnabled: false
        })
      });

      setMessage({
        kind: "ok",
        text: json.repositoryFullName
          ? `${json.repositoryFullName} grant created.`
          : "Repository grant created."
      });
      if (credentialsReady) {
        await loadRepositorySettings("silent");
        await loadRepositoryHealth("metadata-only", undefined, "silent");
      }
    } catch (error) {
      setMessage(errorMessage(error, "Repository grant could not be created."));
    } finally {
      setMode("idle");
    }
  }

  async function loadRepositorySettings(feedback: "visible" | "silent" = "visible") {
    setMode("loading");
    if (feedback === "visible") setMessage(null);

    try {
      const json = await requestJson<{
        repositories?: RepositorySettings[];
      }>(tenantSettingsUrl(tenantId), {
        headers: tenantInviteHeaders(inviteToken)
      });

      setRepositories(Array.isArray(json.repositories) ? json.repositories : []);
      if (feedback === "visible") {
        setMessage({ kind: "ok", text: "Repository settings loaded." });
      }
    } catch (error) {
      setMessage(errorMessage(error, "Repository settings could not be loaded."));
    } finally {
      setMode("idle");
    }
  }

  async function loadRepositoryHealth(
    probe: "metadata-only" | "github" = "metadata-only",
    repositoryId?: number,
    feedback: "visible" | "silent" = "visible",
    pullRequestNumber?: number
  ) {
    setMode(probe === "github" ? "probing" : "loading");
    if (feedback === "visible") setMessage(null);

    try {
      const json = await requestJson<{
        repositories?: RepositoryHealth[];
      }>(tenantHealthUrl(tenantId, {
        probeGitHub: probe === "github",
        repositoryId,
        pullRequestNumber
      }), {
        headers: tenantInviteHeaders(inviteToken)
      });

      setHealth(Array.isArray(json.repositories) ? json.repositories : []);
      if (feedback === "visible") {
        setMessage({
          kind: "ok",
          text: pullRequestNumber
            ? "First PR readiness probe finished."
            : probe === "github" ? "GitHub access probe finished." : "Repository health loaded."
        });
      }
    } catch (error) {
      setMessage(errorMessage(error, "Repository health could not be loaded."));
    } finally {
      setMode("idle");
    }
  }

  async function loadAccountStatus(feedback: "visible" | "silent" = "visible") {
    setMode("loading");
    if (feedback === "visible") setMessage(null);

    try {
      const json = await requestJson<TenantAccountStatus>(tenantAccountUrl(tenantId), {
        headers: tenantInviteHeaders(inviteToken)
      });

      if (json.privacy !== "tenant-account-summary-only") {
        throw new PanelRequestError("Tenant account response did not match the summary-only boundary.");
      }

      setAccountStatus(json);
      if (feedback === "visible") {
        setMessage({ kind: "ok", text: "Tenant account summary loaded." });
      }
    } catch (error) {
      setMessage(errorMessage(error, "Tenant account summary could not be loaded."));
    } finally {
      setMode("idle");
    }
  }

  async function loadEntitlementStatus(feedback: "visible" | "silent" = "visible") {
    setMode("loading");
    if (feedback === "visible") setMessage(null);

    try {
      const json = await requestJson<TenantEntitlementStatus>(tenantEntitlementsUrl(tenantId), {
        headers: tenantInviteHeaders(inviteToken)
      });

      if (json.privacy !== "plan-entitlement-summary-only") {
        throw new PanelRequestError("Tenant plan access response did not match the summary-only boundary.");
      }

      setEntitlementStatus(json);
      if (feedback === "visible") {
        setMessage({ kind: "ok", text: "Plan access summary loaded." });
      }
    } catch (error) {
      setMessage(errorMessage(error, "Plan access summary could not be loaded."));
    } finally {
      setMode("idle");
    }
  }

  async function requestBillingPortalBoundary() {
    setMode("saving");
    setMessage(null);

    try {
      const json = await requestJson<TenantBillingPortalStatus>("/api/tenants/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...tenantMutationHeaders() },
        body: JSON.stringify(tenantBillingPortalPayload(tenantId))
      });

      if (json.privacy !== "billing-portal-session-boundary-only" || json.billing.privacy !== "billing-portal-session-boundary-only") {
        throw new PanelRequestError("Tenant billing portal response did not match the summary-only boundary.");
      }

      setMessage({
        kind: json.ok ? "ok" : "error",
        text: json.ok
          ? "Billing portal boundary is ready for the provider adapter."
          : `Billing portal boundary is ${json.billing.status.replace(/_/g, " ")}: ${json.next.replace(/_/g, " ")}.`
      });
    } catch (error) {
      setMessage(errorMessage(error, "Billing portal boundary could not be checked."));
    } finally {
      setMode("idle");
    }
  }

  async function loadUsageStatus(feedback: "visible" | "silent" = "visible") {
    setMode("loading");
    if (feedback === "visible") setMessage(null);

    try {
      const json = await requestJson<{
        usage?: UsageSummary[];
      }>(tenantUsageUrl(tenantId), {
        headers: tenantInviteHeaders(inviteToken)
      });

      setUsage(Array.isArray(json.usage) ? json.usage : []);
      if (feedback === "visible") {
        setMessage({ kind: "ok", text: "Usage summary loaded." });
      }
    } catch (error) {
      setMessage(errorMessage(error, "Usage summary could not be loaded."));
    } finally {
      setMode("idle");
    }
  }

  async function loadAuditActivity(feedback: "visible" | "silent" = "visible") {
    setMode("loading");
    if (feedback === "visible") setMessage(null);

    try {
      const json = await requestJson<{
        activity?: AuditSummary[];
      }>(tenantAuditActivityUrl(tenantId, 10), {
        headers: tenantInviteHeaders(inviteToken)
      });

      setAuditEvents(Array.isArray(json.activity) ? json.activity : []);
      if (feedback === "visible") {
        setMessage({ kind: "ok", text: "Recent verification activity loaded." });
      }
    } catch (error) {
      setMessage(errorMessage(error, "Verification activity could not be loaded."));
    } finally {
      setMode("idle");
    }
  }

  async function downloadAuditExport() {
    setMode("loading");
    setMessage(null);

    try {
      const json = await requestJson<TenantAuditExportStatus>(tenantAuditExportUrl(tenantId, 100), {
        headers: tenantInviteHeaders(inviteToken)
      });

      if (json.privacy !== "tenant-audit-export-summary-only") {
        throw new PanelRequestError("Tenant audit export response did not match the summary-only boundary.");
      }

      const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `agentproof-audit-${tenantId.trim()}.json`;
      link.click();
      URL.revokeObjectURL(href);
      setMessage({
        kind: "ok",
        text: `Audit export prepared with ${json.count}${json.truncated ? "+" : ""} bounded events.`
      });
    } catch (error) {
      setMessage(errorMessage(error, "Audit export could not be prepared."));
    } finally {
      setMode("idle");
    }
  }

  async function loadSavedReports(
    feedback: "visible" | "silent" = "visible",
    filters: TenantReportFilterSummary = {
      priority: reportPriorityFilter,
      status: reportStatusFilter,
      query: reportQuery
    }
  ) {
    setMode("loading");
    if (feedback === "visible") setMessage(null);

    try {
      const json = await requestJson<{
        reports?: ReportSummary[];
        filters?: TenantReportFilterSummary;
        filterBasis?: "tenant_recent_summary" | "tenant_recent_summary_sample";
      }>(tenantReportsUrl(tenantId, 10, {
        priority: filters.priority,
        status: filters.status,
        query: filters.query
      }), {
        headers: tenantInviteHeaders(inviteToken)
      });

      setReports(Array.isArray(json.reports) ? json.reports : []);
      setReportFilterSummary(json.filters ?? null);
      if (feedback === "visible") {
        setMessage({ kind: "ok", text: "Recent summary reports loaded." });
      }
    } catch (error) {
      setMessage(errorMessage(error, "Recent summary reports could not be loaded."));
    } finally {
      setMode("idle");
    }
  }

  async function loadAnalysisJobs(
    feedback: "visible" | "silent" = "visible",
    filter: AnalysisJobFilter = analysisJobFilter
  ) {
    setMode("loading");
    if (feedback === "visible") setMessage(null);

    try {
      const json = await requestJson<{
        jobs?: AnalysisJobSummary[];
        summary?: AnalysisJobFilterSummary;
      }>(tenantAnalysisJobsUrl(tenantId, 10, filter), {
        headers: tenantInviteHeaders(inviteToken)
      });

      setAnalysisJobs(Array.isArray(json.jobs) ? json.jobs : []);
      setAnalysisJobSummary(json.summary ?? null);
      if (feedback === "visible") {
        setMessage({ kind: "ok", text: "Recent analysis jobs loaded." });
      }
    } catch (error) {
      setMessage(errorMessage(error, "Recent analysis jobs could not be loaded."));
    } finally {
      setMode("idle");
    }
  }

  async function loadDeletionPreview(feedback: "visible" | "silent" = "visible") {
    setMode("loading");
    if (feedback === "visible") setMessage(null);

    try {
      const json = await requestJson<TenantDeletionPreview>(tenantDeletionPreviewUrl(tenantId), {
        headers: tenantInviteHeaders(inviteToken)
      });

      if (json.privacy !== "tenant-deletion-preview-counts-only" || json.destructive !== false) {
        throw new PanelRequestError("Deletion preview response did not match the count-only boundary.");
      }

      setDeletionPreview(json);
      if (feedback === "visible") {
        setMessage({ kind: "ok", text: "Deletion preview loaded as counts only." });
      }
    } catch (error) {
      setMessage(errorMessage(error, "Deletion preview could not be loaded."));
    } finally {
      setMode("idle");
    }
  }

  async function updateRepositorySetting(
    repository: RepositorySettings,
    key: TenantRepositorySettingKey,
    value: boolean
  ) {
    if (!repository.repositoryId) {
      setMessage({ kind: "error", text: "Repository id is required before settings can be changed." });
      return;
    }

    setMode("saving");
    setMessage(null);

    try {
      const json = await requestJson<{
        repository?: RepositorySettings;
      }>("/api/tenants/repositories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...tenantMutationHeaders(), ...tenantInviteHeaders(inviteToken) },
        body: JSON.stringify(tenantSettingsPatchPayload({
          tenantId: tenantId.trim(),
          installationId: repository.installationId,
          repositoryId: repository.repositoryId,
          setting: key,
          value
        }))
      });

      if (json.repository) {
        setRepositories((current) => current.map((item) =>
          item.installationId === json.repository?.installationId && item.repositoryId === json.repository.repositoryId
            ? json.repository
            : item
        ));
        setHealth((current) => current.map((item) =>
          item.installationId === json.repository?.installationId && item.repositoryId === json.repository.repositoryId
            ? { ...item, ...json.repository }
            : item
        ));
      }
      setMessage({ kind: "ok", text: `${settingLabels[key]} updated.` });
    } catch (error) {
      setMessage(errorMessage(error, "Repository setting could not be changed."));
    } finally {
      setMode("idle");
    }
  }

  const hasTenantId = tenantId.trim().length > 0;
  const canStartSession = hasTenantId && inviteToken.trim().length > 0;
  const credentialsReady = hasTenantId;
  const canLoadInstalled = Number.isInteger(Number(installationId)) && Number(installationId) > 0;
  const setupWarningRollup = useMemo(() => buildTenantSetupWarningRollup({
    account: accountStatus,
    entitlements: entitlementStatus,
    repositoryHealth: health,
    usage,
    analysisJobs: analysisJobSummary
  }), [accountStatus, entitlementStatus, health, usage, analysisJobSummary]);

  return (
    <section className="tenant-setup" aria-labelledby="tenant-setup-title">
      <div className="card tenant-setup-card">
        <div className="card-title-row">
          <div>
            <h2 id="tenant-setup-title">Tenant Setup</h2>
            <p className="muted small">Invite-only GitHub App activation and repository verification settings.</p>
          </div>
          <ShieldCheck size={18} aria-hidden="true" />
        </div>

        <div className="tenant-setup-form">
          <div className="field">
            <label htmlFor="tenantId">Tenant ID</label>
            <input
              id="tenantId"
              className="input"
              value={tenantId}
              onChange={(event) => {
                setTenantId(event.target.value);
                setSessionActive(false);
              }}
              placeholder="tenant_demo"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="inviteToken">Invite token</label>
            <input
              id="inviteToken"
              className="input"
              value={inviteToken}
              onChange={(event) => setInviteToken(event.target.value)}
              placeholder="Tenant-bound token"
              type="password"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="installationId">Installation ID</label>
            <input
              id="installationId"
              className="input"
              value={installationId}
              onChange={(event) => setInstallationId(event.target.value)}
              placeholder="From GitHub callback"
              inputMode="numeric"
            />
          </div>
        </div>

        <div className="tenant-action-row">
          <button className="button primary" type="button" onClick={startInstall} disabled={!credentialsReady || busy}>
            {mode === "loading" ? <Loader2 size={16} className="spin" /> : <ExternalLink size={16} />}
            Install App
          </button>
          <button className="button" type="button" onClick={sessionActive ? endTenantSession : startTenantSession} disabled={busy || (!sessionActive && !canStartSession)}>
            <ShieldCheck size={16} />
            {sessionActive ? "End Session" : "Start Session"}
          </button>
          <button className="button" type="button" onClick={() => loadRepositorySettings()} disabled={!credentialsReady || busy}>
            <SlidersHorizontal size={16} />
            Load Settings
          </button>
          <button className="button" type="button" onClick={() => loadRepositoryHealth()} disabled={!credentialsReady || busy}>
            <RefreshCcw size={16} />
            Health
          </button>
          <button className="button" type="button" onClick={() => loadAccountStatus()} disabled={!credentialsReady || busy}>
            <UsersRound size={16} />
            Account
          </button>
          <button className="button" type="button" onClick={() => loadEntitlementStatus()} disabled={!credentialsReady || busy}>
            <ShieldCheck size={16} />
            Plan Access
          </button>
          <button className="button" type="button" onClick={() => loadUsageStatus()} disabled={!credentialsReady || busy}>
            <BarChart3 size={16} />
            Usage
          </button>
          <button className="button" type="button" onClick={() => loadSavedReports()} disabled={!credentialsReady || busy}>
            <FileText size={16} />
            Reports
          </button>
          <button className="button" type="button" onClick={() => loadAnalysisJobs()} disabled={!credentialsReady || busy}>
            <Activity size={16} />
            Jobs
          </button>
          <button className="button" type="button" onClick={() => loadDeletionPreview()} disabled={!credentialsReady || busy}>
            <Database size={16} />
            Deletion Preview
          </button>
          <button className="button" type="button" onClick={() => loadAuditActivity()} disabled={!credentialsReady || busy}>
            <Activity size={16} />
            Activity
          </button>
          <button className="button" type="button" onClick={downloadAuditExport} disabled={!credentialsReady || busy}>
            <Download size={16} />
            Export Audit
          </button>
        </div>

        {message ? (
          <div className={message.kind === "ok" ? "setup-message ok" : "setup-message error"} role="status">
            {message.kind === "ok" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            <span>{message.text}{message.code ? ` (${message.code})` : ""}</span>
          </div>
        ) : null}
      </div>

      <div className="tenant-setup-grid">
        <article className="card">
          <div className="card-title-row">
            <h2>Setup Warnings</h2>
            <AlertTriangle size={18} aria-hidden="true" />
          </div>
          <div className="tenant-rollup-row" aria-label="Tenant setup warning summary">
            <span>Blocking {setupWarningRollup.counts.critical}</span>
            <span>Warnings {setupWarningRollup.counts.warning}</span>
            <span>Info {setupWarningRollup.counts.info}</span>
            <span>{setupWarningNextLabel(setupWarningRollup.next)}</span>
          </div>
          {setupWarningRollup.warnings.length > 0 ? (
            <ul className="tenant-usage-list">
              {setupWarningRollup.warnings.map((warning) => (
                <li key={warning.key}>
                  <div className="tenant-usage-meter">
                    <span>{warning.label}</span>
                    <strong>{setupWarningSeverityLabel(warning.severity)}</strong>
                  </div>
                  <div className={`tenant-usage-state state-${warning.severity}`}>
                    {warning.action}
                  </div>
                  <small>{warning.detail}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">Loaded setup summaries show no blocking warnings.</p>
          )}
          <p className="muted small">Loaded summary signals only; repository payloads, provider ids, raw evidence, logs, and report bodies are omitted.</p>
        </article>

        <article className="card">
          <div className="card-title-row">
            <h2>Tenant Account</h2>
            <UsersRound size={18} aria-hidden="true" />
          </div>
          <div className="button-row tenant-inline-actions">
            <button className="button compact" type="button" onClick={() => loadAccountStatus()} disabled={!credentialsReady || busy}>
              Load Account
            </button>
          </div>
          {accountStatus ? (
            <div className="tenant-account-summary">
              <div className="tenant-rollup-row" aria-label="Tenant account role summary">
                <span>{accountStatus.account.configured ? "Configured" : "Invite-only"}</span>
                <span>Owners {accountStatus.roleCounts.owner}</span>
                <span>Admins {accountStatus.roleCounts.admin}</span>
                <span>Members {accountStatus.roleCounts.member}</span>
              </div>
              <ul className="tenant-usage-list">
                <li>
                  <div className="tenant-usage-meter">
                    <span>{accountStatus.account.name}</span>
                    <strong>{accountStatus.account.plan}</strong>
                  </div>
                  <div className={`tenant-usage-state state-${accountStatus.account.status}`}>
                    {accountStatus.account.status}
                  </div>
                  <small>
                    {accountStatus.account.memberCount}{accountStatus.account.membersTruncated ? "+" : ""} member roles · {accountStatus.next.replace(/_/g, " ")}
                  </small>
                </li>
              </ul>
              {accountStatus.members.length > 0 ? (
                <ul className="tenant-repo-list tenant-member-list">
                  {accountStatus.members.map((member) => (
                    <li key={member.memberId}>
                      <div>
                        <strong>{member.memberId}</strong>
                        <span>{member.role} · {member.status}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">No member records configured yet.</p>
              )}
            </div>
          ) : (
            <p className="muted small">No account summary loaded.</p>
          )}
        </article>

        <article className="card">
          <div className="card-title-row">
            <h2>Plan Access</h2>
            <ShieldCheck size={18} aria-hidden="true" />
          </div>
          <div className="button-row tenant-inline-actions">
            <button className="button compact" type="button" onClick={() => loadEntitlementStatus()} disabled={!credentialsReady || busy}>
              Load Access
            </button>
            <button className="button compact" type="button" onClick={requestBillingPortalBoundary} disabled={!credentialsReady || busy}>
              <CreditCard size={14} />
              Portal Boundary
            </button>
          </div>
          {entitlementStatus ? (
            <div className="tenant-account-summary">
              <div className="tenant-rollup-row" aria-label="Tenant plan access summary">
                <span>Plan {entitlementStatus.plan}</span>
                <span>Account {entitlementStatus.account.status}</span>
                <span>Billing {entitlementStatus.billing.subscriptionStatus.replace(/_/g, " ")}</span>
                <span>Quota {entitlementStatus.quota.state.replace(/_/g, " ")}</span>
                <span>Repos {entitlementStatus.repositories.connectedRepositoryCount ?? 0}</span>
                {entitlementStatus.billing.portal.available ? <span>Portal boundary ready</span> : null}
              </div>
              <ul className="tenant-usage-list">
                {entitlementStatus.features.map((feature) => (
                  <li key={feature.key}>
                    <div className="tenant-usage-meter">
                      <span>{feature.label}</span>
                      <strong>{feature.enabled ? "On" : "Off"}</strong>
                    </div>
                    <div className={`tenant-usage-state state-${feature.state}`}>
                      {entitlementStateLabel(feature.state)}
                    </div>
                    {feature.reason ? <small>{feature.reason.replace(/_/g, " ")}</small> : null}
                  </li>
                ))}
              </ul>
              <p className="muted small">
                {entitlementStatus.quota.limit !== undefined && entitlementStatus.quota.used !== undefined
                  ? `Usage ${entitlementStatus.quota.used} / ${entitlementStatus.quota.limit}`
                  : entitlementStatus.next.replace(/_/g, " ")}
              </p>
            </div>
          ) : (
            <p className="muted small">No plan access summary loaded.</p>
          )}
        </article>

        <article className="card">
          <div className="card-title-row">
            <h2>Installed Repositories</h2>
            <GitBranch size={18} aria-hidden="true" />
          </div>
          <div className="button-row tenant-inline-actions">
            <button className="button compact" type="button" onClick={loadInstalledRepositories} disabled={!canLoadInstalled || busy}>
              Load Installed
            </button>
          </div>
          {installedRepositories.length > 0 ? (
            <ul className="tenant-repo-list">
              {installedRepositories.map((repo) => (
                <li key={repo.id}>
                  <div>
                    <strong>{repo.fullName}</strong>
                    <span>{repo.private ? "Private" : "Public"} · {repo.defaultBranch ?? "default branch unknown"}</span>
                  </div>
                  <button
                    className="button compact"
                    type="button"
                    onClick={() => createRepositoryGrant(repo.id)}
                    disabled={busy}
                  >
                    Grant
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No installed repositories loaded.</p>
          )}
        </article>

        <article className="card">
          <div className="card-title-row">
            <h2>Repository Grants</h2>
            <SlidersHorizontal size={18} aria-hidden="true" />
          </div>
          {repositories.length > 0 ? (
            <ul className="tenant-repo-list settings-list">
              {repositories.map((repo) => {
                const repoHealth = typeof repo.repositoryId === "number" ? healthByRepositoryId.get(repo.repositoryId) : undefined;
                const prInput = typeof repo.repositoryId === "number" ? firstReportPrNumbers[repo.repositoryId] ?? "" : "";
                const prNumber = parsePositiveIntegerInput(prInput);

                return (
                  <li key={`${repo.installationId}:${repo.repositoryId ?? repo.repositoryFullName}`}>
                    <div className="tenant-repo-main">
                      <div className="tenant-repo-title">
                        <strong>{repo.repositoryFullName}</strong>
                        <span>
                          {repoHealth?.status ?? "health-not-loaded"} · installation {repo.installationId}
                        </span>
                      </div>
                      <div className="tenant-toggle-grid">
                        {(Object.keys(settingLabels) as TenantRepositorySettingKey[]).map((key) => (
                          <label className="toggle-row" key={key}>
                            <span>{settingLabels[key]}</span>
                            <input
                              type="checkbox"
                              checked={repo[key]}
                              onChange={(event) => updateRepositorySetting(repo, key, event.target.checked)}
                              disabled={busy}
                            />
                          </label>
                        ))}
                      </div>
                      {repoHealth ? (
                        <p className="tenant-next-action">{repoHealth.nextAction}</p>
                      ) : null}
                      {repoHealth?.firstReport ? (
                        <div className="tenant-first-report" aria-label={`First PR readiness for ${repo.repositoryFullName}`}>
                          <div className="tenant-rollup-row">
                            <span>PR #{repoHealth.firstReport.pullRequestNumber}</span>
                            <span>{firstReportStatusLabel(repoHealth.firstReport.status)}</span>
                            <span>{changedFilesReadinessLabel(repoHealth.firstReport.changedFiles)}</span>
                            <span>{checksAvailabilityLabel(repoHealth.firstReport.checksAvailability)}</span>
                          </div>
                          <p className="tenant-next-action">{repoHealth.firstReport.nextAction}</p>
                        </div>
                      ) : null}
                      {typeof repo.repositoryId === "number" ? (
                        <div className="tenant-pr-probe-row">
                          <label htmlFor={`first-report-pr-${repo.repositoryId}`}>PR #</label>
                          <input
                            id={`first-report-pr-${repo.repositoryId}`}
                            className="input"
                            value={prInput}
                            onChange={(event) => setFirstReportPrNumbers((current) => ({
                              ...current,
                              [repo.repositoryId as number]: event.target.value
                            }))}
                            placeholder="42"
                            inputMode="numeric"
                            autoComplete="off"
                          />
                          <button
                            className="button compact"
                            type="button"
                            onClick={() => loadRepositoryHealth("github", repo.repositoryId, "visible", prNumber)}
                            disabled={!credentialsReady || busy || !prNumber}
                          >
                            <Activity size={14} />
                            PR Probe
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <button
                      className="button compact"
                      type="button"
                      onClick={() => loadRepositoryHealth("github", repo.repositoryId)}
                      disabled={!credentialsReady || busy || !repo.repositoryId}
                    >
                      Probe
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted small">No repository grants loaded.</p>
          )}
        </article>

        <article className="card">
          <div className="card-title-row">
            <h2>Monthly Verification Usage</h2>
            <BarChart3 size={18} aria-hidden="true" />
          </div>
          <div className="button-row tenant-inline-actions">
            <button className="button compact" type="button" onClick={() => loadUsageStatus()} disabled={!credentialsReady || busy}>
              Load Usage
            </button>
          </div>
          {usage.length > 0 ? (
            <ul className="tenant-usage-list">
              {usage.map((item) => (
                <li key={item.feature}>
                  <div className="tenant-usage-meter">
                    <span>{item.label}</span>
                    <strong>{formatUsage(item)}</strong>
                  </div>
                  <div className={`tenant-usage-state state-${item.state}`}>
                    {usageStateLabel(item.state)}
                  </div>
                  {item.note ? <p>{item.note}</p> : null}
                  {item.plan ? <small>Plan: {item.plan}</small> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No usage summary loaded.</p>
          )}
        </article>

        <article className="card">
          <div className="card-title-row">
            <h2>Recent Summary Reports</h2>
            <FileText size={18} aria-hidden="true" />
          </div>
          <div className="button-row tenant-inline-actions">
            <button className="button compact" type="button" onClick={() => loadSavedReports()} disabled={!credentialsReady || busy}>
              Load Reports
            </button>
          </div>
          <div className="tenant-filter-row" aria-label="Summary report priority filter">
            {(["all", "blocker", "high", "medium", "low"] as const).map((filter) => (
              <button
                key={filter}
                className={reportPriorityFilter === filter ? "button compact active" : "button compact ghost"}
                type="button"
                onClick={() => {
                  setReportPriorityFilter(filter);
                  void loadSavedReports("visible", {
                    priority: filter,
                    status: reportStatusFilter,
                    query: reportQuery
                  });
                }}
                disabled={!credentialsReady || busy}
              >
                {reportPriorityLabel(filter)}
              </button>
            ))}
          </div>
          <div className="tenant-filter-row" aria-label="Summary report status filter">
            {(["all", "missing_tests", "scope_creep", "weak_evidence"] as const).map((filter) => (
              <button
                key={filter}
                className={reportStatusFilter === filter ? "button compact active" : "button compact ghost"}
                type="button"
                onClick={() => {
                  setReportStatusFilter(filter);
                  void loadSavedReports("visible", {
                    priority: reportPriorityFilter,
                    status: filter,
                    query: reportQuery
                  });
                }}
                disabled={!credentialsReady || busy}
              >
                {reportStatusLabel(filter)}
              </button>
            ))}
          </div>
          <div className="field tenant-search-field">
            <label htmlFor="reportQuery">Report search</label>
            <input
              id="reportQuery"
              className="input"
              value={reportQuery}
              onChange={(event) => setReportQuery(event.target.value)}
              placeholder="Repository, PR, or title"
              autoComplete="off"
            />
          </div>
          {reportFilterSummary ? (
            <p className="muted small">
              Filters: {reportPriorityLabel(reportFilterSummary.priority)} · {reportStatusLabel(reportFilterSummary.status)}
              {reportFilterSummary.query ? ` · ${reportFilterSummary.query}` : ""}
            </p>
          ) : null}
          {reports.length > 0 ? (
            <ul className="tenant-report-list">
              {reports.map((report) => (
                <li key={report.id}>
                  <div>
                    <strong>{report.sourceTitle}</strong>
                    <span>{report.priority} · {report.evidenceCoverage}% evidence · {formatDateTime(report.createdAt)}</span>
                  </div>
                  <p>{reportDetail(report)}</p>
                  {report.sourceUrl ? (
                    <a href={report.sourceUrl} target="_blank" rel="noreferrer">
                      Open source
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No recent summary reports loaded.</p>
          )}
        </article>

        <article className="card">
          <div className="card-title-row">
            <h2>Recent Analysis Jobs</h2>
            <Activity size={18} aria-hidden="true" />
          </div>
          <div className="button-row tenant-inline-actions">
            <button className="button compact" type="button" onClick={() => loadAnalysisJobs()} disabled={!credentialsReady || busy}>
              Load Jobs
            </button>
          </div>
          <div className="tenant-filter-row" aria-label="Analysis job status filter">
            {(["all", "failed", "active", "completed"] as const).map((filter) => (
              <button
                key={filter}
                className={analysisJobFilter === filter ? "button compact active" : "button compact ghost"}
                type="button"
                onClick={() => {
                  setAnalysisJobFilter(filter);
                  void loadAnalysisJobs("visible", filter);
                }}
                disabled={!credentialsReady || busy}
              >
                {analysisJobFilterLabel(filter)}
              </button>
            ))}
          </div>
          {analysisJobSummary ? (
            <div className="tenant-rollup-row" aria-label="Analysis job summary">
              <span>Recent sample {analysisJobSummary.sampled}</span>
              <span>Failed {analysisJobSummary.counts.failed}</span>
              <span>Needs attention {analysisJobSummary.counts.terminal}</span>
              <span>Active {analysisJobSummary.counts.active}</span>
              <span>Completed {analysisJobSummary.counts.completed}</span>
            </div>
          ) : null}
          {analysisJobs.length > 0 ? (
            <ul className="tenant-audit-list">
              {analysisJobs.map((job) => (
                <li key={job.id}>
                  <div>
                    <strong>{analysisJobStatusLabel(job.status)}</strong>
                    <span>{job.repositoryFullName} · PR #{job.pullRequestNumber} · {formatDateTime(job.updatedAt)}</span>
                  </div>
                  <p>{analysisJobDetail(job)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">{emptyAnalysisJobsText(analysisJobFilter)}</p>
          )}
        </article>

        <article className="card">
          <div className="card-title-row">
            <h2>Data Deletion Preview</h2>
            <Database size={18} aria-hidden="true" />
          </div>
          <div className="button-row tenant-inline-actions">
            <button className="button compact" type="button" onClick={() => loadDeletionPreview()} disabled={!credentialsReady || busy}>
              Load Preview
            </button>
          </div>
          {deletionPreview ? (
            <div className="tenant-deletion-preview">
              <div className="tenant-rollup-row" aria-label="Deletion preview summary">
                <span>Dry run</span>
                <span>{deletionPreview.totals.knownCount} known records</span>
                <span>{deletionPreview.totals.unavailableCategories} unavailable</span>
                <span>{deletionPreview.retentionPolicy.status} policy</span>
                <span>{deletionPreview.retentionPolicy.version}</span>
                <span>{deletionPreview.retentionPolicy.coverage.countedCategories.length} of {deletionPreview.retentionPolicy.coverage.totalCategories} counted</span>
              </div>
              <ul className="tenant-deletion-list">
                {deletionPreview.categories.map((category) => (
                  <li key={category.key}>
                    <div>
                      <strong>{deletionCategoryLabel(category.key)}</strong>
                      <span>{deletionCategoryDetail(category)}</span>
                    </div>
                    <span className={`tenant-deletion-status status-${category.status}`}>
                      {deletionStatusLabel(category.status)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="muted small">No deletion preview loaded.</p>
          )}
        </article>

        <article className="card">
          <div className="card-title-row">
            <h2>Recent Verification Activity</h2>
            <Activity size={18} aria-hidden="true" />
          </div>
          <div className="button-row tenant-inline-actions">
            <button className="button compact" type="button" onClick={() => loadAuditActivity()} disabled={!credentialsReady || busy}>
              Load Activity
            </button>
          </div>
          {auditEvents.length > 0 ? (
            <ul className="tenant-audit-list">
              {auditEvents.map((event) => (
                <li key={event.id}>
                  <div>
                    <strong>{auditActionLabel(event.action)}</strong>
                    <span>{event.result} · {formatDateTime(event.createdAt)}</span>
                  </div>
                  <p>{auditDetail(event)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No recent verification activity loaded.</p>
          )}
        </article>

        <article className="card">
          <div className="card-title-row">
            <h2>Audit Export</h2>
            <Download size={18} aria-hidden="true" />
          </div>
          <div className="button-row tenant-inline-actions">
            <button className="button compact" type="button" onClick={downloadAuditExport} disabled={!credentialsReady || busy}>
              Export JSON
            </button>
          </div>
          <p className="muted small">
            Summary-only tenant events with bounded repository, PR, delivery prefix, result, status, evidence coverage, saved-report, and comment action fields.
          </p>
        </article>
      </div>
    </section>
  );
}

function parsePositiveIntegerInput(value: string): number | undefined {
  if (!/^\d{1,10}$/.test(value.trim())) return undefined;

  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function firstReportStatusLabel(status: string): string {
  if (status === "ready") return "Ready";
  if (status === "repository-disabled") return "Grant disabled";
  if (status === "analysis-disabled") return "Analysis off";
  if (status === "credentials-not-ready") return "Credentials";
  if (status === "pull-request-inaccessible") return "PR access";
  if (status === "pull-request-rate-limited") return "Rate limited";
  if (status === "pull-request-unavailable") return "PR unavailable";
  if (status === "large-pr-capped") return "Large PR";
  if (status === "checks-missing") return "Checks missing";
  if (status === "checks-rate-limited") return "Checks limited";
  if (status === "checks-unavailable") return "Checks unavailable";

  return "Unclear";
}

function changedFilesReadinessLabel(changedFiles: FirstReportDiagnostics["changedFiles"]): string {
  if (typeof changedFiles.count === "number") {
    return `Files ${changedFiles.count}/${changedFiles.maxFiles}`;
  }

  return `Files ${changedFiles.status.replace(/-/g, " ")}`;
}

function checksAvailabilityLabel(checks: FirstReportDiagnostics["checksAvailability"]): string {
  if (checks.status === "present" && checks.sources.length > 0) {
    return `Checks ${checks.sources.map((source) => source.replace(/-/g, " ")).join(", ")}`;
  }

  return `Checks ${checks.status.replace(/-/g, " ")}`;
}

function formatUsage(item: UsageSummary): string {
  if (typeof item.used === "number" && typeof item.limit === "number") {
    return `${item.used} / ${item.limit}`;
  }

  return "Not configured";
}

function usageStateLabel(state: UsageSummary["state"]): string {
  if (state === "available") return "Available";
  if (state === "exhausted") return "Exhausted";
  if (state === "not-enforced") return "Not enforced";

  return "Not configured";
}

function entitlementStateLabel(state: TenantEntitlementFeature["state"]): string {
  if (state === "enabled") return "Enabled";
  if (state === "disabled") return "Disabled";
  if (state === "unavailable") return "Unavailable";
  if (state === "unclear") return "Unclear";

  return "Not configured";
}

function reportDetail(report: ReportSummary): string {
  const requirementText = [
    `${report.requirementCounts.met} met`,
    `${report.requirementCounts.partial} partial`,
    `${report.requirementCounts.missing} missing`,
    `${report.requirementCounts.unclear} unclear`
  ].join(", ");
  const testingText = [
    `ci ${report.testing.ciStatus}`,
    `lint ${report.testing.lintStatus}`,
    `typecheck ${report.testing.typecheckStatus}`,
    `${report.testing.missingTestCount} missing tests`
  ].join(", ");
  const reviewText = `${report.reviewPriorityCount} priority files`;
  const scopeText = report.scopeCreepSuspected ? "scope check flagged" : "scope check clear";

  return `${requirementText} · ${testingText} · ${reviewText} · ${scopeText}`;
}

function setupWarningSeverityLabel(severity: string): string {
  if (severity === "critical") return "Blocking";
  if (severity === "warning") return "Warning";

  return "Info";
}

function setupWarningNextLabel(next: string): string {
  if (next === "fix_blocking_setup") return "Fix setup";
  if (next === "review_setup_warnings") return "Review warnings";
  if (next === "ready_for_first_report") return "Ready";

  return "Load summaries";
}

function reportPriorityLabel(filter: TenantReportPriorityFilter): string {
  if (filter === "blocker") return "Blocker";
  if (filter === "high") return "High";
  if (filter === "medium") return "Medium";
  if (filter === "low") return "Low";

  return "All priorities";
}

function reportStatusLabel(filter: TenantReportStatusFilter): string {
  if (filter === "missing_tests") return "Missing tests";
  if (filter === "scope_creep") return "Scope check";
  if (filter === "weak_evidence") return "Weak evidence";

  return "All signals";
}

function auditActionLabel(action: string): string {
  return action
    .replace(/^github_app_/, "")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function analysisJobStatusLabel(status: string): string {
  if (status === "completed") return "Completed";
  if (status === "failed_retryable") return "Retrying";
  if (status === "failed_terminal") return "Needs attention";
  if (status === "processing") return "Active";
  if (status === "queued") return "Queued";

  return "Status unknown";
}

function analysisJobFilterLabel(filter: AnalysisJobFilter): string {
  if (filter === "failed") return "Failed";
  if (filter === "active") return "Active";
  if (filter === "completed") return "Completed";

  return "All";
}

function analysisJobDetail(job: AnalysisJobSummary): string {
  const parts = [
    job.headShaPrefix ? `sha ${job.headShaPrefix}` : undefined,
    job.result?.priority ? `priority ${job.result.priority}` : undefined,
    typeof job.result?.evidenceCoverage === "number" ? `${job.result.evidenceCoverage}% evidence` : undefined,
    job.sideEffects.saveReport ? "summary link planned" : undefined,
    job.sideEffects.comment ? "marker comment planned" : undefined,
    job.errorCode ? `reason ${job.errorCode}` : undefined
  ].filter(Boolean);

  return parts.join(" · ") || "Bounded async analysis status summary.";
}

function deletionCategoryLabel(key: TenantDeletionPreviewCategory["key"]): string {
  if (key === "saved_reports") return "Saved summaries";
  if (key === "repository_grants") return "Repository grants";
  if (key === "github_installations") return "GitHub installations";
  if (key === "webhook_deliveries") return "Webhook deliveries";
  if (key === "analysis_jobs") return "Analysis jobs";
  if (key === "audit_events") return "Audit events";

  return "Usage records";
}

function deletionStatusLabel(status: TenantDeletionPreviewCategory["status"]): string {
  if (status === "ready") return "Counted";
  if (status === "disabled") return "Disabled";
  if (status === "manual_review_required") return "Manual review";

  return "Unavailable";
}

function deletionCategoryDetail(category: TenantDeletionPreviewCategory): string {
  const countText = typeof category.count === "number" ? `${category.count} records` : "count unavailable";
  if (category.reason === "manual-removal-required") return `${countText} · manual removal required`;
  if (category.reason === "policy-review-required") return `${countText} · policy review required`;
  if (category.reason === "policy-blocked") return `${countText} · policy blocked`;
  if (category.reason === "store-disabled") return `${countText} · disabled`;
  if (category.reason === "store-unavailable") return "count unavailable";

  return countText;
}

function emptyAnalysisJobsText(filter: AnalysisJobFilter): string {
  if (filter === "failed") return "No failed analysis jobs loaded.";
  if (filter === "active") return "No active analysis jobs loaded.";
  if (filter === "completed") return "No completed analysis jobs loaded.";

  return "No recent analysis jobs loaded.";
}

function auditDetail(event: AuditSummary): string {
  const parts = [
    event.repositoryFullName,
    event.pullRequestNumber ? `PR #${event.pullRequestNumber}` : undefined,
    event.headShaPrefix ? `sha ${event.headShaPrefix}` : undefined,
    event.priority ? `priority ${event.priority}` : undefined,
    typeof event.evidenceCoverage === "number" ? `${event.evidenceCoverage}% evidence` : undefined,
    event.savedReport?.privacy ? `report ${event.savedReport.privacy}` : undefined,
    event.comment?.action ? `comment ${event.comment.action}` : undefined,
    event.code
  ].filter(Boolean);

  return parts.join(" · ") || "Bounded verification activity summary.";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "time unknown";

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T & ApiErrorBody> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    cache: "no-store"
  });
  const json = await response.json() as T & ApiErrorBody;

  if (!response.ok) {
    throw new PanelRequestError(json.error ?? "Request failed.", json.code);
  }

  return json;
}

function errorMessage(error: unknown, fallback: string): { kind: "error"; text: string; code?: string } {
  if (error instanceof PanelRequestError) {
    return { kind: "error", text: error.message, code: error.code };
  }

  return { kind: "error", text: error instanceof Error ? error.message : fallback };
}

class PanelRequestError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "PanelRequestError";
  }
}
