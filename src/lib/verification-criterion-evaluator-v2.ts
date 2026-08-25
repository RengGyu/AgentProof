import type {
  ArtifactCriterionV2,
  MaterializedVerificationCriterionV2,
  VerificationCriterionEvaluationV2,
  VerificationCriterionV2
} from "./verification-contract-v2";
import type { EvidenceItem } from "./types";
import { readEnabledVerificationCapabilitiesV2, type VerificationCapabilityV2 } from "./verification-capability-policy-v2";

export interface VerificationCriterionEvidenceV2 {
  /** Exact PR head used to collect this transient evidence. */
  headSha: string;
  /** Exact content fetched only for contract-declared artifact paths. */
  artifactBlobs: Array<{ path: string; headSha?: string; content: string }>;
  /** Report-safe references for exact-head artifact blobs, never changed-file evidence. */
  artifactEvidenceRefsByPath?: Record<string, string[]>;
  /** Complete inventory is required before an absence condition can be satisfied. */
  changedFileInventory: {
    completeness: "complete" | "incomplete";
    paths: string[];
    previousPaths?: string[];
  };
  /** Existing report evidence IDs keyed by a normalized repository path. */
  evidenceRefsByPath: Record<string, string[]>;
}

export interface VerificationCriterionEvaluationInputV2 {
  criterion: MaterializedVerificationCriterionV2;
  /** Binds the materialized plan at the server boundary; raw binding text is never emitted. */
  bindingDigest: string;
  evidence: VerificationCriterionEvidenceV2;
  capabilities?: ReadonlySet<VerificationCapabilityV2>;
}

const MAX_EXACT_HEAD_ARTIFACT_BYTES = 64 * 1024;

/** Creates report-safe evidence metadata; raw artifact content remains transient. */
export function exactHeadArtifactEvidenceItemsV2(input: {
  existingEvidenceIds: readonly string[];
  artifactBlobs: readonly { path: string; headSha?: string; content: string }[];
  headSha: string;
  declaredPaths: readonly string[];
}): EvidenceItem[] {
  const existingIds = new Set(input.existingEvidenceIds);
  const blobs = new Map(input.artifactBlobs
    .filter((blob) => blob.headSha === input.headSha && Buffer.byteLength(blob.content, "utf8") <= MAX_EXACT_HEAD_ARTIFACT_BYTES)
    .map((blob) => [blob.path, blob]));
  const items: EvidenceItem[] = [];
  for (const path of [...new Set(input.declaredPaths)]) {
    if (!blobs.has(path)) continue;
    let ordinal = items.length + 1;
    let id = `ev_artifact_${ordinal}`;
    while (existingIds.has(id)) id = `ev_artifact_${++ordinal}`;
    existingIds.add(id);
    items.push({
      id,
      kind: "artifact",
      label: "Exact-head artifact",
      summary: "Exact-head contract artifact collected.",
      locator: path,
      confidence: 0.95
    });
  }
  return items;
}

/**
 * The only dispatch used by typed-contract generation. A capability can only
 * withhold a positive result; it cannot turn an unavailable observation into
 * satisfied proof.
 */
export function evaluateMaterializedCriterionV2(input: VerificationCriterionEvaluationInputV2): VerificationCriterionEvaluationV2 {
  const raw = evaluateVerificationCriterionV2(input.criterion.source, input.evidence);
  const evaluated = { ...raw, criterionId: input.criterion.criterionId };
  const capabilities = input.capabilities ?? readEnabledVerificationCapabilitiesV2();
  if (evaluated.state !== "satisfied" || capabilities.has(capabilityForCriterion(input.criterion.source))) return evaluated;
  return {
    ...evaluated,
    state: "unavailable",
    gapKinds: ["evidence_unavailable"]
  };
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

function capabilityForCriterion(criterion: VerificationCriterionV2): VerificationCapabilityV2 {
  if (criterion.type === "return_value") return "return_value";
  if (criterion.type === "absence") return "path_change_absence";
  if (criterion.artifact.kind === "documentation_literal") return "documentation_literal";
  if (criterion.artifact.kind === "workflow_job") return "workflow_job";
  return "test_case";
}

function evaluateDocumentationLiteral(
  criterion: ArtifactCriterionV2,
  evidence: VerificationCriterionEvidenceV2
): VerificationCriterionEvaluationV2 {
  const blobsByPath = new Map(evidence.artifactBlobs
    .filter((blob) => blob.headSha === evidence.headSha && Buffer.byteLength(blob.content, "utf8") <= MAX_EXACT_HEAD_ARTIFACT_BYTES)
    .map((blob) => [blob.path, blob.content]));
  const evidenceRefs = unique(criterion.paths
    .filter((path) => blobsByPath.has(path))
    .flatMap((path) => evidence.artifactEvidenceRefsByPath?.[path] ?? []));

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
