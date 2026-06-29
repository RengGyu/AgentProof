import type { AnalyzeRequest, ChangedFile, CheckRun, LogSnippet, PullRequestInput } from "./types";
import { isExecutionEvidenceSignal } from "./evidence-status";
import { compactText, redactSecrets } from "./redact";

const GITHUB_FETCH_TIMEOUT_MS = 8000;
const GITHUB_PAGE_SIZE = 100;
const GITHUB_MAX_PAGES = 3;
const GITHUB_MAX_CHANGED_FILES = 120;
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
  /\b(checkout|setup|cache|install dependencies|upload|download|artifact|publish|preview|deploy|deployment|report|notify)\b/i;
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

interface GitHubPullUrl {
  owner: string;
  repo: string;
  number: number;
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
  evidenceTiming?: GitHubEvidenceTimingSink
): Promise<PullRequestInput | null> {
  return fetchGitHubPullRequest(prUrl, token, taskText, evidenceTiming);
}

function buildPastedPullRequestInput(request: AnalyzeRequest, extraLimitations: string[] = []): PullRequestInput {
  const safePrUrl = request.prUrl ? normalizeGitHubPullUrl(request.prUrl) ?? redactSecrets(request.prUrl) : undefined;

  return {
    url: safePrUrl,
    title: safePrUrl ? `PR analysis for ${safePrUrl}` : "Pasted PR evidence",
    description: redactSecrets(request.prDescription ?? ""),
    taskText: redactSecrets(request.taskText ?? ""),
    changedFiles: parseChangedFiles(request.changedFiles ?? ""),
    checks: parseChecks(request.checks ?? ""),
    logs: parseLogs(request.logs ?? ""),
    limitations: [...(request.inputLimitations ?? []), ...extraLimitations]
  };
}

async function fetchGitHubPullRequest(
  prUrl: string,
  token: string | undefined,
  taskText: string,
  evidenceTiming?: GitHubEvidenceTimingSink
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
  const limitations: string[] = [];
  const [files, checkRuns, statuses] = await Promise.all([
    measureGitHubEvidenceTiming(
      evidenceTiming,
      "github_files",
      () => fetchPullFiles(pr.url + "/files", headers, limitations, hasToken)
    ),
    measureGitHubEvidenceTiming(
      evidenceTiming,
      "github_checks",
      () => fetchCheckRuns(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${pr.head.sha}/check-runs`, headers, limitations, hasToken)
    ),
    measureGitHubEvidenceTiming(
      evidenceTiming,
      "github_statuses",
      () => fetchCommitStatuses(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${pr.head.sha}/status`, headers, limitations, hasToken)
    )
  ]);
  const annotationLimitations: string[] = [];
  const actionJobLimitations: string[] = [];
  const [annotatedCheckRuns, actionJobLogs] = await Promise.all([
    measureGitHubEvidenceTiming(
      evidenceTiming,
      "github_annotations",
      () => fetchCheckRunAnnotations(parsed.owner, parsed.repo, checkRuns, headers, annotationLimitations, hasToken)
    ),
    measureGitHubEvidenceTiming(
      evidenceTiming,
      "github_jobs",
      () => fetchActionJobSummaries(parsed.owner, parsed.repo, checkRuns, headers, actionJobLimitations, hasToken)
    )
  ]);

  limitations.push(...annotationLimitations, ...actionJobLimitations);
  const missingPatchCount = files.filter((file) => !file.patch).length;

  if (missingPatchCount > 0) {
    limitations.push(
      `GitHub did not return patch text for ${missingPatchCount} changed file(s); file metadata was collected, but diff evidence is unavailable for those files.`
    );
  }

  return {
    url: safePrUrl,
    title: pr.title ?? `PR #${parsed.number}`,
    description: redactSecrets(pr.body ?? ""),
    author: pr.user?.login,
    baseBranch: pr.base?.ref,
    headBranch: pr.head?.ref,
    taskText: redactSecrets(taskText),
    changedFiles: files.map((file) => ({
      path: file.filename,
      additions: file.additions,
      deletions: file.deletions,
      status: file.status,
      patch: file.patch ? compactText(file.patch, 1000) : undefined
    })),
    checks: annotatedCheckRuns.map((check) => ({
      name: check.name,
      status: mapGitHubCheckStatus(check.status, check.conclusion),
      summary: checkSummaryWithAnnotations(check),
      url: sanitizeGitHubEvidenceUrl(check.html_url)
    })).concat(statuses.map((status) => ({
      name: status.context,
      status: mapGitHubCommitStatus(status.state),
      summary: status.description,
      url: sanitizeGitHubEvidenceUrl(status.target_url)
    }))),
    logs: actionJobLogs,
    limitations
  };
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

function githubFetch(url: string, headers: Record<string, string>): Promise<Response> {
  return fetch(url, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS)
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
      response = await githubFetch(`${baseUrl}?per_page=${GITHUB_PAGE_SIZE}&page=${page}`, headers);
    } catch {
      limitations.push("GitHub check-run evidence unavailable: request timed out or network failed.");
      return checks;
    }

    if (!response.ok) {
      limitations.push(`GitHub check-run fetch failed: ${githubFailureReason(response, hasToken)} CI evidence may be incomplete.`);
      return checks;
    }

    const pageJson = await response.json();
    totalCount = typeof pageJson.total_count === "number" ? pageJson.total_count : totalCount;
    const pageItems = (pageJson.check_runs ?? []) as GitHubCheckRunResponse[];
    checks.push(...pageItems);

    if (checks.length >= GITHUB_MAX_CHECK_RUNS) {
      limitations.push(`GitHub check-run evidence was capped at ${GITHUB_MAX_CHECK_RUNS} checks.`);
      return checks.slice(0, GITHUB_MAX_CHECK_RUNS);
    }

    if (pageItems.length < GITHUB_PAGE_SIZE || (totalCount !== undefined && checks.length >= totalCount)) {
      return checks;
    }
  }

  if (totalCount === undefined || checks.length < totalCount) {
    limitations.push(`GitHub check-run evidence was capped at ${GITHUB_MAX_CHECK_RUNS} checks.`);
  }

  return checks.slice(0, GITHUB_MAX_CHECK_RUNS);
}

async function fetchCommitStatuses(
  url: string,
  headers: Record<string, string>,
  limitations: string[],
  hasToken: boolean
): Promise<GitHubStatusResponse[]> {
  let response: Response;

  try {
    response = await githubFetch(url, headers);
  } catch {
    limitations.push("GitHub commit-status evidence unavailable: request timed out or network failed.");
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
      headers
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
      limitation: "GitHub check annotation metadata unavailable: request timed out or network failed."
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
  const annotations = check.annotations ?? [];

  if (annotations.length === 0) {
    return baseSummary;
  }

  const annotationText = annotations
    .map((annotation) => {
      const locator = annotation.line ? `${annotation.path}:${annotation.line}` : annotation.path;
      return `${annotation.level} at ${locator}`;
    })
    .join(", ");

  return compactText(
    `${baseSummary ?? "Check annotations available."} Check annotations: ${annotationText}. Raw annotation messages and raw annotation details omitted.`,
    900
  );
}

async function fetchActionJobSummaries(
  owner: string,
  repo: string,
  checkRuns: GitHubCheckRunResponse[],
  headers: Record<string, string>,
  limitations: string[],
  hasToken: boolean
): Promise<LogSnippet[]> {
  const runIds = Array.from(new Set(checkRuns
    .filter((check) => isExecutionCheckRun(check))
    .map((check) => actionRunIdFromCheckRun(check, owner, repo))
    .filter((id): id is string => Boolean(id))))
    .slice(0, GITHUB_MAX_ACTION_RUNS);

  if (runIds.length === 0) {
    return [];
  }

  const jobResults = await Promise.all(
    runIds.map((runId) => fetchActionJobsForRun(owner, repo, runId, headers, hasToken))
  );
  const logs: LogSnippet[] = [];

  for (const result of jobResults) {
    if (result.limitation) {
      limitations.push(result.limitation);
    }

    if (logs.length >= GITHUB_MAX_ACTION_JOB_SUMMARIES) {
      continue;
    }

    logs.push(...result.logs.slice(0, GITHUB_MAX_ACTION_JOB_SUMMARIES - logs.length));
  }

  if (logs.length > 0) {
    limitations.push("GitHub Actions job-step metadata was collected; raw log archives were not fetched or stored.");
  }

  return logs;
}

async function fetchActionJobsForRun(
  owner: string,
  repo: string,
  runId: string,
  headers: Record<string, string>,
  hasToken: boolean
): Promise<GitHubActionJobFetchResult> {
  try {
    const response = await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=${GITHUB_PAGE_SIZE}`,
      headers
    );

    if (!response.ok) {
      return {
        logs: [],
        limitation: `GitHub Actions job-step metadata fetch failed: ${githubFailureReason(response, hasToken)} Test/build evidence may be incomplete.`
      };
    }

    const json = await response.json();
    const logs = ((json.jobs ?? []) as GitHubActionJobResponse[])
      .filter(isExecutionActionJob)
      .slice(0, GITHUB_MAX_ACTION_JOB_SUMMARIES)
      .map((job) => {
        const status = mapGitHubCheckStatus(job.status, job.conclusion);
        const safeJobName = redactSecrets(compactText(job.name, 160));
        const steps = actionExecutionSteps(job)
          .filter((step) => step.name)
          .slice(0, GITHUB_MAX_ACTION_STEPS_PER_JOB)
          .map((step) => `${redactSecrets(compactText(step.name, 160))}: ${mapGitHubCheckStatus(step.status, step.conclusion)}`)
          .join("; ");

        return {
          source: `GitHub Actions job: ${safeJobName}`,
          status,
          url: sanitizeGitHubEvidenceUrl(job.html_url),
          text: redactSecrets(compactText(`GitHub Actions job ${safeJobName}: ${status}${steps ? `. Steps: ${steps}` : ""}`, 900))
        };
      });

    return { logs };
  } catch {
    return {
      logs: [],
      limitation: "GitHub Actions job-step metadata unavailable: request timed out or network failed."
    };
  }
}

function isExecutionCheckRun(check: GitHubCheckRunResponse): boolean {
  return isExecutionEvidenceSignal(check.name, `${check.output?.title ?? ""} ${check.output?.summary ?? ""}`, check.details_url ?? check.html_url);
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

  if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "cancelled" || conclusion === "action_required") {
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
