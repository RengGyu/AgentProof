import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  evaluateProductionBoundaryReleaseGate,
  productionBoundaryReleaseGatePasses
} from "./evaluate-production-boundary-release-gate.mjs";

const ZERO = {
  untrustedActiveV2AcceptanceCount: 0,
  pastedEvidenceGithubAuthorityCount: 0,
  falseBoundaryLocalPositiveCount: 0,
  boundaryPrivacyLeakCount: 0,
  boundaryStructuralMismatchCount: 0
};

describe("evaluate-production-boundary-release-gate", () => {
  it("fails closed for non-digest case handles", () => {
    const oracle = { ...oracleCase("human-readable-case"), caseId: "human-readable-case" };
    const candidate = { ...candidateCase("human-readable-case"), caseId: "human-readable-case" };
    assert.deepEqual(evaluateProductionBoundaryReleaseGate({
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

    const result = evaluateProductionBoundaryReleaseGate({ oracle: oracleCorpus(cases), candidates });
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
      assert.deepEqual(evaluateProductionBoundaryReleaseGate(input), unknownResult());
      assert.equal(productionBoundaryReleaseGatePasses(evaluateProductionBoundaryReleaseGate(input)), false);
    }
  });

  it("fails closed for duplicate, missing, or extra candidate cases", () => {
    const oracle = oracleCorpus([oracleCase("opaque-one"), oracleCase("opaque-two")]);
    for (const candidates of [
      candidateCorpus([candidateCase("opaque-one"), candidateCase("opaque-one")]),
      candidateCorpus([candidateCase("opaque-one")]),
      candidateCorpus([candidateCase("opaque-one"), candidateCase("opaque-two"), candidateCase("opaque-three")])
    ]) {
      assert.deepEqual(evaluateProductionBoundaryReleaseGate({ oracle, candidates }), unknownResult());
    }
  });

  it("emits aggregate-only JSON and exits zero for a clean exact fixture", () => {
    const caseId = opaqueCaseId("cli clean secret id");
    const result = runCli(
      oracleCorpus([oracleCase(caseId, "pasted_merge")]),
      candidateCorpus([candidateCase(caseId)])
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.output, ZERO);
    assert.ok(!result.stdout.includes(caseId));
    assert.equal(result.stdout.trim().split("\n").length, 1);
  });

  it("exits non-zero without explicit paths and for unknown or non-zero metrics without printing case IDs", () => {
    const noPaths = spawnSync(process.execPath, [scriptPath()], { encoding: "utf8" });
    assert.notEqual(noPaths.status, 0);

    const caseId = opaqueCaseId("cli failure secret id");
    const nonZero = runCli(
      oracleCorpus([oracleCase(caseId, "inbound_untrusted_v2", expected({ disposition: "rejected" }))]),
      candidateCorpus([candidateCase(caseId, { disposition: "accepted" })])
    );
    assert.equal(nonZero.status, 1);
    assert.equal(nonZero.output.untrustedActiveV2AcceptanceCount, 1);
    assert.ok(!nonZero.stdout.includes(caseId));
    assert.ok(!nonZero.stderr.includes(caseId));

    const malformed = runCli({ version: 1 }, candidateCorpus([candidateCase(caseId)]));
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

function runCli(oracle, candidates) {
  const root = mkdtempSync(join(tmpdir(), "agentproof-boundary-evaluator-"));
  try {
    const oraclePath = join(root, "oracle.json");
    const candidatesPath = join(root, "candidates.json");
    writeFileSync(oraclePath, JSON.stringify(oracle));
    writeFileSync(candidatesPath, JSON.stringify(candidates));
    const child = spawnSync(process.execPath, [scriptPath(), "--oracle", oraclePath, "--candidates", candidatesPath], {
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
