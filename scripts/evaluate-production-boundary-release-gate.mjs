import { readFileSync } from "node:fs";
import { deriveBoundaryReferenceV2 } from "./evidence-release-reference-policy-v2.mjs";

const UNKNOWN = "UNKNOWN";
const MAX_ORACLE_BYTES = 131_072;
const MAX_CANDIDATE_BYTES = 409_600;
const MAX_CASES = 12;
const METRIC_KEYS = [
  "untrustedActiveV2AcceptanceCount",
  "pastedEvidenceGithubAuthorityCount",
  "falseBoundaryLocalPositiveCount",
  "boundaryPrivacyLeakCount",
  "boundaryStructuralMismatchCount"
];
const RESULT_KEYS = [
  "caseId", "disposition", "provenanceOrigin", "localAxisStates", "requirementLocalCiOwnership", "leakCount"
];
const EXPECTED_KEYS = RESULT_KEYS.slice(1);
const AXIS_KEYS = ["implementation", "targeted_test", "execution"];
const AXIS_STATES = new Set(["satisfied", "violated", "incomplete"]);
const DISPOSITIONS = new Set(["accepted", "rejected"]);
const ORIGINS = new Set(["github_snapshot", "pasted_evidence", "demo", "none"]);
const OWNERSHIP = new Set(["associated", "local", "unknown"]);
const POSITIVE_OWNERSHIP = new Set(["associated", "local"]);

/** Development-only V1 comparator. The release CLI never calls this path. */
export function evaluateProductionBoundaryReleaseGateV1({ oracle, candidates }) {
  if (!isOracleCorpus(oracle) || !isCandidateCorpus(candidates)) return unknownResult();
  const candidateById = new Map();
  for (const candidate of candidates.cases) {
    if (candidateById.has(candidate.caseId)) return unknownResult();
    candidateById.set(candidate.caseId, candidate);
  }
  const oracleIds = new Set(oracle.cases.map((item) => item.caseId));
  if (oracleIds.size !== oracle.cases.length || candidateById.size !== oracleIds.size ||
    [...candidateById.keys()].some((caseId) => !oracleIds.has(caseId))) return unknownResult();

  let untrustedActiveV2AcceptanceCount = 0;
  let pastedEvidenceGithubAuthorityCount = 0;
  let falseBoundaryLocalPositiveCount = 0;
  let boundaryPrivacyLeakCount = 0;
  let boundaryStructuralMismatchCount = 0;

  for (const oracleCase of oracle.cases) {
    const candidate = candidateById.get(oracleCase.caseId);
    if (!candidate) return unknownResult();
    const expected = oracleCase.expected;
    if (oracleCase.kind === "inbound_untrusted_v2" && expected.disposition === "rejected" && candidate.disposition === "accepted") {
      untrustedActiveV2AcceptanceCount += 1;
    }
    if (oracleCase.kind === "pasted_merge" && expected.provenanceOrigin !== "github_snapshot" &&
      candidate.provenanceOrigin === "github_snapshot") {
      pastedEvidenceGithubAuthorityCount += 1;
    }
    for (const axis of AXIS_KEYS) {
      if (expected.localAxisStates[axis] !== "satisfied" && candidate.localAxisStates[axis] === "satisfied") {
        falseBoundaryLocalPositiveCount += 1;
      }
    }
    if (!POSITIVE_OWNERSHIP.has(expected.requirementLocalCiOwnership) &&
      POSITIVE_OWNERSHIP.has(candidate.requirementLocalCiOwnership)) {
      falseBoundaryLocalPositiveCount += 1;
    }
    boundaryPrivacyLeakCount += candidate.leakCount;
    if (!sameResult(expected, candidate)) boundaryStructuralMismatchCount += 1;
  }

  return {
    untrustedActiveV2AcceptanceCount,
    pastedEvidenceGithubAuthorityCount,
    falseBoundaryLocalPositiveCount,
    boundaryPrivacyLeakCount,
    boundaryStructuralMismatchCount
  };
}

/**
 * Release-only V2 comparison. The expected boundary result is derived from
 * the sealed corpus in memory, not read from a manually authored oracle.
 */
export function evaluateProductionBoundaryReleaseGateV2({ cases, seal, candidates }) {
  const reference = deriveBoundaryReferenceV2(cases, seal);
  if (!reference || !isCandidateCorpusV2(candidates, new Set(reference.cases.map((item) => item.caseId)))) return unknownResult();
  const candidatesById = new Map(candidates.cases.map((item) => [item.caseId, item]));
  const candidateCases = reference.cases.map((item) => candidatesById.get(item.caseId));
  if (candidateCases.some((item) => !item)) return unknownResult();

  let untrustedActiveV2AcceptanceCount = 0;
  let pastedEvidenceGithubAuthorityCount = 0;
  let falseBoundaryLocalPositiveCount = 0;
  let boundaryPrivacyLeakCount = 0;
  let boundaryStructuralMismatchCount = 0;

  for (let index = 0; index < reference.cases.length; index += 1) {
    const expected = reference.cases[index].reference;
    const candidate = candidateCases[index];
    if (expected.disposition === "rejected" && candidate.disposition === "accepted") untrustedActiveV2AcceptanceCount += 1;
    if (expected.disposition === "accepted" && expected.provenanceOrigin !== "github_snapshot" && candidate.provenanceOrigin === "github_snapshot") {
      pastedEvidenceGithubAuthorityCount += 1;
    }
    for (const axis of AXIS_KEYS) {
      if (expected.localAxisStates[axis] !== "satisfied" && candidate.localAxisStates[axis] === "satisfied") {
        falseBoundaryLocalPositiveCount += 1;
      }
    }
    if (!POSITIVE_OWNERSHIP.has(expected.requirementLocalCiOwnership) && POSITIVE_OWNERSHIP.has(candidate.requirementLocalCiOwnership)) {
      falseBoundaryLocalPositiveCount += 1;
    }
    boundaryPrivacyLeakCount += candidate.leakCount;
    if (!sameResult(expected, candidate)) boundaryStructuralMismatchCount += 1;
  }

  return {
    untrustedActiveV2AcceptanceCount,
    pastedEvidenceGithubAuthorityCount,
    falseBoundaryLocalPositiveCount,
    boundaryPrivacyLeakCount,
    boundaryStructuralMismatchCount
  };
}

export function productionBoundaryReleaseGatePasses(result) {
  return hasExactKeys(result, METRIC_KEYS) && METRIC_KEYS.every((key) => result[key] === 0);
}

function isOracleCorpus(value) {
  return serializedBytes(value) <= MAX_ORACLE_BYTES && hasExactKeys(value, ["version", "cases"]) && value.version === 1 &&
    Array.isArray(value.cases) && value.cases.length > 0 && value.cases.length <= MAX_CASES && value.cases.every((item) =>
      hasExactKeys(item, ["version", "caseId", "kind", "expected"]) && item.version === 1 && isOpaqueId(item.caseId) &&
      (item.kind === "inbound_untrusted_v2" || item.kind === "pasted_merge") && isExpected(item.expected));
}

function isCandidateCorpus(value) {
  return serializedBytes(value) <= MAX_CANDIDATE_BYTES && hasExactKeys(value, ["version", "cases"]) && value.version === 1 &&
    Array.isArray(value.cases) && value.cases.length > 0 && value.cases.length <= MAX_CASES && value.cases.every((item) =>
      hasExactKeys(item, RESULT_KEYS) && isOpaqueId(item.caseId) && isResultFields(item));
}

function isCandidateCorpusV2(value, caseIds) {
  if (serializedBytes(value) > MAX_CANDIDATE_BYTES || !hasExactKeys(value, ["version", "cases"]) || value.version !== 2 ||
    !Array.isArray(value.cases) || value.cases.length !== caseIds.size) return false;
  const seen = new Set();
  for (const item of value.cases) {
    if (!hasExactKeys(item, RESULT_KEYS) || !isOpaqueId(item.caseId) || !caseIds.has(item.caseId) || seen.has(item.caseId) || !isResultFields(item)) return false;
    seen.add(item.caseId);
  }
  return true;
}

function isExpected(value) {
  return hasExactKeys(value, EXPECTED_KEYS) && isResultFields(value);
}

function isResultFields(value) {
  return isRecord(value) && DISPOSITIONS.has(value.disposition) && ORIGINS.has(value.provenanceOrigin) &&
    hasExactKeys(value.localAxisStates, AXIS_KEYS) && AXIS_KEYS.every((axis) => AXIS_STATES.has(value.localAxisStates[axis])) &&
    OWNERSHIP.has(value.requirementLocalCiOwnership) && Number.isSafeInteger(value.leakCount) && value.leakCount >= 0;
}

function sameResult(expected, candidate) {
  return expected.disposition === candidate.disposition &&
    expected.provenanceOrigin === candidate.provenanceOrigin &&
    AXIS_KEYS.every((axis) => expected.localAxisStates[axis] === candidate.localAxisStates[axis]) &&
    expected.requirementLocalCiOwnership === candidate.requirementLocalCiOwnership &&
    expected.leakCount === candidate.leakCount;
}

function unknownResult() {
  return Object.fromEntries(METRIC_KEYS.map((key) => [key, UNKNOWN]));
}

function hasExactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOpaqueId(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function serializedBytes(value) {
  try { return Buffer.byteLength(JSON.stringify(value), "utf8"); } catch { return Number.POSITIVE_INFINITY; }
}

function parseCliPaths(argv) {
  if (argv.length !== 6) return null;
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const path = argv[index + 1];
    if ((flag !== "--cases" && flag !== "--seal" && flag !== "--candidates") || typeof path !== "string" || path.length === 0 || values.has(flag)) return null;
    values.set(flag, path);
  }
  const cases = values.get("--cases");
  const seal = values.get("--seal");
  const candidates = values.get("--candidates");
  return cases && seal && candidates ? { cases, seal, candidates } : null;
}

function readJson(path, maxBytes) {
  const raw = readFileSync(path, "utf8");
  if (Buffer.byteLength(raw, "utf8") > maxBytes) throw new Error("evaluation envelope exceeds its byte limit");
  return JSON.parse(raw);
}

function runCli() {
  let result = unknownResult();
  try {
    const paths = parseCliPaths(process.argv.slice(2));
    if (paths) {
      result = evaluateProductionBoundaryReleaseGateV2({
        cases: readJson(paths.cases, MAX_CANDIDATE_BYTES),
        seal: readJson(paths.seal, MAX_ORACLE_BYTES),
        candidates: readJson(paths.candidates, MAX_CANDIDATE_BYTES)
      });
    }
  } catch {
    result = unknownResult();
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!productionBoundaryReleaseGatePasses(result)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) runCli();
