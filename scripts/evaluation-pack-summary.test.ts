import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evaluateReportAgainstCase,
  isNormalizedEvaluationCase,
  summarizeEvaluationResults,
} from "../src/lib/evaluation-pack";
import type { EvaluationCase } from "../src/lib/evaluation-pack";
import { generateVerificationReport } from "../src/lib/verifier";

describe("evaluation pack summary", () => {
  it("prints the current generated-pack learning summary", () => {
    const cases = loadAvailableEvaluationRecords();

    if (cases.length === 0) {
      console.info("No generated or committed SWE-bench evaluation cases found. Run `pnpm eval:fetch:swebench -- --length 10` first.");
      expect(cases).toEqual([]);
      return;
    }

    const results = cases.map((testCase) => {
      const report = generateVerificationReport(testCase.input);

      return evaluateReportAgainstCase(report, testCase);
    });
    const summary = summarizeEvaluationResults(results);

    console.info(JSON.stringify(summary, null, 2));

    expect(summary.failedCount).toBe(0);
    if (process.env.AGENTPROOF_EVAL_STRICT === "1") {
      expect(summary.uncalibratedCount).toBe(0);
      expect(summary.statusCounts.warning).toBe(0);
      expect(summary.statusCounts.unknown).toBe(0);
      expect(summary.metricRollups).toEqual([]);
      expect(summary.learningTasks).toEqual([]);
    }
  });

  it("rejects raw dataset rows before printing evaluation summaries", () => {
    const rawRow = JSON.stringify({
      repo: "example/project",
      patch: "diff --git a/a.py b/a.py",
      test_patch: "diff --git a/test_a.py b/test_a.py",
      problem_statement: "Fix behavior.",
      FAIL_TO_PASS: "[\"tests/private.py::test_hidden\"]",
      PASS_TO_PASS: "[]"
    });

    expect(() => parseNormalizedEvaluationRecords(rawRow, "synthetic raw row")).toThrow(
      "must contain normalized EvaluationCase records"
    );
  });
});

function loadAvailableEvaluationRecords(): EvaluationCase[] {
  const fixtureUrl = availableFixtureUrl();

  if (!fixtureUrl || !existsSync(fixtureUrl)) {
    return [];
  }

  return parseNormalizedEvaluationRecords(readFileSync(fixtureUrl, "utf8"), fixtureUrl.pathname);
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
  const committedFixtureUrl = new URL("../eval/fixtures/swebench-verified.small.jsonl", import.meta.url);

  if (process.env.AGENTPROOF_EVAL_FIXTURE_ONLY === "1") {
    return committedFixtureUrl;
  }

  const casesUrl = new URL("../eval/generated/swebench-verified.cases.jsonl", import.meta.url);

  if (existsSync(casesUrl)) {
    return casesUrl;
  }

  if (existsSync(committedFixtureUrl)) {
    return committedFixtureUrl;
  }

  return null;
}
