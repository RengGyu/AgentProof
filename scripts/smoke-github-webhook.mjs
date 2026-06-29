import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

loadEnvLocal();

const DEFAULT_BASE_URL = (
  process.env.AGENTPROOF_SMOKE_BASE_URL ??
  process.env.AGENTPROOF_BASE_URL ??
  "https://agentproof-pearl.vercel.app"
).replace(/\/$/, "");
const DEFAULT_WEBHOOK_SECRET = process.env.AGENTPROOF_WEBHOOK_SMOKE_SECRET ?? process.env.GITHUB_WEBHOOK_SECRET;
const SENTINELS = [
  "github_pat_secret_should_not_leak_1234567890",
  "sk-secret-should-not-leak",
  "Bearer bearer_secret_should_not_leak",
  "AKIAIOSFODNN7EXAMPLE"
];

export async function runGitHubWebhookSmoke({
  baseUrl = DEFAULT_BASE_URL,
  webhookSecret = DEFAULT_WEBHOOK_SECRET,
  fetchImpl = fetch
} = {}) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

  if (!webhookSecret) {
    throw smokeError("Set AGENTPROOF_WEBHOOK_SMOKE_SECRET or GITHUB_WEBHOOK_SECRET to the deployed webhook secret.");
  }

  const status = await readStatus({ baseUrl: normalizedBaseUrl, fetchImpl, webhookSecret });
  await expectInvalidSignatureRejected({ baseUrl: normalizedBaseUrl, fetchImpl });
  const ping = await sendSignedEvent({
    baseUrl: normalizedBaseUrl,
    webhookSecret,
    event: "ping",
    delivery: "agentproof-smoke-ping",
    body: {
      zen: "AgentProof signed smoke",
      sentinel: SENTINELS[0]
    },
    fetchImpl
  });
  const pullRequest = await sendSignedEvent({
    baseUrl: normalizedBaseUrl,
    webhookSecret,
    event: "pull_request",
    delivery: "agentproof-smoke-pr-closed",
    body: closedPullRequestPayload(),
    fetchImpl
  });

  assertAcceptedPing(ping);
  assertNonAnalyzingPullRequest(pullRequest);

  return {
    ok: true,
    baseUrl: normalizedBaseUrl,
    status,
    invalidSignatureRejected: true,
    ping: {
      accepted: ping.accepted === true,
      dryRun: ping.dryRun === true,
      willAnalyze: ping.willAnalyze === true,
      willComment: ping.willComment === true
    },
    pullRequest: {
      accepted: pullRequest.accepted === true,
      ignored: pullRequest.ignored === true,
      dryRun: pullRequest.dryRun === true,
      action: typeof pullRequest.action === "string" ? pullRequest.action : undefined,
      willAnalyze: pullRequest.willAnalyze === true,
      willComment: pullRequest.willComment === true
    }
  };
}

async function readStatus({ baseUrl, fetchImpl, webhookSecret }) {
  const response = await fetchImpl(`${baseUrl}/api/github/webhook/status`, {
    method: "GET",
    headers: { accept: "application/json" }
  });
  const payload = await safeJson(response);

  if (!response.ok || !payload.githubApp || typeof payload.githubApp !== "object") {
    throw smokeError("GitHub webhook status smoke failed.", response.status);
  }

  assertNoSensitiveEcho(payload, webhookSecret);

  const status = payload.githubApp;
  if (containsDetailedStatusFields(status)) {
    throw smokeError("GitHub webhook status exposed detailed configuration fields.", response.status);
  }

  return {
    mode: typeof status.mode === "string" ? status.mode : "unknown",
    label: typeof status.label === "string" ? status.label : "unknown"
  };
}

async function expectInvalidSignatureRejected({ baseUrl, fetchImpl }) {
  const response = await fetchImpl(`${baseUrl}/api/github/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "ping",
      "x-github-delivery": "agentproof-smoke-invalid-signature",
      "x-hub-signature-256": "sha256=invalid"
    },
    body: JSON.stringify({ zen: "AgentProof invalid signature smoke" })
  });

  if (response.status !== 401) {
    throw smokeError(`Expected invalid signature to return HTTP 401, received ${response.status}.`, response.status);
  }
}

async function sendSignedEvent({ baseUrl, webhookSecret, event, delivery, body, fetchImpl }) {
  const rawBody = JSON.stringify(body);
  const signature = signBody(rawBody, webhookSecret);
  const response = await fetchImpl(`${baseUrl}/api/github/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-github-delivery": delivery,
      "x-hub-signature-256": signature
    },
    body: rawBody
  });
  const payload = await safeJson(response);

  if (!response.ok) {
    throw smokeError(
      typeof payload.error === "string" ? payload.error : `${event} webhook smoke failed.`,
      response.status
    );
  }

  assertNoSensitiveEcho(payload, webhookSecret, signature);
  return payload;
}

function assertAcceptedPing(payload) {
  if (payload.accepted !== true || payload.event !== "ping" || payload.willAnalyze !== false || payload.willComment !== false) {
    throw smokeError("Signed ping did not return bounded dry-run metadata.");
  }
}

function assertNonAnalyzingPullRequest(payload) {
  if (payload.event !== "pull_request" || payload.action !== "closed") {
    throw smokeError("Pull request smoke did not exercise the closed PR action.");
  }

  if (payload.willAnalyze !== false || payload.willComment !== false) {
    throw smokeError("Closed pull_request smoke unexpectedly planned analysis or comments.");
  }
}

function assertNoSensitiveEcho(payload, webhookSecret, signature = "") {
  const serialized = JSON.stringify(payload);
  const disallowed = [
    webhookSecret,
    signature,
    ...SENTINELS,
    "x-hub-signature-256",
    "rawDiff",
    "installation-token-should-not-leak"
  ].filter(Boolean);

  if (disallowed.some((value) => serialized.includes(value))) {
    throw smokeError("GitHub webhook smoke response leaked sensitive probe values.");
  }
}

function containsDetailedStatusFields(status) {
  return [
    "signedIntakeReady",
    "appCredentialsReady",
    "automationEnabled",
    "commentEnabled",
    "saveReportsEnabled",
    "allowedRepoCount",
    "allowAllRepos",
    "canAnalyzePullRequests",
    "canPostComments",
    "warnings"
  ].some((field) => Object.hasOwn(status, field));
}

function closedPullRequestPayload() {
  return {
    action: "closed",
    repository: {
      full_name: "RengGyu/AgentProof"
    },
    pull_request: {
      number: 999999,
      html_url: "https://github.com/RengGyu/AgentProof/pull/999999",
      title: `Closed PR smoke ${SENTINELS[1]}`,
      head: {
        sha: "agentproof-smoke-closed-sha"
      }
    },
    installation: {
      id: 999999,
      token: "installation-token-should-not-leak"
    },
    rawDiff: `Patch excerpt: ${SENTINELS[2]}`,
    awsProbe: SENTINELS[3]
  };
}

function signBody(rawBody, webhookSecret) {
  return `sha256=${createHmac("sha256", webhookSecret).update(rawBody).digest("hex")}`;
}

async function safeJson(response) {
  return response.json().catch(() => ({}));
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
  runGitHubWebhookSmoke()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        status: typeof error.status === "number" ? error.status : undefined,
        error: redactForConsole(error instanceof Error ? error.message : "GitHub webhook smoke failed.")
      }));
      process.exit(1);
    });
}
