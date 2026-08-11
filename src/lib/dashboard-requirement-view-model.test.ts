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
      requirements: [{ requirementId: "req_2", status: "missing", evidenceRefs: [], gaps: ["Targeted test evidence is missing for this requirement."] }],
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
      explanation: { state: "guidance", text: "Review the key evidence gap and next action." },
      primaryGap: "Targeted test evidence is missing for this requirement.",
      nextAction: "Add or link a targeted test and its Check result for the requirement.",
      semanticEvidenceIds: [],
      uncertainties: ["high"]
    });
  });

  it("does not promote a semantic gap when deterministic verification recorded no gap", () => {
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
      explanation: { state: "none", text: "No additional supporting details are available for this requirement." }
    });
    expect(card?.primaryGap).toBeUndefined();
    expect(card?.nextAction).toBeUndefined();
  });

  it("prefers a distinct deterministic gap over semantic interpretation in the compact card", () => {
    const [card] = toDashboardRequirementViewModels({
      requirements: [{ requirementId: "req_deterministic", requirementText: "Show retry status.", status: "partial", evidenceRefs: ["ev_1"], gaps: ["A passed execution check was not captured."] }],
      semantic: {
        requirement_evidence_relations: [],
        requirement_assessments: [{ requirement_id: "req_deterministic", requirement_summary: "Show retry status.", evidence_support: "partial_evidence_present", summary: "The status update has file evidence.", evidence_ids: ["ev_1"], uncertainty: "medium" }],
        evidence_gaps: [{ requirement_id: "req_deterministic", gap_type: "missing_check_evidence", priority: "medium", description: "The semantic reading needs an execution check.", review_impact: "Coverage is incomplete.", needed_evidence: "A passing check result.", evidence_ids: ["ev_1"], uncertainty: "medium" }],
        review_targets: [],
        remediation_requests: [],
        uncertainties: []
      }
    });

    expect(card).toMatchObject({
      explanation: { state: "assessment", text: "The status update has file evidence." },
      primaryGap: "A passed execution check was not captured."
    });
    expect(card.nextAction).toBeUndefined();
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
    expect(cards[0]?.actionIncluded).toBe(false);
    expect(cards[1]).toMatchObject({ explanation: { state: "none", text: "No additional supporting details are available for this requirement." } });
    expect(cards[1]?.nextAction).toBeUndefined();
    expect(cards[1]?.actionIncluded).toBe(false);
    expect(cards[2]).toMatchObject({ explanation: { state: "none", text: "No additional supporting details are available for this requirement." }, actionIncluded: false });
    expect(cards[2]?.primaryGap).toBeUndefined();
    expect(cards[2]?.nextAction).toBeUndefined();
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

  it("shows a deterministic-only gap once and omits overlong semantic text instead of manufacturing a sentence", () => {
    const longSentence = `${"A bounded evidence reading remains concise ".repeat(12)}without cutting the final word.`;
    const [card] = toDashboardRequirementViewModels({
      requirements: [{ requirementId: "req_bounded", requirementText: longSentence, status: "partial", evidenceRefs: ["ev_1"], gaps: [longSentence] }],
      semantic: {
        requirement_evidence_relations: [],
        requirement_assessments: [{ requirement_id: "req_bounded", requirement_summary: longSentence, evidence_support: "partial_evidence_present", summary: longSentence, evidence_ids: ["ev_1"], uncertainty: "medium" }],
        evidence_gaps: [],
        review_targets: [{ target_type: "file", target_evidence_id: "ev_1", priority: "medium", reason: "Review the bounded evidence.", inspection_goal: longSentence, requirement_ids: ["req_bounded"], evidence_ids: ["ev_1"], uncertainty: "medium" }],
        remediation_requests: [{ requirement_id: "req_bounded", request_type: "provide_or_link_evidence", priority: "medium", instruction: `Provide ${longSentence}`, rationale: "More evidence is needed.", expected_evidence: "A bounded reference.", evidence_ids: ["ev_1"], uncertainty: "medium" }],
        uncertainties: []
      }
    });
    const [deterministicOnly] = toDashboardRequirementViewModels({
      requirements: [{ requirementId: "req_once", status: "partial", evidenceRefs: [], gaps: ["A deterministic check is missing."] }]
    });

    expect(deterministicOnly).toMatchObject({
      explanation: { state: "guidance", text: "Review the key evidence gap and next action." },
      primaryGap: "A deterministic check is missing."
    });
    expect(deterministicOnly.explanation.text).not.toContain("Evidence gap:");
    expect(card?.objectiveText).toBeUndefined();
    expect(card?.explanation).toEqual({ state: "none", text: "No additional supporting details are available for this requirement." });
    expect(card?.nextAction).toBeUndefined();
    expect(card?.inspectFirst).toBeUndefined();
    expect(card?.explanation.text).not.toContain("A bounded evidence reading remains concise");
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

  it("leaves objective text absent so renderers can use the requirement ID only as a fallback", () => {
    const [card] = toDashboardRequirementViewModels({
      requirements: [{ requirementId: "req_5", requirementText: "Requirement req_5", status: "partial", evidenceRefs: [], gaps: [] }]
    });

    expect(card?.objectiveText).toBeUndefined();
  });

  it("projects one primary gap and one inspect-first action instead of semantic array dumps", () => {
    const [card] = toDashboardRequirementViewModels({
      requirements: [{ requirementId: "req_compact", requirementText: "Requirement req_compact", status: "partial", evidenceRefs: ["ev_1"], gaps: ["Deterministic gap."] }],
      semantic: {
        requirement_evidence_relations: [],
        requirement_assessments: [{ requirement_id: "req_compact", requirement_summary: "Show a retry status.", evidence_support: "partial_evidence_present", summary: "The supplied evidence covers the status update.", evidence_ids: ["ev_1"], uncertainty: "medium" }],
        evidence_gaps: [{ requirement_id: "req_compact", gap_type: "missing_test_evidence", priority: "high", description: "The retry failure path is not evidenced.", review_impact: "Coverage remains partial.", needed_evidence: "A focused retry failure test.", evidence_ids: ["ev_1"], uncertainty: "high" }],
        review_targets: [{ target_type: "file", target_evidence_id: "ev_1", priority: "high", reason: "The status update is relevant.", inspection_goal: "Inspect the retry status transition.", requirement_ids: ["req_compact"], evidence_ids: ["ev_1"], uncertainty: "medium" }],
        remediation_requests: [{ requirement_id: "req_compact", request_type: "add_or_update_test", priority: "high", instruction: "Add the focused retry failure test.", rationale: "The failure path is not evidenced.", expected_evidence: "A passing focused test.", evidence_ids: ["ev_1"], uncertainty: "medium" }],
        uncertainties: []
      }
    });

    expect(card).toMatchObject({
      objectiveText: "Show a retry status.",
      primaryGap: "Deterministic gap."
    });
    expect(card.nextAction).toBeUndefined();
    expect(card?.inspectFirst).toBe("Inspect the retry status transition.");
  });

  it("does not surface unavailable, truncated, or raw-detail actions", () => {
    const cards = toDashboardRequirementViewModels({
      requirements: [
        { requirementId: "req_1", status: "partial", evidenceRefs: [], gaps: [] },
        { requirementId: "req_2", status: "partial", evidenceRefs: [], gaps: [] }
      ],
      semantic: {
        requirement_evidence_relations: [],
        requirement_assessments: [],
        evidence_gaps: [],
        review_targets: [
          { target_type: "file", target_evidence_id: "ev_1", priority: "medium", reason: "Review.", inspection_goal: "unavailable", requirement_ids: ["req_1"], evidence_ids: [], uncertainty: "medium" },
          { target_type: "file", target_evidence_id: "ev_2", priority: "medium", reason: "Review.", inspection_goal: "Inspect the remaining implementation…", requirement_ids: ["req_2"], evidence_ids: [], uncertainty: "medium" }
        ],
        remediation_requests: [
          { requirement_id: "req_1", request_type: "provide_or_link_evidence", priority: "medium", instruction: "Provide job-run logs.", rationale: "More detail.", expected_evidence: "Logs.", evidence_ids: [], uncertainty: "medium" }
        ],
        uncertainties: []
      }
    });

    expect(cards[0]?.nextAction).toBeUndefined();
    expect(cards[0]?.inspectFirst).toBeUndefined();
    expect(cards[1]?.inspectFirst).toBeUndefined();
  });
});
