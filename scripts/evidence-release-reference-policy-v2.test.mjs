import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildReferencePolicySealV2,
  deriveBoundaryReferenceV2,
  deriveCoverageSummaryV2,
  deriveEvidenceReferenceV2,
  parseReferencePolicySealV2,
  referencePolicySha256V2
} from "./evidence-release-reference-policy-v2.mjs";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const id = (value) => createHash("sha256").update(value).digest("hex");
const caseId = (prefix, index) => id(`${prefix}:${index}`);

function documentation(literal = "Required heading", criterionId = "documentation") {
  return { id: criterionId, type: "artifact", label: "documentation literal", paths: ["README.md"], artifact: { kind: "documentation_literal", literal } };
}

function absence(path = "private/") {
  return { id: "absence", type: "absence", label: "private path unchanged", prohibitedKind: "path_change", scope: [{ kind: "prefix", path }] };
}

function deferred(kind) {
  if (kind === "test_case") return { id: "test_case", type: "artifact", label: "test", paths: ["test/example.test.ts"], artifact: { kind: "test_case", testId: "example test" } };
  if (kind === "workflow_job") return { id: "workflow_job", type: "artifact", label: "workflow", paths: [".github/workflows/ci.yml"], artifact: { kind: "workflow_job", workflowName: "CI", jobName: "test" } };
  return { id: "return_value", type: "return_value", label: "return", adapter: { id: "node_export_scalar.v1", modulePath: "src/value.js", exportName: "value", moduleFormat: "esm" }, cases: [{ id: "true", input: true, expected: true }] };
}

function contract(objectives) {
  return { version: 2, scope: "complete_objective_set", objectives };
}

function objective(idValue, criteria) {
  return { id: idValue, objective: `${idValue} objective`, criteria };
}

function source(kind, value) {
  if (kind === "provided_requirement") return { kind, contract: value };
  const body = `## AgentProof verification\n\n\`\`\`agentproof-verification\n${JSON.stringify(value)}\n\`\`\``;
  return { kind, title: "AgentProof verification contract", body };
}

function provenance({ complete = true, origin = "github_snapshot" } = {}) {
  return {
    version: 1,
    origin,
    headSha: HEAD,
    baseSha: BASE,
    changedFileInventory: { version: 1, completeness: complete ? "complete" : "incomplete", headSha: HEAD },
    evidenceCapturedAt: "2026-08-26T00:00:00.000Z",
    inputFingerprint: { version: 1, algorithm: "sha256", value: id("input"), coverage: "github_metadata" }
  };
}

function input({
  sourceKind = "provided_requirement",
  criteria = [documentation()],
  objectives = [objective("one", criteria)],
  blobs = [{ path: "README.md", headSha: HEAD, content: "# Required heading\r\n" }],
  changedFiles = [],
  sourceProvenance = provenance()
} = {}) {
  const selectedContract = contract(objectives);
  return {
    title: "PR title",
    description: "PR description",
    taskText: "task",
    changedFiles,
    checks: [],
    logs: [],
    sourceProvenance,
    verificationContractSourceV2: source(sourceKind, selectedContract),
    verificationContractBindingV2: { sourceKind, sourceIdentity: `source:${sourceKind}`, sourceContent: "selected source", headSha: HEAD, baseSha: BASE },
    verificationCriterionEvidenceV2: { artifactBlobs: blobs }
  };
}

function evidenceCorpus() {
  const cases = [
    input(),
    input({ blobs: [{ path: "README.md", headSha: HEAD, content: "missing" }] }),
    input({ blobs: [] }),
    input({ criteria: [absence()], blobs: [] }),
    input({ sourceKind: "linked_issue", criteria: [absence()], blobs: [], changedFiles: [{ path: "private/current.txt" }] }),
    input({ sourceKind: "pr_description", criteria: [absence()], blobs: [], changedFiles: [{ path: "docs/moved.txt", previousPath: "private/previous.txt", status: "renamed" }] }),
    input({ criteria: [absence()], blobs: [], sourceProvenance: provenance({ complete: false }) }),
    input({ criteria: [deferred("test_case")], blobs: [] }),
    input({ criteria: [deferred("workflow_job")], blobs: [] }),
    input({ criteria: [deferred("return_value")], blobs: [] }),
    input({ objectives: [objective("first", [documentation()]), objective("second", [absence("blocked/")])], changedFiles: [] }),
    input({ criteria: [documentation(), absence("archive/")], blobs: [{ path: "README.md", headSha: HEAD, content: "Required heading" }] })
  ];
  return { version: 2, cases: cases.map((item, index) => ({ version: 2, caseId: caseId("evidence", index), input: item })) };
}

function boundaryCorpus() {
  const live = input({ criteria: [absence()], blobs: [] });
  const inbound = (state) => ({ version: 2, kind: "inbound_untrusted_v2", report: { reportSchemaVersion: "verification-report.v2", verificationContract: { state } } });
  const pasted = (pastedOverride, liveInput = live) => ({ version: 2, kind: "pasted_merge", liveInput, pastedOverride });
  const cases = [
    inbound("authoritative"), inbound("author_claim"), pasted({ changedFiles: "src/a.ts" }), pasted({ checks: "CI passed" }),
    pasted({ logs: "test output" }), pasted({}), pasted({ taskText: "text-only override" }),
    pasted({}, input({ criteria: [absence()], blobs: [], sourceProvenance: provenance({ complete: false }) }))
  ];
  return { version: 2, cases: cases.map((item, index) => ({ ...item, caseId: caseId("boundary", index) })) };
}

function validSeal() {
  const seal = buildReferencePolicySealV2({ evidenceCorpus: evidenceCorpus(), boundaryCorpus: boundaryCorpus() });
  assert.ok(seal, "fixture corpus must satisfy the sealed coverage contract");
  return seal;
}

if (process.env.AGENTPROOF_REFERENCE_POLICY_FIXTURES !== "1") describe("closed reference policy v2", () => {
  it("rejects V1, authored expected tuples, ordinal selectors, unknown keys, and seal drift", () => {
    const cases = evidenceCorpus();
    const seal = validSeal();
    assert.equal(deriveEvidenceReferenceV2({ version: 1, cases: [] }, seal), null);
    for (const field of ["expected", "requirementOrdinals", "unknown"]) {
      const invalid = structuredClone(cases);
      invalid.cases[0][field] = field === "unknown" ? true : {};
      assert.equal(deriveEvidenceReferenceV2(invalid, seal), null);
    }
    assert.equal(deriveEvidenceReferenceV2(cases, { ...seal, evidenceCorpusSha256: id("drift") }), null);
    assert.equal(parseReferencePolicySealV2({ ...seal, capabilities: [...seal.capabilities].reverse() }), null);
    const injectedCoverage = {
      ...seal,
      coverageSummary: { ...seal.coverageSummary, entries: [...seal.coverageSummary.entries, { name: "README.md", count: 1 }] }
    };
    injectedCoverage.coverageSummarySha256 = createHash("sha256").update(canonicalJson(injectedCoverage.coverageSummary)).digest("hex");
    assert.equal(parseReferencePolicySealV2(injectedCoverage), null);
    assert.equal(referencePolicySha256V2(), seal.referencePolicySha256);
    assert.equal(referencePolicySha256V2(), createHash("sha256").update(readFileSync(new URL("./evidence-release-reference-policy-v2.mjs", import.meta.url))).digest("hex"));
  });

  it("derives the complete static documentation, absence, source, deferred, and outcome rule table", () => {
    const result = deriveEvidenceReferenceV2(evidenceCorpus(), validSeal());
    assert.ok(result);
    const criteria = result.cases.map((item) => item.reference.objectives.flatMap((objectiveValue) => objectiveValue.criteria));
    assert.deepEqual(criteria.slice(0, 7).map((item) => item[0].state), ["satisfied", "violated", "unavailable", "satisfied", "violated", "violated", "unavailable"]);
    assert.deepEqual(criteria.slice(7, 10).map((item) => item[0].state), ["unavailable", "unavailable", "unavailable"]);
    assert.deepEqual(criteria.slice(7, 10).map((item) => item[0].requiredEvidence), [["targeted_test", "execution"], ["ci_configuration", "execution"], ["implementation", "targeted_test", "execution"]]);
    assert.deepEqual(result.cases[10].reference.objectives.map((item) => item.requirementId), ["vc_o1", "vc_o2"]);
    assert.deepEqual(result.cases.slice(0, 7).map((item) => item.reference.contract), [
      { sourceKind: "provided_requirement", state: "authoritative" }, { sourceKind: "provided_requirement", state: "authoritative" },
      { sourceKind: "provided_requirement", state: "authoritative" }, { sourceKind: "provided_requirement", state: "authoritative" },
      { sourceKind: "linked_issue", state: "authoritative" }, { sourceKind: "pr_description", state: "author_claim" },
      { sourceKind: "provided_requirement", state: "authoritative" }
    ]);
    assert.equal(result.cases[0].reference.objectives[0].outcome, "met");
    assert.equal(result.cases[1].reference.objectives[0].outcome, "missing");
    assert.equal(result.cases[5].reference.objectives[0].outcome, "missing");
    assert.equal(JSON.stringify(result), JSON.stringify(deriveEvidenceReferenceV2(evidenceCorpus(), validSeal())));
    assert.ok(!JSON.stringify(result).includes("absenceMatch"));
  });

  it("seals only the named complete coverage and derives a stable named summary", () => {
    const evidence = evidenceCorpus();
    const boundary = boundaryCorpus();
    const seal = buildReferencePolicySealV2({ evidenceCorpus: evidence, boundaryCorpus: boundary });
    assert.ok(seal);
    const summary = deriveCoverageSummaryV2(evidence, boundary);
    assert.ok(summary);
    for (const name of [
      "documentation:satisfied", "documentation:violated", "documentation:unavailable", "absence:satisfied", "absence:current_path_violated", "absence:previous_path_violated", "absence:unavailable",
      "source:provided_authoritative", "source:linked_authoritative", "source:pr_author_claim", "deferred:test_case", "deferred:workflow_job", "deferred:return_value", "contract:multi_objective",
      "boundary:inbound_authoritative_rejected", "boundary:inbound_author_claim_rejected", "boundary:pasted_changed_files", "boundary:pasted_checks", "boundary:pasted_logs", "boundary:empty_override_live", "boundary:text_only_override_live", "boundary:incomplete_live_conservative", "boundary:privacy_zero"
    ]) assert.ok(summary.entries.some((entry) => entry.name === name), name);
    const incomplete = structuredClone(evidence);
    incomplete.cases[2].input.verificationCriterionEvidenceV2.artifactBlobs = [{ path: "README.md", headSha: HEAD, content: "missing" }];
    assert.equal(buildReferencePolicySealV2({ evidenceCorpus: incomplete, boundaryCorpus: boundary }), null);
  });

  it("accepts the maximum valid coverage count without widening sealed coverage names", () => {
    const evidence = evidenceCorpus();
    const objectives = Array.from({ length: 6 }, (_, objectiveIndex) => objective(`many_${objectiveIndex}`, Array.from(
      { length: 4 }, (_, criterionIndex) => documentation("Required heading", `doc_${objectiveIndex}_${criterionIndex}`)
    )));
    evidence.cases[0].input.verificationContractSourceV2.contract = contract(objectives);
    const seal = buildReferencePolicySealV2({ evidenceCorpus: evidence, boundaryCorpus: boundaryCorpus() });
    assert.ok(seal);
    assert.ok(seal.coverageSummary.entries.find((entry) => entry.name === "documentation:satisfied").count > 24);
    assert.ok(parseReferencePolicySealV2(seal));
  });

  it("fails closed for ambiguous rename inventory, mixed provenance, and coverage-seal drift", () => {
    const renamed = evidenceCorpus();
    renamed.cases[3].input.changedFiles = [{ path: "docs/safe.md", previousPath: "private/previous.md" }];
    const renameSeal = buildReferencePolicySealV2({ evidenceCorpus: renamed, boundaryCorpus: boundaryCorpus() });
    assert.ok(renameSeal);
    assert.equal(deriveEvidenceReferenceV2(renamed, renameSeal).cases[3].reference.objectives[0].criteria[0].state, "unavailable");

    const mixed = evidenceCorpus();
    mixed.cases[3].input.sourceProvenance.inputFingerprint.coverage = "pasted_metadata";
    const mixedSeal = buildReferencePolicySealV2({ evidenceCorpus: mixed, boundaryCorpus: boundaryCorpus() });
    assert.ok(mixedSeal);
    assert.equal(deriveEvidenceReferenceV2(mixed, mixedSeal).cases[3].reference.objectives[0].criteria[0].state, "unavailable");

    const seal = validSeal();
    const drift = { ...seal, coverageSummarySha256: id("coverage drift") };
    assert.equal(deriveEvidenceReferenceV2(evidenceCorpus(), drift), null);
    assert.equal(deriveBoundaryReferenceV2(boundaryCorpus(), drift), null);
  });

  it("derives boundary-only rejection and conservative pasted/live states without raw source output", () => {
    const result = deriveBoundaryReferenceV2(boundaryCorpus(), validSeal());
    assert.ok(result);
    assert.equal(result.cases[0].reference.disposition, "rejected");
    assert.equal(result.cases[1].reference.disposition, "rejected");
    for (const index of [2, 3, 4]) assert.deepEqual(result.cases[index].reference, { disposition: "accepted", provenanceOrigin: "pasted_evidence", localAxisStates: { implementation: "incomplete", targeted_test: "incomplete", execution: "incomplete" }, requirementLocalCiOwnership: "unknown", leakCount: 0 });
    assert.equal(result.cases[5].reference.provenanceOrigin, "github_snapshot");
    assert.equal(result.cases[6].reference.provenanceOrigin, "github_snapshot");
    assert.equal(result.cases[7].reference.provenanceOrigin, "github_snapshot");
    assert.ok(!JSON.stringify(result).includes("Required heading"));
  });

  it("admits only the minimal closed inbound-rejection marker", () => {
    const boundary = boundaryCorpus();
    boundary.cases[0].report.verificationContract.unknown = true;
    assert.equal(buildReferencePolicySealV2({ evidenceCorpus: evidenceCorpus(), boundaryCorpus: boundary }), null);
    const withRawField = boundaryCorpus();
    withRawField.cases[0].report.summary = "safe-looking raw source";
    assert.equal(buildReferencePolicySealV2({ evidenceCorpus: evidenceCorpus(), boundaryCorpus: withRawField }), null);
  });
});

export { boundaryCorpus, evidenceCorpus };

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
