export interface GitHubWorkflowObservationV2 {
  workflowPath: string;
  workflowName: string;
  workflowId: number;
  runId: number;
  runAttempt: number;
  jobId: number;
  jobName: string;
  headSha: string;
  checkEvidenceRef: string;
  completeness: "complete" | "incomplete";
}

export interface GitHubWorkflowObservationInputV2 {
  repository: { owner: string; repo: string };
  requestedRunId: number;
  requestedRunAttempt: number;
  initialHeadSha: string;
  finalHeadSha: string;
  collectionsComplete: boolean;
  checkEvidenceRef: string;
  /** Authoritative bounded Check evidence references assigned by the collector. */
  availableCheckEvidenceRefs: readonly string[];
  runAttempt: unknown;
  job: unknown;
  checkRun: unknown;
}

type JsonRecord = Record<string, unknown>;

export function normalizeGitHubWorkflowObservationV2(
  input: GitHubWorkflowObservationInputV2
): GitHubWorkflowObservationV2 {
  const run = record(input.runAttempt);
  const job = record(input.job);
  const check = record(input.checkRun);
  const checkSuite = record(check.check_suite);
  const workflowPath = normalizeWorkflowPath(text(run.path));
  const workflowName = text(run.name).trim();
  const workflowId = positiveInteger(run.workflow_id);
  const runId = positiveInteger(run.id);
  const runAttempt = positiveInteger(run.run_attempt);
  const jobId = positiveInteger(job.id);
  const jobName = text(job.name).trim();
  const jobWorkflowName = text(job.workflow_name).trim();
  const headSha = text(run.head_sha).trim().toLowerCase();
  const checkId = positiveInteger(check.id);
  const checkEvidenceRef = input.checkEvidenceRef.trim();
  const availableCheckEvidenceRefs = new Set(input.availableCheckEvidenceRefs);
  const evidenceRefsAreBounded = input.availableCheckEvidenceRefs.length > 0 &&
    input.availableCheckEvidenceRefs.length <= 60 &&
    availableCheckEvidenceRefs.size === input.availableCheckEvidenceRefs.length &&
    input.availableCheckEvidenceRefs.every(isBoundedEvidenceRef);
  const joinedCheckId = checkRunIdFromRepositoryUrl(
    text(job.check_run_url),
    input.repository.owner,
    input.repository.repo
  );
  const complete = input.collectionsComplete &&
    workflowPath.length > 0 &&
    workflowName.length > 0 &&
    workflowId > 0 &&
    input.requestedRunId > 0 &&
    runId === input.requestedRunId &&
    positiveInteger(job.run_id) === runId &&
    input.requestedRunAttempt > 0 &&
    runAttempt === input.requestedRunAttempt &&
    positiveInteger(job.run_attempt) === runAttempt &&
    jobId > 0 &&
    jobName.length > 0 &&
    jobWorkflowName === workflowName &&
    fullSha(headSha) &&
    text(job.head_sha).trim().toLowerCase() === headSha &&
    text(check.head_sha).trim().toLowerCase() === headSha &&
    input.initialHeadSha.trim().toLowerCase() === headSha &&
    input.finalHeadSha.trim().toLowerCase() === headSha &&
    joinedCheckId > 0 &&
    joinedCheckId === checkId &&
    positiveInteger(run.check_suite_id) > 0 &&
    positiveInteger(run.check_suite_id) === positiveInteger(checkSuite.id) &&
    evidenceRefsAreBounded &&
    isBoundedEvidenceRef(checkEvidenceRef) &&
    availableCheckEvidenceRefs.has(checkEvidenceRef);

  return {
    workflowPath,
    workflowName,
    workflowId,
    runId,
    runAttempt,
    jobId,
    jobName,
    headSha,
    checkEvidenceRef,
    completeness: complete ? "complete" : "incomplete"
  };
}

export function checkRunIdFromRepositoryUrl(value: string, owner: string, repo: string): number {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== "api.github.com" ||
      parts.length !== 5 ||
      parts[0] !== "repos" ||
      parts[1]?.toLowerCase() !== owner.toLowerCase() ||
      parts[2]?.toLowerCase() !== repo.toLowerCase() ||
      parts[3] !== "check-runs"
    ) return 0;
    return positiveInteger(Number(parts[4]));
  } catch {
    return 0;
  }
}

function normalizeWorkflowPath(value: string): string {
  const trimmed = value.trim().replace(/^\/+/, "");
  const reusable = trimmed.match(/^(.+\.ya?ml)@[^\s?#]+$/i);
  const path = reusable?.[1] ?? trimmed;
  if (!/^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path)) return "";
  return path;
}

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function positiveInteger(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function fullSha(value: string): boolean {
  return /^[a-f0-9]{40,64}$/.test(value);
}

function isBoundedEvidenceRef(value: string): boolean {
  const match = value.match(/^ev_([1-9]\d{0,2})$/);
  return Boolean(match && Number(match[1]) <= 200);
}
