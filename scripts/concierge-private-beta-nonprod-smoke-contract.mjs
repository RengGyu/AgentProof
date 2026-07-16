const SCENARIOS = new Set([
  "single_linked_issue_passing",
  "task_unavailable_or_ambiguous",
  "failed_or_unavailable_check"
]);
const TASK_STATUSES = new Set(["available", "unavailable", "ambiguous"]);
const CHECK_STATUSES = new Set(["passed", "failed", "pending", "unknown"]);
const CASE_KEYS = ["caseId", "expectedCiStatus", "expectedHeadSha", "expectedOriginalTaskStatus", "installationId", "pullRequestNumber", "repositoryFullName", "repositoryId", "scenario", "tenantId"];
const RESPONSE_KEYS = ["capabilities", "caseIdOrHash", "privacy", "report", "sideEffectTelemetry", "sideEffects"];
const CAPABILITY_KEYS = ["billingEnabled", "fullHistoryEnabled", "githubCommentEnabled", "globalKillSwitch", "llmEnabled", "manualAnalysisEnabled", "publicShareEnabled", "saveReportsEnabled", "slackEnabled", "webhookAutomationEnabled"];
const EFFECT_KEYS = ["comment", "llm", "save", "share", "slack", "webhook"];
const TELEMETRY_KEYS = ["caseIdOrHash", "counts", "observation", "sourceHeadSha", "version"];

/**
 * The external smoke runner deliberately accepts only a preapproved HTTPS
 * origin. This prevents a copied command from sending a durable session to a
 * local or unrelated host.
 */
export function validateApprovedSmokeOrigin(baseUrl, approvedOrigin) {
  if (typeof baseUrl !== "string" || typeof approvedOrigin !== "string") return null;
  try {
    const base = new URL(baseUrl);
    const approved = new URL(approvedOrigin);
    if (base.protocol !== "https:" || approved.protocol !== "https:") return null;
    if (base.username || base.password || approved.username || approved.password) return null;
    if (base.origin !== approved.origin || base.pathname !== "/" || approved.pathname !== "/" || base.search || base.hash || approved.search || approved.hash) return null;
    return base.origin;
  } catch {
    return null;
  }
}

export function validateSmokeCases(value) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(validCase)) return false;
  const scenarios = value.map((item) => item.scenario);
  if (new Set(scenarios).size !== 3 || scenarios.some((scenario) => !SCENARIOS.has(scenario))) return false;
  const caseIds = new Set(value.map((item) => item.caseId));
  const sourceTargets = new Set(value.map((item) => `${item.repositoryId}:${item.pullRequestNumber}`));
  return caseIds.size === 3 && sourceTargets.size === 3 && value.every(caseMatchesScenario);
}

export function validateSmokeTelemetrySet(items) {
  if (!Array.isArray(items) || items.length !== 3) return false;
  const hashes = new Set();
  for (const item of items) {
    if (!isExactRecord(item, ["caseIdOrHash"]) || !/^[a-f0-9]{64}$/.test(item.caseIdOrHash)) return false;
    if (hashes.has(item.caseIdOrHash)) return false;
    hashes.add(item.caseIdOrHash);
  }
  return true;
}

export function inspectSmokeResponse(item, responseStatus, body, runtimeReportValid = false) {
  const report = body?.report;
  const metCount = Array.isArray(report?.requirements)
    ? report.requirements.filter((requirement) => requirement?.status === "met").length
    : -1;
  const decisionCardValid = hasBoundDecisionCard(report);
  const telemetryValid = hasBoundZeroTelemetry(body, report);
  const valid = responseStatus === 200
    && report?.source?.originalTask?.status === item.expectedOriginalTaskStatus
    && report?.testing?.ciStatus === item.expectedCiStatus
    && (item.expectedOriginalTaskStatus === "available" || metCount === 0)
    && decisionCardValid
    && runtimeReportValid
    && telemetryValid
    && hasExactSmokeEnvelope(body)
    && hasRuntimeDefaults(body)
    && hasManifestBinding(item, report, body);
  return {
    status: valid ? "passed" : "failed",
    httpStatus: responseStatus,
    originalTaskStatus: report?.source?.originalTask?.status ?? null,
    ciStatus: report?.testing?.ciStatus ?? null,
    metCount,
    decisionCardValid,
    telemetryValid,
    telemetryCaseIdOrHash: typeof body?.sideEffectTelemetry?.caseIdOrHash === "string" ? body.sideEffectTelemetry.caseIdOrHash : null
  };
}

export function validateSmokeHttpBoundary(response, expectedEndpoint) {
  const contentType = response.headers?.get("content-type") ?? "";
  const cacheControl = response.headers?.get("cache-control") ?? "";
  const referrerPolicy = response.headers?.get("referrer-policy") ?? "";
  const contentLength = response.headers?.get("content-length");
  const parsedLength = contentLength === null ? null : Number(contentLength);
  if (response.redirected || response.url !== expectedEndpoint) return false;
  if (!/^application\/json(?:;|$)/i.test(contentType)) return false;
  if (!/(?:^|,)\s*private(?:\s|,|$)/i.test(cacheControl) || !/(?:^|,)\s*no-store(?:\s|,|$)/i.test(cacheControl)) return false;
  if (referrerPolicy.trim().toLowerCase() !== "no-referrer") return false;
  return contentLength === null || (Number.isSafeInteger(parsedLength) && parsedLength >= 0 && parsedLength <= 2_000_000);
}

function validCase(value) {
  return isExactRecord(value, CASE_KEYS)
    && typeof value.scenario === "string"
    && typeof value.caseId === "string" && /^case_[a-f0-9]{16,64}$/.test(value.caseId)
    && typeof value.tenantId === "string" && /^[a-z0-9_-]{2,80}$/i.test(value.tenantId)
    && Number.isSafeInteger(value.installationId) && value.installationId > 0
    && Number.isSafeInteger(value.repositoryId) && value.repositoryId > 0
    && typeof value.repositoryFullName === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repositoryFullName)
    && Number.isSafeInteger(value.pullRequestNumber) && value.pullRequestNumber > 0
    && typeof value.expectedHeadSha === "string" && /^[a-f0-9]{40}$/.test(value.expectedHeadSha)
    && TASK_STATUSES.has(value.expectedOriginalTaskStatus)
    && CHECK_STATUSES.has(value.expectedCiStatus);
}

function caseMatchesScenario(item) {
  if (item.scenario === "single_linked_issue_passing") return item.expectedOriginalTaskStatus === "available" && item.expectedCiStatus === "passed";
  if (item.scenario === "task_unavailable_or_ambiguous") return item.expectedOriginalTaskStatus === "unavailable" || item.expectedOriginalTaskStatus === "ambiguous";
  return item.expectedCiStatus === "failed" || item.expectedCiStatus === "unknown";
}

function hasBoundDecisionCard(report) {
  const card = report?.decisionCard;
  const evidence = Array.isArray(report?.evidenceIndex) ? new Set(report.evidenceIndex.map((item) => item?.id)) : null;
  if (!card || !evidence || !card.topGap || !card.reprompt || !Array.isArray(card.firstInspectionPoints)) return false;
  if (!Array.isArray(card.topGap.evidenceRefs) || card.topGap.evidenceRefs.length === 0) return false;
  if (card.firstInspectionPoints.length < 1 || card.firstInspectionPoints.length > 2) return false;
  const exactRefs = JSON.stringify(card.topGap.evidenceRefs);
  if (card.reprompt.gapKey !== card.topGap.gapKey || card.reprompt.basedOnGapKind !== card.topGap.kind || JSON.stringify(card.reprompt.evidenceRefs) !== exactRefs) return false;
  if (typeof card.reprompt.prompt !== "string" || card.reprompt.prompt.length === 0) return false;
  return card.topGap.evidenceRefs.every((ref) => evidence.has(ref))
    && card.firstInspectionPoints.every((point) => Array.isArray(point?.evidenceRefs) && point.evidenceRefs.length > 0 && point.evidenceRefs.every((ref) => evidence.has(ref)) && typeof point.href === "string" && /^https:\/\/github\.com\//.test(point.href));
}

function hasRuntimeDefaults(body) {
  const effects = body?.sideEffects;
  const capabilities = body?.capabilities;
  if (!effects || !capabilities || body?.privacy !== "transient-full-report-no-durable-save") return false;
  const disabledCapabilities = ["llmEnabled", "webhookAutomationEnabled", "saveReportsEnabled", "publicShareEnabled", "githubCommentEnabled", "slackEnabled", "billingEnabled", "fullHistoryEnabled"];
  return isExactRecord(effects, EFFECT_KEYS) && isExactRecord(capabilities, CAPABILITY_KEYS)
    && EFFECT_KEYS.every((key) => effects[key] === false)
    && capabilities.manualAnalysisEnabled === true
    && capabilities.globalKillSwitch === false
    && disabledCapabilities.every((key) => capabilities[key] === false);
}

function hasExactSmokeEnvelope(body) {
  return isExactRecord(body, RESPONSE_KEYS)
    && body.privacy === "transient-full-report-no-durable-save"
    && typeof body.caseIdOrHash === "string" && /^[a-f0-9]{64}$/.test(body.caseIdOrHash);
}

function hasBoundZeroTelemetry(body, report) {
  const telemetry = body?.sideEffectTelemetry;
  const headSha = report?.source?.provenance?.headSha;
  if (!isExactRecord(telemetry, TELEMETRY_KEYS)
    || telemetry.version !== "concierge-side-effect-telemetry.v1"
    || telemetry.observation !== "runtime_instrumented"
    || telemetry.caseIdOrHash !== body?.caseIdOrHash
    || typeof headSha !== "string" || !/^[a-f0-9]{40}$/.test(headSha)
    || telemetry.sourceHeadSha !== headSha
    || !isExactRecord(telemetry.counts, EFFECT_KEYS)) return false;
  return EFFECT_KEYS.every((key) => telemetry.counts[key] === 0);
}

function hasManifestBinding(item, report, body) {
  if (typeof body?.caseIdOrHash !== "string" || !/^[a-f0-9]{64}$/.test(body.caseIdOrHash)) return false;
  const repository = typeof item?.repositoryFullName === "string" ? item.repositoryFullName : "";
  const pullRequestNumber = item?.pullRequestNumber;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !Number.isSafeInteger(pullRequestNumber) || pullRequestNumber <= 0) return false;
  const expectedPull = `https://github.com/${repository}/pull/${pullRequestNumber}`.toLowerCase();
  if (String(report?.source?.url ?? "").replace(/\/$/, "").toLowerCase() !== expectedPull) return false;
  if (report?.source?.provenance?.headSha !== item.expectedHeadSha) return false;
  const expectedRepositoryPrefix = `https://github.com/${repository}/`.toLowerCase();
  return report.decisionCard.firstInspectionPoints.every((point) => String(point.href).toLowerCase().startsWith(expectedRepositoryPrefix));
}

function isExactRecord(value, keys) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === keys.slice().sort().join("\0");
}
