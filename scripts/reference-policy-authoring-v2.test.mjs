import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createReferencePolicyDraftValuesV2, validateReferencePolicyAuthoringV2, validateReferencePolicySchemaV2 } from "./reference-policy-authoring-v2.mjs";
import { validAuthoringFixtureV2 } from "./reference-policy-authoring-v2-test-fixtures.mjs";

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
