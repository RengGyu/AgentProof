import { createHash } from "node:crypto";

export const EVALUATION_ARTIFACT_SCHEMA_VERSION = "llm-proof-planner-evaluation.v2.1";
export const PLANNER_INPUT_SCHEMA_VERSION = 1;
export const PLANNER_OUTPUT_SCHEMA_VERSION = "2.1";

export function normalizeModelIdentifier(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120 || !/^[A-Za-z0-9._:/-]+$/.test(trimmed)) return null;
  return trimmed;
}

export function sha256Utf8(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function buildEvaluationReproducibility({
  requestedModel,
  resolvedModels,
  promptVersion,
  sourceCommit,
  workingTreeDirty,
  workingTreeChangedPathCount,
  promptText,
  plannerSchema,
  harnessSource,
  baselineSource,
  previousAbSource = null
}) {
  const snapshots = uniqueStrings(
    Array.isArray(resolvedModels) ? resolvedModels.map(normalizeModelIdentifier).filter(Boolean) : []
  );
  const modelSnapshotStatus = snapshots.length === 1
    ? "single"
    : snapshots.length > 1
      ? "mixed"
      : "unavailable";

  return {
    evaluationArtifactSchemaVersion: EVALUATION_ARTIFACT_SCHEMA_VERSION,
    plannerInputSchemaVersion: PLANNER_INPUT_SCHEMA_VERSION,
    plannerOutputSchemaVersion: PLANNER_OUTPUT_SCHEMA_VERSION,
    schemaCompatibility: {
      compactEvidencePackageV1: "supported",
      legacyPlannerOutputV1: "measurement_only_rejected",
      historicalPlannerOutputV2: "historical_only_rejected",
      semanticIntegrityPlannerOutputV2_1: "accepted_exact_version_only"
    },
    requestedModel: normalizeModelIdentifier(requestedModel),
    modelSnapshot: modelSnapshotStatus === "single" ? snapshots[0] : null,
    resolvedModelSnapshots: snapshots,
    modelSnapshotStatus,
    promptVersion,
    sourceCommit: normalizeCommit(sourceCommit),
    workingTreeDirty: typeof workingTreeDirty === "boolean" ? workingTreeDirty : null,
    workingTreeChangedPathCount: nonNegativeIntegerOrNull(workingTreeChangedPathCount),
    digests: {
      algorithm: "sha256",
      textEncoding: "utf8",
      schemaSerialization: "JSON.stringify-property-order",
      promptSha256: sha256Utf8(promptText),
      plannerSchemaSha256: sha256Utf8(JSON.stringify(plannerSchema)),
      evaluationHarnessSha256: sha256Utf8(harnessSource),
      baselineSourceSha256: sha256Utf8(baselineSource),
      previousAbSourceSha256: previousAbSource === null ? null : sha256Utf8(previousAbSource)
    }
  };
}

export function hasCompleteReproducibilityMetadata(value, { requireModelSnapshot = true } = {}) {
  if (!value || typeof value !== "object") return false;
  const digests = value.digests;
  const requiredDigestsPresent = Boolean(
    digests &&
    [digests.promptSha256, digests.plannerSchemaSha256, digests.evaluationHarnessSha256, digests.baselineSourceSha256]
      .every(isSha256)
  );

  return value.evaluationArtifactSchemaVersion === EVALUATION_ARTIFACT_SCHEMA_VERSION &&
    value.plannerInputSchemaVersion === PLANNER_INPUT_SCHEMA_VERSION &&
    value.plannerOutputSchemaVersion === PLANNER_OUTPUT_SCHEMA_VERSION &&
    typeof value.requestedModel === "string" &&
    typeof value.promptVersion === "string" && value.promptVersion.length > 0 &&
    typeof value.sourceCommit === "string" &&
    value.workingTreeDirty === false &&
    requiredDigestsPresent &&
    (!requireModelSnapshot || value.modelSnapshotStatus === "single");
}

function normalizeCommit(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value.trim()) ? value.trim().toLowerCase() : null;
}

function nonNegativeIntegerOrNull(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function uniqueStrings(values) {
  return [...new Set(values)];
}

function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
