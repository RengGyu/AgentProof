import { afterEach, describe, expect, it } from "vitest";
import { demoScenarios } from "./sample-data";
import {
  clearSavedReportsForTests,
  cleanupExpiredReports,
  createSavedReport,
  getSavedReport
} from "./server-report-store";
import { generateVerificationReport } from "./verifier";

describe("server report store", () => {
  afterEach(() => {
    clearSavedReportsForTests();
  });

  it("stores only the summary-safe report projection", () => {
    const fullReport = generateVerificationReport(demoScenarios["scope-creep"]);
    const saved = createSavedReport(fullReport);

    expect(saved.report.evidenceIndex).toEqual([]);
    expect(saved.report.claims).toEqual([]);
    expect(saved.report.reprompt.prompt).toContain("Shared summary links omit re-prompt text");
    expect(saved.report.limitations).toContain(
      "Shared report omits raw evidence, patch/log excerpts, claims, and re-prompt text."
    );
  });

  it("expires and deletes old reports", () => {
    const fullReport = generateVerificationReport(demoScenarios.clean);
    const saved = createSavedReport(fullReport, -1);

    expect(getSavedReport(saved.id)).toBeNull();
    expect(cleanupExpiredReports()).toBe(0);
  });
});
