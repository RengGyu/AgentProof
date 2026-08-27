import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { buildReferencePolicySealV2, deriveEvidenceReferenceV2 } from "./evidence-release-reference-policy-v2.mjs";
import { evidenceCorpus, boundaryCorpus } from "./evidence-release-reference-policy-v2.test.mjs";
import { evaluateEvidenceReleaseGateV1, evaluateEvidenceReleaseGateV2, releaseGatePasses } from "./evaluate-evidence-release-gate.mjs";

function fixture() {
  const cases = evidenceCorpus();
  const seal = buildReferencePolicySealV2({ evidenceCorpus: cases, boundaryCorpus: boundaryCorpus() });
  const reference = deriveEvidenceReferenceV2(cases, seal);
  const candidates = { version: 2, cases: reference.cases.map(({ caseId, reference: value }) => ({ version: 2, caseId, actual: { contract: value.contract, objectives: value.objectives.map((objective) => ({ ...objective, criteria: objective.criteria.map(({ requirementId, ...criterion }) => criterion) })), axes: [], receipts: [], criterionLocalCi: [], projection: { privateReceiptLeakCount: 0 } }, metrics: { unexpectedFailure: false, durationMs: 1, github: { requests: 0, pages: 0, retries: 0 }, providerCallCount: 0 } })) };
  return { cases, seal, candidates };
}

describe("V2 evidence release gate", () => {
  it("derives closed reference expectations in memory", () => {
    const { cases, seal, candidates } = fixture();
    const result = evaluateEvidenceReleaseGateV2({ cases, seal, candidates });
    assert.equal(result.structuralMismatchCount, 0);
    assert.ok(releaseGatePasses(result));
  });
  it("fails closed for seal, candidate-set, semantic, ownership, CI, receipt, and privacy drift", () => {
    const base = fixture();
    assert.equal(evaluateEvidenceReleaseGateV2({ ...base, seal: { ...base.seal, evidenceCorpusSha256: "0".repeat(64) } }).totalCases, "UNKNOWN");
    for (const mutate of [
      (value) => value.cases.pop(),
      (value) => { value.cases[0].actual.contract.state = "author_claim"; },
      (value) => { value.cases[10].actual.objectives.reverse(); },
      (value) => { value.cases[0].actual.objectives[0].criteria[0].state = "unavailable"; },
      (value) => { value.cases[7].actual.objectives[0].criteria[0].state = "satisfied"; },
      (value) => { const id = value.cases[0].actual.objectives[0].criteria[0].criterionId; value.cases[0].actual.axes.push({ requirementId: "wrong", criterionId: id, role: "criterion", subject: "implementation", state: "satisfied" }); },
      (value) => { const o = value.cases[0].actual.objectives[0]; value.cases[0].actual.criterionLocalCi.push({ requirementId: o.requirementId, criterionId: o.criteria[0].criterionId, association: "associated" }); },
      (value) => { value.cases[0].actual.projection.secret = "private"; }
    ]) { const candidates = structuredClone(base.candidates); mutate(candidates); assert.equal(releaseGatePasses(evaluateEvidenceReleaseGateV2({ cases: base.cases, seal: base.seal, candidates })), false); }
    const candidates = structuredClone(base.candidates); const first = candidates.cases[0].actual.objectives[0], second = candidates.cases[1].actual.objectives[0];
    candidates.cases[0].actual.receipts.push({ id: "receipt_00000001", requirementId: first.requirementId, kind: "test" });
    candidates.cases[1].actual.receipts.push({ id: "receipt_00000001", requirementId: second.requirementId, kind: "test" });
    assert.equal(evaluateEvidenceReleaseGateV2({ cases: base.cases, seal: base.seal, candidates }).crossRequirementReceiptReuseCount, 1);
  });
  it("rejects forged deferred execution, unowned raw values, and same-owner duplicate receipts", () => {
    const base = fixture();
    const deferred = structuredClone(base.candidates);
    const objective = deferred.cases[7].actual.objectives[0];
    deferred.cases[7].actual.axes.push({ requirementId: objective.requirementId, criterionId: objective.criteria[0].criterionId, role: "criterion", subject: "execution", state: "satisfied" });
    assert.equal(releaseGatePasses(evaluateEvidenceReleaseGateV2({ cases: base.cases, seal: base.seal, candidates: deferred })), false);
    const raw = structuredClone(base.candidates);
    raw.cases[0].actual.axes.push({ requirementId: "raw path /secret", role: "observation", subject: "raw-log", state: "satisfied" });
    assert.equal(releaseGatePasses(evaluateEvidenceReleaseGateV2({ cases: base.cases, seal: base.seal, candidates: raw })), false);
    const rawReceipt = structuredClone(base.candidates);
    rawReceipt.cases[0].actual.receipts.push({ id: "raw receipt content", requirementId: rawReceipt.cases[0].actual.objectives[0].requirementId, kind: "test" });
    assert.equal(releaseGatePasses(evaluateEvidenceReleaseGateV2({ cases: base.cases, seal: base.seal, candidates: rawReceipt })), false);
    const duplicate = structuredClone(base.candidates); const owner = duplicate.cases[0].actual.objectives[0].requirementId;
    duplicate.cases[0].actual.receipts.push({ id: "receipt_00000001", requirementId: owner, kind: "test" }, { id: "receipt_00000001", requirementId: owner, kind: "test" });
    assert.equal(evaluateEvidenceReleaseGateV2({ cases: base.cases, seal: base.seal, candidates: duplicate }).crossRequirementReceiptReuseCount, 1);
  });
  it("prints aggregate UNKNOWN and rejects oracle/V1 CLI inputs", () => {
    const root = mkdtempSync(join(tmpdir(), "agentproof-release-gate-"));
    try {
      const paths = ["cases", "seal", "candidates"].map((name) => join(root, `${name}.json`));
      const binary = new URL("./evaluate-evidence-release-gate.mjs", import.meta.url).pathname;
      const oracle = spawnSync(process.execPath, [binary, "--oracle", paths[0], "--candidates", paths[2]], { encoding: "utf8" });
      assert.equal(oracle.status, 1); assert.equal(JSON.parse(oracle.stdout).totalCases, "UNKNOWN"); assert.ok(!oracle.stdout.includes(root));
      writeFileSync(paths[0], JSON.stringify({ version: 1, cases: [] }));
      const v1 = spawnSync(process.execPath, [binary, "--cases", paths[0], "--seal", paths[1], "--candidates", paths[2]], { encoding: "utf8" });
      assert.equal(v1.status, 1); assert.equal(JSON.parse(v1.stdout).totalCases, "UNKNOWN");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

function v1Fixture() {
  const expected = { sourceKind: "pr_description", authority: "author_claim", requirements: [{ stableOracleId: "req", ordinal: 0, axisStates: { implementation: "satisfied", targeted_test: "incomplete", execution: "incomplete" }, testReceiptCount: 0, executionReceiptCount: 0, localCiAssociation: "unknown", outcome: "partial" }], projection: { privateReceiptLeakCount: 0 } };
  const actual = { sourceKind: "pr_description", authority: "author_claim", requirements: [{ stableOracleId: "req", ordinal: 0, axisStates: { implementation: "satisfied", targeted_test: "incomplete", execution: "incomplete" }, testReceiptIds: [], executionReceiptIds: [], localCiAssociation: "unknown", outcome: "partial" }], projection: { privateReceiptLeakCount: 0 } };
  return { oracle: { version: 1, cases: [{ version: 1, caseId: "opaque", expected }] }, candidates: { version: 1, cases: [{ version: 1, caseId: "opaque", actual, metrics: { unexpectedFailure: false, durationMs: 1, github: { requests: 0, pages: 0, retries: 0 }, providerCallCount: 0 } }] } };
}

describe("V1 development comparator", () => {
  it("retains direct aggregate comparison and mismatch counters", () => {
    const value = v1Fixture();
    assert.ok(releaseGatePasses(evaluateEvidenceReleaseGateV1(value)));
    value.candidates.cases[0].actual.requirements[0].axisStates.targeted_test = "satisfied";
    const result = evaluateEvidenceReleaseGateV1(value);
    assert.equal(result.structuralMismatchCount, 1); assert.equal(result.falseSupportedCount, 1);
  });
  it("fails closed for malformed candidates, duplicate cases, private projection fields, and receipt reuse", () => {
    const malformed = v1Fixture(); malformed.candidates.cases = [];
    assert.equal(evaluateEvidenceReleaseGateV1(malformed).totalCases, "UNKNOWN");
    const duplicate = v1Fixture(); duplicate.candidates.cases.push(structuredClone(duplicate.candidates.cases[0]));
    assert.equal(evaluateEvidenceReleaseGateV1(duplicate).structuralMismatchCount, "UNKNOWN");
    const privacy = v1Fixture(); privacy.candidates.cases[0].actual.projection.raw = "private";
    assert.equal(evaluateEvidenceReleaseGateV1(privacy).privacyLeakCount, "UNKNOWN");
    const reuse = v1Fixture(); const second = structuredClone(reuse.candidates.cases[0]); second.caseId = "opaque2"; second.actual.requirements[0].stableOracleId = "other"; second.actual.requirements[0].testReceiptIds = ["receipt"];
    reuse.oracle.cases.push({ ...structuredClone(reuse.oracle.cases[0]), caseId: "opaque2", expected: { ...structuredClone(reuse.oracle.cases[0].expected), requirements: [{ ...structuredClone(reuse.oracle.cases[0].expected.requirements[0]), stableOracleId: "other", testReceiptCount: 1 }] } });
    reuse.candidates.cases[0].actual.requirements[0].testReceiptIds = ["receipt"]; reuse.candidates.cases.push(second);
    assert.equal(evaluateEvidenceReleaseGateV1(reuse).crossRequirementReceiptReuseCount, 1);
  });
});
