import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  evaluateProductionBoundaryReleaseGateV1,
  evaluateProductionBoundaryReleaseGateV2,
  productionBoundaryReleaseGatePasses
} from "./evaluate-production-boundary-release-gate.mjs";
import { buildReferencePolicySealV2, deriveBoundaryReferenceV2 } from "./evidence-release-reference-policy-v2.mjs";
import { boundaryCorpus, evidenceCorpus } from "./evidence-release-reference-policy-v2.test.mjs";

const ZERO = {
  untrustedActiveV2AcceptanceCount: 0,
  pastedEvidenceGithubAuthorityCount: 0,
  falseBoundaryLocalPositiveCount: 0,
  boundaryPrivacyLeakCount: 0,
  boundaryStructuralMismatchCount: 0
};

describe("evaluate-production-boundary-release-gate", () => {
  it("derives sealed V2 boundary results in memory and returns aggregate-only metrics", () => {
    const cases = boundaryCorpus();
    const seal = buildReferencePolicySealV2({ evidenceCorpus: evidenceCorpus(), boundaryCorpus: cases });
    const reference = deriveBoundaryReferenceV2(cases, seal);
    const candidates = { version: 2, cases: reference.cases.map(({ caseId, reference: actual }) => ({ caseId, ...actual })) };
    const result = evaluateProductionBoundaryReleaseGateV2({ cases, seal, candidates });
    assert.deepEqual(result, ZERO);
    assert.ok(!JSON.stringify(result).includes(cases.cases[0].caseId));
    assert.equal(productionBoundaryReleaseGatePasses(result), true);
  });

  it("fails V2 closed for case-set or seal drift", () => {
    const cases = boundaryCorpus();
    const seal = buildReferencePolicySealV2({ evidenceCorpus: evidenceCorpus(), boundaryCorpus: cases });
    const reference = deriveBoundaryReferenceV2(cases, seal);
    const candidates = { version: 2, cases: reference.cases.map(({ caseId, reference: actual }) => ({ caseId, ...actual })) };
    assert.deepEqual(evaluateProductionBoundaryReleaseGateV2({ cases, seal, candidates: { ...candidates, cases: candidates.cases.slice(1) } }), unknownResult());
    assert.deepEqual(evaluateProductionBoundaryReleaseGateV2({ cases, seal: { ...seal, boundaryCorpusSha256: opaqueCaseId("drift") }, candidates }), unknownResult());
  });
  it("fails closed for non-digest case handles", () => {
    const oracle = { ...oracleCase("human-readable-case"), caseId: "human-readable-case" };
    const candidate = { ...candidateCase("human-readable-case"), caseId: "human-readable-case" };
    assert.deepEqual(evaluateProductionBoundaryReleaseGateV1({
      oracle: oracleCorpus([oracle]),
      candidates: candidateCorpus([candidate])
    }), unknownResult());
  });

  it("derives each declared non-zero counter without returning case details", () => {
    const cases = [
      oracleCase("opaque-inbound", "inbound_untrusted_v2", expected({ disposition: "rejected" })),
      oracleCase("opaque-pasted", "pasted_merge", expected({ provenanceOrigin: "pasted_evidence" }))
    ];
    const candidates = candidateCorpus([
      candidateCase("opaque-inbound", { disposition: "accepted", leakCount: 2 }),
      candidateCase("opaque-pasted", {
        provenanceOrigin: "github_snapshot",
        localAxisStates: { implementation: "satisfied", targeted_test: "incomplete", execution: "incomplete" },
        requirementLocalCiOwnership: "associated"
      })
    ]);

    const result = evaluateProductionBoundaryReleaseGateV1({ oracle: oracleCorpus(cases), candidates });
    assert.deepEqual(result, {
      untrustedActiveV2AcceptanceCount: 1,
      pastedEvidenceGithubAuthorityCount: 1,
      falseBoundaryLocalPositiveCount: 2,
      boundaryPrivacyLeakCount: 2,
      boundaryStructuralMismatchCount: 2
    });
    assert.deepEqual(Object.keys(result).sort(), Object.keys(ZERO).sort());
    assert.ok(cases.every((item) => !JSON.stringify(result).includes(item.caseId)));
    assert.equal(productionBoundaryReleaseGatePasses(result), false);
  });

  it("fails closed for malformed exact oracle and candidate envelopes", () => {
    const oracle = oracleCorpus([oracleCase("opaque-malformed", "pasted_merge")]);
    const candidates = candidateCorpus([candidateCase("opaque-malformed")]);
    const malformed = [
      { oracle: { ...oracle, unknown: true }, candidates },
      { oracle: oracleCorpus([{ ...oracle.cases[0], unknown: true }]), candidates },
      { oracle: oracleCorpus([{ ...oracle.cases[0], expected: { ...oracle.cases[0].expected, unknown: true } }]), candidates },
      { oracle, candidates: { ...candidates, unknown: true } },
      { oracle, candidates: candidateCorpus([{ ...candidates.cases[0], unknown: true }]) },
      { oracle, candidates: candidateCorpus([{ ...candidates.cases[0], localAxisStates: { ...candidates.cases[0].localAxisStates, unknown: "incomplete" } }]) }
    ];

    for (const input of malformed) {
      assert.deepEqual(evaluateProductionBoundaryReleaseGateV1(input), unknownResult());
      assert.equal(productionBoundaryReleaseGatePasses(evaluateProductionBoundaryReleaseGateV1(input)), false);
    }
  });

  it("fails closed for duplicate, missing, or extra candidate cases", () => {
    const oracle = oracleCorpus([oracleCase("opaque-one"), oracleCase("opaque-two")]);
    for (const candidates of [
      candidateCorpus([candidateCase("opaque-one"), candidateCase("opaque-one")]),
      candidateCorpus([candidateCase("opaque-one")]),
      candidateCorpus([candidateCase("opaque-one"), candidateCase("opaque-two"), candidateCase("opaque-three")])
    ]) {
      assert.deepEqual(evaluateProductionBoundaryReleaseGateV1({ oracle, candidates }), unknownResult());
    }
  });

  it("emits aggregate-only V2 JSON and exits zero for a sealed exact fixture", () => {
    const { cases, seal, candidates, caseId } = v2Fixture();
    const result = runCli(cases, seal, candidates);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.output, ZERO);
    assert.ok(!result.stdout.includes(caseId));
    assert.equal(result.stdout.trim().split("\n").length, 1);
  });

  it("rejects V1/--oracle and exits non-zero for unknown or non-zero V2 metrics without printing case IDs", () => {
    const noPaths = spawnSync(process.execPath, [scriptPath()], { encoding: "utf8" });
    assert.notEqual(noPaths.status, 0);

    const { cases, seal, candidates, caseId } = v2Fixture();
    const oracle = spawnSync(process.execPath, [scriptPath(), "--oracle", "ignored.json", "--candidates", "ignored.json"], { encoding: "utf8" });
    assert.equal(oracle.status, 1);
    assert.deepEqual(JSON.parse(oracle.stdout.trim()), unknownResult());

    const nonZeroCandidates = structuredClone(candidates);
    const rejectedIndex = cases.cases.findIndex((item) => item.kind === "inbound_untrusted_v2");
    nonZeroCandidates.cases[rejectedIndex].disposition = "accepted";
    const nonZero = runCli(cases, seal, nonZeroCandidates);
    assert.equal(nonZero.status, 1);
    assert.equal(nonZero.output.untrustedActiveV2AcceptanceCount, 1);
    assert.ok(!nonZero.stdout.includes(caseId));
    assert.ok(!nonZero.stderr.includes(caseId));

    const malformed = runCli({ version: 1 }, seal, candidates);
    assert.equal(malformed.status, 1);
    assert.deepEqual(malformed.output, unknownResult());
    assert.ok(!malformed.stdout.includes(caseId));
    assert.ok(!malformed.stderr.includes(caseId));
  });
});

function oracleCorpus(cases) {
  return { version: 1, cases };
}

function oracleCase(caseId, kind = "pasted_merge", expectedValue = expected()) {
  return { version: 1, caseId: opaqueCaseId(caseId), kind, expected: expectedValue };
}

function candidateCorpus(cases) {
  return { version: 1, cases };
}

function expected(overrides = {}) {
  return {
    disposition: "accepted",
    provenanceOrigin: "pasted_evidence",
    localAxisStates: { implementation: "incomplete", targeted_test: "incomplete", execution: "incomplete" },
    requirementLocalCiOwnership: "unknown",
    leakCount: 0,
    ...overrides
  };
}

function candidateCase(caseId, overrides = {}) {
  return { caseId: opaqueCaseId(caseId), ...expected(), ...overrides };
}

function unknownResult() {
  return Object.fromEntries(Object.keys(ZERO).map((key) => [key, "UNKNOWN"]));
}

function v2Fixture() {
  const cases = boundaryCorpus();
  const seal = buildReferencePolicySealV2({ evidenceCorpus: evidenceCorpus(), boundaryCorpus: cases });
  const reference = deriveBoundaryReferenceV2(cases, seal);
  return {
    cases,
    seal,
    caseId: cases.cases[0].caseId,
    candidates: { version: 2, cases: reference.cases.map(({ caseId, reference: actual }) => ({ caseId, ...actual })) }
  };
}

function runCli(cases, seal, candidates) {
  const root = mkdtempSync(join(tmpdir(), "agentproof-boundary-evaluator-"));
  try {
    const casesPath = join(root, "cases.json");
    const sealPath = join(root, "seal.json");
    const candidatesPath = join(root, "candidates.json");
    writeFileSync(casesPath, JSON.stringify(cases));
    writeFileSync(sealPath, JSON.stringify(seal));
    writeFileSync(candidatesPath, JSON.stringify(candidates));
    const child = spawnSync(process.execPath, [scriptPath(), "--cases", casesPath, "--seal", sealPath, "--candidates", candidatesPath], {
      encoding: "utf8"
    });
    return {
      status: child.status,
      stdout: child.stdout,
      stderr: child.stderr,
      output: JSON.parse(child.stdout.trim())
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function scriptPath() {
  return new URL("./evaluate-production-boundary-release-gate.mjs", import.meta.url).pathname;
}

function opaqueCaseId(label) {
  return createHash("sha256").update(label).digest("hex");
}
