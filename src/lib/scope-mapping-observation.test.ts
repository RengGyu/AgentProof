import { describe, expect, it } from "vitest";
import { evaluateScopeMappingObservationV2 } from "./scope-mapping-observation";

const base = { objectiveId: "objective_a", changeClusterId: "cluster_a", collectionComplete: true, contractViolation: false };

describe("evaluateScopeMappingObservationV2", () => {
  it("maps only an exact authoritative route with a verified relation", () => {
    expect(evaluateScopeMappingObservationV2({ ...base, relationLevel: "verified", authoritativeRoute: true })).toMatchObject({ state: "mapped_by_verified_relation" });
  });

  it("keeps semantic mapping plausible and complete no-route changes merely unmapped", () => {
    expect(evaluateScopeMappingObservationV2({ ...base, relationLevel: "hypothesis", authoritativeRoute: false })).toMatchObject({ state: "plausibly_mapped" });
    expect(evaluateScopeMappingObservationV2({ ...base, relationLevel: "unresolved", authoritativeRoute: false })).toMatchObject({ state: "unmapped" });
  });

  it("uses collection unavailable and explicit authoritative contract violations only", () => {
    expect(evaluateScopeMappingObservationV2({ ...base, collectionComplete: false, relationLevel: "verified", authoritativeRoute: true })).toMatchObject({ state: "collection_unavailable" });
    expect(evaluateScopeMappingObservationV2({ ...base, contractViolation: true, relationLevel: "unresolved", authoritativeRoute: false })).toMatchObject({ state: "out_of_scope_by_contract" });
  });

  it("never infers a scope accusation from file category, count, or keywords", () => {
    const observation = evaluateScopeMappingObservationV2({
      ...base,
      relationLevel: "unresolved",
      authoritativeRoute: false,
      fileCategories: ["documentation", "migration", "schema", "generated", "configuration"],
      changedFileCount: 99,
      keywordMismatch: true
    });

    expect(observation).toMatchObject({ state: "unmapped" });
    expect(JSON.stringify(observation)).not.toContain("scopeCreep");
  });
});
