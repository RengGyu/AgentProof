import { describe, expect, it } from "vitest";
import { clearReportHistory, readReportHistory, saveReportToHistory } from "./report-history";
import { demoScenarios } from "./sample-data";
import { generateVerificationReport } from "./verifier";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("report history", () => {
  it("stores summary-only reports locally without request tokens or raw evidence", () => {
    const storage = new MemoryStorage();
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    const history = saveReportToHistory(storage, report);
    const serialized = JSON.stringify(history);

    expect(history).toHaveLength(1);
    expect(serialized).not.toContain("githubToken");
    expect(serialized).not.toContain("Patch excerpt");
    expect(history[0]?.report.claims).toEqual([]);
    expect(history[0]?.report.evidenceIndex).toEqual([]);
    expect(history[0]?.report.reprompt.prompt).toContain("Shared summary links omit re-prompt text");
    expect(readReportHistory(storage)[0]?.report.source.title).toBe(report.source.title);
    expect(clearReportHistory(storage)).toEqual([]);
  });

  it("sanitizes legacy full reports when reading history", () => {
    const storage = new MemoryStorage();
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    storage.setItem(
      "agentproof.recentReports.v1",
      JSON.stringify([
        {
          id: report.analysisId,
          savedAt: new Date().toISOString(),
          title: report.source.title,
          priority: report.summary.priority,
          evidenceCoverage: report.summary.evidenceCoverage,
          report
        }
      ])
    );

    const history = readReportHistory(storage);

    expect(history[0]?.report.evidenceIndex).toEqual([]);
    expect(JSON.stringify(history)).not.toContain("Patch excerpt");
  });
});
