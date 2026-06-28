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
    report.evidenceIndex.push({
      id: "ev_annotation_secret",
      kind: "check",
      label: "unit tests",
      summary: "Check annotations: failure at src/private/auth.test.ts:42. raw_details annotation message with ghp_secret_should_not_leak",
      confidence: 0.9
    });
    report.claims.push({
      id: "claim_annotation_secret",
      text: "Annotation raw_details retained sk-secret_should_not_leak",
      evidenceRefs: ["ev_annotation_secret"],
      supported: false
    });
    report.reprompt.prompt = "raw_details re-prompt with github_pat_secret_should_not_leak";
    const history = saveReportToHistory(storage, report);
    const serialized = JSON.stringify(history);

    expect(history).toHaveLength(1);
    expect(serialized).not.toContain("githubToken");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("raw_details");
    expect(serialized).not.toContain("src/private/auth.test.ts:42");
    expect(serialized).not.toContain("ghp_secret_should_not_leak");
    expect(serialized).not.toContain("sk-secret_should_not_leak");
    expect(serialized).not.toContain("github_pat_secret_should_not_leak");
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
