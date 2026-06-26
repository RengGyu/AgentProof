import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildEvalPack, buildEvalPackFromCli } from "./build-eval-pack.mjs";
import { evaluateReportAgainstCase, isNormalizedEvaluationCase } from "../src/lib/evaluation-pack";
import { generateVerificationReport } from "../src/lib/verifier";

const SECRET_TEXT = "sk-testsecret012345678901234567890";
const HIDDEN_TEST = "tests/private_oracle.py::test_future_behavior";

const SWE_BENCH_ROW = {
  repo: "example/project",
  instance_id: "example__project-privacy-1",
  base_commit: "abc1234567890",
  problem_statement: `Fix export ordering. Debug token: ${SECRET_TEXT}`,
  hints_text: "Reviewer context should be visible after redaction.",
  patch: [
    "diff --git a/src/export.py b/src/export.py",
    "index 1111111..2222222 100644",
    "--- a/src/export.py",
    "+++ b/src/export.py",
    "@@ -1,2 +1,3 @@",
    "-headers = sorted(custom_fields)",
    "+headers = list(custom_fields)",
    `+api_key = "${SECRET_TEXT}"`
  ].join("\n"),
  test_patch: [
    "diff --git a/tests/test_export.py b/tests/test_export.py",
    "index 3333333..4444444 100644",
    "--- a/tests/test_export.py",
    "+++ b/tests/test_export.py",
    "@@ -10,2 +10,5 @@",
    "+def test_custom_field_order_is_preserved():",
    "+    assert export_headers(['b', 'a']) == ['b', 'a']"
  ].join("\n"),
  FAIL_TO_PASS: JSON.stringify([HIDDEN_TEST]),
  PASS_TO_PASS: JSON.stringify(["tests/test_export.py::test_existing_export"])
};

describe("build eval pack script", () => {
  it("can be imported without fetching rows or writing files", async () => {
    const output = execFileSync(process.execPath, [
      "--input-type=module",
      "-e",
      [
        "globalThis.fetch = async () => { throw new Error('import should not fetch'); };",
        "const imported = await import(new URL('./scripts/build-eval-pack.mjs', `file://${process.cwd()}/`).href);",
        "console.log(Object.keys(imported).sort().join(','));"
      ].join("\n")
    ], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    expect(output.trim()).toBe("buildEvalPack,buildEvalPackFromCli");
  });

  it("builds the rows API URL from CLI args without live network", async () => {
    const requestedUrls = [];
    const writes = [];

    await buildEvalPackFromCli([
      "--dataset",
      "owner/private-dataset",
      "--config",
      "verified",
      "--split",
      "test",
      "--offset",
      "3",
      "--length",
      "1",
      "--output",
      "eval/generated/unit/from-cli.cases.jsonl"
    ], {
      fetch: async (url) => {
        requestedUrls.push(url);

        return {
          ok: true,
          json: async () => ({ rows: [{ row: SWE_BENCH_ROW }] })
        };
      },
      mkdir: async () => undefined,
      writeFile: async (path, text) => {
        writes.push({ path, text });
      },
      logger: {
        log: () => undefined
      }
    });

    const url = requestedUrls[0];

    expect(requestedUrls).toHaveLength(1);
    expect(url).toBeInstanceOf(URL);
    expect(url.searchParams.get("dataset")).toBe("owner/private-dataset");
    expect(url.searchParams.get("config")).toBe("verified");
    expect(url.searchParams.get("split")).toBe("test");
    expect(url.searchParams.get("offset")).toBe("3");
    expect(url.searchParams.get("length")).toBe("1");
    expect(writes).toHaveLength(1);
  });

  it("builds normalized cases from injected rows without using the network", async () => {
    const writes = [];
    const fetched = [];
    const logs = [];

    const result = await buildEvalPack({
      output: "eval/generated/unit/swebench.cases.jsonl",
      length: "1"
    }, {
      fetchRows: async (request) => {
        fetched.push(request);
        return [SWE_BENCH_ROW];
      },
      mkdir: async () => undefined,
      writeFile: async (path, text) => {
        writes.push({ path, text });
      },
      logger: {
        log: (message) => logs.push(message)
      }
    });

    const records = writes[0]?.text.trim().split(/\n+/).map((line) => JSON.parse(line));
    const report = generateVerificationReport(records?.[0].input);
    const resultFromReportInput = evaluateReportAgainstCase(report, records?.[0]);
    const serializedInput = JSON.stringify(records?.[0].input);
    const serializedReport = JSON.stringify(report);

    expect(result.caseCount).toBe(1);
    expect(fetched).toHaveLength(1);
    expect(writes).toHaveLength(1);
    expect(records).toHaveLength(1);
    expect(isNormalizedEvaluationCase(records?.[0])).toBe(true);
    expect(Object.keys(records?.[0] ?? {})).not.toEqual(expect.arrayContaining([
      "repo",
      "patch",
      "test_patch",
      "problem_statement",
      "FAIL_TO_PASS",
      "PASS_TO_PASS"
    ]));
    expect(serializedInput).not.toContain(SECRET_TEXT);
    expect(serializedInput).not.toContain(HIDDEN_TEST);
    expect(serializedInput).not.toContain("FAIL_TO_PASS");
    expect(serializedInput).not.toContain("PASS_TO_PASS");
    expect(serializedReport).not.toContain(SECRET_TEXT);
    expect(serializedReport).not.toContain(HIDDEN_TEST);
    expect(resultFromReportInput.metrics.find((metric) => metric.id === "oracle_leakage")?.status).toBe("pass");
    expect(resultFromReportInput.metrics.find((metric) => metric.id === "privacy_patterns")?.status).toBe("pass");
    expect(logs.join("\n")).toContain("Wrote 1 normalized evaluation case");
  });

  it("normalizes top-level tests directory paths as visible test files", async () => {
    const writes = [];

    await buildEvalPack({
      output: "eval/generated/unit/top-level-tests.cases.jsonl",
      length: "1"
    }, {
      fetchRows: async () => [{
        ...SWE_BENCH_ROW,
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
        ].join("\n")
      }],
      mkdir: async () => undefined,
      writeFile: async (_path, text) => {
        writes.push(text);
      },
      logger: {
        log: () => undefined
      }
    });

    const [record] = writes[0].trim().split(/\n+/).map((line) => JSON.parse(line));

    expect(record.oracle.visibleImplementationFiles).toEqual(["src/validators/url.py"]);
    expect(record.oracle.visibleTestFiles).toEqual(["tests/validators/invalid_urls.txt"]);
  });

  it("prints only summary logs without raw rows, oracle labels, oracle values, or secrets", async () => {
    const logs = [];

    await buildEvalPack({
      output: "eval/generated/unit/privacy.cases.jsonl"
    }, {
      fetchRows: async () => [SWE_BENCH_ROW],
      mkdir: async () => undefined,
      writeFile: async () => undefined,
      logger: {
        log: (message) => logs.push(message)
      }
    });

    const serializedLogs = logs.join("\n");

    expect(serializedLogs).toMatch(/Wrote 1 normalized evaluation case/);
    expect(serializedLogs).not.toContain("problem_statement");
    expect(serializedLogs).not.toContain("patch");
    expect(serializedLogs).not.toContain("test_patch");
    expect(serializedLogs).not.toContain(JSON.stringify(SWE_BENCH_ROW));
    expect(serializedLogs).not.toContain("example/project");
    expect(serializedLogs).not.toContain("abc1234567890");
    expect(serializedLogs).not.toContain("FAIL_TO_PASS");
    expect(serializedLogs).not.toContain("PASS_TO_PASS");
    expect(serializedLogs).not.toContain(HIDDEN_TEST);
    expect(serializedLogs).not.toContain(SECRET_TEXT);
  });

  it("rejects output paths outside ignored eval/generated before fetching rows", async () => {
    let fetchCalled = false;

    await expect(buildEvalPack({
      output: "eval/fixtures/not-generated.jsonl"
    }, {
      fetchRows: async () => {
        fetchCalled = true;
        return [SWE_BENCH_ROW];
      }
    })).rejects.toThrow("Evaluation fetch output must be written under ignored eval/generated.");

    expect(fetchCalled).toBe(false);
  });
});
