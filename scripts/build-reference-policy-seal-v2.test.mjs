import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";

process.env.AGENTPROOF_REFERENCE_POLICY_FIXTURES = "1";
const { boundaryCorpus, evidenceCorpus } = await import("./evidence-release-reference-policy-v2.test.mjs");

function run(args) {
  return spawnSync(process.execPath, ["scripts/build-reference-policy-seal-v2.mjs", ...args], { encoding: "utf8" });
}

describe("build reference policy seal v2 CLI", () => {
  it("writes one deterministic seal from complete input-only corpora", () => {
    const root = mkdtempSync(join(tmpdir(), "agentproof-seal-v2-"));
    try {
      const evidence = join(root, "evidence.json");
      const boundary = join(root, "boundary.json");
      const outputA = join(root, "seal-a.json");
      const outputB = join(root, "seal-b.json");
      writeFileSync(evidence, JSON.stringify(evidenceCorpus()));
      writeFileSync(boundary, JSON.stringify(boundaryCorpus()));
      assert.equal(run(["--evidence-cases", evidence, "--boundary-cases", boundary, "--output", outputA]).status, 0);
      assert.equal(run(["--evidence-cases", evidence, "--boundary-cases", boundary, "--output", outputB]).status, 0);
      assert.equal(readFileSync(outputA, "utf8"), readFileSync(outputB, "utf8"));
      assert.match(readFileSync(outputA, "utf8"), /referencePolicySha256/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("rejects existing output, V1 input, incomplete coverage, collisions, and unknown flags before writing", () => {
    const root = mkdtempSync(join(tmpdir(), "agentproof-seal-v2-"));
    try {
      const evidence = join(root, "evidence.json");
      const boundary = join(root, "boundary.json");
      const output = join(root, "seal.json");
      writeFileSync(evidence, JSON.stringify(evidenceCorpus()));
      writeFileSync(boundary, JSON.stringify(boundaryCorpus()));
      writeFileSync(output, "existing");
      for (const args of [["--evidence-cases", evidence, "--boundary-cases", boundary, "--output", output], ["--unknown", evidence, "--boundary-cases", boundary, "--output", join(root, "unknown.json")], ["--evidence-cases", evidence, "--boundary-cases", boundary, "--output", evidence]]) {
        const result = run(args);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /REFERENCE_POLICY_SEAL_INVALID/);
      }
      writeFileSync(evidence, JSON.stringify({ version: 1, cases: [] }));
      const v1Output = join(root, "v1.json");
      assert.notEqual(run(["--evidence-cases", evidence, "--boundary-cases", boundary, "--output", v1Output]).status, 0);
      assert.equal(exists(v1Output), false);
      writeFileSync(evidence, JSON.stringify(evidenceCorpus()));
      const incomplete = JSON.parse(readFileSync(evidence, "utf8"));
      incomplete.cases[2].input.verificationCriterionEvidenceV2.artifactBlobs = [{
        path: "README.md", headSha: "a".repeat(40), content: "missing"
      }];
      writeFileSync(evidence, JSON.stringify(incomplete));
      const incompleteOutput = join(root, "incomplete.json");
      assert.notEqual(run(["--evidence-cases", evidence, "--boundary-cases", boundary, "--output", incompleteOutput]).status, 0);
      assert.equal(exists(incompleteOutput), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

function exists(path) {
  try { readFileSync(path); return true; } catch { return false; }
}
