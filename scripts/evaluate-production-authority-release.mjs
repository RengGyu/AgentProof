import { createHash, verify as verifySignature } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { releaseGatePasses } from "./evaluate-evidence-release-gate.mjs";
import { productionBoundaryReleaseGatePasses } from "./evaluate-production-boundary-release-gate.mjs";
import {
  canonicalSha256,
  validateEvaluationToolchainManifestV2,
  verifyEvaluationToolchainManifestV2
} from "./build-evaluation-toolchain-manifest.mjs";

const UNKNOWN = "UNKNOWN";
const SHA256 = /^[a-f0-9]{64}$/;
const CANDIDATE_SHA = /^[a-f0-9]{40}([a-f0-9]{24})?$/;
const EVIDENCE_KEYS = [
  "version", "candidateSha", "assessedAt", "rubricSha256", "toolchainManifestSha256", "evidenceSources"
];
const SOURCE_KEYS = [
  "id", "kind", "candidateSha", "toolchainManifestSha256", "issuedAt", "validUntil",
  "bindings", "result", "signerKeyId", "signature"
];
const REQUIREMENT_AGGREGATE_KEYS = [
  "totalCases", "structuralMismatchCount", "falseSupportedCount",
  "falseRequirementLocalCiAssociationCount", "crossRequirementReceiptReuseCount", "privacyLeakCount",
  "unexpectedFailure", "durationMs", "githubRequestCount", "githubPageCount", "githubRetryCount",
  "providerCallCount"
];
const BOUNDARY_AGGREGATE_KEYS = [
  "untrustedActiveV2AcceptanceCount", "pastedEvidenceGithubAuthorityCount", "falseBoundaryLocalPositiveCount",
  "boundaryPrivacyLeakCount", "boundaryStructuralMismatchCount"
];
const CORPUS_SUMMARY_KEYS = ["inputSha256", "categoryCounts", "summarySha256"];
const EXPECTED_CATEGORY_COUNTS = {
  requirement: [0, 0, 4],
  boundary: [4, 4, 0]
};
const ATTESTATION_KEYS = [
  "version", "surface", "candidateSha", "runnerBundleSha256", "runnerSandboxProfileSha256",
  "runtimeImageDigest", "inputSha256", "mountedReadOnlyFileSetSha256", "networkMode",
  "readOnlyMounts", "writableMounts", "resultSha256"
];
const READ_ONLY_ALLOWED = ["candidate_sut", "protected_input", "runner_bundle", "runtime_profile"];
const KNOWN_MOUNT_KINDS = new Set([
  ...READ_ONLY_ALLOWED, "result", "oracle", "evaluator", "rubric", "development_worktree", "secret", "host"
]);
const DECISIONS = new Set(["eligible_for_deployment_approval", "conditional_candidate", "no_go"]);
const EVIDENCE_SOURCE_KINDS = new Map([
  ["freeze_manifest", "signed_manifest"],
  ["protected_aggregate", "aggregate_evaluator_output"],
  ["protected_boundary_aggregate", "aggregate_boundary_evaluator_output"],
  ["runner_isolation_attestation", "signed_ci_sandbox_attestation_set"],
  ["rubric_executor_regression", "command"],
  ["untrusted_authority_regression", "command"],
  ["generated_private_regression", "command"],
  ["pasted_provenance_regression", "command"],
  ["privacy_regression", "command"],
  ["contract_endpoint_replay", "command"],
  ["engineering_suite", "command_set"],
  ["external_regression", "command"],
  ["production_smoke", "command_set"],
  ["independent_review", "signed_review_record"]
]);
const BINARY_GATE_SOURCES = new Map([
  ["protected_release_gate", ["protected_aggregate"]],
  ["protected_boundary_gate", ["protected_boundary_aggregate"]],
  ["frozen_tooling_integrity", ["freeze_manifest"]],
  ["runner_oracle_isolation", ["freeze_manifest", "runner_isolation_attestation", "rubric_executor_regression"]],
  ["aggregate_only_output", ["freeze_manifest", "rubric_executor_regression", "protected_aggregate", "protected_boundary_aggregate"]],
  ["untrusted_active_v2", ["untrusted_authority_regression", "protected_boundary_aggregate"]],
  ["pasted_authority", ["pasted_provenance_regression", "protected_boundary_aggregate"]],
  ["privacy", ["privacy_regression", "protected_aggregate", "protected_boundary_aggregate"]],
  ["engineering", ["engineering_suite"]],
  ["contract_endpoint_compatibility", ["contract_endpoint_replay"]],
  ["external_regression_current", ["external_regression"]],
  ["production_smoke_current", ["production_smoke"]],
  ["independent_review_exact_sha", ["independent_review"]]
]);
const MAX_INPUT_BYTES = 1_048_576;

export function evaluateProductionAuthorityRelease({ rubric, evidence, frozenManifest, trustedSigners, rubricFileSha256 }) {
  validateRubric(rubric);
  validateEvaluationToolchainManifestV2(frozenManifest);
  if (frozenManifest.candidateSha !== evidence?.candidateSha) throw new Error("stale evidence candidate binding");
  const signerById = validateTrustedSigners(trustedSigners);
  const rubricSha256 = rubricFileSha256 ?? canonicalSha256(rubric);
  if (!SHA256.test(rubricSha256)) throw new Error("rubric file hash is invalid");
  validateEvidenceEnvelope(evidence, rubric, rubricSha256, frozenManifest, signerById);

  const sourceById = new Map(evidence.evidenceSources.map((source) => [source.id, source]));
  const stateById = new Map(rubric.evidenceSources.map((definition) => [
    definition.id,
    evaluateEvidenceSource(definition, sourceById.get(definition.id), evidence, frozenManifest)
  ]));
  const binaryGates = rubric.binaryGates.map((gate) => ({
    id: gate.id,
    state: combinedState(gate.requiredEvidenceSourceIds.map((id) => stateById.get(id)))
  }));
  const categoryScores = rubric.scoreCategories.map((category) => ({
    id: category.id,
    score: category.criteria.reduce((sum, criterion) =>
      sum + (criterion.requiredEvidenceSourceIds.every((id) => stateById.get(id) === "passed") ? criterion.points : 0), 0),
    maximumScore: category.weight
  }));
  const score = categoryScores.reduce((sum, category) => sum + category.score, 0);
  const allBinaryGatesPass = binaryGates.every((gate) => gate.state === "passed");

  return {
    version: 1,
    rubricId: rubric.rubricId,
    candidateSha: evidence.candidateSha,
    score,
    maximumScore: rubric.maximumScore,
    categoryScores,
    binaryGates,
    decision: allBinaryGatesPass ? scoreDecision(rubric.decisionBands, score) : "no_go"
  };
}

export function verifyAndEvaluateProductionAuthorityRelease({
  rubric,
  evidence,
  frozenManifest,
  trustedSigners,
  rubricFileSha256,
  toolchainRoot,
  toolchainConfig
}) {
  const verifiedManifest = verifyEvaluationToolchainManifestV2({
    rootDir: toolchainRoot,
    config: toolchainConfig,
    manifest: frozenManifest
  });
  return evaluateProductionAuthorityRelease({
    rubric,
    evidence,
    frozenManifest: verifiedManifest,
    trustedSigners,
    rubricFileSha256
  });
}

export function signedEvidencePayload(source) {
  return {
    id: source.id,
    kind: source.kind,
    candidateSha: source.candidateSha,
    toolchainManifestSha256: source.toolchainManifestSha256,
    issuedAt: source.issuedAt,
    validUntil: source.validUntil,
    bindings: source.bindings,
    result: source.result,
    signerKeyId: source.signerKeyId
  };
}

export function validateRequirementAggregate(aggregate) {
  if (!hasExactKeys(aggregate, REQUIREMENT_AGGREGATE_KEYS) || aggregate.totalCases !== 4 ||
    !REQUIREMENT_AGGREGATE_KEYS.slice(1, 6).every((key) => isCountOrUnknown(aggregate[key])) ||
    aggregate.structuralMismatchCount > aggregate.totalCases ||
    !isCountRateGroup(aggregate.unexpectedFailure, aggregate.totalCases) ||
    !["durationMs", "githubRequestCount", "githubPageCount", "githubRetryCount"].every((key) => isPercentileGroup(aggregate[key])) ||
    !isCountOrUnknown(aggregate.providerCallCount)) {
    throw new Error("requirement aggregate schema is invalid");
  }
  return true;
}

export function validateBoundaryAggregate(aggregate) {
  if (!hasExactKeys(aggregate, BOUNDARY_AGGREGATE_KEYS) || !BOUNDARY_AGGREGATE_KEYS.every((key) => isCountOrUnknown(aggregate[key]))) {
    throw new Error("boundary aggregate schema is invalid");
  }
  return true;
}

function validateRubric(rubric) {
  const topKeys = [
    "version", "rubricId", "purpose", "maximumScore", "releaseThreshold", "scoringMethod",
    "evidenceSources", "binaryGates", "scoreCategories", "decisionBands", "overrideRule"
  ];
  if (!hasExactKeys(rubric, topKeys) || rubric.version !== 1 || !isLabel(rubric.rubricId) ||
    !isBoundedText(rubric.purpose) || !isBoundedText(rubric.overrideRule) ||
    !Number.isSafeInteger(rubric.maximumScore) || rubric.maximumScore <= 0 ||
    !Number.isSafeInteger(rubric.releaseThreshold) || rubric.releaseThreshold < 0 ||
    rubric.releaseThreshold > rubric.maximumScore || !Array.isArray(rubric.evidenceSources) ||
    !Array.isArray(rubric.binaryGates) || !Array.isArray(rubric.scoreCategories) || !Array.isArray(rubric.decisionBands)) {
    throw new Error("release rubric schema is invalid");
  }
  if (!hasExactKeys(rubric.scoringMethod, ["type", "awardRule", "partialCredit", "missingEvidence", "scoringAuthority"]) ||
    rubric.scoringMethod.type !== "all_or_nothing_per_criterion" || rubric.scoringMethod.partialCredit !== false ||
    rubric.scoringMethod.missingEvidence !== "zero_points" || rubric.scoringMethod.scoringAuthority !== "independent_release_assessor" ||
    !isBoundedText(rubric.scoringMethod.awardRule)) throw new Error("release rubric scoring method is invalid");
  const evidenceIds = new Set();
  for (const source of rubric.evidenceSources) {
    const keys = ["id", "kind", ...(Object.hasOwn(source, "requiredBindings") ? ["requiredBindings"] : []),
      ...(Object.hasOwn(source, "commands") ? ["commands"] : []), "passRule"];
    if (!hasExactKeys(source, keys) || !isLabel(source.id) || source.kind !== EVIDENCE_SOURCE_KINDS.get(source.id) ||
      evidenceIds.has(source.id) || !isBoundedText(source.passRule) ||
      (source.requiredBindings !== undefined && !isUniqueLabels(source.requiredBindings)) ||
      (source.commands !== undefined && (!Array.isArray(source.commands) || source.commands.length === 0 ||
        !source.commands.every(isBoundedCommand)))) {
      throw new Error("release rubric evidence-source schema is invalid");
    }
    evidenceIds.add(source.id);
  }
  if (evidenceIds.size !== EVIDENCE_SOURCE_KINDS.size || [...EVIDENCE_SOURCE_KINDS.keys()].some((id) => !evidenceIds.has(id))) {
    throw new Error("release rubric evidence-source set is incomplete");
  }
  const gateIds = new Set();
  for (const gate of rubric.binaryGates) {
    if (!hasExactKeys(gate, ["id", "requiredEvidenceSourceIds", "passCondition"]) || !isLabel(gate.id) || gateIds.has(gate.id) ||
      !isKnownReferences(gate.requiredEvidenceSourceIds, evidenceIds) ||
      !sameArray(gate.requiredEvidenceSourceIds, BINARY_GATE_SOURCES.get(gate.id)) || !isBoundedText(gate.passCondition)) {
      throw new Error("release rubric binary-gate schema is invalid");
    }
    gateIds.add(gate.id);
  }
  if (gateIds.size !== BINARY_GATE_SOURCES.size || [...BINARY_GATE_SOURCES.keys()].some((id) => !gateIds.has(id))) {
    throw new Error("release rubric binary-gate set is incomplete");
  }
  let maximumScore = 0;
  const categoryIds = new Set();
  const criterionIds = new Set();
  for (const category of rubric.scoreCategories) {
    if (!hasExactKeys(category, ["id", "label", "weight", "criteria"]) || !isLabel(category.id) || categoryIds.has(category.id) ||
      !Number.isSafeInteger(category.weight) || category.weight < 0 || !Array.isArray(category.criteria)) {
      throw new Error("release rubric category schema is invalid");
    }
    categoryIds.add(category.id);
    let categoryPoints = 0;
    for (const criterion of category.criteria) {
      if (!hasExactKeys(criterion, ["id", "points", "requiredEvidenceSourceIds"]) || !isLabel(criterion.id) ||
        criterionIds.has(criterion.id) || !Number.isSafeInteger(criterion.points) || criterion.points < 0 ||
        !isKnownReferences(criterion.requiredEvidenceSourceIds, evidenceIds)) {
        throw new Error("release rubric criterion schema is invalid");
      }
      criterionIds.add(criterion.id);
      categoryPoints += criterion.points;
    }
    if (categoryPoints !== category.weight) throw new Error("release rubric category points do not match its weight");
    maximumScore += category.weight;
  }
  if (maximumScore !== rubric.maximumScore ||
    !validateDecisionBands(rubric.decisionBands, rubric.maximumScore, rubric.releaseThreshold)) {
    throw new Error("release rubric score schema is invalid");
  }
}

function validateDecisionBands(bands, maximumScore, releaseThreshold) {
  if (!bands.every((band) => hasExactKeys(band, ["minimumScore", "maximumScore", "decision", "condition"]) &&
    Number.isSafeInteger(band.minimumScore) && Number.isSafeInteger(band.maximumScore) &&
    band.minimumScore >= 0 && band.maximumScore <= maximumScore && band.minimumScore <= band.maximumScore &&
    DECISIONS.has(band.decision) && (band.condition === "all_binary_gates_pass" || band.condition === "always"))) return false;
  const covered = new Set();
  let declaredSize = 0;
  for (const band of bands) {
    declaredSize += band.maximumScore - band.minimumScore + 1;
    for (let score = band.minimumScore; score <= band.maximumScore; score += 1) covered.add(score);
  }
  return covered.size === maximumScore + 1 && declaredSize === maximumScore + 1 && bands.some((band) =>
    band.decision === "eligible_for_deployment_approval" && band.minimumScore === releaseThreshold &&
    band.condition === "all_binary_gates_pass");
}

function validateTrustedSigners(value) {
  if (!hasExactKeys(value, ["version", "signers"]) || value.version !== 1 || !Array.isArray(value.signers) || value.signers.length === 0) {
    throw new Error("trusted signer set schema is invalid");
  }
  const signers = new Map();
  for (const signer of value.signers) {
    if (!hasExactKeys(signer, ["keyId", "publicKeyPem"]) || !isLabel(signer.keyId) ||
      typeof signer.publicKeyPem !== "string" || signer.publicKeyPem.length > 4096 || signers.has(signer.keyId)) {
      throw new Error("trusted signer set schema is invalid");
    }
    signers.set(signer.keyId, signer.publicKeyPem);
  }
  return signers;
}

function validateEvidenceEnvelope(evidence, rubric, rubricSha256, manifest, signerById) {
  if (!hasExactKeys(evidence, EVIDENCE_KEYS) || evidence.version !== 1 || !CANDIDATE_SHA.test(evidence.candidateSha) ||
    !isIsoTime(evidence.assessedAt) || !SHA256.test(evidence.rubricSha256) || !SHA256.test(evidence.toolchainManifestSha256) ||
    !Array.isArray(evidence.evidenceSources)) throw new Error("release assessment evidence schema is invalid");
  const frozenRubricSha256 = manifest.bundles.find((bundle) => bundle.id === "rubric")?.sha256;
  if (evidence.rubricSha256 !== rubricSha256 || evidence.rubricSha256 !== frozenRubricSha256 ||
    evidence.toolchainManifestSha256 !== canonicalSha256(manifest)) {
    throw new Error("stale tooling or rubric hash");
  }
  const definitions = new Map(rubric.evidenceSources.map((definition) => [definition.id, definition]));
  const seen = new Set();
  for (const source of evidence.evidenceSources) {
    if (!isRecord(source)) throw new Error("release assessment evidence source is invalid");
    const unknownKeys = Object.keys(source).filter((key) => !SOURCE_KEYS.includes(key));
    if (unknownKeys.length > 0) throw new Error(`unknown evidence field: ${unknownKeys[0]}`);
    if (!hasExactKeys(source, SOURCE_KEYS) || !isLabel(source.id)) throw new Error("release assessment evidence source is invalid");
    if (!definitions.has(source.id)) throw new Error(`unknown evidence source: ${source.id}`);
    if (seen.has(source.id)) throw new Error(`duplicate evidence source: ${source.id}`);
    seen.add(source.id);
    const definition = definitions.get(source.id);
    if (source.kind !== definition.kind || source.candidateSha !== evidence.candidateSha ||
      source.toolchainManifestSha256 !== evidence.toolchainManifestSha256 || !isIsoTime(source.issuedAt) ||
      !isIsoTime(source.validUntil) || source.issuedAt > evidence.assessedAt || evidence.assessedAt > source.validUntil) {
      if (isIsoTime(source.validUntil) && evidence.assessedAt > source.validUntil) throw new Error(`stale evidence source: ${source.id}`);
      throw new Error(`evidence binding is invalid: ${source.id}`);
    }
    validateBindings(source.bindings, definition.requiredBindings ?? [], evidence, manifest);
    const publicKey = signerById.get(source.signerKeyId);
    if (!publicKey || typeof source.signature !== "string" || source.signature.length > 1024 ||
      !verifyDetachedSignature(publicKey, source)) throw new Error(`unauthenticated evidence source: ${source.id}`);
    validateAggregateResultHash(source);
  }
  for (const id of definitions.keys()) if (!seen.has(id)) throw new Error(`missing evidence source: ${id}`);
  validateSharedBindings(evidence.evidenceSources);
}

function validateAggregateResultHash(source) {
  const binding = source.id === "protected_aggregate" ? "requirementResultSha256"
    : source.id === "protected_boundary_aggregate" ? "boundaryResultSha256" : null;
  if (binding && source.bindings[binding] !== canonicalSha256(source.result)) {
    throw new Error(`aggregate result hash does not match signed payload: ${source.id}`);
  }
}

function validateSharedBindings(sources) {
  const canonical = sources.find((source) => source.id === "freeze_manifest")?.bindings;
  if (!isRecord(canonical)) throw new Error("missing canonical freeze bindings");
  for (const source of sources) {
    for (const [name, value] of Object.entries(source.bindings)) {
      if (Object.hasOwn(canonical, name) && canonical[name] !== value) {
        throw new Error(`inconsistent shared evidence binding: ${source.id}.${name}`);
      }
    }
  }
}

function validateBindings(bindings, names, evidence, manifest) {
  if (!hasExactKeys(bindings, names)) throw new Error("evidence bindings are not exact");
  for (const [name, value] of Object.entries(bindings)) {
    if (!isBindingValue(name, value)) throw new Error(`evidence binding is invalid: ${name}`);
  }
  const exact = {
    candidateSha: manifest.candidateSha,
    toolingEntrySetSha256: manifest.toolingEntrySetSha256,
    moduleEdgeSetSha256: manifest.moduleEdgeSetSha256,
    nodeBuiltinAllowlistSha256: manifest.nodeBuiltinAllowlistSha256,
    approvedNodeBuiltinUniverseSha256: manifest.approvedNodeBuiltinUniverseSha256,
    parserArtifactBindingSha256: manifest.parserArtifact.loadedBindingSha256,
    resolutionPolicySha256: manifest.resolutionPolicySha256,
    evaluationToolchainSourceClosureSha256: manifest.evaluationToolchainSourceClosureSha256,
    evaluationToolchainBundleSetSha256: manifest.evaluationToolchainBundleSetSha256,
    sutExternalImportAllowlistSha256: manifest.sutExternalImportAllowlistSha256,
    runnerSandboxProfileSha256: manifest.runnerSandboxProfile.sha256,
    packageScriptsSha256: manifest.packageScripts.sha256,
    lockfileSha256: manifest.lockfile.sha256,
    nodeVersion: manifest.runtime.nodeVersion,
    pnpmVersion: manifest.runtime.pnpmVersion,
    runtimeImageDigest: manifest.runtime.runtimeImageDigest,
    rubricSha256: evidence.rubricSha256
  };
  for (const [name, expected] of Object.entries(exact)) {
    if (Object.hasOwn(bindings, name) && bindings[name] !== expected) throw new Error(`stale evidence binding: ${name}`);
  }
}

function verifyDetachedSignature(publicKey, source) {
  try {
    return verifySignature(null, Buffer.from(stableJson(signedEvidencePayload(source))), publicKey, Buffer.from(source.signature, "base64"));
  } catch {
    return false;
  }
}

function evaluateEvidenceSource(definition, source, evidence, manifest) {
  switch (definition.id) {
    case "freeze_manifest":
      return evaluateFreezeManifest(source, evidence, manifest);
    case "protected_aggregate":
      return evaluateRequirementAggregate(source.result);
    case "protected_boundary_aggregate":
      return evaluateBoundaryAggregate(source.result);
    case "runner_isolation_attestation":
      return evaluateSandboxAttestations(source.result, source.bindings, evidence, manifest);
    case "independent_review":
      return evaluateIndependentReview(source.result, source.bindings);
    default:
      return evaluateCommandEvidence(definition, source.result);
  }
}

function evaluateFreezeManifest(source, evidence, manifest) {
  if (!hasExactKeys(source.result, ["manifestSha256", "corpusSummaries"]) || !SHA256.test(source.result.manifestSha256) ||
    !hasExactKeys(source.result.corpusSummaries, ["requirement", "boundary"]) ||
    !Object.values(source.result.corpusSummaries).every(isCorpusSummary)) {
    throw new Error("freeze manifest evidence schema is invalid");
  }
  if (source.result.manifestSha256 !== evidence.toolchainManifestSha256) return "failed";
  const bindings = source.bindings;
  const summaries = source.result.corpusSummaries;
  const summariesMatch = Object.entries(EXPECTED_CATEGORY_COUNTS).every(([surface, expectedCounts]) => {
    const summary = summaries[surface];
    const inputBinding = `${surface}InputSha256`;
    const summaryBinding = `${surface}CorpusSummarySha256`;
    return sameArray(summary.categoryCounts, expectedCounts) &&
      summary.inputSha256 === bindings[inputBinding] &&
      summary.summarySha256 === bindings[summaryBinding] &&
      summary.summarySha256 === canonicalSha256({
        version: 1,
        inputSha256: summary.inputSha256,
        categoryCounts: summary.categoryCounts
      });
  });
  const combinedCounts = summaries.requirement.categoryCounts.map((count, index) =>
    count + summaries.boundary.categoryCounts[index]);
  const comparisons = {
    candidateSha: manifest.candidateSha,
    toolingEntrySetSha256: manifest.toolingEntrySetSha256,
    moduleEdgeSetSha256: manifest.moduleEdgeSetSha256,
    nodeBuiltinAllowlistSha256: manifest.nodeBuiltinAllowlistSha256,
    approvedNodeBuiltinUniverseSha256: manifest.approvedNodeBuiltinUniverseSha256,
    parserArtifactBindingSha256: manifest.parserArtifact.loadedBindingSha256,
    resolutionPolicySha256: manifest.resolutionPolicySha256,
    evaluationToolchainSourceClosureSha256: manifest.evaluationToolchainSourceClosureSha256,
    evaluationToolchainBundleSetSha256: manifest.evaluationToolchainBundleSetSha256,
    sutExternalImportAllowlistSha256: manifest.sutExternalImportAllowlistSha256,
    runnerSandboxProfileSha256: manifest.runnerSandboxProfile.sha256,
    packageScriptsSha256: manifest.packageScripts.sha256,
    lockfileSha256: manifest.lockfile.sha256,
    nodeVersion: manifest.runtime.nodeVersion,
    pnpmVersion: manifest.runtime.pnpmVersion,
    requirementRunnerBundleSha256: manifest.bundles.find((bundle) => bundle.id === "requirement_runner")?.sha256,
    boundaryRunnerBundleSha256: manifest.bundles.find((bundle) => bundle.id === "boundary_runner")?.sha256
  };
  return Object.entries(comparisons).every(([key, value]) => bindings[key] === value) &&
    summariesMatch && sameArray(combinedCounts, [4, 4, 4]) ? "passed" : "failed";
}

function isCorpusSummary(value) {
  return hasExactKeys(value, CORPUS_SUMMARY_KEYS) && SHA256.test(value.inputSha256) &&
    Array.isArray(value.categoryCounts) && value.categoryCounts.length === 3 &&
    value.categoryCounts.every((count) => Number.isSafeInteger(count) && count >= 0) &&
    SHA256.test(value.summarySha256);
}

function evaluateRequirementAggregate(result) {
  if (!hasExactKeys(result, ["aggregate"])) throw new Error("requirement aggregate evidence schema is invalid");
  validateRequirementAggregate(result.aggregate);
  if (containsUnknown(result.aggregate)) return "unknown";
  return releaseGatePasses(result.aggregate) ? "passed" : "failed";
}

function evaluateBoundaryAggregate(result) {
  if (!hasExactKeys(result, ["aggregate"])) throw new Error("boundary aggregate evidence schema is invalid");
  validateBoundaryAggregate(result.aggregate);
  if (containsUnknown(result.aggregate)) return "unknown";
  return productionBoundaryReleaseGatePasses(result.aggregate) ? "passed" : "failed";
}

function evaluateSandboxAttestations(result, bindings, evidence, manifest) {
  if (!hasExactKeys(result, ["attestations"]) || !Array.isArray(result.attestations) || result.attestations.length !== 2) {
    throw new Error("sandbox attestation schema is invalid");
  }
  const bySurface = new Map();
  for (const attestation of result.attestations) {
    validateSandboxAttestationSchema(attestation);
    if (bySurface.has(attestation.surface)) throw new Error("sandbox attestation schema is invalid");
    bySurface.set(attestation.surface, attestation);
  }
  if (!bySurface.has("requirement") || !bySurface.has("boundary")) throw new Error("sandbox attestation schema is invalid");
  const expectedBySurface = {
    requirement: {
      runnerBundleSha256: bindings.requirementRunnerBundleSha256,
      inputSha256: bindings.requirementInputSha256,
      resultSha256: bindings.requirementResultSha256
    },
    boundary: {
      runnerBundleSha256: bindings.boundaryRunnerBundleSha256,
      inputSha256: bindings.boundaryInputSha256,
      resultSha256: bindings.boundaryResultSha256
    }
  };
  return [...bySurface].every(([surface, attestation]) => sandboxAttestationPasses(
    attestation,
    expectedBySurface[surface],
    bindings,
    evidence,
    manifest
  )) ? "passed" : "failed";
}

function validateSandboxAttestationSchema(attestation) {
  if (!hasExactKeys(attestation, ATTESTATION_KEYS) || attestation.version !== 1 ||
    (attestation.surface !== "requirement" && attestation.surface !== "boundary") ||
    !CANDIDATE_SHA.test(attestation.candidateSha) || !SHA256.test(attestation.runnerBundleSha256) ||
    !SHA256.test(attestation.runnerSandboxProfileSha256) || !/^sha256:[a-f0-9]{64}$/.test(attestation.runtimeImageDigest) ||
    !SHA256.test(attestation.inputSha256) || !SHA256.test(attestation.mountedReadOnlyFileSetSha256) ||
    (attestation.networkMode !== "disabled" && attestation.networkMode !== "enabled") ||
    !isMountList(attestation.readOnlyMounts, true) || !isMountList(attestation.writableMounts, false) ||
    !SHA256.test(attestation.resultSha256)) {
    throw new Error("sandbox attestation schema is invalid");
  }
}

function sandboxAttestationPasses(attestation, expected, bindings, evidence, manifest) {
  const mountByKind = new Map(attestation.readOnlyMounts.map((mount) => [mount.kind, mount.binding]));
  const frozenBundleSha256 = manifest.bundles.find((bundle) => bundle.id === `${attestation.surface}_runner`)?.sha256;
  return attestation.candidateSha === evidence.candidateSha &&
    attestation.runnerBundleSha256 === expected.runnerBundleSha256 &&
    attestation.runnerBundleSha256 === frozenBundleSha256 &&
    attestation.runnerSandboxProfileSha256 === manifest.runnerSandboxProfile.sha256 &&
    attestation.runtimeImageDigest === manifest.runtime.runtimeImageDigest &&
    attestation.inputSha256 === expected.inputSha256 &&
    attestation.mountedReadOnlyFileSetSha256 === bindings.mountedReadOnlyFileSetSha256 &&
    attestation.networkMode === "disabled" &&
    attestation.readOnlyMounts.length === READ_ONLY_ALLOWED.length &&
    READ_ONLY_ALLOWED.every((kind) => mountByKind.has(kind)) &&
    mountByKind.get("candidate_sut") === evidence.candidateSha &&
    mountByKind.get("protected_input") === expected.inputSha256 &&
    mountByKind.get("runner_bundle") === expected.runnerBundleSha256 &&
    mountByKind.get("runtime_profile") === manifest.runnerSandboxProfile.sha256 &&
    attestation.writableMounts.length === 1 && attestation.writableMounts[0].kind === "result" &&
    attestation.resultSha256 === expected.resultSha256;
}

function isMountList(value, withBinding) {
  if (!Array.isArray(value) || value.length === 0) return false;
  const kinds = new Set();
  return value.every((mount) => {
    const valid = withBinding
      ? hasExactKeys(mount, ["kind", "binding"]) && typeof mount.binding === "string" && (SHA256.test(mount.binding) || CANDIDATE_SHA.test(mount.binding))
      : hasExactKeys(mount, ["kind"]);
    if (!valid || !KNOWN_MOUNT_KINDS.has(mount.kind) || kinds.has(mount.kind)) return false;
    kinds.add(mount.kind);
    return true;
  });
}

function evaluateIndependentReview(result, bindings) {
  if (!hasExactKeys(result, ["reviewerIdentity", "reviewState", "reviewedDiffSha256", "independent"]) ||
    !isReviewerIdentity(result.reviewerIdentity) || (result.reviewState !== "approved" && result.reviewState !== "rejected") ||
    !SHA256.test(result.reviewedDiffSha256) || typeof result.independent !== "boolean") {
    throw new Error("independent review evidence schema is invalid");
  }
  return result.reviewerIdentity === bindings.reviewerIdentity && result.reviewState === bindings.reviewState &&
    result.reviewedDiffSha256 === bindings.reviewedDiffSha256 && result.reviewState === "approved" && result.independent
    ? "passed" : "failed";
}

function evaluateCommandEvidence(definition, result) {
  const keys = definition.id === "production_smoke" ? ["commands", "readinessOk"] : ["commands"];
  if (!hasExactKeys(result, keys) || !Array.isArray(result.commands) || result.commands.length !== (definition.commands ?? []).length ||
    !result.commands.every((command, index) => hasExactKeys(command, ["command", "exitCode", "outputSha256"]) &&
      command.command === definition.commands[index] && Number.isSafeInteger(command.exitCode) && SHA256.test(command.outputSha256)) ||
    (definition.id === "production_smoke" && typeof result.readinessOk !== "boolean")) {
    throw new Error(`command evidence schema is invalid: ${definition.id}`);
  }
  return result.commands.every((command) => command.exitCode === 0) &&
    (definition.id !== "production_smoke" || result.readinessOk) ? "passed" : "failed";
}

function combinedState(states) {
  if (states.some((state) => state === "unknown" || state === undefined)) return "unknown";
  return states.every((state) => state === "passed") ? "passed" : "failed";
}

function scoreDecision(bands, score) {
  const band = bands.find((item) => score >= item.minimumScore && score <= item.maximumScore);
  return band?.decision ?? "no_go";
}

function isBindingValue(name, value) {
  if (name === "candidateSha") return CANDIDATE_SHA.test(value);
  if (name === "runtimeImageDigest") return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
  if (name === "nodeVersion") return typeof value === "string" && /^v?\d+\.\d+\.\d+$/.test(value);
  if (name === "pnpmVersion") return typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value);
  if (name === "networkMode") return value === "disabled";
  if (name === "reviewerIdentity") return isReviewerIdentity(value);
  if (name === "reviewState") return value === "approved" || value === "rejected";
  return typeof value === "string" && SHA256.test(value);
}

function isCountRateGroup(value, totalCases) {
  return hasExactKeys(value, ["count", "rate"]) &&
    ((value.count === UNKNOWN && value.rate === UNKNOWN) ||
      (Number.isSafeInteger(value.count) && value.count >= 0 && value.count <= totalCases &&
        typeof value.rate === "number" && Number.isFinite(value.rate) && value.rate >= 0 && value.rate <= 1 &&
        Math.abs(value.rate - value.count / totalCases) <= Number.EPSILON));
}

function isPercentileGroup(value) {
  return hasExactKeys(value, ["p50", "p95"]) &&
    ((value.p50 === UNKNOWN && value.p95 === UNKNOWN) ||
      (isNonNegativeNumber(value.p50) && isNonNegativeNumber(value.p95) && value.p50 <= value.p95));
}

function isCountOrUnknown(value) {
  return value === UNKNOWN || (Number.isSafeInteger(value) && value >= 0);
}

function isNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function containsUnknown(value) {
  if (value === UNKNOWN) return true;
  if (Array.isArray(value)) return value.some(containsUnknown);
  return isRecord(value) && Object.values(value).some(containsUnknown);
}

function isIsoTime(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const time = new Date(value);
  return !Number.isNaN(time.valueOf()) && time.toISOString() === value;
}

function isKnownReferences(value, known) {
  return isUniqueLabels(value) && value.length > 0 && value.every((id) => known.has(id));
}

function sameArray(actual, expected) {
  return Array.isArray(expected) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function isUniqueLabels(value) {
  return Array.isArray(value) && value.every(isLabel) && new Set(value).size === value.length;
}

function isBoundedCommand(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\r\n\0]/.test(value);
}

function isBoundedText(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 && !value.includes("\0");
}

function isReviewerIdentity(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:@/-]{1,128}$/.test(value);
}

function isLabel(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,160}$/.test(value);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function parseCli(argv) {
  if (argv.length !== 14) return null;
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const path = argv[index + 1];
    if (!["--rubric", "--evidence", "--manifest", "--trusted-signers", "--toolchain-root", "--toolchain-config", "--output"].includes(flag) || !path || values.has(flag)) return null;
    values.set(flag, path);
  }
  return values.size === 7 ? Object.fromEntries([...values].map(([key, value]) => [key.slice(2), value])) : null;
}

function readJsonDocument(path) {
  const raw = readFileSync(path);
  if (raw.length > MAX_INPUT_BYTES) throw new Error("release assessment input exceeds its byte limit");
  return { value: JSON.parse(raw.toString("utf8")), sha256: createHash("sha256").update(raw).digest("hex") };
}

export function runProductionAuthorityReleaseCli(argv) {
  const paths = parseCli(argv);
  if (!paths) throw new Error("production authority invocation is incomplete");
  const rubric = readJsonDocument(paths.rubric);
  const result = verifyAndEvaluateProductionAuthorityRelease({
    rubric: rubric.value,
    rubricFileSha256: rubric.sha256,
    evidence: readJsonDocument(paths.evidence).value,
    frozenManifest: readJsonDocument(paths.manifest).value,
    trustedSigners: readJsonDocument(paths["trusted-signers"]).value,
    toolchainRoot: paths["toolchain-root"],
    toolchainConfig: readJsonDocument(paths["toolchain-config"]).value
  });
  writeFileSync(paths.output, `${JSON.stringify(result, null, 2)}\n`);
  if (result.decision === "no_go") process.exitCode = 1;
  return result;
}
