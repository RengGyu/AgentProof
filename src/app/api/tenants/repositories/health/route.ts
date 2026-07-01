import {
  GitHubInstallationStoreError,
  listTenantGitHubInstallationStatuses,
  type GitHubInstallationStatus
} from "@/lib/github-installations";
import {
  createGitHubInstallationAccessToken,
  getGitHubAppConfigStatus,
  GitHubAppTokenError
} from "@/lib/github-app";
import { GITHUB_MAX_CHANGED_FILES } from "@/lib/github";
import { verifyTenantAccess } from "@/lib/tenant-admin-access";
import { noStoreJson } from "@/lib/http";
import {
  getTenantControlPlaneSettings,
  listTenantRepositoryGrants,
  TenantControlPlaneStoreError,
  type TenantRepositoryGrant
} from "@/lib/tenant-control-plane";

const MAX_HEALTH_REPOSITORIES = 50;
const MAX_GITHUB_PROBE_REPOSITORIES = 10;
const GITHUB_REPOSITORY_PROBE_TIMEOUT_MS = 6000;
const GITHUB_FIRST_REPORT_PROBE_TIMEOUT_MS = 6000;

type GrantHealthStatus =
  | "ready"
  | "disabled"
  | "analysis-disabled"
  | "installation-suspended"
  | "installation-deleted"
  | "app-credentials-not-ready"
  | "github-accessible"
  | "github-inaccessible"
  | "github-rate-limited"
  | "github-unavailable"
  | "github-not-checked";

type GitHubAccessStatus =
  | "not-checked"
  | "accessible"
  | "inaccessible"
  | "rate-limited"
  | "unavailable"
  | "credentials-not-ready";
type LiveGitHubAccessStatus = Exclude<GitHubAccessStatus, "not-checked">;

type FirstReportReadinessStatus =
  | "ready"
  | "repository-disabled"
  | "analysis-disabled"
  | "credentials-not-ready"
  | "pull-request-inaccessible"
  | "pull-request-rate-limited"
  | "pull-request-unavailable"
  | "large-pr-capped"
  | "checks-missing"
  | "checks-rate-limited"
  | "checks-unavailable";

type ChangedFilesReadinessStatus = "within-limit" | "over-limit" | "unavailable" | "not-checked";
type ChecksAvailabilityStatus = "present" | "missing" | "rate-limited" | "unavailable" | "not-checked";

type InstallationHealthStatus = GitHubInstallationStatus | "unknown";

interface RepositoryHealth {
  installationId: number;
  repositoryId?: number;
  repositoryFullName: string;
  enabled: boolean;
  analysisEnabled: boolean;
  saveReportsEnabled: boolean;
  commentEnabled: boolean;
  slackNotificationsEnabled: boolean;
  status: GrantHealthStatus;
  githubAccess: GitHubAccessStatus;
  checks: {
    grantActive: boolean;
    analysisEnabled: boolean;
    installationStatus: InstallationHealthStatus;
    appCredentialsReady: boolean;
    githubAccess: GitHubAccessStatus;
  };
  firstReport?: FirstReportDiagnostics;
  nextAction: string;
}

interface FirstReportDiagnostics {
  privacy: "first-report-readiness-metadata-only";
  pullRequestNumber: number;
  status: FirstReportReadinessStatus;
  pullRequestAccess: Exclude<GitHubAccessStatus, "accessible"> | "accessible";
  changedFiles: {
    status: ChangedFilesReadinessStatus;
    count?: number;
    maxFiles: number;
  };
  checksAvailability: {
    status: ChecksAvailabilityStatus;
    sources: Array<"check-runs" | "commit-statuses">;
  };
  nextAction: string;
}

interface GitHubRepositoryProbeResult {
  accessByRepository: Map<string, GitHubAccessStatus>;
  firstReportByRepository: Map<string, FirstReportDiagnostics>;
}

interface GitHubFirstReportProbeRequest {
  repositoryId: number;
  pullRequestNumber: number;
}

export async function GET(request: Request) {
  if (!getTenantControlPlaneSettings().enabled) {
    return noStoreJson({
      error: "Tenant control plane must be enabled before repository health can be read.",
      code: "tenant_repository_health_control_required"
    }, { status: 409 });
  }

  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId");
  const inviteToken = request.headers.get("x-agentproof-beta-invite-token") ?? undefined;
  const probeGitHub = url.searchParams.get("probe") === "github";
  const requestedRepositoryId = normalizeRepositoryId(url.searchParams.get("repositoryId"));
  const requestedPullRequestNumber = normalizePullRequestNumber(url.searchParams.get("pullRequestNumber"));
  const hasPullRequestNumber = url.searchParams.has("pullRequestNumber");
  const access = await verifyTenantAccess({
    tenantId,
    inviteToken,
    cookieHeader: request.headers.get("cookie")
  });

  if (!access.authorized || !access.tenantId) {
    return noStoreJson({
      error: "Tenant repository health requires valid tenant authorization.",
      code: "tenant_repository_health_unauthorized"
    }, { status: 401 });
  }
  const authorizedTenantId = access.tenantId;

  if (url.searchParams.has("repositoryId") && !requestedRepositoryId) {
    return noStoreJson({
      error: "Repository health probe repositoryId must be a positive integer.",
      code: "tenant_repository_health_repository_id_invalid"
    }, { status: 422 });
  }

  if (hasPullRequestNumber && !requestedPullRequestNumber) {
    return noStoreJson({
      error: "Repository health pullRequestNumber must be a positive integer.",
      code: "tenant_repository_health_pull_request_number_invalid"
    }, { status: 422 });
  }

  if (hasPullRequestNumber && !probeGitHub) {
    return noStoreJson({
      error: "Repository health pull request readiness requires probe=github.",
      code: "tenant_repository_health_pull_request_probe_requires_github"
    }, { status: 422 });
  }

  if (hasPullRequestNumber && !requestedRepositoryId) {
    return noStoreJson({
      error: "Repository health pull request readiness requires repositoryId.",
      code: "tenant_repository_health_pull_request_repository_required"
    }, { status: 422 });
  }

  let repositories: TenantRepositoryGrant[];
  try {
    repositories = await listTenantRepositoryGrants({ tenantId: authorizedTenantId });
  } catch (error) {
    if (error instanceof TenantControlPlaneStoreError) {
      return noStoreJson({
        error: "Tenant repository grant store is unavailable.",
        code: "tenant_repository_grant_store_unavailable"
      }, { status: 503 });
    }

    throw error;
  }

  const appStatus = getGitHubAppConfigStatus();
  const boundedRepositories = repositories.slice(0, MAX_HEALTH_REPOSITORIES);
  let installationStatuses: Map<number, InstallationHealthStatus>;
  try {
    installationStatuses = await readInstallationStatuses(authorizedTenantId, boundedRepositories);
  } catch (error) {
    if (error instanceof GitHubInstallationStoreError) {
      return noStoreJson({
        error: "GitHub installation metadata is unavailable.",
        code: "tenant_repository_health_installation_metadata_unavailable"
      }, { status: 503 });
    }

    throw error;
  }
  const probeCandidates = probeGitHub && appStatus.ready
    ? selectProbeCandidates(boundedRepositories, requestedRepositoryId, installationStatuses)
    : [];
  const firstReportProbe = requestedRepositoryId && requestedPullRequestNumber
    ? { repositoryId: requestedRepositoryId, pullRequestNumber: requestedPullRequestNumber }
    : undefined;
  const probeResult = probeCandidates.length > 0
    ? await probeRepositoryAccess(probeCandidates, firstReportProbe)
    : emptyProbeResult();
  const health = boundedRepositories.map((grant) =>
    toRepositoryHealth(grant, {
      appCredentialsReady: appStatus.ready,
      installationStatus: installationStatusForGrant(grant, installationStatuses),
      githubAccess: probeGitHub
        ? probeResult.accessByRepository.get(repositoryHealthKey(grant)) ?? (appStatus.ready ? "not-checked" : "credentials-not-ready")
        : "not-checked",
      firstReport: probeResult.firstReportByRepository.get(repositoryHealthKey(grant))
    })
  );

  return noStoreJson({
    ok: true,
    tenantId: authorizedTenantId,
    repositories: health,
    truncated: repositories.length > boundedRepositories.length,
    probe: probeGitHub ? "github" : "metadata-only",
    githubProbe: probeGitHub ? {
      checkedRepositories: probeCandidates.length,
      maxRepositories: MAX_GITHUB_PROBE_REPOSITORIES,
      requestedRepositoryId,
      firstReport: requestedPullRequestNumber ? {
        pullRequestNumber: requestedPullRequestNumber,
        checkedRepositories: probeResult.firstReportByRepository.size,
        maxRepositories: 1
      } : undefined
    } : undefined,
    privacy: "grant-metadata-only",
    next: "fix_repository_setup"
  });
}

function selectProbeCandidates(
  grants: TenantRepositoryGrant[],
  requestedRepositoryId: number | undefined,
  installationStatuses: Map<number, InstallationHealthStatus>
): TenantRepositoryGrant[] {
  const withRepositoryIds = grants.filter((grant) =>
    Number.isInteger(grant.repositoryId) &&
    isInstallationActiveForProbe(installationStatusForGrant(grant, installationStatuses))
  );

  if (requestedRepositoryId) {
    return withRepositoryIds.filter((grant) => grant.repositoryId === requestedRepositoryId).slice(0, 1);
  }

  return withRepositoryIds.slice(0, MAX_GITHUB_PROBE_REPOSITORIES);
}

async function probeRepositoryAccess(
  grants: TenantRepositoryGrant[],
  firstReportProbe: GitHubFirstReportProbeRequest | undefined
): Promise<GitHubRepositoryProbeResult> {
  const accessByRepository = new Map<string, GitHubAccessStatus>();
  const firstReportByRepository = new Map<string, FirstReportDiagnostics>();
  const tokenByInstallation = new Map<number, string | null>();

  for (const grant of grants) {
    const key = repositoryHealthKey(grant);
    if (!grant.repositoryId) {
      accessByRepository.set(key, "inaccessible");
      continue;
    }

    let token = tokenByInstallation.get(grant.installationId);
    if (token === undefined) {
      try {
        token = await createGitHubInstallationAccessToken(grant.installationId);
      } catch (error) {
        if (error instanceof GitHubAppTokenError) {
          token = null;
        } else {
          throw error;
        }
      }
      tokenByInstallation.set(grant.installationId, token);
    }

    if (!token) {
      accessByRepository.set(key, "credentials-not-ready");
      if (isFirstReportProbeTarget(grant, firstReportProbe)) {
        firstReportByRepository.set(key, firstReportFromLocalBlock(firstReportProbe.pullRequestNumber, "credentials-not-ready"));
      }
      continue;
    }

    const githubAccess = await fetchRepositoryAccess(grant.repositoryId, token);
    accessByRepository.set(key, githubAccess);

    if (!isFirstReportProbeTarget(grant, firstReportProbe)) {
      continue;
    }

    if (!grant.enabled) {
      firstReportByRepository.set(key, firstReportFromLocalBlock(firstReportProbe.pullRequestNumber, "repository-disabled"));
      continue;
    }

    if (!grant.analysisEnabled) {
      firstReportByRepository.set(key, firstReportFromLocalBlock(firstReportProbe.pullRequestNumber, "analysis-disabled"));
      continue;
    }

    if (githubAccess !== "accessible") {
      firstReportByRepository.set(key, firstReportFromRepositoryAccess(firstReportProbe.pullRequestNumber, githubAccess));
      continue;
    }

    firstReportByRepository.set(
      key,
      await fetchFirstReportDiagnostics(grant, firstReportProbe.pullRequestNumber, token)
    );
  }

  return { accessByRepository, firstReportByRepository };
}

async function fetchRepositoryAccess(repositoryId: number, token: string): Promise<LiveGitHubAccessStatus> {
  try {
    const response = await fetch(`https://api.github.com/repositories/${repositoryId}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28"
      },
      cache: "no-store",
      signal: AbortSignal.timeout(GITHUB_REPOSITORY_PROBE_TIMEOUT_MS)
    });

    if (response.status === 429 || response.headers.get("x-ratelimit-remaining") === "0") return "rate-limited";
    if (response.ok) return "accessible";
    if (response.status === 404 || response.status === 403) return "inaccessible";

    return "unavailable";
  } catch {
    return "unavailable";
  }
}

function toRepositoryHealth(
  grant: TenantRepositoryGrant,
  options: {
    appCredentialsReady: boolean;
    installationStatus: InstallationHealthStatus;
    githubAccess: GitHubAccessStatus;
    firstReport?: FirstReportDiagnostics;
  }
): RepositoryHealth {
  const grantActive = grant.enabled;
  const analysisEnabled = grant.analysisEnabled;
  const status = healthStatus({
    grantActive,
    analysisEnabled,
    installationStatus: options.installationStatus,
    appCredentialsReady: options.appCredentialsReady,
    githubAccess: options.githubAccess
  });

  return {
    installationId: grant.installationId,
    repositoryId: grant.repositoryId,
    repositoryFullName: grant.repositoryFullName,
    enabled: grant.enabled,
    analysisEnabled: grant.analysisEnabled,
    saveReportsEnabled: grant.saveReportsEnabled,
    commentEnabled: grant.commentEnabled,
    slackNotificationsEnabled: grant.slackNotificationsEnabled,
    status,
    githubAccess: options.githubAccess,
    checks: {
      grantActive,
      analysisEnabled,
      installationStatus: options.installationStatus,
      appCredentialsReady: options.appCredentialsReady,
      githubAccess: options.githubAccess
    },
    firstReport: options.firstReport,
    nextAction: nextActionForStatus(status)
  };
}

function healthStatus(input: {
  grantActive: boolean;
  analysisEnabled: boolean;
  installationStatus: InstallationHealthStatus;
  appCredentialsReady: boolean;
  githubAccess: GitHubAccessStatus;
}): GrantHealthStatus {
  if (!input.grantActive) return "disabled";
  if (!input.analysisEnabled) return "analysis-disabled";
  if (input.installationStatus === "deleted") return "installation-deleted";
  if (input.installationStatus === "suspended") return "installation-suspended";
  if (!input.appCredentialsReady) return "app-credentials-not-ready";
  if (input.githubAccess === "credentials-not-ready") return "app-credentials-not-ready";
  if (input.githubAccess === "accessible") return "github-accessible";
  if (input.githubAccess === "inaccessible") return "github-inaccessible";
  if (input.githubAccess === "rate-limited") return "github-rate-limited";
  if (input.githubAccess === "unavailable") return "github-unavailable";
  if (input.githubAccess === "not-checked") return "github-not-checked";

  return "ready";
}

function nextActionForStatus(status: GrantHealthStatus): string {
  if (status === "disabled") return "Enable this repository grant before AgentProof can verify PRs.";
  if (status === "analysis-disabled") return "Enable evidence report analysis for this repository.";
  if (status === "installation-deleted") return "Reconnect the GitHub App installation before verifying this repository.";
  if (status === "installation-suspended") return "Resume the GitHub App installation before verifying this repository.";
  if (status === "app-credentials-not-ready") return "Configure GitHub App credentials before running repository health probes.";
  if (status === "github-inaccessible") return "Check GitHub App installation access for this repository.";
  if (status === "github-rate-limited") return "Wait for GitHub rate limits to recover, then rerun the health probe.";
  if (status === "github-unavailable") return "Retry the GitHub access probe or check provider status.";
  if (status === "github-not-checked") return "Run a GitHub access probe when you need live installation verification.";

  return "Repository is ready for AgentProof evidence reports.";
}

function repositoryHealthKey(grant: TenantRepositoryGrant): string {
  return `${grant.installationId}:${grant.repositoryId ?? grant.repositoryFullName.toLowerCase()}`;
}

async function readInstallationStatuses(
  tenantId: string,
  grants: TenantRepositoryGrant[]
): Promise<Map<number, InstallationHealthStatus>> {
  const statuses = await listTenantGitHubInstallationStatuses({
    tenantId,
    installationIds: grants.map((grant) => grant.installationId)
  });

  return new Map(statuses.map((status) => [status.installationId, status.status]));
}

function installationStatusForGrant(
  grant: TenantRepositoryGrant,
  installationStatuses: Map<number, InstallationHealthStatus>
): InstallationHealthStatus {
  return installationStatuses.get(grant.installationId) ?? "unknown";
}

function isInstallationActiveForProbe(status: InstallationHealthStatus): boolean {
  return status === "unknown" || status === "active";
}

function normalizeRepositoryId(value: string | null): number | undefined {
  if (!value) return undefined;
  if (!/^\d{1,12}$/.test(value)) return undefined;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return undefined;

  return parsed;
}

function normalizePullRequestNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  if (!/^\d{1,10}$/.test(value)) return undefined;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return undefined;

  return parsed;
}

function emptyProbeResult(): GitHubRepositoryProbeResult {
  return {
    accessByRepository: new Map<string, GitHubAccessStatus>(),
    firstReportByRepository: new Map<string, FirstReportDiagnostics>()
  };
}

function isFirstReportProbeTarget(
  grant: TenantRepositoryGrant,
  firstReportProbe: GitHubFirstReportProbeRequest | undefined
): firstReportProbe is GitHubFirstReportProbeRequest {
  return Boolean(firstReportProbe && grant.repositoryId === firstReportProbe.repositoryId);
}

async function fetchFirstReportDiagnostics(
  grant: TenantRepositoryGrant,
  pullRequestNumber: number,
  token: string
): Promise<FirstReportDiagnostics> {
  const parsedRepository = parseRepositoryFullName(grant.repositoryFullName);
  if (!parsedRepository) {
    return firstReportFromRepositoryAccess(pullRequestNumber, "unavailable");
  }

  const headers = githubProbeHeaders(token);
  let prResponse: Response;

  try {
    prResponse = await fetch(
      `https://api.github.com/repos/${parsedRepository.owner}/${parsedRepository.repo}/pulls/${pullRequestNumber}`,
      {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(GITHUB_FIRST_REPORT_PROBE_TIMEOUT_MS)
      }
    );
  } catch {
    return firstReportFromRepositoryAccess(pullRequestNumber, "unavailable");
  }

  if (isGitHubRateLimited(prResponse)) {
    return firstReportFromRepositoryAccess(pullRequestNumber, "rate-limited");
  }

  if (prResponse.status === 404 || prResponse.status === 403) {
    return firstReportFromRepositoryAccess(pullRequestNumber, "inaccessible");
  }

  if (!prResponse.ok) {
    return firstReportFromRepositoryAccess(pullRequestNumber, "unavailable");
  }

  const pr = await safeJson(prResponse);
  const changedFilesValue = pr?.changed_files;
  const changedFileCount = typeof changedFilesValue === "number" && Number.isInteger(changedFilesValue) && changedFilesValue >= 0
    ? changedFilesValue
    : undefined;
  const head = isRecord(pr?.head) ? pr.head : undefined;
  const headShaValue = head?.sha;
  const headSha = typeof headShaValue === "string" && /^[a-f0-9]{7,64}$/i.test(headShaValue)
    ? headShaValue
    : undefined;
  const checksAvailability = headSha
    ? await fetchChecksAvailability(parsedRepository.owner, parsedRepository.repo, headSha, headers)
    : { status: "unavailable" as const, sources: [] };
  const changedFiles = changedFilesReadiness(changedFileCount);
  const status = firstReportStatus({ changedFiles, checksAvailability });

  return {
    privacy: "first-report-readiness-metadata-only",
    pullRequestNumber,
    status,
    pullRequestAccess: "accessible",
    changedFiles,
    checksAvailability,
    nextAction: nextActionForFirstReportStatus(status)
  };
}

async function fetchChecksAvailability(
  owner: string,
  repo: string,
  headSha: string,
  headers: Record<string, string>
): Promise<FirstReportDiagnostics["checksAvailability"]> {
  const [checkRuns, commitStatuses] = await Promise.all([
    fetchCheckRunAvailability(owner, repo, headSha, headers),
    fetchCommitStatusAvailability(owner, repo, headSha, headers)
  ]);
  const sources: FirstReportDiagnostics["checksAvailability"]["sources"] = [];
  if (checkRuns.status === "present") sources.push("check-runs");
  if (commitStatuses.status === "present") sources.push("commit-statuses");

  if (sources.length > 0) {
    return { status: "present", sources };
  }

  if (checkRuns.status === "rate-limited" || commitStatuses.status === "rate-limited") {
    return { status: "rate-limited", sources };
  }

  if (checkRuns.status === "unavailable" || commitStatuses.status === "unavailable") {
    return { status: "unavailable", sources };
  }

  return { status: "missing", sources };
}

async function fetchCheckRunAvailability(
  owner: string,
  repo: string,
  headSha: string,
  headers: Record<string, string>
): Promise<{ status: Exclude<ChecksAvailabilityStatus, "not-checked"> }> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits/${headSha}/check-runs?per_page=1`,
      {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(GITHUB_FIRST_REPORT_PROBE_TIMEOUT_MS)
      }
    );

    if (isGitHubRateLimited(response)) return { status: "rate-limited" };
    if (!response.ok) return { status: "unavailable" };

    const json = await safeJson(response);
    const totalCount = json?.total_count;
    return { status: typeof totalCount === "number" && totalCount > 0 ? "present" : "missing" };
  } catch {
    return { status: "unavailable" };
  }
}

async function fetchCommitStatusAvailability(
  owner: string,
  repo: string,
  headSha: string,
  headers: Record<string, string>
): Promise<{ status: Exclude<ChecksAvailabilityStatus, "not-checked"> }> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits/${headSha}/status`,
      {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(GITHUB_FIRST_REPORT_PROBE_TIMEOUT_MS)
      }
    );

    if (isGitHubRateLimited(response)) return { status: "rate-limited" };
    if (!response.ok) return { status: "unavailable" };

    const json = await safeJson(response);
    const statuses = Array.isArray(json?.statuses) ? json.statuses : [];
    return { status: statuses.length > 0 ? "present" : "missing" };
  } catch {
    return { status: "unavailable" };
  }
}

function firstReportFromLocalBlock(
  pullRequestNumber: number,
  status: Extract<FirstReportReadinessStatus, "repository-disabled" | "analysis-disabled" | "credentials-not-ready">
): FirstReportDiagnostics {
  return {
    privacy: "first-report-readiness-metadata-only",
    pullRequestNumber,
    status,
    pullRequestAccess: status === "credentials-not-ready" ? "credentials-not-ready" : "not-checked",
    changedFiles: notCheckedChangedFiles(),
    checksAvailability: notCheckedChecksAvailability(),
    nextAction: nextActionForFirstReportStatus(status)
  };
}

function firstReportFromRepositoryAccess(
  pullRequestNumber: number,
  githubAccess: Exclude<GitHubAccessStatus, "accessible" | "not-checked">
): FirstReportDiagnostics {
  const status = firstReportStatusFromGitHubAccess(githubAccess);

  return {
    privacy: "first-report-readiness-metadata-only",
    pullRequestNumber,
    status,
    pullRequestAccess: githubAccess,
    changedFiles: notCheckedChangedFiles(),
    checksAvailability: notCheckedChecksAvailability(),
    nextAction: nextActionForFirstReportStatus(status)
  };
}

function firstReportStatusFromGitHubAccess(
  githubAccess: Exclude<GitHubAccessStatus, "accessible" | "not-checked">
): Extract<FirstReportReadinessStatus, "credentials-not-ready" | "pull-request-inaccessible" | "pull-request-rate-limited" | "pull-request-unavailable"> {
  if (githubAccess === "credentials-not-ready") return "credentials-not-ready";
  if (githubAccess === "rate-limited") return "pull-request-rate-limited";
  if (githubAccess === "inaccessible") return "pull-request-inaccessible";

  return "pull-request-unavailable";
}

function firstReportStatus(input: {
  changedFiles: FirstReportDiagnostics["changedFiles"];
  checksAvailability: FirstReportDiagnostics["checksAvailability"];
}): FirstReportReadinessStatus {
  if (input.changedFiles.status === "unavailable") return "pull-request-unavailable";
  if (input.changedFiles.status === "over-limit") return "large-pr-capped";
  if (input.checksAvailability.status === "missing") return "checks-missing";
  if (input.checksAvailability.status === "rate-limited") return "checks-rate-limited";
  if (input.checksAvailability.status === "unavailable") return "checks-unavailable";

  return "ready";
}

function changedFilesReadiness(count: number | undefined): FirstReportDiagnostics["changedFiles"] {
  if (count === undefined) {
    return {
      status: "unavailable",
      maxFiles: GITHUB_MAX_CHANGED_FILES
    };
  }

  return {
    status: count > GITHUB_MAX_CHANGED_FILES ? "over-limit" : "within-limit",
    count,
    maxFiles: GITHUB_MAX_CHANGED_FILES
  };
}

function notCheckedChangedFiles(): FirstReportDiagnostics["changedFiles"] {
  return {
    status: "not-checked",
    maxFiles: GITHUB_MAX_CHANGED_FILES
  };
}

function notCheckedChecksAvailability(): FirstReportDiagnostics["checksAvailability"] {
  return {
    status: "not-checked",
    sources: []
  };
}

function nextActionForFirstReportStatus(status: FirstReportReadinessStatus): string {
  if (status === "repository-disabled") return "Enable this repository grant before expecting PR evidence reports.";
  if (status === "analysis-disabled") return "Enable evidence report analysis for this repository.";
  if (status === "credentials-not-ready") return "Configure GitHub App credentials before probing PR readiness.";
  if (status === "pull-request-inaccessible") return "Check that the GitHub App can read this PR and repository.";
  if (status === "pull-request-rate-limited") return "Wait for GitHub rate limits to recover, then rerun the PR readiness probe.";
  if (status === "pull-request-unavailable") return "Retry the PR readiness probe or check GitHub provider status.";
  if (status === "large-pr-capped") return `This PR exceeds the ${GITHUB_MAX_CHANGED_FILES} changed-file evidence cap; split it or expect incomplete file evidence.`;
  if (status === "checks-missing") return "Add or trigger CI checks for this PR before expecting execution evidence.";
  if (status === "checks-rate-limited") return "Wait for GitHub check/status rate limits to recover, then rerun the PR readiness probe.";
  if (status === "checks-unavailable") return "Retry the PR readiness probe or check GitHub check/status API availability.";

  return "This PR has bounded metadata, changed-file count, and GitHub check/status evidence available for the first report.";
}

function parseRepositoryFullName(value: string): { owner: string; repo: string } | null {
  const [owner, repo, ...rest] = value.split("/");
  if (!owner || !repo || rest.length > 0) return null;

  return {
    owner: encodeURIComponent(owner),
    repo: encodeURIComponent(repo)
  };
}

function githubProbeHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

function isGitHubRateLimited(response: Response): boolean {
  return response.status === 429 || response.headers.get("x-ratelimit-remaining") === "0";
}

async function safeJson(response: Response): Promise<Record<string, unknown> | undefined> {
  try {
    const json = await response.json();
    return isRecord(json) ? json : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
