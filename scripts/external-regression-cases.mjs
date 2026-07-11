import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const regressionPath = join(root, "eval/external-regression-cases.json");
const matrixPath = join(root, "eval/fixtures/evidence-status-matrix.json");
const linkedIssueMatrixPath = join(root, "eval/fixtures/linked-issue-reference-matrix.json");

const requiredRegressionIds = [
  "ext-001",
  "ext-005",
  "ext-008",
  "ext-012",
  "ext-014",
  "ext-007",
  "ext-016",
  "ext-003",
  "blind-008",
  "blind-010"
];
const forbiddenProductLogicStrings = [
  "ext-001",
  "ext-005",
  "ext-007",
  "ext-008",
  "ext-012",
  "ext-014",
  "ext-016",
  "blind-008",
  "blind-010",
  "github.com/vercel/next.js/pull/94942",
  "github.com/pallets/flask/pull/6072",
  "github.com/pandas-dev/pandas/pull/63908",
  "github.com/electron/electron/pull/52248"
];

const matrixExpectations = new Map([
  ["ci-build-test-success", "passed"],
  ["static-only-passed-checks", "unknown"],
  ["lint-typecheck-only", "unknown"],
  ["workflow-tests-failure", "failed"],
  ["build-and-test-workflow-failure", "failed"],
  ["generic-build-and-test-workflow-failure-with-passed-subjobs", "failed"],
  ["docs-readthedocs-only", "unknown"],
  ["deploy-preview-only", "unknown"],
  ["stats-cancelled-only", "unknown"],
  ["security-check-only", "unknown"],
  ["self-reported-tests-only", "unknown"],
  ["changed-test-file-only", "unknown"],
  ["changed-test-file-plus-self-report", "unknown"],
  ["mixed-relevant-failure-and-success", "failed"],
  ["stats-cancelled-plus-build-and-test-success", "passed"],
  ["codecov-project-failure-only", "unknown"],
  ["codecov-failure-plus-unit-tests-passed", "passed"],
  ["changelog-cancelled-only", "unknown"],
  ["changelog-cancelled-plus-unit-tests-passed", "passed"],
  ["optional-failed-workflow-plus-unit-tests-passed", "passed"],
  ["real-unit-test-failure-with-codecov-docs-failure", "failed"],
  ["real-build-failure-with-changelog-cancelled", "failed"],
  ["provider-only-failed-status", "unknown"],
  ["provider-tests-failure-summary", "failed"],
  ["metadata-timeout-plus-known-failure", "failed"],
  ["python-tox-workflow-failure", "failed"],
  ["metadata-timeout-with-no-known-execution", "unknown"]
]);
const linkedIssueExpectations = new Map([
  ["placeholder-only-ignored", []],
  ["placeholder-plus-real-prefers-real", ["acme/app#94890"]],
  ["template-comment-placeholder-ignored", ["acme/app#22242"]],
  ["ambiguous-real-refs-remain-multiple", ["acme/app#124", "acme/app#125", "owner/other#126"]]
]);

function main() {
  const errors = [
    ...validateRegressionMetadata(),
    ...validateMatrixMetadata(),
    ...validateLinkedIssueMatrixMetadata(),
    ...validateResultArtifactReadinessMetadata(),
    ...scanProductLogicForHardcoding()
  ];

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("External regression metadata verified.");
  console.log(`Regression cases: ${requiredRegressionIds.join(", ")}`);
  console.log(`Evidence matrix cases: ${Array.from(matrixExpectations.keys()).length}`);
  console.log("Product logic hardcoding scan: passed");
}

function validateRegressionMetadata() {
  const errors = [];
  const fixture = readJson(regressionPath);

  if (fixture.privacy !== "external-regression-cases-summary-only") {
    errors.push("external-regression-cases privacy must remain summary-only.");
  }
  if (fixture.status !== "regression_metadata_needs_human_labeling") {
    errors.push("external-regression-cases status must remain regression_metadata_needs_human_labeling.");
  }
  if (!Array.isArray(fixture.cases)) {
    errors.push("external-regression-cases cases must be an array.");
    return errors;
  }
  if (!Array.isArray(fixture.executableAssertions)) {
    errors.push("external-regression-cases executableAssertions must be an array.");
  }

  const byId = new Map(fixture.cases.map((testCase) => [testCase.id, testCase]));
  const executableCaseIds = new Set((fixture.executableAssertions ?? []).map((assertion) => assertion.caseId));
  for (const id of requiredRegressionIds) {
    if (!byId.has(id)) {
      errors.push(`external-regression-cases missing ${id}.`);
    }
    if (!executableCaseIds.has(id)) {
      errors.push(`external-regression-cases missing executable assertion for ${id}.`);
    }
  }

  for (const testCase of fixture.cases) {
    if (testCase.manualLabelStatus !== "not_labeled") {
      errors.push(`${testCase.id} must not mark manual labels complete.`);
    }
    if (!Array.isArray(testCase.regressionInvariants) || testCase.regressionInvariants.length === 0) {
      errors.push(`${testCase.id} must declare regressionInvariants.`);
    }
  }

  const ext001 = byId.get("ext-001");
  if (ext001?.observedReportSummary?.testBuildStatus !== "passed") {
    errors.push("ext-001-like public Actions metadata must remain passed in regression metadata.");
  }

  const ext005 = byId.get("ext-005");
  if (ext005?.observedReportSummary?.testBuildStatus !== "failed" || ext005?.observedReportSummary?.priority !== "blocker") {
    errors.push("ext-005-like failed test/build evidence must remain failed/blocker in regression metadata.");
  }

  const ext008 = byId.get("ext-008");
  if (ext008?.observedReportSummary?.analysisStatus !== "completed" || ext008?.observedReportSummary?.evidenceRefsCapped !== true) {
    errors.push("ext-008-like evidenceRefs cap regression must remain completed and capped.");
  }

  for (const id of ["ext-012", "ext-014"]) {
    const testCase = byId.get(id);
    if (testCase?.observedReportSummary?.testBuildStatus !== "unknown") {
      errors.push(`${id}-like self-reported tests without execution evidence must remain unknown.`);
    }
  }

  const ext007 = byId.get("ext-007");
  if (!ext007?.regressionInvariants?.some((item) => /Build&Test failure/i.test(item))) {
    errors.push("ext-007 must preserve the invariant that workflow-level Build&Test failure cannot be passed.");
  }

  const ext016 = byId.get("ext-016");
  if (!ext016?.regressionInvariants?.some((item) => /Tests workflow failure/i.test(item))) {
    errors.push("ext-016 must preserve the invariant that known Flask Tests workflow failure cannot be unknown.");
  }

  const ext003 = byId.get("ext-003");
  if (!ext003?.regressionInvariants?.some((item) => /ambiguous/i.test(item))) {
    errors.push("ext-003 must preserve the invariant that ambiguous issue refs cannot produce confident PR-body mapping.");
  }

  const blind008 = byId.get("blind-008");
  if (!blind008?.regressionInvariants?.some((item) => /failed matrix/i.test(item))) {
    errors.push("blind-008 must preserve the invariant that failed matrix jobs cannot be summarized as passed.");
  }

  const blind010 = byId.get("blind-010");
  if (!blind010?.regressionInvariants?.some((item) => /missing targeted proof/i.test(item))) {
    errors.push("blind-010 must preserve the invariant that native crash fixes without tests surface missing targeted proof.");
  }

  for (const assertion of fixture.executableAssertions ?? []) {
    if (!requiredRegressionIds.includes(assertion.caseId)) {
      errors.push(`executable assertion ${assertion.id ?? "unknown"} references unknown case ${assertion.caseId}.`);
    }
    if ((!assertion.input && !assertion.inputFactory) || !assertion.expected) {
      errors.push(`executable assertion ${assertion.id ?? assertion.caseId} must include input or inputFactory and expected.`);
    }
  }

  const serialized = JSON.stringify(fixture);
  for (const forbidden of ["sk-", "ghp_", "github_pat_", "BEGIN PRIVATE KEY", "rawPrompt", "fullLog", "rawDiff"]) {
    if (serialized.includes(forbidden)) {
      errors.push(`external-regression-cases must not contain ${forbidden}.`);
    }
  }

  return errors;
}

function validateLinkedIssueMatrixMetadata() {
  const errors = [];
  const fixture = readJson(linkedIssueMatrixPath);

  if (fixture.privacy !== "synthetic-linked-issue-reference-matrix-no-private-data") {
    errors.push("linked-issue-reference-matrix privacy must remain synthetic and private-data-free.");
  }
  if (fixture.status !== "synthetic_regression_fixture") {
    errors.push("linked-issue-reference-matrix status must remain synthetic_regression_fixture.");
  }
  if (!Array.isArray(fixture.cases)) {
    errors.push("linked-issue-reference-matrix cases must be an array.");
    return errors;
  }

  const byId = new Map(fixture.cases.map((testCase) => [testCase.id, testCase]));
  for (const [id, expectedRefs] of linkedIssueExpectations) {
    const testCase = byId.get(id);
    if (!testCase) {
      errors.push(`linked-issue-reference-matrix missing ${id}.`);
      continue;
    }
    if (JSON.stringify(testCase.expectedRefs ?? []) !== JSON.stringify(expectedRefs)) {
      errors.push(`${id} expectedRefs must remain ${expectedRefs.join(",") || "empty"}.`);
    }
  }

  const serialized = JSON.stringify(fixture);
  for (const forbidden of ["github.com/", "sk-", "ghp_", "github_pat_", "BEGIN PRIVATE KEY"]) {
    if (serialized.includes(forbidden)) {
      errors.push(`linked-issue-reference-matrix must not contain ${forbidden}.`);
    }
  }

  return errors;
}

function validateResultArtifactReadinessMetadata() {
  const errors = [];
  const expectedArtifacts = [
    ["eval/external-pr-first-pilot-results.json", "eval/external-pr-first-pilot-results-rerun.json"],
    ["eval/external-pr-holdout-results.json", "eval/external-pr-holdout-results-rerun.json"],
    ["eval/external-pr-first-pilot-results-rerun.json", null],
    ["eval/external-pr-holdout-results-rerun.json", null]
  ];

  for (const [relativePath, supersededBy] of expectedArtifacts) {
    const artifact = readJson(join(root, relativePath));

    if (artifact.readinessEvidence !== false) {
      errors.push(`${relativePath} must set readinessEvidence to false until human labels are complete.`);
    }

    if (supersededBy && artifact.supersededBy !== supersededBy) {
      errors.push(`${relativePath} must be marked supersededBy ${supersededBy}.`);
    }
  }

  return errors;
}

function validateMatrixMetadata() {
  const errors = [];
  const fixture = readJson(matrixPath);

  if (fixture.privacy !== "synthetic-evidence-status-matrix-no-private-data") {
    errors.push("evidence-status-matrix privacy must remain synthetic and private-data-free.");
  }
  if (fixture.status !== "synthetic_regression_fixture") {
    errors.push("evidence-status-matrix status must remain synthetic_regression_fixture.");
  }
  if (!Array.isArray(fixture.cases)) {
    errors.push("evidence-status-matrix cases must be an array.");
    return errors;
  }

  const byId = new Map(fixture.cases.map((testCase) => [testCase.id, testCase]));
  for (const [id, expectedStatus] of matrixExpectations) {
    const testCase = byId.get(id);
    if (!testCase) {
      errors.push(`evidence-status-matrix missing ${id}.`);
      continue;
    }
    if (testCase.expected?.testBuildStatus !== expectedStatus) {
      errors.push(`${id} expected testBuildStatus must be ${expectedStatus}.`);
    }
  }

  const timeoutFailure = byId.get("metadata-timeout-plus-known-failure");
  if (!Array.isArray(timeoutFailure?.expected?.mustNotBe) || !timeoutFailure.expected.mustNotBe.includes("passed")) {
    errors.push("metadata-timeout-plus-known-failure must explicitly forbid passed.");
  }

  const serialized = JSON.stringify(fixture);
  for (const forbidden of ["github.com/", "ext-001", "sk-", "ghp_", "github_pat_", "BEGIN PRIVATE KEY"]) {
    if (serialized.includes(forbidden)) {
      errors.push(`evidence-status-matrix must not contain ${forbidden}.`);
    }
  }

  return errors;
}

function scanProductLogicForHardcoding() {
  const errors = [];
  const srcRoot = join(root, "src");

  if (!existsSync(srcRoot)) {
    errors.push("src directory is missing.");
    return errors;
  }

  for (const filePath of walk(srcRoot)) {
    if (!/\.(ts|tsx)$/.test(filePath) || /\.test\.(ts|tsx)$/.test(filePath)) {
      continue;
    }

    const content = readFileSync(filePath, "utf8");
    for (const forbidden of forbiddenProductLogicStrings) {
      if (content.includes(forbidden)) {
        errors.push(`Product logic hardcodes ${forbidden} in ${relative(root, filePath)}.`);
      }
    }
  }

  return errors;
}

function walk(dir) {
  const files = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);

    if (stat.isDirectory()) {
      files.push(...walk(path));
      continue;
    }

    files.push(path);
  }

  return files;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

main();
