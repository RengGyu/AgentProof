import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createReferencePolicyDraftValuesV2, runReferencePolicyAuthoringCliV2, validateReferencePolicyAuthoringV2, validateReferencePolicyFilesV2, validateReferencePolicySchemaV2 } from "./reference-policy-authoring-v2.mjs";
import { validAuthoringFixtureV2 } from "./reference-policy-authoring-v2-test-fixtures.mjs";

const cli = fileURLToPath(new URL("./reference-policy-authoring-v2-cli.mjs", import.meta.url));

function temporaryDirectory() { return mkdtempSync(join(tmpdir(), "agentproof-authoring-v2-")); }
function runCli(command, args) { return spawnSync(process.execPath, [cli, command, ...args], { encoding: "utf8" }); }
function runCliWithFileSizeLimit(command, args) { return spawnSync("/bin/sh", ["-c", "ulimit -f 0; exec \"$@\"", "sh", process.execPath, cli, command, ...args], { encoding: "utf8" }); }
function writeCorpus(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function cliArgs(evidence, boundary) { return ["--evidence-cases", evidence, "--boundary-cases", boundary]; }

describe("public reference-policy authoring schema", () => {
  it("accepts only the closed 12/8 public subset", () => {
    const fixture = validAuthoringFixtureV2();
    assert.deepEqual(validateReferencePolicySchemaV2(fixture), { valid: true, errors: [] });
    for (const mutation of [
      (value) => { value.evidenceCorpus.extra = true; },
      (value) => { value.evidenceCorpus.cases[0].input.checks = [{ name: "CI" }]; },
      (value) => { value.evidenceCorpus.cases[0].input.logs = [{ text: "log" }]; },
      (value) => { value.evidenceCorpus.cases[0].input.executionSuites = []; },
      (value) => { value.evidenceCorpus.cases[0].input.changedFiles[0] = { path: "src/a.ts", patch: "raw" }; }
    ]) {
      const changed = structuredClone(fixture);
      mutation(changed);
      assert.equal(validateReferencePolicySchemaV2(changed).valid, false);
    }
  });

  it("uses all public pasted-override fields across synthetic boundary coverage", () => {
    const overrides = validAuthoringFixtureV2().boundaryCorpus.cases.slice(2).map((item) => item.pastedOverride);
    for (const key of ["prUrl", "taskText", "prDescription", "changedFiles", "checks", "logs", "inputLimitations"]) assert.ok(overrides.some((value) => Object.hasOwn(value, key)), key);
    assert.deepEqual(overrides[0], {});
  });

  it("returns bounded value-free structural diagnostics", () => {
    const mutations = [
      ["missing required", "required_field", (v) => { delete v.evidenceCorpus.cases[0].input.title; }],
      ["unknown field", "unknown_field", (v) => { v.evidenceCorpus.cases[0].input.untrusted_secret = "sentinel-unknown"; }],
      ["wrong constant", "wrong_constant", (v) => { v.evidenceCorpus.version = 9; }],
      ["wrong primitive", "wrong_type", (v) => { v.evidenceCorpus.cases[0].input.title = 1; }],
      ["wrong count", "out_of_bounds", (v) => { v.evidenceCorpus.cases.pop(); }],
      ["too many cases", "out_of_bounds", (v) => { v.evidenceCorpus.cases.push(structuredClone(v.evidenceCorpus.cases[0])); }],
      ["criteria bound", "out_of_bounds", (v) => { v.evidenceCorpus.cases[0].input.verificationContractSourceV2.contract.objectives[0].criteria = Array.from({ length: 5 }, () => ({ id: "item", type: "artifact", label: "Item", paths: ["README.md"], artifact: { kind: "documentation_literal", literal: "x" } })); }],
      ["scope bound", "out_of_bounds", (v) => { v.evidenceCorpus.cases[0].input.verificationContractSourceV2.contract.objectives[1].criteria[0].scope = Array.from({ length: 9 }, () => ({ kind: "prefix", path: "src/" })); }],
      ["paths bound", "out_of_bounds", (v) => { v.evidenceCorpus.cases[0].input.verificationContractSourceV2.contract.objectives[0].criteria[0].paths = Array.from({ length: 17 }, () => "README.md"); }],
      ["blobs bound", "out_of_bounds", (v) => { v.evidenceCorpus.cases[0].input.verificationCriterionEvidenceV2.artifactBlobs = Array.from({ length: 9 }, () => ({ path: "README.md", content: "x" })); }],
      ["return cases bound", "out_of_bounds", (v) => { v.evidenceCorpus.cases[9].input.verificationContractSourceV2.contract.objectives[0].criteria[0].cases = Array.from({ length: 9 }, () => ({ id: "case", expected: 1 })); }],
      ["changed files bound", "out_of_bounds", (v) => { v.evidenceCorpus.cases[0].input.changedFiles = Array.from({ length: 121 }, () => ({ path: "a" })); }],
      ["limitations bound", "out_of_bounds", (v) => { v.boundaryCorpus.cases[2].pastedOverride.inputLimitations = Array.from({ length: 33 }, () => "a"); }],
      ["case sha", "invalid_sha", (v) => { v.evidenceCorpus.cases[0].caseId = "SENTINEL_BAD_SHA"; }],
      ["head sha", "invalid_sha", (v) => { v.evidenceCorpus.cases[0].input.sourceProvenance.headSha = "SENTINEL_BAD_SHA"; }],
      ["identifier", "invalid_identifier", (v) => { v.evidenceCorpus.cases[0].input.verificationContractSourceV2.contract.objectives[0].id = "Upper"; }],
      ["absolute path", "invalid_safe_path", (v) => { v.evidenceCorpus.cases[0].input.changedFiles[0].path = "/SENTINEL_PATH"; }],
      ["parent path", "invalid_safe_path", (v) => { v.evidenceCorpus.cases[0].input.changedFiles[0].path = "a/../SENTINEL_PATH"; }],
      ["prefix path", "invalid_safe_path", (v) => { v.evidenceCorpus.cases[6].input.verificationContractSourceV2.contract.objectives[0].criteria[0].scope[0].path = "src"; }],
      ["nul text", "wrong_constant", (v) => { v.evidenceCorpus.cases[0].input.title = "SENTINEL" + String.fromCharCode(0) + "VALUE"; }],
      ["unsafe return number", "out_of_bounds", (v) => { v.evidenceCorpus.cases[9].input.verificationContractSourceV2.contract.objectives[0].criteria[0].cases[0].expected = Number.MAX_SAFE_INTEGER + 1; }],
      ["full report", "unknown_field", (v) => { v.boundaryCorpus.cases[0].report.summary = "SENTINEL_REPORT"; }],
      ["analyze request", "unknown_field", (v) => { v.boundaryCorpus.cases[2].pastedOverride.author = "SENTINEL_AUTHOR"; }],
      ["nonempty checks", "wrong_constant", (v) => { v.evidenceCorpus.cases[0].input.checks = ["SENTINEL_CHECK"]; }],
      ["nonempty logs", "wrong_constant", (v) => { v.evidenceCorpus.cases[0].input.logs = ["SENTINEL_LOG"]; }],
      ["execution metadata", "unknown_field", (v) => { v.evidenceCorpus.cases[0].input.executionSuites = ["SENTINEL_SUITE"]; }]
    ];
    for (const [name, code, mutate] of mutations) {
      const changed = structuredClone(validAuthoringFixtureV2());
      mutate(changed);
      const result = validateReferencePolicySchemaV2(changed);
      assert.equal(result.valid, false, name);
      assert.ok(result.errors.some((error) => error.code === code), `${name}: ${JSON.stringify(result.errors)}`);
      assert.equal(JSON.stringify(result).includes("SENTINEL"), false, name);
      if (name === "unknown field") assert.equal(JSON.stringify(result).includes("untrusted_secret"), false);
    }
  });

  it("creates independent explicit non-sealable draft slots", () => {
    const draft = createReferencePolicyDraftValuesV2();
    assert.equal(draft.evidenceCorpus.cases.length, 12);
    assert.equal(draft.boundaryCorpus.cases.length, 8);
    assert.notEqual(draft.evidenceCorpus.cases[0], draft.evidenceCorpus.cases[1]);
    assert.notEqual(draft.boundaryCorpus.cases[0], draft.boundaryCorpus.cases[1]);
    const result = validateReferencePolicySchemaV2(draft);
    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 40);
    assert.ok(result.errors.every((error) => error.document === "evidence"
      ? /\/cases\/\d+\/(caseId|input)$/.test(error.pointer)
      : /\/cases\/\d+\/(caseId|kind)$/.test(error.pointer)));
  });

  it("keeps unknown-field diagnostics for a draft-like boundary case", () => {
    const draft = createReferencePolicyDraftValuesV2();
    draft.boundaryCorpus.cases[0].untrusted_boundary_field = "SENTINEL_BOUNDARY";
    const result = validateReferencePolicySchemaV2(draft);
    assert.ok(result.errors.some((error) => error.document === "boundary" && error.caseIndex === 0 && error.code === "unknown_field"));
    assert.equal(JSON.stringify(result).includes("untrusted_boundary_field"), false);
    assert.equal(JSON.stringify(result).includes("SENTINEL_BOUNDARY"), false);
  });

  it("composes schema, semantic, and coverage validation into bounded diagnostics", () => {
    const fixture = validAuthoringFixtureV2();
    assert.deepEqual(validateReferencePolicyAuthoringV2(fixture), { version: 2, status: "valid", stage: "complete", errors: [], truncated: false });

    const structural = structuredClone(fixture);
    structural.evidenceCorpus.cases[0].input.changedFiles[0].path = "/SENTINEL_PATH";
    const schemaResult = validateReferencePolicyAuthoringV2(structural);
    assert.equal(schemaResult.stage, "schema");
    assert.ok(schemaResult.errors.some((error) => error.code === "invalid_safe_path"));
    assert.ok(schemaResult.errors.every((error) => !Object.hasOwn(error, "pointer") && error.path.length <= 256));
    assert.equal(JSON.stringify(schemaResult).includes("SENTINEL"), false);

    const semantic = structuredClone(fixture);
    semantic.evidenceCorpus.cases[1].caseId = semantic.evidenceCorpus.cases[0].caseId;
    const semanticResult = validateReferencePolicyAuthoringV2(semantic);
    assert.equal(semanticResult.stage, "cross_field");
    assert.equal(semanticResult.errors[0].code, "duplicate_identity");

    const incomplete = structuredClone(fixture);
    incomplete.evidenceCorpus.cases[5].input.verificationCriterionEvidenceV2.artifactBlobs[0].content = "public";
    const coverageResult = validateReferencePolicyAuthoringV2(incomplete);
    assert.equal(coverageResult.stage, "coverage");
    assert.ok(coverageResult.errors.some((error) => error.coverageName === "documentation:violated"));
  });

  it("keeps authored return expectations in input and out of validation output", () => {
    const fixture = validAuthoringFixtureV2();
    const result = validateReferencePolicyAuthoringV2(fixture);
    assert.equal(result.status, "valid");
    assert.equal(JSON.stringify(result).includes('"expected"'), false);

    const returnCriterion = fixture.evidenceCorpus.cases.flatMap((item) => item.input.verificationContractSourceV2.kind === "provided_requirement"
      ? item.input.verificationContractSourceV2.contract.objectives.flatMap((objective) => objective.criteria)
      : []).find((criterion) => criterion.type === "return_value");
    assert.ok(Object.hasOwn(returnCriterion.cases[0], "expected"));
  });

  it("marks schema diagnostics truncated when more than 50 unique errors exist", () => {
    const fixture = validAuthoringFixtureV2();
    for (const item of fixture.evidenceCorpus.cases) {
      for (const key of ["title", "description", "taskText", "changedFiles", "checks"]) delete item.input[key];
    }
    const structural = validateReferencePolicySchemaV2(fixture);
    assert.equal(structural.errors.length, 50);
    assert.equal(structural.truncated, true);
    const result = validateReferencePolicyAuthoringV2(fixture);
    assert.equal(result.stage, "schema");
    assert.equal(result.errors.length, 50);
    assert.equal(result.truncated, true);
    assert.deepEqual(result, validateReferencePolicyAuthoringV2(fixture));
    assert.ok(result.errors.every((error) => Object.keys(error).every((key) => ["document", "caseIndex", "path", "code"].includes(key))));
  });
});

describe("reference-policy authoring CLI", () => {
  it("initializes two owner-only draft files without exposing their paths", () => {
    const directory = temporaryDirectory();
    const evidence = join(directory, "evidence.json");
    const boundary = join(directory, "boundary.json");
    try {
      const result = runCli("init", cliArgs(evidence, boundary));
      assert.equal(result.status, 0);
      assert.equal(result.stdout, '{"version":2,"status":"initialized","evidenceCaseCount":12,"boundaryCaseCount":8}\n');
      assert.equal(result.stderr, "");
      assert.equal(JSON.parse(readFileSync(evidence, "utf8")).cases.length, 12);
      assert.equal(JSON.parse(readFileSync(boundary, "utf8")).cases.length, 8);
      assert.equal(statSync(evidence).mode & 0o777, 0o600);
      assert.equal(statSync(boundary).mode & 0o777, 0o600);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("refuses unsafe init arguments without clobbering existing files", () => {
    const directory = temporaryDirectory();
    const evidence = join(directory, "evidence.json");
    const boundary = join(directory, "boundary.json");
    try {
      writeFileSync(evidence, "preserve", "utf8");
      for (const args of [
        cliArgs(evidence, boundary),
        cliArgs(boundary, boundary),
        ["--boundary-cases", boundary, "--evidence-cases", evidence],
        ["--evidence-cases", evidence, "--evidence-cases", boundary],
        [...cliArgs(evidence, boundary), "--unknown"]
      ]) {
        const result = runCli("init", args);
        assert.equal(result.status, 2);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr.includes(evidence), false);
        assert.equal(result.stderr.includes(boundary), false);
        assert.equal(readFileSync(evidence, "utf8"), "preserve");
        assert.equal(existsSync(boundary), false);
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("cleans up only its own partial init output after a target failure", () => {
    const directory = temporaryDirectory();
    const evidence = join(directory, "evidence.json");
    const boundary = join(directory, "missing-parent", "boundary.json");
    try {
      const result = runCli("init", cliArgs(evidence, boundary));
      assert.equal(result.status, 2);
      assert.equal(result.stdout, "");
      assert.equal(existsSync(evidence), false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("removes a partially written exclusively created draft", () => {
    const directory = temporaryDirectory();
    const evidence = join(directory, "evidence.json");
    const boundary = join(directory, "boundary.json");
    try {
      const result = runCliWithFileSizeLimit("init", cliArgs(evidence, boundary));
      assert.equal(result.status, 2);
      assert.equal(result.stdout, "");
      assert.equal(existsSync(evidence), false);
      assert.equal(existsSync(boundary), false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("preserves a boundary-only pre-existing target", () => {
    const directory = temporaryDirectory();
    const evidence = join(directory, "evidence.json");
    const boundary = join(directory, "boundary.json");
    try {
      writeFileSync(boundary, "preserve-boundary", "utf8");
      const result = runCli("init", cliArgs(evidence, boundary));
      assert.equal(result.status, 2);
      assert.equal(result.stdout, "");
      assert.equal(existsSync(evidence), false);
      assert.equal(readFileSync(boundary, "utf8"), "preserve-boundary");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("does not leave a first draft behind when the second target directory is unwritable", () => {
    const directory = temporaryDirectory();
    const blocked = join(directory, "blocked");
    const evidence = join(directory, "evidence.json");
    const boundary = join(blocked, "boundary.json");
    try {
      mkdirSync(blocked);
      chmodSync(blocked, 0o500);
      const result = runCli("init", cliArgs(evidence, boundary));
      assert.equal(result.status, 2);
      assert.equal(result.stdout, "");
      assert.equal(existsSync(evidence), false);
      assert.equal(existsSync(boundary), false);
    } finally {
      chmodSync(blocked, 0o700);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("returns bounded validation diagnostics without leaking authored values", () => {
    const directory = temporaryDirectory();
    const evidence = join(directory, "evidence.json");
    const boundary = join(directory, "boundary.json");
    try {
      const fixture = validAuthoringFixtureV2();
      writeCorpus(evidence, fixture.evidenceCorpus);
      writeCorpus(boundary, fixture.boundaryCorpus);
      let result = runCli("validate", cliArgs(evidence, boundary));
      assert.equal(result.status, 0);
      assert.equal(result.stdout, '{"version":2,"status":"valid","stage":"complete","errors":[],"truncated":false}\n');
      assert.equal(result.stderr, "");

      writeFileSync(evidence, '{"broken"', "utf8");
      result = runCli("validate", cliArgs(evidence, boundary));
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '{"version":2,"status":"invalid","stage":"syntax","errors":[{"document":"evidence","path":"","code":"syntax_invalid"}],"truncated":false}\n');
      assert.equal(result.stderr, "");

      writeCorpus(evidence, fixture.evidenceCorpus);
      writeFileSync(boundary, '{"broken"', "utf8");
      result = runCli("validate", cliArgs(evidence, boundary));
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '{"version":2,"status":"invalid","stage":"syntax","errors":[{"document":"boundary","path":"","code":"syntax_invalid"}],"truncated":false}\n');
      assert.equal(result.stderr, "");

      fixture.evidenceCorpus.cases[0].input.title = "UNIQUE_AUTHORING_SENTINEL";
      fixture.evidenceCorpus.untrusted_secret_key = "UNIQUE_AUTHORING_SENTINEL";
      writeCorpus(evidence, fixture.evidenceCorpus);
      writeCorpus(boundary, validAuthoringFixtureV2().boundaryCorpus);
      result = runCli("validate", cliArgs(evidence, boundary));
      assert.equal(result.status, 1);
      assert.equal(JSON.parse(result.stdout).stage, "schema");
      assert.equal(`${result.stdout}${result.stderr}`.includes("UNIQUE_AUTHORING_SENTINEL"), false);
      assert.equal(`${result.stdout}${result.stderr}`.includes("untrusted_secret_key"), false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("returns semantic and coverage diagnostics from valid JSON files", () => {
    const directory = temporaryDirectory();
    const evidence = join(directory, "evidence.json");
    const boundary = join(directory, "boundary.json");
    try {
      const semantic = validAuthoringFixtureV2();
      semantic.evidenceCorpus.cases[1].caseId = semantic.evidenceCorpus.cases[0].caseId;
      writeCorpus(evidence, semantic.evidenceCorpus);
      writeCorpus(boundary, semantic.boundaryCorpus);
      let result = runCli("validate", cliArgs(evidence, boundary));
      assert.equal(result.status, 1);
      assert.equal(JSON.parse(result.stdout).stage, "cross_field");
      assert.equal(result.stderr, "");

      const coverage = validAuthoringFixtureV2();
      coverage.evidenceCorpus.cases[5].input.verificationCriterionEvidenceV2.artifactBlobs[0].content = "public";
      writeCorpus(evidence, coverage.evidenceCorpus);
      writeCorpus(boundary, coverage.boundaryCorpus);
      result = runCli("validate", cliArgs(evidence, boundary));
      assert.equal(result.status, 1);
      assert.equal(JSON.parse(result.stdout).stage, "coverage");
      assert.equal(JSON.parse(result.stdout).errors[0].coverageName, "documentation:violated");
      assert.equal(result.stderr, "");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("uses fixed failures for invalid validation invocation and internal exceptions", () => {
    const directory = temporaryDirectory();
    const evidence = join(directory, "missing.json");
    const boundary = join(directory, "boundary.json");
    const stdout = { value: "", write(value) { this.value += value; } };
    const stderr = { value: "", write(value) { this.value += value; } };
    try {
      const result = runCli("validate", cliArgs(evidence, boundary));
      assert.equal(result.status, 2);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "REFERENCE_POLICY_VALIDATE_FAILED\n");

      writeCorpus(evidence, validAuthoringFixtureV2().evidenceCorpus);
      writeCorpus(boundary, validAuthoringFixtureV2().boundaryCorpus);
      assert.equal(runReferencePolicyAuthoringCliV2("validate", cliArgs(evidence, boundary), { stdout, stderr, validator() { throw new Error("UNIQUE_INTERNAL_MESSAGE"); } }), 3);
      assert.equal(stdout.value, '{"version":2,"status":"invalid","stage":"internal","errors":[{"code":"internal_validation_failure"}],"truncated":false}\n');
      assert.equal(stderr.value.includes("UNIQUE_INTERNAL_MESSAGE"), false);
      assert.deepEqual(validateReferencePolicyFilesV2({ evidencePath: evidence, boundaryPath: boundary }, { validator() { throw new Error("UNIQUE_INTERNAL_MESSAGE"); } }), { exitCode: 3, diagnostic: { version: 2, status: "invalid", stage: "internal", errors: [{ code: "internal_validation_failure" }], truncated: false } });

      stdout.value = "";
      assert.equal(runReferencePolicyAuthoringCliV2("validate", cliArgs(evidence, boundary), { stdout, stderr, validator() { return { status: "invalid", stage: "internal", errors: [{ code: "UNIQUE_INTERNAL_RETURN" }] }; } }), 3);
      assert.equal(stdout.value, '{"version":2,"status":"invalid","stage":"internal","errors":[{"code":"internal_validation_failure"}],"truncated":false}\n');
      assert.equal(stdout.value.includes("UNIQUE_INTERNAL_RETURN"), false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("reads both files within bounds before parsing either document", () => {
    const directory = temporaryDirectory();
    const evidence = join(directory, "evidence.json");
    const boundary = join(directory, "boundary.json");
    try {
      writeFileSync(evidence, '{"broken"', "utf8");
      writeFileSync(boundary, "x".repeat(4 * 1024 * 1024 + 1), "utf8");
      const result = runCli("validate", cliArgs(evidence, boundary));
      assert.equal(result.status, 2);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "REFERENCE_POLICY_VALIDATE_FAILED\n");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("does not leak NUL-bearing direct CLI arguments", () => {
    const stdout = { value: "", write(value) { this.value += value; } };
    const stderr = { value: "", write(value) { this.value += value; } };
    const nulPath = `UNIQUE_NUL_PATH${String.fromCharCode(0)}SECRET`;
    assert.equal(runReferencePolicyAuthoringCliV2("validate", ["--evidence-cases", nulPath, "--boundary-cases", "boundary.json"], { stdout, stderr }), 2);
    assert.equal(stdout.value, "");
    assert.equal(stderr.value, "REFERENCE_POLICY_VALIDATE_FAILED\n");
    assert.equal(`${stdout.value}${stderr.value}`.includes("UNIQUE_NUL_PATH"), false);
  });
});
