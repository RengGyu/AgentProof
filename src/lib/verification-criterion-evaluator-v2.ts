import type {
  ArtifactCriterionV2,
  VerificationCriterionEvaluationV2,
  VerificationCriterionV2
} from "./verification-contract-v2";

export interface VerificationCriterionEvidenceV2 {
  /** Exact PR head used to collect this transient evidence. */
  headSha: string;
  /** Exact content fetched only for contract-declared artifact paths. */
  artifactBlobs: Array<{ path: string; content: string }>;
  /** Complete inventory is required before an absence condition can be satisfied. */
  changedFileInventory: {
    completeness: "complete" | "incomplete";
    paths: string[];
    previousPaths?: string[];
  };
  /** Existing report evidence IDs keyed by a normalized repository path. */
  evidenceRefsByPath: Record<string, string[]>;
}

/**
 * Evaluates only closed, deterministic contract types. Unsupported collection
 * mechanisms are intentionally unavailable rather than heuristically matched.
 */
export function evaluateVerificationCriterionV2(
  criterion: VerificationCriterionV2,
  evidence: VerificationCriterionEvidenceV2
): VerificationCriterionEvaluationV2 {
  if (criterion.type === "artifact" && criterion.artifact.kind === "documentation_literal") {
    return evaluateDocumentationLiteral(criterion, evidence);
  }
  if (criterion.type === "absence") {
    return evaluatePathChangeAbsence(criterion, evidence);
  }
  return unavailable(criterion.id);
}

function evaluateDocumentationLiteral(
  criterion: ArtifactCriterionV2,
  evidence: VerificationCriterionEvidenceV2
): VerificationCriterionEvaluationV2 {
  const blobsByPath = new Map(evidence.artifactBlobs.map((blob) => [blob.path, blob.content]));
  const evidenceRefs = unique(criterion.paths.flatMap((path) => evidence.evidenceRefsByPath[path] ?? []));

  if (criterion.paths.some((path) => !blobsByPath.has(path)) || evidenceRefs.length === 0) {
    return unavailable(criterion.id, evidenceRefs);
  }

  const literal = criterion.artifact.kind === "documentation_literal"
    ? normalizeNewlines(criterion.artifact.literal)
    : "";

  if (criterion.paths.every((path) => normalizeNewlines(blobsByPath.get(path)!).includes(literal))) {
    return satisfied(criterion.id, evidenceRefs);
  }

  return {
    criterionId: criterion.id,
    state: "violated",
    proofAxisRefs: [],
    evidenceRefs,
    gapKinds: ["missing_implementation"]
  };
}

function evaluatePathChangeAbsence(
  criterion: Extract<VerificationCriterionV2, { type: "absence" }>,
  evidence: VerificationCriterionEvidenceV2
): VerificationCriterionEvaluationV2 {
  if (evidence.changedFileInventory.completeness !== "complete") {
    return unavailable(criterion.id);
  }

  const paths = unique([
    ...evidence.changedFileInventory.paths,
    ...(evidence.changedFileInventory.previousPaths ?? [])
  ]);
  const prohibitedPaths = paths.filter((path) =>
    criterion.scope.some((scope) => scope.kind === "exact" ? path === scope.path : path.startsWith(scope.path))
  );

  if (prohibitedPaths.length === 0) {
    return satisfied(criterion.id, []);
  }

  return {
    criterionId: criterion.id,
    state: "violated",
    proofAxisRefs: [],
    evidenceRefs: unique(prohibitedPaths.flatMap((path) => evidence.evidenceRefsByPath[path] ?? [])),
    gapKinds: ["forbidden_implementation_present"]
  };
}

function satisfied(criterionId: string, evidenceRefs: string[]): VerificationCriterionEvaluationV2 {
  return {
    criterionId,
    state: "satisfied",
    proofAxisRefs: [],
    evidenceRefs,
    gapKinds: []
  };
}

function unavailable(criterionId: string, evidenceRefs: string[] = []): VerificationCriterionEvaluationV2 {
  return {
    criterionId,
    state: "unavailable",
    proofAxisRefs: [],
    evidenceRefs,
    gapKinds: ["evidence_unavailable"]
  };
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
