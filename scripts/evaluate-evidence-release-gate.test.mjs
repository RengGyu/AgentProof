import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import {
  diffEvidenceReleaseCase,
  evaluateEvidenceReleaseGate,
  releaseGatePasses
} from "./evaluate-evidence-release-gate.mjs";

describe("evaluate-evidence-release-gate", () => {
  it("derives release aggregates from structural source, requirement, receipt, and projection differences", () => {
    const oracle = {
      version: 1,
      cases: [
        oracleCase("opaque-a", [
          expectedRequirement("oracle_req_a", 0),
          expectedRequirement("oracle_req_b", 1)
        ]),
        oracleCase("opaque-b", [expectedRequirement("oracle_req_c", 0)])
      ]
    };
    const candidates = {
      version: 1,
      cases: [
        candidateCase("opaque-a", {
          sourceKind: "linked_issue",
          authority: "authoritative",
          requirements: [
            actualRequirement("oracle_req_b", 0, {
              axisStates: { implementation: "satisfied", targeted_test: "satisfied", execution: "incomplete" },
              localCiAssociation: "associated",
              outcome: "met",
              testReceiptIds: ["receipt-reused"],
              executionReceiptIds: ["execution-receipt"]
            }),
            actualRequirement("oracle_req_a", 1, {
              testReceiptIds: ["receipt-reused"]
            })
          ],
          projection: { privateReceiptLeakCount: 1 }
        }, {
          unexpectedFailure: true,
          durationMs: 10,
          github: { requests: 2, pages: 1, retries: 0 },
          providerCallCount: 0
        }),
        candidateCase("opaque-b", {
          sourceKind: "pr_description",
          authority: "author_claim",
          requirements: [actualRequirement("oracle_req_c", 0)],
          projection: { privateReceiptLeakCount: 0 }
        }, {
          unexpectedFailure: false,
          durationMs: 30,
          github: { requests: 4, pages: 3, retries: 2 },
          providerCallCount: 1
        })
      ]
    };

    const diff = diffEvidenceReleaseCase(oracle.cases[0], candidates.cases[0]);
    for (const field of [
      "sourceKind",
      "authority",
      "requirements[0].stableOracleId",
      "requirements[0].axisStates.targeted_test",
      "requirements[0].testReceiptCount",
      "requirements[0].executionReceiptCount",
      "requirements[0].localCiAssociation",
      "requirements[0].outcome",
      "projection.privateReceiptLeakCount"
    ]) {
      assert.ok(diff.fields.includes(field), `expected structural diff for ${field}`);
    }

    const result = evaluateEvidenceReleaseGate({ oracle, candidates });
    assert.deepEqual(result, {
      totalCases: 2,
      structuralMismatchCount: 1,
      falseSupportedCount: 1,
      falseRequirementLocalCiAssociationCount: 1,
      crossRequirementReceiptReuseCount: 1,
      privacyLeakCount: 1,
      unexpectedFailure: { count: 1, rate: 0.5 },
      durationMs: { p50: 20, p95: 29 },
      githubRequestCount: { p50: 3, p95: 3.9 },
      githubPageCount: { p50: 2, p95: 2.9 },
      githubRetryCount: { p50: 1, p95: 1.9 },
      providerCallCount: 1
    });
    assert.ok(!JSON.stringify(result).includes("receipt-reused"));
  });

  it("accepts bounded failure stages without fabricating privacy results or exposing case diagnostics", () => {
    const oracle = { version: 1, cases: [oracleCase("opaque-failure-stage", [expectedRequirement("oracle_req", 0)])] };
    const candidates = cleanCandidates("opaque-failure-stage");
    candidates.cases[0].actual.projection.privateReceiptLeakCount = 1;
    candidates.cases[0].metrics = {
      unexpectedFailure: true,
      durationMs: 4,
      failureStage: "report_generation"
    };

    const result = evaluateEvidenceReleaseGate({ oracle, candidates });

    assert.deepEqual(result.unexpectedFailure, { count: 1, rate: 1 });
    assert.equal(result.privacyLeakCount, "UNKNOWN");
    assert.ok(!JSON.stringify(result).includes("report_generation"));
    assert.ok(!JSON.stringify(result).includes("opaque-failure-stage"));

    candidates.cases[0].actual.projection.privateReceiptLeakCount = 99;
    assert.equal(evaluateEvidenceReleaseGate({ oracle, candidates }).privacyLeakCount, "UNKNOWN");

    const legacy = cleanCandidates("opaque-failure-stage");
    legacy.cases[0].metrics = { unexpectedFailure: false, durationMs: 4 };
    assert.deepEqual(evaluateEvidenceReleaseGate({ oracle, candidates: legacy }).unexpectedFailure, { count: 0, rate: 0 });
  });

  it("reports uncollected runtime metrics as UNKNOWN instead of fabricated zeroes", () => {
    const result = evaluateEvidenceReleaseGate({
      oracle: { version: 1, cases: [oracleCase("opaque-unmeasured", [expectedRequirement("oracle_req", 0)])] },
      candidates: {
        version: 1,
        cases: [candidateCase("opaque-unmeasured", {
          sourceKind: "pr_description",
          authority: "author_claim",
          requirements: [actualRequirement("oracle_req", 0)],
          projection: { privateReceiptLeakCount: 0 }
        })]
      }
    });

    assert.deepEqual(result.unexpectedFailure, { count: "UNKNOWN", rate: "UNKNOWN" });
    assert.deepEqual(result.durationMs, { p50: "UNKNOWN", p95: "UNKNOWN" });
    assert.deepEqual(result.githubRequestCount, { p50: "UNKNOWN", p95: "UNKNOWN" });
    assert.deepEqual(result.githubPageCount, { p50: "UNKNOWN", p95: "UNKNOWN" });
    assert.deepEqual(result.githubRetryCount, { p50: "UNKNOWN", p95: "UNKNOWN" });
    assert.equal(result.providerCallCount, "UNKNOWN");
  });

  it("makes a source and authority-only mismatch gate-visible without emitting case details", () => {
    const oracle = { version: 1, cases: [oracleCase("opaque-source", [expectedRequirement("oracle_req", 0)])] };
    const candidates = {
      version: 1,
      cases: [candidateCase("opaque-source", {
        sourceKind: "linked_issue",
        authority: "authoritative",
        requirements: [actualRequirement("oracle_req", 0)],
        projection: { privateReceiptLeakCount: 0 }
      })]
    };

    const result = evaluateEvidenceReleaseGate({ oracle, candidates });
    assert.equal(result.structuralMismatchCount, 1);
    assert.ok(!JSON.stringify(result).includes("opaque-source"));
  });

  it("fails closed when a candidate result is absent", () => {
    const result = evaluateEvidenceReleaseGate({
      oracle: { version: 1, cases: [oracleCase("opaque-missing", [expectedRequirement("oracle_req", 0)])] },
      candidates: { version: 1, cases: [] }
    });

    assert.equal(result.structuralMismatchCount, "UNKNOWN");
    assert.equal(result.crossRequirementReceiptReuseCount, "UNKNOWN");
  });

  it("exits nonzero when a source and authority mismatch makes the aggregate gate fail", () => {
    const oracle = { version: 1, cases: [oracleCase("opaque-cli-mismatch", [expectedRequirement("oracle_req", 0)])] };
    const candidates = cleanCandidates("opaque-cli-mismatch", {
      sourceKind: "linked_issue",
      authority: "authoritative"
    });

    const result = runCli(oracle, candidates);
    assert.equal(result.status, 1);
    assert.equal(result.output.structuralMismatchCount, 1);
    assert.ok(!result.stdout.includes("opaque-cli-mismatch"));
  });

  it("fails closed with aggregate UNKNOWN values when the oracle corpus is malformed", () => {
    const result = runCli({ version: 1 }, cleanCandidates("opaque-cli-invalid"));

    assert.equal(result.status, 1);
    assert.equal(result.output.totalCases, "UNKNOWN");
    assert.equal(result.output.structuralMismatchCount, "UNKNOWN");
    assert.equal(result.output.falseSupportedCount, "UNKNOWN");
  });

  it("fails closed when an oracle case omits its required expected structure", () => {
    const result = runCli(
      { version: 1, cases: [{ version: 1, caseId: "opaque-sparse-oracle", expected: {} }] },
      cleanCandidates("opaque-sparse-oracle")
    );

    assert.equal(result.status, 1);
    assert.equal(result.output.totalCases, "UNKNOWN");
    assert.equal(result.output.structuralMismatchCount, "UNKNOWN");
  });

  it("marks sparse candidate actual output unavailable instead of reducing it to zero findings", () => {
    const oracle = { version: 1, cases: [oracleCase("opaque-sparse-candidate", [expectedRequirement("oracle_req", 0)])] };
    const candidates = cleanCandidates("opaque-sparse-candidate", {
      requirements: [{}]
    });

    const result = runCli(oracle, candidates);
    assert.equal(result.status, 1);
    assert.equal(result.output.falseSupportedCount, "UNKNOWN");
    assert.equal(result.output.crossRequirementReceiptReuseCount, "UNKNOWN");
  });

  it("rejects an undeclared projection field even when privateReceiptLeakCount is zero", () => {
    const result = evaluateEvidenceReleaseGate({
      oracle: { version: 1, cases: [oracleCase("opaque-projection", [expectedRequirement("oracle_req", 0)])] },
      candidates: cleanCandidates("opaque-projection", { projection: { privateReceiptLeakCount: 0, content: "hidden" } })
    });

    assert.equal(result.privacyLeakCount, "UNKNOWN");
    assert.equal(releaseGatePasses(result), false);
  });

  it("rejects duplicate candidate case IDs instead of using the last value", () => {
    const result = evaluateEvidenceReleaseGate({
      oracle: { version: 1, cases: [oracleCase("opaque-duplicate", [expectedRequirement("oracle_req", 0)])] },
      candidates: { version: 1, cases: [...cleanCandidates("opaque-duplicate").cases, ...cleanCandidates("opaque-duplicate").cases] }
    });

    assert.equal(result.structuralMismatchCount, "UNKNOWN");
  });

  it("rejects a candidate corpus with an extra case", () => {
    const result = evaluateEvidenceReleaseGate({
      oracle: { version: 1, cases: [oracleCase("opaque-expected", [expectedRequirement("oracle_req", 0)])] },
      candidates: { version: 1, cases: [...cleanCandidates("opaque-expected").cases, ...cleanCandidates("opaque-extra").cases] }
    });

    assert.equal(result.totalCases, "UNKNOWN");
  });

  it("rejects unknown keys in an oracle requirement and candidate receipt", () => {
    const oracle = { version: 1, cases: [oracleCase("opaque-keys", [expectedRequirement("oracle_req", 0)])] };
    oracle.cases[0].expected.requirements[0].unexpected = true;
    assert.equal(releaseGatePasses(evaluateEvidenceReleaseGate({ oracle, candidates: cleanCandidates("opaque-keys") })), false);

    const candidates = cleanCandidates("opaque-keys");
    candidates.cases[0].actual.requirements[0].testReceipts = [{ id: "test:1", unknown: true }];
    delete candidates.cases[0].actual.requirements[0].testReceiptIds;
    assert.equal(releaseGatePasses(evaluateEvidenceReleaseGate({
      oracle: { version: 1, cases: [oracleCase("opaque-keys", [expectedRequirement("oracle_req", 0)])] },
      candidates
    })), false);
  });

  it("rejects duplicate opaque receipt IDs within one declaration", () => {
    const requirement = expectedRequirement("oracle_req", 0);
    requirement.testReceiptCount = 2;
    const result = evaluateEvidenceReleaseGate({
      oracle: { version: 1, cases: [oracleCase("opaque-duplicate-id-receipt", [requirement])] },
      candidates: cleanCandidates("opaque-duplicate-id-receipt", {
        requirements: [actualRequirement("oracle_req", 0, { testReceiptIds: ["same-receipt", "same-receipt"] })]
      })
    });

    assert.equal(result.crossRequirementReceiptReuseCount, "UNKNOWN");
    assert.equal(releaseGatePasses(result), false);
  });

  it("accepts candidate receipt evidence only as exact opaque ID arrays", () => {
    const oracle = { version: 1, cases: [oracleCase("opaque-exact-receipts", [expectedRequirement("oracle_req", 0)])] };

    for (const receiptOverride of [
      { testReceiptCount: 0 },
      { testReceipts: [] },
      { executionReceiptCount: 0 },
      { executionReceipts: [] }
    ]) {
      const candidates = cleanCandidates("opaque-exact-receipts", {
        requirements: [actualRequirement("oracle_req", 0, receiptOverride)]
      });
      const result = evaluateEvidenceReleaseGate({ oracle, candidates });

      assert.equal(result.structuralMismatchCount, "UNKNOWN");
      assert.equal(result.crossRequirementReceiptReuseCount, "UNKNOWN");
      assert.equal(releaseGatePasses(result), false);
    }
  });

  it("rejects duplicate receipt-object IDs within one declaration", () => {
    const requirement = expectedRequirement("oracle_req", 0);
    requirement.testReceiptCount = 2;
    const result = evaluateEvidenceReleaseGate({
      oracle: { version: 1, cases: [oracleCase("opaque-duplicate-object-receipt", [requirement])] },
      candidates: cleanCandidates("opaque-duplicate-object-receipt", {
        requirements: [actualRequirement("oracle_req", 0, {
          testReceipts: [{ id: "same-receipt" }, { id: "same-receipt" }]
        })]
      })
    });

    assert.equal(result.crossRequirementReceiptReuseCount, "UNKNOWN");
    assert.equal(releaseGatePasses(result), false);
  });

  it("exits zero for a clean development-only aggregate fixture", () => {
    const result = runCli(
      { version: 1, cases: [oracleCase("opaque-cli-clean", [expectedRequirement("oracle_req", 0)])] },
      cleanCandidates("opaque-cli-clean")
    );

    assert.equal(result.status, 0);
    assert.equal(result.output.structuralMismatchCount, 0);
    assert.equal(result.output.falseSupportedCount, 0);
    assert.equal(result.output.crossRequirementReceiptReuseCount, 0);
  });

  it("runs an explicit synthetic runner-to-evaluator handoff without emitting the case ID", () => {
    const inputRoot = mkdtempSync(join(tmpdir(), "agentproof-evidence-release-input-"));
    const outputRoot = mkdtempSync(join(tmpdir(), "agentproof-evidence-release-output-"));
    const casesPath = join(inputRoot, "cases.json");
    const candidatesPath = join(outputRoot, "candidates.json");
    const oraclePath = join(outputRoot, "oracle.json");
    const caseId = "synthetic-handoff-case";
    try {
      writeFileSync(casesPath, JSON.stringify(syntheticCandidatePayload(caseId)));
      const runner = spawnSync("pnpm", ["eval:evidence:candidates"], {
        cwd: new URL("../", import.meta.url).pathname,
        encoding: "utf8",
        env: { ...process.env, AGENTPROOF_RELEASE_EVAL_CASES: casesPath, AGENTPROOF_RELEASE_EVAL_OUTPUT: candidatesPath }
      });
      assert.equal(runner.status, 0, runner.stderr);

      writeFileSync(oraclePath, JSON.stringify(matchingSyntheticOracle(caseId)));
      const evaluator = spawnSync("pnpm", ["eval:evidence:release", "--", "--oracle", oraclePath, "--candidates", candidatesPath], {
        cwd: new URL("../", import.meta.url).pathname,
        encoding: "utf8"
      });
      assert.equal(evaluator.status, 1, evaluator.stderr);
      assert.equal(JSON.parse(evaluator.stdout.split("\n").find((line) => line.startsWith("{"))).totalCases, 1);
      assert.ok(!evaluator.stdout.includes(caseId));

      assert.notEqual(spawnSync("pnpm", ["eval:evidence:candidates"], {
        cwd: new URL("../", import.meta.url).pathname,
        encoding: "utf8",
        env: environmentWithoutReleaseEvaluationPaths({
          ...process.env,
          AGENTPROOF_RELEASE_EVAL_CASES: casesPath,
          AGENTPROOF_RELEASE_EVAL_OUTPUT: candidatesPath
        })
      }).status, 0);
      assert.notEqual(spawnSync("pnpm", ["eval:evidence:release"], {
        cwd: new URL("../", import.meta.url).pathname,
        encoding: "utf8",
        env: environmentWithoutReleaseEvaluationPaths({
          ...process.env,
          AGENTPROOF_RELEASE_EVAL_CASES: casesPath,
          AGENTPROOF_RELEASE_EVAL_OUTPUT: candidatesPath
        })
      }).status, 0);
    } finally {
      rmSync(inputRoot, { recursive: true, force: true });
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });
});

function oracleCase(caseId, requirements) {
  return {
    version: 1,
    caseId,
    expected: {
      sourceKind: "pr_description",
      authority: "author_claim",
      requirements,
      projection: { privateReceiptLeakCount: 0 }
    }
  };
}

function expectedRequirement(stableOracleId, ordinal) {
  return {
    stableOracleId,
    ordinal,
    axisStates: { implementation: "satisfied", targeted_test: "incomplete", execution: "incomplete" },
    testReceiptCount: 0,
    executionReceiptCount: 0,
    localCiAssociation: "unknown",
    outcome: "partial"
  };
}

function candidateCase(caseId, actual, metrics) {
  return { version: 1, caseId, actual, ...(metrics ? { metrics } : {}) };
}

function actualRequirement(stableOracleId, ordinal, overrides = {}) {
  return {
    stableOracleId,
    ordinal,
    axisStates: { implementation: "satisfied", targeted_test: "incomplete", execution: "incomplete" },
    ...(overrides.testReceipts === undefined && overrides.testReceiptCount === undefined ? { testReceiptIds: [] } : {}),
    ...(overrides.executionReceipts === undefined && overrides.executionReceiptCount === undefined ? { executionReceiptIds: [] } : {}),
    localCiAssociation: "unknown",
    outcome: "partial",
    ...overrides
  };
}

function cleanCandidates(caseId, actualOverrides = {}) {
  return {
    version: 1,
    cases: [candidateCase(caseId, {
      sourceKind: "pr_description",
      authority: "author_claim",
      requirements: [actualRequirement("oracle_req", 0)],
      projection: { privateReceiptLeakCount: 0 },
      ...actualOverrides
    }, {
      unexpectedFailure: false,
      durationMs: 10,
      github: { requests: 1, pages: 1, retries: 0 },
      providerCallCount: 0
    })]
  };
}

function syntheticCandidatePayload(caseId) {
  return {
    version: 1,
    cases: [{
      version: 1,
      caseId,
      requirementOrdinals: [0],
      input: {
        title: "Synthetic release handoff",
        description: "",
        taskText: "Add a health check.",
        taskSource: "issue",
        changedFiles: [{ path: "src/health.ts", status: "added", patch: "+export const health = () => 'ok';" }],
        checks: [],
        logs: []
      }
    }]
  };
}

function matchingSyntheticOracle(caseId) {
  return {
    version: 1,
    cases: [{
      version: 1,
      caseId,
      expected: {
        sourceKind: "linked_issue",
        authority: "authoritative",
        requirements: [{
          stableOracleId: `case:${caseId}:ordinal:0`,
          ordinal: 0,
          axisStates: { implementation: "satisfied", targeted_test: "incomplete", execution: "incomplete" },
          testReceiptCount: 0,
          executionReceiptCount: 0,
          localCiAssociation: "unknown",
          outcome: "unclear"
        }],
        projection: { privateReceiptLeakCount: 0 }
      }
    }]
  };
}

function environmentWithoutReleaseEvaluationPaths(environment) {
  const clean = { ...environment };
  delete clean.AGENTPROOF_RELEASE_EVAL_CASES;
  delete clean.AGENTPROOF_RELEASE_EVAL_OUTPUT;
  return clean;
}

function runCli(oracle, candidates) {
  const root = mkdtempSync(join(tmpdir(), "agentproof-evidence-release-test-"));
  const oraclePath = join(root, "oracle.json");
  const candidatesPath = join(root, "candidates.json");
  try {
    writeFileSync(oraclePath, JSON.stringify(oracle));
    writeFileSync(candidatesPath, JSON.stringify(candidates));
    const run = spawnSync(process.execPath, [
      new URL("./evaluate-evidence-release-gate.mjs", import.meta.url).pathname,
      "--oracle", oraclePath,
      "--candidates", candidatesPath
    ], { encoding: "utf8" });
    return { status: run.status, stdout: run.stdout, output: JSON.parse(run.stdout) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
