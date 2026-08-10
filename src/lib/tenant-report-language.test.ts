import { describe, expect, it } from "vitest";
import { tenantProofGapKindForSemanticGap, tenantRemediationText } from "./tenant-report-language";

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
});
