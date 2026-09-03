import { describe, expect, it } from "vitest";
import { presentGeneralPrAssessmentSummary } from "./general-pr-assessment-presentation";
import { expectNoSelectionSentinels, transientSelectionFixture } from "./general-pr-selection-sentinels.test-fixture";
import type { GeneralPrAssessmentSummaryV1 } from "./types";

const summary: GeneralPrAssessmentSummaryV1 = {
  version: 1,
  mode: "ordinary_pr",
  sourceState: "pr_author_claim",
  overallConclusion: "evidence_partial",
  counts: {
    evidence_supported: 0,
    evidence_partial: 1,
    not_demonstrated: 0,
    contradicted: 0,
    blocked: 0,
    not_assessable: 0
  },
  reasonCodes: ["author_claim_requires_confirmation", "verified_relation_missing"],
  observations: {
    version: 1,
    inventory: { state: "complete", changedArtifacts: 2, changedTestCandidates: 1 },
    links: { state: "proposed", linkedObjectives: 1, supports: 1, tests: 0, implements: 0, contradicts: 0 },
    coverage: { source: "complete", evidence: "complete" }
  }
};

describe("presentGeneralPrAssessmentSummary", () => {
  it("renders a bounded reviewer explanation without target or source details", () => {
    Object.assign(summary as Record<string, unknown>, { transientObserver: transientSelectionFixture() });
    const presentation = presentGeneralPrAssessmentSummary(summary);
    const serialized = JSON.stringify(presentation);

    expect(presentation).toMatchObject({
      heading: "Ordinary PR evidence assessment",
      conclusionLabel: "Partial observations; objective fulfillment remains unconfirmed",
      sourceLabel: "PR description claim — reviewer confirmation needed",
      countsLabel: "Partial evidence: 1",
      reasonLabels: [
        "The PR description is an author claim and needs reviewer confirmation.",
        "A requirement-to-evidence relation was not independently verified.",
        "Observed changed artifacts: 2; changed-file test path candidates (including deletions): 1.",
        "AI relevance proposals link 1 objective(s) across 1 relation(s); they are not verified connections.",
        "Global CI results do not establish target-specific test execution."
      ]
    });
    expect(serialized).not.toContain("sourceBindingRef");
    expect(serialized).not.toContain("sourceSpanRefs");
    expect(serialized).not.toContain("targets");
    expectNoSelectionSentinels(serialized);
  });

  it("does not invent zero-valued observations for legacy summaries", () => {
    const { observations: _observations, ...legacySummary } = summary;
    const presentation = presentGeneralPrAssessmentSummary(legacySummary);

    expect(presentation.reasonLabels).not.toContainEqual(expect.stringMatching(/changed artifacts|AI relevance|CI results/i));
  });

  it("qualifies incomplete changed-file inventory even without sampled semantic coverage", () => {
    const presentation = presentGeneralPrAssessmentSummary({
      ...summary,
      observations: {
        ...summary.observations!,
        inventory: { state: "incomplete", changedArtifacts: 0, changedTestCandidates: 0 },
        coverage: { source: null, evidence: null },
        links: { state: "not_attempted", linkedObjectives: 0, supports: 0, tests: 0, implements: 0, contradicts: 0 }
      }
    });

    expect(presentation.reasonLabels).toContain("Changed-file inventory was incomplete; counts are not a complete file inventory.");
  });

  it.each([
    ["none_proposed", "No AI relevance proposal was accepted in the selected scope; this does not prove none exist."],
    ["unavailable", "AI relevance linking could not be confirmed."]
  ] as const)("keeps %s link wording neutral", (state, label) => {
    const presentation = presentGeneralPrAssessmentSummary({
      ...summary,
      observations: { ...summary.observations!, links: { state, linkedObjectives: 0, supports: 0, tests: 0, implements: 0, contradicts: 0 } }
    });

    expect(presentation.reasonLabels).toContain(label);
  });

  it("states sampled coverage and unavailable inventory independently", () => {
    const presentation = presentGeneralPrAssessmentSummary({
      ...summary,
      observations: {
        ...summary.observations!,
        inventory: { state: "unavailable", changedArtifacts: 0, changedTestCandidates: 0 },
        coverage: { source: "sampled", evidence: "complete" }
      }
    });

    expect(presentation.reasonLabels).toContain("Changed-file inventory was unavailable.");
    expect(presentation.reasonLabels).toContain("Only selected material was considered.");
  });
});
