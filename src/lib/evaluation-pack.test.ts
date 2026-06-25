import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EVALUATION_DATA_SOURCES,
  evaluationCaseFromRecord,
  evaluateReportAgainstCase,
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

  it("can evaluate locally fetched real SWE-bench rows when generated data exists", () => {
    const rows = loadGeneratedSweBenchRecords(3);

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
});

function metric(id: string, status: EvaluationMetric["status"], detail = ""): EvaluationMetric {
  return {
    id,
    label: id,
    status,
    detail
  };
}

function loadGeneratedSweBenchRecords(limit: number): unknown[] {
  const fixtureUrl = generatedFixtureUrl();

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

function generatedFixtureUrl(): URL {
  const casesUrl = new URL("../../eval/generated/swebench-verified.cases.jsonl", import.meta.url);

  if (existsSync(casesUrl)) {
    return casesUrl;
  }

  return new URL("../../eval/generated/swebench-verified.rows.jsonl", import.meta.url);
}
