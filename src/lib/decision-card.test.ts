import { describe, expect, it } from "vitest";
import { buildDecisionCard } from "./decision-card";
import type { ProofGapSignal, VerificationReport } from "./types";

function reportWithGaps(gaps: ProofGapSignal[]): VerificationReport {
  const evidenceIndex = [
    { id: "opaque-file-ref", kind: "changed_file" as const, label: "src/opaque.ts", locator: "src/opaque.ts", summary: "Bounded file evidence.", confidence: 0.9 },
    { id: "opaque-check-ref", kind: "check" as const, label: "Test", locator: "https://github.com/opaque/repo/actions/runs/42", summary: "Status: failed; bounded check evidence.", confidence: 0.9 }
  ];
  return {
    analysisId: "opaque-analysis",
    createdAt: "2026-07-20T00:00:00.000Z",
    source: { title: "Opaque report", url: "https://github.com/opaque/repo/pull/7", provenance: { version: 1, origin: "github_snapshot", headSha: "a".repeat(40), evidenceCapturedAt: "2026-07-20T00:00:00.000Z", inputFingerprint: { version: 1, algorithm: "sha256", value: "b".repeat(64), coverage: "github_metadata" } } },
    summary: { oneLine: "Bounded report.", confidence: 0.5, priority: "medium", evidenceCoverage: 50, topRisks: [] },
    requirements: [{ requirementId: "opaque-requirement", requirementText: "Opaque requirement.", status: gaps.length ? "partial" : "met", evidenceRefs: ["opaque-file-ref"], gaps: gaps.map((gap) => gap.message), reviewerNote: "Inspect evidence.", confidence: 0.5 }],
    claims: [],
    scope: { suspected: false, outOfScopeFiles: [], reasons: [] },
    testing: { ciStatus: "passed", lintStatus: "passed", typecheckStatus: "passed", missingTests: [] },
    reviewPriority: [{ path: "src/opaque.ts", reason: "Inspect bounded evidence.", priority: "medium", evidenceRefs: ["opaque-file-ref"] }],
    proofGraph: { version: 1, nodes: [{ requirementId: "opaque-requirement", requirementText: "Opaque requirement.", sourceRole: "core_requirement", sourceQuality: "linked_issue", sourceSection: null, contextRoles: [], status: gaps.length ? "partial" : "met", confidence: 0.5, implementationEvidenceRefs: ["opaque-file-ref"], targetedTestEvidenceRefs: [], executionEvidenceRefs: [], gapSignals: gaps, firstFiles: ["src/opaque.ts"] }], context: [], summary: { requirementCount: 1, requirementsWithImplementation: 1, requirementsWithTargetedTests: 0, requirementsWithExecution: 0, requirementsWithGaps: gaps.length ? 1 : 0, gapCount: gaps.length } },
    reprompt: { targetAgent: "codex", prompt: "Inspect bounded evidence.", evidenceRefs: ["opaque-file-ref"] },
    evidenceIndex,
    limitations: []
  };
}

describe("Decision Card gap policy", () => {
  it("keeps a zero-gap report honest without fabricating a gap or re-prompt", () => {
    const card = buildDecisionCard(reportWithGaps([]));
    expect(card.topGap).toBeNull();
    expect(card.reprompt).toBeNull();
    expect(card.testBuildStatus).toBe("passed");
    expect(card.firstInspectionPoints.length).toBeGreaterThanOrEqual(1);
    expect(card.firstInspectionPoints.length).toBeLessThanOrEqual(2);
    expect(card.firstInspectionPoints.every((point) => point.evidenceRefs.length > 0)).toBe(true);
  });

  it("binds a single gap and re-prompt to the same resolvable evidence", () => {
    const card = buildDecisionCard(reportWithGaps([{ kind: "evidence_insufficient", severity: "medium", message: "Additional proof is needed.", evidenceRefs: ["opaque-file-ref"] }]));
    expect(card.topGap).toMatchObject({ kind: "evidence_insufficient", evidenceRefs: ["opaque-file-ref"] });
    expect(card.reprompt).toMatchObject({ gapKey: card.topGap?.gapKey, basedOnGapKind: "evidence_insufficient", evidenceRefs: ["opaque-file-ref"] });
  });

  it("chooses N gaps by general severity and kind rules regardless of input order", () => {
    const gaps: ProofGapSignal[] = [
      { kind: "evidence_insufficient", severity: "medium", message: "More proof needed.", evidenceRefs: ["opaque-file-ref"] },
      { kind: "failed_execution", severity: "blocker", message: "Execution failed.", evidenceRefs: ["opaque-check-ref"] },
      { kind: "missing_targeted_test", severity: "high", message: "Targeted proof missing.", evidenceRefs: ["opaque-file-ref"] }
    ];
    for (const permutation of [gaps, [...gaps].reverse(), [gaps[1], gaps[2], gaps[0]]]) {
      const card = buildDecisionCard(reportWithGaps(permutation));
      expect(card.topGap).toMatchObject({ kind: "failed_execution", severity: "blocker", evidenceRefs: ["opaque-check-ref"] });
      expect(card.reprompt?.evidenceRefs).toEqual(["opaque-check-ref"]);
    }
  });

  it("keeps the same semantic choice across requirement, evidence, and gap permutations with arbitrary IDs", () => {
    const base = reportWithGaps([{ kind: "evidence_insufficient", severity: "medium", message: "Collected proof is insufficient.", evidenceRefs: ["opaque-file-ref"] }]);
    const secondRequirement = { ...base.requirements[0], requirementId: "req-random-9f", requirementText: "Second opaque requirement." };
    const secondNode = {
      ...base.proofGraph.nodes[0], requirementId: secondRequirement.requirementId, requirementText: secondRequirement.requirementText,
      gapSignals: [{ kind: "missing_execution" as const, severity: "medium" as const, message: "Execution evidence is missing.", evidenceRefs: ["opaque-check-ref"] }]
    };
    base.requirements.push(secondRequirement);
    base.proofGraph.nodes.push(secondNode);
    base.proofGraph.summary = { ...base.proofGraph.summary, requirementCount: 2, requirementsWithGaps: 2, gapCount: 2 };

    const variants = [
      base,
      { ...base, requirements: [...base.requirements].reverse(), evidenceIndex: [...base.evidenceIndex].reverse(), proofGraph: { ...base.proofGraph, nodes: [...base.proofGraph.nodes].reverse() } }
    ];
    for (const variant of variants) {
      const card = buildDecisionCard(variant);
      expect(card.topGap).toMatchObject({ requirementId: "req-random-9f", kind: "missing_execution", severity: "medium", evidenceRefs: ["opaque-check-ref"] });
      expect(card.reprompt).toMatchObject({ gapKey: card.topGap?.gapKey, basedOnGapKind: "missing_execution", evidenceRefs: ["opaque-check-ref"] });
    }
  });

  it("drops dangling gap references instead of producing an unbound action", () => {
    const card = buildDecisionCard(reportWithGaps([{ kind: "missing_execution", severity: "high", message: "Execution missing.", evidenceRefs: ["unknown-ref"] }]));
    expect(card.topGap).toBeNull();
    expect(card.reprompt).toBeNull();
  });
});
