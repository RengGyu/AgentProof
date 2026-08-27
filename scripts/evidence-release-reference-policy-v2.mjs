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
  return coverageSummaryFromParsed(evidence, boundary);
}

export function inspectReferencePolicyInputsV2({ evidenceCorpus, boundaryCorpus }) {
  const errors = [];
  const evidence = parseEvidenceCorpus(evidenceCorpus, { document: "evidence", errors });
  const boundary = parseBoundaryCorpus(boundaryCorpus, { document: "boundary", errors });
  if (!evidence || !boundary) return errors.length > 0
    ? { ok: false, stage: "cross_field", errors: boundedErrors(errors) }
    : { ok: false, stage: "internal", errors: [{ code: "internal_validation_failure" }] };
  const coverageSummary = coverageSummaryFromParsed(evidence, boundary);
  const missing = missingRequiredCoverage(coverageSummary);
  if (missing.length > 0) return { ok: false, stage: "coverage", errors: missing.map((coverageName) => ({ code: "coverage_missing", coverageName })) };
  return { ok: true, stage: "complete", errors: [], coverageSummary };
}

function coverageSummaryFromParsed(evidence, boundary) {
  const counts = new Map();
  for (const item of evidence.cases) addEvidenceCoverage(counts, deriveEvidenceCase(item), item.input);
  for (const item of boundary.cases) addBoundaryCoverage(counts, item);
  return coverageSummary(counts, evidence.cases.length, boundary.cases.length);
}

export function buildReferencePolicySealV2({ evidenceCorpus, boundaryCorpus }) {
  const evidence = parseEvidenceCorpus(evidenceCorpus);
  const boundary = parseBoundaryCorpus(boundaryCorpus);
  const coverage = evidence && boundary ? coverageSummaryFromParsed(evidence, boundary) : null;
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

function parseEvidenceCorpus(value, context) {
  if (serializedBytes(value) > MAX_INPUT_BYTES * 12 + 8_192) return reject(context, { path: "", code: "out_of_bounds" });
  if (!hasExactKeys(value, ["version", "cases"])) return reject(context, { path: "", code: "wrong_constant" });
  if (value.version !== 2) return reject(context, { path: "/version", code: "wrong_constant" });
  if (!Array.isArray(value.cases) || value.cases.length !== 12) return reject(context, { path: "/cases", code: "out_of_bounds" });
  if (containsPrivateMaterial(value)) return reject(context, { path: "", code: "private_material_rejected" });
  const ids = new Set();
  const cases = [];
  for (let index = 0; index < value.cases.length; index += 1) {
    const item = value.cases[index];
    const itemContext = childContext(context, `/cases/${index}`, index);
    if (!hasExactKeys(item, ["version", "caseId", "input"])) return reject(itemContext, { path: itemContext?.path ?? "", code: "wrong_constant" });
    if (item.version !== 2) return reject(itemContext, { path: `${itemContext.path}/version`, code: "wrong_constant" });
    if (!isCaseId(item.caseId)) return reject(itemContext, { path: `${itemContext.path}/caseId`, code: "invalid_sha" });
    if (ids.has(item.caseId)) return reject(itemContext, { path: `${itemContext.path}/caseId`, code: "duplicate_identity" });
    const input = parseInput(item.input, childContext(itemContext, `${itemContext.path}/input`));
    if (!input) return null;
    ids.add(item.caseId);
    cases.push({ version: 2, caseId: item.caseId, input });
  }
  return { version: 2, cases };
}

function parseBoundaryCorpus(value, context) {
  if (serializedBytes(value) > 819_200) return reject(context, { path: "", code: "out_of_bounds" });
  if (!hasExactKeys(value, ["version", "cases"])) return reject(context, { path: "", code: "wrong_constant" });
  if (value.version !== 2) return reject(context, { path: "/version", code: "wrong_constant" });
  if (!Array.isArray(value.cases) || value.cases.length !== 8) return reject(context, { path: "/cases", code: "out_of_bounds" });
  if (containsPrivateMaterial(value)) return reject(context, { path: "", code: "private_material_rejected" });
  const ids = new Set();
  const cases = [];
  for (let index = 0; index < value.cases.length; index += 1) {
    const item = value.cases[index];
    const itemContext = childContext(context, `/cases/${index}`, index);
    if (!isRecord(item)) return reject(itemContext, { path: itemContext?.path ?? "", code: "wrong_type" });
    if (item.version !== 2) return reject(itemContext, { path: `${itemContext.path}/version`, code: "wrong_constant" });
    if (!isCaseId(item.caseId)) return reject(itemContext, { path: `${itemContext.path}/caseId`, code: "invalid_sha" });
    if (ids.has(item.caseId)) return reject(itemContext, { path: `${itemContext.path}/caseId`, code: "duplicate_identity" });
    if (item.kind === "inbound_untrusted_v2") {
      if (!hasExactKeys(item, ["version", "kind", "caseId", "report"]) || !isActiveV2Report(item.report)) return reject(itemContext, { path: itemContext.path, code: "wrong_constant" });
      cases.push({ version: 2, kind: item.kind, caseId: item.caseId, report: item.report });
    } else if (item.kind === "pasted_merge") {
      if (!hasExactKeys(item, ["version", "kind", "caseId", "liveInput", "pastedOverride"])) return reject(itemContext, { path: itemContext.path, code: "wrong_constant" });
      const liveInput = parseInput(item.liveInput, childContext(itemContext, `${itemContext.path}/liveInput`));
      const pastedOverride = parsePastedOverride(item.pastedOverride, childContext(itemContext, `${itemContext.path}/pastedOverride`));
      if (!liveInput || !pastedOverride) return null;
      cases.push({ version: 2, kind: item.kind, caseId: item.caseId, liveInput, pastedOverride });
    } else return reject(itemContext, { path: `${itemContext.path}/kind`, code: "wrong_constant" });
    ids.add(item.caseId);
  }
  return { version: 2, cases };
}

function parseInput(value, context) {
  if (serializedBytes(value) > MAX_INPUT_BYTES) return reject(context, { path: context?.path ?? "", code: "out_of_bounds" });
  if (!hasOnlyKeys(value, INPUT_KEYS)) return reject(context, { path: context?.path ?? "", code: "wrong_constant" });
  for (const [key, max] of [["title", 500], ["description", 8_000], ["taskText", 8_000]]) {
    if (!isText(value[key], max)) return reject(context, { path: `${context?.path ?? ""}/${key}`, code: textErrorCode(value[key], max) });
  }
  for (const [key, max] of [["changedFiles", 120], ["checks", 60], ["logs", 200]]) {
    if (!Array.isArray(value[key]) || value[key].length > max) return reject(context, { path: `${context?.path ?? ""}/${key}`, code: "out_of_bounds" });
  }
  if (!isSourceProvenance(value.sourceProvenance, childContext(context, `${context?.path ?? ""}/sourceProvenance`))) return null;
  if (!isBinding(value.verificationContractBindingV2, childContext(context, `${context?.path ?? ""}/verificationContractBindingV2`))) return null;
  for (let index = 0; index < value.changedFiles.length; index += 1) if (!isChangedFile(value.changedFiles[index], childContext(context, `${context?.path ?? ""}/changedFiles/${index}`))) return null;
  if (!value.checks.every(isBoundedRecord) || !value.logs.every(isBoundedRecord)) return reject(context, { path: context?.path ?? "", code: "out_of_bounds" });
  for (const [key, max] of [["url", 500], ["author", 500], ["baseBranch", 500], ["headBranch", 500]]) {
    if (!isOptionalString(value[key], max)) return reject(context, { path: `${context?.path ?? ""}/${key}`, code: textErrorCode(value[key], max) });
  }
  if (value.taskSource !== undefined && value.taskSource !== "task" && value.taskSource !== "issue") return reject(context, { path: `${context?.path ?? ""}/taskSource`, code: "wrong_constant" });
  if (!isOptionalDigest(value.requirementSourceIdentityHash)) return reject(context, { path: `${context?.path ?? ""}/requirementSourceIdentityHash`, code: "invalid_sha" });
  if (!isStringArray(value.limitations, 32, 1_000) || !isArray(value.executionSuites, 12) || !isArray(value.resolvedHeadModules, 120)) return reject(context, { path: context?.path ?? "", code: "out_of_bounds" });
  const parsedSource = parseContractSource(value.verificationContractSourceV2, childContext(context, `${context?.path ?? ""}/verificationContractSourceV2`));
  const artifacts = parseArtifacts(value.verificationCriterionEvidenceV2, childContext(context, `${context?.path ?? ""}/verificationCriterionEvidenceV2`));
  if (parsedSource && parsedSource.sourceKind !== value.verificationContractBindingV2.sourceKind) reject(context, { path: `${context?.path ?? ""}/verificationContractBindingV2/sourceKind`, code: "source_binding_mismatch" });
  if (!parsedSource || !artifacts || parsedSource.sourceKind !== value.verificationContractBindingV2.sourceKind) return null;
  return { ...value, verificationContractSourceV2: parsedSource.source, verificationContractBindingV2: { ...value.verificationContractBindingV2 }, verificationCriterionEvidenceV2: { artifactBlobs: artifacts } };
}

function parseContractSource(value, context) {
  if (!isRecord(value) || typeof value.kind !== "string") return reject(context, { path: context?.path ?? "", code: "wrong_type" });
  if (value.kind === "provided_requirement") {
    if (!hasExactKeys(value, ["kind", "contract"])) return reject(context, { path: context?.path ?? "", code: "wrong_constant" });
    const contract = parseContract(value.contract, childContext(context, `${context?.path ?? ""}/contract`));
    return contract ? { sourceKind: value.kind, state: "authoritative", contract, source: { kind: value.kind, contract } } : null;
  }
  if (value.kind !== "linked_issue" && value.kind !== "pr_description") return reject(context, { path: `${context?.path ?? ""}/kind`, code: "wrong_constant" });
  if (!hasExactKeys(value, ["kind", "title", "body"])) return reject(context, { path: context?.path ?? "", code: "wrong_constant" });
  if (!isText(value.title, 500)) return reject(context, { path: `${context?.path ?? ""}/title`, code: textErrorCode(value.title, 500) });
  if (!isText(value.body, 24_000)) return reject(context, { path: `${context?.path ?? ""}/body`, code: textErrorCode(value.body, 24_000) });
  const envelope = extractContractEnvelope(value.title, value.body);
  if (!envelope) return reject(context, { path: `${context?.path ?? ""}/body`, code: "contract_envelope_invalid" });
  const contract = parseContract(envelope, childContext(context, `${context?.path ?? ""}/body`));
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

function parseContract(value, context) {
  if (serializedBytes(value) > 16_384) return reject(context, { path: context?.path ?? "", code: "out_of_bounds" });
  if (!hasExactKeys(value, ["version", "scope", "objectives"])) return reject(context, { path: context?.path ?? "", code: "wrong_constant" });
  if (value.version !== 2) return reject(context, { path: `${context?.path ?? ""}/version`, code: "wrong_constant" });
  if (value.scope !== "complete_objective_set") return reject(context, { path: `${context?.path ?? ""}/scope`, code: "wrong_constant" });
  if (!Array.isArray(value.objectives) || value.objectives.length < 1 || value.objectives.length > 12) return reject(context, { path: `${context?.path ?? ""}/objectives`, code: "out_of_bounds" });
  const objectiveIds = new Set();
  const criterionIds = new Set();
  const objectives = [];
  let totalCriteria = 0;
  for (let objectiveIndex = 0; objectiveIndex < value.objectives.length; objectiveIndex += 1) {
    const objective = value.objectives[objectiveIndex];
    const objectiveContext = childContext(context, `${context?.path ?? ""}/objectives/${objectiveIndex}`);
    if (!hasExactKeys(objective, ["id", "objective", "criteria"])) return reject(objectiveContext, { path: objectiveContext?.path ?? "", code: "wrong_constant" });
    if (!isIdentifier(objective.id)) return reject(objectiveContext, { path: `${objectiveContext.path}/id`, code: "invalid_identifier" });
    if (!isText(objective.objective, 500)) return reject(objectiveContext, { path: `${objectiveContext.path}/objective`, code: textErrorCode(objective.objective, 500) });
    if (!Array.isArray(objective.criteria) || objective.criteria.length < 1 || objective.criteria.length > 4) return reject(objectiveContext, { path: `${objectiveContext.path}/criteria`, code: "out_of_bounds" });
    if (objectiveIds.has(objective.id)) return reject(objectiveContext, { path: `${objectiveContext.path}/id`, code: "duplicate_identity" });
    objectiveIds.add(objective.id);
    totalCriteria += objective.criteria.length;
    if (totalCriteria > 24) return reject(objectiveContext, { path: `${objectiveContext.path}/criteria`, code: "out_of_bounds" });
    const criteria = [];
    for (let criterionIndex = 0; criterionIndex < objective.criteria.length; criterionIndex += 1) {
      const criterionContext = childContext(objectiveContext, `${objectiveContext.path}/criteria/${criterionIndex}`);
      const criterion = parseCriterion(objective.criteria[criterionIndex], criterionContext);
      if (!criterion) return null;
      if (criterionIds.has(criterion.id)) return reject(criterionContext, { path: `${criterionContext.path}/id`, code: "duplicate_identity" });
      criterionIds.add(criterion.id);
      criteria.push(criterion);
    }
    objectives.push({ id: objective.id, objective: objective.objective, criteria });
  }
  return { version: 2, scope: "complete_objective_set", objectives };
}

function parseCriterion(value, context) {
  if (!isRecord(value)) return reject(context, { path: context?.path ?? "", code: "wrong_type" });
  if (!isIdentifier(value.id)) return reject(context, { path: `${context?.path ?? ""}/id`, code: "invalid_identifier" });
  if (!isText(value.label, 240)) return reject(context, { path: `${context?.path ?? ""}/label`, code: textErrorCode(value.label, 240) });
  if (value.type === "absence") {
    if (!hasExactKeys(value, ["id", "type", "label", "prohibitedKind", "scope"]) || value.prohibitedKind !== "path_change") return reject(context, { path: context?.path ?? "", code: "wrong_constant" });
    if (!Array.isArray(value.scope) || value.scope.length < 1 || value.scope.length > 8) return reject(context, { path: `${context?.path ?? ""}/scope`, code: "out_of_bounds" });
    for (let index = 0; index < value.scope.length; index += 1) {
      const scope = value.scope[index];
      const path = `${context?.path ?? ""}/scope/${index}`;
      if (!hasExactKeys(scope, ["kind", "path"]) || (scope.kind !== "exact" && scope.kind !== "prefix")) return reject(context, { path, code: "wrong_constant" });
      if (!isSafePath(scope.path) || scope.kind === "prefix" && !scope.path.endsWith("/")) return reject(context, { path: `${path}/path`, code: "invalid_safe_path" });
    }
    return { id: value.id, type: "absence", label: value.label, prohibitedKind: "path_change", scope: value.scope.map((scope) => ({ kind: scope.kind, path: scope.path })) };
  }
  if (value.type === "artifact") {
    if (!hasExactKeys(value, ["id", "type", "label", "paths", "artifact"]) || !isRecord(value.artifact)) return reject(context, { path: context?.path ?? "", code: "wrong_constant" });
    if (!Array.isArray(value.paths) || value.paths.length < 1 || value.paths.length > 16) return reject(context, { path: `${context?.path ?? ""}/paths`, code: "out_of_bounds" });
    for (let index = 0; index < value.paths.length; index += 1) if (!isSafePath(value.paths[index])) return reject(context, { path: `${context?.path ?? ""}/paths/${index}`, code: "invalid_safe_path" });
    if (value.artifact.kind === "documentation_literal" && hasExactKeys(value.artifact, ["kind", "literal"]) && isText(value.artifact.literal, 200)) return { id: value.id, type: "artifact", label: value.label, paths: [...value.paths], artifact: { kind: "documentation_literal", literal: value.artifact.literal } };
    if (value.artifact.kind === "test_case" && hasExactKeys(value.artifact, ["kind", "testId"]) && isText(value.artifact.testId, 200)) return { id: value.id, type: "artifact", label: value.label, paths: [...value.paths], artifact: { kind: "test_case", testId: value.artifact.testId } };
    if (value.artifact.kind === "workflow_job" && hasOnlyKeys(value.artifact, ["kind", "workflowName", "jobName", "runtimeName", "runtimeVersion", "packageScript"]) && isText(value.artifact.workflowName, 200) && isText(value.artifact.jobName, 200) && isOptionalString(value.artifact.runtimeName, 200) && isOptionalString(value.artifact.runtimeVersion, 200) && isOptionalString(value.artifact.packageScript, 200)) return { id: value.id, type: "artifact", label: value.label, paths: [...value.paths], artifact: { ...value.artifact } };
    return reject(context, { path: `${context?.path ?? ""}/artifact`, code: "wrong_constant" });
  }
  if (value.type === "return_value") {
    if (!hasExactKeys(value, ["id", "type", "label", "adapter", "cases"]) || !isAdapter(value.adapter)) return reject(context, { path: context?.path ?? "", code: "wrong_constant" });
    if (!Array.isArray(value.cases) || value.cases.length < 1 || value.cases.length > 8) return reject(context, { path: `${context?.path ?? ""}/cases`, code: "out_of_bounds" });
    if (!value.cases.every(isReturnCase)) return reject(context, { path: `${context?.path ?? ""}/cases`, code: "wrong_constant" });
    return { id: value.id, type: "return_value", label: value.label, adapter: { ...value.adapter }, cases: value.cases.map((item) => ({ ...item })) };
  }
  return reject(context, { path: `${context?.path ?? ""}/type`, code: "wrong_constant" });
}

function parseArtifacts(value, context) {
  if (!hasExactKeys(value, ["artifactBlobs"])) return reject(context, { path: context?.path ?? "", code: "wrong_constant" });
  if (!Array.isArray(value.artifactBlobs) || value.artifactBlobs.length > 8) return reject(context, { path: `${context?.path ?? ""}/artifactBlobs`, code: "out_of_bounds" });
  const paths = new Set();
  const artifacts = [];
  for (let index = 0; index < value.artifactBlobs.length; index += 1) {
    const blob = value.artifactBlobs[index];
    const path = `${context?.path ?? ""}/artifactBlobs/${index}`;
    if (!hasOnlyKeys(blob, ["path", "headSha", "content"])) return reject(context, { path, code: "wrong_constant" });
    if (!isSafePath(blob.path)) return reject(context, { path: `${path}/path`, code: "invalid_safe_path" });
    if (!isOptionalGitSha(blob.headSha)) return reject(context, { path: `${path}/headSha`, code: "invalid_sha" });
    if (!isText(blob.content, MAX_ARTIFACT_BYTES)) return reject(context, { path: `${path}/content`, code: textErrorCode(blob.content, MAX_ARTIFACT_BYTES) });
    if (paths.has(blob.path)) return reject(context, { path: `${path}/path`, code: "duplicate_identity" });
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

function missingRequiredCoverage(summary) {
  const names = new Set(summary.entries.filter((entry) => entry.count > 0).map((entry) => entry.name));
  return [...REQUIRED_EVIDENCE_COVERAGE, ...REQUIRED_BOUNDARY_COVERAGE].filter((name) => !names.has(name));
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

function isBinding(value, context) {
  if (!hasExactKeys(value, ["sourceKind", "sourceIdentity", "sourceContent", "headSha", "baseSha"])) return reject(context, { path: context?.path ?? "", code: "wrong_constant" });
  if (!["provided_requirement", "linked_issue", "pr_description"].includes(value.sourceKind)) return reject(context, { path: `${context?.path ?? ""}/sourceKind`, code: "wrong_constant" });
  if (!isText(value.sourceIdentity, 500)) return reject(context, { path: `${context?.path ?? ""}/sourceIdentity`, code: textErrorCode(value.sourceIdentity, 500) });
  if (!isText(value.sourceContent, 24_000)) return reject(context, { path: `${context?.path ?? ""}/sourceContent`, code: textErrorCode(value.sourceContent, 24_000) });
  if (!isGitSha(value.headSha)) return reject(context, { path: `${context?.path ?? ""}/headSha`, code: "invalid_sha" });
  if (!isGitSha(value.baseSha)) return reject(context, { path: `${context?.path ?? ""}/baseSha`, code: "invalid_sha" });
  return true;
}

function isSourceProvenance(value, context) {
  if (!hasOnlyKeys(value, ["version", "origin", "headSha", "baseSha", "changedFileInventory", "executionSuites", "evidenceCapturedAt", "inputFingerprint"])) return reject(context, { path: context?.path ?? "", code: "wrong_constant" });
  if (value.version !== 1) return reject(context, { path: `${context?.path ?? ""}/version`, code: "wrong_constant" });
  if (!["github_snapshot", "pasted_evidence", "demo"].includes(value.origin)) return reject(context, { path: `${context?.path ?? ""}/origin`, code: "wrong_constant" });
  if (!isOptionalGitSha(value.headSha)) return reject(context, { path: `${context?.path ?? ""}/headSha`, code: "invalid_sha" });
  if (!isOptionalGitSha(value.baseSha)) return reject(context, { path: `${context?.path ?? ""}/baseSha`, code: "invalid_sha" });
  if (!isText(value.evidenceCapturedAt, 100)) return reject(context, { path: `${context?.path ?? ""}/evidenceCapturedAt`, code: textErrorCode(value.evidenceCapturedAt, 100) });
  if (!hasExactKeys(value.inputFingerprint, ["version", "algorithm", "value", "coverage"])) return reject(context, { path: `${context?.path ?? ""}/inputFingerprint`, code: "wrong_constant" });
  if (value.inputFingerprint.version !== 1 || value.inputFingerprint.algorithm !== "sha256" || !["github_metadata", "pasted_metadata", "demo_fixture"].includes(value.inputFingerprint.coverage)) return reject(context, { path: `${context?.path ?? ""}/inputFingerprint`, code: "wrong_constant" });
  if (!isDigest(value.inputFingerprint.value)) return reject(context, { path: `${context?.path ?? ""}/inputFingerprint/value`, code: "invalid_sha" });
  if (value.changedFileInventory !== undefined) {
    const path = `${context?.path ?? ""}/changedFileInventory`;
    if (!hasOnlyKeys(value.changedFileInventory, ["version", "completeness", "headSha"]) || value.changedFileInventory.version !== 1 || !["complete", "incomplete"].includes(value.changedFileInventory.completeness)) return reject(context, { path, code: "wrong_constant" });
    if (!isOptionalGitSha(value.changedFileInventory.headSha)) return reject(context, { path: `${path}/headSha`, code: "invalid_sha" });
  }
  return true;
}

function isChangedFile(value, context) {
  if (!hasOnlyKeys(value, ["path", "previousPath", "additions", "deletions", "status", "patch"])) return reject(context, { path: context?.path ?? "", code: "wrong_constant" });
  if (!isSafePath(value.path)) return reject(context, { path: `${context?.path ?? ""}/path`, code: "invalid_safe_path" });
  if (!isOptionalSafePath(value.previousPath)) return reject(context, { path: `${context?.path ?? ""}/previousPath`, code: "invalid_safe_path" });
  if (!isOptionalNonNegative(value.additions) || !isOptionalNonNegative(value.deletions)) return reject(context, { path: context?.path ?? "", code: "out_of_bounds" });
  if (value.status !== undefined && !["added", "modified", "removed", "renamed"].includes(value.status)) return reject(context, { path: `${context?.path ?? ""}/status`, code: "wrong_constant" });
  if (!isOptionalString(value.patch, 12_000)) return reject(context, { path: `${context?.path ?? ""}/patch`, code: textErrorCode(value.patch, 12_000) });
  return true;
}

function isActiveV2Report(value) {
  return hasExactKeys(value, ["reportSchemaVersion", "verificationContract"]) && value.reportSchemaVersion === "verification-report.v2" &&
    hasExactKeys(value.verificationContract, ["state"]) && ["authoritative", "author_claim"].includes(value.verificationContract.state);
}

function parsePastedOverride(value, context) {
  if (!hasOnlyKeys(value, OVERRIDE_KEYS)) return reject(context, { path: context?.path ?? "", code: "wrong_constant" });
  for (const key of ["prUrl", "taskText", "prDescription", "changedFiles", "checks", "logs"]) {
    const max = key === "logs" ? 24_000 : key === "changedFiles" ? 12_000 : 8_000;
    if (!isOptionalString(value[key], max)) return reject(context, { path: `${context?.path ?? ""}/${key}`, code: textErrorCode(value[key], max) });
  }
  if (!isStringArray(value.inputLimitations, 32, 1_000)) return reject(context, { path: `${context?.path ?? ""}/inputLimitations`, code: "out_of_bounds" });
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

function childContext(context, path, caseIndex = context?.caseIndex) {
  return { document: context?.document, caseIndex, path, errors: context?.errors };
}

function reject(context, error) {
  if (context?.errors) context.errors.push({
    document: context.document,
    ...(Number.isInteger(context.caseIndex) ? { caseIndex: context.caseIndex } : {}),
    ...error,
    path: (error.path ?? context.path ?? "").slice(0, 256)
  });
  return null;
}

function boundedErrors(errors) {
  const seen = new Map();
  for (const error of errors) seen.set(`${error.document}\u0000${error.caseIndex ?? -1}\u0000${error.path}\u0000${error.code}`, error);
  return [...seen.values()].sort((left, right) => left.document.localeCompare(right.document) || (left.caseIndex ?? -1) - (right.caseIndex ?? -1) || left.path.localeCompare(right.path) || left.code.localeCompare(right.code)).slice(0, 50);
}

function textErrorCode(value, max) {
  if (typeof value !== "string") return "wrong_type";
  if (value.includes("\0")) return "wrong_constant";
  return Buffer.byteLength(value, "utf8") > max ? "out_of_bounds" : "wrong_constant";
}

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
