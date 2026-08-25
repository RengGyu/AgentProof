import { describe, expect, it } from "vitest";
import { deriveRequirementPresentationV2 } from "./requirement-presentation-v2";
import type { VerificationReportV2 } from "./types";
import type { VerificationContractStateV2 } from "./verification-contract-v2";

describe("deriveRequirementPresentationV2", () => {
  it("keeps an unavailable authoritative outcome unclear even when observations are supported", () => {
    const result = deriveRequirementPresentationV2(report({
      contractState: "authoritative",
      status: "unclear",
      evidenceStatus: "met",
      criterionState: "unavailable",
      criterionGaps: ["evidence_unavailable"]
    }), "vc_o1");

    expect(result).toMatchObject({
      outcome: "unclear",
      observedEvidence: "met",
      outcomeLabel: "Unclear against approved contract",
      observationLabel: "Supported",
      outcomeBasis: "Required criterion evidence was incomplete or unavailable.",
      primaryGap: "evidence_unavailable"
    });
  });

  it("caps an author claim at partial even when every criterion is satisfied", () => {
    const result = deriveRequirementPresentationV2(report({
      contractState: "author_claim",
      status: "partial",
      evidenceStatus: "met",
      criterionState: "satisfied"
    }), "vc_o1");

    expect(result).toMatchObject({
      outcome: "partial",
      outcomeLabel: "Partially supported against PR-description contract",
      outcomeBasis: "This result uses a PR-description contract and requires reviewer confirmation."
    });
  });

  it("uses the report-level missing-contract gap before criterion gaps", () => {
    const result = deriveRequirementPresentationV2(report({
      contractState: "absent",
      status: "unclear",
      evidenceStatus: "met",
      contractGaps: ["verification_contract_missing"],
      criterionState: "unavailable",
      criterionGaps: ["evidence_unavailable"]
    }), "vc_o1");

    expect(result).toMatchObject({
      outcomeLabel: "Unclear — approved verification contract missing",
      primaryGap: "verification_contract_missing"
    });
  });
});

function report(input: {
  contractState: VerificationContractStateV2;
  status: "met" | "partial" | "missing" | "unclear";
  evidenceStatus: "met" | "partial" | "missing" | "unclear";
  criterionState: "satisfied" | "violated" | "incomplete" | "unavailable";
  contractGaps?: string[];
  criterionGaps?: string[];
}): VerificationReportV2 {
  const gapKinds = input.criterionGaps ?? [];
  return {
    reportSchemaVersion: "verification-report.v2",
    requirements: [{
      requirementId: "vc_o1",
      requirementText: "Return a label.",
      status: input.status,
      evidenceStatus: input.evidenceStatus,
      evidenceRefs: [],
      gaps: [],
      reviewerNote: "",
      confidence: 0
    }],
    verificationContract: {
      version: 2,
      policy: "strict_typed_contract",
      state: input.contractState,
      source: input.contractState === "absent" || input.contractState === "invalid" ? null : { kind: "linked_issue" },
      gaps: (input.contractGaps ?? []).map((kind) => ({ kind: kind as never, message: kind })),
      objectives: [{
        requirementId: "vc_o1",
        state: input.contractState === "author_claim" ? "author_claim" : "authoritative",
        criteria: [{
          criterionId: "vc_o1_c1",
          required: true,
          approval: input.contractState === "author_claim" ? "author_claim" : "source_explicit",
          label: "label",
          type: "artifact",
          artifactKind: "documentation_literal",
          requiredEvidence: ["documentation"]
        }],
        criterionResults: [{
          criterionId: "vc_o1_c1",
          state: input.criterionState,
          proofAxisRefs: [],
          evidenceRefs: [],
          gapKinds
        }]
      }]
    }
  } as unknown as VerificationReportV2;
}
