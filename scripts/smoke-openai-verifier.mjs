#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";

loadEnvLocal();

const baseUrl = (process.env.AGENTPROOF_BASE_URL ?? "https://agentproof-pearl.vercel.app").replace(/\/$/, "");
const llmToken = process.env.AGENTPROOF_LLM_TOKEN;

if (!llmToken) {
  console.error("Missing AGENTPROOF_LLM_TOKEN.");
  console.error("Pull Vercel env into .env.local or export it for this shell.");
  console.error("If Vercel stores the value as unreadable/sensitive, env pull may create a blank placeholder.");
  process.exit(1);
}

const input = {
  author: "ai-agent[bot]",
  baseBranch: "main",
  headBranch: "agent/password-reset",
  title: "Add password reset email validation",
  url: "https://github.com/example/saas-app/pull/42",
  taskText:
    "Add password reset email validation. Acceptance criteria: validate email format before sending reset email; show a helpful inline error for invalid email; keep existing successful reset flow; add tests for invalid and valid email paths.",
  description:
    "Implemented password reset email format validation, inline error messaging, and tests for invalid and valid reset flows.",
  changedFiles: [
    {
      path: "src/features/auth/PasswordResetForm.tsx",
      additions: 38,
      deletions: 9,
      status: "modified",
      patch: "+ if (!isValidEmail(email)) setError('Enter a valid email address')\n+ return sendPasswordReset(email)"
    },
    { path: "src/features/auth/passwordReset.ts", additions: 21, deletions: 4, status: "modified" },
    {
      path: "src/features/auth/PasswordResetForm.test.tsx",
      additions: 64,
      deletions: 0,
      status: "added",
      patch: "+ it('shows an inline error for invalid email', async () => {})\n+ it('keeps the valid reset path working', async () => {})"
    }
  ],
  checks: [
    { name: "lint", status: "passed", summary: "No lint errors" },
    { name: "typecheck", status: "passed", summary: "TypeScript passed" },
    { name: "unit tests", status: "passed", summary: "Password reset tests passed" }
  ],
  logs: [
    {
      source: "unit tests",
      status: "passed",
      text: "PasswordResetForm invalid email path passed\nPasswordResetForm valid email path passed"
    }
  ]
};

const analyzeResponse = await fetch(`${baseUrl}/api/analyze`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ demoScenario: "clean" })
});

if (!analyzeResponse.ok) {
  await failWithStatus("deterministic analyze", analyzeResponse);
}

const analyzeJson = await analyzeResponse.json();
if (!analyzeJson.report) {
  console.error("Deterministic analyze did not return a report.");
  process.exit(1);
}

const llmResponse = await fetch(`${baseUrl}/api/llm/verify`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-agentproof-llm-token": llmToken
  },
  body: JSON.stringify({ input, report: analyzeJson.report })
});

if (!llmResponse.ok) {
  await failWithStatus("OpenAI verifier", llmResponse);
}

const llmJson = await llmResponse.json();
if (!llmJson.report?.analysisId || llmJson.source !== "openai") {
  console.error("OpenAI verifier response did not include the expected report metadata.");
  process.exit(1);
}

console.log("OpenAI verifier smoke passed.");
console.log(`Base URL: ${baseUrl}`);
console.log(`Source: ${llmJson.source}`);
console.log(`Priority: ${llmJson.report.summary?.priority ?? "unknown"}`);

async function failWithStatus(label, response) {
  const body = await response.text();
  const safeBody = body.replace(/gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+/g, "[REDACTED]");

  console.error(`${label} failed with HTTP ${response.status}.`);
  console.error(safeBody.slice(0, 800));
  process.exit(1);
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
