import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  EVALUATION_DATA_SOURCES,
  evaluateReportAgainstCase,
  isNormalizedEvaluationCase,
  summarizeEvaluationResults,
  summarizeEvaluationLearning,
  sweBenchRowToEvaluationCase
} from "./evaluation-pack";
import { generateVerificationReport } from "./verifier";
import type { EvaluationCase, EvaluationMetric } from "./evaluation-pack";

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

const RAW_ROW_KEYS = [
  "repo",
  "patch",
  "test_patch",
  "problem_statement",
  "FAIL_TO_PASS",
  "PASS_TO_PASS"
];

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

  it("treats top-level tests directory paths as visible test files", () => {
    const testCase = sweBenchRowToEvaluationCase({
      ...SWE_BENCH_ROW,
      instance_id: "example__project-top-level-tests",
      patch: [
        "diff --git a/src/validators/url.py b/src/validators/url.py",
        "index 1111111..2222222 100644",
        "--- a/src/validators/url.py",
        "+++ b/src/validators/url.py",
        "@@ -1,2 +1,3 @@",
        "+def validate_url(value):",
        "+    return value.startswith('https://')"
      ].join("\n"),
      test_patch: [
        "diff --git a/tests/validators/invalid_urls.txt b/tests/validators/invalid_urls.txt",
        "index 3333333..4444444 100644",
        "--- a/tests/validators/invalid_urls.txt",
        "+++ b/tests/validators/invalid_urls.txt",
        "@@ -1,2 +1,3 @@",
        "+http://invalid example"
      ].join("\n"),
      FAIL_TO_PASS: "[\"tests/validators/invalid_urls.txt\"]",
      PASS_TO_PASS: "[]"
    });

    expect(testCase.oracle.visibleImplementationFiles).toEqual(["src/validators/url.py"]);
    expect(testCase.oracle.visibleTestFiles).toEqual(["tests/validators/invalid_urls.txt"]);
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

  it("calibrates noisy issue-template bug reports against visible diff evidence", () => {
    const testCase = sweBenchRowToEvaluationCase({
      ...SWE_BENCH_ROW,
      instance_id: "example__issue-template-1",
      problem_statement: [
        "IndexError: tuple index out of range in identify_format (io.registry)",
        "<!-- This comments are hidden when you submit the issue,",
        "so you do not need to remove them! -->",
        "<!-- Please be sure to check out our contributing guidelines,",
        "https://github.com/astropy/astropy/blob/main/CONTRIBUTING.md . -->",
        "### Description",
        "Cron tests using identify_format started failing with IndexError.",
        "Citing the maintainer: when `filepath` is a string without a FITS extension, the function executes `isinstance(args[0], ...)`.",
        "### Steps to Reproduce",
        "```",
        "Traceback (most recent call last):",
        "  File \"connect.py\", line 72, in is_fits",
        "IndexError: tuple index out of range",
        "```",
        "### System Details",
        "Python 3.10"
      ].join("\n"),
      patch: [
        "diff --git a/astropy/io/fits/connect.py b/astropy/io/fits/connect.py",
        "index 1111111..2222222 100644",
        "--- a/astropy/io/fits/connect.py",
        "+++ b/astropy/io/fits/connect.py",
        "@@ -65,10 +65,9 @@ def is_fits(origin, filepath, fileobj, *args, **kwargs):",
        "-        if filepath.lower().endswith(",
        "+        return filepath.lower().endswith(",
        "-        ):",
        "-            return True",
        "+        )"
      ].join("\n"),
      test_patch: [
        "diff --git a/astropy/io/fits/tests/test_connect.py b/astropy/io/fits/tests/test_connect.py",
        "index 3333333..4444444 100644",
        "--- a/astropy/io/fits/tests/test_connect.py",
        "+++ b/astropy/io/fits/tests/test_connect.py",
        "@@ -1002,3 +1009,8 @@ def test_meta_not_modified(tmp_path):",
        "+def test_is_fits_without_extension():",
        "+    assert not connect.is_fits(\"\", \"foo.bar\", None)"
      ].join("\n"),
      FAIL_TO_PASS: "[]",
      PASS_TO_PASS: "[]"
    });
    const report = generateVerificationReport(testCase.input);
    const result = evaluateReportAgainstCase(report, testCase);
    const requirementText = report.requirements.map((requirement) => requirement.requirementText).join("\n");

    expect(result.metrics.find((metricItem) => metricItem.id === "requirement_calibration")?.status).toBe("pass");
    expect(result.metrics.filter((metricItem) => metricItem.status === "fail")).toEqual([]);
    expect(report.requirements.some((requirement) => requirement.status === "partial")).toBe(true);
    expect(requirementText).toContain("filepath");
    expect(requirementText).not.toMatch(/hidden when|contributing guidelines|Traceback|System Details|Steps to Reproduce/i);
  });

  it("passes requirement calibration when weak requirements are preserved as execution gaps", () => {
    const testCase = sweBenchRowToEvaluationCase({
      ...SWE_BENCH_ROW,
      instance_id: "example__weak-requirement-execution-gap",
      problem_statement:
        "Latex parsing of fractions yields wrong expression due to missing brackets in the denominator.",
      patch: [
        "diff --git a/sympy/printing/str.py b/sympy/printing/str.py",
        "index 1111111..2222222 100644",
        "--- a/sympy/printing/str.py",
        "+++ b/sympy/printing/str.py",
        "@@ -333,7 +333,7 @@ def apow(i):",
        "-                            isinstance(item.base, Mul)):",
        "+                            isinstance(item.base, (Mul, Pow))):"
      ].join("\n"),
      test_patch: [
        "diff --git a/sympy/printing/tests/test_str.py b/sympy/printing/tests/test_str.py",
        "index 3333333..4444444 100644",
        "--- a/sympy/printing/tests/test_str.py",
        "+++ b/sympy/printing/tests/test_str.py",
        "@@ -252,6 +252,8 @@ def test_Mul():",
        "+    assert str(Mul(x, Pow(1/y, -1, evaluate=False), evaluate=False)) == 'x/(1/y)'"
      ].join("\n"),
      FAIL_TO_PASS: "[]",
      PASS_TO_PASS: "[]"
    });
    const report = generateVerificationReport(testCase.input);
    const result = evaluateReportAgainstCase(report, testCase);
    const requirementCalibration = result.metrics.find((metricItem) => metricItem.id === "requirement_calibration");

    expect(report.requirements.every((requirement) => requirement.status === "missing" || requirement.status === "unclear")).toBe(true);
    expect(report.testing.missingTests.map((item) => item.path)).toContain("sympy/printing/str.py");
    expect(requirementCalibration?.status).toBe("pass");
    expect(requirementCalibration?.detail).toContain("execution-proof gaps");
  });

  it("turns failed metrics into a learning backlog instead of an LLM judge score", () => {
    const actions = summarizeEvaluationLearning([
      metric("schema_valid", "fail"),
      metric("unsupported_verified", "fail"),
      metric("oracle_leakage", "fail"),
      metric("input_oracle_boundary", "fail"),
      metric("execution_uncertainty", "fail")
    ]);

    expect(actions).toContain("Fix report generation or runtime validation before evaluating quality.");
    expect(actions).toContain("Tighten requirement scoring so visible diff/test patches without passing execution evidence remain partial or unclear.");
    expect(actions).toContain("Remove benchmark labels from report inputs; future outcome labels must only be used after report generation.");
    expect(actions).toContain("Fix evaluation case normalization before report generation; oracle labels must not enter report inputs.");
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

  it("redacts oracle leakage details from metrics and learning summaries", () => {
    const testCase = sweBenchRowToEvaluationCase(SWE_BENCH_ROW);
    testCase.oracle.hiddenValues = ["tests/private_oracle.py::test_future_behavior"];
    const report = generateVerificationReport(testCase.input);
    report.limitations.push("Debug note mentioned tests/private_oracle.py::test_future_behavior and FAIL_TO_PASS.");
    const result = evaluateReportAgainstCase(report, testCase);
    const leakageMetric = result.metrics.find((item) => item.id === "oracle_leakage");
    const summary = summarizeEvaluationResults([result]);
    const serializedSummary = JSON.stringify(summary);

    expect(leakageMetric?.status).toBe("fail");
    expect(leakageMetric?.detail).toContain("exact values are redacted");
    expect(leakageMetric?.detail).not.toContain("tests/private_oracle.py");
    expect(leakageMetric?.detail).not.toContain("FAIL_TO_PASS");
    expect(serializedSummary).not.toContain("tests/private_oracle.py");
    expect(serializedSummary).not.toContain("FAIL_TO_PASS");
  });

  it("treats natural-language future-label variants as oracle leakage", () => {
    const testCase = sweBenchRowToEvaluationCase(SWE_BENCH_ROW);
    const report = generateVerificationReport(testCase.input);

    report.limitations.push("Future fail-to-pass and pass-to-pass tests were used as scoring labels.");

    const result = evaluateReportAgainstCase(report, testCase);
    const leakageMetric = result.metrics.find((item) => item.id === "oracle_leakage");

    expect(leakageMetric?.status).toBe("fail");
    expect(leakageMetric?.detail).toContain("exact values are redacted");
    expect(leakageMetric?.detail).not.toContain("fail-to-pass");
    expect(leakageMetric?.detail).not.toContain("pass-to-pass");
  });

  it("fails input oracle boundary checks before report generation when inputs leak hidden values", () => {
    const testCase = sweBenchRowToEvaluationCase(SWE_BENCH_ROW);
    const hiddenValue = "tests/private_oracle.py::test_future_behavior";
    testCase.oracle.hiddenValues = [hiddenValue];
    testCase.input.taskText = `${testCase.input.taskText}\nDo not mention ${hiddenValue} or FAIL_TO_PASS.`;
    const report = generateVerificationReport(testCase.input);
    const result = evaluateReportAgainstCase(report, testCase);
    const inputBoundaryMetric = result.metrics.find((item) => item.id === "input_oracle_boundary");
    const summary = summarizeEvaluationResults([result]);
    const serializedSummary = JSON.stringify(summary);

    expect(inputBoundaryMetric?.status).toBe("fail");
    expect(inputBoundaryMetric?.detail).toContain("exact values are redacted");
    expect(inputBoundaryMetric?.detail).not.toContain(hiddenValue);
    expect(inputBoundaryMetric?.detail).not.toContain("FAIL_TO_PASS");
    expect(serializedSummary).not.toContain(hiddenValue);
    expect(serializedSummary).not.toContain("FAIL_TO_PASS");
    expect(summary.learningTasks[0]?.priority).toBe("blocker");
  });

  it("allows ordinary product issue text to mention performance benchmarks", () => {
    const testCase = sweBenchRowToEvaluationCase({
      ...SWE_BENCH_ROW,
      instance_id: "example__benchmark-word",
      problem_statement: "Fix a performance regression. I benchmarked delete() with 100k rows and it is slower."
    });
    const report = generateVerificationReport(testCase.input);
    const result = evaluateReportAgainstCase(report, testCase);

    expect(result.metrics.find((item) => item.id === "input_oracle_boundary")?.status).toBe("pass");
    expect(result.metrics.find((item) => item.id === "oracle_leakage")?.status).toBe("pass");
  });

  it("uses extraction-focused learning guidance for weak requirement warnings", () => {
    const warningResult = {
      caseId: "weak_case",
      dataset: "swebench-verified",
      passed: true,
      calibrated: false,
      metrics: [
        metric(
          "requirement_calibration",
          "warning",
          "Visible implementation or test evidence exists, but every requirement is still missing or unclear."
        )
      ],
      learningActions: ["No blocking harness failure; inspect warnings and add more real benchmark cases."]
    };
    const summary = summarizeEvaluationResults([warningResult]);
    const task = summary.learningTasks[0];

    expect(task).toMatchObject({
      area: "requirement_calibration",
      priority: "medium"
    });
    expect(task?.recommendation).toContain("requirement extraction");
    expect(task?.acceptanceCriteria.join(" ")).toContain("partial");
    expect(task?.acceptanceCriteria.join(" ")).toContain("met");
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

  it("does not treat non-execution build gates as passing execution evidence", () => {
    const testCase = sweBenchRowToEvaluationCase(SWE_BENCH_ROW);
    const report = generateVerificationReport(testCase.input);

    report.summary.confidence = 0.95;
    report.summary.evidenceCoverage = 100;
    report.evidenceIndex.push({
      id: "ev_build_policy",
      kind: "check",
      label: "Build policy coverage tests report",
      summary: "Status: passed. build policy coverage tests and deployment preview completed.",
      confidence: 0.8
    });

    const result = evaluateReportAgainstCase(report, testCase);

    expect(result.metrics.find((item) => item.id === "execution_uncertainty")?.status).toBe("fail");
  });

  it("uses the runtime status-aware classifier for opaque Actions matrix evidence without promoting non-observed prose", () => {
    const testCase = sweBenchRowToEvaluationCase(SWE_BENCH_ROW);
    const actionsJobUrl = "https://github.com/acme/project/actions/runs/100/job/200";
    const matrixReport = generateVerificationReport({
      ...testCase.input,
      checks: [{ name: "MATRIX_VALUE=1", status: "failed", url: actionsJobUrl, summary: "Matrix job failed." }]
    });
    const nonObservedReport = generateVerificationReport({
      ...testCase.input,
      checks: [{ name: "Unit Test", status: "passed", summary: "Tests were not run." }]
    });

    expect(matrixReport.testing.ciStatus).toBe("failed");
    expect(evaluateReportAgainstCase(matrixReport, testCase).metrics.find((item) => item.id === "execution_uncertainty")?.status).toBe("pass");
    expect(nonObservedReport.testing.ciStatus).toBe("unknown");
  });

  it("uses the broad app secret patterns for evaluation privacy checks", () => {
    const testCase = sweBenchRowToEvaluationCase(SWE_BENCH_ROW);
    const report = generateVerificationReport(testCase.input);

    report.limitations.push("Debug header authorization: bearer abcdefghijklmnopqrstuvwxyz012345");

    const result = evaluateReportAgainstCase(report, testCase);
    const privacyMetric = result.metrics.find((item) => item.id === "privacy_patterns");

    expect(privacyMetric?.status).toBe("fail");
    expect(privacyMetric?.detail).not.toContain("authorization");
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

  it("does not mark absent visible test files as an indexing unknown", () => {
    const testCase = sweBenchRowToEvaluationCase({
      ...SWE_BENCH_ROW,
      test_patch: "",
      FAIL_TO_PASS: "[]",
      PASS_TO_PASS: "[]"
    });
    const report = generateVerificationReport(testCase.input);
    const result = evaluateReportAgainstCase(report, testCase);

    expect(result.metrics.find((item) => item.id === "test_file_evidence")?.status).toBe("pass");
    expect(result.metrics.find((item) => item.id === "missing_test_calibration")?.status).toBe("pass");
  });

  it("can evaluate generated or committed real SWE-bench cases", () => {
    const testCases = loadAvailableEvaluationRecords(3);

    if (testCases.length === 0) {
      expect(testCases).toEqual([]);
      return;
    }

    const results = testCases.map((testCase) => {
      const report = generateVerificationReport(testCase.input);

      return evaluateReportAgainstCase(report, testCase);
    });
    const summary = summarizeEvaluationResults(results);

    expect(results).toHaveLength(testCases.length);
    expect(testCases.every(isNormalizedEvaluationCase)).toBe(true);
    expect(testCases.flatMap((testCase) => Object.keys(testCase))).not.toEqual(expect.arrayContaining([
      "repo",
      "patch",
      "test_patch",
      "problem_statement",
      "FAIL_TO_PASS",
      "PASS_TO_PASS"
    ]));
    expect(results.flatMap((result) => result.metrics).filter((metric) => metric.status === "fail")).toEqual([]);
    expect(summary.failedCount).toBe(0);
  });

  it("rejects raw benchmark rows in evaluation record loaders", () => {
    expect(() => parseNormalizedEvaluationRecords(
      `${JSON.stringify(SWE_BENCH_ROW)}\n`,
      "synthetic raw row"
    )).toThrow("must contain normalized EvaluationCase records");
  });

  it("rejects normalized-looking records that retain raw benchmark fields", () => {
    const testCase = sweBenchRowToEvaluationCase(SWE_BENCH_ROW);
    const hybridRecord = {
      ...testCase,
      patch: "raw patch should not ride along with normalized cases",
      FAIL_TO_PASS: "[\"tests/private.py::test_hidden\"]"
    };

    expect(isNormalizedEvaluationCase(testCase)).toBe(true);
    expect(isNormalizedEvaluationCase(hybridRecord)).toBe(false);
    expect(() => parseNormalizedEvaluationRecords(
      `${JSON.stringify(hybridRecord)}\n`,
      "hybrid record"
    )).toThrow("must contain normalized EvaluationCase records");
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
      oracleLabelCount: number;
      oracleLabelSha256: string;
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
    expect(manifest.oracleLabelCount).toBeGreaterThan(0);
    expect(manifest.oracleLabelSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.normalizerVersion).toBe("evaluation-pack-v1");
    expect(manifest.privacy).toContain("raw hidden oracle labels are not committed");
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
    expect(testCase.oracle.hiddenValues).toEqual([]);
    expect(testCase.oracle.failToPassTests).toEqual([]);
    expect(testCase.oracle.passToPassTests).toEqual([]);
    expect(testCase.oracle.visibleChangedFiles).toEqual(testCase.input.changedFiles.map((file) => file.path));
    expect(inputText).not.toMatch(/SWE-bench|SWEbench|benchmark dataset|benchmark oracle|gold-patch|gold patch|FAIL_TO_PASS|PASS_TO_PASS|huggingface/i);
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

  it("keeps every committed evaluation fixture normalized and summary-safe", () => {
    const fixturesDir = new URL("../../eval/fixtures/", import.meta.url);
    const fixtureFiles = readdirSync(fixturesDir)
      .filter((name) => name.endsWith(".jsonl"))
      .sort();
    const trackedGenerated = execFileSync("git", ["ls-files", "eval/generated"], {
      cwd: process.cwd()
    }).toString("utf8").trim();

    expect(fixtureFiles.length).toBeGreaterThan(0);
    expect(trackedGenerated).toBe("");

    for (const fixtureFile of fixtureFiles) {
      const fixtureUrl = new URL(fixtureFile, fixturesDir);
      const manifestUrl = new URL(fixtureFile.replace(/\.jsonl$/, ".manifest.json"), fixturesDir);
      const fixture = readFileSync(fixtureUrl);
      const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as {
        fixtureFile: string;
        sha256: string;
        caseCount: number;
        caseIds: string[];
        sourceOffset: number;
        sourceLength: number;
        sourceRowSha256: string;
        oracleLabelCount: number;
        oracleLabelSha256: string;
        normalizerVersion: string;
        privacy: string;
      };
      const records = parseNormalizedEvaluationRecords(fixture.toString("utf8"), fixtureFile);

      expect(existsSync(manifestUrl)).toBe(true);
      expect(manifest.fixtureFile).toBe(fixtureFile);
      expect(manifest.sha256).toBe(createHash("sha256").update(fixture).digest("hex"));
      expect(manifest.caseCount).toBe(records.length);
      expect(manifest.caseIds).toEqual(records.map((record) => record.id));
      expect(Number.isInteger(manifest.sourceOffset)).toBe(true);
      expect(Number.isInteger(manifest.sourceLength)).toBe(true);
      expect(manifest.sourceRowSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(manifest.oracleLabelCount).toBeGreaterThanOrEqual(0);
      expect(manifest.oracleLabelSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(manifest.normalizerVersion).toBe("evaluation-pack-v1");
      expect(manifest.privacy).toContain("raw hidden oracle labels are not committed");
      for (const record of records) {
        expect(Object.keys(record)).not.toEqual(expect.arrayContaining(RAW_ROW_KEYS));
        expect(record.oracle.hiddenValues).toEqual([]);
        expect(record.oracle.failToPassTests).toEqual([]);
        expect(record.oracle.passToPassTests).toEqual([]);
        expect(JSON.stringify(record.input)).not.toMatch(/SWE-bench|SWEbench|benchmark dataset|benchmark oracle|gold-patch|gold patch|FAIL_TO_PASS|PASS_TO_PASS|huggingface/i);
      }
    }
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

function loadAvailableEvaluationRecords(limit: number): EvaluationCase[] {
  const fixtureUrl = availableFixtureUrl();

  if (!fixtureUrl || !existsSync(fixtureUrl)) {
    return [];
  }

  return parseNormalizedEvaluationRecords(readFileSync(fixtureUrl, "utf8"), fixtureUrl.pathname)
    .slice(0, limit);
}

function parseNormalizedEvaluationRecords(text: string, sourceLabel: string): EvaluationCase[] {
  return text
    .trim()
    .split(/\n+/)
    .filter(Boolean)
    .map((line, index) => {
      const parsed = JSON.parse(line) as unknown;

      if (!isNormalizedEvaluationCase(parsed)) {
        throw new Error(`${sourceLabel} line ${index + 1} must contain normalized EvaluationCase records, not raw dataset rows.`);
      }

      return parsed;
    });
}

function availableFixtureUrl(): URL | null {
  const casesUrl = new URL("../../eval/generated/swebench-verified.cases.jsonl", import.meta.url);

  if (existsSync(casesUrl)) {
    return casesUrl;
  }

  const committedFixtureUrl = new URL("../../eval/fixtures/swebench-verified.small.jsonl", import.meta.url);

  if (existsSync(committedFixtureUrl)) {
    return committedFixtureUrl;
  }

  return null;
}

function readJsonlRecord(url: URL): EvaluationCase {
  const line = readFileSync(url, "utf8").trim().split(/\n+/)[0];
  const parsed = JSON.parse(line);

  if (!isNormalizedEvaluationCase(parsed)) {
    throw new Error("Committed fixture must already be a normalized EvaluationCase.");
  }

  return parsed;
}
