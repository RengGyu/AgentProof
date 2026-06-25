import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EVALUATION_DATA_SOURCES,
  evaluationCaseFromRecord,
  evaluateReportAgainstCase,
  isNormalizedEvaluationCase,
  summarizeEvaluationResults,
  summarizeEvaluationLearning,
  sweBenchRowToEvaluationCase
} from "./evaluation-pack";
import { generateVerificationReport } from "./verifier";
import type { EvaluationMetric } from "./evaluation-pack";

const SWE_BENCH_ROW = {
  repo: "example/project",
  instance_id: "example__project-1",
  base_commit: "abc1234567890",
  problem_statement:
    "Fix invoice export so CSV headers preserve custom field order. Add regression coverage for custom fields.",
  hints_text: "Reviewer discussion before the patch mentions custom field ordering.",
  patch: [
    "diff --git a/src/invoice/export.py b/src/invoice/export.py",
    "index 1111111..2222222 100644",
    "--- a/src/invoice/export.py",
    "+++ b/src/invoice/export.py",
    "@@ -1,2 +1,3 @@",
    "-headers = sorted(custom_fields)",
    "+headers = list(custom_fields)",
    "+return write_csv(headers)"
  ].join("\n"),
  test_patch: [
    "diff --git a/tests/test_invoice_export.py b/tests/test_invoice_export.py",
    "index 3333333..4444444 100644",
    "--- a/tests/test_invoice_export.py",
    "+++ b/tests/test_invoice_export.py",
    "@@ -10,2 +10,5 @@",
    "+def test_custom_field_order_is_preserved():",
    "+    assert export_headers(['b', 'a']) == ['b', 'a']"
  ].join("\n"),
  FAIL_TO_PASS: "[\"tests/test_invoice_export.py::test_custom_field_order_is_preserved\"]",
  PASS_TO_PASS: "[\"tests/test_invoice_export.py::test_existing_export\"]",
  difficulty: "medium"
};

describe("real-dataset evaluation pack", () => {
  it("keeps AIDev exploratory instead of scored until labels are audited", () => {
    const aidev = EVALUATION_DATA_SOURCES.find((source) => source.id === "aidev");

    expect(aidev?.scoredInMvp).toBe(false);
    expect(aidev?.oracleStrength).toBe("weak");
    expect(aidev?.caveat).toContain("merge/reject");
  });

  it("converts a SWE-bench row into a PR input without leaking hidden oracle labels", () => {
    const testCase = sweBenchRowToEvaluationCase(SWE_BENCH_ROW);

    expect(testCase.id).toBe("example__project-1");
    expect(testCase.input.taskText).toContain("Fix invoice export");
    expect(testCase.input.changedFiles.map((file) => file.path)).toEqual([
      "src/invoice/export.py",
      "tests/test_invoice_export.py"
    ]);
    expect(testCase.oracle.visibleImplementationFiles).toEqual(["src/invoice/export.py"]);
    expect(testCase.input.title).not.toContain("SWE-bench");
    expect(testCase.input.description).not.toContain("Benchmark");
    expect(testCase.input.headBranch).toBe("candidate-fix");
    expect(testCase.input.checks).toEqual([]);
    expect(testCase.input.logs).toEqual([]);
    expect(JSON.stringify(testCase.input)).not.toContain("FAIL_TO_PASS");
    expect(JSON.stringify(testCase.input)).not.toContain("PASS_TO_PASS");
    expect(JSON.stringify(testCase.input)).not.toContain("benchmark");
    expect(JSON.stringify(testCase.input)).not.toContain("gold");
    expect(testCase.oracle.failToPassTests).toEqual([
      "tests/test_invoice_export.py::test_custom_field_order_is_preserved"
    ]);
  });

  it("scores generated reports for schema, provenance, visible evidence, and no future-label leakage", () => {
    const testCase = sweBenchRowToEvaluationCase(SWE_BENCH_ROW);
    const report = generateVerificationReport(testCase.input);
    const result = evaluateReportAgainstCase(report, testCase);

    expect(result.passed).toBe(true);
    expect(result.metrics.find((metric) => metric.id === "schema_valid")?.status).toBe("pass");
    expect(result.metrics.find((metric) => metric.id === "changed_file_evidence")?.status).toBe("pass");
    expect(result.metrics.find((metric) => metric.id === "test_file_evidence")?.status).toBe("pass");
    expect(result.metrics.find((metric) => metric.id === "execution_uncertainty")?.status).toBe("pass");
    expect(result.metrics.find((metric) => metric.id === "requirement_calibration")?.status).toBe("pass");
    expect(result.metrics.find((metric) => metric.id === "missing_test_calibration")?.status).toBe("pass");
    expect(result.metrics.find((metric) => metric.id === "oracle_leakage")?.status).toBe("pass");
    expect(result.metrics.find((metric) => metric.id === "unsupported_verified")?.status).toBe("pass");
    expect(report.requirements.some((requirement) => requirement.status === "met")).toBe(false);
    expect(result.learningActions).toEqual([
      "No blocking harness failure; inspect warnings and add more real benchmark cases."
    ]);
  });

  it("turns failed metrics into a learning backlog instead of an LLM judge score", () => {
    const actions = summarizeEvaluationLearning([
      metric("schema_valid", "fail"),
      metric("unsupported_verified", "fail"),
      metric("oracle_leakage", "fail"),
      metric("execution_uncertainty", "fail")
    ]);

    expect(actions).toContain("Fix report generation or runtime validation before evaluating quality.");
    expect(actions).toContain("Tighten requirement scoring so visible diff/test patches without passing execution evidence remain partial or unclear.");
    expect(actions).toContain("Remove benchmark labels from report inputs; future outcome labels must only be used after report generation.");
    expect(actions).toContain("Lower confidence or require execution evidence before presenting high-coverage benchmark reports.");
  });

  it("summarizes evaluation results into a learning-focused run summary", () => {
    const passingCase = sweBenchRowToEvaluationCase(SWE_BENCH_ROW);
    const passingReport = generateVerificationReport(passingCase.input);
    const passingResult = evaluateReportAgainstCase(passingReport, passingCase);
    const failingResult = {
      caseId: "leaky_case",
      dataset: "swebench-verified",
      passed: false,
      calibrated: false,
      metrics: [
        metric("schema_valid", "pass"),
        metric("oracle_leakage", "fail", "Report leaked FAIL_TO_PASS.")
      ],
      learningActions: ["Remove benchmark labels from report inputs; future outcome labels must only be used after report generation."]
    };
    const summary = summarizeEvaluationResults([passingResult, failingResult]);

    expect(summary.caseCount).toBe(2);
    expect(summary.passedCount).toBe(1);
    expect(summary.failedCount).toBe(1);
    expect(summary.statusCounts.fail).toBe(1);
    expect(summary.learningActions).not.toContain("No blocking harness failure; inspect warnings and add more real benchmark cases.");
    expect(summary.learningTasks[0]).toMatchObject({
      area: "oracle_boundary",
      priority: "blocker"
    });
    expect(summary.metricRollups[0]).toMatchObject({
      id: "oracle_leakage",
      status: "fail",
      count: 1,
      caseIds: ["leaky_case"]
    });
    expect(summary.metricRollups[0]?.sampleDetails).toEqual(["Report leaked FAIL_TO_PASS."]);
    expect(summary.learningActions).toContain("Remove benchmark labels from report inputs; future outcome labels must only be used after report generation.");
  });

  it("creates requirement calibration tasks for met requirements without linked execution evidence", () => {
    const testCase = sweBenchRowToEvaluationCase(SWE_BENCH_ROW);
    const report = generateVerificationReport(testCase.input);
    report.requirements[0] = {
      ...report.requirements[0],
      status: "met",
      confidence: 0.95,
      evidenceRefs: report.evidenceIndex.filter((item) => item.kind === "diff").map((item) => item.id)
    };
    const result = evaluateReportAgainstCase(report, testCase);
    const summary = summarizeEvaluationResults([result]);

    expect(result.metrics.find((item) => item.id === "requirement_calibration")?.status).toBe("fail");
    expect(summary.learningTasks.some((task) => task.area === "requirement_calibration" && task.priority === "high")).toBe(true);
  });

  it("fails missing-test calibration when implementation changes have no visible test signal", () => {
    const testCase = sweBenchRowToEvaluationCase({
      ...SWE_BENCH_ROW,
      test_patch: "",
      FAIL_TO_PASS: "[]",
      PASS_TO_PASS: "[]"
    });
    const report = generateVerificationReport(testCase.input);
    report.testing.missingTests = [];
    const result = evaluateReportAgainstCase(report, testCase);

    expect(result.metrics.find((item) => item.id === "missing_test_calibration")?.status).toBe("fail");
  });

  it("can evaluate generated or committed real SWE-bench cases", () => {
    const rows = loadAvailableEvaluationRecords(3);

    if (rows.length === 0) {
      expect(rows).toEqual([]);
      return;
    }

    const results = rows.map((row) => {
      const testCase = evaluationCaseFromRecord(row);
      const report = generateVerificationReport(testCase.input);

      return evaluateReportAgainstCase(report, testCase);
    });
    const summary = summarizeEvaluationResults(results);

    expect(results).toHaveLength(rows.length);
    expect(results.flatMap((result) => result.metrics).filter((metric) => metric.status === "fail")).toEqual([]);
    expect(summary.failedCount).toBe(0);
  });

  it("keeps the committed SWE-bench fixture reproducible by manifest hash", () => {
    const fixtureUrl = new URL("../../eval/fixtures/swebench-verified.small.jsonl", import.meta.url);
    const manifestUrl = new URL("../../eval/fixtures/swebench-verified.small.manifest.json", import.meta.url);
    const fixture = readFileSync(fixtureUrl);
    const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as {
      caseCount: number;
      caseIds: string[];
      datasetRevision: string;
      sourceOffset: number;
      sourceLength: number;
      sourceRowSha256: string;
      normalizerVersion: string;
      sha256: string;
      privacy: string;
    };

    expect(manifest.caseCount).toBe(1);
    expect(manifest.caseIds).toEqual(["astropy__astropy-12907"]);
    expect(manifest.datasetRevision).toMatch(/^[a-f0-9]{40}$/);
    expect(manifest.sourceOffset).toBe(0);
    expect(manifest.sourceLength).toBe(1);
    expect(manifest.sourceRowSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.normalizerVersion).toBe("evaluation-pack-v1");
    expect(manifest.privacy).toContain("raw dataset rows are not committed");
    expect(createHash("sha256").update(fixture).digest("hex")).toBe(manifest.sha256);
    expect(JSON.parse(fixture.toString("utf8")).id).toBe("astropy__astropy-12907");
  });

  it("evaluates the committed SWE-bench fixture without generated data", () => {
    const fixtureUrl = new URL("../../eval/fixtures/swebench-verified.small.jsonl", import.meta.url);
    const fixtureRecord = readJsonlRecord(fixtureUrl);

    expect(isNormalizedEvaluationCase(fixtureRecord)).toBe(true);
    expect(Object.keys(fixtureRecord as unknown as Record<string, unknown>)).not.toEqual(expect.arrayContaining([
      "repo",
      "patch",
      "test_patch",
      "problem_statement",
      "FAIL_TO_PASS",
      "PASS_TO_PASS"
    ]));

    const testCase = fixtureRecord;
    const report = generateVerificationReport(testCase.input);
    const result = evaluateReportAgainstCase(report, testCase);
    const inputText = JSON.stringify(testCase.input);
    const fixtureText = readFileSync(fixtureUrl, "utf8");
    const patchLineCounts = testCase.input.changedFiles.map((file) =>
      (file.patch ?? "").split(/\r?\n/).filter(Boolean).length
    );
    const patchByteCount = testCase.input.changedFiles.reduce(
      (total, file) => total + Buffer.byteLength(file.patch ?? "", "utf8"),
      0
    );

    expect(result.caseId).toBe("astropy__astropy-12907");
    expect(result.metrics.filter((metricItem) => metricItem.status === "fail")).toEqual([]);
    expect(testCase.oracle.visibleChangedFiles).toEqual(testCase.input.changedFiles.map((file) => file.path));
    expect(inputText).not.toMatch(/SWE-bench|benchmark|gold|FAIL_TO_PASS|PASS_TO_PASS|huggingface/i);
    expect(testCase.oracle.hiddenLabels.every((label) => !inputText.includes(label))).toBe(true);
    expect(testCase.oracle.hiddenValues.every((value) => !inputText.includes(value))).toBe(true);
    expect(Math.max(...patchLineCounts)).toBeLessThanOrEqual(80);
    expect(patchByteCount).toBeLessThanOrEqual(1_500);
    expect(fixtureText).not.toMatch(/\bgh[pousr]_[A-Za-z0-9_]{20,}/);
    expect(fixtureText).not.toMatch(/\bgithub_pat_[A-Za-z0-9_]{20,}/);
    expect(fixtureText).not.toMatch(/\bsk-[A-Za-z0-9_-]{20,}/);
    expect(fixtureText).not.toMatch(/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/);
    expect(fixtureText).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
  });
});

function metric(id: string, status: EvaluationMetric["status"], detail = ""): EvaluationMetric {
  return {
    id,
    label: id,
    status,
    detail
  };
}

function loadAvailableEvaluationRecords(limit: number): unknown[] {
  const fixtureUrl = availableFixtureUrl();

  if (!existsSync(fixtureUrl)) {
    return [];
  }

  return readFileSync(fixtureUrl, "utf8")
    .trim()
    .split(/\n+/)
    .filter(Boolean)
    .slice(0, limit)
    .map((line) => JSON.parse(line) as unknown);
}

function availableFixtureUrl(): URL {
  const casesUrl = new URL("../../eval/generated/swebench-verified.cases.jsonl", import.meta.url);

  if (existsSync(casesUrl)) {
    return casesUrl;
  }

  const committedFixtureUrl = new URL("../../eval/fixtures/swebench-verified.small.jsonl", import.meta.url);

  if (existsSync(committedFixtureUrl)) {
    return committedFixtureUrl;
  }

  return new URL("../../eval/generated/swebench-verified.rows.jsonl", import.meta.url);
}

function readJsonlRecord(url: URL): ReturnType<typeof evaluationCaseFromRecord> {
  const line = readFileSync(url, "utf8").trim().split(/\n+/)[0];
  const parsed = JSON.parse(line);

  if (!isNormalizedEvaluationCase(parsed)) {
    throw new Error("Committed fixture must already be a normalized EvaluationCase.");
  }

  return parsed;
}
