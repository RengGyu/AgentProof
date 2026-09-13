import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const hash = name => createHash("sha256").update(readFileSync(new URL(name, import.meta.url))).digest("hex");
const corpus = read("corpus.json"), dry = read("restored-dry-run-final.json"), live = read("live-result-20260914.json"), old = read("rescored-existing-v2.json"), after = read("after.json");
assert.equal(live.actualRequestCount, 28);
assert.equal(live.caseCount, 14);
assert.equal(live.labeledUnitCount, 44);
for (const key of ["corpusHash", "labelProvenanceHash", "modelProfileHash", "configuredModel", "selectionPolicyVersion", "evaluationPolicyVersion"]) assert.deepEqual(live[key], dry[key]);
let checkedRows = 0;
for (const c of live.cases) {
  const input = corpus.cases.find(v => v.id === c.id), baseline = dry.cases.find(v => v.id === c.id);
  for (const key of ["inputHash", "seedHash", "sources", "selection", "hashes", "inputBytes"]) assert.deepEqual(c[key], baseline[key], `${c.id}/${key}`);
  assert.deepEqual(c.arms.A, baseline.arms.A);
  for (const arm of ["A", "B", "C"]) {
    const result = c.arms[arm];
    const selection = arm === "A" ? result.roles : after.cases.find(v => v.id === c.id).selected;
    if (arm !== "A") assert.equal(result.telemetry.actualRequestCount, 1);
    for (const row of result.rows) {
      const label = input.labels.find(v => v.id === row.labelId);
      assert.equal(row.gold, label.label);
      const count = content => {
        let total = 0, selected = 0, objective = 0, ambiguous = 0;
        for (let i = label.start; i < label.end; i++) {
          if (content && /\s/.test(label.text[i - label.start])) continue;
          total++;
          const covers = s => s.sourceKind === label.sourceKind && s.start <= i && i < s.end;
          selected += Number(selection.some(covers));
          objective += Number(result.roles.some(s => covers(s) && s.role === "objective_candidate"));
          ambiguous += Number(result.roles.some(s => covers(s) && s.role === "mixed_or_ambiguous"));
        }
        const prediction = result.state !== "valid" ? result.state : content && !total ? "not_evaluable" : !selected ? "omitted" : selected < total ? "partial" : objective === total ? "requirement" : ambiguous || objective ? "ambiguous" : "non_requirement";
        return { labelCharacters: total, selectedCharacters: selected, objectiveCharacters: objective, ambiguousCharacters: ambiguous, prediction };
      };
      for (const content of [false, true]) for (const [key, value] of Object.entries(count(content))) assert.deepEqual((content ? row.contentCoverage : row)[key], value, `${c.id}/${arm}/${row.labelId}/${key}`);
      checkedRows++;
    }
  }
}
assert.equal(checkedRows, 132);
const summarize = (cases, arm, legacy) => {
  const rows = cases.flatMap(c => c.arms[arm].rows);
  const result = { exactPreserved: rows.filter(r => r.gold === "requirement" && (legacy ? r.legacyPrediction : r.prediction) === "requirement").length, contentPreserved: rows.filter(r => r.gold === "requirement" && r.contentCoverage.prediction === "requirement").length, required: 15, nonRequirementPromoted: rows.filter(r => r.gold === "non_requirement" && r.contentCoverage.objectiveCharacters > 0).length, nonRequirement: 20, ambiguousPromoted: rows.filter(r => r.gold === "ambiguous" && r.contentCoverage.objectiveCharacters > 0).length, ambiguous: 9 };
  if (!legacy) {
    const arms = cases.map(c => c.arms[arm]), times = arms.map(a => a.telemetry.latencyMs).filter(n => n !== null).sort((a,b) => a-b);
    result.states = Object.fromEntries([...new Set(arms.map(a => a.state))].map(state => [state, arms.filter(a => a.state === state).length]));
    result.httpStatuses = [...new Set(arms.map(a => a.telemetry.httpStatus))];
    result.models = [...new Set(arms.map(a => a.telemetry.model))];
    result.totalTokens = arms.reduce((n,a) => n + (a.telemetry.usage?.totalTokens ?? 0), 0);
    result.missingUsage = arms.filter(a => a.telemetry.usage?.totalTokens == null).length;
    result.medianLatencyMs = times.length ? (times[(times.length - 1) >> 1] + times[times.length >> 1]) / 2 : null;
  }
  return result;
};
const changes = [];
for (const c of live.cases) for (const arm of ["B", "C"]) for (const row of c.arms[arm].rows) {
  const previous = old.cases.find(v => v.id === c.id).arms[arm].rows.find(r => r.labelId === row.labelId);
  if (previous.contentCoverage.prediction !== row.contentCoverage.prediction || Boolean(previous.contentCoverage.objectiveCharacters) !== Boolean(row.contentCoverage.objectiveCharacters)) changes.push({ caseId: c.id, arm, labelId: row.labelId, gold: row.gold, previous: previous.contentCoverage.prediction, current: row.contentCoverage.prediction });
}
console.log(JSON.stringify({ schemaVersion: "agentproof_recovery_comparison.v1", checkedRows, calls: live.actualRequestCount, sourceInputsAndRequestsMatchDryRun: true, hashes: Object.fromEntries(["corpus.json", "restored-dry-run-final.json", "live-result-20260914.json", "rescored-existing-v2.json"].map(name => [name, hash(name)])), before: Object.fromEntries(["A","B","C"].map(a => [a,summarize(old.cases,a,true)])), after: Object.fromEntries(["A","B","C"].map(a => [a,summarize(live.cases,a,false)])), changes, limitations: ["44 provisional sparse supervisor labels; not human gold or an accuracy estimate.", "Earlier raw provider-result artifact was not recovered; its preserved 132 rescored rows support the historical comparison.", "Single sequential run per condition; candidate selection changed and model service/time may also vary.", "Source classification is not requirement fulfillment or a production release decision.", "Token usage is not a collected invoice amount."] }, null, 2));
