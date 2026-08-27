import assert from "node:assert/strict";

const sha = (index) => index.toString(16).padStart(64, "0");
const gitSha = "a".repeat(40);
// Only these complete structural value leaves are intentionally emitted by the
// valid init/validate/seal protocol. Substrings inside any other output leaf are
// still checked against every synthetic fixture string.
const ALLOWED_STRUCTURAL_OUTPUT_VALUES = new Set([
  "initialized", "valid", "complete", "sealed",
  "agentproof-static-reference.v1", "documentation_literal", "path_change_absence",
  "source:provided_authoritative", "source:linked_authoritative", "source:pr_author_claim",
  "contract:multi_objective", "documentation:satisfied", "documentation:violated", "documentation:unavailable",
  "absence:satisfied", "absence:current_path_violated", "absence:previous_path_violated", "absence:unavailable",
  "deferred:test_case", "deferred:workflow_job", "deferred:return_value",
  "boundary:inbound_authoritative_rejected", "boundary:inbound_author_claim_rejected",
  "boundary:empty_override_live", "boundary:pasted_changed_files", "boundary:pasted_checks", "boundary:pasted_logs",
  "boundary:text_only_override_live", "boundary:incomplete_live_conservative", "boundary:privacy_zero"
]);

function contract(kind = "documentation_literal", multiObjective = false) {
  const criterion = kind === "absence"
    ? { id: "keep_paths", type: "absence", label: "Keep paths", prohibitedKind: "path_change", scope: [{ kind: "prefix", path: "src/" }] }
    : kind === "return_value"
      ? { id: "returns", type: "return_value", label: "Returns", adapter: { id: "node_export_scalar.v1", modulePath: "src/value.mjs", exportName: "value", moduleFormat: "esm" }, cases: [{ id: "case", expected: 1 }] }
      : { id: "documented", type: "artifact", label: "Documented", paths: ["README.md"], artifact: { kind, ...(kind === "documentation_literal" ? { literal: "public" } : kind === "test_case" ? { testId: "case" } : { workflowName: "ci", jobName: "test" }) } };
  const objectives = [{ id: "objective", objective: "Verify public contract", criteria: [criterion] }];
  if (multiObjective) objectives.push({ id: "absence", objective: "Preserve paths", criteria: [{ id: "keep_paths", type: "absence", label: "Keep paths", prohibitedKind: "path_change", scope: [{ kind: "prefix", path: "src/" }] }] });
  return { version: 2, scope: "complete_objective_set", objectives };
}

function input(index) {
  const sourceKind = index % 3 === 0 ? "provided_requirement" : index % 3 === 1 ? "linked_issue" : "pr_description";
  const verificationContract = contract(["documentation_literal", "absence", "test_case", "workflow_job", "return_value"][index % 5], index === 0);
  const source = sourceKind === "provided_requirement"
    ? { kind: sourceKind, contract: verificationContract }
    : { kind: sourceKind, title: "AgentProof verification contract", body: `## AgentProof verification\n\n\`\`\`agentproof-verification\n${JSON.stringify(verificationContract)}\n\`\`\`` };
  return {
    title: "Synthetic pull request", description: "Synthetic description", taskText: "Synthetic task", changedFiles: index === 6 ? [{ path: "src/a.mjs", status: "modified" }] : index === 11 ? [{ path: "new.mjs", previousPath: "src/old.mjs", status: "renamed" }] : [{ path: "README.md", status: "modified" }], checks: [], logs: [],
    sourceProvenance: { version: 1, origin: "github_snapshot", evidenceCapturedAt: "2026-08-27T00:00:00Z", inputFingerprint: { version: 1, algorithm: "sha256", value: sha(index + 40), coverage: "github_metadata" }, headSha: index === 10 ? "c".repeat(40) : gitSha, baseSha: "b".repeat(40), changedFileInventory: { version: 1, completeness: index === 0 || index === 7 ? "incomplete" : "complete", headSha: gitSha } },
    verificationContractSourceV2: source,
    verificationContractBindingV2: { sourceKind, sourceIdentity: "synthetic", sourceContent: "synthetic", headSha: gitSha, baseSha: "b".repeat(40) },
    verificationCriterionEvidenceV2: { artifactBlobs: [{ path: "README.md", headSha: gitSha, content: index === 5 ? "missing" : "public" }] }
  };
}

export function validAuthoringFixtureV2() {
  return {
    evidenceCorpus: { version: 2, cases: Array.from({ length: 12 }, (_, index) => ({ version: 2, caseId: sha(index + 1), input: input(index) })) },
    boundaryCorpus: { version: 2, cases: Array.from({ length: 8 }, (_, index) => index < 2
      ? { version: 2, kind: "inbound_untrusted_v2", caseId: sha(index + 20), report: { reportSchemaVersion: "verification-report.v2", verificationContract: { state: index === 0 ? "authoritative" : "author_claim" } } }
      : { version: 2, kind: "pasted_merge", caseId: sha(index + 20), liveInput: input(index), pastedOverride: index === 2 ? {} : index === 3 ? { prUrl: "https://example.test/pr/1", changedFiles: "README.md" } : index === 4 ? { prUrl: "https://example.test/pr/2", checks: "check" } : index === 5 ? { prUrl: "https://example.test/pr/3", logs: "log" } : index === 6 ? { prUrl: "https://example.test/pr/4", taskText: "text", prDescription: "text" } : { prUrl: "https://example.test/pr/5", inputLimitations: ["incomplete"] } }) }
  };
}

export function validLargeAuthoringFixtureV2() {
  const fixture = validAuthoringFixtureV2();
  for (const [caseIndex, item] of fixture.evidenceCorpus.cases.entries()) {
    for (let blobIndex = 1; blobIndex < 8; blobIndex += 1) {
      item.input.verificationCriterionEvidenceV2.artifactBlobs.push({
        path: `padding/${caseIndex}-${blobIndex}.txt`,
        content: "\u0001".repeat(9_470)
      });
    }
  }
  return fixture;
}

export function protectedAuthoringFixtureValuesV2(fixture) {
  const values = new Set();
  collectStringLeaves(fixture.evidenceCorpus, values);
  collectStringLeaves(fixture.boundaryCorpus, values);
  return [...values].sort();
}

export function assertNoProtectedAuthoringFixtureValuesV2(fixture, outputValues) {
  const outputStrings = new Set();
  collectStringLeaves(outputValues, outputStrings);
  const protectedValues = protectedAuthoringFixtureValuesV2(fixture);
  for (const outputString of outputStrings) {
    if (ALLOWED_STRUCTURAL_OUTPUT_VALUES.has(outputString)) continue;
    for (const protectedValue of protectedValues) assert.equal(outputString.includes(protectedValue), false, protectedValue);
  }
}

function collectStringLeaves(value, values) {
  if (typeof value === "string") values.add(value);
  else if (Array.isArray(value)) for (const item of value) collectStringLeaves(item, values);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collectStringLeaves(item, values);
}
