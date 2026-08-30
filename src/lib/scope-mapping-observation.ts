export interface ScopeMappingObservationInputV2 {
  objectiveId: string | null;
  changeClusterId: string;
  relationLevel: "verified" | "observed" | "hypothesis" | "unresolved" | "unavailable";
  authoritativeRoute: boolean;
  collectionComplete: boolean;
  contractViolation: boolean;
  /** Context-only facts; never used to infer a violation. */
  fileCategories?: string[];
  changedFileCount?: number;
  keywordMismatch?: boolean;
}

export interface ScopeMappingObservationV2 {
  version: 2;
  objectiveId: string | null;
  changeClusterId: string;
  state: "mapped_by_verified_relation" | "plausibly_mapped" | "unmapped" | "out_of_scope_by_contract" | "collection_unavailable";
}

export function evaluateScopeMappingObservationV2(input: ScopeMappingObservationInputV2): ScopeMappingObservationV2 {
  const state = !input.collectionComplete || input.relationLevel === "unavailable"
    ? "collection_unavailable"
    : input.contractViolation
      ? "out_of_scope_by_contract"
      : input.relationLevel === "verified" && input.authoritativeRoute
        ? "mapped_by_verified_relation"
        : input.relationLevel === "hypothesis"
          ? "plausibly_mapped"
          : "unmapped";
  return { version: 2, objectiveId: input.objectiveId, changeClusterId: input.changeClusterId, state };
}
