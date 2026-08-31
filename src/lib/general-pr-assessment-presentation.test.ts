import { describe, expect, it } from "vitest";
import { presentGeneralPrAssessmentSummary } from "./general-pr-assessment-presentation";
import type { GeneralPrAssessmentSummaryV1 } from "./types";

const summary: GeneralPrAssessmentSummaryV1 = {
  version: 1,
  mode: "ordinary_pr",
  sourceState: "pr_author_claim",
  overallConclusion: "mixed_evidence",
  counts: {
    evidence_supported: 0,
    evidence_partial: 1,
    not_demonstrated: 0,
    contradicted: 0,
    blocked: 0,
    not_assessable: 0
  },
  reasonCodes: ["author_claim_requires_confirmation", "verified_relation_missing"]
};

describe("presentGeneralPrAssessmentSummary", () => {
  it("renders a bounded reviewer explanation without target or source details", () => {
    const presentation = presentGeneralPrAssessmentSummary(summary);
    const serialized = JSON.stringify(presentation);

    expect(presentation).toMatchObject({
      heading: "Ordinary PR evidence assessment",
      conclusionLabel: "Evidence is partially connected",
      sourceLabel: "PR description claim — reviewer confirmation needed",
      countsLabel: "Partial evidence: 1",
      reasonLabels: [
        "The PR description is an author claim and needs reviewer confirmation.",
        "A requirement-to-evidence relation was not independently verified."
      ]
    });
    expect(serialized).not.toContain("sourceBindingRef");
    expect(serialized).not.toContain("sourceSpanRefs");
    expect(serialized).not.toContain("targets");
  });
});
