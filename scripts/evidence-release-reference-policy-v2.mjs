import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const POLICY_ID = "agentproof-static-reference.v1";
const CAPABILITIES = ["documentation_literal", "path_change_absence"];
const REQUIRED_EVIDENCE_COVERAGE = [
  "documentation:satisfied", "documentation:violated", "documentation:unavailable",
  "absence:satisfied", "absence:current_path_violated", "absence:previous_path_violated", "absence:unavailable",
  "source:provided_authoritative", "source:linked_authoritative", "source:pr_author_claim",
  "deferred:test_case", "deferred:workflow_job", "deferred:return_value", "contract:multi_objective"
];
const REQUIRED_BOUNDARY_COVERAGE = [
  "boundary:inbound_authoritative_rejected", "boundary:inbound_author_claim_rejected",
  "boundary:pasted_changed_files", "boundary:pasted_checks", "boundary:pasted_logs",
  "boundary:empty_override_live", "boundary:text_only_override_live", "boundary:incomplete_live_conservative", "boundary:privacy_zero"
];
const COVERAGE_NAMES = [...REQUIRED_EVIDENCE_COVERAGE, ...REQUIRED_BOUNDARY_COVERAGE].sort(compareText);
const CASE_ID = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40,64}$/;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,31}$/;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]{1,200}$/;
const MAX_INPUT_BYTES = 400_000;
const MAX_ARTIFACT_BYTES = 65_536;
const INPUT_KEYS = [
  "url", "title", "description", "author", "baseBranch", "headBranch", "taskSource", "requirementSourceIdentityHash",
  "verificationContractSourceV2", "verificationContractBindingV2", "verificationCriterionEvidenceV2", "changedFiles", "checks", "logs",
  "executionSuites", "resolvedHeadModules", "taskText", "limitations", "sourceProvenance"
];
const REPORT_KEYS = [
  "analysisId", "createdAt", "analysisContext", "source", "summary", "requirements", "claims", "scope", "testing", "reviewPriority",
  "proofGraph", "reprompt", "evidenceIndex", "limitations", "semantic", "semanticAnalysis", "planner", "authenticity",
  "reportSchemaVersion", "verificationContract"
];
const OVERRIDE_KEYS = ["prUrl", "taskText", "prDescription", "changedFiles", "checks", "logs", "inputLimitations"];
const REFERENCE_POLICY_SOURCE_SHA256 = createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex");

export function referencePolicySha256V2() {
  return REFERENCE_POLICY_SOURCE_SHA256;
}

export function parseReferencePolicySealV2(value) {
  const keys = ["version", "policyId", "capabilities", "referencePolicySha256", "evidenceCorpusSha256", "evidenceCaseCount", "boundaryCorpusSha256", "boundaryCaseCount", "coverageSummary", "coverageSummarySha256"];
  if (!hasExactKeys(value, keys) || value.version !== 2 || value.policyId !== POLICY_ID || !sameArray(value.capabilities, CAPABILITIES) ||
    value.referencePolicySha256 !== referencePolicySha256V2() || value.evidenceCaseCount !== 12 || value.boundaryCaseCount !== 8 ||
    !isDigest(value.evidenceCorpusSha256) || !isDigest(value.boundaryCorpusSha256) || !isCoverageSummary(value.coverageSummary) ||
    value.coverageSummarySha256 !== sha256(value.coverageSummary) || !hasNamedCoverage(value.coverageSummary, [...REQUIRED_EVIDENCE_COVERAGE, ...REQUIRED_BOUNDARY_COVERAGE])) return null;
  return Object.freeze({ ...value, capabilities: [...CAPABILITIES] });
}

export function deriveCoverageSummaryV2(evidenceCorpus, boundaryCorpus) {
  const evidence = parseEvidenceCorpus(evidenceCorpus);
  const boundary = parseBoundaryCorpus(boundaryCorpus);
  if (!evidence || !boundary) return null;
  const counts = new Map();
  for (const item of evidence.cases) addEvidenceCoverage(counts, deriveEvidenceCase(item), item.input);
  for (const item of boundary.cases) addBoundaryCoverage(counts, item);
  return coverageSummary(counts, evidence.cases.length, boundary.cases.length);
}

export function buildReferencePolicySealV2({ evidenceCorpus, boundaryCorpus }) {
  const evidence = parseEvidenceCorpus(evidenceCorpus);
  const boundary = parseBoundaryCorpus(boundaryCorpus);
  const coverage = deriveCoverageSummaryV2(evidence, boundary);
  if (!evidence || !boundary || !coverage || !hasNamedCoverage(coverage, [...REQUIRED_EVIDENCE_COVERAGE, ...REQUIRED_BOUNDARY_COVERAGE])) return null;
  return {
    version: 2,
    policyId: POLICY_ID,
    capabilities: [...CAPABILITIES],
    referencePolicySha256: referencePolicySha256V2(),
    evidenceCorpusSha256: sha256(evidence),
    evidenceCaseCount: 12,
    boundaryCorpusSha256: sha256(boundary),
    boundaryCaseCount: 8,
    coverageSummary: coverage,
    coverageSummarySha256: sha256(coverage)
  };
}

export function deriveEvidenceReferenceV2(corpus, seal) {
  const evidence = parseEvidenceCorpus(corpus);
  const parsedSeal = parseReferencePolicySealV2(seal);
  if (!evidence || !parsedSeal || parsedSeal.evidenceCorpusSha256 !== sha256(evidence)) return null;
  const cases = evidence.cases.map(deriveEvidenceCase);
  const counts = new Map();
  for (let index = 0; index < cases.length; index += 1) addEvidenceCoverage(counts, cases[index], evidence.cases[index].input);
  const coverage = coverageSummary(counts, cases.length, 0);
  return hasNamedCoverage(coverage, REQUIRED_EVIDENCE_COVERAGE) && sameCoverageSlice(parsedSeal.coverageSummary, coverage, "evidence") ? { version: 2, cases } : null;
}

export function deriveBoundaryReferenceV2(corpus, seal) {
  const boundary = parseBoundaryCorpus(corpus);
  const parsedSeal = parseReferencePolicySealV2(seal);
  if (!boundary || !parsedSeal || parsedSeal.boundaryCorpusSha256 !== sha256(boundary)) return null;
  const counts = new Map();
  for (const item of boundary.cases) addBoundaryCoverage(counts, item);
  const coverage = coverageSummary(counts, 0, boundary.cases.length);
  if (!hasNamedCoverage(coverage, REQUIRED_BOUNDARY_COVERAGE) || !sameCoverageSlice(parsedSeal.coverageSummary, coverage, "boundary")) return null;
  return { version: 2, cases: boundary.cases.map((item) => ({ caseId: item.caseId, reference: deriveBoundaryCase(item) })) };
}

function parseEvidenceCorpus(value) {
  if (serializedBytes(value) > MAX_INPUT_BYTES * 12 + 8_192 || !hasExactKeys(value, ["version", "cases"]) || value.version !== 2 || !Array.isArray(value.cases) || value.cases.length !== 12 || containsPrivateMaterial(value)) return null;
  const ids = new Set();
  const cases = [];
  for (const item of value.cases) {
    if (!hasExactKeys(item, ["version", "caseId", "input"]) || item.version !== 2 || !isCaseId(item.caseId) || ids.has(item.caseId)) return null;
    const input = parseInput(item.input);
    if (!input) return null;
    ids.add(item.caseId);
    cases.push({ version: 2, caseId: item.caseId, input });
  }
  return { version: 2, cases };
}

function parseBoundaryCorpus(value) {
  if (serializedBytes(value) > 819_200 || !hasExactKeys(value, ["version", "cases"]) || value.version !== 2 || !Array.isArray(value.cases) || value.cases.length !== 8 || containsPrivateMaterial(value)) return null;
  const ids = new Set();
  const cases = [];
  for (const item of value.cases) {
    if (!isRecord(item) || item.version !== 2 || !isCaseId(item.caseId) || ids.has(item.caseId)) return null;
    if (item.kind === "inbound_untrusted_v2") {
      if (!hasExactKeys(item, ["version", "kind", "caseId", "report"]) || !isActiveV2Report(item.report)) return null;
      cases.push({ version: 2, kind: item.kind, caseId: item.caseId, report: item.report });
    } else if (item.kind === "pasted_merge") {
      if (!hasExactKeys(item, ["version", "kind", "caseId", "liveInput", "pastedOverride"])) return null;
      const liveInput = parseInput(item.liveInput);
      const pastedOverride = parsePastedOverride(item.pastedOverride);
      if (!liveInput || !pastedOverride) return null;
      cases.push({ version: 2, kind: item.kind, caseId: item.caseId, liveInput, pastedOverride });
    } else return null;
    ids.add(item.caseId);
  }
  return { version: 2, cases };
}

function parseInput(value) {
  if (serializedBytes(value) > MAX_INPUT_BYTES || !hasOnlyKeys(value, INPUT_KEYS) || !isText(value.title, 500) || !isText(value.description, 8_000) || !isText(value.taskText, 8_000) ||
    !Array.isArray(value.changedFiles) || value.changedFiles.length > 120 || !Array.isArray(value.checks) || value.checks.length > 60 || !Array.isArray(value.logs) || value.logs.length > 200 ||
    !isSourceProvenance(value.sourceProvenance) || !isBinding(value.verificationContractBindingV2)) return null;
  if (!value.changedFiles.every(isChangedFile) || !value.checks.every(isBoundedRecord) || !value.logs.every(isBoundedRecord) || !isOptionalString(value.url, 500) || !isOptionalString(value.author, 500) ||
    !isOptionalString(value.baseBranch, 500) || !isOptionalString(value.headBranch, 500) || (value.taskSource !== undefined && value.taskSource !== "task" && value.taskSource !== "issue") ||
    !isOptionalDigest(value.requirementSourceIdentityHash) || !isStringArray(value.limitations, 32, 1_000) || !isArray(value.executionSuites, 12) || !isArray(value.resolvedHeadModules, 120)) return null;
  const parsedSource = parseContractSource(value.verificationContractSourceV2);
  const artifacts = parseArtifacts(value.verificationCriterionEvidenceV2);
  if (!parsedSource || !artifacts || parsedSource.sourceKind !== value.verificationContractBindingV2.sourceKind) return null;
  return { ...value, verificationContractSourceV2: parsedSource.source, verificationContractBindingV2: { ...value.verificationContractBindingV2 }, verificationCriterionEvidenceV2: { artifactBlobs: artifacts } };
}

function parseContractSource(value) {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  if (value.kind === "provided_requirement") {
    if (!hasExactKeys(value, ["kind", "contract"])) return null;
    const contract = parseContract(value.contract);
    return contract ? { sourceKind: value.kind, state: "authoritative", contract, source: { kind: value.kind, contract } } : null;
  }
  if ((value.kind !== "linked_issue" && value.kind !== "pr_description") || !hasExactKeys(value, ["kind", "title", "body"]) || !isText(value.title, 500) || !isText(value.body, 24_000)) return null;
  const contract = parseContract(extractContractEnvelope(value.title, value.body));
  if (!contract) return null;
  return { sourceKind: value.kind, state: value.kind === "pr_description" ? "author_claim" : "authoritative", contract, source: { kind: value.kind, title: value.title, body: value.body } };
}

function extractContractEnvelope(title, body) {
  if (title !== "AgentProof verification contract") return null;
  let normalized = normalizeNewlines(body).trim();
  const heading = "## AgentProof verification\n\n";
  if (normalized.startsWith(heading)) normalized = normalized.slice(heading.length);
  const open = "```agentproof-verification\n";
  const close = "\n```";
  if (!normalized.startsWith(open) || !normalized.endsWith(close)) return null;
  try { return JSON.parse(normalized.slice(open.length, -close.length)); } catch { return null; }
}

function parseContract(value) {
  if (!hasExactKeys(value, ["version", "scope", "objectives"]) || value.version !== 2 || value.scope !== "complete_objective_set" || !Array.isArray(value.objectives) || value.objectives.length < 1 || value.objectives.length > 12 || serializedBytes(value) > 16_384) return null;
  const objectiveIds = new Set();
  const criterionIds = new Set();
  const objectives = [];
  let totalCriteria = 0;
  for (const objective of value.objectives) {
    if (!hasExactKeys(objective, ["id", "objective", "criteria"]) || !isIdentifier(objective.id) || !isText(objective.objective, 500) || !Array.isArray(objective.criteria) || objective.criteria.length < 1 || objective.criteria.length > 4 || objectiveIds.has(objective.id)) return null;
    objectiveIds.add(objective.id);
    totalCriteria += objective.criteria.length;
    if (totalCriteria > 24) return null;
    const criteria = [];
    for (const value of objective.criteria) {
      const criterion = parseCriterion(value);
      if (!criterion || criterionIds.has(criterion.id)) return null;
      criterionIds.add(criterion.id);
      criteria.push(criterion);
    }
    objectives.push({ id: objective.id, objective: objective.objective, criteria });
  }
  return { version: 2, scope: "complete_objective_set", objectives };
}

function parseCriterion(value) {
  if (!isRecord(value) || !isIdentifier(value.id) || !isText(value.label, 240)) return null;
  if (value.type === "absence") {
    if (!hasExactKeys(value, ["id", "type", "label", "prohibitedKind", "scope"]) || value.prohibitedKind !== "path_change" || !Array.isArray(value.scope) || value.scope.length < 1 || value.scope.length > 8 || !value.scope.every((scope) => hasExactKeys(scope, ["kind", "path"]) && (scope.kind === "exact" || scope.kind === "prefix") && isSafePath(scope.path) && (scope.kind !== "prefix" || scope.path.endsWith("/")))) return null;
    return { id: value.id, type: "absence", label: value.label, prohibitedKind: "path_change", scope: value.scope.map((scope) => ({ kind: scope.kind, path: scope.path })) };
  }
  if (value.type === "artifact") {
    if (!hasExactKeys(value, ["id", "type", "label", "paths", "artifact"]) || !Array.isArray(value.paths) || value.paths.length < 1 || value.paths.length > 16 || !value.paths.every(isSafePath) || !isRecord(value.artifact)) return null;
    if (value.artifact.kind === "documentation_literal" && hasExactKeys(value.artifact, ["kind", "literal"]) && isText(value.artifact.literal, 200)) return { id: value.id, type: "artifact", label: value.label, paths: [...value.paths], artifact: { kind: "documentation_literal", literal: value.artifact.literal } };
    if (value.artifact.kind === "test_case" && hasExactKeys(value.artifact, ["kind", "testId"]) && isText(value.artifact.testId, 200)) return { id: value.id, type: "artifact", label: value.label, paths: [...value.paths], artifact: { kind: "test_case", testId: value.artifact.testId } };
    if (value.artifact.kind === "workflow_job" && hasOnlyKeys(value.artifact, ["kind", "workflowName", "jobName", "runtimeName", "runtimeVersion", "packageScript"]) && isText(value.artifact.workflowName, 200) && isText(value.artifact.jobName, 200) && isOptionalString(value.artifact.runtimeName, 200) && isOptionalString(value.artifact.runtimeVersion, 200) && isOptionalString(value.artifact.packageScript, 200)) return { id: value.id, type: "artifact", label: value.label, paths: [...value.paths], artifact: { ...value.artifact } };
    return null;
  }
  if (value.type === "return_value") {
    if (!hasExactKeys(value, ["id", "type", "label", "adapter", "cases"]) || !isAdapter(value.adapter) || !Array.isArray(value.cases) || value.cases.length < 1 || value.cases.length > 8 || !value.cases.every(isReturnCase)) return null;
    return { id: value.id, type: "return_value", label: value.label, adapter: { ...value.adapter }, cases: value.cases.map((item) => ({ ...item })) };
  }
  return null;
}

function parseArtifacts(value) {
  if (!hasExactKeys(value, ["artifactBlobs"]) || !Array.isArray(value.artifactBlobs) || value.artifactBlobs.length > 8) return null;
  const paths = new Set();
  const artifacts = [];
  for (const blob of value.artifactBlobs) {
    if (!hasOnlyKeys(blob, ["path", "headSha", "content"]) || !isSafePath(blob.path) || !isOptionalGitSha(blob.headSha) || !isText(blob.content, MAX_ARTIFACT_BYTES) || paths.has(blob.path)) return null;
    paths.add(blob.path);
    artifacts.push({ path: blob.path, ...(blob.headSha ? { headSha: blob.headSha } : {}), content: blob.content });
  }
  return artifacts;
}

function deriveEvidenceCase(item) {
  const source = parseContractSource(item.input.verificationContractSourceV2);
  if (!source) throw new Error("sealed evidence case became invalid");
  const objectives = source.contract.objectives.map((objective, objectiveIndex) => {
    const requirementId = `vc_o${objectiveIndex + 1}`;
    const criteria = objective.criteria.map((criterion, criterionIndex) => deriveCriterion(criterion, item.input, requirementId, `${requirementId}_c${criterionIndex + 1}`));
    return { requirementId, outcome: aggregateOutcome(source.state, criteria.map((criterion) => criterion.state)), criteria };
  });
  return { caseId: item.caseId, reference: { contract: { sourceKind: source.sourceKind, state: source.state }, objectives } };
}

function deriveCriterion(criterion, input, requirementId, criterionId) {
  const capability = criterion.type === "absence" ? "path_change_absence" : criterion.type === "artifact" ? criterion.artifact.kind : "return_value";
  const requiredEvidence = capability === "documentation_literal" ? ["documentation"] : capability === "path_change_absence" ? ["implementation"] : capability === "test_case" ? ["targeted_test", "execution"] : capability === "workflow_job" ? ["ci_configuration", "execution"] : ["implementation", "targeted_test", "execution"];
  const state = capability === "documentation_literal" ? documentationState(criterion, input) : capability === "path_change_absence" ? absenceState(criterion, input).state : "unavailable";
  return { criterionId, requirementId, capability, requiredEvidence, state };
}

function documentationState(criterion, input) {
  const headSha = input.verificationContractBindingV2.headSha;
  if (!hasExactGithubHead(input.sourceProvenance, headSha)) return "unavailable";
  const blobs = input.verificationCriterionEvidenceV2.artifactBlobs;
  const matching = criterion.paths.map((path) => blobs.find((blob) => blob.path === path && blob.headSha === headSha));
  if (matching.some((blob) => !blob || Buffer.byteLength(blob.content, "utf8") > MAX_ARTIFACT_BYTES)) return "unavailable";
  const literal = normalizeNewlines(criterion.artifact.literal);
  return matching.every((blob) => normalizeNewlines(blob.content).includes(literal)) ? "satisfied" : "violated";
}

function absenceState(criterion, input) {
  const headSha = input.verificationContractBindingV2.headSha;
  if (!hasExactGithubHead(input.sourceProvenance, headSha) || input.sourceProvenance.changedFileInventory?.completeness !== "complete" || input.sourceProvenance.changedFileInventory.headSha !== headSha || input.changedFiles.some((file) => (file.status === "renamed") !== Boolean(file.previousPath))) return { state: "unavailable", absenceMatch: "unavailable" };
  for (const file of input.changedFiles) {
    if (matchesScope(file.path, criterion.scope)) return { state: "violated", absenceMatch: "current" };
    if (file.status === "renamed" && file.previousPath && matchesScope(file.previousPath, criterion.scope)) return { state: "violated", absenceMatch: "previous" };
  }
  return { state: "satisfied", absenceMatch: "none" };
}

function deriveBoundaryCase(item) {
  if (item.kind === "inbound_untrusted_v2") return { disposition: "rejected", provenanceOrigin: "none", localAxisStates: { implementation: "incomplete", targeted_test: "incomplete", execution: "incomplete" }, requirementLocalCiOwnership: "unknown", leakCount: 0 };
  const hasPastedAuthority = ["changedFiles", "checks", "logs"].some((key) => hasNonEmptyText(item.pastedOverride[key]));
  return { disposition: "accepted", provenanceOrigin: hasPastedAuthority ? "pasted_evidence" : boundaryLiveOrigin(item.liveInput.sourceProvenance), localAxisStates: { implementation: "incomplete", targeted_test: "incomplete", execution: "incomplete" }, requirementLocalCiOwnership: "unknown", leakCount: 0 };
}

function addEvidenceCoverage(counts, item, input) {
  const source = item.reference.contract;
  const contract = parseContractSource(input.verificationContractSourceV2)?.contract;
  if (!contract) throw new Error("sealed evidence case lost contract");
  addCoverage(counts, source.state === "author_claim" ? "source:pr_author_claim" : `source:${source.sourceKind === "linked_issue" ? "linked" : "provided"}_authoritative`);
  if (item.reference.objectives.length > 1) addCoverage(counts, "contract:multi_objective");
  for (let objectiveIndex = 0; objectiveIndex < item.reference.objectives.length; objectiveIndex += 1) {
    const objective = item.reference.objectives[objectiveIndex];
    const sourceObjective = contract.objectives[objectiveIndex];
    for (let criterionIndex = 0; criterionIndex < objective.criteria.length; criterionIndex += 1) {
      const criterion = objective.criteria[criterionIndex];
      if (criterion.capability === "documentation_literal") addCoverage(counts, `documentation:${criterion.state}`);
      if (criterion.capability === "path_change_absence") {
        const match = absenceState(sourceObjective.criteria[criterionIndex], input).absenceMatch;
        addCoverage(counts, criterion.state === "violated" ? `absence:${match}_path_violated` : `absence:${criterion.state}`);
      }
      if (["test_case", "workflow_job", "return_value"].includes(criterion.capability) && criterion.state === "unavailable") addCoverage(counts, `deferred:${criterion.capability}`);
    }
  }
}

function addBoundaryCoverage(counts, item) {
  if (item.kind === "inbound_untrusted_v2") {
    if (item.report.verificationContract.state === "authoritative") addCoverage(counts, "boundary:inbound_authoritative_rejected");
    if (item.report.verificationContract.state === "author_claim") addCoverage(counts, "boundary:inbound_author_claim_rejected");
    addCoverage(counts, "boundary:privacy_zero");
    return;
  }
  const override = item.pastedOverride;
  if (hasNonEmptyText(override.changedFiles)) addCoverage(counts, "boundary:pasted_changed_files");
  if (hasNonEmptyText(override.checks)) addCoverage(counts, "boundary:pasted_checks");
  if (hasNonEmptyText(override.logs)) addCoverage(counts, "boundary:pasted_logs");
  if (!["changedFiles", "checks", "logs"].some((key) => hasNonEmptyText(override[key]))) addCoverage(counts, hasNonEmptyText(override.taskText) || hasNonEmptyText(override.prDescription) ? "boundary:text_only_override_live" : "boundary:empty_override_live");
  if (!hasExactGithubHead(item.liveInput.sourceProvenance, item.liveInput.verificationContractBindingV2.headSha) || item.liveInput.sourceProvenance.changedFileInventory?.completeness !== "complete") addCoverage(counts, "boundary:incomplete_live_conservative");
  addCoverage(counts, "boundary:privacy_zero");
}

function coverageSummary(counts, evidenceCaseCount, boundaryCaseCount) {
  return { version: 2, evidenceCaseCount, boundaryCaseCount, entries: [...counts.entries()].sort(([left], [right]) => compareText(left, right)).map(([name, count]) => ({ name, count })) };
}

function hasNamedCoverage(summary, required) {
  const names = new Set(summary.entries.filter((entry) => entry.count > 0).map((entry) => entry.name));
  return required.every((name) => names.has(name));
}

function isCoverageSummary(value) {
  return hasExactKeys(value, ["version", "evidenceCaseCount", "boundaryCaseCount", "entries"]) && value.version === 2 && value.evidenceCaseCount === 12 && value.boundaryCaseCount === 8 &&
    Array.isArray(value.entries) && value.entries.length === COVERAGE_NAMES.length && value.entries.every((entry, index) => hasExactKeys(entry, ["name", "count"]) && entry.name === COVERAGE_NAMES[index] && Number.isSafeInteger(entry.count) && entry.count > 0 && entry.count <= 288);
}

function sameCoverageSlice(sealed, derived, surface) {
  const belongs = (name) => surface === "boundary" ? name.startsWith("boundary:") : !name.startsWith("boundary:");
  const selected = (summary) => summary.entries.filter((entry) => belongs(entry.name));
  return canonicalJson(selected(sealed)) === canonicalJson(selected(derived));
}

function aggregateOutcome(sourceState, states) {
  if (states.length === 0) return "unclear";
  if (states.every((state) => state === "satisfied")) return sourceState === "authoritative" ? "met" : "partial";
  if (states.some((state) => state === "satisfied")) return "partial";
  if (states.every((state) => state === "violated")) return "missing";
  return "unclear";
}

function isBinding(value) {
  return hasExactKeys(value, ["sourceKind", "sourceIdentity", "sourceContent", "headSha", "baseSha"]) && ["provided_requirement", "linked_issue", "pr_description"].includes(value.sourceKind) && isText(value.sourceIdentity, 500) && isText(value.sourceContent, 24_000) && isGitSha(value.headSha) && isGitSha(value.baseSha);
}

function isSourceProvenance(value) {
  return hasOnlyKeys(value, ["version", "origin", "headSha", "baseSha", "changedFileInventory", "executionSuites", "evidenceCapturedAt", "inputFingerprint"]) && value.version === 1 && ["github_snapshot", "pasted_evidence", "demo"].includes(value.origin) && isOptionalGitSha(value.headSha) && isOptionalGitSha(value.baseSha) && isText(value.evidenceCapturedAt, 100) && hasExactKeys(value.inputFingerprint, ["version", "algorithm", "value", "coverage"]) && value.inputFingerprint.version === 1 && value.inputFingerprint.algorithm === "sha256" && isDigest(value.inputFingerprint.value) && ["github_metadata", "pasted_metadata", "demo_fixture"].includes(value.inputFingerprint.coverage) && (value.changedFileInventory === undefined || hasOnlyKeys(value.changedFileInventory, ["version", "completeness", "headSha"]) && value.changedFileInventory.version === 1 && ["complete", "incomplete"].includes(value.changedFileInventory.completeness) && isOptionalGitSha(value.changedFileInventory.headSha));
}

function isChangedFile(value) {
  return hasOnlyKeys(value, ["path", "previousPath", "additions", "deletions", "status", "patch"]) && isSafePath(value.path) && isOptionalSafePath(value.previousPath) && isOptionalNonNegative(value.additions) && isOptionalNonNegative(value.deletions) && (value.status === undefined || ["added", "modified", "removed", "renamed"].includes(value.status)) && isOptionalString(value.patch, 12_000);
}

function isActiveV2Report(value) {
  return hasExactKeys(value, ["reportSchemaVersion", "verificationContract"]) && value.reportSchemaVersion === "verification-report.v2" &&
    hasExactKeys(value.verificationContract, ["state"]) && ["authoritative", "author_claim"].includes(value.verificationContract.state);
}

function parsePastedOverride(value) {
  if (!hasOnlyKeys(value, OVERRIDE_KEYS) || !["prUrl", "taskText", "prDescription", "changedFiles", "checks", "logs"].every((key) => isOptionalString(value[key], key === "logs" ? 24_000 : key === "changedFiles" ? 12_000 : 8_000)) || !isStringArray(value.inputLimitations, 32, 1_000)) return null;
  return { ...value };
}

function isAdapter(value) {
  if (!isRecord(value) || typeof value.id !== "string" || !isSafePath(value.modulePath)) return false;
  return (value.id === "node_export_scalar.v1" && hasExactKeys(value, ["id", "modulePath", "exportName", "moduleFormat"]) && isIdentifier(value.exportName) && ["esm", "commonjs"].includes(value.moduleFormat)) || (value.id === "python_function_scalar.v1" && hasExactKeys(value, ["id", "modulePath", "functionName"]) && isIdentifier(value.functionName));
}

function isReturnCase(value) {
  return hasOnlyKeys(value, ["id", "input", "expected"]) && isIdentifier(value.id) && isScalar(value.expected) && (!Object.hasOwn(value, "input") || isScalar(value.input));
}

function hasExactGithubHead(provenance, headSha) { return provenance.origin === "github_snapshot" && provenance.inputFingerprint.coverage === "github_metadata" && provenance.headSha === headSha && isGitSha(headSha); }
function boundaryLiveOrigin(provenance) { return provenance.origin === "github_snapshot" ? "github_snapshot" : provenance.origin === "pasted_evidence" ? "pasted_evidence" : provenance.origin === "demo" ? "demo" : "none"; }
function matchesScope(path, scopes) { return scopes.some((scope) => scope.kind === "exact" ? path === scope.path : path.startsWith(scope.path)); }
function addCoverage(counts, name) { counts.set(name, (counts.get(name) ?? 0) + 1); }
function compareText(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function hasNonEmptyText(value) { return typeof value === "string" && value.trim().length > 0; }
function normalizeNewlines(value) { return value.replace(/\r\n?/g, "\n"); }
function sameArray(left, right) { return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]); }
function isCaseId(value) { return typeof value === "string" && CASE_ID.test(value); }
function isDigest(value) { return typeof value === "string" && CASE_ID.test(value); }
function isGitSha(value) { return typeof value === "string" && GIT_SHA.test(value); }
function isOptionalGitSha(value) { return value === undefined || isGitSha(value); }
function isIdentifier(value) { return typeof value === "string" && IDENTIFIER.test(value); }
function isSafePath(value) { return typeof value === "string" && SAFE_PATH.test(value); }
function isOptionalSafePath(value) { return value === undefined || isSafePath(value); }
function isText(value, max) { return typeof value === "string" && Buffer.byteLength(value, "utf8") <= max && !value.includes("\0"); }
function isOptionalString(value, max) { return value === undefined || isText(value, max); }
function isOptionalDigest(value) { return value === undefined || isDigest(value); }
function isOptionalNonNegative(value) { return value === undefined || Number.isSafeInteger(value) && value >= 0; }
function isScalar(value) { return value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) || isText(value, 200); }
function isArray(value, max) { return value === undefined || Array.isArray(value) && value.length <= max; }
function isStringArray(value, max, stringMax) { return value === undefined || Array.isArray(value) && value.length <= max && value.every((item) => isText(item, stringMax)); }
function isBoundedRecord(value) { return isRecord(value) && serializedBytes(value) <= 24_000; }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function hasExactKeys(value, keys) { return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function hasOnlyKeys(value, keys) { return isRecord(value) && Object.keys(value).every((key) => keys.includes(key)); }

function containsPrivateMaterial(value, key = "") {
  if (/(?:^|_)(?:token|password|credential|authorization|cookie|private_key)(?:$|_)/i.test(key)) return true;
  if (Array.isArray(value)) return value.some((item) => containsPrivateMaterial(item));
  if (isRecord(value)) return Object.entries(value).some(([nextKey, item]) => containsPrivateMaterial(item, nextKey));
  return typeof value === "string" && /(?:BEGIN PRIVATE (?:KEY|SOURCE|LOG|DATA)|github_pat_|gh[pousr]_[A-Za-z0-9]{8,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bsk-[A-Za-z0-9]{16,})/.test(value);
}

function serializedBytes(value) {
  try { return Buffer.byteLength(canonicalJson(value), "utf8"); } catch { return Number.POSITIVE_INFINITY; }
}

function sha256(value) { return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex"); }

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!isRecord(value)) throw new TypeError("unsupported value");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
