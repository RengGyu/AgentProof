import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export function buildGeneralPrObservationSealV1(input) {
  const corpus = input?.corpus;
  if (!isCorpus(corpus) || !Array.isArray(input?.schemaHashes) || input.schemaHashes.length === 0 ||
    !input.schemaHashes.every(isHash) || !isHash(input?.selectionPolicyHash) ||
    !isHash(input?.rubricHash) || !isHash(input?.toolchainHash)) {
    return { status: "invalid" };
  }
  const cohort = corpus.cases[0].cohort;
  if (!corpus.cases.every((item) => item.cohort === cohort) || !validIndependentLabels(corpus.cases)) {
    return { status: "invalid" };
  }
  const corpusHash = digest({ domain: "agentproof.general-pr.gold-corpus.v1", corpus });
  const sourceBindingDigest = digest({
    domain: "agentproof.general-pr.gold-bindings.v1",
    cases: corpus.cases.map((item) => ({
      caseId: item.caseId,
      sourceHash: item.sourceHash,
      contentHash: item.contentHash,
      headHash: item.headHash,
      inventoryHash: item.inventoryHash,
      normalizerHash: item.normalizerHash
    }))
  });
  const schemaDigest = digest({ domain: "agentproof.general-pr.label-schemas.v1", hashes: [...input.schemaHashes].sort() });
  const unsigned = {
    version: 1,
    cohort,
    caseCount: corpus.cases.length,
    corpusHash,
    sourceBindingDigest,
    schemaDigest,
    selectionPolicyHash: input.selectionPolicyHash,
    rubricHash: input.rubricHash,
    toolchainHash: input.toolchainHash
  };
  return {
    status: "sealed",
    seal: { ...unsigned, sealHash: digest({ domain: "agentproof.general-pr.gold-seal.v1", seal: unsigned }) }
  };
}

export function verifyGeneralPrObservationSealV1({ corpus, seal }) {
  if (!isCorpus(corpus) || !isGoldSeal(seal) || !validIndependentLabels(corpus.cases)) return false;
  const cohort = corpus.cases[0].cohort;
  if (!corpus.cases.every((item) => item.cohort === cohort)) return false;
  const unsigned = {
    version: 1,
    cohort,
    caseCount: corpus.cases.length,
    corpusHash: digest({ domain: "agentproof.general-pr.gold-corpus.v1", corpus }),
    sourceBindingDigest: digest({
      domain: "agentproof.general-pr.gold-bindings.v1",
      cases: corpus.cases.map((item) => ({
        caseId: item.caseId,
        sourceHash: item.sourceHash,
        contentHash: item.contentHash,
        headHash: item.headHash,
        inventoryHash: item.inventoryHash,
        normalizerHash: item.normalizerHash
      }))
    }),
    schemaDigest: seal.schemaDigest,
    selectionPolicyHash: seal.selectionPolicyHash,
    rubricHash: seal.rubricHash,
    toolchainHash: seal.toolchainHash
  };
  return sameJson(unsigned, withoutKey(seal, "sealHash")) &&
    seal.sealHash === digest({ domain: "agentproof.general-pr.gold-seal.v1", seal: unsigned });
}

function isCorpus(value) {
  return isRecord(value) && value.version === 1 && Array.isArray(value.cases) && value.cases.length > 0 && value.cases.every(isCase);
}

function isGoldSeal(value) {
  return isRecord(value) && Object.keys(value).length === 10 && value.version === 1 &&
    (value.cohort === "calibration" || value.cohort === "holdout") && Number.isSafeInteger(value.caseCount) && value.caseCount > 0 &&
    [value.corpusHash, value.sourceBindingDigest, value.schemaDigest, value.selectionPolicyHash, value.rubricHash, value.toolchainHash, value.sealHash].every(isHash);
}

function isCase(value) {
  return isRecord(value) && value.version === 1 && isHash(value.caseId) &&
    (value.cohort === "calibration" || value.cohort === "holdout") &&
    [value.repositoryFamilyHash, value.taskFamilyHash, value.timeWindowHash, value.sourceHash, value.contentHash, value.headHash, value.inventoryHash, value.normalizerHash].every(isHash) &&
    ["source_selection", "span_role", "relation", "observation"].includes(value.axis) &&
    Array.isArray(value.labels) && value.labels.length === 2 && validLabelsForAxis(value.axis, value.labels) &&
    (value.adjudication === undefined || validLabelForAxis(value.axis, value.adjudication));
}

function validIndependentLabels(cases) {
  const ids = new Set();
  const taskTimes = new Set();
  const repoCounts = new Map();
  for (const item of cases) {
    if (ids.has(item.caseId)) return false;
    ids.add(item.caseId);
    if (item.labels[0].reviewerId === item.labels[1].reviewerId) return false;
    const disagreement = labelsDisagree(item.labels[0], item.labels[1]);
    if (disagreement && (!item.adjudication || item.labels.some((label) => label.reviewerId === item.adjudication.reviewerId))) return false;
    if (!disagreement && item.adjudication) return false;
    if (disagreement && item.axis === "observation" && item.adjudication.observationKind !== item.labels[0].observationKind) return false;
    const taskTime = `${item.taskFamilyHash}:${item.timeWindowHash}`;
    if (taskTimes.has(taskTime)) return false;
    taskTimes.add(taskTime);
    const count = (repoCounts.get(item.repositoryFamilyHash) ?? 0) + 1;
    if (count > 2) return false;
    repoCounts.set(item.repositoryFamilyHash, count);
  }
  return true;
}

function validLabelsForAxis(axis, labels) { return labels.every((label) => validLabelForAxis(axis, label)); }
function validLabelForAxis(axis, value) { return axis === "observation" ? isStateLabel(value) : isBinaryLabel(value); }
function isBinaryLabel(value) {
  return isRecord(value) && value.version === 1 && isHash(value.reviewerId) && isHash(value.rubricHash) &&
    ["positive", "negative", "abstain"].includes(value.decision);
}
function isStateLabel(value) {
  if (!isRecord(value) || value.version !== 1 || !isHash(value.reviewerId) || !isHash(value.rubricHash)) return false;
  if (value.observationKind === "test_coverage") return ["covered_by_verified_relation", "verified_test_failed", "related_test_observed", "missing_targeted_test", "test_not_applicable", "relation_unresolved", "execution_unresolved", "collection_unavailable"].includes(value.state);
  if (value.observationKind === "scope_mapping") return ["mapped_by_verified_relation", "plausibly_mapped", "unmapped", "out_of_scope_by_contract", "collection_unavailable"].includes(value.state);
  return false;
}
function labelsDisagree(left, right) {
  return isBinaryLabel(left) && isBinaryLabel(right)
    ? left.decision !== right.decision
    : left.observationKind !== right.observationKind || left.state !== right.state;
}

export function runGeneralPrObservationSealCliV1(argv) {
  const paths = parseArgs(argv);
  if (!paths || existsSync(paths.output)) return 2;
  try {
    const corpus = JSON.parse(readFileSync(paths.corpus, "utf8"));
    const schemaHashes = paths.schemaHashes.split(",");
    const result = buildGeneralPrObservationSealV1({ corpus, schemaHashes, selectionPolicyHash: paths.selectionPolicyHash, rubricHash: paths.rubricHash, toolchainHash: paths.toolchainHash });
    if (result.status !== "sealed") return 1;
    writeFileSync(paths.output, `${JSON.stringify(result.seal)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    process.stdout.write('{"version":1,"status":"sealed"}\n');
    return 0;
  } catch {
    return 2;
  }
}

function parseArgs(argv) {
  if (argv.length !== 12) return null;
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!["--corpus", "--schema-hashes", "--selection-policy-hash", "--rubric-hash", "--toolchain-hash", "--output"].includes(key) || typeof value !== "string" || value.length === 0 || values.has(key)) return null;
    values.set(key, value);
  }
  return {
    corpus: values.get("--corpus"),
    schemaHashes: values.get("--schema-hashes"),
    selectionPolicyHash: values.get("--selection-policy-hash"),
    rubricHash: values.get("--rubric-hash"),
    toolchainHash: values.get("--toolchain-hash"),
    output: values.get("--output")
  };
}

function isHash(value) { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function digest(value) { return createHash("sha256").update(stableJson(value), "utf8").digest("hex"); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function sameJson(left, right) { return stableJson(left) === stableJson(right); }
function withoutKey(value, key) { return Object.fromEntries(Object.entries(value).filter(([entry]) => entry !== key)); }

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = runGeneralPrObservationSealCliV1(process.argv.slice(2));
