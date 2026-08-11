import { describe, expect, it } from "vitest";
import { tenantProofGapKindForSemanticGap, tenantRemediationText, tenantReportAnalysisContext } from "./tenant-report-language";
import { generateVerificationReport } from "./verifier";

describe("tenant report language", () => {
  it("uses an actionable privacy-safe fallback when no specific gap kind is available", () => {
    expect(tenantRemediationText([])).toBe(
      "Collect the unavailable evidence and run the analysis again."
    );
  });

  it("maps validated AI gap enums to the same canonical evidence language", () => {
    expect(tenantProofGapKindForSemanticGap("missing_runtime_evidence")).toBe("missing_execution");
    expect(tenantProofGapKindForSemanticGap("missing_check_evidence")).toBe("missing_execution");
    expect(tenantProofGapKindForSemanticGap("missing_test_evidence")).toBe("missing_targeted_test");
    expect(tenantProofGapKindForSemanticGap("ambiguous_requirement")).toBe("ambiguous_requirement");
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
});
