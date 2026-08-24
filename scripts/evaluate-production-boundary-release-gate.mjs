import { readFileSync } from "node:fs";

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

export function evaluateProductionBoundaryReleaseGate({ oracle, candidates }) {
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
  if (argv.length !== 4) return null;
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const path = argv[index + 1];
    if ((flag !== "--oracle" && flag !== "--candidates") || typeof path !== "string" || path.length === 0 || values.has(flag)) return null;
    values.set(flag, path);
  }
  const oracle = values.get("--oracle");
  const candidates = values.get("--candidates");
  return oracle && candidates ? { oracle, candidates } : null;
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
      result = evaluateProductionBoundaryReleaseGate({
        oracle: readJson(paths.oracle, MAX_ORACLE_BYTES),
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
