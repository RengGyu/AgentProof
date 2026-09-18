import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = message => { throw new Error(message); };
const fraction = (numerator, denominator) => ({ numerator, denominator, rate: denominator ? numerator / denominator : null });
const predictions = new Set(["requirement", "non_requirement", "ambiguous", "omitted", "partial", "not_evaluable", "invalid", "unavailable", "not_run"]);
const selectionStates = new Set(["full", "partial", "not_selected", "empty"]);
export const jsonHash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function validateReviewedCorpus(corpus) {
  if (!record(corpus) || corpus.schemaVersion !== "requirement_source_ablation.v1" || !Array.isArray(corpus.cases) || corpus.cases.length !== 60) fail("invalid reviewed corpus");
  const caseIds = new Set();
  let labelCount = 0;
  for (const item of corpus.cases) {
    if (!record(item) || typeof item.id !== "string" || caseIds.has(item.id) || !record(item.input) || !Array.isArray(item.labels)) fail("invalid or duplicate reviewed case");
    caseIds.add(item.id);
    const labelIds = new Set();
    for (const label of item.labels) {
      labelCount++;
      if (!record(label) || typeof label.id !== "string" || labelIds.has(label.id) || typeof label.sourceKind !== "string" || typeof label.label !== "string") fail(`invalid or duplicate reviewed label: ${item.id}`);
      labelIds.add(label.id);
    }
  }
  if (labelCount !== 511) fail(`invalid reviewed label count: ${labelCount}`);
  return labelCount;
}

function validateRows(resultCase, sourceCase, mode, armName) {
  const arm = resultCase.arms?.[armName];
  if (!record(arm) || !["valid", "invalid", "unavailable", "not_run"].includes(arm.state) || !record(arm.telemetry) || !Array.isArray(arm.rows)) fail(`invalid ${mode} ${armName} arm: ${sourceCase.id}`);
  const expected = new Map(sourceCase.labels.map(label => [label.id, label]));
  const seen = new Set();
  for (const row of arm.rows) {
    if (!record(row) || typeof row.labelId !== "string" || seen.has(row.labelId) || !expected.has(row.labelId) || !record(row.contentCoverage)) fail(`invalid or duplicate result row: ${sourceCase.id}/${armName}`);
    seen.add(row.labelId);
    const label = expected.get(row.labelId);
    if (row.sourceKind !== label.sourceKind || row.gold !== label.label || !predictions.has(row.contentCoverage.prediction) || !selectionStates.has(row.contentCoverage.selectionState) || !Number.isSafeInteger(row.contentCoverage.objectiveCharacters) || row.contentCoverage.objectiveCharacters < 0) fail(`result row binding mismatch: ${sourceCase.id}/${row.labelId}/${armName}`);
  }
  if (seen.size !== expected.size) fail(`missing result rows: ${sourceCase.id}/${armName}`);
  const telemetry = arm.telemetry;
  if (!Number.isSafeInteger(telemetry.actualRequestCount) || telemetry.actualRequestCount < 0 || telemetry.actualRequestCount > 1) fail(`invalid request count: ${sourceCase.id}/${armName}`);
  if (mode === "dry" && telemetry.actualRequestCount !== 0) fail(`dry run made a request: ${sourceCase.id}/${armName}`);
  if (telemetry.latencyMs !== null && (!Number.isFinite(telemetry.latencyMs) || telemetry.latencyMs < 0) || telemetry.model !== null && typeof telemetry.model !== "string" || telemetry.usage !== null && !record(telemetry.usage)) fail(`invalid telemetry: ${sourceCase.id}/${armName}`);
  for (const key of ["inputTokens", "outputTokens", "totalTokens"]) {
    const value = telemetry.usage?.[key];
    if (value !== undefined && value !== null && (!Number.isSafeInteger(value) || value < 0)) fail(`invalid token telemetry: ${sourceCase.id}/${armName}`);
  }
  return arm;
}

function deterministicRequest(caseResult) {
  return {
    inputHash: caseResult.inputHash,
    seedHash: caseResult.seedHash,
    sources: caseResult.sources,
    selection: caseResult.selection,
    hashes: caseResult.hashes,
    inputBytes: caseResult.inputBytes,
  };
}

function validateRun(result, expectedCorpus, mode, batchNumber) {
  if (!record(result) || result.schemaVersion !== "requirement_source_ablation_result.v1" || !Array.isArray(result.cases)) fail(`invalid ${mode}-${batchNumber} result`);
  if (result.liveRequested !== (mode === "live")) fail(`run mode mismatch: ${mode}-${batchNumber}`);
  if (result.corpusHash !== jsonHash(expectedCorpus)) fail(`corpus hash mismatch: ${mode}-${batchNumber}`);
  if (result.caseCount !== expectedCorpus.cases.length || result.labeledUnitCount !== expectedCorpus.cases.reduce((sum, item) => sum + item.labels.length, 0)) fail(`result count mismatch: ${mode}-${batchNumber}`);
  if (typeof result.configuredModel !== "string" || !result.configuredModel || typeof result.modelProfileHash !== "string" || !result.modelProfileHash) fail(`model metadata missing: ${mode}-${batchNumber}`);
  const expectedIds = expectedCorpus.cases.map(item => item.id);
  const actualIds = result.cases.map(item => item?.id);
  const uniqueIds = new Set(actualIds);
  if (uniqueIds.size !== actualIds.length) fail(`duplicate result case: ${mode}-${batchNumber}`);
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) fail(`missing or unexpected result case: ${mode}-${batchNumber}`);
  let requests = 0;
  const arms = { B: [], C: [] };
  for (let index = 0; index < result.cases.length; index++) {
    const item = result.cases[index];
    const source = expectedCorpus.cases[index];
    if (!record(item) || item.inputHash !== jsonHash(source.input) || !record(item.arms)) fail(`input hash mismatch: ${source.id}`);
    for (const armName of ["B", "C"]) {
      const arm = validateRows(item, source, mode, armName);
      arms[armName].push({ caseId: source.id, arm });
      requests += arm.telemetry.actualRequestCount;
    }
  }
  if (!Number.isSafeInteger(result.actualRequestCount) || result.actualRequestCount !== requests) fail(`request telemetry mismatch: ${mode}-${batchNumber}`);
  if (mode === "dry" && result.actualRequestCount !== 0) fail(`dry result request count is not zero: dry-${batchNumber}`);
  return { result, arms };
}

function metrics(rows) {
  const required = rows.filter(row => row.gold === "requirement");
  const nonRequired = rows.filter(row => row.gold === "non_requirement");
  const ambiguous = rows.filter(row => row.gold === "ambiguous");
  return {
    labels: rows.length,
    requirementPreserved: fraction(required.filter(row => row.contentCoverage.prediction === "requirement").length, required.length),
    nonRequirementPromoted: fraction(nonRequired.filter(row => row.contentCoverage.objectiveCharacters > 0).length, nonRequired.length),
    ambiguousPromoted: fraction(ambiguous.filter(row => row.contentCoverage.objectiveCharacters > 0).length, ambiguous.length),
    notSelected: fraction(rows.filter(row => row.contentCoverage.selectionState === "not_selected").length, rows.length),
  };
}

function evaluation(rows) {
  const group = values => ({ all: metrics(values), selectedFull: metrics(values.filter(row => row.contentCoverage.selectionState === "full")) });
  return {
    ...group(rows),
    bySource: {
      pr_title: group(rows.filter(row => row.sourceKind === "pr_title")),
      pr_body: group(rows.filter(row => row.sourceKind === "pr_body")),
    },
  };
}

function numberSummary(values) {
  if (!values.length) return { count: 0, total: 0, mean: null, min: null, max: null };
  const total = values.reduce((sum, value) => sum + value, 0);
  return { count: values.length, total, mean: total / values.length, min: Math.min(...values), max: Math.max(...values) };
}

function telemetrySummary(caseArms) {
  const telemetry = caseArms.map(item => item.arm.telemetry);
  const token = key => telemetry.flatMap(item => Number.isSafeInteger(item.usage?.[key]) && item.usage[key] >= 0 ? [item.usage[key]] : []);
  return {
    requests: telemetry.reduce((sum, item) => sum + item.actualRequestCount, 0),
    latencyMs: numberSummary(telemetry.flatMap(item => Number.isFinite(item.latencyMs) && item.latencyMs >= 0 ? [item.latencyMs] : [])),
    tokens: {
      input: token("inputTokens").reduce((sum, value) => sum + value, 0),
      output: token("outputTokens").reduce((sum, value) => sum + value, 0),
      total: token("totalTokens").reduce((sum, value) => sum + value, 0),
      samples: token("totalTokens").length,
    },
  };
}

function armSummary(caseArms) {
  const rows = caseArms.flatMap(item => item.arm.rows);
  const validity = { valid: 0, invalid: 0, unavailable: 0, not_run: 0 };
  for (const item of caseArms) validity[item.arm.state]++;
  return { validity, evaluation: evaluation(rows), telemetry: telemetrySummary(caseArms) };
}

function compareArms(B, C) {
  const cRows = new Map(C.flatMap(item => item.arm.rows.map(row => [`${item.caseId}\0${row.labelId}`, row])));
  const summary = { rows: 0, predictionChanged: 0, selectionStateChanged: 0, objectiveCharactersChanged: 0, transitions: {} };
  for (const item of B) {
    for (const row of item.arm.rows) {
      const other = cRows.get(`${item.caseId}\0${row.labelId}`);
      if (!other) fail(`missing C row: ${item.caseId}/${row.labelId}`);
      summary.rows++;
      if (row.contentCoverage.prediction !== other.contentCoverage.prediction) summary.predictionChanged++;
      if (row.contentCoverage.selectionState !== other.contentCoverage.selectionState) summary.selectionStateChanged++;
      if (row.contentCoverage.objectiveCharacters !== other.contentCoverage.objectiveCharacters) summary.objectiveCharactersChanged++;
      const transition = `${row.contentCoverage.prediction}->${other.contentCoverage.prediction}`;
      summary.transitions[transition] = (summary.transitions[transition] ?? 0) + 1;
    }
  }
  return summary;
}

export async function summarizeFiles({ directory, reviewedCorpusPath }) {
  const reviewed = await readJson(reviewedCorpusPath);
  const labelCount = validateReviewedCorpus(reviewed);
  const batches = Array.from({ length: 4 }, (_, index) => ({ ...reviewed, cases: reviewed.cases.slice(index * 15, (index + 1) * 15) }));
  const loaded = [];
  for (let index = 0; index < 4; index++) {
    const [live, dry] = await Promise.all([readJson(join(directory, `live-${index + 1}.json`)), readJson(join(directory, `dry-${index + 1}.json`))]);
    const checkedLive = validateRun(live, batches[index], "live", index + 1);
    const checkedDry = validateRun(dry, batches[index], "dry", index + 1);
    for (let caseIndex = 0; caseIndex < live.cases.length; caseIndex++) {
      if (jsonHash(deterministicRequest(live.cases[caseIndex])) !== jsonHash(deterministicRequest(dry.cases[caseIndex]))) fail(`request hash mismatch: ${live.cases[caseIndex].id}`);
    }
    loaded.push({ live: checkedLive, dry: checkedDry });
  }
  const models = new Set(loaded.flatMap(item => [item.live.result.configuredModel, item.dry.result.configuredModel]));
  const profiles = new Set(loaded.flatMap(item => [item.live.result.modelProfileHash, item.dry.result.modelProfileHash]));
  if (models.size !== 1 || profiles.size !== 1) fail("configured model mismatch across runs");
  const observedModels = new Set(loaded.flatMap(item => ["B", "C"].flatMap(arm => item.live.arms[arm].flatMap(value => typeof value.arm.telemetry.model === "string" ? [value.arm.telemetry.model] : []))));
  if (observedModels.size > 1) fail("observed model mismatch across live requests");
  const liveB = loaded.flatMap(item => item.live.arms.B);
  const liveC = loaded.flatMap(item => item.live.arms.C);
  const actualRequests = loaded.reduce((sum, item) => sum + item.live.result.actualRequestCount, 0);
  if (actualRequests > 120) fail(`live request budget exceeded: ${actualRequests}`);
  return {
    schemaVersion: "requirement_source_ablation_bc_summary.v1",
    reviewedCorpusHash: jsonHash(reviewed),
    caseCount: reviewed.cases.length,
    labelCount,
    integrity: {
      batches: 4,
      inputAndRequestHashesMatch: true,
      configuredModel: [...models][0],
      modelProfileHash: [...profiles][0],
      observedModel: observedModels.size ? [...observedModels][0] : null,
    },
    requests: { actual: actualRequests, limit: 120, withinLimit: true },
    arms: { B: armSummary(liveB), C: armSummary(liveC) },
    BtoC: compareArms(liveB, liveC),
  };
}

async function cli() {
  const [directoryArg, reviewedArg] = process.argv.slice(2);
  const directory = resolve(directoryArg ?? here);
  const summary = await summarizeFiles({ directory, reviewedCorpusPath: resolve(reviewedArg ?? join(directory, "reviewed-corpus.json")) });
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch(error => { console.error(error.message); process.exitCode = 1; });
}
