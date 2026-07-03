import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_FIXTURE_PATH = join(process.cwd(), "eval/fixtures/external-pr-pilot.v1.json");
const REQUIRED_CATEGORIES = [
  "clean_pr",
  "missing_tests",
  "scope_creep",
  "failed_ci",
  "vague_task_or_visual_gap"
];
const REQUIREMENT_STATUSES = ["met", "partial", "missing", "unclear"];
const YES_NO = ["yes", "no"];
const FORBIDDEN_REPORT_INPUT_KEYS = new Set([
  "manualLabels",
  "manualLabel",
  "labelStatus",
  "requirementStatus",
  "missingTargetedTestEvidence",
  "scopeCreep",
  "topFilesReviewerShouldInspect",
  "oracle",
  "hiddenLabels",
  "hiddenValues",
  "expectedVerdict",
  "expectedOutcome"
]);
const FORBIDDEN_KEYS = new Set([
  "token",
  "secret",
  "authorization",
  "providerId",
  "customerId",
  "subscriptionId",
  "tableName",
  "envName",
  "environmentVariable",
  "rawBody",
  "rawDiff",
  "patch",
  "diff",
  "rawLog",
  "log",
  "logs"
]);
const SECRET_PATTERNS = [
  /github_pat_[A-Za-z0-9_]+/,
  /\bgh[opsur]_[A-Za-z0-9_]+/,
  /\bsk-[A-Za-z0-9_-]+/,
  /\bBearer\s+[A-Za-z0-9._-]+/i,
  /hooks\.slack\.com\/services\//i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
];

export function runExternalPrPilotLabelsCli(argv, {
  fixturePath = DEFAULT_FIXTURE_PATH,
  readFile = readFileSync,
  writeFile = writeFileSync
} = {}) {
  const [command, ...rest] = argv;
  const options = parseOptions(rest);
  const targetPath = options.fixture ?? fixturePath;

  if (!command || command === "help" || options.help === "true") {
    return usage();
  }

  const fixture = loadFixture(targetPath, readFile);

  if (command === "summary") {
    return summarizeFixture(validateFixture(fixture));
  }

  if (command === "show") {
    return showCase(fixture, options);
  }

  if (command === "record-labels") {
    const updated = recordLabels(fixture, options);
    writeValidatedFixture(targetPath, updated, writeFile);
    return summarizeFixture(updated);
  }

  throw new Error(`Unsupported external PR pilot label command: ${command}`);
}

function showCase(fixture, options) {
  const validated = validateFixture(fixture);
  const caseId = boundedText(options.caseId ?? options["case-id"], "--case-id", 1, 120);
  const testCase = validated.cases.find((item) => item.id === caseId);

  if (!testCase) {
    throw new Error(`External PR pilot case not found: ${caseId}`);
  }

  return {
    privacy: "external-pr-pilot-label-summary-only",
    id: testCase.id,
    category: testCase.category,
    prUrl: testCase.source.url,
    manualLabelStatus: testCase.manualLabels.labelStatus,
    topFileCount: testCase.manualLabels.topFilesReviewerShouldInspect.length,
    limitationCount: testCase.limitations.length,
    next: testCase.manualLabels.labelStatus === "reviewed"
      ? "review_label_against_generated_report"
      : "record_manual_labels_after_reviewer_session"
  };
}

function recordLabels(fixture, options) {
  const caseId = boundedText(options.caseId ?? options["case-id"], "--case-id", 1, 120);
  const requirementStatus = requiredEnum(
    options.requirementStatus ?? options["requirement-status"],
    REQUIREMENT_STATUSES,
    "--requirement-status"
  );
  const missingTargetedTestEvidence = yesNoToBoolean(requiredEnum(
    options.missingTargetedTestEvidence ?? options["missing-targeted-test-evidence"],
    YES_NO,
    "--missing-targeted-test-evidence"
  ));
  const scopeCreep = yesNoToBoolean(requiredEnum(
    options.scopeCreep ?? options["scope-creep"],
    YES_NO,
    "--scope-creep"
  ));
  const topFilesReviewerShouldInspect = parseTopFiles(options.topFiles ?? options["top-files"]);
  const notes = boundedText(options.notes, "--notes", 10, 240);
  const updated = structuredCloneCompat(validateFixture(fixture));
  const target = updated.cases.find((item) => item.id === caseId);

  if (!target) {
    throw new Error(`External PR pilot case not found: ${caseId}`);
  }

  const originalReportInput = JSON.stringify(target.reportInput);
  target.manualLabels = {
    labelStatus: "reviewed",
    requirementStatus,
    missingTargetedTestEvidence,
    scopeCreep,
    topFilesReviewerShouldInspect,
    notes
  };

  if (JSON.stringify(target.reportInput) !== originalReportInput) {
    throw new Error("External PR pilot recorder must not mutate reportInput.");
  }

  return validateFixture(updated);
}

function summarizeFixture(fixture) {
  const reviewed = fixture.cases.filter((item) => item.manualLabels.labelStatus === "reviewed").length;
  const categories = new Set(fixture.cases.map((item) => item.category));
  const pending = fixture.cases.length - reviewed;

  return {
    ok: pending === 0,
    privacy: "external-pr-pilot-label-summary-only",
    status: pending === 0 ? "ready_for_pilot_review" : "manual_labels_pending",
    counts: {
      cases: fixture.cases.length,
      reviewed,
      pending,
      requiredCategories: REQUIRED_CATEGORIES.length,
      coveredCategories: REQUIRED_CATEGORIES.filter((category) => categories.has(category)).length
    },
    next: pending > 0 ? "record_manual_labels_after_reviewer_sessions" : "run_p0_beta_readiness"
  };
}

function validateFixture(fixture) {
  if (!isRecord(fixture)) {
    throw new Error("External PR pilot fixture must be an object.");
  }

  if (fixture.schemaVersion !== "external-pr-pilot.v1") {
    throw new Error("External PR pilot fixture schemaVersion must be external-pr-pilot.v1.");
  }

  if (fixture.privacy !== "external-pr-pilot-metadata-only") {
    throw new Error("External PR pilot fixture must remain metadata-only.");
  }

  if (!Array.isArray(fixture.cases) || fixture.cases.length !== 5) {
    throw new Error("External PR pilot fixture must contain exactly 5 cases before scaling.");
  }

  const categories = new Set();
  const ids = new Set();
  const urls = new Set();

  for (const testCase of fixture.cases) {
    validateCase(testCase);
    categories.add(testCase.category);
    ids.add(testCase.id);
    urls.add(testCase.source.url);
  }

  if (ids.size !== fixture.cases.length) {
    throw new Error("External PR pilot case ids must be unique.");
  }

  if (urls.size !== fixture.cases.length) {
    throw new Error("External PR pilot PR URLs must be unique.");
  }

  for (const category of REQUIRED_CATEGORIES) {
    if (!categories.has(category)) {
      throw new Error(`External PR pilot fixture is missing category ${category}.`);
    }
  }

  return fixture;
}

function validateCase(testCase) {
  if (!isRecord(testCase)) {
    throw new Error("External PR pilot case must be an object.");
  }

  if (typeof testCase.id !== "string" || !testCase.id.startsWith("external-pr-pilot-")) {
    throw new Error("External PR pilot case id must use the external-pr-pilot prefix.");
  }

  if (!REQUIRED_CATEGORIES.includes(testCase.category)) {
    throw new Error(`External PR pilot case ${testCase.id} has an unsupported category.`);
  }

  if (!isRecord(testCase.source) || !isRecord(testCase.reportInput) || !isRecord(testCase.manualLabels)) {
    throw new Error(`External PR pilot case ${testCase.id} must separate source, reportInput, and manualLabels.`);
  }

  if (typeof testCase.source.repository !== "string" || /agentproof/i.test(testCase.source.repository)) {
    throw new Error(`External PR pilot case ${testCase.id} must not use an AgentProof PR.`);
  }

  if (
    typeof testCase.source.url !== "string" ||
    !/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(testCase.source.url) ||
    /RengGyu\/AgentProof/i.test(testCase.source.url)
  ) {
    throw new Error(`External PR pilot case ${testCase.id} must use a public non-AgentProof GitHub PR URL.`);
  }

  if (testCase.reportInput.pullRequestUrl !== testCase.source.url) {
    throw new Error(`External PR pilot case ${testCase.id} report input URL must match the source URL.`);
  }

  if (testCase.reportInput.repository !== testCase.source.repository) {
    throw new Error(`External PR pilot case ${testCase.id} report input repository must match the source repository.`);
  }

  assertNoForbiddenReportInputKeys(testCase.reportInput, testCase.id);
  assertNoPrivateOrRawPayloads(testCase, testCase.id);
  validateManualLabels(testCase);

  if (!Array.isArray(testCase.limitations) || testCase.limitations.length === 0) {
    throw new Error(`External PR pilot case ${testCase.id} must state limitations.`);
  }
}

function validateManualLabels(testCase) {
  const labels = testCase.manualLabels;

  if (labels.labelStatus !== "pending_reviewer_confirmation" && labels.labelStatus !== "reviewed") {
    throw new Error(`External PR pilot case ${testCase.id} has an unsupported labelStatus.`);
  }

  const pending = labels.labelStatus === "pending_reviewer_confirmation";
  const pendingValue = "pending_manual_review";

  if (pending) {
    if (
      labels.requirementStatus !== pendingValue ||
      labels.missingTargetedTestEvidence !== pendingValue ||
      labels.scopeCreep !== pendingValue
    ) {
      throw new Error(`External PR pilot case ${testCase.id} pending labels must remain pending_manual_review.`);
    }
  } else {
    requiredEnum(labels.requirementStatus, REQUIREMENT_STATUSES, "requirementStatus");
    if (typeof labels.missingTargetedTestEvidence !== "boolean") {
      throw new Error(`External PR pilot case ${testCase.id} reviewed missingTargetedTestEvidence must be boolean.`);
    }
    if (typeof labels.scopeCreep !== "boolean") {
      throw new Error(`External PR pilot case ${testCase.id} reviewed scopeCreep must be boolean.`);
    }
  }

  if (!Array.isArray(labels.topFilesReviewerShouldInspect)) {
    throw new Error(`External PR pilot case ${testCase.id} manual labels must include first files to inspect.`);
  }

  if (!pending && labels.topFilesReviewerShouldInspect.length === 0) {
    throw new Error(`External PR pilot case ${testCase.id} reviewed labels must include at least one first inspection file.`);
  }

  labels.topFilesReviewerShouldInspect.forEach((filePath) => validateTopFile(filePath));
  boundedText(labels.notes, "notes", 10, 240);
}

function parseTopFiles(value) {
  if (typeof value !== "string") {
    throw new Error("--top-files must be a comma-separated list of bounded relative paths.");
  }

  if (value.trim() === "") {
    throw new Error("--top-files must include at least one first inspection file for reviewed labels.");
  }

  const paths = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (paths.length > 6) {
    throw new Error("--top-files must contain at most 6 paths.");
  }

  paths.forEach((filePath) => validateTopFile(filePath));
  return paths;
}

function validateTopFile(filePath) {
  boundedText(filePath, "top file path", 1, 180);

  if (
    filePath.startsWith("/") ||
    filePath.includes("..") ||
    /^https?:\/\//i.test(filePath) ||
    /[\r\n]/.test(filePath)
  ) {
    throw new Error("Top files must be bounded relative repository paths.");
  }
}

function assertNoForbiddenReportInputKeys(value, caseId, path = "reportInput") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenReportInputKeys(item, caseId, `${path}[${index}]`));
    return;
  }

  if (!isRecord(value)) return;

  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_REPORT_INPUT_KEYS.has(key)) {
      throw new Error(`External PR pilot case ${caseId} leaked manual/oracle key ${path}.${key} into reportInput.`);
    }

    assertNoForbiddenReportInputKeys(nested, caseId, `${path}.${key}`);
  }
}

function assertNoPrivateOrRawPayloads(value, caseId, path = "case") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPrivateOrRawPayloads(item, caseId, `${path}[${index}]`));
    return;
  }

  if (typeof value === "string") {
    if (value.includes("\n")) {
      throw new Error(`External PR pilot case ${caseId} contains multiline raw payload at ${path}.`);
    }

    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(value)) {
        throw new Error(`External PR pilot case ${caseId} contains private or secret-looking value at ${path}.`);
      }
    }
    return;
  }

  if (!isRecord(value)) return;

  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`External PR pilot case ${caseId} contains forbidden private/raw field ${path}.${key}.`);
    }

    assertNoPrivateOrRawPayloads(nested, caseId, `${path}.${key}`);
  }
}

function writeValidatedFixture(filePath, fixture, writeFile) {
  const validated = validateFixture(fixture);
  writeFile(filePath, `${JSON.stringify(validated, null, 2)}\n`);
}

function loadFixture(filePath, readFile) {
  return JSON.parse(readFile(filePath, "utf8"));
}

function parseOptions(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];

    if (!item.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${item}`);
    }

    const key = item.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      options[key] = "true";
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return options;
}

function requiredEnum(value, allowed, label) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}.`);
  }

  return value;
}

function yesNoToBoolean(value) {
  return value === "yes";
}

function boundedText(value, label, minLength, maxLength) {
  if (typeof value !== "string" || value.length < minLength || value.length > maxLength || value.includes("\n")) {
    throw new Error(`${label} must be one bounded line of text.`);
  }

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(value)) {
      throw new Error(`${label} contains a private or secret-looking value.`);
    }
  }

  return value;
}

function usage() {
  return {
    privacy: "external-pr-pilot-label-summary-only",
    commands: [
      "summary",
      "show --case-id external-pr-pilot-clean-nextjs-95403",
      "record-labels --case-id external-pr-pilot-clean-nextjs-95403 --requirement-status met --missing-targeted-test-evidence no --scope-creep no --top-files \"packages/next/src/file.ts,packages/next/src/file.test.ts\" --notes \"Reviewer confirmed bounded first-inspection labels.\""
    ]
  };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function structuredCloneCompat(value) {
  return JSON.parse(JSON.stringify(value));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = runExternalPrPilotLabelsCli(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      privacy: "external-pr-pilot-label-summary-only",
      error: error instanceof Error ? error.message : "External PR pilot label command failed."
    }));
    process.exit(1);
  }
}
