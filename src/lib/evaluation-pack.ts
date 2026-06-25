import { validateVerificationReport } from "./report-validation";
import { redactSecrets } from "./redact";
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
  metrics: EvaluationMetric[];
  learningActions: string[];
}

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
      title: `SWE-bench issue ${instanceId}`,
      url: `https://github.com/${repo}`,
      description: hintsText
        ? `Benchmark PR context from pre-fix discussion: ${redactSecrets(hintsText)}`
        : "Benchmark PR context was not provided; evaluation uses the issue text and visible patch metadata only.",
      author: "benchmark",
      baseBranch: baseCommit ? `base:${baseCommit.slice(0, 12)}` : undefined,
      headBranch: "benchmark-gold-patch",
      taskText: redactSecrets(problemStatement),
      changedFiles,
      checks: [],
      logs: [],
      limitations: [
        "SWE-bench oracle labels are withheld from report input to avoid future-label leakage.",
        "No live CI log was provided; passing behavior must stay unclear unless visible evidence proves it."
      ]
    },
    oracle: {
      description: "SWE-bench provides issue text, a developer patch, a test patch, and fail-to-pass/pass-to-pass test labels.",
      hiddenLabels: ["FAIL_TO_PASS", "PASS_TO_PASS"],
      visibleChangedFiles: changedFiles.map((file) => file.path),
      visibleTestFiles,
      failToPassTests,
      passToPassTests
    }
  };
}

export function evaluateReportAgainstCase(report: VerificationReport, testCase: EvaluationCase): EvaluationResult {
  const metrics: EvaluationMetric[] = [
    schemaMetric(report),
    evidenceKindsMetric(report, ["task"]),
    changedFileEvidenceMetric(report, testCase.oracle.visibleChangedFiles),
    testFileEvidenceMetric(report, testCase.oracle.visibleTestFiles),
    noOracleLeakageMetric(report, testCase.oracle.hiddenLabels),
    noUnsupportedVerifiedMetric(report),
    privacyPatternMetric(report)
  ];
  const failedMetrics = metrics.filter((metric) => metric.status === "fail");

  return {
    caseId: testCase.id,
    dataset: testCase.source.id,
    passed: failedMetrics.length === 0,
    metrics,
    learningActions: summarizeEvaluationLearning(metrics)
  };
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

  if (hasFailed(metrics, "unsupported_verified")) {
    actions.push("Tighten requirement scoring so visible diff/test patches without passing execution evidence remain partial or unclear.");
  }

  if (hasFailed(metrics, "privacy_patterns")) {
    actions.push("Extend redaction and generated-artifact filters before storing evaluation outputs.");
  }

  if (actions.length === 0) {
    actions.push("No blocking harness failure; inspect warnings and add more real benchmark cases.");
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

  const evidenceText = report.evidenceIndex.map((item) => `${item.label} ${item.locator ?? ""}`).join("\n");
  const missingFiles = expectedFiles.filter((path) => !evidenceText.includes(path));

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
      status: "unknown",
      detail: "No visible test files were present in the evaluation case."
    };
  }

  const testEvidence = report.evidenceIndex
    .filter((item) => item.kind === "test")
    .map((item) => `${item.label} ${item.locator ?? ""}`)
    .join("\n");
  const missingFiles = expectedTestFiles.filter((path) => !testEvidence.includes(path));

  return {
    id: "test_file_evidence",
    label: "Visible test-file evidence",
    status: missingFiles.length === 0 ? "pass" : "fail",
    detail: missingFiles.length === 0
      ? `All ${expectedTestFiles.length} visible test file(s) were indexed as test evidence.`
      : `Missing test evidence for: ${missingFiles.slice(0, 5).join(", ")}.`
  };
}

function noOracleLeakageMetric(report: VerificationReport, hiddenLabels: string[]): EvaluationMetric {
  const serialized = JSON.stringify(report);
  const leakedLabels = hiddenLabels.filter((label) => serialized.includes(label));

  return {
    id: "oracle_leakage",
    label: "Future-label leakage",
    status: leakedLabels.length === 0 ? "pass" : "fail",
    detail: leakedLabels.length === 0
      ? "No benchmark oracle label names were present in the report."
      : `Report leaked benchmark label(s): ${leakedLabels.join(", ")}.`
  };
}

function noUnsupportedVerifiedMetric(report: VerificationReport): EvaluationMetric {
  const hasPassingExecutionEvidence = report.evidenceIndex.some((item) =>
    (item.kind === "check" || item.kind === "log") &&
    /\b(test|spec|unit|integration|e2e|pytest|jest|vitest)\b/i.test(`${item.label} ${item.summary}`) &&
    /\b(pass|passed|success|succeeded|green)\b/i.test(item.summary)
  );
  const unsupportedMet = !hasPassingExecutionEvidence
    ? report.requirements.filter((requirement) => requirement.status === "met")
    : [];

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
  const secretPatterns = [
    /\bgh[pousr]_[A-Za-z0-9_]{20,}/,
    /\bgithub_pat_[A-Za-z0-9_]{20,}/,
    /\bsk-[A-Za-z0-9_-]{20,}/,
    /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/
  ];
  const leaked = secretPatterns.some((pattern) => pattern.test(serialized));

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
  return /(\.test\.|\.spec\.|__tests__|\/tests?\/|test_|_test\.|spec_)/i.test(path);
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
