/**
 * Runtime source of truth for deterministic requirement proof axes.
 * Keep this module free of report and UI imports so it can be used at every
 * persistence and validation boundary.
 */
export const PROOF_AXIS_SUBJECTS = [
  "implementation",
  "documentation",
  "ci_configuration",
  "targeted_test",
  "execution",
  "visual",
  "interaction"
] as const;

export type RequirementProofSubject = (typeof PROOF_AXIS_SUBJECTS)[number];

export const PROOF_AXIS_COLLECTION_BASES = [
  "complete_changed_file_inventory",
  "incomplete_changed_file_inventory",
  "matching_artifact_evidence",
  "passing_execution",
  "passing_suite_execution",
  "failed_execution",
  "visual_verification",
  "interaction_verification"
] as const;

export type RequirementProofCollectionBasis = (typeof PROOF_AXIS_COLLECTION_BASES)[number];

const ARTIFACT_BASES = [
  "complete_changed_file_inventory",
  "incomplete_changed_file_inventory",
  "matching_artifact_evidence"
] as const satisfies readonly RequirementProofCollectionBasis[];

export const PROOF_AXIS_COLLECTION_BASES_BY_SUBJECT: Readonly<Record<RequirementProofSubject, readonly RequirementProofCollectionBasis[]>> = {
  implementation: ARTIFACT_BASES,
  documentation: ARTIFACT_BASES,
  ci_configuration: ARTIFACT_BASES,
  targeted_test: ARTIFACT_BASES,
  execution: ["passing_execution", "passing_suite_execution", "failed_execution"],
  visual: ["visual_verification"],
  interaction: ["interaction_verification"]
};

const SUBJECT_SET = new Set<string>(PROOF_AXIS_SUBJECTS);
const COLLECTION_BASIS_SET = new Set<string>(PROOF_AXIS_COLLECTION_BASES);

export function isProofAxisSubject(value: unknown): value is RequirementProofSubject {
  return typeof value === "string" && SUBJECT_SET.has(value);
}

export function isProofAxisCollectionBasis(value: unknown): value is RequirementProofCollectionBasis {
  return typeof value === "string" && COLLECTION_BASIS_SET.has(value);
}

export function isProofAxisCollectionBasisAllowed(
  subject: RequirementProofSubject,
  collectionBasis: RequirementProofCollectionBasis
): boolean {
  return PROOF_AXIS_COLLECTION_BASES_BY_SUBJECT[subject].includes(collectionBasis);
}

export function proofAxisEvidenceLabel(axis: {
  subject: RequirementProofSubject;
  state: "satisfied" | "violated" | "incomplete";
  collectionBasis?: RequirementProofCollectionBasis;
}): string | undefined {
  if (axis.state !== "satisfied") return undefined;
  if (axis.collectionBasis === "passing_suite_execution") return "The repository test suite ran successfully for this PR.";
  if (axis.collectionBasis === "passing_execution") return "A requirement-linked Check completed successfully.";
  if (axis.collectionBasis === "failed_execution") return "A relevant Check reported failure.";
  if (axis.collectionBasis === "interaction_verification") return "Browser interaction evidence is available.";
  if (axis.collectionBasis === "visual_verification") return "Visual evidence is available.";
  return undefined;
}
