import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evaluationCaseFromRecord,
  evaluateReportAgainstCase,
  summarizeEvaluationResults,
} from "../src/lib/evaluation-pack";
import { generateVerificationReport } from "../src/lib/verifier";

describe("evaluation pack summary", () => {
  it("prints the current generated-pack learning summary", () => {
    const rows = loadGeneratedSweBenchRows();

    if (rows.length === 0) {
      console.info("No generated SWE-bench rows found. Run `pnpm eval:fetch:swebench -- --length 10` first.");
      expect(rows).toEqual([]);
      return;
    }

    const results = rows.map((row) => {
      const testCase = evaluationCaseFromRecord(row);
      const report = generateVerificationReport(testCase.input);

      return evaluateReportAgainstCase(report, testCase);
    });
    const summary = summarizeEvaluationResults(results);

    console.info(JSON.stringify(summary, null, 2));

    expect(summary.failedCount).toBe(0);
  });
});

function loadGeneratedSweBenchRows(): unknown[] {
  const fixtureUrl = generatedFixtureUrl();

  if (!existsSync(fixtureUrl)) {
    return [];
  }

  return readFileSync(fixtureUrl, "utf8")
    .trim()
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

function generatedFixtureUrl(): URL {
  const casesUrl = new URL("../eval/generated/swebench-verified.cases.jsonl", import.meta.url);

  if (existsSync(casesUrl)) {
    return casesUrl;
  }

  return new URL("../eval/generated/swebench-verified.rows.jsonl", import.meta.url);
}
