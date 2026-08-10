import { describe, expect, it } from "vitest";
import { toDashboardRequirementViewModels } from "./dashboard-requirement-view-model";

describe("toDashboardRequirementViewModels", () => {
  it("keeps deterministic coverage and joins semantic information only on an exact requirement ID", () => {
    const [card] = toDashboardRequirementViewModels({
      requirements: [{ requirementId: "req_checkout", status: "partial", evidenceRefs: ["ev_1", "ev_2"], gaps: ["A focused edge-case test is not recorded."] }],
      semantic: {
        requirement_evidence_relations: [{ requirement_id: "req_checkout", evidence_id: "ev_1", relation: "partial_support", rationale: "Bounded rationale.", uncertainty: "medium" }],
        requirement_assessments: [{ requirement_id: "req_checkout", requirement_summary: "Checkout input validation", evidence_support: "partial_evidence_present", summary: "The normal validation path has evidence.", evidence_ids: ["ev_1"], uncertainty: "medium" }, { requirement_id: "req_checkout ", requirement_summary: "Near match", evidence_support: "direct_evidence_present", summary: "Must not join.", evidence_ids: ["ev_2"], uncertainty: "low" }],
        evidence_gaps: [{ requirement_id: "req_checkout ", gap_type: "missing_test_evidence", priority: "high", description: "Must not join.", review_impact: "No impact.", needed_evidence: "None.", evidence_ids: ["ev_2"], uncertainty: "high" }],
        review_targets: [{ target_type: "file", target_evidence_id: "ev_2", priority: "high", reason: "Must not join.", inspection_goal: "Must not join.", requirement_ids: ["req_checkout "], evidence_ids: ["ev_2"], uncertainty: "high" }],
        remediation_requests: [{ requirement_id: "req_checkout ", request_type: "add_or_update_test", priority: "high", instruction: "Must not join.", rationale: "No.", expected_evidence: "No.", evidence_ids: ["ev_2"], uncertainty: "high" }],
        uncertainties: [{ uncertainty_type: "insufficient_context", impact: "limits_assessment", description: "Must not join.", needed_information: "No.", requirement_ids: ["req_checkout "], evidence_ids: ["ev_2"] }]
      }
    });

    expect(card).toMatchObject({
      requirementId: "req_checkout",
      status: "partial",
      coverageLabel: "Partially supported",
      coverageMeaning: "Deterministic evidence references only partially support this requirement.",
      evidenceRefs: ["ev_1", "ev_2"],
      deterministicGaps: ["A focused edge-case test is not recorded."],
      explanation: { state: "assessment", text: "The normal validation path has evidence." },
      semanticEvidenceIds: ["ev_1"],
      uncertainties: ["medium"]
    });
    expect(card.nextAction).toBeUndefined();
  });

  it("keeps a matching remediation instruction in Next and uses bounded evidence guidance when an assessment is absent", () => {
    const [card] = toDashboardRequirementViewModels({
      requirements: [{ requirementId: "req_2", status: "missing", evidenceRefs: [], gaps: ["No deterministic evidence was captured."] }],
      semantic: {
        requirement_evidence_relations: [],
        requirement_assessments: [],
        evidence_gaps: [{ requirement_id: "req_2", gap_type: "missing_test_evidence", priority: "high", description: "A focused test is not available.", review_impact: "Coverage cannot be traced.", needed_evidence: "A focused test.", evidence_ids: [], uncertainty: "high" }],
        review_targets: [],
        remediation_requests: [{ requirement_id: "req_2", request_type: "add_or_update_test", priority: "high", instruction: "Add a focused test for the missing path.", rationale: "The path is not covered.", expected_evidence: "A passing test.", evidence_ids: [], uncertainty: "high" }],
        uncertainties: []
      }
    });

    expect(card).toMatchObject({
      explanation: { state: "guidance", text: "A next action is available from the evidence." },
      nextAction: "Add a focused test for the missing path.",
      semanticEvidenceIds: [],
      uncertainties: ["high"]
    });
  });

  it("uses matching semantic gap guidance and needed evidence as the next action without a remediation request", () => {
    const [card] = toDashboardRequirementViewModels({
      requirements: [{ requirementId: "req_gap", status: "partial", evidenceRefs: ["ev_gap"], gaps: [] }],
      semantic: {
        requirement_evidence_relations: [],
        requirement_assessments: [],
        evidence_gaps: [{ requirement_id: "req_gap", gap_type: "missing_test_evidence", priority: "high", description: "A focused path is not supported by the available evidence.", review_impact: "Review remains limited.", needed_evidence: "A focused test result.", evidence_ids: ["ev_gap"], uncertainty: "high" }],
        review_targets: [],
        remediation_requests: [],
        uncertainties: []
      }
    });

    expect(card).toMatchObject({
      explanation: { state: "guidance", text: "A focused path is not supported by the available evidence." },
      nextAction: "A focused test result."
    });
  });

  it("omits a normalized duplicate next action while preserving distinct actionable text", () => {
    const cards = toDashboardRequirementViewModels({
      requirements: [
        { requirementId: "req_assessment_duplicate", status: "partial", evidenceRefs: [], gaps: [] },
        { requirementId: "req_gap_duplicate", status: "partial", evidenceRefs: [], gaps: [] },
        { requirementId: "req_distinct", status: "partial", evidenceRefs: [], gaps: [] }
      ],
      semantic: {
        requirement_evidence_relations: [],
        requirement_assessments: [{ requirement_id: "req_assessment_duplicate", requirement_summary: "Assessment", evidence_support: "partial_evidence_present", summary: "Add focused test coverage.", evidence_ids: [], uncertainty: "medium" }],
        evidence_gaps: [
          { requirement_id: "req_gap_duplicate", gap_type: "missing_test_evidence", priority: "high", description: "Provide focused test evidence.", review_impact: "Review is limited.", needed_evidence: " provide   focused TEST evidence. ", evidence_ids: [], uncertainty: "high" },
          { requirement_id: "req_distinct", gap_type: "missing_test_evidence", priority: "high", description: "A focused path is not covered.", review_impact: "Review is limited.", needed_evidence: "Provide the focused test result.", evidence_ids: [], uncertainty: "high" }
        ],
        review_targets: [],
        remediation_requests: [{ requirement_id: "req_assessment_duplicate", request_type: "add_or_update_test", priority: "high", instruction: " add  FOCUSED test coverage. ", rationale: "A focused test is needed.", expected_evidence: "A focused test.", evidence_ids: [], uncertainty: "medium" }],
        uncertainties: []
      }
    });

    expect(cards[0]).toMatchObject({ explanation: { state: "assessment", text: "Add focused test coverage." } });
    expect(cards[0]?.nextAction).toBeUndefined();
    expect(cards[0]?.actionIncluded).toBe(true);
    expect(cards[1]).toMatchObject({ explanation: { state: "guidance", text: "Provide focused test evidence." } });
    expect(cards[1]?.nextAction).toBeUndefined();
    expect(cards[1]?.actionIncluded).toBe(true);
    expect(cards[2]).toMatchObject({ explanation: { state: "guidance", text: "A focused path is not covered." }, nextAction: "Provide the focused test result.", actionIncluded: false });
  });

  it("labels unavailable supporting details honestly while retaining deterministic gaps", () => {
    const [card] = toDashboardRequirementViewModels({
      requirements: [{ requirementId: "req_3", status: "unclear", evidenceRefs: ["ev_3"], gaps: ["The check result was unavailable."] }],
      semanticAnalysis: { status: "unavailable", attempts: 2 }
    });

    expect(card).toMatchObject({
      status: "unclear",
      explanation: { state: "unavailable", text: "Some supporting details are unavailable. Available evidence is still shown." },
      deterministicGaps: ["The check result was unavailable."]
    });
  });

  it("uses the validated one-line objective summary before the tenant-safe fallback label", () => {
    const requirement = {
      requirementId: "req_4",
      requirementText: "Requirement req_4",
      status: "partial",
      evidenceRefs: [],
      gaps: []
    };

    const [card] = toDashboardRequirementViewModels({
      requirements: [requirement],
      semantic: {
        requirement_evidence_relations: [],
        requirement_assessments: [{
          requirement_id: "req_4",
          requirement_summary: "Show a fallback when the repository name is missing.",
          evidence_support: "partial_evidence_present",
          summary: "The normal path has evidence.",
          evidence_ids: [],
          uncertainty: "medium"
        }],
        evidence_gaps: [],
        review_targets: [],
        remediation_requests: [],
        uncertainties: []
      }
    });

    expect((card as typeof card & { objectiveText?: string }).objectiveText).toBe("Show a fallback when the repository name is missing.");
  });

  it("uses the requirement ID only when no validated objective summary is available", () => {
    const [card] = toDashboardRequirementViewModels({
      requirements: [{ requirementId: "req_5", requirementText: "Requirement req_5", status: "partial", evidenceRefs: [], gaps: [] }]
    });

    expect(card?.objectiveText).toBe("Requirement req_5");
  });
});
