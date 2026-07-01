import { existsSync, readFileSync } from "node:fs";

loadEnvLocal();

const DEFAULT_BASE_URL = (
  process.env.AGENTPROOF_SMOKE_BASE_URL ??
  process.env.AGENTPROOF_BASE_URL ??
  "https://agentproof-pearl.vercel.app"
).replace(/\/$/, "");
const DEFAULT_MAX_AGE_DAYS = 30;
const REQUIRED_KEYS = [
  "deletion_drill",
  "restore_drill",
  "incident_runbook_review",
  "production_smoke"
];
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /authorization\s*:\s*bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\bbearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi,
  /(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"'\s]+/gi
];

export function extractEvidenceJsonFromMarkdown(markdown) {
  const marker = "```json";
  const start = markdown.indexOf(marker);
  if (start === -1) {
    throw readinessError("Evidence markdown does not contain a json code block.");
  }

  const bodyStart = markdown.indexOf("\n", start);
  if (bodyStart === -1) {
    throw readinessError("Evidence markdown json block is malformed.");
  }

  const end = markdown.indexOf("\n```", bodyStart + 1);
  if (end === -1) {
    throw readinessError("Evidence markdown json block is not closed.");
  }

  return markdown.slice(bodyStart + 1, end);
}

export function validateOpsDrillEvidence({
  evidenceText,
  now = new Date(),
  maxAgeDays = DEFAULT_MAX_AGE_DAYS
}) {
  if (!evidenceText || !String(evidenceText).trim()) {
    throw readinessError("Ops drill evidence is missing.");
  }

  if (containsSecretPattern(evidenceText)) {
    throw readinessError("Ops drill evidence contains secret-like text.");
  }

  let parsed;
  try {
    parsed = JSON.parse(evidenceText);
  } catch {
    throw readinessError("Ops drill evidence is not valid JSON.");
  }

  if (!Array.isArray(parsed)) {
    throw readinessError("Ops drill evidence must be a JSON array.");
  }

  const seenKeys = new Set();
  for (const item of parsed) {
    const key = item?.key;
    if (typeof key !== "string" || !REQUIRED_KEYS.includes(key)) continue;
    if (seenKeys.has(key)) {
      throw readinessError(`Ops drill evidence has duplicate category ${key}.`);
    }
    seenKeys.add(key);
  }

  const categories = REQUIRED_KEYS.map((key) => {
    const record = parsed.find((item) => item?.key === key);
    if (!record) {
      return { key, status: "missing" };
    }

    return validateEvidenceRecord(record, { now, maxAgeDays });
  });
  const unknownKeys = parsed
    .map((item) => item?.key)
    .filter((key) => typeof key === "string" && !REQUIRED_KEYS.includes(key));

  if (unknownKeys.length > 0) {
    throw readinessError("Ops drill evidence contains unknown categories.");
  }

  const counts = {
    required: REQUIRED_KEYS.length,
    passed: categories.filter((item) => item.status === "passed").length,
    blocked: categories.filter((item) => item.status !== "passed").length,
    missing: categories.filter((item) => item.status === "missing").length,
    stale: categories.filter((item) => item.status === "stale").length,
    failed: categories.filter((item) => item.status === "failed").length,
    unclear: categories.filter((item) => item.status === "unclear").length
  };

  return {
    privacy: "ops-drill-evidence-validation-summary-only",
    status: counts.blocked === 0 ? "ready" : "blocked",
    categories,
    counts,
    next: nextAction(counts)
  };
}

export async function runOpsDrillGateReadiness({
  baseUrl = DEFAULT_BASE_URL,
  opsToken = process.env.AGENTPROOF_OPS_TOKEN,
  evidenceText = process.env.AGENTPROOF_OPS_DRILL_EVIDENCE,
  fetchImpl = fetch,
  now = new Date(),
  maxAgeDays = maxAgeDaysFromEnv(process.env.AGENTPROOF_OPS_DRILL_MAX_AGE_DAYS),
  requireProduction = false,
  requireReady = false
} = {}) {
  const result = {
    ok: true,
    baseUrl: baseUrl.replace(/\/$/, ""),
    evidence: evidenceText ? validateOpsDrillEvidence({ evidenceText, now, maxAgeDays }) : undefined,
    production: undefined
  };

  if (requireReady && result.evidence && result.evidence.status !== "ready") {
    throw readinessError("Local ops drill evidence is not launch-ready.");
  }

  if (requireProduction || opsToken) {
    if (!opsToken) {
      throw readinessError("Set AGENTPROOF_OPS_TOKEN before checking the production drill gate.");
    }

    result.production = await fetchProductionDrillGate({
      baseUrl: result.baseUrl,
      opsToken,
      fetchImpl
    });

    if (requireReady && result.production.status !== "ready") {
      throw readinessError("Production ops drill gate is not ready.");
    }
  }

  return result;
}

async function fetchProductionDrillGate({ baseUrl, opsToken, fetchImpl }) {
  const response = await fetchImpl(`${baseUrl}/api/ops/drill-gate`, {
    method: "GET",
    headers: {
      accept: "application/json",
      "x-agentproof-ops-token": opsToken
    }
  });
  const payload = await safeJson(response);

  assertNoSensitiveProductionEcho(payload, opsToken);

  if (!response.ok) {
    throw readinessError(
      typeof payload.code === "string" ? `Production ops drill gate failed: ${payload.code}.` : "Production ops drill gate failed.",
      response.status
    );
  }

  assertProductionShape(payload, response.status);

  return {
    privacy: payload.privacy,
    status: payload.status,
    counts: payload.counts,
    next: payload.next,
    categoryStatuses: Array.isArray(payload.categories)
      ? payload.categories.map((category) => ({
        key: category.key,
        status: category.status,
        evidenceRef: category.evidenceRef
      }))
      : []
  };
}

function validateEvidenceRecord(record, { now, maxAgeDays }) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw readinessError("Ops drill evidence records must be objects.");
  }

  const key = record.key;
  if (!REQUIRED_KEYS.includes(key)) {
    throw readinessError("Ops drill evidence record has an invalid category.");
  }

  if (!["passed", "failed", "unclear"].includes(record.status)) {
    throw readinessError(`Ops drill evidence category ${key} has an invalid status.`);
  }

  const completedAt = normalizeCompletedAt(record.completedAt);
  const evidenceRef = normalizeEvidenceRef(record.evidenceRef);
  if (record.status !== "passed") {
    return {
      key,
      status: record.status,
      completedAt,
      evidenceRef
    };
  }

  if (!completedAt || !evidenceRef) {
    return {
      key,
      status: "unclear",
      completedAt,
      evidenceRef
    };
  }

  const ageDays = Math.floor((now.getTime() - new Date(completedAt).getTime()) / 86_400_000);
  if (ageDays < 0) {
    return {
      key,
      status: "unclear",
      completedAt,
      evidenceRef
    };
  }

  if (ageDays > maxAgeDays) {
    return {
      key,
      status: "stale",
      completedAt,
      evidenceRef,
      ageDays
    };
  }

  return {
    key,
    status: "passed",
    completedAt,
    evidenceRef,
    ageDays
  };
}

function normalizeCompletedAt(value) {
  if (typeof value !== "string") return undefined;
  const normalized = redactForConsole(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(normalized)) return undefined;

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return undefined;

  return date.toISOString();
}

function normalizeEvidenceRef(value) {
  if (typeof value !== "string") return undefined;
  const normalized = redactForConsole(value).trim().slice(0, 180);
  if (!normalized || normalized.includes("[redacted]")) return undefined;
  if (/[?&=]/.test(normalized)) return undefined;

  if (/^docs\/[a-z0-9][a-z0-9._/-]{0,120}(?:#[a-z0-9._-]{1,80})?$/i.test(normalized)) {
    return normalized;
  }

  if (/^github-actions:[0-9]{4,20}$/i.test(normalized)) return normalized;
  if (/^vercel-deploy:[a-z0-9_-]{6,80}$/i.test(normalized)) return normalized;
  if (/^manual-record:[a-z0-9][a-z0-9._:-]{0,80}$/i.test(normalized)) return normalized;

  return undefined;
}

function nextAction(counts) {
  if (counts.failed > 0 || counts.unclear > 0) return "review_failed_ops_drills";
  if (counts.stale > 0) return "rerun_stale_ops_drills";
  if (counts.missing > 0) return "run_missing_ops_drills";

  return "ready_for_launch_review";
}

function assertProductionShape(payload, statusCode) {
  const allowedTopLevel = new Set(["ok", "privacy", "status", "categories", "counts", "next"]);
  const unknownTopLevel = Object.keys(payload).filter((field) => !allowedTopLevel.has(field));
  if (unknownTopLevel.length > 0) {
    throw readinessError("Production ops drill gate returned fields outside the metadata-only contract.", statusCode);
  }

  if (payload.ok !== true || payload.privacy !== "ops-drill-gate-summary-only") {
    throw readinessError("Production ops drill gate did not return the expected privacy label.", statusCode);
  }

  if (!["ready", "blocked"].includes(payload.status)) {
    throw readinessError("Production ops drill gate returned an invalid status.", statusCode);
  }

  if (!Array.isArray(payload.categories) || payload.categories.length !== REQUIRED_KEYS.length) {
    throw readinessError("Production ops drill gate did not return every required category.", statusCode);
  }

  for (const category of payload.categories) {
    const allowedCategoryFields = new Set(["key", "label", "status", "completedAt", "evidenceRef", "maxAgeDays", "ageDays"]);
    const unknownCategoryFields = Object.keys(category).filter((field) => !allowedCategoryFields.has(field));
    if (unknownCategoryFields.length > 0) {
      throw readinessError("Production ops drill category returned fields outside the metadata-only contract.", statusCode);
    }
  }
}

function assertNoSensitiveProductionEcho(payload, opsToken) {
  const serialized = JSON.stringify(payload);
  const disallowed = [
    opsToken,
    "AGENTPROOF_",
    "SUPABASE",
    "service-role",
    "repositoryFullName",
    "pullRequestNumber",
    "providerCustomerId",
    "providerSubscriptionId",
    "rawLogs",
    "rawDiff",
    "evidenceIndex",
    "claims",
    "savedReportKey",
    "github_pat_",
    "sk-secret",
    "tableName"
  ].filter(Boolean);

  if (disallowed.some((value) => serialized.includes(value))) {
    throw readinessError("Production ops drill gate response leaked sensitive or raw fields.");
  }
}

function containsSecretPattern(input) {
  return SECRET_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(input);
  });
}

function maxAgeDaysFromEnv(value) {
  if (!value) return DEFAULT_MAX_AGE_DAYS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return DEFAULT_MAX_AGE_DAYS;

  return Math.min(Math.max(parsed, 1), 90);
}

async function safeJson(response) {
  return response.json().catch(() => ({}));
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

function redactForConsole(value) {
  return String(value)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted]")
    .replace(/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g, "[redacted]")
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}/g, "[redacted]")
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, "[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[redacted]")
    .replace(/authorization\s*:\s*bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "[redacted]")
    .replace(/\bbearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, "[redacted]")
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"'\s]+/gi, "[redacted]");
}

function readinessError(message, status) {
  const error = new Error(redactForConsole(message));
  error.status = status;
  return error;
}

function readCliOptions(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    evidenceFile: undefined,
    requireProduction: false,
    requireReady: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base-url") {
      options.baseUrl = String(argv[index + 1] ?? DEFAULT_BASE_URL).replace(/\/$/, "");
      index += 1;
    } else if (arg === "--evidence-file") {
      options.evidenceFile = argv[index + 1];
      index += 1;
    } else if (arg === "--require-production") {
      options.requireProduction = true;
    } else if (arg === "--require-ready") {
      options.requireReady = true;
    }
  }

  return options;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = readCliOptions(process.argv.slice(2));
  const evidenceText = options.evidenceFile
    ? extractEvidenceJsonFromMarkdown(readFileSync(options.evidenceFile, "utf8"))
    : process.env.AGENTPROOF_OPS_DRILL_EVIDENCE;

  runOpsDrillGateReadiness({
    baseUrl: options.baseUrl,
    evidenceText,
    requireProduction: options.requireProduction,
    requireReady: options.requireReady
  })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        status: typeof error.status === "number" ? error.status : undefined,
        error: redactForConsole(error instanceof Error ? error.message : "Ops drill gate readiness failed.")
      }));
      process.exit(1);
    });
}
