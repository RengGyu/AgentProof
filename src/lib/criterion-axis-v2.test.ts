import { describe, expect, it } from "vitest";
import { buildV2CriterionOwnedAxes } from "./criterion-axis-v2";
import { materializeVerificationContractV2, parseVerificationContractV2 } from "./verification-contract-v2";
import type { RequirementProofAxis } from "./types";

describe("buildV2CriterionOwnedAxes", () => {
  it("derives return-value axes from the typed criterion, not objective wording", () => {
    const parsed = parseVerificationContractV2({
      kind: "provided_requirement",
      contract: {
        version: 2,
        scope: "complete_objective_set",
        objectives: [{
          id: "label",
          objective: "Return a repository label.",
          criteria: [{
            id: "value",
            type: "return_value",
            label: "Returns a label.",
            adapter: { id: "node_export_scalar.v1", modulePath: "src/label.ts", exportName: "label", moduleFormat: "esm" },
            cases: [{ id: "value", input: true, expected: "private" }]
          }]
        }]
      }
    });
    if (parsed.state !== "authoritative") throw new Error("expected authoritative contract");
    const materialized = materializeVerificationContractV2(parsed, "a".repeat(64));
    const observations = new Map<string, RequirementProofAxis[]>([["vc_o1", [{
      subject: "implementation", polarity: "present", state: "satisfied", evidenceRefs: ["ev_implementation"], collectionBasis: "matching_artifact_evidence"
    }]]]);

    const result = buildV2CriterionOwnedAxes({
      materialized,
      observations,
      evaluations: [{ criterionId: "vc_o1_c1", state: "unavailable", proofAxisRefs: [], evidenceRefs: [], gapKinds: ["evidence_unavailable"] }]
    });

    expect(result.axesByRequirement.get("vc_o1")).toEqual(expect.arrayContaining([
      expect.objectContaining({ axisId: "obs_vc_o1_implementation_1", role: "observation", criterionId: undefined }),
      expect.objectContaining({ axisId: "ax_vc_o1_vc_o1_c1_implementation_present", role: "criterion", criterionId: "vc_o1_c1", state: "incomplete" }),
      expect.objectContaining({ axisId: "ax_vc_o1_vc_o1_c1_targeted_test_present", role: "criterion", criterionId: "vc_o1_c1", state: "incomplete" }),
      expect.objectContaining({ axisId: "ax_vc_o1_vc_o1_c1_execution_present", role: "criterion", criterionId: "vc_o1_c1", state: "incomplete" })
    ]));
    expect(result.evaluations[0]?.proofAxisRefs).toEqual([
      "ax_vc_o1_vc_o1_c1_implementation_present",
      "ax_vc_o1_vc_o1_c1_targeted_test_present",
      "ax_vc_o1_vc_o1_c1_execution_present"
    ]);
  });
});
