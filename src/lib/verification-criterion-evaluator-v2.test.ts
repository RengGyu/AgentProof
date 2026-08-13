import { describe, expect, it } from "vitest";
import {
  evaluateVerificationCriterionV2,
  type VerificationCriterionEvidenceV2
} from "./verification-criterion-evaluator-v2";
import { parseVerificationContractV2 } from "./verification-contract-v2";

const headSha = "a".repeat(40);

describe("evaluateVerificationCriterionV2", () => {
  it("satisfies a documentation literal only from the exact head artifact", () => {
    const criterion = documentationCriterion();
    const evidence: VerificationCriterionEvidenceV2 = {
      headSha,
      artifactBlobs: [{
        path: "docs/reset.md",
        content: "Stop the local server.\nRun npm test."
      }],
      changedFileInventory: { completeness: "complete", paths: ["docs/reset.md"] },
      evidenceRefsByPath: { "docs/reset.md": ["ev_1"] }
    };

    expect(evaluateVerificationCriterionV2(criterion, evidence)).toEqual({
      criterionId: "reset_instructions",
      state: "satisfied",
      proofAxisRefs: [],
      evidenceRefs: ["ev_1"],
      gapKinds: []
    });
  });

  it("does not satisfy a documentation literal from a missing or mismatched head artifact", () => {
    const criterion = documentationCriterion();
    const evidence: VerificationCriterionEvidenceV2 = {
      headSha,
      artifactBlobs: [{ path: "docs/reset.md", content: "Stop the local server." }],
      changedFileInventory: { completeness: "complete", paths: ["docs/reset.md"] },
      evidenceRefsByPath: { "docs/reset.md": ["ev_1"] }
    };

    expect(evaluateVerificationCriterionV2(criterion, evidence)).toMatchObject({
      criterionId: "reset_instructions",
      state: "violated",
      evidenceRefs: ["ev_1"],
      gapKinds: ["missing_implementation"]
    });
  });

  it("does not satisfy absence from an incomplete changed-file inventory", () => {
    const criterion = absenceCriterion();
    const evidence: VerificationCriterionEvidenceV2 = {
      headSha,
      artifactBlobs: [],
      changedFileInventory: { completeness: "incomplete", paths: [] },
      evidenceRefsByPath: {}
    };

    expect(evaluateVerificationCriterionV2(criterion, evidence)).toEqual({
      criterionId: "no_runtime_change",
      state: "unavailable",
      proofAxisRefs: [],
      evidenceRefs: [],
      gapKinds: ["evidence_unavailable"]
    });
  });

  it("marks absence violated when a new or old changed path enters the prohibited scope", () => {
    const criterion = absenceCriterion();
    const evidence: VerificationCriterionEvidenceV2 = {
      headSha,
      artifactBlobs: [],
      changedFileInventory: {
        completeness: "complete",
        paths: ["src/runtime/new.ts"],
        previousPaths: ["src/runtime/old.ts"]
      },
      evidenceRefsByPath: {
        "src/runtime/new.ts": ["ev_2"],
        "src/runtime/old.ts": ["ev_2"]
      }
    };

    expect(evaluateVerificationCriterionV2(criterion, evidence)).toEqual({
      criterionId: "no_runtime_change",
      state: "violated",
      proofAxisRefs: [],
      evidenceRefs: ["ev_2"],
      gapKinds: ["forbidden_implementation_present"]
    });
  });
});

function documentationCriterion() {
  const parsed = parseVerificationContractV2({
    kind: "provided_requirement",
    contract: {
      version: 2,
      scope: "complete_objective_set",
      objectives: [{
        id: "reset",
        objective: "Document the local reset command.",
        criteria: [{
          id: "reset_instructions",
          type: "artifact",
          label: "The reset document includes the test command.",
          paths: ["docs/reset.md"],
          artifact: { kind: "documentation_literal", literal: "Run npm test." }
        }]
      }]
    }
  });
  if (parsed.state !== "authoritative") throw new Error("expected a contract");
  const criterion = parsed.contract.objectives[0]?.criteria[0];
  if (!criterion || criterion.type !== "artifact") throw new Error("expected documentation criterion");
  return criterion;
}

function absenceCriterion() {
  const parsed = parseVerificationContractV2({
    kind: "provided_requirement",
    contract: {
      version: 2,
      scope: "complete_objective_set",
      objectives: [{
        id: "runtime",
        objective: "Do not change the runtime directory.",
        criteria: [{
          id: "no_runtime_change",
          type: "absence",
          label: "No runtime paths change.",
          prohibitedKind: "path_change",
          scope: [{ kind: "prefix", path: "src/runtime/" }]
        }]
      }]
    }
  });
  if (parsed.state !== "authoritative") throw new Error("expected a contract");
  const criterion = parsed.contract.objectives[0]?.criteria[0];
  if (!criterion || criterion.type !== "absence") throw new Error("expected absence criterion");
  return criterion;
}
