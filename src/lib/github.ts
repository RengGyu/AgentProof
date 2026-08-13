import { createHash } from "crypto";
import type { AnalyzeRequest, ChangedFile, CheckRun, ExecutionSuiteObservation, LogSnippet, PullRequestInput, SourceProvenance } from "./types";
import { isExecutionEvidenceSignal, isFailedAmbiguousActionsExecutionSignal } from "./evidence-status";
import {
  extractSupportedIssueReferences,
  formatIssueReference,
  type SupportedIssueReference
} from "./github-linked-issues";
import { compactText, redactSecrets } from "./redact";

const GITHUB_FETCH_TIMEOUT_MS = 8000;
const GITHUB_CHECK_RUNS_TIMEOUT_MS = 5000;
const GITHUB_COMMIT_STATUS_TIMEOUT_MS = 2000;
const GITHUB_CHECK_ANNOTATION_TIMEOUT_MS = 2500;
const GITHUB_ACTION_JOB_TIMEOUT_MS = 2500;
const GITHUB_PAGE_SIZE = 100;
const GITHUB_MAX_PAGES = 3;
export const GITHUB_MAX_CHANGED_FILES = 120;
const GITHUB_MAX_CHECK_RUNS = 60;
const GITHUB_MAX_COMMIT_STATUSES = 30;
const GITHUB_MAX_ACTION_RUNS = 3;
const GITHUB_MAX_ACTION_JOB_SUMMARIES = 12;
const GITHUB_MAX_ACTION_STEPS_PER_JOB = 8;
const GITHUB_MAX_ANNOTATED_CHECK_RUNS = 3;
const GITHUB_MAX_CHECK_ANNOTATIONS_TOTAL = 20;
const GITHUB_MAX_CHECK_ANNOTATIONS_PER_RUN = 10;
export const GITHUB_EVIDENCE_TIMING_PHASES = [
  "github_pr",
  "github_files",
  "github_checks",
  "github_statuses",
  "github_annotations",
  "github_jobs"
] as const;
const NON_PROOF_ACTION_STEP_PATTERN =
  /\b(checkout|setup|cache|install dependencies|upload|download|artifact|publish|preview|deploy|deployment|report|notify|changelog|change log|release notes?|towncrier|codecov|coverage (?:gate|policy|report|threshold|upload)|optional|non[- ]?blocking)\b/i;
const GENERIC_ACTION_JOB_NAME_PATTERN = /^\s*(ci|checks?|workflow|github actions)\s*$/i;

export type GitHubEvidenceTimingPhase = (typeof GITHUB_EVIDENCE_TIMING_PHASES)[number];

export interface GitHubEvidenceTimingSink {
  record: (phase: GitHubEvidenceTimingPhase, durationMs: number) => void;
}

export type GitHubFetchFailureCode =
  | "github_rate_limited"
  | "github_secondary_rate_limited"
  | "github_token_rejected"
  | "github_auth_required"
  | "github_permission_denied"
  | "github_not_found"
  | "github_fetch_failed";

interface GitHubFailureClassification {
  code: GitHubFetchFailureCode;
  reason: string;
}

export class GitHubFetchError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: GitHubFetchFailureCode,
    public readonly reason: string,
    public readonly tokenProvided = false
  ) {
    super(status > 0
      ? `GitHub PR fetch failed: ${reason} (HTTP ${status}).`
      : `GitHub PR fetch failed: ${reason}`);
  }
}

export class GitHubPullRequestHeadChangedError extends Error {
  constructor(
    public readonly expectedHeadSha: string,
    public readonly observedHeadSha: string,
    public readonly phase: "initial" | "final",
    public readonly anchor: "head" | "base" = "head"
  ) {
    super(`GitHub pull request ${anchor} changed while AgentProof was collecting evidence.`);
    this.name = "GitHubPullRequestHeadChangedError";
  }
}

export interface GitHubPullRequestSnapshotOptions {
  expectedHeadSha?: string;
  expectedBaseSha?: string;
  now?: () => Date;
}

interface GitHubPullUrl {
  owner: string;
  repo: string;
  number: number;
}

interface GitHubIssueResponse {
  title?: string;
  body?: string | null;
  pull_request?: unknown;
}

interface GitHubFileResponse {
  filename: string;
  additions: number;
  deletions: number;
  status: ChangedFile["status"];
  patch?: string;
}

interface GitHubCheckRunResponse {
  id?: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url?: string;
  details_url?: string;
  output?: {
    title?: string;
    summary?: string;
  };
  annotations?: GitHubCheckAnnotationSummary[];
}

interface GitHubStatusResponse {
  context: string;
  state: string;
  target_url?: string;
  description?: string;
}

interface GitHubActionJobResponse {
  name: string;
  status: string;
  conclusion: string | null;
  html_url?: string;
  steps?: GitHubActionStepResponse[];
}

interface GitHubActionStepResponse {
  name: string;
  status: string;
  conclusion: string | null;
}

interface GitHubCheckAnnotationResponse {
  path?: string;
  start_line?: number;
  end_line?: number;
  annotation_level?: string;
  title?: string;
  message?: string;
  raw_details?: string;
}

interface GitHubCheckAnnotationSummary {
  path: string;
  line?: number;
  level: string;
}

interface GitHubCheckAnnotationFetchResult {
  checkId: number;
  annotations: GitHubCheckAnnotationSummary[];
  limitation?: string;
}

interface GitHubActionJobFetchResult {
  logs: LogSnippet[];
  executionSuites: ExecutionSuiteObservation[];
  limitation?: string;
}

export function parseGitHubPullUrl(url: string): GitHubPullUrl | null {
  try {
    const normalizedUrl = /^[a-z][a-z\d+.-]*:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    const parsed = new URL(normalizedUrl);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const [owner, repo, pull, number] = parts;

    if (
      parsed.hostname.toLowerCase() !== "github.com" ||
      !["http:", "https:"].includes(parsed.protocol) ||
      parts.length !== 4 ||
      !owner ||
      !repo ||
      pull !== "pull" ||
      !number ||
      !Number.isInteger(Number(number)) ||
      Number(number) <= 0
    ) {
      return null;
    }

    return { owner, repo, number: Number(number) };
  } catch {
    return null;
  }
}

export function normalizeGitHubPullUrl(url: string): string | null {
  const parsed = parseGitHubPullUrl(url);
  if (!parsed) return null;

  return `https://github.com/${parsed.owner}/${parsed.repo}/pull/${parsed.number}`;
}

export async function buildPullRequestInput(
  request: AnalyzeRequest,
  evidenceTiming?: GitHubEvidenceTimingSink
): Promise<PullRequestInput> {
  if (request.prUrl) {
    if (!parseGitHubPullUrl(request.prUrl)) {
      throw new Error("PR URL must be a GitHub pull request URL, for example https://github.com/org/repo/pull/123.");
    }

    try {
      const live = await buildGitHubPullRequestInput(request.prUrl, request.githubToken, request.taskText ?? "", evidenceTiming);

      if (live) {
        return mergePastedOverrides(live, request);
      }
    } catch (error) {
      if (error instanceof GitHubPullRequestHeadChangedError) {
        throw error;
      }

      if (!hasPastedEvidence(request)) {
        throw error;
      }

      return buildPastedPullRequestInput(request, [
        githubFallbackLimitation(error)
      ]);
    }
  }

  return buildPastedPullRequestInput(request);
}

export async function buildGitHubPullRequestInput(
  prUrl: string,
  token: string | undefined,
  taskText = "",
  evidenceTiming?: GitHubEvidenceTimingSink,
  snapshotOptions: GitHubPullRequestSnapshotOptions = {}
): Promise<PullRequestInput | null> {
  return fetchGitHubPullRequest(prUrl, token, taskText, evidenceTiming, snapshotOptions);
}

function buildPastedPullRequestInput(request: AnalyzeRequest, extraLimitations: string[] = []): PullRequestInput {
  const safePrUrl = request.prUrl ? normalizeGitHubPullUrl(request.prUrl) ?? redactSecrets(request.prUrl) : undefined;

  return {
    url: safePrUrl,
    title: safePrUrl ? `PR analysis for ${safePrUrl}` : "Pasted PR evidence",
    description: redactSecrets(request.prDescription ?? ""),
    taskSource: request.taskText?.trim() ? "task" : undefined,
    taskText: redactSecrets(request.taskText ?? ""),
    changedFiles: parseChangedFiles(request.changedFiles ?? ""),
    checks: parseChecks(request.checks ?? ""),
    logs: parseLogs(request.logs ?? ""),
    limitations: [...(request.inputLimitations ?? []), ...extraLimitations],
    sourceProvenance: buildMetadataOnlyProvenance({
      origin: "pasted_evidence",
      input: {
        url: safePrUrl,
        title: safePrUrl ? `PR analysis for ${safePrUrl}` : "Pasted PR evidence",
        description: redactSecrets(request.prDescription ?? ""),
        taskSource: request.taskText?.trim() ? "task" : undefined,
        taskText: redactSecrets(request.taskText ?? ""),
        changedFiles: parseChangedFiles(request.changedFiles ?? ""),
        checks: parseChecks(request.checks ?? ""),
        logs: parseLogs(request.logs ?? ""),
        limitations: [...(request.inputLimitations ?? []), ...extraLimitations]
      },
      capturedAt: new Date().toISOString()
    })
  };
}

async function fetchGitHubPullRequest(
  prUrl: string,
  token: string | undefined,
  taskText: string,
  evidenceTiming?: GitHubEvidenceTimingSink,
  snapshotOptions: GitHubPullRequestSnapshotOptions = {}
): Promise<PullRequestInput | null> {
  const parsed = parseGitHubPullUrl(prUrl);

  if (!parsed) {
    return null;
  }

  const safePrUrl = normalizeGitHubPullUrl(prUrl) ?? redactSecrets(prUrl);

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  const hasToken = Boolean(token?.trim());
  let prResponse: Response;

  try {
    prResponse = await measureGitHubEvidenceTiming(
      evidenceTiming,
      "github_pr",
      () => githubFetch(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`,
        headers
      )
    );
  } catch {
    throw new GitHubFetchError(
      0,
      "github_fetch_failed",
      "GitHub metadata request timed out or network failed.",
      hasToken
    );
  }

  if (!prResponse.ok) {
    const failure = classifyGitHubFailure(prResponse, hasToken);
    throw new GitHubFetchError(prResponse.status, failure.code, failure.reason, hasToken);
  }

  const pr = await prResponse.json();
  const initialHeadSha = requireGitHubHeadSha(pr, "initial");
  const initialBaseSha = requireGitHubBaseSha(pr, "initial");
  assertExpectedAnchor(snapshotOptions.expectedHeadSha, initialHeadSha, "initial", "head");
  assertExpectedAnchor(snapshotOptions.expectedBaseSha, initialBaseSha, "initial", "base");
  const limitations: string[] = [];
  const linkedIssueTask = await resolveLinkedIssueTaskText({
    prBody: String(pr.body ?? ""),
    repository: { owner: parsed.owner, repo: parsed.repo },
    headers,
    limitations,
    hasToken
  });
  const [files, checkRuns, statuses] = await Promise.all([
    measureGitHubEvidenceTiming(
      evidenceTiming,
      "github_files",
      () => fetchPullFiles(pr.url + "/files", headers, limitations, hasToken)
    ),
    measureGitHubEvidenceTiming(
      evidenceTiming,
      "github_checks",
      () => fetchCheckRuns(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${initialHeadSha}/check-runs`, headers, limitations, hasToken)
    ),
    measureGitHubEvidenceTiming(
      evidenceTiming,
      "github_statuses",
      () => fetchCommitStatuses(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${initialHeadSha}/status`, headers, limitations, hasToken)
    )
  ]);
  const annotationLimitations: string[] = [];
  const actionJobLimitations: string[] = [];
  const [annotatedCheckRuns, actionJobEvidence] = await Promise.all([
    measureGitHubEvidenceTiming(
      evidenceTiming,
      "github_annotations",
      () => fetchCheckRunAnnotations(parsed.owner, parsed.repo, checkRuns, headers, annotationLimitations, hasToken)
    ),
    measureGitHubEvidenceTiming(
      evidenceTiming,
      "github_jobs",
      () => fetchActionJobSummaries(parsed.owner, parsed.repo, checkRuns, headers, actionJobLimitations, hasToken, initialHeadSha, files)
    )
  ]);

  limitations.push(...annotationLimitations, ...actionJobLimitations);
  limitations.push(...githubEvidenceSourceLimitations(checkRuns, statuses, actionJobEvidence.logs, actionJobEvidence.executionSuites));
  const missingPatchCount = files.filter((file) => !file.patch).length;

  if (missingPatchCount > 0) {
    limitations.push(
      `GitHub did not return patch text for ${missingPatchCount} changed file(s); file metadata was collected, but diff evidence is unavailable for those files.`
    );
  }

  const finalAnchor = await fetchGitHubPullRequestAnchorFromApi(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`,
    headers,
    hasToken
  );
  assertExpectedAnchor(initialHeadSha, finalAnchor.headSha, "final", "head");
  assertExpectedAnchor(initialBaseSha, finalAnchor.baseSha, "final", "base");

  const input: PullRequestInput = {
    url: safePrUrl,
    title: pr.title ?? `PR #${parsed.number}`,
    description: redactSecrets(pr.body ?? ""),
    author: pr.user?.login,
    baseBranch: pr.base?.ref,
    headBranch: pr.head?.ref,
    taskSource: taskText.trim() ? "task" : linkedIssueTask ? "issue" : undefined,
    taskText: taskText.trim() ? redactSecrets(taskText) : linkedIssueTask?.taskText ?? "",
    requirementSourceIdentityHash: taskText.trim()
      ? requirementSourceIdentityHash(`github_task:${parsed.owner.toLowerCase()}/${parsed.repo.toLowerCase()}#${parsed.number}`)
      : linkedIssueTask?.identityHash ??
        requirementSourceIdentityHash(`github_pr_description:${parsed.owner.toLowerCase()}/${parsed.repo.toLowerCase()}#${parsed.number}`),
    verificationContractSourceV2: taskText.trim()
      ? undefined
      : linkedIssueTask?.contractSource ?? {
        kind: "pr_description" as const,
        title: pr.title ?? `PR #${parsed.number}`,
        body: redactSecrets(pr.body ?? "")
      },
    verificationContractBindingV2: taskText.trim()
      ? undefined
      : linkedIssueTask
        ? {
          ...linkedIssueTask.contractBinding,
          headSha: initialHeadSha,
          baseSha: initialBaseSha
        }
        : {
          sourceKind: "pr_description" as const,
          sourceIdentity: `github:pr_description:${parsed.owner.toLowerCase()}/${parsed.repo.toLowerCase()}#${parsed.number}`,
          sourceContent: redactSecrets(pr.body ?? ""),
          headSha: initialHeadSha,
          baseSha: initialBaseSha
        },
    changedFiles: files.map((file) => ({
      path: file.filename,
      additions: file.additions,
      deletions: file.deletions,
      status: file.status,
      patch: file.patch ? compactText(file.patch, 1000) : undefined
    })),
    checks: annotatedCheckRuns.map((check) => ({
      name: check.name,
      status: mapGitHubObservationStatus(mapGitHubCheckStatus(check.status, check.conclusion)),
      summary: checkSummaryWithAnnotations(check),
      url: sanitizeGitHubEvidenceUrl(check.html_url)
    })).concat(statuses.map((status) => ({
      name: status.context,
      status: mapGitHubObservationStatus(mapGitHubCommitStatus(status.state)),
      summary: status.description ? compactText(status.description, 240) : undefined,
      url: sanitizeGitHubEvidenceUrl(status.target_url)
    }))),
    logs: actionJobEvidence.logs,
    executionSuites: actionJobEvidence.executionSuites,
    limitations: normalizeGitHubEvidenceLimitations(limitations)
  };
  input.sourceProvenance = buildMetadataOnlyProvenance({
    origin: "github_snapshot",
    input,
    headSha: initialHeadSha,
    baseSha: initialBaseSha,
    capturedAt: (snapshotOptions.now ?? (() => new Date()))().toISOString()
  });
  return input;
}

function requireGitHubHeadSha(pr: unknown, phase: "initial" | "final"): string {
  const value = typeof pr === "object" && pr !== null
    && "head" in pr && typeof pr.head === "object" && pr.head !== null
    && "sha" in pr.head && typeof pr.head.sha === "string"
    ? pr.head.sha.trim()
    : "";
  if (!value) throw new GitHubFetchError(0, "github_fetch_failed", `GitHub ${phase} pull request metadata did not include a head SHA.`);
  return value;
}

function requireGitHubBaseSha(pr: unknown, phase: "initial" | "final"): string {
  const value = typeof pr === "object" && pr !== null
    && "base" in pr && typeof pr.base === "object" && pr.base !== null
    && "sha" in pr.base && typeof pr.base.sha === "string"
    ? pr.base.sha.trim()
    : "";
  if (!value) throw new GitHubFetchError(0, "github_fetch_failed", `GitHub ${phase} pull request metadata did not include a base SHA.`);
  return value;
}

function assertExpectedAnchor(
  expectedSha: string | undefined,
  observedSha: string,
  phase: "initial" | "final",
  anchor: "head" | "base"
) {
  if (expectedSha?.trim() && expectedSha.trim() !== observedSha) {
    throw new GitHubPullRequestHeadChangedError(expectedSha.trim(), observedSha, phase, anchor);
  }
}

async function fetchGitHubPullRequestAnchorFromApi(
  url: string,
  headers: Record<string, string>,
  hasToken: boolean
): Promise<{ headSha: string; baseSha: string }> {
  let response: Response;
  try {
    response = await githubFetch(url, headers);
  } catch {
    throw new GitHubFetchError(
      0,
      "github_fetch_failed",
      "GitHub final pull request metadata request timed out or network failed.",
      hasToken
    );
  }
  if (!response.ok) {
    const failure = classifyGitHubFailure(response, hasToken);
    throw new GitHubFetchError(response.status, failure.code, failure.reason, hasToken);
  }
  const pr = await response.json();
  return {
    headSha: requireGitHubHeadSha(pr, "final"),
    baseSha: requireGitHubBaseSha(pr, "final")
  };
}

export async function fetchGitHubPullRequestHead(prUrl: string, token: string | undefined, evidenceTiming?: GitHubEvidenceTimingSink): Promise<string | null> {
  return (await fetchGitHubPullRequestAnchor(prUrl, token, evidenceTiming))?.headSha ?? null;
}

export async function fetchGitHubPullRequestAnchor(
  prUrl: string,
  token: string | undefined,
  evidenceTiming?: GitHubEvidenceTimingSink
): Promise<{ headSha: string; baseSha: string } | null> {
  const parsed = parseGitHubPullUrl(prUrl);
  if (!parsed) return null;
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  const hasToken = Boolean(token?.trim());
  let response: Response;
  try {
    response = await measureGitHubEvidenceTiming(evidenceTiming, "github_pr", () => githubFetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`, headers));
  } catch {
    throw new GitHubFetchError(0, "github_fetch_failed", "GitHub final pull request metadata request timed out or network failed.", hasToken);
  }
  if (!response.ok) {
    const failure = classifyGitHubFailure(response, hasToken);
    throw new GitHubFetchError(response.status, failure.code, failure.reason, hasToken);
  }
  const pr = await response.json();
  return {
    headSha: requireGitHubHeadSha(pr, "final"),
    baseSha: requireGitHubBaseSha(pr, "final")
  };
}

function buildMetadataOnlyProvenance({ origin, input, capturedAt, headSha, baseSha }: { origin: SourceProvenance["origin"]; input: PullRequestInput; capturedAt: string; headSha?: string; baseSha?: string }): SourceProvenance {
  const hasFullHeadSha = typeof headSha === "string" && /^[a-f0-9]{40,64}$/.test(headSha);
  const coverage = origin === "github_snapshot" ? "github_metadata" : origin === "demo" ? "demo_fixture" : "pasted_metadata";
  const canonical = JSON.stringify({
    version: 1, origin, url: normalizeGitHubPullUrl(input.url ?? "") ?? undefined, headSha, baseSha,
    baseBranch: input.baseBranch ?? undefined, headBranch: input.headBranch ?? undefined, taskSource: input.taskSource ?? undefined,
    textLengths: { task: input.taskText.length, description: input.description.length },
    changedFiles: [...input.changedFiles].map((file) => ({ path: file.path, status: file.status, additions: file.additions, deletions: file.deletions, patchLength: file.patch?.length ?? 0 })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    checks: [...input.checks].map((check) => ({ name: check.name, status: check.status, summaryLength: check.summary?.length ?? 0, urlHost: safeUrlHost(check.url) })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    logs: [...input.logs].map((log) => ({ source: log.source, status: log.status, textLength: log.text.length, urlHost: safeUrlHost(log.url) })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    executionSuites: [...(input.executionSuites ?? [])].map((suite) => ({
      headSha: suite.headSha,
      status: suite.status,
      executionSource: suite.executionSource,
      runner: suite.runner,
      scope: suite.scope,
      testPaths: [...suite.testPaths].sort()
    })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    limitations: [...(input.limitations ?? [])].map((limitation) => limitation.length).sort((left, right) => left - right)
  });
  return {
    version: 1,
    origin,
    ...(headSha ? { headSha } : {}),
    ...(baseSha ? { baseSha } : {}),
    changedFileInventory: {
      version: 1,
      completeness: origin === "github_snapshot" && hasFullHeadSha && !hasIncompleteChangedFileInventory(input.limitations)
        ? "complete"
        : "incomplete",
      ...(hasFullHeadSha ? { headSha } : {})
    },
    ...(input.executionSuites?.length ? { executionSuites: input.executionSuites } : {}),
    evidenceCapturedAt: capturedAt,
    inputFingerprint: {
      version: 1,
      algorithm: "sha256",
      value: createHash("sha256").update(canonical).digest("hex"),
      coverage
    }
  };
}

function hasIncompleteChangedFileInventory(limitations: string[] | undefined): boolean {
  return (limitations ?? []).some((limitation) =>
    /changed-file evidence (?:unavailable|was capped)|changed-file fetch failed|file evidence may be incomplete|patch text|diff evidence is unavailable/i.test(limitation)
  );
}

function safeUrlHost(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try { return new URL(value).hostname.toLowerCase(); } catch { return undefined; }
}

function githubEvidenceSourceLimitations(
  checkRuns: GitHubCheckRunResponse[],
  statuses: GitHubStatusResponse[],
  actionJobLogs: LogSnippet[],
  executionSuites: ExecutionSuiteObservation[] = []
): string[] {
  const limitations: string[] = [];
  const hasExecutionCheckRun = checkRuns.some(isExecutionCheckRun);
  const hasExecutionStatus = statuses.some((status) =>
    isExecutionEvidenceSignal(status.context, status.description ?? "", status.target_url)
  );
  const hasExecutionJobMetadata = actionJobLogs.some((log) => isExecutionEvidenceSignal(log.source, log.text, log.url));
  const hasExecutionEvidence = hasExecutionCheckRun || hasExecutionStatus || hasExecutionJobMetadata;
  const executionStatuses = [
    ...checkRuns
      .filter(isExecutionCheckRun)
      .map((check) => mapGitHubObservationStatus(mapGitHubCheckStatus(check.status, check.conclusion))),
    ...statuses
      .filter((status) => isExecutionEvidenceSignal(status.context, status.description ?? "", status.target_url))
      .map((status) => mapGitHubObservationStatus(mapGitHubCommitStatus(status.state))),
    ...actionJobLogs
      .filter((log) => isExecutionEvidenceSignal(log.source, log.text, log.url))
      .map((log) => log.status ?? "unknown")
  ];
  const hasAnyPublicCheckMetadata = checkRuns.length > 0 || statuses.length > 0;
  const hasReportedSuccessfulExecutionMetadata =
    checkRuns.some((check) => isExecutionCheckRun(check) && mapGitHubCheckStatus(check.status, check.conclusion) === "passed") ||
    statuses.some((status) =>
      isExecutionEvidenceSignal(status.context, status.description ?? "", status.target_url) &&
      mapGitHubCommitStatus(status.state) === "passed"
    ) ||
    actionJobLogs.some((log) => /\breported conclusion: success\b/i.test(log.text));
  const hasOnlyNonExecutionCommitStatuses = statuses.length > 0 && !hasExecutionStatus && !hasExecutionEvidence;

  if (hasExecutionEvidence) {
    const source = hasExecutionCheckRun || hasExecutionJobMetadata
      ? "Public GitHub Actions metadata"
      : "Public commit status metadata";
    if (executionStatuses.some((status) => status === "failed")) {
      limitations.push(`${source} showed failing build/test jobs; raw log archives were not fetched or stored.`);
    } else if (executionStatuses.some((status) => status === "pending")) {
      limitations.push(`${source} showed pending build/test jobs; raw log archives were not fetched or stored.`);
    }
  }

  if (executionSuites.length > 0) {
    limitations.push("Public GitHub Actions metadata linked a passing generic test suite to changed test artifacts; raw log archives were not fetched or stored.");
  } else if (hasReportedSuccessfulExecutionMetadata) {
    limitations.push(
      "Public GitHub metadata reported successful test/build checks, but no execution output or raw logs were collected; success remains an unverified observation."
    );
  }

  if (hasOnlyNonExecutionCommitStatuses) {
    limitations.push("Public commit status metadata was available, but only non-execution statuses were found.");
  }

  if (!hasExecutionEvidence) {
    limitations.push(
      hasAnyPublicCheckMetadata
        ? "No public test/build workflow run, check, or raw CI log was available from the collected metadata. No verified execution evidence was established."
        : "No public test/build workflow run, check, or raw CI log was available."
    );
  }

  limitations.push("Raw CI logs were not fetched or stored.");

  return limitations;
}

function normalizeGitHubEvidenceLimitations(limitations: string[]): string[] {
  const hasFailingExecutionLimitation = limitations.some((limitation) =>
    /showed failing build\/test jobs/i.test(limitation)
  );
  const hasPendingExecutionLimitation = limitations.some((limitation) =>
    /showed pending build\/test jobs/i.test(limitation)
  );

  return Array.from(new Set(limitations.filter((limitation) => {
    if (hasFailingExecutionLimitation && /showed (?:passing|pending) build\/test jobs/i.test(limitation)) {
      return false;
    }

    if (hasPendingExecutionLimitation && /showed passing build\/test jobs/i.test(limitation)) {
      return false;
    }

    return true;
  })));
}

async function measureGitHubEvidenceTiming<T>(
  evidenceTiming: GitHubEvidenceTimingSink | undefined,
  phase: GitHubEvidenceTimingPhase,
  operation: () => Promise<T>
): Promise<T> {
  const startedAt = nowMs();

  try {
    return await operation();
  } finally {
    try {
      evidenceTiming?.record(phase, Math.max(0, nowMs() - startedAt));
    } catch {
      // Timing is diagnostic only; it must never change GitHub evidence collection.
    }
  }
}

function nowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function githubFallbackLimitation(error: unknown): string {
  if (error instanceof GitHubFetchError) {
    return `Live GitHub evidence could not be collected: ${error.reason} Report uses pasted evidence only.`;
  }

  return "Live GitHub evidence could not be collected: GitHub metadata request failed before evidence could be collected. Report uses pasted evidence only.";
}

function classifyGitHubFailure(response: Response, hasToken: boolean): GitHubFailureClassification {
  const status = response.status;
  const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
  const rateLimitReset = response.headers.get("x-ratelimit-reset");
  const retryAfter = response.headers.get("retry-after");

  if ((status === 403 || status === 429) && rateLimitRemaining === "0") {
    const resetAt = formatGitHubRateLimitReset(rateLimitReset);
    return {
      code: "github_rate_limited",
      reason: `GitHub API rate limit was reached${resetAt ? ` until ${resetAt}` : ""}.`
    };
  }

  if ((status === 403 || status === 429) && retryAfter) {
    return {
      code: "github_secondary_rate_limited",
      reason: `GitHub API secondary rate limit or abuse protection was reached; retry after ${retryAfter} second(s).`
    };
  }

  if (status === 401) {
    return {
      code: hasToken ? "github_token_rejected" : "github_auth_required",
      reason: hasToken
        ? "the provided GitHub token was rejected."
        : "GitHub authentication is required for this PR."
    };
  }

  if (status === 403) {
    return {
      code: "github_permission_denied",
      reason: hasToken
        ? "the provided GitHub token may lack permission to read this repository or PR."
        : "GitHub denied access; the repository may be private or require a fine-grained token."
    };
  }

  if (status === 404) {
    return {
      code: "github_not_found",
      reason: hasToken
        ? "the repository or PR was not found or is not visible to the provided token."
        : "the repository or PR was not found or is not visible without authentication."
    };
  }

  return {
    code: "github_fetch_failed",
    reason: `GitHub returned HTTP ${status}.`
  };
}

function githubFailureReason(response: Response, hasToken: boolean): string {
  return classifyGitHubFailure(response, hasToken).reason;
}

function formatGitHubRateLimitReset(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const seconds = Number(value);
  if (!Number.isFinite(seconds)) {
    return null;
  }

  return new Date(seconds * 1000).toISOString();
}

function mergePastedOverrides(live: PullRequestInput, request: AnalyzeRequest): PullRequestInput {
  return {
    ...live,
    taskText: request.taskText ? redactSecrets(request.taskText) : live.taskText,
    taskSource: request.taskText ? "task" : live.taskSource,
    description: request.prDescription?.trim() ? redactSecrets(request.prDescription) : live.description,
    changedFiles: request.changedFiles?.trim() ? parseChangedFiles(request.changedFiles) : live.changedFiles,
    checks: request.checks?.trim() ? parseChecks(request.checks) : live.checks,
    logs: request.logs?.trim() ? parseLogs(request.logs) : live.logs,
    limitations: [
      ...(live.limitations ?? []),
      ...(request.inputLimitations ?? []),
      ...(request.changedFiles?.trim() ? ["Pasted changed files replaced live GitHub file evidence."] : []),
      ...(request.checks?.trim() ? ["Pasted checks replaced live GitHub check evidence."] : []),
      ...(request.logs?.trim() ? [] : [])
    ]
  };
}

function hasPastedEvidence(request: AnalyzeRequest): boolean {
  return Boolean(
    request.prDescription?.trim() ||
      request.changedFiles?.trim() ||
      request.checks?.trim() ||
      request.logs?.trim()
  );
}

async function resolveLinkedIssueTaskText(input: {
  prBody: string;
  repository: Pick<GitHubPullUrl, "owner" | "repo">;
  headers: Record<string, string>;
  limitations: string[];
  hasToken: boolean;
}): Promise<{
  taskText: string;
  identityHash: string;
  contractSource: { kind: "linked_issue"; title: string; body: string };
  contractBinding: { sourceKind: "linked_issue"; sourceIdentity: string; sourceContent: string; headSha: string; baseSha: string };
} | null> {
  const extraction = extractSupportedIssueReferences(input.prBody, input.repository);

  if (extraction.totalSupportedReferences === 0) {
    return null;
  }

  if (extraction.totalSupportedReferences > 1) {
    const refs = extraction.references.map(formatIssueReference).join(", ");
    input.limitations.push(
      `Multiple supported issue references found (${refs});${extraction.capped ? " capped at 3 and" : ""} did not choose a single issue as requirement source. Original request mapping is ambiguous.`
    );
    return null;
  }

  const [reference] = extraction.references;
  if (!reference) {
    return null;
  }

  const result = await fetchLinkedIssue(reference, input.headers, input.hasToken);

  if (result.status === "failed") {
    input.limitations.push(result.limitation);
    return null;
  }

  return {
    taskText: result.taskText,
    identityHash: requirementSourceIdentityHash(
      `github_issue:${reference.owner.toLowerCase()}/${reference.repo.toLowerCase()}#${reference.number}`
    ),
    contractSource: { kind: "linked_issue", title: result.title, body: result.body },
    contractBinding: {
      sourceKind: "linked_issue",
      sourceIdentity: `github:issue:${reference.owner.toLowerCase()}/${reference.repo.toLowerCase()}#${reference.number}`,
      sourceContent: `${result.title}\n${result.body}`,
      headSha: "",
      baseSha: ""
    }
  };
}

function requirementSourceIdentityHash(canonicalIdentity: string): string {
  return createHash("sha256").update(canonicalIdentity, "utf8").digest("hex");
}

async function fetchLinkedIssue(
  reference: SupportedIssueReference,
  headers: Record<string, string>,
  hasToken: boolean
): Promise<{ status: "ok"; taskText: string; title: string; body: string } | { status: "failed"; limitation: string }> {
  const ref = formatIssueReference(reference);
  let response: Response;

  try {
    response = await githubFetch(
      `https://api.github.com/repos/${reference.owner}/${reference.repo}/issues/${reference.number}`,
      headers
    );
  } catch {
    return {
      status: "failed",
      limitation: `Linked issue ${ref} could not be fetched: request timed out or network failed. Original requirement remains unavailable; the PR description is author context only.`
    };
  }

  if (!response.ok) {
    return {
      status: "failed",
      limitation: `Linked issue ${ref} could not be fetched: ${githubLinkedIssueFailureReason(response, hasToken)} Original requirement remains unavailable; the PR description is author context only.`
    };
  }

  const issue = (await response.json()) as GitHubIssueResponse;

  if (issue.pull_request) {
    return {
      status: "failed",
      limitation: `Linked reference ${ref} points to a pull request, not an issue. Original requirement remains unavailable; the PR description is author context only.`
    };
  }

  const title = compactText(redactSecrets(issue.title ?? ""), 300);
  const body = compactText(redactSecrets(issue.body ?? ""), 5000);
  const taskText = [`Linked issue ${ref}: ${title}`, body].filter((part) => part.trim()).join("\n\n");

  if (!taskText.trim()) {
    return {
      status: "failed",
      limitation: `Linked issue ${ref} had no title or body text. Original requirement remains unavailable; the PR description is author context only.`
    };
  }

  return { status: "ok", taskText, title, body };
}

function githubLinkedIssueFailureReason(response: Response, hasToken: boolean): string {
  return classifyGitHubFailure(response, hasToken).reason.replace(/\bPR\b/g, "issue");
}

function githubFetch(
  url: string,
  headers: Record<string, string>,
  timeoutMs = GITHUB_FETCH_TIMEOUT_MS
): Promise<Response> {
  return fetch(url, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs)
  });
}

async function fetchPullFiles(
  baseUrl: string,
  headers: Record<string, string>,
  limitations: string[],
  hasToken: boolean
): Promise<GitHubFileResponse[]> {
  const files: GitHubFileResponse[] = [];

  for (let page = 1; page <= GITHUB_MAX_PAGES; page += 1) {
    let response: Response;

    try {
      response = await githubFetch(`${baseUrl}?per_page=${GITHUB_PAGE_SIZE}&page=${page}`, headers);
    } catch {
      limitations.push("GitHub changed-file evidence unavailable: request timed out or network failed.");
      return files;
    }

    if (!response.ok) {
      limitations.push(`GitHub changed-file fetch failed: ${githubFailureReason(response, hasToken)} File evidence may be incomplete.`);
      return files;
    }

    const pageItems = (await response.json()) as GitHubFileResponse[];
    files.push(...pageItems);

    if (files.length >= GITHUB_MAX_CHANGED_FILES) {
      limitations.push(`GitHub changed-file evidence was capped at ${GITHUB_MAX_CHANGED_FILES} files.`);
      return files.slice(0, GITHUB_MAX_CHANGED_FILES);
    }

    if (pageItems.length < GITHUB_PAGE_SIZE) {
      return files;
    }
  }

  limitations.push(`GitHub changed-file evidence was capped at ${GITHUB_MAX_CHANGED_FILES} files.`);
  return files;
}

async function fetchCheckRuns(
  baseUrl: string,
  headers: Record<string, string>,
  limitations: string[],
  hasToken: boolean
): Promise<GitHubCheckRunResponse[]> {
  const checks: GitHubCheckRunResponse[] = [];
  let totalCount: number | undefined;

  for (let page = 1; page <= GITHUB_MAX_PAGES; page += 1) {
    let response: Response;

    try {
      response = await githubFetch(`${baseUrl}?per_page=${GITHUB_PAGE_SIZE}&page=${page}`, headers, GITHUB_CHECK_RUNS_TIMEOUT_MS);
    } catch {
      limitations.push(`GitHub check-run evidence unavailable: request timed out after ${GITHUB_CHECK_RUNS_TIMEOUT_MS} ms or network failed.`);
      return prioritizeCheckRunsForEvidence(checks);
    }

    if (!response.ok) {
      limitations.push(`GitHub check-run fetch failed: ${githubFailureReason(response, hasToken)} CI evidence may be incomplete.`);
      return prioritizeCheckRunsForEvidence(checks);
    }

    const pageJson = await response.json();
    totalCount = typeof pageJson.total_count === "number" ? pageJson.total_count : totalCount;
    const pageItems = (pageJson.check_runs ?? []) as GitHubCheckRunResponse[];
    checks.push(...pageItems);

    if (pageItems.length < GITHUB_PAGE_SIZE || (totalCount !== undefined && checks.length >= totalCount)) {
      break;
    }
  }

  if (checks.length > GITHUB_MAX_CHECK_RUNS || totalCount === undefined || totalCount > GITHUB_MAX_CHECK_RUNS) {
    limitations.push(`GitHub check-run evidence was capped at ${GITHUB_MAX_CHECK_RUNS} checks.`);
  }

  return prioritizeCheckRunsForEvidence(checks);
}

function prioritizeCheckRunsForEvidence(checkRuns: GitHubCheckRunResponse[]): GitHubCheckRunResponse[] {
  return checkRuns
    .map((check, index) => ({ check, index, rank: checkRunEvidenceRank(check) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .slice(0, GITHUB_MAX_CHECK_RUNS)
    .map(({ check }) => check);
}

function checkRunEvidenceRank(check: GitHubCheckRunResponse): number {
  const status = mapGitHubCheckStatus(check.status, check.conclusion);
  const execution = isExecutionCheckRun(check);

  if (execution && status === "failed") return 0;
  if (execution && status === "pending") return 1;
  if (execution && status === "passed") return 2;
  if (status === "failed") return 3;
  if (status === "pending") return 4;
  return 5;
}

async function fetchCommitStatuses(
  url: string,
  headers: Record<string, string>,
  limitations: string[],
  hasToken: boolean
): Promise<GitHubStatusResponse[]> {
  let response: Response;

  try {
    response = await githubFetch(url, headers, GITHUB_COMMIT_STATUS_TIMEOUT_MS);
  } catch {
    limitations.push(`GitHub commit-status evidence unavailable: request timed out after ${GITHUB_COMMIT_STATUS_TIMEOUT_MS} ms or network failed.`);
    return [];
  }

  if (!response.ok) {
    limitations.push(`GitHub commit-status fetch failed: ${githubFailureReason(response, hasToken)} Legacy status evidence may be incomplete.`);
    return [];
  }

  const json = await response.json();
  const statuses = (json.statuses ?? []) as GitHubStatusResponse[];

  if (statuses.length > GITHUB_MAX_COMMIT_STATUSES) {
    limitations.push(`GitHub commit-status evidence was capped at ${GITHUB_MAX_COMMIT_STATUSES} statuses.`);
  }

  return statuses.slice(0, GITHUB_MAX_COMMIT_STATUSES);
}

async function fetchCheckRunAnnotations(
  owner: string,
  repo: string,
  checkRuns: GitHubCheckRunResponse[],
  headers: Record<string, string>,
  limitations: string[],
  hasToken: boolean
): Promise<GitHubCheckRunResponse[]> {
  const eligibleChecks = checkRuns
    .filter((check) => shouldFetchCheckAnnotations(check))
    .slice(0, GITHUB_MAX_ANNOTATED_CHECK_RUNS);

  if (eligibleChecks.length === 0) {
    return checkRuns;
  }

  if (checkRuns.filter(shouldFetchCheckAnnotations).length > GITHUB_MAX_ANNOTATED_CHECK_RUNS) {
    limitations.push(`GitHub check annotation metadata was capped at ${GITHUB_MAX_ANNOTATED_CHECK_RUNS} failed execution checks.`);
  }

  const annotationsByCheckId = new Map<number, GitHubCheckAnnotationSummary[]>();

  const annotationResults = await Promise.all(
    eligibleChecks.map((check) => fetchCheckAnnotationsForRun(owner, repo, check, headers, hasToken))
  );
  let annotationCount = 0;

  for (const result of annotationResults) {
    if (result.limitation) {
      limitations.push(result.limitation);
    }

    if (annotationCount >= GITHUB_MAX_CHECK_ANNOTATIONS_TOTAL || result.annotations.length === 0) {
      continue;
    }

    const remaining = GITHUB_MAX_CHECK_ANNOTATIONS_TOTAL - annotationCount;
    const annotations = result.annotations.slice(0, remaining);

    if (annotations.length > 0) {
      annotationsByCheckId.set(result.checkId, annotations);
      annotationCount += annotations.length;
    }
  }

  if (annotationsByCheckId.size > 0) {
    limitations.push("GitHub check annotation metadata was collected; raw annotation details and raw log archives were not fetched or stored.");
  }

  return checkRuns.map((check) =>
    typeof check.id === "number" && annotationsByCheckId.has(check.id)
      ? { ...check, annotations: annotationsByCheckId.get(check.id) }
      : check
  );
}

async function fetchCheckAnnotationsForRun(
  owner: string,
  repo: string,
  check: GitHubCheckRunResponse,
  headers: Record<string, string>,
  hasToken: boolean
): Promise<GitHubCheckAnnotationFetchResult> {
  const checkId = typeof check.id === "number" ? check.id : -1;

  try {
    const response = await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}/check-runs/${checkId}/annotations?per_page=${GITHUB_MAX_CHECK_ANNOTATIONS_PER_RUN}`,
      headers,
      GITHUB_CHECK_ANNOTATION_TIMEOUT_MS
    );

    if (!response.ok) {
      return {
        checkId,
        annotations: [],
        limitation: `GitHub check annotation metadata fetch failed: ${githubFailureReason(response, hasToken)} File-level check evidence may be incomplete.`
      };
    }

    const annotations = ((await response.json()) as GitHubCheckAnnotationResponse[])
      .map(summarizeCheckAnnotation)
      .filter((annotation): annotation is GitHubCheckAnnotationSummary => Boolean(annotation))
      .slice(0, GITHUB_MAX_CHECK_ANNOTATIONS_PER_RUN);

    return { checkId, annotations };
  } catch {
    return {
      checkId,
      annotations: [],
      limitation: `GitHub check annotation metadata unavailable: request timed out after ${GITHUB_CHECK_ANNOTATION_TIMEOUT_MS} ms or network failed.`
    };
  }
}

function shouldFetchCheckAnnotations(check: GitHubCheckRunResponse): boolean {
  return typeof check.id === "number" &&
    mapGitHubCheckStatus(check.status, check.conclusion) === "failed" &&
    isExecutionCheckRun(check);
}

function summarizeCheckAnnotation(annotation: GitHubCheckAnnotationResponse): GitHubCheckAnnotationSummary | null {
  const path = normalizeAnnotationPath(annotation.path);
  if (!path) {
    return null;
  }

  const level = normalizeAnnotationLevel(annotation.annotation_level);
  const line = typeof annotation.start_line === "number" && Number.isFinite(annotation.start_line) && annotation.start_line > 0
    ? Math.floor(annotation.start_line)
    : undefined;

  return {
    path,
    line,
    level
  };
}

function normalizeAnnotationPath(value: string | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.length > 240 ||
    trimmed.startsWith("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("?") ||
    trimmed.includes("#") ||
    /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
  ) {
    return null;
  }

  const parts = trimmed.split("/");
  if (parts.some((part) => part === "." || part === ".." || part.trim() === "")) {
    return null;
  }

  return redactSecrets(compactText(trimmed, 240));
}

function normalizeAnnotationLevel(value: string | undefined): string {
  const normalized = (value ?? "").toLowerCase();

  return normalized === "notice" || normalized === "warning" || normalized === "failure"
    ? normalized
    : "annotation";
}

function checkSummaryWithAnnotations(check: GitHubCheckRunResponse): string | undefined {
  const baseSummary = check.output?.summary || check.output?.title;
  const safeBaseSummary = baseSummary ? compactText(baseSummary, 700) : undefined;
  const annotations = check.annotations ?? [];

  if (annotations.length === 0) {
    return safeBaseSummary;
  }

  const annotationText = annotations
    .map((annotation) => {
      const locator = annotation.line ? `${annotation.path}:${annotation.line}` : annotation.path;
      return `${annotation.level} at ${locator}`;
    })
    .join(", ");

  return compactText(
    `${safeBaseSummary ?? "Check annotations available."} Check annotations: ${annotationText}. Raw annotation messages and raw annotation details omitted.`,
    900
  );
}

async function fetchActionJobSummaries(
  owner: string,
  repo: string,
  checkRuns: GitHubCheckRunResponse[],
  headers: Record<string, string>,
  limitations: string[],
  hasToken: boolean,
  headSha: string,
  changedFiles: GitHubFileResponse[]
): Promise<{ logs: LogSnippet[]; executionSuites: ExecutionSuiteObservation[] }> {
  const runIds = Array.from(new Set(checkRuns
    .filter((check) => shouldFetchActionJobMetadata(check, owner, repo))
    .map((check) => actionRunIdFromCheckRun(check, owner, repo))
    .filter((id): id is string => Boolean(id))))
    .slice(0, GITHUB_MAX_ACTION_RUNS);

  if (runIds.length === 0) {
    return { logs: [], executionSuites: [] };
  }

  const jobResults = await Promise.all(
    runIds.map((runId) => fetchActionJobsForRun(owner, repo, runId, headers, hasToken, headSha, changedFiles))
  );
  const logs: LogSnippet[] = [];
  const executionSuites: ExecutionSuiteObservation[] = [];

  for (const result of jobResults) {
    if (result.limitation) {
      limitations.push(result.limitation);
    }

    if (logs.length >= GITHUB_MAX_ACTION_JOB_SUMMARIES) {
      continue;
    }

    logs.push(...result.logs.slice(0, GITHUB_MAX_ACTION_JOB_SUMMARIES - logs.length));
    executionSuites.push(...result.executionSuites.slice(0, GITHUB_MAX_ACTION_JOB_SUMMARIES - executionSuites.length));
  }

  if (logs.length > 0) {
    limitations.push(githubActionsMetadataLimitation(logs, executionSuites));
  }

  return { logs, executionSuites };
}

async function fetchActionJobsForRun(
  owner: string,
  repo: string,
  runId: string,
  headers: Record<string, string>,
  hasToken: boolean,
  headSha: string,
  changedFiles: GitHubFileResponse[]
): Promise<GitHubActionJobFetchResult> {
  try {
    const response = await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=${GITHUB_PAGE_SIZE}`,
      headers,
      GITHUB_ACTION_JOB_TIMEOUT_MS
    );

    if (!response.ok) {
      return {
        logs: [],
        executionSuites: [],
        limitation: `GitHub Actions job-step metadata fetch failed: ${githubFailureReason(response, hasToken)} Test/build evidence may be incomplete.`
      };
    }

    const json = await response.json();
    const jobs = ((json.jobs ?? []) as GitHubActionJobResponse[])
      .filter(isExecutionActionJob)
      .slice(0, GITHUB_MAX_ACTION_JOB_SUMMARIES);
    const packageTestRunner = jobs.some((job) => actionExecutionSteps(job).some((step) => /^run\s+npm\s+test$/i.test(step.name.trim())))
      ? await fetchRootNpmTestRunner(owner, repo, headSha, headers)
      : null;
    const logs = jobs.map((job) => {
        const safeJobName = redactSecrets(compactText(job.name, 160));
        const steps = actionExecutionSteps(job)
          .filter((step) => step.name)
          .slice(0, GITHUB_MAX_ACTION_STEPS_PER_JOB)
          .map((step) => `${redactSecrets(compactText(step.name, 160))}: ${mapGitHubObservationStatus(mapGitHubCheckStatus(step.status, step.conclusion))}`)
          .join("; ");
        const rawStatus = mapGitHubCheckStatus(job.status, job.conclusion);
        const status = mapGitHubObservationStatus(rawStatus);
        const reportedConclusion = rawStatus === "passed" ? " Reported conclusion: success; execution output not collected." : "";

        return {
          source: `GitHub Actions job: ${safeJobName}`,
          status,
          url: sanitizeGitHubEvidenceUrl(job.html_url),
          text: redactSecrets(compactText(`GitHub Actions job ${safeJobName}: ${status}.${reportedConclusion}${steps ? ` Steps: ${steps}` : ""}`, 900))
        };
      });

    const executionSuites = jobs.flatMap((job) => genericSuiteObservationForJob(job, headSha, changedFiles, packageTestRunner));

    return { logs, executionSuites };
  } catch {
    return {
      logs: [],
      executionSuites: [],
      limitation: `GitHub Actions job-step metadata unavailable: request timed out after ${GITHUB_ACTION_JOB_TIMEOUT_MS} ms or network failed.`
    };
  }
}

function genericSuiteObservationForJob(
  job: GitHubActionJobResponse,
  headSha: string,
  changedFiles: GitHubFileResponse[],
  packageTestRunner: ExecutionSuiteObservation["runner"] | null
): ExecutionSuiteObservation[] {
  if (mapGitHubObservationStatus(mapGitHubCheckStatus(job.status, job.conclusion)) !== "passed") return [];
  const runner = normalizedUnfilteredRunner(actionExecutionSteps(job), packageTestRunner);
  if (!runner) return [];

  const testPaths = changedFiles
    .map((file) => file.filename)
    .filter((path) => testPathCoveredByRunner(path, runner))
    .slice(0, 60);
  if (testPaths.length === 0) return [];

  return [{
    headSha,
    status: "passed",
    executionSource: `GitHub Actions job: ${redactSecrets(compactText(job.name, 160))}`,
    runner,
    scope: "repository_discovery",
    testPaths
  }];
}

function normalizedUnfilteredRunner(
  steps: GitHubActionStepResponse[],
  packageTestRunner: ExecutionSuiteObservation["runner"] | null
): ExecutionSuiteObservation["runner"] | null {
  for (const step of steps) {
    const command = step.name.trim().replace(/^run\s+/i, "");
    if (/^node\s+--test$/i.test(command)) return "node_test";
    if (/^npm\s+test$/i.test(command)) return packageTestRunner;
    if (/^pytest$/i.test(command)) return "pytest";
    if (/^go\s+test\s+\.\/\.\.$/i.test(command)) return "go_test";
    if (/^cargo\s+test$/i.test(command)) return "cargo_test";
  }
  return null;
}

async function fetchRootNpmTestRunner(
  owner: string,
  repo: string,
  headSha: string,
  headers: Record<string, string>
): Promise<ExecutionSuiteObservation["runner"] | null> {
  try {
    const response = await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/package.json?ref=${encodeURIComponent(headSha)}`,
      headers,
      GITHUB_ACTION_JOB_TIMEOUT_MS
    );
    if (!response.ok) return null;
    const payload = await response.json();
    if (payload?.encoding !== "base64" || typeof payload.content !== "string") return null;
    const parsed = JSON.parse(Buffer.from(payload.content, "base64").toString("utf8"));
    const script = typeof parsed?.scripts?.test === "string" ? parsed.scripts.test.trim() : "";
    if (/^node\s+--test$/i.test(script)) return "node_test";
    if (/^pytest$/i.test(script)) return "pytest";
    if (/^go\s+test\s+\.\/\.\.$/i.test(script)) return "go_test";
    if (/^cargo\s+test$/i.test(script)) return "cargo_test";
    return null;
  } catch {
    return null;
  }
}

function testPathCoveredByRunner(path: string, runner: ExecutionSuiteObservation["runner"]): boolean {
  if (runner === "node_test") return /(?:^|\/)(?:test|tests)\/.*\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(path) || /(?:^|\/)test-[^/]+\.[cm]?[jt]sx?$/i.test(path);
  if (runner === "pytest") return /(?:^|\/)(?:test_[^/]+|[^/]+_test)\.py$/i.test(path);
  if (runner === "go_test") return /_test\.go$/i.test(path);
  return /(?:^|\/)tests?\/.*\.rs$/i.test(path);
}

function isExecutionCheckRun(check: GitHubCheckRunResponse): boolean {
  const status = mapGitHubCheckStatus(check.status, check.conclusion);
  const text = `${check.output?.title ?? ""} ${check.output?.summary ?? ""}`;
  const locator = check.details_url ?? check.html_url;

  return isExecutionEvidenceSignal(check.name, text, locator) ||
    isFailedAmbiguousActionsExecutionSignal(check.name, status, locator, text);
}

function shouldFetchActionJobMetadata(check: GitHubCheckRunResponse, owner: string, repo: string): boolean {
  if (!actionRunIdFromCheckRun(check, owner, repo)) {
    return false;
  }

  if (isExecutionCheckRun(check)) {
    return true;
  }

  return GENERIC_ACTION_JOB_NAME_PATTERN.test(check.name);
}

function githubActionsMetadataLimitation(logs: LogSnippet[], executionSuites: ExecutionSuiteObservation[] = []): string {
  const statuses = logs.map((log) => log.status ?? "unknown");

  if (statuses.some((status) => status === "failed")) {
    return "Public GitHub Actions metadata showed failing build/test jobs; raw log archives were not fetched or stored.";
  }

  if (statuses.some((status) => status === "pending")) {
    return "Public GitHub Actions metadata showed pending build/test jobs; raw log archives were not fetched or stored.";
  }

  if (executionSuites.length > 0) {
    return "Public GitHub Actions metadata linked a passing generic test suite to changed test artifacts; raw log archives were not fetched or stored.";
  }

  if (logs.some((log) => /\breported conclusion: success\b/i.test(log.text))) {
    return "Public GitHub Actions metadata reported successful build/test jobs, but success remains unverified because execution output and raw log archives were not fetched or stored.";
  }

  return "Public GitHub Actions metadata was collected for build/test jobs; raw log archives were not fetched or stored.";
}

function isExecutionActionJob(job: GitHubActionJobResponse): boolean {
  const executionSteps = actionExecutionSteps(job);
  const stepText = executionSteps.map((step) => step.name).join(" ");

  if (executionSteps.length > 0) {
    return true;
  }

  if (GENERIC_ACTION_JOB_NAME_PATTERN.test(job.name)) {
    return false;
  }

  return isExecutionEvidenceSignal(job.name, stepText, job.html_url);
}

function actionExecutionSteps(job: GitHubActionJobResponse): GitHubActionStepResponse[] {
  return (job.steps ?? []).filter(isExecutionActionStep);
}

function isExecutionActionStep(step: GitHubActionStepResponse): boolean {
  if (!step.name.trim() || NON_PROOF_ACTION_STEP_PATTERN.test(step.name)) {
    return false;
  }

  return isExecutionEvidenceSignal(step.name);
}

function actionRunIdFromCheckRun(check: GitHubCheckRunResponse, owner: string, repo: string): string | null {
  const value = check.details_url || check.html_url;
  if (!value) return null;

  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);

    if (
      url.hostname.toLowerCase() !== "github.com" ||
      parts[0]?.toLowerCase() !== owner.toLowerCase() ||
      parts[1]?.toLowerCase() !== repo.toLowerCase()
    ) {
      return null;
    }

    const match = url.pathname.match(/\/actions\/runs\/(\d+)(?:\/|$)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function sanitizeGitHubEvidenceUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(redactSecrets(value));
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return redactSecrets(value);
  }
}

function parseChangedFiles(input: string): ChangedFile[] {
  return input
    .split(/\n|,/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 120)
    .map((path) => ({ path, status: "modified" }));
}

function parseChecks(input: string): CheckRun[] {
  return input
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((line) => {
      const status = parsePastedEvidenceStatus(line);

      return { name: line.split(":")[0] || "check", status, summary: line };
    });
}

function parseLogs(input: string): LogSnippet[] {
  if (!input.trim()) {
    return [];
  }

  const status = parsePastedEvidenceStatus(input);

  return [{ source: "pasted logs", status, text: compactText(input, 1600) }];
}

const PASTED_STATUS_AMBIGUITY_PATTERN =
  /\b(previous|previously|prior|last|old|historical|history|baseline|base branch|main branch|other branch|not current|current status is unknown|status is unknown|unknown|incomplete|not provided|unavailable|not available|not run|not executed)\b/i;
const PASTED_EXPLICIT_PENDING_PATTERN = /\b(status|conclusion|result)\s*[:=]\s*(pending|queued|in[_ -]?progress)\b/i;
const PASTED_EXPLICIT_FAILURE_PATTERN = /\b(status|conclusion|result)\s*[:=]\s*(failed|failure|error|errored)\b/i;
const PASTED_EXPLICIT_PASS_PATTERN = /\b(status|conclusion|result)\s*[:=]\s*(passed|pass|success|succeeded)\b/i;
const PASTED_FAILURE_PATTERN = /\b(failed|failure|failing|error|errored|failures?)\b/i;
const PASTED_NO_FAILURE_PATTERN = /\b(no|without|zero|0)\s+(failures?|errors?)\b/i;
const PASTED_PASS_PATTERN =
  /(?:^|\b)(?:tests?|checks?|specs?|build|ci|typecheck|lint)\b.{0,80}\b(passed|pass|success|succeeded)\b/i;
const PASTED_PREFIX_PASS_PATTERN = /^(?:[^:\n]{1,120}:\s*)?(passed|pass|success|succeeded)\b/i;

function parsePastedEvidenceStatus(text: string): CheckRun["status"] {
  if (!text.trim()) return "unknown";
  if (PASTED_STATUS_AMBIGUITY_PATTERN.test(text)) return "unknown";
  if (PASTED_EXPLICIT_PENDING_PATTERN.test(text)) return "pending";
  if (PASTED_EXPLICIT_FAILURE_PATTERN.test(text)) return "failed";
  if (PASTED_EXPLICIT_PASS_PATTERN.test(text)) return "passed";
  if (PASTED_FAILURE_PATTERN.test(text) && !PASTED_NO_FAILURE_PATTERN.test(text)) return "failed";
  if (PASTED_NO_FAILURE_PATTERN.test(text)) return "passed";
  if (PASTED_PREFIX_PASS_PATTERN.test(text) || PASTED_PASS_PATTERN.test(text)) return "passed";

  return "unknown";
}

function mapGitHubCheckStatus(status: string, conclusion: string | null): CheckRun["status"] {
  if (status !== "completed") {
    return status === "queued" || status === "in_progress" ? "pending" : "unknown";
  }

  if (conclusion === "success") {
    return "passed";
  }

  if (conclusion === "failure" || conclusion === "timed_out") {
    return "failed";
  }

  return "unknown";
}

function mapGitHubCommitStatus(state: string): CheckRun["status"] {
  if (state === "success") return "passed";
  if (state === "failure" || state === "error") return "failed";
  if (state === "pending") return "pending";
  return "unknown";
}

function mapGitHubObservationStatus(status: CheckRun["status"]): CheckRun["status"] {
  return status;
}
