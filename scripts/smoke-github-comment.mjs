const DEFAULT_BASE_URL = (process.env.AGENTPROOF_SMOKE_BASE_URL ?? "https://agentproof-pearl.vercel.app").replace(/\/$/, "");
const DEFAULT_PR_URL = process.env.AGENTPROOF_COMMENT_SMOKE_PR_URL;
const DEFAULT_TASK_TEXT = process.env.AGENTPROOF_COMMENT_SMOKE_TASK_TEXT ?? "";
const DEFAULT_COMMENT_TOKEN = process.env.AGENTPROOF_COMMENT_SMOKE_GITHUB_TOKEN;
const DEFAULT_ANALYZE_TOKEN = process.env.AGENTPROOF_COMMENT_SMOKE_ANALYZE_TOKEN;

export async function runGitHubCommentSmoke({
  baseUrl = DEFAULT_BASE_URL,
  prUrl = DEFAULT_PR_URL,
  taskText = DEFAULT_TASK_TEXT,
  commentToken = DEFAULT_COMMENT_TOKEN,
  analyzeToken = DEFAULT_ANALYZE_TOKEN,
  fetchImpl = fetch
} = {}) {
  if (!prUrl) {
    throw smokeError("Set AGENTPROOF_COMMENT_SMOKE_PR_URL to the target GitHub pull request URL.");
  }

  if (!commentToken) {
    throw smokeError("Set AGENTPROOF_COMMENT_SMOKE_GITHUB_TOKEN to a fine-grained token with PR comment write permission.");
  }

  const report = await analyzePr({ baseUrl, prUrl, taskText, analyzeToken, fetchImpl });
  const commentResponse = await fetchImpl(`${baseUrl}/api/github/comment`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prUrl,
      githubToken: commentToken,
      report
    })
  });
  const commentPayload = await commentResponse.json().catch(() => ({}));

  if (!commentResponse.ok || !["created", "updated"].includes(commentPayload.action) || typeof commentPayload.url !== "string") {
    throw smokeError(
      typeof commentPayload.error === "string" ? commentPayload.error : "GitHub comment smoke failed.",
      commentResponse.status
    );
  }

  const serializedPayload = JSON.stringify(commentPayload);
  if (serializedPayload.includes(commentToken) || (analyzeToken && serializedPayload.includes(analyzeToken))) {
    throw smokeError("GitHub comment smoke response leaked a token value.", commentResponse.status);
  }

  return {
    ok: true,
    baseUrl,
    prUrl,
    action: commentPayload.action,
    commentUrl: commentPayload.url,
    priority: report.summary?.priority,
    evidenceCoverage: report.summary?.evidenceCoverage,
    ciStatus: report.testing?.ciStatus,
    warning: typeof commentPayload.warning === "string" ? commentPayload.warning : undefined
  };
}

async function analyzePr({ baseUrl, prUrl, taskText, analyzeToken, fetchImpl }) {
  const analyzeBody = {
    prUrl,
    taskText
  };

  if (analyzeToken) {
    analyzeBody.githubToken = analyzeToken;
  }

  const analyzeResponse = await fetchImpl(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(analyzeBody)
  });
  const analyzePayload = await analyzeResponse.json().catch(() => ({}));

  if (!analyzeResponse.ok || !analyzePayload.report) {
    throw smokeError(
      typeof analyzePayload.error === "string" ? analyzePayload.error : "Analyze step for GitHub comment smoke failed.",
      analyzeResponse.status
    );
  }

  return analyzePayload.report;
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

if (import.meta.url === `file://${process.argv[1]}`) {
  runGitHubCommentSmoke()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        status: typeof error.status === "number" ? error.status : undefined,
        error: redactForConsole(error instanceof Error ? error.message : "GitHub comment smoke failed.")
      }));
      process.exit(1);
    });
}
