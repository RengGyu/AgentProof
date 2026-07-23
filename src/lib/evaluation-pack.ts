import { validateVerificationReport } from "./report-validation";
import { hasPassingEvidenceStatusPrefix, isExecutionEvidenceItemSignal, statusFromExecutionEvidenceSummary } from "./evidence-status";
import { containsSecretPattern, redactSecrets } from "./redact";
import type {
  ChangedFile,
  EvidenceKind,
  PullRequestInput,
  VerificationReport
} from "./types";

export type EvaluationOracleStrength = "strong" | "moderate" | "weak";
export type EvaluationOracleType =
  | "test_transition"
  | "ci_transition"
  | "bug_benchmark"
  | "human_review_signal"
  | "metadata_proxy";

export type EvaluationMetricStatus = "pass" | "fail" | "warning" | "unknown";

export interface EvaluationDataSource {
  id: string;
  name: string;
  url: string;
  licenseNote: string;
  oracleType: EvaluationOracleType;
  oracleStrength: EvaluationOracleStrength;
  scoredInMvp: boolean;
  agentProofUse: string;
  caveat: string;
}

export interface EvaluationCase {
  id: string;
  source: Pick<EvaluationDataSource, "id" | "name" | "url" | "licenseNote" | "oracleType" | "oracleStrength">;
  input: PullRequestInput;
  oracle: {
    description: string;
    hiddenLabels: string[];
    hiddenValues: string[];
    deniedReportTerms: string[];
    visibleImplementationFiles: string[];
    visibleChangedFiles: string[];
    visibleTestFiles: string[];
    failToPassTests: string[];
    passToPassTests: string[];
  };
}

export interface EvaluationMetric {
  id: string;
  label: string;
  status: EvaluationMetricStatus;
  detail: string;
}

export interface EvaluationResult {
  caseId: string;
  dataset: string;
  passed: boolean;
  calibrated: boolean;
  metrics: EvaluationMetric[];
  learningActions: string[];
}

export type EvaluationLearningArea =
  | "requirement_calibration"
  | "missing_test_detection"
  | "evidence_indexing"
  | "oracle_boundary"
  | "privacy"
  | "schema";

export interface EvaluationLearningTask {
  id: string;
  area: EvaluationLearningArea;
  priority: "blocker" | "high" | "medium" | "low";
  metricIds: string[];
  caseIds: string[];
  recommendation: string;
  acceptanceCriteria: string[];
  sampleDetails: string[];
}

export interface EvaluationMetricRollup {
  id: string;
  label: string;
  status: EvaluationMetricStatus;
  count: number;
  caseIds: string[];
  sampleDetails: string[];
}

export interface EvaluationRunSummary {
  caseCount: number;
  passedCount: number;
  failedCount: number;
  calibratedCount: number;
  uncalibratedCount: number;
  statusCounts: Record<EvaluationMetricStatus, number>;
  metricRollups: EvaluationMetricRollup[];
  learningTasks: EvaluationLearningTask[];
  learningActions: string[];
}

const NO_BLOCKING_ACTION = "No blocking harness failure; inspect warnings and add more real benchmark cases.";

export const EVALUATION_DATA_SOURCES: EvaluationDataSource[] = [
  {
    id: "swebench-verified",
    name: "SWE-bench Verified",
    url: "https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified",
    licenseNote: "Public Hugging Face dataset; verify current dataset card before redistribution.",
    oracleType: "test_transition",
    oracleStrength: "strong",
    scoredInMvp: true,
    agentProofUse: "Issue/task coverage, changed-file evidence, visible test patch evidence, and false-verified calibration.",
    caveat: "Treat pass/fail as benchmark-resolved, not full semantic correctness."
  },
  {
    id: "bugswarm",
    name: "BugSwarm",
    url: "https://www.bugswarm.org/",
    licenseNote: "Project code is BSD-3-Clause; artifact metadata and Docker images should be checked before redistribution.",
    oracleType: "ci_transition",
    oracleStrength: "strong",
    scoredInMvp: false,
    agentProofUse: "CI and log evidence parsing once the harness can ingest build logs safely.",
    caveat: "Fail/pass CI proves build behavior, not full issue satisfaction."
  },
  {
    id: "defects4j",
    name: "Defects4J",
    url: "https://github.com/rjust/defects4j",
    licenseNote: "MIT.",
    oracleType: "bug_benchmark",
    oracleStrength: "strong",
    scoredInMvp: false,
    agentProofUse: "Regression-test-backed bug/fix cases for deterministic evidence checks.",
    caveat: "Java-only and not a PR-review workflow."
  },
  {
    id: "bugsinpy",
    name: "BugsInPy",
    url: "https://github.com/soarsmu/BugsInPy",
    licenseNote: "Verify repository license before redistributing normalized fixtures.",
    oracleType: "bug_benchmark",
    oracleStrength: "strong",
    scoredInMvp: false,
    agentProofUse: "Python bug/fix cases for deterministic test evidence checks.",
    caveat: "Useful as a bug benchmark, weaker as issue-to-PR review evidence."
  },
  {
    id: "aidev",
    name: "AIDev",
    url: "https://huggingface.co/datasets/hao-li/AIDev",
    licenseNote: "Dataset card claims public access; license and privacy fields must be audited before use.",
    oracleType: "metadata_proxy",
    oracleStrength: "weak",
    scoredInMvp: false,
    agentProofUse: "Exploratory analysis of agent-authored PR patterns, rejection reasons, and review dynamics.",
    caveat: "Do not score correctness from merge/reject or review state alone."
  }
];

interface SweBenchRow {
  repo?: unknown;
  instance_id?: unknown;
  base_commit?: unknown;
  patch?: unknown;
  test_patch?: unknown;
  problem_statement?: unknown;
  hints_text?: unknown;
  FAIL_TO_PASS?: unknown;
  PASS_TO_PASS?: unknown;
  difficulty?: unknown;
}

const RAW_DATASET_ROW_KEYS = new Set([
  "repo",
  "base_commit",
  "patch",
  "test_patch",
  "problem_statement",
  "hints_text",
  "FAIL_TO_PASS",
  "PASS_TO_PASS",
  "difficulty"
]);

export function sweBenchRowToEvaluationCase(row: unknown): EvaluationCase {
  if (!isRecord(row)) {
    throw new Error("SWE-bench row must be an object.");
  }

  const value = row as SweBenchRow;
  const repo = stringValue(value.repo, "unknown/repo");
  const instanceId = stringValue(value.instance_id, `swebench_${hashText(JSON.stringify(row)).slice(0, 10)}`);
  const problemStatement = stringValue(value.problem_statement, "");
  const hintsText = stringValue(value.hints_text, "");
  const baseCommit = stringValue(value.base_commit, "");
  const implementationFiles = parseUnifiedDiff(stringValue(value.patch, ""));
  const testFiles = parseUnifiedDiff(stringValue(value.test_patch, ""));
  const changedFiles = mergeChangedFiles([...implementationFiles, ...testFiles]);
  const failToPassTests = normalizeStringList(value.FAIL_TO_PASS);
  const passToPassTests = normalizeStringList(value.PASS_TO_PASS);
  const visibleText = [
    problemStatement,
    hintsText,
    ...changedFiles.map((file) => `${file.path}\n${file.patch ?? ""}`)
  ].join("\n");
  const hiddenValues = Array.from(new Set([...failToPassTests, ...passToPassTests]))
    .filter((label) => label.length > 4 && !visibleText.includes(label));
  const visibleImplementationFiles = changedFiles
    .filter((file) => !isLikelyTestPath(file.path))
    .map((file) => file.path);
  const visibleTestFiles = changedFiles.filter((file) => isLikelyTestPath(file.path)).map((file) => file.path);

  return {
    id: instanceId,
    source: {
      id: "swebench-verified",
      name: "SWE-bench Verified",
      url: "https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified",
      licenseNote: "Public Hugging Face dataset; verify current dataset card before redistribution.",
      oracleType: "test_transition",
      oracleStrength: "strong"
    },
    input: {
      title: `Issue-linked PR ${instanceId}`,
      url: `https://github.com/${repo}`,
      description: hintsText
        ? `PR discussion context: ${redactSecrets(hintsText)}`
        : "PR discussion context was not provided; evaluation uses the issue text and visible patch metadata only.",
      baseBranch: baseCommit ? `base:${baseCommit.slice(0, 12)}` : undefined,
      headBranch: "candidate-fix",
      taskText: redactSecrets(problemStatement),
      changedFiles,
      checks: [],
      logs: [],
      limitations: [
        "No live CI log was provided; passing behavior must stay unclear unless visible evidence proves it."
      ]
    },
    oracle: {
      description: "SWE-bench provides issue text, a developer patch, a test patch, and fail-to-pass/pass-to-pass test labels.",
      hiddenLabels: ["FAIL_TO_PASS", "PASS_TO_PASS"],
      hiddenValues,
      deniedReportTerms: [
        "SWE-bench",
        "SWEbench",
        "benchmark dataset",
        "benchmark oracle",
        "gold-patch",
        "gold patch",
        "fail-to-pass",
        "pass-to-pass",
        "fail to pass",
        "pass to pass",
        "FAIL_TO_PASS",
        "PASS_TO_PASS",
        "princeton-nlp/SWE-bench",
        "huggingface.co/datasets/princeton-nlp/SWE-bench_Verified"
      ],
      visibleImplementationFiles,
      visibleChangedFiles: changedFiles.map((file) => file.path),
      visibleTestFiles,
      failToPassTests,
      passToPassTests
    }
  };
}

export function evaluationCaseFromRecord(record: unknown): EvaluationCase {
  if (isNormalizedEvaluationCase(record)) {
    return record;
  }

  return sweBenchRowToEvaluationCase(record);
}

export function isNormalizedEvaluationCase(value: unknown): value is EvaluationCase {
  if (!isRecord(value) || !isRecord(value.source) || !isRecord(value.input) || !isRecord(value.oracle)) {
    return false;
  }

  if (Object.keys(value).some((key) => RAW_DATASET_ROW_KEYS.has(key))) {
    return false;
  }

  return typeof value.id === "string" &&
    typeof value.source.id === "string" &&
    Array.isArray(value.input.changedFiles) &&
    Array.isArray(value.oracle.hiddenLabels) &&
    Array.isArray(value.oracle.hiddenValues) &&
    Array.isArray(value.oracle.deniedReportTerms) &&
    Array.isArray(value.oracle.visibleChangedFiles);
}

export function evaluateReportAgainstCase(report: VerificationReport, testCase: EvaluationCase): EvaluationResult {
  const metrics: EvaluationMetric[] = [
    schemaMetric(report),
    evidenceKindsMetric(report, ["task"]),
    changedFileEvidenceMetric(report, testCase.oracle.visibleChangedFiles),
    testFileEvidenceMetric(report, testCase.oracle.visibleTestFiles),
    executionUncertaintyMetric(report, testCase),
    requirementCalibrationMetric(report, testCase),
    missingTestCalibrationMetric(report, testCase),
    inputOracleBoundaryMetric(testCase),
    noOracleLeakageMetric(report, testCase),
    noUnsupportedVerifiedMetric(report),
    privacyPatternMetric(report)
  ];
  const failedMetrics = metrics.filter((metric) => metric.status === "fail");
  const nonPassMetrics = metrics.filter((metric) => metric.status !== "pass");

  return {
    caseId: testCase.id,
    dataset: testCase.source.id,
    passed: failedMetrics.length === 0,
    calibrated: nonPassMetrics.length === 0,
    metrics,
    learningActions: summarizeEvaluationLearning(metrics)
  };
}

export function summarizeEvaluationResults(results: EvaluationResult[]): EvaluationRunSummary {
  const statusCounts: Record<EvaluationMetricStatus, number> = {
    pass: 0,
    fail: 0,
    warning: 0,
    unknown: 0
  };
  const rollups = new Map<string, EvaluationMetricRollup>();
  const actionSet = new Set<string>();

  for (const result of results) {
    for (const metric of result.metrics) {
      statusCounts[metric.status] += 1;

      if (metric.status === "pass") {
        continue;
      }

      const key = `${metric.id}:${metric.status}`;
      const existing = rollups.get(key);

      if (existing) {
        existing.count += 1;
        existing.caseIds.push(result.caseId);
        if (existing.sampleDetails.length < 3) {
          existing.sampleDetails.push(metric.detail);
        }
      } else {
        rollups.set(key, {
          id: metric.id,
          label: metric.label,
          status: metric.status,
          count: 1,
          caseIds: [result.caseId],
          sampleDetails: [metric.detail]
        });
      }
    }

    for (const action of result.learningActions) {
      if (action !== NO_BLOCKING_ACTION) {
        actionSet.add(action);
      }
    }
  }

  if (statusCounts.warning > 0) {
    actionSet.add("Review warning metrics before treating the benchmark run as calibrated.");
  }

  if (statusCounts.unknown > 0) {
    actionSet.add("Resolve unknown metrics before treating the benchmark run as fully calibrated.");
  }

  if (results.length === 0) {
    actionSet.add("Fetch or define evaluation cases before drawing verifier-quality conclusions.");
  }

  const metricRollups = Array.from(rollups.values()).sort((left, right) =>
    statusRank(left.status) - statusRank(right.status) ||
    right.count - left.count ||
    left.id.localeCompare(right.id)
  );

  if (results.length > 0 && metricRollups.length === 0) {
    actionSet.add(NO_BLOCKING_ACTION);
  }

  return {
    caseCount: results.length,
    passedCount: results.filter((result) => result.passed).length,
    failedCount: results.filter((result) => !result.passed).length,
    calibratedCount: results.filter((result) => result.calibrated).length,
    uncalibratedCount: results.filter((result) => !result.calibrated).length,
    statusCounts,
    metricRollups,
    learningTasks: buildEvaluationLearningTasks(metricRollups),
    learningActions: Array.from(actionSet)
  };
}

export function buildEvaluationLearningTasks(rollups: EvaluationMetricRollup[]): EvaluationLearningTask[] {
  return rollups.map((rollup) => {
    const area = learningAreaForMetric(rollup.id);
    const priority = priorityForRollup(rollup);

    return {
      id: `${area}:${rollup.id}:${rollup.status}`,
      area,
      priority,
      metricIds: [rollup.id],
      caseIds: rollup.caseIds,
      recommendation: recommendationForRollup(rollup),
      acceptanceCriteria: acceptanceCriteriaForRollup(rollup),
      sampleDetails: rollup.sampleDetails
    };
  });
}

export function summarizeEvaluationLearning(metrics: EvaluationMetric[]): string[] {
  const actions: string[] = [];

  if (hasFailed(metrics, "schema_valid")) {
    actions.push("Fix report generation or runtime validation before evaluating quality.");
  }

  if (hasFailed(metrics, "changed_file_evidence")) {
    actions.push("Improve diff-to-evidence indexing so every visible changed file is cited by path.");
  }

  if (hasFailed(metrics, "test_file_evidence")) {
    actions.push("Improve test-file detection before scoring missing-test findings.");
  }

  if (hasFailed(metrics, "oracle_leakage")) {
    actions.push("Remove benchmark labels from report inputs; future outcome labels must only be used after report generation.");
  }

  if (hasFailed(metrics, "input_oracle_boundary")) {
    actions.push("Fix evaluation case normalization before report generation; oracle labels must not enter report inputs.");
  }

  if (hasFailed(metrics, "execution_uncertainty")) {
    actions.push("Lower confidence or require execution evidence before presenting high-coverage benchmark reports.");
  }

  if (hasFailed(metrics, "unsupported_verified")) {
    actions.push("Tighten requirement scoring so visible diff/test patches without passing execution evidence remain partial or unclear.");
  }

  if (hasFailed(metrics, "privacy_patterns")) {
    actions.push("Extend redaction and generated-artifact filters before storing evaluation outputs.");
  }

  if (actions.length === 0) {
    actions.push(NO_BLOCKING_ACTION);
  }

  return actions;
}

function schemaMetric(report: VerificationReport): EvaluationMetric {
  const validation = validateVerificationReport(report, { mode: "full" });

  return {
    id: "schema_valid",
    label: "Report schema and provenance validation",
    status: validation.valid ? "pass" : "fail",
    detail: validation.valid ? "Report passed strict runtime validation." : validation.errors.join(" ")
  };
}

function evidenceKindsMetric(report: VerificationReport, requiredKinds: EvidenceKind[]): EvaluationMetric {
  const presentKinds = new Set(report.evidenceIndex.map((item) => item.kind));
  const missing = requiredKinds.filter((kind) => !presentKinds.has(kind));

  return {
    id: "required_evidence_kinds",
    label: "Required evidence kinds",
    status: missing.length === 0 ? "pass" : "fail",
    detail: missing.length === 0
      ? `Found required evidence kind(s): ${requiredKinds.join(", ")}.`
      : `Missing evidence kind(s): ${missing.join(", ")}.`
  };
}

function changedFileEvidenceMetric(report: VerificationReport, expectedFiles: string[]): EvaluationMetric {
  if (expectedFiles.length === 0) {
    return {
      id: "changed_file_evidence",
      label: "Changed file evidence",
      status: "unknown",
      detail: "No visible changed files were present in the evaluation case."
    };
  }

  const indexedFiles = new Set(
    report.evidenceIndex
      .filter((item) => item.kind === "changed_file" || item.kind === "diff" || item.kind === "test")
      .flatMap((item) => [item.label, item.locator].filter((value): value is string => typeof value === "string"))
  );
  const missingFiles = expectedFiles.filter((path) => !indexedFiles.has(path));

  return {
    id: "changed_file_evidence",
    label: "Changed file evidence",
    status: missingFiles.length === 0 ? "pass" : "fail",
    detail: missingFiles.length === 0
      ? `All ${expectedFiles.length} visible changed file(s) were indexed.`
      : `Missing changed-file evidence for: ${missingFiles.slice(0, 5).join(", ")}.`
  };
}

function testFileEvidenceMetric(report: VerificationReport, expectedTestFiles: string[]): EvaluationMetric {
  if (expectedTestFiles.length === 0) {
    return {
      id: "test_file_evidence",
      label: "Visible test-file evidence",
      status: "pass",
      detail: "No visible test files were expected; missing-test calibration covers the implementation coverage gap."
    };
  }

  const indexedTestFiles = new Set(report.evidenceIndex
    .filter((item) => item.kind === "test")
    .flatMap((item) => [item.label, item.locator].filter((value): value is string => typeof value === "string")));
  const missingFiles = expectedTestFiles.filter((path) => !indexedTestFiles.has(path));

  return {
    id: "test_file_evidence",
    label: "Visible test-file evidence",
    status: missingFiles.length === 0 ? "pass" : "fail",
    detail: missingFiles.length === 0
      ? `All ${expectedTestFiles.length} visible test file(s) were indexed as test evidence.`
      : `Missing test evidence for: ${missingFiles.slice(0, 5).join(", ")}.`
  };
}

function executionUncertaintyMetric(report: VerificationReport, testCase: EvaluationCase): EvaluationMetric {
  if (testCase.source.oracleType !== "test_transition" && testCase.source.oracleType !== "ci_transition") {
    return {
      id: "execution_uncertainty",
      label: "Execution-evidence uncertainty",
      status: "unknown",
      detail: "This case does not provide a test or CI transition oracle."
    };
  }

  const hasExecutionEvidence = hasAnyExecutionEvidence(report);

  if (hasExecutionEvidence) {
    return {
      id: "execution_uncertainty",
      label: "Execution-evidence uncertainty",
      status: "pass",
      detail: "Report contains visible check or log evidence for execution status."
    };
  }

  const tooConfident = report.summary.confidence >= 0.85 || report.summary.evidenceCoverage >= 100;

  return {
    id: "execution_uncertainty",
    label: "Execution-evidence uncertainty",
    status: tooConfident ? "fail" : "pass",
    detail: tooConfident
      ? "Report is too confident even though no visible execution evidence was provided."
      : "Report stays below high-confidence/high-coverage thresholds without visible execution evidence."
  };
}

function requirementCalibrationMetric(report: VerificationReport, testCase: EvaluationCase): EvaluationMetric {
  const metWithoutExecutionRefs = report.requirements.filter((requirement) =>
    requirement.status === "met" && !requirementHasPassingExecutionRef(report, requirement.evidenceRefs)
  );

  if (metWithoutExecutionRefs.length > 0) {
    return {
      id: "requirement_calibration",
      label: "Requirement calibration",
      status: "fail",
      detail: `${metWithoutExecutionRefs.length} met requirement(s) lack passing execution evidence in their evidenceRefs.`
    };
  }

  const hasVisibleImplementationOrTest = testCase.oracle.visibleImplementationFiles.length > 0 ||
    testCase.oracle.visibleTestFiles.length > 0;
  const allWeak = report.requirements.length > 0 &&
    report.requirements.every((requirement) => requirement.status === "missing" || requirement.status === "unclear");

  if (hasVisibleImplementationOrTest && allWeak && !visibleArtifactsPreservedAsExecutionGap(report, testCase)) {
    return {
      id: "requirement_calibration",
      label: "Requirement calibration",
      status: "warning",
      detail: "Visible implementation or test evidence exists, but every requirement is still missing or unclear."
    };
  }

  return {
    id: "requirement_calibration",
    label: "Requirement calibration",
    status: "pass",
    detail: allWeak
      ? "Requirement statuses stay weak, but visible artifacts are preserved as execution-proof gaps."
      : "Requirement statuses stay aligned with visible execution evidence."
  };
}

function visibleArtifactsPreservedAsExecutionGap(report: VerificationReport, testCase: EvaluationCase): boolean {
  if (testCase.oracle.visibleImplementationFiles.length === 0 || testCase.oracle.visibleTestFiles.length === 0) {
    return false;
  }

  const missingTestPaths = new Set(report.testing.missingTests.map((missing) => missing.path));
  const indexedTestPaths = new Set(report.evidenceIndex
    .filter((item) => item.kind === "test")
    .flatMap((item) => [item.label, item.locator].filter((value): value is string => typeof value === "string")));

  return testCase.oracle.visibleImplementationFiles.every((path) => missingTestPaths.has(path)) &&
    testCase.oracle.visibleTestFiles.every((path) => indexedTestPaths.has(path));
}

function missingTestCalibrationMetric(report: VerificationReport, testCase: EvaluationCase): EvaluationMetric {
  const implementationFiles = testCase.oracle.visibleImplementationFiles;

  if (implementationFiles.length === 0) {
    return {
      id: "missing_test_calibration",
      label: "Missing-test calibration",
      status: "unknown",
      detail: "No visible implementation files were present in the evaluation case."
    };
  }

  const missingTestPaths = new Set(report.testing.missingTests.map((missing) => missing.path));
  const implementationFilesWithoutMissingTestSignal = implementationFiles.filter((path) => !missingTestPaths.has(path));
  const hasVisibleTestArtifact = testCase.oracle.visibleTestFiles.length > 0;
  const hasExecutionEvidence = hasAnyExecutionEvidence(report);

  if (!hasVisibleTestArtifact && implementationFilesWithoutMissingTestSignal.length > 0) {
    return {
      id: "missing_test_calibration",
      label: "Missing-test calibration",
      status: "fail",
      detail: `Implementation file(s) lack visible tests but were not flagged: ${implementationFilesWithoutMissingTestSignal.slice(0, 5).join(", ")}.`
    };
  }

  if (hasVisibleTestArtifact && !hasExecutionEvidence && implementationFilesWithoutMissingTestSignal.length > 0) {
    return {
      id: "missing_test_calibration",
      label: "Missing-test calibration",
      status: "fail",
      detail: `Visible test files exist, but no execution evidence was provided and implementation file(s) were not flagged: ${implementationFilesWithoutMissingTestSignal.slice(0, 5).join(", ")}.`
    };
  }

  return {
    id: "missing_test_calibration",
    label: "Missing-test calibration",
    status: "pass",
    detail: hasVisibleTestArtifact
      ? "Visible test artifacts without execution proof are preserved as missing-test evidence."
      : "Implementation files without visible tests are flagged as missing-test evidence."
  };
}

function noOracleLeakageMetric(report: VerificationReport, testCase: EvaluationCase): EvaluationMetric {
  const serialized = JSON.stringify(report);
  const leakedLabels = testCase.oracle.hiddenLabels.filter((label) => serialized.includes(label));
  const leakedValues = testCase.oracle.hiddenValues.filter((value) => serialized.includes(value));
  const deniedTerms = testCase.oracle.deniedReportTerms.filter((term) =>
    serialized.toLowerCase().includes(term.toLowerCase())
  );
  const leaks = [...leakedLabels, ...leakedValues, ...deniedTerms];

  return {
    id: "oracle_leakage",
    label: "Future-label leakage",
    status: leaks.length === 0 ? "pass" : "fail",
    detail: leaks.length === 0
      ? "No benchmark oracle labels, hidden values, or dataset cues were present in the report."
      : `Report leaked ${leaks.length} oracle value(s) or dataset cue(s); exact values are redacted from evaluation output.`
  };
}

function inputOracleBoundaryMetric(testCase: EvaluationCase): EvaluationMetric {
  const serialized = JSON.stringify(testCase.input);
  const leakedLabels = testCase.oracle.hiddenLabels.filter((label) => serialized.includes(label));
  const leakedValues = testCase.oracle.hiddenValues.filter((value) => serialized.includes(value));
  const deniedTerms = testCase.oracle.deniedReportTerms.filter((term) =>
    serialized.toLowerCase().includes(term.toLowerCase())
  );
  const leaks = [...leakedLabels, ...leakedValues, ...deniedTerms];

  return {
    id: "input_oracle_boundary",
    label: "Input oracle boundary",
    status: leaks.length === 0 ? "pass" : "fail",
    detail: leaks.length === 0
      ? "Report input contains no benchmark oracle labels, hidden values, or dataset cues."
      : `Report input leaked ${leaks.length} oracle value(s) or dataset cue(s); exact values are redacted from evaluation output.`
  };
}

function noUnsupportedVerifiedMetric(report: VerificationReport): EvaluationMetric {
  const unsupportedMet = report.requirements.filter((requirement) =>
    requirement.status === "met" && !requirementHasPassingExecutionRef(report, requirement.evidenceRefs)
  );

  return {
    id: "unsupported_verified",
    label: "No unsupported verified requirement",
    status: unsupportedMet.length === 0 ? "pass" : "fail",
    detail: unsupportedMet.length === 0
      ? "No requirement was marked met without passing execution evidence."
      : `${unsupportedMet.length} requirement(s) were marked met without passing execution evidence.`
  };
}

function privacyPatternMetric(report: VerificationReport): EvaluationMetric {
  const serialized = JSON.stringify(report);
  const leaked = containsSecretPattern(serialized);

  return {
    id: "privacy_patterns",
    label: "Secret pattern hygiene",
    status: leaked ? "fail" : "pass",
    detail: leaked
      ? "Report contains a high-risk secret-looking pattern."
      : "No high-risk secret-looking pattern was found in the report."
  };
}

function hasFailed(metrics: EvaluationMetric[], id: string): boolean {
  return metrics.some((metric) => metric.id === id && metric.status === "fail");
}

function hasAnyExecutionEvidence(report: VerificationReport): boolean {
  return report.evidenceIndex.some((item) =>
    (item.kind === "check" || item.kind === "log") &&
    isExecutionEvidenceItemSignal(item.label, statusFromExecutionEvidenceSummary(item.summary), item.locator, item.summary)
  );
}

function requirementHasPassingExecutionRef(report: VerificationReport, evidenceRefs: string[]): boolean {
  const evidenceById = new Map(report.evidenceIndex.map((item) => [item.id, item]));

  return evidenceRefs.some((ref) => {
    const item = evidenceById.get(ref);

    return Boolean(item) &&
      (item?.kind === "check" || item?.kind === "log") &&
      isExecutionEvidenceItemSignal(item.label, statusFromExecutionEvidenceSummary(item.summary), item.locator, item.summary) &&
      hasPassingEvidenceStatusPrefix(item.summary);
  });
}

function learningAreaForMetric(id: string): EvaluationLearningArea {
  if (id === "schema_valid") return "schema";
  if (id === "changed_file_evidence" || id === "test_file_evidence" || id === "required_evidence_kinds") return "evidence_indexing";
  if (id === "oracle_leakage" || id === "input_oracle_boundary") return "oracle_boundary";
  if (id === "privacy_patterns") return "privacy";
  if (id === "missing_test_calibration") return "missing_test_detection";
  return "requirement_calibration";
}

function priorityForRollup(rollup: EvaluationMetricRollup): EvaluationLearningTask["priority"] {
  if (rollup.status === "fail" && (rollup.id === "schema_valid" || rollup.id === "oracle_leakage" || rollup.id === "input_oracle_boundary" || rollup.id === "privacy_patterns")) {
    return "blocker";
  }
  if (rollup.status === "fail") return "high";
  if (rollup.status === "warning") return "medium";
  return "low";
}

function recommendationForMetric(id: string): string {
  const recommendations: Record<string, string> = {
    schema_valid: "Fix report generation or validation before trusting evaluation quality.",
    changed_file_evidence: "Improve diff parsing and evidence indexing so visible changed files are cited exactly.",
    test_file_evidence: "Improve test-file detection and evidence kind assignment.",
    execution_uncertainty: "Keep confidence and coverage below high thresholds until check or log evidence is visible.",
    requirement_calibration: "Calibrate requirement statuses so `met` requires requirement-linked execution evidence.",
    missing_test_calibration: "Separate visible test artifacts from proof that those tests executed.",
    input_oracle_boundary: "Fix evaluation case normalization before report generation.",
    oracle_leakage: "Keep dataset names, hidden labels, hidden values, and future outcomes outside report inputs.",
    unsupported_verified: "Prevent requirements from being marked met without passing execution evidence in their evidenceRefs.",
    privacy_patterns: "Extend redaction before persisting or printing evaluation artifacts."
  };

  return recommendations[id] ?? "Inspect this non-pass metric and add a targeted regression test.";
}

function recommendationForRollup(rollup: EvaluationMetricRollup): string {
  if (rollup.id === "requirement_calibration" && rollup.status === "warning") {
    return "Improve requirement extraction and evidence matching, or preserve weakly matched visible artifacts as explicit execution-proof gaps.";
  }

  return recommendationForMetric(rollup.id);
}

function acceptanceCriteriaForMetric(id: string): string[] {
  const criteria: Record<string, string[]> = {
    schema_valid: ["Generated reports pass validateVerificationReport(report, { mode: \"full\" })."],
    changed_file_evidence: ["Each visible changed file has an exact label or locator match in the evidence index."],
    test_file_evidence: ["Each visible test file is indexed with evidence kind `test`."],
    execution_uncertainty: ["Reports without visible execution evidence do not claim high confidence or complete coverage."],
    requirement_calibration: ["Every `met` requirement cites passing check or log evidence in its own evidenceRefs."],
    missing_test_calibration: ["Implementation changes without executed related tests remain visible as missing-test or execution-proof gaps."],
    input_oracle_boundary: ["Evaluation case inputs contain no dataset names, hidden label keys, hidden label values, or oracle wording before report generation."],
    oracle_leakage: ["Reports contain no dataset names, hidden label keys, hidden label values, or oracle wording."],
    unsupported_verified: ["No requirement is marked `met` unless it cites relevant passing execution evidence."],
    privacy_patterns: ["Evaluation outputs contain no high-risk secret-looking strings."]
  };

  return criteria[id] ?? ["A focused test covers the non-pass metric before closing the learning task."];
}

function acceptanceCriteriaForRollup(rollup: EvaluationMetricRollup): string[] {
  if (rollup.id === "requirement_calibration" && rollup.status === "warning") {
    return [
      "A requirement with visible implementation or test evidence is reported as `partial`, or the visible implementation/test artifacts are preserved as execution-proof gaps.",
      "`met` still requires relevant passing check or log evidence."
    ];
  }

  return acceptanceCriteriaForMetric(rollup.id);
}

function statusRank(status: EvaluationMetricStatus): number {
  if (status === "fail") return 0;
  if (status === "warning") return 1;
  if (status === "unknown") return 2;
  return 3;
}

function parseUnifiedDiff(diffText: string): ChangedFile[] {
  const normalized = redactSecrets(diffText).trim();

  if (!normalized) {
    return [];
  }

  const sections = normalized
    .split(/(?=^diff --git\s+)/m)
    .map((section) => section.trim())
    .filter(Boolean);

  return sections.flatMap((section) => {
    const lines = section.split(/\r?\n/);
    const header = lines.find((line) => line.startsWith("diff --git "));
    const path = pathFromDiffHeader(header) ?? pathFromPatchHeaders(lines);

    if (!path) {
      return [];
    }

    let additions = 0;
    let deletions = 0;

    for (const line of lines) {
      if (line.startsWith("+++") || line.startsWith("---")) {
        continue;
      }
      if (line.startsWith("+")) {
        additions += 1;
      } else if (line.startsWith("-")) {
        deletions += 1;
      }
    }

    return [{
      path,
      additions,
      deletions,
      status: statusFromDiff(lines),
      patch: compactPatch(lines)
    }];
  });
}

function pathFromDiffHeader(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  const match = header.match(/^diff --git a\/(.+?) b\/(.+)$/);
  const path = match?.[2] || match?.[1];

  return path && path !== "/dev/null" ? path : null;
}

function pathFromPatchHeaders(lines: string[]): string | null {
  const newPath = lines.find((line) => line.startsWith("+++ b/"))?.replace(/^\+\+\+ b\//, "");
  const oldPath = lines.find((line) => line.startsWith("--- a/"))?.replace(/^--- a\//, "");
  const path = newPath || oldPath;

  return path && path !== "/dev/null" ? path : null;
}

function statusFromDiff(lines: string[]): ChangedFile["status"] {
  if (lines.some((line) => line.startsWith("new file mode"))) {
    return "added";
  }
  if (lines.some((line) => line.startsWith("deleted file mode"))) {
    return "removed";
  }
  if (lines.some((line) => line.startsWith("rename from") || line.startsWith("rename to"))) {
    return "renamed";
  }

  return "modified";
}

function compactPatch(lines: string[]): string {
  return lines
    .filter((line) =>
      line.startsWith("@@") ||
      (line.startsWith("+") && !line.startsWith("+++")) ||
      (line.startsWith("-") && !line.startsWith("---"))
    )
    .slice(0, 80)
    .join("\n");
}

function mergeChangedFiles(files: ChangedFile[]): ChangedFile[] {
  const byPath = new Map<string, ChangedFile>();

  for (const file of files) {
    const existing = byPath.get(file.path);

    if (!existing) {
      byPath.set(file.path, file);
      continue;
    }

    byPath.set(file.path, {
      ...existing,
      additions: (existing.additions ?? 0) + (file.additions ?? 0),
      deletions: (existing.deletions ?? 0) + (file.deletions ?? 0),
      patch: [existing.patch, file.patch].filter(Boolean).join("\n")
    });
  }

  return Array.from(byPath.values());
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value !== "string") {
    return [];
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    // SWE-bench mirrors may serialize Python-style lists; fall through to a safe best effort.
  }

  return trimmed
    .replace(/^\[|\]$/g, "")
    .split(/,\s*/)
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function isLikelyTestPath(path: string): boolean {
  return /(\.test\.|\.spec\.|__tests__|(^|\/)tests?\/|test_|_test\.|spec_)/i.test(path);
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hashText(value: string): string {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(16);
}
