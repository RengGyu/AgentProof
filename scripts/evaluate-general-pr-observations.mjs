import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { verifyGeneralPrObservationSealV1 } from "./general-pr-observation-seal.mjs";

const MAX_INPUT_BYTES = 4_194_304;
const HASH = /^[a-f0-9]{64}$/;
const HARD_GATES = [
  "zero_false_contract_supported",
  "zero_false_decisive_relation",
  "zero_false_local_ci_association",
  "zero_authority_elevation",
  "zero_stale_subject_binding",
  "zero_receipt_reuse",
  "zero_incomplete_as_complete",
  "zero_privacy_leak",
  "zero_shadow_report_change",
  "zero_template_test_risk_follow_up_objective_admission",
  "zero_false_missing_targeted_test",
  "zero_false_out_of_scope_by_contract"
];

/**
 * Scores externally labelled, opaque cases. The returned seal is aggregate
 * only: it never serializes case IDs, label text, source bindings, or model
 * output. Missing or malformed custody inputs are unavailable, never a pass.
 */
export function evaluateGeneralPrObservationsV1({ corpus, peerCorpus, liveSmokeCaseIds, goldSeal, manifest, results, candidateSha }) {
  if (!verifyGeneralPrObservationSealV1({ corpus, peerCorpus, liveSmokeCaseIds, seal: goldSeal }) || !isManifest(manifest) || !isHash(candidateSha) || !isResults(results, corpus, goldSeal, manifest)) {
    return { status: "unavailable" };
  }
  const byId = new Map(results.cases.map((item) => [item.caseId, item]));
  const expected = corpus.cases.map((item) => ({ gold: resolvedLabel(item), candidate: byId.get(item.caseId), axis: item.axis }));
  const quality = {
    claimSelectionPrecisionLower95: precisionLower95(expected.filter((item) => item.axis === "source_selection")),
    claimSelectionRecallLower95: recallLower95(expected.filter((item) => item.axis === "source_selection")),
    objectiveAdmissionPrecisionLower95: precisionLower95(expected.filter((item) => item.axis === "span_role")),
    objectiveAdmissionRecallLower95: recallLower95(expected.filter((item) => item.axis === "span_role")),
    evidenceCandidateRecallLower95: evidenceRecallLower95(expected.filter((item) => item.axis === "relation")),
    relationPrecisionLower95: precisionLower95(expected.filter((item) => item.axis === "relation")),
    packageReadyRate: rate(expected, ({ candidate }) => candidate.packageReady),
    sampledCoverageRate: rate(expected, ({ candidate }) => candidate.coverage === "sampled"),
    testObservationExactMatchLower95: exactMatchLower95(expected.filter((item) => item.axis === "observation" && item.gold.observationKind === "test_coverage")),
    scopeMappingExactMatchLower95: exactMatchLower95(expected.filter((item) => item.axis === "observation" && item.gold.observationKind === "scope_mapping"))
  };
  const unsigned = {
    ...goldSeal,
    candidateSha,
    scoredCandidateManifestHash: stableDigest(manifest),
    score: { hardGates: results.hardGates, quality }
  };
  return {
    status: "scored",
    seal: {
      ...unsigned,
      scoredSealHash: stableDigest({ domain: "agentproof.general-pr.scored-seal.v1", seal: unsigned })
    }
  };
}

export function runGeneralPrObservationEvaluationCliV1(argv) {
  const paths = parseArgs(argv);
  if (!paths || existsSync(paths.output)) return 2;
  try {
    const result = evaluateGeneralPrObservationsV1({
      corpus: readJson(paths.corpus),
      peerCorpus: readJson(paths.peerCorpus),
      liveSmokeCaseIds: readLiveSmokeCaseIds(paths.liveSmokeCaseIds),
      goldSeal: readJson(paths.goldSeal),
      manifest: readJson(paths.manifest),
      results: readJson(paths.results),
      candidateSha: paths.candidateSha
    });
    if (result.status !== "scored") return 1;
    writeFileSync(paths.output, `${JSON.stringify(result.seal)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    process.stdout.write('{"version":1,"status":"scored"}\n');
    return 0;
  } catch {
    return 2;
  }
}

function isManifest(value) {
  return isRecord(value) && value.version === 1 && typeof value.baseSha === "string" &&
    typeof value.candidateBranch === "string" && value.reportSchemaVersion === "verification-report.v2" && isRecord(value.featurePolicy);
}

function isResults(value, corpus, goldSeal, manifest) {
  if (!isRecord(value) || Object.keys(value).length !== 5 || value.version !== 1 || value.goldSealHash !== goldSeal.sealHash ||
    value.candidateManifestHash !== stableDigest(manifest) || !isHardGates(value.hardGates) || !Array.isArray(value.cases) || value.cases.length !== corpus.cases.length) return false;
  const expectedById = new Map(corpus.cases.map((item) => [item.caseId, item]));
  const seen = new Set();
  return value.cases.every((item) => {
    const gold = expectedById.get(item?.caseId);
    if (!gold || seen.has(item.caseId) || !sameBinding(gold, item)) return false;
    seen.add(item.caseId);
    return gold.axis === "observation"
      ? isObservationCandidate(item, resolvedLabel(gold).observationKind)
      : gold.axis === "relation"
        ? isRelationCandidate(item)
        : isBinaryCandidate(item);
  });
}

function sameBinding(gold, candidate) {
  return isRecord(candidate) && candidate.version === 1 &&
    ["caseId", "sourceHash", "contentHash", "headHash", "inventoryHash", "normalizerHash"].every((key) => candidate[key] === gold[key]);
}

function isBinaryCandidate(value) {
  return exactKeys(value, ["version", "caseId", "sourceHash", "contentHash", "headHash", "inventoryHash", "normalizerHash", "decision", "packageReady", "coverage"]) &&
    isOperationalResult(value) &&
    ["positive", "negative", "abstain"].includes(value.decision);
}

function isObservationCandidate(value, kind) {
  if (!exactKeys(value, ["version", "caseId", "sourceHash", "contentHash", "headHash", "inventoryHash", "normalizerHash", "observationKind", "state", "packageReady", "coverage"]) || !isOperationalResult(value) || value.observationKind !== kind) return false;
  return kind === "test_coverage"
    ? ["covered_by_verified_relation", "verified_test_failed", "related_test_observed", "missing_targeted_test", "test_not_applicable", "relation_unresolved", "execution_unresolved", "collection_unavailable"].includes(value.state)
    : ["mapped_by_verified_relation", "plausibly_mapped", "unmapped", "out_of_scope_by_contract", "collection_unavailable"].includes(value.state);
}

function isRelationCandidate(value) {
  return exactKeys(value, ["version", "caseId", "sourceHash", "contentHash", "headHash", "inventoryHash", "normalizerHash", "decision", "packageReady", "coverage", "evidenceCandidateSelected"]) &&
    isOperationalResult(value) && typeof value.evidenceCandidateSelected === "boolean" &&
    ["positive", "negative", "abstain"].includes(value.decision);
}

function isOperationalResult(value) {
  return typeof value.packageReady === "boolean" && ["complete", "sampled", "unavailable"].includes(value.coverage);
}

function isHardGates(value) {
  return exactKeys(value, HARD_GATES) && HARD_GATES.every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0);
}

function resolvedLabel(gold) {
  return gold.adjudication ?? gold.labels[0];
}

function exactMatchLower95(items) {
  if (items.length === 0) return "UNKNOWN";
  return wilsonLower(items.filter(({ gold, candidate }) => gold.decision === candidate.decision || (gold.state === candidate.state && gold.observationKind === candidate.observationKind)).length, items.length);
}

function precisionLower95(items) {
  const predictedPositive = items.filter(({ candidate }) => candidate.decision === "positive");
  if (predictedPositive.length === 0) return "UNKNOWN";
  return wilsonLower(predictedPositive.filter(({ gold }) => gold.decision === "positive").length, predictedPositive.length);
}

function recallLower95(items) {
  const actualPositive = items.filter(({ gold }) => gold.decision === "positive");
  if (actualPositive.length === 0) return "UNKNOWN";
  return wilsonLower(actualPositive.filter(({ candidate }) => candidate.decision === "positive").length, actualPositive.length);
}

function evidenceRecallLower95(items) {
  const relevant = items.filter(({ gold }) => gold.decision === "positive");
  if (relevant.length === 0) return "UNKNOWN";
  return wilsonLower(relevant.filter(({ candidate }) => candidate.evidenceCandidateSelected).length, relevant.length);
}

function rate(items, predicate) {
  return Number((items.filter(predicate).length / items.length).toFixed(12));
}

function wilsonLower(successes, total) {
  const z = 1.6448536269514722;
  const proportion = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = proportion + (z * z) / (2 * total);
  const margin = z * Math.sqrt((proportion * (1 - proportion) + (z * z) / (4 * total)) / total);
  return Math.max(0, Number(((centre - margin) / denominator).toFixed(12)));
}

function parseArgs(argv) {
  if (argv.length !== 16) return null;
  const allowed = new Map([["--gold-corpus", "corpus"], ["--peer-corpus", "peerCorpus"], ["--live-smoke-case-ids", "liveSmokeCaseIds"], ["--gold-seal", "goldSeal"], ["--candidate-manifest", "manifest"], ["--candidate-results", "results"], ["--candidate-sha", "candidateSha"], ["--output", "output"]]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const target = allowed.get(argv[index]);
    const value = argv[index + 1];
    if (!target || typeof value !== "string" || value.length === 0 || values.has(target)) return null;
    values.set(target, value);
  }
  return values.size === allowed.size ? Object.fromEntries(values) : null;
}

function readJson(path) {
  const raw = readFileSync(path, "utf8");
  if (Buffer.byteLength(raw, "utf8") > MAX_INPUT_BYTES) throw new Error("evaluation input exceeds byte limit");
  return JSON.parse(raw);
}
function readLiveSmokeCaseIds(path) {
  const value = readJson(path);
  return exactKeys(value, ["version", "caseIds"]) && value.version === 1 ? value.caseIds : null;
}
function exactKeys(value, keys) { return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isHash(value) { return typeof value === "string" && /^[a-f0-9]{40}$/.test(value); }
function stableDigest(value) { return createHash("sha256").update(stableJson(value), "utf8").digest("hex"); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = runGeneralPrObservationEvaluationCliV1(process.argv.slice(2));
