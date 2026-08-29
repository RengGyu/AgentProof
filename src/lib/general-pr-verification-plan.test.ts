import { describe, expect, it } from "vitest";
import { classifyGeneralPrClaimsV1 } from "./general-pr-claim-classifier";
import { parseGeneralPrStructureV1 } from "./general-pr-structure";
import {
  deriveGeneralPrAdvisoryPlansV1,
  materializeTypedExecutablePlansV1
} from "./general-pr-verification-plan";
import { materializeVerificationContractV2, parseVerificationContractV2 } from "./verification-contract-v2";

function materializedDocumentationContract() {
  const parsed = parseVerificationContractV2({
    kind: "provided_requirement",
    contract: {
      version: 2,
      scope: "complete_objective_set",
      objectives: [{
        id: "documentation_label",
        objective: "Document the public label.",
        criteria: [{
          id: "documented_label",
          type: "artifact",
          label: "Public label is documented",
          paths: ["docs/label.md"],
          artifact: { kind: "documentation_literal", literal: "Public label" }
        }]
      }]
    }
  });
  if (parsed.state !== "authoritative") throw new Error("test contract must be authoritative");
  return materializeVerificationContractV2(parsed, "a".repeat(64));
}

describe("general PR verification plans", () => {
  it("creates advisory-only plans for ordinary objective, test, and scope spans", () => {
    const source = [
      "## Requirements",
      "The service must return Ready.",
      "## Testing",
      "pnpm test passed.",
      "## Scope",
      "A follow-up will add analytics."
    ].join("\n\n");
    const classifications = classifyGeneralPrClaimsV1(source, parseGeneralPrStructureV1(source));

    const plans = deriveGeneralPrAdvisoryPlansV1(classifications);

    expect(plans).toEqual(expect.arrayContaining([
      expect.objectContaining({ suggestionCode: "confirm_acceptance_criterion", resultCeiling: "none" }),
      expect.objectContaining({ suggestionCode: "collect_external_execution_evidence", resultCeiling: "none" }),
      expect.objectContaining({ suggestionCode: "clarify_scope", resultCeiling: "none" })
    ]));
    expect(JSON.stringify(plans)).not.toContain("return Ready");
    expect(JSON.stringify(plans)).not.toContain("expected_axes");
    expect(JSON.stringify(plans)).not.toContain("evidenceRefs");
  });

  it("materializes an executable plan only for an authoritative typed documentation contract", () => {
    const materialized = materializedDocumentationContract();

    expect(materializeTypedExecutablePlansV1(materialized)).toEqual([{
      version: 1,
      criterionId: "vc_o1_c1",
      capabilityId: "documentation_literal.v1",
      sourceBindingDigest: "a".repeat(64)
    }]);
    expect(materializeTypedExecutablePlansV1({ ...materialized, state: "author_claim" })).toEqual([]);
  });

  it("keeps deferred and unreleased contract capabilities unavailable", () => {
    const materialized = materializedDocumentationContract();
    const deferred = {
      ...materialized,
      objectives: materialized.objectives.map((objective) => ({
        ...objective,
        criteria: objective.criteria.map((criterion) => ({
          ...criterion,
          source: {
            id: criterion.source.id,
            type: "artifact" as const,
            label: criterion.source.label,
            paths: criterion.source.type === "artifact" ? criterion.source.paths : [],
            artifact: { kind: "test_case" as const, testId: "test/id" }
          }
        }))
      }))
    };

    expect(materializeTypedExecutablePlansV1(deferred)).toEqual([]);
  });
});
