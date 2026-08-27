import assert from "node:assert/strict";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { buildReferencePolicySealV2 } from "./evidence-release-reference-policy-v2.mjs";
import * as authoring from "./reference-policy-authoring-v2.mjs";
import { protectedAuthoringFixtureValuesV2, validAuthoringFixtureV2 } from "./reference-policy-authoring-v2-test-fixtures.mjs";

const INTERNAL_DIAGNOSTIC = '{"version":2,"status":"invalid","stage":"internal","errors":[{"code":"internal_validation_failure"}],"truncated":false}\n';

function temporaryDirectory() { return mkdtempSync(join(tmpdir(), "agentproof-seal-v2-")); }
function run(args) { return spawnSync(process.execPath, ["scripts/build-reference-policy-seal-v2.mjs", ...args], { encoding: "utf8" }); }
function writeCorpus(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function sealArgs(evidence, boundary, output) { return ["--evidence-cases", evidence, "--boundary-cases", boundary, "--output", output]; }
function runDirect(args, dependencies) {
  assert.equal(typeof authoring.runReferencePolicySealCliV2, "function");
  assert.equal(typeof authoring.sealReferencePolicyFilesV2, "function");
  const stdout = { value: "", write(value) { this.value += value; } };
  const stderr = { value: "", write(value) { this.value += value; } };
  const status = authoring.runReferencePolicySealCliV2(args, { stdout, stderr, ...dependencies });
  return { status, stdout: stdout.value, stderr: stderr.value };
}

describe("build reference policy seal v2 CLI", () => {
  it("writes the exact deterministic V2 seal from public authoring files", () => {
    const root = temporaryDirectory();
    try {
      const fixture = validAuthoringFixtureV2();
      const evidence = join(root, "evidence.json");
      const boundary = join(root, "boundary.json");
      const outputA = join(root, "seal-a.json");
      const outputB = join(root, "seal-b.json");
      writeCorpus(evidence, fixture.evidenceCorpus);
      writeCorpus(boundary, fixture.boundaryCorpus);

      for (const output of [outputA, outputB]) {
        const result = run(sealArgs(evidence, boundary, output));
        assert.equal(result.status, 0);
        assert.equal(result.stdout, '{"version":2,"status":"sealed"}\n');
        assert.equal(result.stderr, "");
        assert.equal(statSync(output).mode & 0o777, 0o600);
      }

      const sealA = readFileSync(outputA, "utf8");
      assert.equal(sealA, readFileSync(outputB, "utf8"));
      assert.equal(sealA, JSON.stringify(buildReferencePolicySealV2(fixture)));
      assert.match(sealA, /"referencePolicySha256":"[a-f0-9]{64}"/);
      for (const privateValue of [...protectedAuthoringFixtureValuesV2(fixture), "syntax_invalid", "coverage_missing"]) {
        assert.equal(sealA.includes(JSON.stringify(privateValue)), false, privateValue);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("returns fixed syntax diagnostics without creating an output", () => {
    const root = temporaryDirectory();
    try {
      const fixture = validAuthoringFixtureV2();
      const evidence = join(root, "evidence.json");
      const boundary = join(root, "boundary.json");
      const output = join(root, "seal.json");
      writeFileSync(evidence, '{"UNIQUE_SYNTAX_VALUE"', "utf8");
      writeCorpus(boundary, fixture.boundaryCorpus);

      const result = run(sealArgs(evidence, boundary, output));
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '{"version":2,"status":"invalid","stage":"syntax","errors":[{"document":"evidence","path":"","code":"syntax_invalid"}],"truncated":false}\n');
      assert.equal(result.stderr, "");
      assert.equal(existsSync(output), false);
      assert.equal(`${result.stdout}${result.stderr}`.includes("UNIQUE_SYNTAX_VALUE"), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("returns bounded validation diagnostics without creating an output", () => {
    const root = temporaryDirectory();
    try {
      const fixture = validAuthoringFixtureV2();
      const evidence = join(root, "evidence.json");
      const boundary = join(root, "boundary.json");
      const output = join(root, "seal.json");
      fixture.evidenceCorpus.cases[0].input.title = "UNIQUE_INVALID_VALUE";
      fixture.evidenceCorpus.cases[0].input.untrusted_secret = "UNIQUE_INVALID_VALUE";
      writeCorpus(evidence, fixture.evidenceCorpus);
      writeCorpus(boundary, fixture.boundaryCorpus);

      const result = run(sealArgs(evidence, boundary, output));
      assert.equal(result.status, 1);
      assert.notEqual(result.stdout, "");
      assert.equal(JSON.parse(result.stdout).stage, "schema");
      assert.equal(result.stderr, "");
      assert.equal(existsSync(output), false);
      assert.equal(`${result.stdout}${result.stderr}`.includes("UNIQUE_INVALID_VALUE"), false);
      assert.equal(`${result.stdout}${result.stderr}`.includes("untrusted_secret"), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("uses fixed I/O failures for unsafe usage, unreadable input, and existing output", () => {
    const root = temporaryDirectory();
    try {
      const fixture = validAuthoringFixtureV2();
      const evidence = join(root, "evidence.json");
      const boundary = join(root, "boundary.json");
      const output = join(root, "seal.json");
      writeCorpus(evidence, fixture.evidenceCorpus);
      writeCorpus(boundary, fixture.boundaryCorpus);
      writeFileSync(output, "preserve-existing", "utf8");

      const unknownOutput = join(root, "unknown.json");
      const unreadableOutput = join(root, "read.json");
      for (const args of [
        ["--unknown", evidence, "--boundary-cases", boundary, "--output", unknownOutput],
        sealArgs(join(root, "missing.json"), boundary, unreadableOutput),
        sealArgs(evidence, boundary, output),
        sealArgs(evidence, boundary, evidence)
      ]) {
        const result = run(args);
        assert.equal(result.status, 2);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "REFERENCE_POLICY_SEAL_FAILED\n");
      }
      assert.equal(readFileSync(output, "utf8"), "preserve-existing");
      assert.equal(existsSync(unknownOutput), false);
      assert.equal(existsSync(unreadableOutput), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("reads both bounded inputs before parsing either document", () => {
    const root = temporaryDirectory();
    try {
      const evidence = join(root, "evidence.json");
      const boundary = join(root, "boundary.json");
      const output = join(root, "seal.json");
      writeFileSync(evidence, '{"UNIQUE_SYNTAX_VALUE"', "utf8");
      writeFileSync(boundary, "x".repeat(4 * 1024 * 1024 + 1), "utf8");
      const result = run(sealArgs(evidence, boundary, output));
      assert.equal(result.status, 2);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "REFERENCE_POLICY_SEAL_FAILED\n");
      assert.equal(existsSync(output), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("maps thrown validators and falsey or thrown builders to fixed internal output", () => {
    const root = temporaryDirectory();
    try {
      const fixture = validAuthoringFixtureV2();
      const evidence = join(root, "evidence.json");
      const boundary = join(root, "boundary.json");
      writeCorpus(evidence, fixture.evidenceCorpus);
      writeCorpus(boundary, fixture.boundaryCorpus);

      for (const [name, dependencies] of [
        ["validator throw", { validator() { throw new Error("UNIQUE_VALIDATOR_FAILURE"); } }],
        ["validator internal", { validator() { return { status: "invalid", stage: "internal", errors: [{ code: "UNIQUE_INTERNAL_RETURN" }] }; } }],
        ["validator malformed", { validator() {} }],
        ["builder null", { builder() { return null; } }],
        ["builder throw", { builder() { throw new Error("UNIQUE_BUILDER_FAILURE"); } }]
      ]) {
        const output = join(root, `${name.replace(" ", "-")}.json`);
        const result = runDirect(sealArgs(evidence, boundary, output), dependencies);
        assert.equal(result.status, 3, name);
        assert.equal(result.stdout, INTERNAL_DIAGNOSTIC, name);
        assert.equal(result.stderr, "", name);
        assert.equal(existsSync(output), false, name);
        assert.equal(`${result.stdout}${result.stderr}`.includes("UNIQUE_"), false, name);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("removes a partial output only after the writer marks it owned", () => {
    const root = temporaryDirectory();
    try {
      const fixture = validAuthoringFixtureV2();
      const evidence = join(root, "evidence.json");
      const boundary = join(root, "boundary.json");
      const output = join(root, "seal.json");
      writeCorpus(evidence, fixture.evidenceCorpus);
      writeCorpus(boundary, fixture.boundaryCorpus);

      const result = runDirect(sealArgs(evidence, boundary, output), {
        writer(path, seal, { markCreated }) {
          const descriptor = openSync(path, "wx", 0o600);
          markCreated();
          try { writeFileSync(descriptor, JSON.stringify(seal).slice(0, 20), "utf8"); } finally { closeSync(descriptor); }
          throw new Error("UNIQUE_WRITE_FAILURE");
        }
      });
      assert.deepEqual(result, { status: 2, stdout: "", stderr: "REFERENCE_POLICY_SEAL_FAILED\n" });
      assert.equal(existsSync(output), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("preserves an unowned pre-existing output when creation fails before ownership", () => {
    const root = temporaryDirectory();
    try {
      const fixture = validAuthoringFixtureV2();
      const evidence = join(root, "evidence.json");
      const boundary = join(root, "boundary.json");
      const output = join(root, "seal.json");
      writeCorpus(evidence, fixture.evidenceCorpus);
      writeCorpus(boundary, fixture.boundaryCorpus);
      writeFileSync(output, "preserve-existing", "utf8");

      const result = runDirect(sealArgs(evidence, boundary, output), {
        writer(path, _seal, { markCreated }) {
          const descriptor = openSync(path, "wx", 0o600);
          markCreated();
          closeSync(descriptor);
        }
      });
      assert.deepEqual(result, { status: 2, stdout: "", stderr: "REFERENCE_POLICY_SEAL_FAILED\n" });
      assert.equal(readFileSync(output, "utf8"), "preserve-existing");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("keeps the I/O classification when owned-output cleanup also fails", () => {
    const root = temporaryDirectory();
    try {
      const fixture = validAuthoringFixtureV2();
      const evidence = join(root, "evidence.json");
      const boundary = join(root, "boundary.json");
      const output = join(root, "seal.json");
      writeCorpus(evidence, fixture.evidenceCorpus);
      writeCorpus(boundary, fixture.boundaryCorpus);

      const result = runDirect(sealArgs(evidence, boundary, output), {
        writer(path, _seal, { markCreated }) {
          const descriptor = openSync(path, "wx", 0o600);
          markCreated();
          closeSync(descriptor);
          throw new Error("UNIQUE_WRITE_FAILURE");
        },
        remover() { throw new Error("UNIQUE_REMOVE_FAILURE"); }
      });
      assert.deepEqual(result, { status: 2, stdout: "", stderr: "REFERENCE_POLICY_SEAL_FAILED\n" });
      assert.equal(existsSync(output), true);
      assert.equal(`${result.stdout}${result.stderr}`.includes("UNIQUE_"), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
