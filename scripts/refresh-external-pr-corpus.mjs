import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = process.cwd();
const DEFAULT_OUTPUT_PATH = join(ROOT, "eval/generated/external-pr-live-corpus.v1.json");
const SOURCE_PATHS = {
  pilot: join(ROOT, "eval/fixtures/external-pr-pilot.v1.json"),
  blind: join(ROOT, "eval/external-pr-blind-candidates.json"),
  roleproof: join(ROOT, "eval/external-pr-roleproof-new-blind-candidates.json")
};
const SHA_PATTERN = /^[a-f0-9]{40,64}$/;

export function loadDefaultExternalPrCandidates() {
  return externalPrCandidatesFromDocuments({
    pilot: readJson(SOURCE_PATHS.pilot),
    blind: readJson(SOURCE_PATHS.blind),
    roleproof: readJson(SOURCE_PATHS.roleproof)
  });
}

export function externalPrCandidatesFromDocuments({ pilot, blind, roleproof }) {
  const candidates = [
    ...asArray(pilot?.cases).map((item) => candidateFromPilotCase(item)),
    ...asArray(blind?.candidates).map((item) => candidateFromCandidatePack(item, "blind")),
    ...asArray(roleproof?.candidates).map((item) => candidateFromCandidatePack(item, "roleproof"))
  ];

  if (candidates.length !== 25) {
    throw new Error(`Live external PR corpus requires exactly 25 candidates; received ${candidates.length}.`);
  }

  const urls = new Set(candidates.map((candidate) => candidate.prUrl));
  if (urls.size !== candidates.length) {
    throw new Error("Live external PR corpus candidates must have unique PR URLs.");
  }

  return candidates;
}

export async function captureExternalPrCorpusSnapshot({
  candidates,
  observedAt = new Date().toISOString(),
  githubToken,
  fetchImpl = fetch
}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("Live external PR corpus capture requires at least one candidate.");
  }

  const cases = [];
  for (const candidate of candidates) {
    cases.push(await captureCandidate({ candidate, githubToken, fetchImpl }));
  }

  const status = cases.every((item) => item.captureStatus === "captured") ? "ready" : "incomplete";
  return {
    version: 1,
    privacy: "external-pr-live-corpus-anchor-summary-only",
    status,
    observedAt: normalizeIsoTimestamp(observedAt),
    candidateCount: cases.length,
    corpusFingerprint: sha256(cases.map((item) => ({
      id: item.id,
      prUrl: item.prUrl,
      captureStatus: item.captureStatus,
      anchorFingerprint: item.anchorFingerprint
    }))),
    cases
  };
}

export function writeExternalPrCorpusSnapshot(snapshot, outputPath = DEFAULT_OUTPUT_PATH) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

async function captureCandidate({ candidate, githubToken, fetchImpl }) {
  const parsed = parsePublicGitHubPullUrl(candidate?.prUrl);
  if (!parsed || candidate.repository !== parsed.repository || candidate.prNumber !== parsed.prNumber) {
    return unavailableCandidate(candidate, "invalid_candidate");
  }

  let response;
  try {
    response = await fetchImpl(`https://api.github.com/repos/${parsed.repository}/pulls/${parsed.prNumber}`, {
      headers: githubHeaders(githubToken)
    });
  } catch {
    return unavailableCandidate(candidate, "github_unavailable");
  }

  if (!response?.ok) {
    return unavailableCandidate(candidate, "github_unavailable");
  }

  let pullRequest;
  try {
    pullRequest = await response.json();
  } catch {
    return unavailableCandidate(candidate, "github_unavailable");
  }

  if (pullRequest?.base?.repo?.private !== false || pullRequest?.head?.repo?.private === true) {
    return unavailableCandidate(candidate, "not_public");
  }

  const anchor = {
    headSha: pullRequest?.head?.sha,
    baseSha: pullRequest?.base?.sha
  };
  if (!SHA_PATTERN.test(anchor.headSha ?? "") || !SHA_PATTERN.test(anchor.baseSha ?? "")) {
    return unavailableCandidate(candidate, "invalid_anchor");
  }

  const safeUrl = normalizePublicGitHubPullUrl(pullRequest?.html_url);
  if (safeUrl !== candidate.prUrl || !validPullState(pullRequest?.state) || typeof pullRequest?.draft !== "boolean" ||
    !validNullableTimestamp(pullRequest?.merged_at) || !validTimestamp(pullRequest?.updated_at) || !validChangedFileCount(pullRequest?.changed_files)) {
    return unavailableCandidate(candidate, "invalid_metadata");
  }

  const normalizedAnchor = { headSha: anchor.headSha, baseSha: anchor.baseSha };
  return {
    id: candidate.id,
    cohort: candidate.cohort,
    repository: candidate.repository,
    prNumber: candidate.prNumber,
    prUrl: candidate.prUrl,
    captureStatus: "captured",
    anchor: normalizedAnchor,
    pullRequest: {
      state: pullRequest.state,
      draft: pullRequest.draft,
      mergedAt: pullRequest.merged_at,
      updatedAt: pullRequest.updated_at,
      changedFileCount: pullRequest.changed_files
    },
    anchorFingerprint: sha256({
      prUrl: candidate.prUrl,
      anchor: normalizedAnchor,
      state: pullRequest.state,
      draft: pullRequest.draft,
      mergedAt: pullRequest.merged_at,
      updatedAt: pullRequest.updated_at,
      changedFileCount: pullRequest.changed_files
    })
  };
}

function candidateFromPilotCase(item) {
  const reportInput = item?.reportInput;
  return normalizeCandidate({
    id: item?.id,
    cohort: "pilot",
    repository: reportInput?.repository,
    prNumber: reportInput?.pullRequestNumber,
    prUrl: reportInput?.pullRequestUrl
  });
}

function candidateFromCandidatePack(item, cohort) {
  return normalizeCandidate({
    id: item?.id,
    cohort,
    repository: item?.repository,
    prNumber: item?.prNumber,
    prUrl: item?.prUrl
  });
}

function normalizeCandidate(candidate) {
  if (typeof candidate.id !== "string" || !candidate.id || typeof candidate.cohort !== "string" ||
    typeof candidate.repository !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(candidate.repository) ||
    !Number.isSafeInteger(candidate.prNumber) || candidate.prNumber < 1 ||
    normalizePublicGitHubPullUrl(candidate.prUrl) !== candidate.prUrl) {
    throw new Error("Live external PR corpus candidate is invalid.");
  }
  return candidate;
}

function unavailableCandidate(candidate, captureStatus) {
  return {
    id: typeof candidate?.id === "string" ? candidate.id : "unknown",
    cohort: typeof candidate?.cohort === "string" ? candidate.cohort : "unknown",
    repository: typeof candidate?.repository === "string" ? candidate.repository : "unknown/unknown",
    prNumber: Number.isSafeInteger(candidate?.prNumber) ? candidate.prNumber : 0,
    prUrl: typeof candidate?.prUrl === "string" ? candidate.prUrl : "",
    captureStatus,
    anchor: null,
    pullRequest: null,
    anchorFingerprint: null
  };
}

function parsePublicGitHubPullUrl(value) {
  const url = normalizePublicGitHubPullUrl(value);
  if (!url) return null;
  const match = new URL(url).pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)$/);
  if (!match) return null;
  return { repository: `${match[1]}/${match[2]}`, prNumber: Number(match[3]) };
}

function normalizePublicGitHubPullUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search || url.hash ||
      !/^\/[^/]+\/[^/]+\/pull\/\d+$/.test(url.pathname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function githubHeaders(githubToken) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  return typeof githubToken === "string" && githubToken.trim()
    ? { ...headers, Authorization: `Bearer ${githubToken.trim()}` }
    : headers;
}

function validPullState(value) {
  return value === "open" || value === "closed";
}

function validTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function validNullableTimestamp(value) {
  return value === null || validTimestamp(value);
}

function validChangedFileCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function normalizeIsoTimestamp(value) {
  if (!validTimestamp(value)) throw new Error("Live external PR corpus observedAt must be an ISO timestamp.");
  return new Date(value).toISOString();
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function transientGitHubTokenFromCli() {
  if (process.env.AGENTPROOF_EXTERNAL_CORPUS_USE_GH_AUTH !== "1") return undefined;
  try {
    const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outputPath = process.env.AGENTPROOF_EXTERNAL_CORPUS_OUTPUT ?? DEFAULT_OUTPUT_PATH;
  const githubToken = process.env.AGENTPROOF_EXTERNAL_CORPUS_GITHUB_TOKEN ?? transientGitHubTokenFromCli();

  captureExternalPrCorpusSnapshot({
    candidates: loadDefaultExternalPrCandidates(),
    githubToken
  }).then((snapshot) => {
    writeExternalPrCorpusSnapshot(snapshot, outputPath);
    console.log(JSON.stringify({
      status: snapshot.status,
      candidateCount: snapshot.candidateCount,
      capturedCount: snapshot.cases.filter((item) => item.captureStatus === "captured").length,
      outputPath
    }));
    process.exitCode = snapshot.status === "ready" ? 0 : 1;
  }).catch(() => {
    console.error(JSON.stringify({ status: "incomplete", error: "Live external PR corpus capture failed." }));
    process.exitCode = 1;
  });
}
