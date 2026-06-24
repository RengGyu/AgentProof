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
  it("stores reports locally without request tokens", () => {
    const storage = new MemoryStorage();
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    const history = saveReportToHistory(storage, report);

    expect(history).toHaveLength(1);
    expect(JSON.stringify(history)).not.toContain("githubToken");
    expect(readReportHistory(storage)[0]?.report.source.title).toBe(report.source.title);
    expect(clearReportHistory(storage)).toEqual([]);
  });
});
