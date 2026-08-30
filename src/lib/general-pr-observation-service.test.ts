import { describe, expect, it, vi } from "vitest";
import {
  finalizeDeterministicGeneralPrObservationsV2,
  resolveGeneralPrObservationModeV2,
  runGeneralPrObservationNowV2
} from "./general-pr-observation-service";
import { deriveGeneralPrObjectiveGroupIdV2 } from "./general-pr-semantic-proposal";
import { buildGeneralPrObservationSeedV2 } from "./general-pr-observation-source";
import type { GeneralPrSemanticObserverModelProfileV2 } from "./general-pr-semantic-observer";
import type { PullRequestInput, VerificationReport } from "./types";

const report = { schemaVersion: "verification-report.v2", analysisId: "test" } as unknown as VerificationReport;
const input: PullRequestInput = {
  title: "Return Ready when checks pass",
  description: "The service must return Ready when checks pass.",
  taskText: "",
  changedFiles: [{ path: "src/status.ts", status: "modified" }],
  checks: [],
  logs: [],
  sourceProvenance: {
    version: 1,
    origin: "github_snapshot",
    baseSha: "b".repeat(40),
    headSha: "a".repeat(40),
    changedFileInventory: { version: 1, completeness: "complete", headSha: "a".repeat(40) },
    evidenceCapturedAt: "2026-08-31T00:00:00.000Z",
    inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" }
  }
};

const modelProfile: GeneralPrSemanticObserverModelProfileV2 = {
  model: "test-model",
  promptVersion: "test-prompt.v1",
  inputFieldPolicyVersion: "test-fields.v1"
};

function validProposal(observationSeed: ReturnType<typeof buildGeneralPrObservationSeedV2>) {
  const objectives = observationSeed.spans.filter((span) => span.deterministicRole === "objective_candidate");
  if (objectives.length === 0) throw new Error("fixture must include an objective candidate");
  const groups = objectives.map((objective) => {
    const groupId = deriveGeneralPrObjectiveGroupIdV2([objective.id]);
    return { groupId, spanIds: [objective.id], disposition: "candidate" as const };
  });
  const firstGroup = groups[0];
  const firstCluster = observationSeed.changeClusters[0];
  const firstEvidence = observationSeed.evidenceAtoms[0];
  if (!firstGroup || !firstCluster || !firstEvidence) throw new Error("fixture must include bounded change evidence");
  return {
    contractVersion: "general_pr_semantic_proposal.v2" as const,
    schemaVersion: "agentproof_general_pr_observer_v2" as const,
    seedHash: observationSeed.seedHash,
    spanRoles: Object.fromEntries(observationSeed.spans.map((span) => [span.id, {
      spanId: span.id,
      role: span.deterministicRole === "unresolved" ? "mixed_or_ambiguous" : span.deterministicRole,
      abstained: span.deterministicRole === "unresolved"
    }])),
    objectiveGroups: Object.fromEntries(groups.map((group) => [group.groupId, group])),
    testApplicabilityProposals: [{ objectiveGroupId: firstGroup.groupId, changeClusterId: firstCluster.id, proposal: "likely_expected" as const }],
    scopeMappingProposals: [{ objectiveGroupId: firstGroup.groupId, changeClusterId: firstCluster.id, proposal: "plausibly_mapped" as const }],
    evidenceRelationProposals: [{ objectiveGroupId: firstGroup.groupId, evidenceId: firstEvidence.id, proposal: "supports" as const }]
  };
}

describe("runGeneralPrObservationNowV2", () => {
  it("keeps the observation path disabled unless a supported mode is explicitly configured", () => {
    expect(resolveGeneralPrObservationModeV2(undefined)).toBe("disabled");
    expect(resolveGeneralPrObservationModeV2("")).toBe("disabled");
    expect(resolveGeneralPrObservationModeV2("unknown")).toBe("disabled");
    expect(resolveGeneralPrObservationModeV2("shadow")).toBe("shadow");
    expect(resolveGeneralPrObservationModeV2("advisory")).toBe("advisory");
  });

  it("returns the exact deterministic report when the feature is disabled", async () => {
    const generateReport = vi.fn(() => report);
    const result = await runGeneralPrObservationNowV2({ mode: "disabled", input, generateReport, validateDeterministicReport: () => true });

    expect(result.report).toBe(report);
    expect(result.bundle).toBeNull();
    expect(generateReport).toHaveBeenCalledTimes(1);
  });

  it("keeps the deterministic report unchanged in shadow mode while returning only private observations", async () => {
    const result = await runGeneralPrObservationNowV2({ mode: "shadow", input, generateReport: () => report, validateDeterministicReport: () => true });

    expect(result.report).toBe(report);
    expect(result.bundle).toMatchObject({ version: 2, semanticState: "unavailable" });
    expect(JSON.stringify(result.bundle)).not.toContain("Return Ready when checks pass");
  });

  it("returns the deterministic report when runtime validation or collection fails", async () => {
    const invalid = await runGeneralPrObservationNowV2({ mode: "shadow", input, generateReport: () => report, validateDeterministicReport: () => false });
    const oversized = await runGeneralPrObservationNowV2({ mode: "shadow", input: { ...input, description: "x".repeat(64_001) }, generateReport: () => report, validateDeterministicReport: () => true });

    expect(invalid).toMatchObject({ report, bundle: null });
    expect(oversized).toMatchObject({ report, bundle: null });
  });

  it("records a valid semantic proposal only as private hypothesis observations", async () => {
    const observationSeed = buildGeneralPrObservationSeedV2(input);
    const provider = { observe: vi.fn(async () => validProposal(observationSeed)) };
    const result = await runGeneralPrObservationNowV2({
      mode: "shadow",
      input,
      generateReport: () => report,
      validateDeterministicReport: () => true,
      semantic: {
        provider,
        providerAvailable: true,
        privateRepository: false,
        readCurrentInput: async () => input,
        modelProfile
      }
    });

    expect(result.report).toBe(report);
    expect(provider.observe).toHaveBeenCalledTimes(1);
    expect(result.bundle).toMatchObject({ semanticState: "valid" });
    expect(result.bundle?.objectives).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: "hypothesis", admissionBasis: "semantic_proposal" })
    ]));
    expect(result.bundle?.testCoverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ applicability: "hypothesized_required", relation: "hypothesis", summaryState: "relation_unresolved" })
    ]));
    expect(result.bundle?.scopeMappings).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: "plausibly_mapped" })
    ]));
    expect(result.bundle?.ledgerDigest).not.toBe(finalizeDeterministicGeneralPrObservationsV2(observationSeed).ledgerDigest);
    expect(JSON.stringify(result.bundle)).not.toContain("test-model");
  });
});
