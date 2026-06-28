const baseUrl = (process.env.AGENTPROOF_SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const prUrl = process.env.AGENTPROOF_SMOKE_PR_URL;
const taskText = process.env.AGENTPROOF_SMOKE_TASK_TEXT ?? "";
const githubToken = process.env.AGENTPROOF_SMOKE_GITHUB_TOKEN;
const allowProductionGithubToken = process.env.AGENTPROOF_ALLOW_PRODUCTION_GITHUB_TOKEN === "1";
const SAVED_REPORT_DURABILITY = "short-lived-in-memory";

export async function runAnalyzePrSmoke({
  baseUrl,
  prUrl,
  taskText = "",
  githubToken,
  allowProductionGithubToken = false,
  expectations,
  fetchImpl = fetch
}) {
  if (!prUrl) {
    throw smokeError("Set AGENTPROOF_SMOKE_PR_URL to a GitHub pull request URL.");
  }

  assertGithubTokenBoundary({ baseUrl, githubToken, allowProductionGithubToken });

  const response = await fetchImpl(`${baseUrl}/api/analyze`, {
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
    throw smokeError(
      typeof payload.error === "string" ? payload.error : "Analyze smoke failed.",
      response.status
    );
  }

  const report = payload.report;
  const executionEvidence = passingExecutionEvidence(report);
  const failedCheckLocations = failedCheckAnnotationLocations(report);
  const expectationResult = assertReportExpectations(report, expectations);

  if (report.testing?.ciStatus === "passed" && executionEvidence.length === 0) {
    throw smokeError("Report claimed passed CI without passing check/log evidence.", response.status);
  }

  const saveResult = await saveSummaryOnlyReport({ baseUrl, report, fetchImpl });
  const savedReport = saveResult.savedReport;
  assertSummaryOnlyReport(savedReport, {
    originalReprompt: report.reprompt?.prompt,
    githubToken,
    failedCheckLocations
  });

  return {
    ok: true,
    status: response.status,
    priority: report.summary?.priority,
    confidence: report.summary?.confidence,
    evidenceCoverage: report.summary?.evidenceCoverage,
    ciStatus: report.testing?.ciStatus,
    requirementCount: Array.isArray(report.requirements) ? report.requirements.length : 0,
    evidenceCount: Array.isArray(report.evidenceIndex) ? report.evidenceIndex.length : 0,
    limitationCount: Array.isArray(report.limitations) ? report.limitations.length : 0,
    expectationCheckCount: expectationResult.checks.length,
    expectationChecks: expectationResult.checks,
    failedCheckLocationCount: failedCheckLocations.length,
    savedFailedCheckLocationsOmitted: true,
    githubTokenForwarded: Boolean(githubToken),
    productionTokenForwarded: Boolean(githubToken && isRemoteProductionLikeBaseUrl(baseUrl)),
    savedReportPrivacy: saveResult.privacy,
    savedReportDurability: saveResult.durability,
    savedReportDurabilityWarning: Boolean(saveResult.durabilityWarning),
    savedEvidenceCount: Array.isArray(savedReport.evidenceIndex) ? savedReport.evidenceIndex.length : null,
    savedClaimCount: Array.isArray(savedReport.claims) ? savedReport.claims.length : null,
    savedRepromptOmitted: /omit|shared summary|summary/i.test(savedReport.reprompt?.prompt ?? ""),
    savedEvidenceRefsCleared: evidenceRefsCleared(savedReport),
    savedReportDeleted: saveResult.deleted,
    savedReportDeleteWarning: saveResult.deleteWarning
  };
}

export function passingExecutionEvidence(report) {
  return Array.isArray(report.evidenceIndex)
    ? report.evidenceIndex.filter((item) =>
      (item.kind === "check" || item.kind === "log") &&
        isExecutionSignal(item.label, item.summary, item.locator) &&
        hasPassingEvidenceStatusPrefix(item.summary)
    )
    : [];
}

const STRONG_EXECUTION_EVIDENCE_PATTERN =
  /\b(test|tests|spec|unit|integration|e2e|vitest|jest|playwright|cypress|pytest|coverage)\b/i;
const WEAK_EXECUTION_EVIDENCE_PATTERN = /\b(ci|build)\b/i;
const NON_EXECUTION_GATE_PATTERN =
  /\b(policy|policies|provenance|attestation|security|scan|sast|secret|secrets|dependency|dependencies|license|licenses|code owners?|owners|review|report|preview|deploy|deployment|merge[- ]?gate|required checks?)\b/i;
const DIRECT_EXECUTION_COMMAND_PATTERN =
  /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:test|vitest|jest|playwright|cypress|build|typecheck|lint)\b|\b(?:vitest|jest|pytest|go\s+test|cargo\s+test|dotnet\s+test|mvn\s+test|gradle\s+test|tsc|next\s+build)\b/i;

function isExecutionSignalText(text) {
  if (NON_EXECUTION_GATE_PATTERN.test(text) && !DIRECT_EXECUTION_COMMAND_PATTERN.test(text)) {
    return false;
  }

  if (STRONG_EXECUTION_EVIDENCE_PATTERN.test(text)) {
    return true;
  }

  return WEAK_EXECUTION_EVIDENCE_PATTERN.test(text) && !NON_EXECUTION_GATE_PATTERN.test(text);
}

function isExecutionSignal(label, text = "", locator = "") {
  const labelText = String(label ?? "").trim();

  if (NON_EXECUTION_GATE_PATTERN.test(labelText)) {
    return false;
  }

  if (STRONG_EXECUTION_EVIDENCE_PATTERN.test(labelText) || DIRECT_EXECUTION_COMMAND_PATTERN.test(labelText)) {
    return true;
  }

  const supportingText = String(text ?? "").trim();
  if (supportingText && NON_EXECUTION_GATE_PATTERN.test(supportingText)) {
    return false;
  }

  return isExecutionSignalText(`${labelText} ${supportingText}`);
}

function hasPassingEvidenceStatusPrefix(summary) {
  return /^Status:\s*passed\b/i.test(String(summary ?? "").trim());
}

export function failedCheckAnnotationLocations(report) {
  if (!Array.isArray(report?.evidenceIndex)) {
    return [];
  }

  const locations = report.evidenceIndex.flatMap((item) => annotationLocationsFromSummary(item?.summary));

  return Array.from(new Set(locations));
}

function annotationLocationsFromSummary(summary) {
  const value = String(summary ?? "");
  const markerIndex = value.indexOf("Check annotations:");
  if (markerIndex < 0) {
    return [];
  }

  const rawSegment = value
    .slice(markerIndex + "Check annotations:".length)
    .split(/\. Raw annotation messages/i)[0];

  return rawSegment
    .split(",")
    .map((item) => item.trim())
    .map((item) => item.match(/^(notice|warning|failure|annotation)\s+at\s+(.+)$/i))
    .filter(Boolean)
    .map((match) => match[2]?.trim())
    .filter((location) => typeof location === "string" && location.length > 0);
}

export function assertReportExpectations(report, expectations = {}) {
  const checks = [];

  if (!expectations || typeof expectations !== "object") {
    return { checks };
  }

  if (expectations.ciStatus && report.testing?.ciStatus !== expectations.ciStatus) {
    throw smokeError(`Expected ciStatus ${expectations.ciStatus}, received ${report.testing?.ciStatus ?? "unknown"}.`);
  }
  if (expectations.ciStatus) {
    checks.push({ name: "ciStatus", expected: expectations.ciStatus });
  }

  if (Array.isArray(expectations.priorityIn) && !expectations.priorityIn.includes(report.summary?.priority)) {
    throw smokeError(`Expected priority in ${expectations.priorityIn.join(", ")}, received ${report.summary?.priority ?? "unknown"}.`);
  }
  if (Array.isArray(expectations.priorityIn)) {
    checks.push({ name: "priorityIn", expected: expectations.priorityIn.join("|") });
  }

  const requirementCount = Array.isArray(report.requirements) ? report.requirements.length : 0;
  if (typeof expectations.minRequirementCount === "number" && requirementCount < expectations.minRequirementCount) {
    throw smokeError(`Expected at least ${expectations.minRequirementCount} requirements, received ${requirementCount}.`);
  }
  if (typeof expectations.minRequirementCount === "number") {
    checks.push({ name: "minRequirementCount", expected: expectations.minRequirementCount });
  }

  const evidenceCount = Array.isArray(report.evidenceIndex) ? report.evidenceIndex.length : 0;
  if (typeof expectations.minEvidenceCount === "number" && evidenceCount < expectations.minEvidenceCount) {
    throw smokeError(`Expected at least ${expectations.minEvidenceCount} evidence items, received ${evidenceCount}.`);
  }
  if (typeof expectations.minEvidenceCount === "number") {
    checks.push({ name: "minEvidenceCount", expected: expectations.minEvidenceCount });
  }

  if (expectations.requireVisualUnverified === true) {
    assertVisualRequirementsStayUnverifiedWithoutVisualEvidence(report);
    checks.push({ name: "visualRequirementsUnverifiedWithoutVisualEvidence", expected: true });
  }

  return { checks };
}

function assertVisualRequirementsStayUnverifiedWithoutVisualEvidence(report) {
  const requirements = Array.isArray(report.requirements) ? report.requirements : [];
  const visualRequirements = requirements.filter((requirement) =>
    /\b(visual|mobile|layout|overlap|readable|readability|responsive|viewport|browser|screenshot|ux)\b/i.test(requirement.requirementText ?? "")
  );

  if (visualRequirements.length === 0) {
    throw smokeError("Expected at least one visual/mobile requirement, received none.");
  }

  if (hasVisualQaEvidence(report)) {
    return;
  }

  const incorrectlyMet = visualRequirements.filter((requirement) => requirement.status === "met");
  if (incorrectlyMet.length > 0) {
    throw smokeError("Visual/mobile requirements were marked met without browser, screenshot, or visual QA evidence.");
  }
}

function hasVisualQaEvidence(report) {
  return Array.isArray(report.evidenceIndex) && report.evidenceIndex.some((item) =>
    /\b(playwright|cypress|browser qa|screenshot|viewport|visual regression|mobile screenshot)\b/i.test(`${item.label ?? ""} ${item.summary ?? ""}`)
  );
}

function assertGithubTokenBoundary({ baseUrl, githubToken, allowProductionGithubToken }) {
  if (!githubToken || allowProductionGithubToken || !isRemoteProductionLikeBaseUrl(baseUrl)) {
    return;
  }

  throw smokeError(
    "Forwarding a GitHub token to a remote AgentProof base URL requires AGENTPROOF_ALLOW_PRODUCTION_GITHUB_TOKEN=1."
  );
}

function isRemoteProductionLikeBaseUrl(baseUrl) {
  try {
    const hostname = new URL(baseUrl).hostname;

    return !(
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".example") ||
      hostname.endsWith(".test") ||
      hostname.endsWith(".invalid")
    );
  } catch {
    return false;
  }
}

export function assertSummaryOnlyReport(report, options = {}) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw smokeError("Saved report payload was not an object.");
  }

  if (!Array.isArray(report.evidenceIndex) || report.evidenceIndex.length !== 0) {
    throw smokeError("Saved report retained raw evidenceIndex items.");
  }

  if (!Array.isArray(report.claims) || report.claims.length !== 0) {
    throw smokeError("Saved report retained agent claims.");
  }

  if (!/omit|shared summary|summary/i.test(report.reprompt?.prompt ?? "")) {
    throw smokeError("Saved report retained raw re-prompt text.");
  }

  if (!evidenceRefsCleared(report)) {
    throw smokeError("Saved report retained evidenceRefs.");
  }

  if (!Array.isArray(report.limitations) || !report.limitations.some((item) => /omits raw evidence, patch\/log excerpts, claims, and re-prompt text/i.test(item))) {
    throw smokeError("Saved report did not include the summary-only omission limitation.");
  }

  const serialized = JSON.stringify(report);
  const forbiddenPatterns = [
    /Patch excerpt/i,
    /raw_details/i,
    /github_pat_[A-Za-z0-9_]+/,
    /\bgh[opsur]_[A-Za-z0-9_]+/,
    /\bsk-[A-Za-z0-9_-]+/,
    /hooks\.slack\.com\/services\//i,
    /\bBearer\s+[A-Za-z0-9._-]+/i,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/
  ];

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(serialized)) {
      throw smokeError("Saved report retained raw evidence or secret-like content.");
    }
  }

  const forbiddenValues = [
    options.originalReprompt,
    options.githubToken
  ].filter((value) => typeof value === "string" && value.length > 0);

  for (const value of forbiddenValues) {
    if (serialized.includes(value)) {
      throw smokeError("Saved report retained raw re-prompt or token value.");
    }
  }

  for (const location of options.failedCheckLocations ?? []) {
    if (serialized.includes(location)) {
      throw smokeError("Saved report retained failed check annotation location.");
    }
  }
}

async function saveSummaryOnlyReport({ baseUrl, report, fetchImpl }) {
  const saveResponse = await fetchImpl(`${baseUrl}/api/reports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ report })
  });
  const savePayload = await saveResponse.json().catch(() => ({}));

  if (!saveResponse.headers.get("cache-control")?.includes("no-store")) {
    throw smokeError("Saved-report response was not marked no-store.", saveResponse.status);
  }

  if (
    !saveResponse.ok ||
    savePayload.privacy !== "summary-only" ||
    savePayload.durability !== SAVED_REPORT_DURABILITY ||
    typeof savePayload.durabilityWarning !== "string" ||
    typeof savePayload.id !== "string" ||
    typeof savePayload.expiresAt !== "string" ||
    typeof savePayload.url !== "string" ||
    !savePayload.url.includes(`/reports/${savePayload.id}`)
  ) {
    throw smokeError(
      typeof savePayload.error === "string" ? savePayload.error : "Saved-report smoke failed.",
      saveResponse.status
    );
  }

  const getResponse = await fetchImpl(`${baseUrl}/api/reports/${savePayload.id}`);
  const getPayload = await getResponse.json().catch(() => ({}));

  if (!getResponse.headers.get("cache-control")?.includes("no-store")) {
    throw smokeError("Saved-report round-trip response was not marked no-store.", getResponse.status);
  }

  if (
    !getResponse.ok ||
    getPayload.privacy !== "summary-only" ||
    getPayload.durability !== SAVED_REPORT_DURABILITY ||
    typeof getPayload.durabilityWarning !== "string" ||
    !getPayload.report
  ) {
    throw smokeError(
      typeof getPayload.error === "string" ? getPayload.error : "Saved-report round-trip failed.",
      getResponse.status
    );
  }

  let deleted = false;
  try {
    const deleteResponse = await fetchImpl(`${baseUrl}/api/reports/${savePayload.id}`, { method: "DELETE" });
    const deletePayload = await deleteResponse.json().catch(() => ({}));
    deleted = deleteResponse.ok && deletePayload.deleted === true;
  } catch {
    deleted = false;
  }

  return {
    privacy: getPayload.privacy,
    durability: getPayload.durability,
    durabilityWarning: getPayload.durabilityWarning,
    savedReport: getPayload.report,
    deleted,
    deleteWarning: deleted
      ? undefined
      : "Saved-report cleanup was best-effort and did not confirm deletion; short-lived in-memory reports may already be on another serverless instance."
  };
}

function evidenceRefsCleared(report) {
  const requirementsClear = Array.isArray(report.requirements) &&
    report.requirements.every((requirement) => Array.isArray(requirement.evidenceRefs) && requirement.evidenceRefs.length === 0);
  const missingTestsClear = Array.isArray(report.testing?.missingTests) &&
    report.testing.missingTests.every((missingTest) => Array.isArray(missingTest.evidenceRefs) && missingTest.evidenceRefs.length === 0);
  const reviewPriorityClear = Array.isArray(report.reviewPriority) &&
    report.reviewPriority.every((item) => !("evidenceRefs" in item));

  return requirementsClear && missingTestsClear && reviewPriorityClear;
}

function smokeError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAnalyzePrSmoke({ baseUrl, prUrl, taskText, githubToken, allowProductionGithubToken })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        status: typeof error.status === "number" ? error.status : undefined,
        error: error instanceof Error ? error.message : "Analyze smoke failed."
      }));
      process.exit(1);
    });
}
