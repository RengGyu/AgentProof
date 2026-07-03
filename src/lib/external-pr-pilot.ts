import { readFileSync } from "node:fs";
import { join } from "node:path";
import { containsSecretPattern } from "./redact";

export const EXTERNAL_PR_PILOT_FIXTURE_PATH = join(
  process.cwd(),
  "eval/fixtures/external-pr-pilot.v1.json"
);

export const EXTERNAL_PR_PILOT_REQUIRED_CATEGORIES = [
  "clean_pr",
  "missing_tests",
  "scope_creep",
  "failed_ci",
  "vague_task_or_visual_gap"
] as const;

export type ExternalPrPilotCategory = (typeof EXTERNAL_PR_PILOT_REQUIRED_CATEGORIES)[number];
export type ManualReviewValue = "pending_manual_review" | boolean;
export type RequirementManualStatus = "pending_manual_review" | "met" | "partial" | "missing" | "unclear";

export interface ExternalPrPilotFixture {
  schemaVersion: "external-pr-pilot.v1";
  privacy: "external-pr-pilot-metadata-only";
  createdAt: string;
  purpose: string;
  scaleRule: string;
  cases: ExternalPrPilotCase[];
}

export interface ExternalPrPilotCase {
  id: string;
  category: ExternalPrPilotCategory;
  source: {
    repository: string;
    pullRequestNumber: number;
    url: string;
    observedAt: string;
  };
  reportInput: {
    pullRequestUrl: string;
    repository: string;
    pullRequestNumber: number;
    title: string;
    publicTaskContext: string;
    linkedIssueRefs: string[];
    knownPublicSignals: {
      changedFiles: string[];
      checkSummary: string;
    };
  };
  manualLabels: {
    labelStatus: "pending_reviewer_confirmation" | "reviewed";
    requirementStatus: RequirementManualStatus;
    missingTargetedTestEvidence: ManualReviewValue;
    scopeCreep: ManualReviewValue;
    topFilesReviewerShouldInspect: string[];
    notes: string;
  };
  limitations: string[];
}

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

const FORBIDDEN_RAW_PAYLOAD_KEYS = new Set([
  "token",
  "secret",
  "authorization",
  "rawBody",
  "rawDiff",
  "patch",
  "diff",
  "rawLog",
  "log",
  "logs"
]);

export function loadExternalPrPilotFixture(
  filePath = EXTERNAL_PR_PILOT_FIXTURE_PATH
): ExternalPrPilotFixture {
  const fixture = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  return validateExternalPrPilotFixture(fixture);
}

export function validateExternalPrPilotFixture(fixture: unknown): ExternalPrPilotFixture {
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

  if (typeof fixture.scaleRule !== "string" || !/do not expand to 20/i.test(fixture.scaleRule)) {
    throw new Error("External PR pilot fixture must document the 5-case-before-20 scale rule.");
  }

  const categories = new Set<string>();
  const ids = new Set<string>();
  const urls = new Set<string>();

  for (const testCase of fixture.cases) {
    validateExternalPrPilotCase(testCase);
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

  for (const category of EXTERNAL_PR_PILOT_REQUIRED_CATEGORIES) {
    if (!categories.has(category)) {
      throw new Error(`External PR pilot fixture is missing category ${category}.`);
    }
  }

  return fixture as unknown as ExternalPrPilotFixture;
}

function validateExternalPrPilotCase(testCase: unknown): asserts testCase is ExternalPrPilotCase {
  if (!isRecord(testCase)) {
    throw new Error("External PR pilot case must be an object.");
  }

  if (typeof testCase.id !== "string" || !testCase.id.startsWith("external-pr-pilot-")) {
    throw new Error("External PR pilot case id must use the external-pr-pilot prefix.");
  }

  if (!EXTERNAL_PR_PILOT_REQUIRED_CATEGORIES.includes(testCase.category as ExternalPrPilotCategory)) {
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
  assertNoRawOrSecretPayloads(testCase, testCase.id);

  if (!Array.isArray(testCase.manualLabels.topFilesReviewerShouldInspect)) {
    throw new Error(`External PR pilot case ${testCase.id} manual labels must include first files to inspect.`);
  }

  if (!Array.isArray(testCase.limitations) || testCase.limitations.length === 0) {
    throw new Error(`External PR pilot case ${testCase.id} must state limitations.`);
  }

  if (testCase.manualLabels.labelStatus !== "pending_reviewer_confirmation" && testCase.manualLabels.labelStatus !== "reviewed") {
    throw new Error(`External PR pilot case ${testCase.id} has an unsupported labelStatus.`);
  }
}

function assertNoForbiddenReportInputKeys(value: unknown, caseId: string, path = "reportInput"): void {
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

function assertNoRawOrSecretPayloads(value: unknown, caseId: string, path = "case"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoRawOrSecretPayloads(item, caseId, `${path}[${index}]`));
    return;
  }

  if (typeof value === "string") {
    if (value.includes("\n")) {
      throw new Error(`External PR pilot case ${caseId} contains multiline raw payload at ${path}.`);
    }

    if (containsSecretPattern(value)) {
      throw new Error(`External PR pilot case ${caseId} contains a secret-looking value at ${path}.`);
    }
    return;
  }

  if (!isRecord(value)) return;

  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_RAW_PAYLOAD_KEYS.has(key)) {
      throw new Error(`External PR pilot case ${caseId} contains forbidden raw/private field ${path}.${key}.`);
    }

    assertNoRawOrSecretPayloads(nested, caseId, `${path}.${key}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
