import { describe, expect, it } from "vitest";
import {
  buildObjectiveEvidenceRelationLedgerV1,
  canUseRelationForReleasedReceiptV1,
  validateObjectiveEvidenceRelationLedgerV1,
  type RelationEdgeCandidateV1,
  type RelationNodeV1
} from "./objective-evidence-relation-ledger";

const subject = "a".repeat(64);
const anotherSubject = "b".repeat(64);

function nodes(): RelationNodeV1[] {
  return [
    { version: 1, id: "objective_a", kind: "objective_group", subjectDigest: subject },
    { version: 1, id: "objective_b", kind: "objective_group", subjectDigest: subject },
    { version: 1, id: "artifact_a", kind: "test_artifact", subjectDigest: subject },
    { version: 1, id: "execution_a", kind: "workflow_execution", subjectDigest: subject }
  ];
}

function edge(overrides: Partial<RelationEdgeCandidateV1> = {}): RelationEdgeCandidateV1 {
  return {
    fromNodeId: "objective_a",
    toNodeId: "artifact_a",
    kind: "syntax_imports",
    level: "verified",
    basis: "typescript_ast_relation",
    subjectDigest: subject,
    evidenceRefs: ["ev_a"],
    completeness: "complete",
    ...overrides
  };
}

describe("ObjectiveEvidenceRelationLedgerV1", () => {
  it("keeps verification levels distinct and computes consumer ceilings from the closed matrix", () => {
    const result = buildObjectiveEvidenceRelationLedgerV1({
      nodes: nodes(),
      edges: [
        edge(),
        edge({ level: "observed", evidenceRefs: ["ev_observed"] }),
        edge({ level: "hypothesis", basis: "semantic_proposal", kind: "semantic_supports", evidenceRefs: ["ev_hypothesis"] }),
        edge({ level: "unresolved", evidenceRefs: ["ev_unresolved"] }),
        edge({ level: "unavailable", evidenceRefs: ["ev_unavailable"] })
      ]
    });

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.ledger.edges.map((relation) => [relation.level, relation.consumerCeiling])).toEqual(expect.arrayContaining([
      ["verified", "test_relation_component"],
      ["observed", "observation_only"],
      ["hypothesis", "observation_only"],
      ["unresolved", "observation_only"],
      ["unavailable", "observation_only"]
    ]));
  });

  it("allows semantic input only as hypothesis and refuses incomplete deterministic verification", () => {
    const semanticVerified = buildObjectiveEvidenceRelationLedgerV1({
      nodes: nodes(),
      edges: [edge({ kind: "semantic_supports", basis: "semantic_proposal", level: "verified" })]
    });
    const incompleteVerified = buildObjectiveEvidenceRelationLedgerV1({
      nodes: nodes(),
      edges: [edge({ completeness: "incomplete" })]
    });

    expect(semanticVerified).toMatchObject({ valid: false });
    expect(incompleteVerified).toMatchObject({ valid: false });
  });

  it("rejects wrong subjects, cross-objective verified evidence reuse, copied receipts, and forged ceilings", () => {
    const wrongSubject = buildObjectiveEvidenceRelationLedgerV1({ nodes: nodes(), edges: [edge({ subjectDigest: anotherSubject })] });
    const copiedReceipt = buildObjectiveEvidenceRelationLedgerV1({
      nodes: nodes(),
      edges: [edge(), edge({ fromNodeId: "objective_b", evidenceRefs: ["ev_a"] })]
    });
    const valid = buildObjectiveEvidenceRelationLedgerV1({ nodes: nodes(), edges: [edge()] });
    if (!valid.valid) throw new Error("fixture must build");
    const forged = { ...valid.ledger, edges: valid.ledger.edges.map((relation) => ({ ...relation, consumerCeiling: "artifact_binding_component" as const })) };

    expect(wrongSubject).toMatchObject({ valid: false });
    expect(copiedReceipt).toMatchObject({ valid: false });
    expect(validateObjectiveEvidenceRelationLedgerV1(forged)).toMatchObject({ valid: false });
  });

  it("has an order-independent digest and does not let syntax imports become a receipt or satisfaction proof", () => {
    const candidates = [edge(), edge({ kind: "executed_in", basis: "github_execution_identity", fromNodeId: "artifact_a", toNodeId: "execution_a", evidenceRefs: ["ev_execution"] })];
    const first = buildObjectiveEvidenceRelationLedgerV1({ nodes: nodes(), edges: candidates });
    const second = buildObjectiveEvidenceRelationLedgerV1({ nodes: nodes(), edges: [...candidates].reverse() });

    expect(first).toMatchObject({ valid: true });
    expect(second).toMatchObject({ valid: true });
    if (!first.valid || !second.valid) return;
    expect(first.ledger.ledgerDigest).toBe(second.ledger.ledgerDigest);
    expect(canUseRelationForReleasedReceiptV1(first.ledger.edges.find((relation) => relation.kind === "syntax_imports")!, true)).toBe(false);
    expect(canUseRelationForReleasedReceiptV1(first.ledger.edges.find((relation) => relation.kind === "executed_in")!, false)).toBe(false);
  });
});
