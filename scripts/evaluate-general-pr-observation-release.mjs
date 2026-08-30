import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

export function evaluateGeneralPrObservationReleaseV1({ manifest, policy, calibrationSeal, holdoutSeal }) {
  if (!isManifest(manifest) || !isPolicy(policy)) return { status: "NO_GO", reasons: ["release_inputs_invalid"] };
  if (!isScoredSeal(calibrationSeal, "calibration") || !isScoredSeal(holdoutSeal, "holdout")) {
    return { status: "NO_GO", reasons: ["independent_scored_seals_unavailable"] };
  }
  const reasons = [];
  if (!sameJson(manifest.featurePolicy, policy.requiredFeaturePolicy)) reasons.push("feature_policy_mismatch");
  if (calibrationSeal.scoredCandidateManifestHash !== digest(manifest) || holdoutSeal.scoredCandidateManifestHash !== digest(manifest)) reasons.push("candidate_binding_mismatch");
  if (calibrationSeal.caseCount < policy.minimumCalibrationCases || holdoutSeal.caseCount < policy.minimumHoldoutCases) reasons.push("insufficient_independent_denominator");
  if (!policy.hardGates.every((gate) => calibrationSeal.score.hardGates[gate] === 0 && holdoutSeal.score.hardGates[gate] === 0)) reasons.push("hard_gate_failed");
  const qualityState = qualityGateState(policy.qualityThresholds, calibrationSeal.score.quality, holdoutSeal.score.quality);
  if (qualityState === "insufficient") reasons.push("insufficient_quality_evidence");
  if (qualityState === "failed") reasons.push("quality_gate_failed");
  return reasons.length === 0 ? { status: "GO", reasons: [] } : { status: "NO_GO", reasons };
}

export function runGeneralPrObservationReleaseCliV1(argv) {
  const paths = parseArgs(argv);
  if (!paths || existsSync(paths.output)) return 2;
  try {
    const result = evaluateGeneralPrObservationReleaseV1({
      manifest: readJson(paths.manifest),
      calibrationSeal: readJson(paths.calibrationSeal),
      holdoutSeal: readJson(paths.holdoutSeal),
      policy: readJson(paths.policy)
    });
    writeFileSync(paths.output, `${JSON.stringify({ version: 1, ...result })}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    process.stdout.write(`${JSON.stringify({ version: 1, status: result.status })}\n`);
    return result.status === "GO" ? 0 : 1;
  } catch {
    return 2;
  }
}

function isManifest(value) {
  return isRecord(value) && value.version === 1 && typeof value.baseSha === "string" &&
    typeof value.candidateBranch === "string" && value.reportSchemaVersion === "verification-report.v2" &&
    isRecord(value.featurePolicy) && ["semanticObserverShadow", "reviewerAdvisoryObservations", "deterministicRelationConsumption", "positiveProofPromotion"].every((key) => typeof value.featurePolicy[key] === "boolean");
}

function isPolicy(value) {
  return isRecord(value) && value.version === 1 && Number.isSafeInteger(value.minimumCalibrationCases) && value.minimumCalibrationCases > 0 &&
    Number.isSafeInteger(value.minimumHoldoutCases) && value.minimumHoldoutCases > 0 && isRecord(value.requiredFeaturePolicy) &&
    Array.isArray(value.hardGates) && value.hardGates.length > 0 && value.hardGates.every((item) => typeof item === "string") &&
    isRecord(value.qualityThresholds) && Object.keys(value.qualityThresholds).length > 0 &&
    Object.values(value.qualityThresholds).every((item) => typeof item === "number" && Number.isFinite(item) && item >= 0 && item <= 1);
}

function isScoredSeal(value, cohort) {
  return exactKeys(value, ["version", "cohort", "caseCount", "corpusHash", "sourceBindingDigest", "schemaDigest", "selectionPolicyHash", "rubricHash", "toolchainHash", "sealHash", "scoredCandidateManifestHash", "score", "scoredSealHash"]) && value.version === 1 && value.cohort === cohort && Number.isSafeInteger(value.caseCount) && value.caseCount > 0 &&
    isHash(value.corpusHash) && isHash(value.sourceBindingDigest) && isHash(value.schemaDigest) && isHash(value.selectionPolicyHash) &&
    isHash(value.rubricHash) && isHash(value.toolchainHash) && isHash(value.sealHash) && isHash(value.scoredCandidateManifestHash) &&
    isRecord(value.score) && exactKeys(value.score, ["hardGates", "quality"]) && isRecord(value.score.hardGates) && isRecord(value.score.quality) &&
    isHash(value.scoredSealHash) && Object.values(value.score.hardGates).every((item) => Number.isSafeInteger(item) && item >= 0) &&
    Object.values(value.score.quality).every((item) => item === "UNKNOWN" || (typeof item === "number" && Number.isFinite(item) && item >= 0 && item <= 1)) &&
    value.scoredSealHash === digest({ domain: "agentproof.general-pr.scored-seal.v1", seal: withoutKey(value, "scoredSealHash") });
}

function qualityGateState(thresholds, ...scores) {
  for (const [key, threshold] of Object.entries(thresholds)) {
    const values = scores.map((score) => score[key]);
    if (values.some((value) => value === undefined || value === "UNKNOWN")) return "insufficient";
    if (values.some((value) => value < threshold)) return "failed";
  }
  return "passed";
}

function parseArgs(argv) {
  if (argv.length !== 10) return null;
  const values = new Map();
  const allowed = new Map([["--candidate-manifest", "manifest"], ["--calibration-seal", "calibrationSeal"], ["--holdout-seal", "holdoutSeal"], ["--policy", "policy"], ["--output", "output"]]);
  for (let index = 0; index < argv.length; index += 2) {
    const target = allowed.get(argv[index]);
    const value = argv[index + 1];
    if (!target || typeof value !== "string" || value.length === 0 || values.has(target)) return null;
    values.set(target, value);
  }
  return values.size === allowed.size ? Object.fromEntries(values) : null;
}

function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }
function isHash(value) { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value, keys) { return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function sameJson(left, right) { return stableJson(left) === stableJson(right); }
function digest(value) { return createHash("sha256").update(stableJson(value), "utf8").digest("hex"); }
function withoutKey(value, key) { return Object.fromEntries(Object.entries(value).filter(([entry]) => entry !== key)); }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = runGeneralPrObservationReleaseCliV1(process.argv.slice(2));
