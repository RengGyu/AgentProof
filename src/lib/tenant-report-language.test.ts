import { describe, expect, it } from "vitest";
import { tenantRemediationText, tenantReportAnalysisContext } from "./tenant-report-language";
import { generateVerificationReport } from "./verifier";

describe("tenant report language", () => {
  it("uses an actionable privacy-safe fallback when no specific gap kind is available", () => {
    expect(tenantRemediationText([])).toBe(
      "Review the linked evidence."
    );
  });

  it("keeps a no-objective unlinked PR in PR-objective context", () => {
    const report = generateVerificationReport({
      title: "Improve background processing",
      taskText: "",
      description: "Improve background processing.",
      changedFiles: [{ path: "src/jobs/label.js", status: "modified", patch: "+ export const label = 'background';" }],
      checks: [],
      logs: []
    });

    expect(report.requirements).toEqual([]);
    expect(tenantReportAnalysisContext(report)).toBe("unlinked_pr");
  });

  it("keeps an authoritative Issue context even when the PR description adds author claims", () => {
    const report = generateVerificationReport({
      title: "Persist notification preference",
      taskText: "Users must be able to save whether notifications are enabled.",
      taskSource: "issue",
      description: "Implemented the preference storage and tests.",
      changedFiles: [{ path: "src/notifications/preference.js", status: "modified", patch: "+ savePreference(enabled);" }],
      checks: [],
      logs: []
    });

    expect(report.requirements).not.toHaveLength(0);
    expect(tenantReportAnalysisContext(report)).toBe("linked_issue");
  });
});
