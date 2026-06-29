import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

loadEnvLocal();

const DEFAULT_BASE_URL = (
  process.env.AGENTPROOF_SMOKE_BASE_URL ??
  process.env.AGENTPROOF_BASE_URL ??
  "https://agentproof-pearl.vercel.app"
).replace(/\/$/, "");
const DEFAULT_WEBHOOK_SECRET = process.env.AGENTPROOF_WEBHOOK_SMOKE_SECRET ?? process.env.GITHUB_WEBHOOK_SECRET;
const DEFAULT_PR_URL = process.env.AGENTPROOF_WEBHOOK_LIVE_PR_URL;
const DEFAULT_INSTALLATION_ID = process.env.AGENTPROOF_WEBHOOK_LIVE_INSTALLATION_ID;
const DEFAULT_ACTION = process.env.AGENTPROOF_WEBHOOK_LIVE_ACTION ?? "synchronize";
const DEFAULT_GITHUB_TOKEN = process.env.AGENTPROOF_WEBHOOK_LIVE_GITHUB_TOKEN;
const ALLOW_LIVE_AUTOMATION = process.env.AGENTPROOF_ALLOW_LIVE_WEBHOOK_AUTOMATION === "1";
const ALLOW_SAVE_REPORTS = process.env.AGENTPROOF_WEBHOOK_LIVE_ALLOW_SAVE_REPORTS === "1";
const ALLOWED_ACTIONS = new Set(["opened", "reopened", "synchronize", "ready_for_review"]);
const SENTINELS = [
  "github_pat_live_smoke_should_not_leak_1234567890",
  "sk-live-smoke-should-not-leak",
  "installation-token-live-smoke-should-not-leak"
];

export async function runGitHubWebhookLiveSmoke({
  baseUrl = DEFAULT_BASE_URL,
  webhookSecret = DEFAULT_WEBHOOK_SECRET,
  prUrl = DEFAULT_PR_URL,
  installationId = DEFAULT_INSTALLATION_ID,
  action = DEFAULT_ACTION,
  githubToken = DEFAULT_GITHUB_TOKEN,
  allowLiveAutomation = ALLOW_LIVE_AUTOMATION,
  allowSaveReports = ALLOW_SAVE_REPORTS,
  deliveryId = `agentproof-live-smoke-${Date.now()}`,
  fetchImpl = fetch
} = {}) {
  if (!allowLiveAutomation) {
    throw smokeError("Set AGENTPROOF_ALLOW_LIVE_WEBHOOK_AUTOMATION=1 to run the live webhook automation smoke.");
  }

  if (!webhookSecret) {
    throw smokeError("Set AGENTPROOF_WEBHOOK_SMOKE_SECRET or GITHUB_WEBHOOK_SECRET to the deployed webhook secret.");
  }

  const parsedPr = parseGitHubPrUrl(prUrl);
  if (!parsedPr) {
    throw smokeError("Set AGENTPROOF_WEBHOOK_LIVE_PR_URL to a GitHub pull request URL.");
  }

  const parsedInstallationId = parsePositiveInteger(installationId);
  if (!parsedInstallationId) {
    throw smokeError("Set AGENTPROOF_WEBHOOK_LIVE_INSTALLATION_ID to the GitHub App installation id for the target repo.");
  }

  const normalizedAction = normalizeAction(action);
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const status = await readPublicStatus({ baseUrl: normalizedBaseUrl, webhookSecret, fetchImpl });
  if (status.mode !== "event-mode") {
    throw smokeError("Live webhook automation smoke requires public status mode event-mode before sending a PR webhook.");
  }

  const pullRequest = await fetchPullRequestMetadata({ parsedPr, githubToken, fetchImpl });
  const webhookPayload = livePullRequestPayload({
    parsedPr,
    pullRequest,
    installationId: parsedInstallationId,
    action: normalizedAction,
    suppressSavedReport: !allowSaveReports
  });
  const rawBody = JSON.stringify(webhookPayload);
  const signature = signBody(rawBody, webhookSecret);
  const response = await fetchImpl(`${normalizedBaseUrl}/api/github/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "pull_request",
      "x-github-delivery": deliveryId,
      "x-hub-signature-256": signature
    },
    body: rawBody
  });
  const payload = await safeJson(response);

  assertNoSensitiveEcho(payload, { webhookSecret, signature, githubToken });

  if (!response.ok) {
    throw smokeError(
      typeof payload.error === "string" ? payload.error : "Live GitHub webhook automation smoke failed.",
      response.status
    );
  }

  assertCompletedLiveAnalysis(payload, {
    expectedAction: normalizedAction,
    expectedRepository: parsedPr.fullName,
    expectedPullRequestNumber: parsedPr.number,
    expectedHeadSha: pullRequest.headSha,
    allowSaveReports
  });

  return {
    ok: true,
    baseUrl: normalizedBaseUrl,
    status,
    prUrl: pullRequest.htmlUrl,
    repository: parsedPr.fullName,
    pullRequestNumber: parsedPr.number,
    action: normalizedAction,
    headSha: pullRequest.headSha.slice(0, 12),
    willAnalyze: payload.willAnalyze === true,
    willComment: payload.willComment === true,
    commentSuppressed: true,
    saveReportSuppressed: !allowSaveReports,
    priority: payload.analysis.priority,
    evidenceCoverage: payload.analysis.evidenceCoverage,
    savedReport: summarizeSavedReport(payload.analysis.savedReport)
  };
}

async function readPublicStatus({ baseUrl, webhookSecret, fetchImpl }) {
  const response = await fetchImpl(`${baseUrl}/api/github/webhook/status`, {
    method: "GET",
    headers: { accept: "application/json" }
  });
  const payload = await safeJson(response);

  assertNoSensitiveEcho(payload, { webhookSecret });

  if (!response.ok || !payload.githubApp || typeof payload.githubApp !== "object" || Array.isArray(payload.githubApp)) {
    throw smokeError("Live webhook automation status preflight failed.", response.status);
  }

  assertPublicStatusShape(payload.githubApp, response.status);

  return {
    mode: payload.githubApp.mode,
    label: payload.githubApp.label
  };
}

async function fetchPullRequestMetadata({ parsedPr, githubToken, fetchImpl }) {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "AgentProof webhook live smoke"
  };

  if (githubToken) {
    headers.authorization = `Bearer ${githubToken}`;
  }

  const response = await fetchImpl(`https://api.github.com/repos/${parsedPr.fullName}/pulls/${parsedPr.number}`, {
    headers
  });
  const payload = await safeJson(response);

  assertNoSensitiveEcho(payload, { githubToken });

  if (!response.ok) {
    throw smokeError(
      typeof payload.message === "string" ? payload.message : "GitHub PR metadata fetch failed.",
      response.status
    );
  }

  const headSha = getNestedString(payload, ["head", "sha"]);
  const htmlUrl = typeof payload.html_url === "string" ? payload.html_url : parsedPr.url;
  const number = typeof payload.number === "number" ? payload.number : parsedPr.number;

  if (!headSha || number !== parsedPr.number) {
    throw smokeError("GitHub PR metadata response was missing the expected PR number or head SHA.");
  }

  return {
    htmlUrl,
    headSha
  };
}

function livePullRequestPayload({ parsedPr, pullRequest, installationId, action, suppressSavedReport }) {
  return {
    action,
    repository: {
      full_name: parsedPr.fullName
    },
    pull_request: {
      number: parsedPr.number,
      html_url: pullRequest.htmlUrl,
      title: `AgentProof live smoke ${SENTINELS[0]}`,
      head: {
        sha: pullRequest.headSha
      }
    },
    installation: {
      id: installationId,
      token: SENTINELS[2]
    },
    rawDiff: `Patch excerpt: ${SENTINELS[1]}`,
    agentproofSmoke: {
      mode: "live-analysis",
      suppressComment: true,
      suppressSavedReport,
      sentinel: SENTINELS[0]
    }
  };
}

function assertCompletedLiveAnalysis(payload, expectations) {
  if (payload.duplicate === true) {
    throw smokeError("Live webhook smoke hit the duplicate-delivery guard. Wait for the webhook idempotency TTL, update the PR head SHA, or use a different allowed action.");
  }

  if (payload.event !== "pull_request" || payload.action !== expectations.expectedAction) {
    throw smokeError("Live webhook smoke did not exercise the expected pull_request action.");
  }

  if (payload.dryRun === true || payload.automationEnabled !== true || payload.willAnalyze !== true) {
    throw smokeError("Live webhook smoke did not reach enabled PR analysis. Check automation env and allowed repository settings.");
  }

  if (payload.willComment === true || payload.analysis?.comment) {
    throw smokeError("Live webhook smoke unexpectedly planned or created a GitHub comment.");
  }

  if (payload.analysis?.status !== "completed") {
    throw smokeError("Live webhook smoke did not complete analysis.");
  }

  if (
    payload.analysis.repository !== expectations.expectedRepository ||
    payload.analysis.pullRequestNumber !== expectations.expectedPullRequestNumber ||
    payload.analysis.headSha !== expectations.expectedHeadSha
  ) {
    throw smokeError("Live webhook smoke response did not match the target PR metadata.");
  }

  if (!["low", "medium", "high", "blocker"].includes(payload.analysis.priority)) {
    throw smokeError("Live webhook smoke response did not include a valid priority.");
  }

  if (typeof payload.analysis.evidenceCoverage !== "number") {
    throw smokeError("Live webhook smoke response did not include numeric evidence coverage.");
  }

  const savedReport = payload.analysis.savedReport;
  if (!expectations.allowSaveReports && savedReport) {
    throw smokeError("Live webhook smoke received a saved report even though save reports were suppressed.");
  }

  if (savedReport && savedReport.privacy !== "summary-only") {
    throw smokeError("Live webhook smoke saved report was not marked summary-only.");
  }
}

function assertPublicStatusShape(status, statusCode) {
  const allowed = new Set(["mode", "label", "description", "capabilities", "cautions"]);
  const unknownFields = Object.keys(status).filter((field) => !allowed.has(field));

  if (unknownFields.length > 0) {
    throw smokeError("Live webhook status preflight exposed fields outside the public status contract.", statusCode);
  }

  if (typeof status.mode !== "string" || typeof status.label !== "string") {
    throw smokeError("Live webhook status preflight did not include the public mode and label.", statusCode);
  }
}

function summarizeSavedReport(savedReport) {
  if (!savedReport || typeof savedReport !== "object") {
    return undefined;
  }

  return {
    privacy: savedReport.privacy,
    durability: typeof savedReport.durability === "string" ? savedReport.durability : undefined,
    url: typeof savedReport.url === "string" ? savedReport.url : undefined
  };
}

function parseGitHubPrUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    const url = new URL(value);
    const [, owner, repo, pull, number] = url.pathname.split("/");
    const prNumber = Number(number);

    if (url.hostname !== "github.com" || !owner || !repo || pull !== "pull" || !Number.isInteger(prNumber) || prNumber <= 0) {
      return null;
    }

    return {
      owner,
      repo,
      fullName: `${owner}/${repo}`,
      number: prNumber,
      url: `https://github.com/${owner}/${repo}/pull/${prNumber}`
    };
  } catch {
    return null;
  }
}

function normalizeAction(value) {
  if (typeof value !== "string" || !ALLOWED_ACTIONS.has(value)) {
    throw smokeError(`AGENTPROOF_WEBHOOK_LIVE_ACTION must be one of ${Array.from(ALLOWED_ACTIONS).join(", ")}.`);
  }

  return value;
}

function parsePositiveInteger(value) {
  const number = Number(value);

  return Number.isInteger(number) && number > 0 ? number : null;
}

function getNestedString(parent, path) {
  let current = parent;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }

    current = current[key];
  }

  return typeof current === "string" ? current : undefined;
}

function signBody(rawBody, webhookSecret) {
  return `sha256=${createHmac("sha256", webhookSecret).update(rawBody).digest("hex")}`;
}

async function safeJson(response) {
  return response.json().catch(() => ({}));
}

function assertNoSensitiveEcho(payload, { webhookSecret, signature = "", githubToken = "" } = {}) {
  const serialized = JSON.stringify(payload);
  const disallowed = [
    webhookSecret,
    signature,
    githubToken,
    ...SENTINELS,
    "rawDiff",
    "Patch excerpt",
    "x-hub-signature-256",
    "evidenceIndex",
    "claims",
    "reprompt"
  ].filter(Boolean);

  if (disallowed.some((value) => serialized.includes(value))) {
    throw smokeError("Live GitHub webhook smoke response leaked sensitive probe values.");
  }
}

function redactForConsole(value) {
  return String(value)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted]")
    .replace(/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g, "[redacted]")
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}/g, "[redacted]")
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, "[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[redacted]")
    .replace(/authorization\s*:\s*bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "[redacted]")
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"'\s]+/gi, "[redacted]");
}

function smokeError(message, status) {
  const error = new Error(redactForConsole(message));
  error.status = status;
  return error;
}

function loadEnvLocal() {
  if (!existsSync(".env.local")) {
    return;
  }

  const content = readFileSync(".env.local", "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value.replace(/\\n/g, "\n");
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runGitHubWebhookLiveSmoke()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        status: typeof error.status === "number" ? error.status : undefined,
        error: redactForConsole(error instanceof Error ? error.message : "Live GitHub webhook smoke failed.")
      }));
      process.exit(1);
    });
}
