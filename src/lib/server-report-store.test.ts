import { afterEach, describe, expect, it } from "vitest";
import { demoScenarios } from "./sample-data";
import {
  clearSavedReportsForTests,
  cleanupExpiredReports,
  createSavedReport,
  getSavedReport,
  MAX_SERVER_REPORTS
} from "./server-report-store";
import { generateVerificationReport } from "./verifier";

describe("server report store", () => {
  afterEach(() => {
    clearSavedReportsForTests();
  });

  it("stores only the summary-safe report projection", () => {
    const fullReport = generateVerificationReport(demoScenarios["scope-creep"]);
    const saved = createSavedReport(fullReport);
    const serialized = JSON.stringify(saved.report);

    expect(saved.report.evidenceIndex).toEqual([]);
    expect(saved.report.claims).toEqual([]);
    expect(saved.report.reprompt.prompt).toContain("Shared summary links omit re-prompt text");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain(fullReport.reprompt.prompt);
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

  it("caps in-memory saved reports by removing oldest entries", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    const saved = Array.from({ length: MAX_SERVER_REPORTS + 1 }, () => createSavedReport(report));

    expect(getSavedReport(saved[0].id)).toBeNull();
    expect(getSavedReport(saved.at(-1)?.id ?? "")).not.toBeNull();
  });
});
