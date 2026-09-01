import { describe, expect, it } from "vitest";
import { deriveGeneralPrAssessmentV1 } from "./general-pr-assessment";
import { finalizeDeterministicGeneralPrObservationsV2 } from "./general-pr-observation-service";
import { buildGeneralPrObservationSeedV2 } from "./general-pr-observation-source";
import type { PullRequestInput, VerificationReport } from "./types";

const report = { requirements: [], evidenceIndex: [] } as unknown as VerificationReport;

function input(overrides: Partial<PullRequestInput> = {}): PullRequestInput {
  return {
    title: "Return the repository label",
    description: "",
    taskText: "",
    changedFiles: [
      { path: "src/repository-label.ts", status: "modified" },
      { path: "test/repository-label.test.ts", status: "modified" }
    ],
    checks: [{ name: "CI", status: "passed" }],
    logs: [],
    repositoryPrivate: false,
    sourceProvenance: {
      version: 1,
      origin: "github_snapshot",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      changedFileInventory: { version: 1, completeness: "complete", headSha: "b".repeat(40) },
      evidenceCapturedAt: "2026-08-31T00:00:00.000Z",
      inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" }
    },
    ...overrides
  };
}

describe("deriveGeneralPrAssessmentV1", () => {
  it("caps a PR author objective at partial when only changed artifacts and global CI are observed", () => {
    const seed = buildGeneralPrObservationSeedV2(input());
    const bundle = finalizeDeterministicGeneralPrObservationsV2(seed);

    expect(deriveGeneralPrAssessmentV1({ seed, bundle, report })).toMatchObject({
      sourceState: "pr_author_claim",
      overallConclusion: "mixed_evidence",
      counts: {
        evidence_supported: 0,
        evidence_partial: 1,
        not_demonstrated: 0,
        contradicted: 0,
        blocked: 0,
        not_assessable: 0
      },
      targets: [expect.objectContaining({
        conclusion: "evidence_partial",
        reasonCodes: expect.arrayContaining(["verified_relation_missing", "author_claim_requires_confirmation"]),
        evidenceRefs: [],
        headBound: true
      })]
    });
  });

  it("blocks a target when complete exact-head collection is unavailable", () => {
    const seed = buildGeneralPrObservationSeedV2(input({ sourceProvenance: undefined }));
    const bundle = finalizeDeterministicGeneralPrObservationsV2(seed);

    expect(deriveGeneralPrAssessmentV1({ seed, bundle, report })).toMatchObject({
      overallConclusion: "collection_blocked",
      counts: expect.objectContaining({ blocked: 1 }),
      targets: [expect.objectContaining({
        conclusion: "blocked",
        reasonCodes: expect.arrayContaining(["collection_incomplete"]),
        headBound: false
      })]
    });
  });

  it("retains PR-author source state and diagnostic reasons when no target is admitted", () => {
    const seed = buildGeneralPrObservationSeedV2(input({ title: "Maintenance notes", description: "Internal cleanup only." }));
    const bundle = finalizeDeterministicGeneralPrObservationsV2(seed, null, "unavailable");

    expect(deriveGeneralPrAssessmentV1({ seed, bundle, report })).toMatchObject({
      sourceState: "pr_author_claim",
      overallConclusion: "no_assessable_claims",
      reasonCodes: expect.arrayContaining(["deterministic_candidate_missing", "semantic_observer_unavailable"])
    });
  });

  it("retains linked-Issue source state with zero targets and marks stale ownership ambiguous", () => {
    const seed = buildGeneralPrObservationSeedV2(input({
      title: "Maintenance notes",
      taskSource: "issue",
      taskText: "Background information about the current status page."
    }));
    const available = finalizeDeterministicGeneralPrObservationsV2(seed, null, "unavailable");
    const stale = finalizeDeterministicGeneralPrObservationsV2(seed, null, "stale");

    expect(deriveGeneralPrAssessmentV1({ seed, bundle: available, report }).sourceState).toBe("linked_issue");
    expect(deriveGeneralPrAssessmentV1({ seed, bundle: stale, report }).sourceState).toBe("ambiguous");
  });

  it("keeps fallback PR targets as author claims requiring reviewer confirmation", () => {
    const seed = buildGeneralPrObservationSeedV2(input({
      title: "Maintenance notes",
      description: "The service must return Ready when checks pass.",
      taskSource: "issue",
      taskText: "Background information about the current status page."
    }));
    const bundle = finalizeDeterministicGeneralPrObservationsV2(seed, null, "unavailable");

    expect(deriveGeneralPrAssessmentV1({ seed, bundle, report }).targets).toEqual([
      expect.objectContaining({
        sourceAuthority: "pr_author_claim",
        reasonCodes: expect.arrayContaining(["author_claim_requires_confirmation"])
      })
    ]);
  });
});
