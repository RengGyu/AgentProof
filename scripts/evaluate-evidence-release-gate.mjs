import { readFileSync } from "node:fs";

const UNKNOWN = "UNKNOWN";
const POSITIVE_AXIS_STATE = "satisfied";
const POSITIVE_LOCAL_CI_ASSOCIATIONS = new Set(["associated", "local", "matched"]);
const ORACLE_CORPUS_KEYS = ["version", "cases"];
const ORACLE_CASE_KEYS = ["version", "caseId", "expected"];
const CANDIDATE_CORPUS_KEYS = ["version", "cases"];
const CANDIDATE_CASE_KEYS = ["version", "caseId", "actual"];
const CANDIDATE_CASE_WITH_METRICS_KEYS = [...CANDIDATE_CASE_KEYS, "metrics"];
const EXPECTED_KEYS = ["sourceKind", "authority", "requirements", "projection"];
const ACTUAL_KEYS = ["sourceKind", "authority", "requirements", "projection"];
const COMMON_REQUIREMENT_KEYS = ["stableOracleId", "ordinal", "axisStates", "localCiAssociation", "outcome"];
const EXPECTED_REQUIREMENT_KEYS = [...COMMON_REQUIREMENT_KEYS, "testReceiptCount", "executionReceiptCount"];
const CANDIDATE_REQUIREMENT_KEYS = [...COMMON_REQUIREMENT_KEYS, "testReceiptIds", "executionReceiptIds"];
const AXIS_STATE_KEYS = ["implementation", "targeted_test", "execution"];
const PROJECTION_KEYS = ["privateReceiptLeakCount"];
const METRICS_KEYS = ["unexpectedFailure", "durationMs", "github", "providerCallCount"];
const PARTIAL_METRICS_KEYS = ["unexpectedFailure", "durationMs"];
const METRICS_WITH_FAILURE_STAGE_KEYS = [...METRICS_KEYS, "failureStage"];
const PARTIAL_METRICS_WITH_FAILURE_STAGE_KEYS = [...PARTIAL_METRICS_KEYS, "failureStage"];
const GITHUB_METRICS_KEYS = ["requests", "pages", "retries"];
const FAILURE_STAGES = new Set(["report_generation", "requirement_projection", "privacy_projection"]);

/**
 * Compares a single opaque oracle case with its candidate result. This
 * detailed representation is private to the evaluator; the CLI emits only
 * aggregate metrics from these diffs.
 */
export function diffEvidenceReleaseCase(oracleCase, candidateCase) {
  const fields = [];
  const expected = oracleCase?.expected;
  const actual = candidateCase?.actual;

  if (!isRecord(expected)) {
    return { caseId: safeCaseId(oracleCase), fields: ["expected"] };
  }
  if (!isRecord(actual)) {
    return { caseId: safeCaseId(oracleCase), fields: ["actual"] };
  }

  compareValue(fields, "sourceKind", expected.sourceKind, actual.sourceKind);
  compareValue(fields, "authority", expected.authority, actual.authority);

  const expectedRequirements = arrayOrEmpty(expected.requirements);
  const actualRequirements = arrayOrEmpty(actual.requirements);
  if (expectedRequirements.length !== actualRequirements.length) {
    fields.push("requirements.length");
  }

  for (let index = 0; index < Math.max(expectedRequirements.length, actualRequirements.length); index += 1) {
    compareRequirement(fields, expectedRequirements[index], actualRequirements[index], index);
  }

  compareProjection(fields, expected.projection, actual.projection);

  return { caseId: safeCaseId(oracleCase), fields };
}

/**
 * Produces the release-gate's public, aggregate-only result. Inputs may carry
 * opaque receipt handles for ownership checks; no identifiers or diffs are
 * returned here.
 */
export function evaluateEvidenceReleaseGate({ oracle, candidates }) {
  if (!isValidOracleCorpus(oracle)) return unavailableReleaseGateResult();

  const oracleCases = arrayOrEmpty(oracle?.cases);
  const candidateById = indexCandidateCases(candidates, new Set(oracleCases.map((item) => item.caseId)));
  if (candidateById === null) return unavailableReleaseGateResult();
  const diffs = oracleCases.map((oracleCase) => diffEvidenceReleaseCase(oracleCase, candidateById.get(oracleCase?.caseId)));
  const candidateCases = oracleCases.map((oracleCase) => candidateById.get(oracleCase?.caseId));
  const structuralMismatchCount = diffs.filter((diff) => diff.fields.length > 0).length;
  const comparisonComplete = oracleCases.every((oracleCase, index) =>
    isValidExpected(oracleCase?.expected) && isValidCandidateActual(candidateCases[index]?.actual)
  );

  const falseSupported = comparisonComplete
    ? countFalseSupported(oracleCases, candidateCases)
    : UNKNOWN;
  const falseLocalCi = comparisonComplete
    ? countFalseLocalCiAssociations(oracleCases, candidateCases)
    : UNKNOWN;
  const receiptReuse = comparisonComplete ? countCrossRequirementReceiptReuse(candidateCases) : UNKNOWN;
  const privacyLeak = countPrivacyLeaks(oracleCases, candidateCases);

  return {
    totalCases: oracleCases.length,
    structuralMismatchCount,
    falseSupportedCount: falseSupported,
    falseRequirementLocalCiAssociationCount: falseLocalCi,
    crossRequirementReceiptReuseCount: receiptReuse,
    privacyLeakCount: privacyLeak,
    unexpectedFailure: booleanMetric(candidateCases, (metrics) => metrics.unexpectedFailure),
    durationMs: percentileMetric(candidateCases, (metrics) => metrics.durationMs),
    githubRequestCount: percentileMetric(candidateCases, (metrics) => metrics.github?.requests),
    githubPageCount: percentileMetric(candidateCases, (metrics) => metrics.github?.pages),
    githubRetryCount: percentileMetric(candidateCases, (metrics) => metrics.github?.retries),
    providerCallCount: sumMetric(candidateCases, (metrics) => metrics.providerCallCount)
  };
}

/**
 * The release decision only treats metrics with a zero threshold as blocking.
 * Duration and GitHub request/page collection metrics remain observable but do
 * not acquire a threshold here.
 */
export function releaseGatePasses(result) {
  return isPositiveInteger(result?.totalCases) &&
    isZero(result?.structuralMismatchCount) &&
    isZero(result?.falseSupportedCount) &&
    isZero(result?.falseRequirementLocalCiAssociationCount) &&
    isZero(result?.crossRequirementReceiptReuseCount) &&
    isZero(result?.privacyLeakCount) &&
    isZero(result?.unexpectedFailure?.count) &&
    isZero(result?.githubRetryCount?.p50) &&
    isZero(result?.githubRetryCount?.p95) &&
    isZero(result?.providerCallCount);
}

function unavailableReleaseGateResult() {
  return {
    totalCases: UNKNOWN,
    structuralMismatchCount: UNKNOWN,
    falseSupportedCount: UNKNOWN,
    falseRequirementLocalCiAssociationCount: UNKNOWN,
    crossRequirementReceiptReuseCount: UNKNOWN,
    privacyLeakCount: UNKNOWN,
    unexpectedFailure: { count: UNKNOWN, rate: UNKNOWN },
    durationMs: { p50: UNKNOWN, p95: UNKNOWN },
    githubRequestCount: { p50: UNKNOWN, p95: UNKNOWN },
    githubPageCount: { p50: UNKNOWN, p95: UNKNOWN },
    githubRetryCount: { p50: UNKNOWN, p95: UNKNOWN },
    providerCallCount: UNKNOWN
  };
}

function isValidOracleCorpus(oracle) {
  if (!hasExactKeys(oracle, ORACLE_CORPUS_KEYS) || oracle.version !== 1 || !Array.isArray(oracle.cases) || oracle.cases.length === 0) return false;
  const caseIds = new Set();
  for (const item of oracle.cases) {
    if (!hasExactKeys(item, ORACLE_CASE_KEYS) || item.version !== 1 || !hasText(item.caseId) || !isValidExpected(item.expected)) return false;
    if (caseIds.has(item.caseId)) return false;
    caseIds.add(item.caseId);
  }
  return true;
}

function indexCandidateCases(candidates, oracleCaseIds) {
  if (!hasExactKeys(candidates, CANDIDATE_CORPUS_KEYS) || candidates.version !== 1 || !Array.isArray(candidates.cases)) return null;
  const candidateById = new Map();
  for (const item of candidates.cases) {
    if (!isValidCandidateCase(item) || candidateById.has(item.caseId)) return null;
    candidateById.set(item.caseId, item);
  }
  if (candidateById.size !== oracleCaseIds.size) return null;
  for (const caseId of candidateById.keys()) {
    if (!oracleCaseIds.has(caseId)) return null;
  }
  return candidateById;
}

function isValidCandidateCase(candidateCase) {
  return (hasExactKeys(candidateCase, CANDIDATE_CASE_KEYS) || hasExactKeys(candidateCase, CANDIDATE_CASE_WITH_METRICS_KEYS)) &&
    candidateCase.version === 1 &&
    hasText(candidateCase.caseId) &&
    isValidCandidateActual(candidateCase.actual) &&
    (candidateCase.metrics === undefined || isValidMetrics(candidateCase.metrics));
}

function isValidExpected(expected) {
  return hasExactKeys(expected, EXPECTED_KEYS) &&
    hasText(expected.sourceKind) &&
    hasText(expected.authority) &&
    Array.isArray(expected.requirements) &&
    expected.requirements.length > 0 &&
    expected.requirements.every(isValidExpectedRequirement) &&
    isValidProjection(expected.projection);
}

function isValidExpectedRequirement(requirement) {
  return hasExactKeys(requirement, EXPECTED_REQUIREMENT_KEYS) &&
    isCommonRequirementShape(requirement) &&
    isNonNegativeInteger(requirement.testReceiptCount) &&
    isNonNegativeInteger(requirement.executionReceiptCount);
}

function isValidCandidateActual(actual) {
  return hasExactKeys(actual, ACTUAL_KEYS) &&
    hasText(actual.sourceKind) &&
    hasText(actual.authority) &&
    Array.isArray(actual.requirements) &&
    actual.requirements.length > 0 &&
    actual.requirements.every(isValidCandidateRequirement) &&
    isValidProjection(actual.projection);
}

function isValidCandidateRequirement(requirement) {
  return hasExactKeys(requirement, CANDIDATE_REQUIREMENT_KEYS) &&
    isCommonRequirementShape(requirement) &&
    hasValidReceiptDeclaration(requirement, "test") &&
    hasValidReceiptDeclaration(requirement, "execution");
}

function isCommonRequirementShape(requirement) {
  return isRecord(requirement) &&
    hasText(requirement.stableOracleId) &&
    isNonNegativeInteger(requirement.ordinal) &&
    hasRequiredAxes(requirement.axisStates) &&
    hasText(requirement.localCiAssociation) &&
    hasText(requirement.outcome);
}

function hasRequiredAxes(axisStates) {
  return hasExactKeys(axisStates, AXIS_STATE_KEYS) && AXIS_STATE_KEYS.every((axis) => hasText(axisStates[axis]));
}

function hasValidReceiptDeclaration(requirement, kind) {
  const ids = requirement[`${kind}ReceiptIds`];
  return Array.isArray(ids) && ids.every(hasText) && hasUniqueValues(ids);
}

function isValidProjection(projection) {
  return hasExactKeys(projection, PROJECTION_KEYS) && isNonNegativeInteger(projection.privateReceiptLeakCount);
}

function isValidMetrics(metrics) {
  if (!hasExactKeys(metrics, METRICS_KEYS) && !hasExactKeys(metrics, PARTIAL_METRICS_KEYS) &&
    !hasExactKeys(metrics, METRICS_WITH_FAILURE_STAGE_KEYS) &&
    !hasExactKeys(metrics, PARTIAL_METRICS_WITH_FAILURE_STAGE_KEYS)) return false;
  return typeof metrics.unexpectedFailure === "boolean" &&
    isNonNegativeNumber(metrics.durationMs) &&
    (metrics.failureStage === undefined || (metrics.unexpectedFailure && FAILURE_STAGES.has(metrics.failureStage))) &&
    (metrics.github === undefined || (hasExactKeys(metrics.github, GITHUB_METRICS_KEYS) &&
      GITHUB_METRICS_KEYS.every((key) => isNonNegativeNumber(metrics.github[key])))) &&
    (metrics.providerCallCount === undefined || isNonNegativeNumber(metrics.providerCallCount));
}

function compareRequirement(fields, expected, actual, index) {
  const prefix = `requirements[${index}]`;
  if (!isRecord(expected) || !isRecord(actual)) {
    fields.push(prefix);
    return;
  }

  compareValue(fields, `${prefix}.stableOracleId`, expected.stableOracleId, actual.stableOracleId);
  compareValue(fields, `${prefix}.ordinal`, expected.ordinal, actual.ordinal);
  for (const [axis, state] of Object.entries(isRecord(expected.axisStates) ? expected.axisStates : {})) {
    compareValue(fields, `${prefix}.axisStates.${axis}`, state, actual.axisStates?.[axis]);
  }
  compareValue(fields, `${prefix}.testReceiptCount`, expected.testReceiptCount, receiptCount(actual, "test"));
  compareValue(fields, `${prefix}.executionReceiptCount`, expected.executionReceiptCount, receiptCount(actual, "execution"));
  compareValue(fields, `${prefix}.localCiAssociation`, expected.localCiAssociation, actual.localCiAssociation);
  compareValue(fields, `${prefix}.outcome`, expected.outcome, actual.outcome);

  for (const kind of ["test", "execution"]) {
    const receipts = receiptHandles(actual, kind);
    if (receipts.some((receipt) => receipt.ownerStableOracleId !== undefined && receipt.ownerStableOracleId !== actual.stableOracleId)) {
      fields.push(`${prefix}.${kind}ReceiptOwnership`);
    }
  }
}

function compareProjection(fields, expected, actual) {
  if (!isRecord(expected) || !isRecord(actual)) {
    fields.push("projection");
    return;
  }

  for (const [key, value] of Object.entries(expected)) {
    compareValue(fields, `projection.${key}`, value, actual[key]);
  }
  if (hasPrivateProjectionField(actual)) fields.push("projection.privateFieldLeak");
}

function compareValue(fields, path, expected, actual) {
  if (!sameJsonValue(expected, actual)) fields.push(path);
}

function countFalseSupported(oracleCases, candidateCases) {
  let count = 0;
  for (let caseIndex = 0; caseIndex < oracleCases.length; caseIndex += 1) {
    const expectedRequirements = arrayOrEmpty(oracleCases[caseIndex]?.expected?.requirements);
    const actualRequirements = arrayOrEmpty(candidateCases[caseIndex]?.actual?.requirements);
    for (let index = 0; index < expectedRequirements.length; index += 1) {
      const expected = expectedRequirements[index];
      const actual = actualRequirements[index];
      if (!isRecord(expected) || !isRecord(actual)) continue;
      const unexpectedSatisfiedAxis = Object.entries(isRecord(expected.axisStates) ? expected.axisStates : {})
        .some(([axis, state]) => state !== POSITIVE_AXIS_STATE && actual.axisStates?.[axis] === POSITIVE_AXIS_STATE);
      const unexpectedMetOutcome = expected.outcome !== "met" && actual.outcome === "met";
      if (unexpectedSatisfiedAxis || unexpectedMetOutcome) count += 1;
    }
  }
  return count;
}

function countFalseLocalCiAssociations(oracleCases, candidateCases) {
  let count = 0;
  for (let caseIndex = 0; caseIndex < oracleCases.length; caseIndex += 1) {
    const expectedRequirements = arrayOrEmpty(oracleCases[caseIndex]?.expected?.requirements);
    const actualRequirements = arrayOrEmpty(candidateCases[caseIndex]?.actual?.requirements);
    for (let index = 0; index < expectedRequirements.length; index += 1) {
      const expected = expectedRequirements[index];
      const actual = actualRequirements[index];
      if (!isRecord(expected) || !isRecord(actual)) continue;
      if (expected.localCiAssociation !== actual.localCiAssociation && POSITIVE_LOCAL_CI_ASSOCIATIONS.has(actual.localCiAssociation)) {
        count += 1;
      }
    }
  }
  return count;
}

function countCrossRequirementReceiptReuse(candidateCases) {
  const ownersByReceipt = new Map();
  let unavailable = false;

  for (const candidateCase of candidateCases) {
    const requirements = arrayOrEmpty(candidateCase?.actual?.requirements);
    for (const requirement of requirements) {
      if (!isRecord(requirement)) {
        unavailable = true;
        continue;
      }
      for (const kind of ["test", "execution"]) {
        const count = receiptCount(requirement, kind);
        const handles = receiptHandles(requirement, kind);
        if (!Number.isInteger(count) || count < 0 || (count > 0 && handles.length !== count)) {
          unavailable = true;
          continue;
        }
        for (const receipt of handles) {
          if (!receipt.id) {
            unavailable = true;
            continue;
          }
          const owner = `${candidateCase?.caseId ?? ""}:${requirement.stableOracleId ?? ""}`;
          const owners = ownersByReceipt.get(receipt.id) ?? new Set();
          owners.add(owner);
          ownersByReceipt.set(receipt.id, owners);
        }
      }
    }
  }

  if (unavailable) return UNKNOWN;
  return [...ownersByReceipt.values()].reduce((sum, owners) => sum + Math.max(0, owners.size - 1), 0);
}

function countPrivacyLeaks(oracleCases, candidateCases) {
  let count = 0;
  for (let index = 0; index < oracleCases.length; index += 1) {
    if (FAILURE_STAGES.has(candidateCases[index]?.metrics?.failureStage)) return UNKNOWN;
    const projection = candidateCases[index]?.actual?.projection;
    if (!isRecord(projection) || !Number.isInteger(projection.privateReceiptLeakCount) || projection.privateReceiptLeakCount < 0) {
      return UNKNOWN;
    }
    count += projection.privateReceiptLeakCount;
    if (hasPrivateProjectionField(projection)) count += 1;
  }
  return count;
}

function receiptCount(requirement, kind) {
  return receiptHandles(requirement, kind).length;
}

function receiptHandles(requirement, kind) {
  const ids = requirement?.[`${kind}ReceiptIds`];
  if (Array.isArray(ids)) {
    return ids.map((id) => ({ id: typeof id === "string" ? id : "", ownerStableOracleId: undefined }));
  }
  return [];
}

function booleanMetric(candidateCases, select) {
  const values = metricValues(candidateCases, select, (value) => typeof value === "boolean");
  if (values === null) return { count: UNKNOWN, rate: UNKNOWN };
  const count = values.filter(Boolean).length;
  return { count, rate: candidateCases.length === 0 ? UNKNOWN : count / candidateCases.length };
}

function percentileMetric(candidateCases, select) {
  const values = metricValues(candidateCases, select, isNonNegativeNumber);
  if (values === null) return { p50: UNKNOWN, p95: UNKNOWN };
  return { p50: percentile(values, 0.5), p95: percentile(values, 0.95) };
}

function sumMetric(candidateCases, select) {
  const values = metricValues(candidateCases, select, isNonNegativeNumber);
  return values === null ? UNKNOWN : values.reduce((sum, value) => sum + value, 0);
}

function metricValues(candidateCases, select, valid) {
  const values = [];
  for (const candidateCase of candidateCases) {
    const value = select(candidateCase?.metrics ?? {});
    if (!valid(value)) return null;
    values.push(value);
  }
  return values;
}

function percentile(values, percentileValue) {
  if (values.length === 0) return UNKNOWN;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * percentileValue;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const value = sorted[lower] + ((sorted[upper] - sorted[lower]) * (position - lower));
  return Number(value.toFixed(6));
}

function hasPrivateProjectionField(projection) {
  return Object.keys(projection).some((key) => key !== "privateReceiptLeakCount" && /receipt|digest|sha(?:256)?|token|raw|log/i.test(key));
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function hasUniqueValues(values) {
  return new Set(values).size === values.length;
}

function isNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function hasText(value) {
  return typeof value === "string" && value.length > 0;
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isZero(value) {
  return value === 0;
}

function sameJsonValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function safeCaseId(value) {
  return typeof value?.caseId === "string" ? value.caseId : "unknown";
}

function readArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if ((name !== "--oracle" && name !== "--candidates") || !value) return null;
    values.set(name, value);
  }
  return values.has("--oracle") && values.has("--candidates") ? values : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let result;
  try {
    const args = readArguments(process.argv.slice(2));
    if (!args) throw new Error("invalid arguments");
    const oracle = JSON.parse(readFileSync(args.get("--oracle"), "utf8"));
    const candidates = JSON.parse(readFileSync(args.get("--candidates"), "utf8"));
    result = evaluateEvidenceReleaseGate({ oracle, candidates });
  } catch {
    result = unavailableReleaseGateResult();
  }
  console.log(JSON.stringify(result));
  if (!releaseGatePasses(result)) {
    process.exitCode = 1;
  }
}
