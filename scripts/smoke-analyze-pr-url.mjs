const baseUrl = (process.env.AGENTPROOF_SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const prUrl = process.env.AGENTPROOF_SMOKE_PR_URL;
const taskText = process.env.AGENTPROOF_SMOKE_TASK_TEXT ?? "";
const githubToken = process.env.AGENTPROOF_SMOKE_GITHUB_TOKEN;

if (!prUrl) {
  console.error("Set AGENTPROOF_SMOKE_PR_URL to a GitHub pull request URL.");
  process.exit(1);
}

const response = await fetch(`${baseUrl}/api/analyze`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    prUrl,
    taskText,
    githubToken
  })
});

const payload = await response.json().catch(() => ({}));

if (!response.ok || !payload.report) {
  console.error(JSON.stringify({
    ok: false,
    status: response.status,
    error: typeof payload.error === "string" ? payload.error : "Analyze smoke failed."
  }));
  process.exit(1);
}

const report = payload.report;
const executionEvidence = Array.isArray(report.evidenceIndex)
  ? report.evidenceIndex.filter((item) =>
    (item.kind === "check" || item.kind === "log") &&
      /\b(test|tests|spec|unit|integration|e2e|ci|build|coverage)\b/i.test(`${item.label} ${item.summary}`) &&
      /\b(pass|passed|success|succeeded|green)\b/i.test(`${item.label} ${item.summary}`)
  )
  : [];

if (report.testing?.ciStatus === "passed" && executionEvidence.length === 0) {
  console.error(JSON.stringify({
    ok: false,
    status: response.status,
    error: "Report claimed passed CI without passing check/log evidence."
  }));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  status: response.status,
  title: report.source?.title,
  priority: report.summary?.priority,
  confidence: report.summary?.confidence,
  evidenceCoverage: report.summary?.evidenceCoverage,
  ciStatus: report.testing?.ciStatus,
  requirementCount: Array.isArray(report.requirements) ? report.requirements.length : 0,
  evidenceCount: Array.isArray(report.evidenceIndex) ? report.evidenceIndex.length : 0,
  limitationCount: Array.isArray(report.limitations) ? report.limitations.length : 0
}, null, 2));
