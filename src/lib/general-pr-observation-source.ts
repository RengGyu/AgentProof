import { createHash } from "node:crypto";
import { classifyGeneralPrClaimsV1 } from "./general-pr-claim-classifier";
import { buildGeneralPrChangeObservationV2 } from "./general-pr-change-observation";
import {
  buildGeneralPrExecutionEnvelopeV2,
  type GeneralPrExecutionEnvelopeV2
} from "./general-pr-execution-envelope";
import { parseGeneralPrStructureV1, type GeneralPrStructuralKindV1 } from "./general-pr-structure";
import { redactSecrets } from "./redact";
import type { PullRequestInput } from "./types";
export type { GeneralPrChangeClusterV2, GeneralPrChangeFactV2 } from "./general-pr-change-observation";
import type { GeneralPrChangeClusterV2, GeneralPrChangeFactV2 } from "./general-pr-change-observation";

export const GENERAL_PR_OBSERVATION_MAX_SOURCE_VIEW_BYTES = 64_000;

export type GeneralPrSourceAuthorityV2 = "authoritative" | "author_claim";
export type GeneralPrSourceKindV2 = "provided_requirement" | "linked_issue" | "pr_title" | "pr_body";
export type GeneralPrSourceAdmissionTierV1 = "primary" | "fallback" | "context";
export type GeneralPrClaimRoleV2 =
  | "objective_candidate"
  | "problem_observation"
  | "implementation_claim"
  | "test_claim"
  | "scope_exclusion"
  | "known_limitation"
  | "risk_or_revert"
  | "follow_up"
  | "template_or_process"
  | "supporting_context"
  | "mixed_or_ambiguous";

export interface GeneralPrSourceUnitV2 {
  version: 2;
  id: string;
  kind: GeneralPrSourceKindV2;
  authority: GeneralPrSourceAuthorityV2;
  admissionTier: GeneralPrSourceAdmissionTierV1;
  sourceIdentityHash: string;
  rawSourceDigest: string;
  sourceContentHash: string;
  roleCeiling: "objective" | "context" | "policy_only";
  structuralSpanIds: string[];
}

export interface GeneralPrSemanticSpanV2 {
  version: 2;
  id: string;
  sourceUnitId: string;
  structuralKind: "title" | GeneralPrStructuralKindV1;
  start: number;
  end: number;
  textHash: string;
  authorityCeiling: GeneralPrSourceAuthorityV2;
  deterministicRole: GeneralPrClaimRoleV2 | "unresolved";
}

export interface GeneralPrTestArtifactV2 {
  version: 2;
  id: string;
  evidenceRef: string;
  subjectDigest: string;
  kind: "changed_test" | "runner_manifest" | "coverage_manifest";
  completeness: "complete" | "incomplete" | "unknown";
}

export interface GeneralPrEvidenceAtomV2 {
  version: 2;
  id: string;
  kind: "change" | "test_artifact" | "check" | "execution";
  subjectDigest: string;
  contentDigest: string;
  completeness: "complete" | "incomplete" | "unknown";
}

export interface GeneralPrObservationSeedV2 {
  version: 2;
  seedHash: string;
  parseState: "complete" | "incomplete";
  repositoryIdentityHash: string;
  baseSha: string | null;
  headSha: string | null;
  testedSubject: { kind: "head" | "test_merge" | "merge_group" | "unknown"; sha: string | null };
  completeness: "complete" | "incomplete" | "unavailable";
  sources: GeneralPrSourceUnitV2[];
  spans: GeneralPrSemanticSpanV2[];
  changeFacts: GeneralPrChangeFactV2[];
  changeClusters: GeneralPrChangeClusterV2[];
  testArtifacts: GeneralPrTestArtifactV2[];
  executions: GeneralPrExecutionEnvelopeV2[];
  evidenceAtoms: GeneralPrEvidenceAtomV2[];
}

export type GeneralPrObservationSeedValidation = { valid: true } | { valid: false; errors: string[] };

export function buildGeneralPrObservationSeedV2(input: PullRequestInput): GeneralPrObservationSeedV2 {
  const repositoryIdentityHash = digest({ domain: "agentproof.general-pr.repository.v2", url: input.url ?? "", sourceIdentity: input.requirementSourceIdentityHash ?? "" });
  const baseSha = input.sourceProvenance?.baseSha ?? null;
  const headSha = input.sourceProvenance?.headSha ?? null;
  const sourceCompleteness = input.sourceProvenance?.changedFileInventory?.completeness;
  const completeness: GeneralPrObservationSeedV2["completeness"] = input.sourceProvenance?.origin === "github_snapshot" && sourceCompleteness === "complete" && baseSha && headSha
    ? "complete"
    : input.sourceProvenance ? "incomplete" : "unavailable";
  const testedSubject = { kind: headSha ? "head" as const : "unknown" as const, sha: headSha };
  const subjectDigest = digest({ domain: "agentproof.general-pr.subject.v2", repositoryIdentityHash, baseSha, headSha, testedSubject });
  const sourceInputs = buildSourceInputs(input);
  const sourceViews = sourceInputs.map((candidate) => {
    const supported = candidate.supported && isSupportedSourceView(candidate.redacted);
    return {
      candidate,
      supported,
      structure: supported && candidate.kind !== "pr_title" ? parseGeneralPrStructureV1(candidate.redacted) : null
    };
  });
  const spans: GeneralPrSemanticSpanV2[] = [];
  const sources = sourceViews.map(({ candidate, supported, structure }, sourceIndex) => {
    const sourceId = `gpsrc_${digest({ domain: "agentproof.general-pr.source-id.v2", kind: candidate.kind, raw: candidate.rawDigest, content: candidate.contentDigest }).slice(0, 24)}`;
    const sourceSpans = !supported
      ? []
      : candidate.kind === "pr_title"
      ? titleSpan(candidate, sourceId, sourceIndex)
      : parsedSpans(candidate, sourceId, sourceIndex, structure!);
    spans.push(...sourceSpans);
    return {
      version: 2 as const,
      id: sourceId,
      kind: candidate.kind,
      authority: candidate.authority,
      admissionTier: candidate.admissionTier,
      sourceIdentityHash: candidate.identityHash,
      rawSourceDigest: candidate.rawDigest,
      sourceContentHash: candidate.contentDigest,
      roleCeiling: candidate.roleCeiling,
      structuralSpanIds: sourceSpans.map((span) => span.id)
    };
  });
  const parseState: GeneralPrObservationSeedV2["parseState"] = sourceViews.every(({ candidate, supported, structure }) => supported && (candidate.kind === "pr_title" || structure?.parseState === "complete"))
    ? "complete"
    : "incomplete";
  const changeObservation = buildGeneralPrChangeObservationV2(input.changedFiles, {
    inventoryCompleteness: completeness === "unavailable" ? "unknown" : completeness
  });
  const changeFacts = changeObservation.facts;
  const changeClusters = changeObservation.clusters;
  const testArtifacts = changeFacts
    .filter((fact) => fact.roleCandidates.includes("test"))
    .map((fact) => ({ version: 2 as const, id: `gpta_${digest({ domain: "agentproof.general-pr.test-artifact.v2", fileRef: fact.fileRef, subjectDigest }).slice(0, 24)}`, evidenceRef: fact.fileRef, subjectDigest, kind: "changed_test" as const, completeness: fact.completeness }));
  const executions = input.checks.map((check) => buildGeneralPrExecutionEnvelopeV2({
    repositoryIdentityHash,
    prNumber: pullRequestNumber(input.url),
    subjectKind: headSha ? "head" : "unknown",
    subjectSha: headSha,
    baseSha,
    headSha,
    subjectParents: headSha ? [headSha] : [],
    workflowPath: check.workflowExecutionIdentity?.workflowPath ?? null,
    workflowRef: check.workflowExecutionIdentity ? String(check.workflowExecutionIdentity.workflowId) : null,
    // Current collector does not bind the workflow blob at the event-mapped
    // immutable SHA, so this is intentionally incomplete.
    workflowBlobDigest: null,
    workflowBlobSourceSha: null,
    runId: check.workflowExecutionIdentity ? String(check.workflowExecutionIdentity.runId) : null,
    runAttempt: check.workflowExecutionIdentity?.runAttempt ?? null,
    jobId: check.workflowExecutionIdentity ? String(check.workflowExecutionIdentity.jobId) : null,
    producerAppId: null,
    event: null,
    collectionComplete: false,
    jobPaginationComplete: false,
    resultStatus: check.status === "passed" || check.status === "failed" ? check.status : "unknown"
  }).envelope);
  const evidenceAtoms: GeneralPrEvidenceAtomV2[] = [
    ...changeFacts.map((fact) => ({ version: 2 as const, id: `gpea_${digest({ domain: "agentproof.general-pr.change-atom.v2", fileRef: fact.fileRef, subjectDigest }).slice(0, 24)}`, kind: "change" as const, subjectDigest, contentDigest: digest({ domain: "agentproof.general-pr.change-content.v2", fact }), completeness: fact.completeness })),
    ...testArtifacts.map((artifact) => ({ version: 2 as const, id: `gpea_${digest({ domain: "agentproof.general-pr.test-atom.v2", artifact: artifact.id }).slice(0, 24)}`, kind: "test_artifact" as const, subjectDigest, contentDigest: digest({ domain: "agentproof.general-pr.test-content.v2", artifact }), completeness: artifact.completeness })),
    ...input.checks.map((check, index) => ({ version: 2 as const, id: `gpea_${digest({ domain: "agentproof.general-pr.check-atom.v2", index, subjectDigest, name: check.name, status: check.status }).slice(0, 24)}`, kind: "check" as const, subjectDigest, contentDigest: digest({ domain: "agentproof.general-pr.check-content.v2", name: check.name, status: check.status }), completeness: completeness === "complete" ? "complete" as const : "unknown" as const })),
    ...executions.map((execution, index) => ({ version: 2 as const, id: `gpea_${digest({ domain: "agentproof.general-pr.execution-atom.v2", index, subjectDigest, execution }).slice(0, 24)}`, kind: "execution" as const, subjectDigest, contentDigest: digest({ domain: "agentproof.general-pr.execution-content.v2", execution }), completeness: execution.completeness }))
  ];
  const unsigned = {
    version: 2 as const,
    parseState,
    repositoryIdentityHash,
    baseSha,
    headSha,
    testedSubject,
    completeness,
    sources,
    spans,
    changeFacts,
    changeClusters,
    testArtifacts,
    executions,
    evidenceAtoms
  };
  return { ...unsigned, seedHash: digest({ domain: "agentproof.general-pr.seed.v2", seed: unsigned }) };
}

export function validateGeneralPrObservationSeedV2(value: unknown): GeneralPrObservationSeedValidation {
  if (!isRecord(value)) return { valid: false, errors: ["seed must be an object"] };
  const seed = value as Partial<GeneralPrObservationSeedV2>;
  const errors: string[] = [];
  if (seed.version !== 2) errors.push("seed version is invalid");
  if (!isSha(seed.seedHash)) errors.push("seed hash is invalid");
  if (!Array.isArray(seed.sources) || !Array.isArray(seed.spans) || !Array.isArray(seed.changeFacts) || !Array.isArray(seed.changeClusters) || !Array.isArray(seed.testArtifacts) || !Array.isArray(seed.executions) || !Array.isArray(seed.evidenceAtoms)) errors.push("seed collections are invalid");
  if (seed.completeness === "complete" && (!isShaLike(seed.baseSha) || !isShaLike(seed.headSha) || !seed.testedSubject || seed.testedSubject.kind === "unknown" || !isShaLike(seed.testedSubject.sha))) errors.push("complete seed has incomplete identity");
  const sourceIds = new Set<string>();
  for (const source of seed.sources ?? []) {
    if (!isRecord(source) || typeof source.id !== "string" || sourceIds.has(source.id) || !isSha(source.rawSourceDigest) || !isSha(source.sourceContentHash) || !isSha(source.sourceIdentityHash)) errors.push("source binding is invalid");
    else sourceIds.add(source.id);
  }
  const spanIds = new Set<string>();
  const priorEndBySource = new Map<string, number>();
  for (const span of seed.spans ?? []) {
    if (!isRecord(span) || typeof span.id !== "string" || spanIds.has(span.id) || !sourceIds.has(String(span.sourceUnitId)) || !isSha(span.textHash) || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) || span.start < 0 || span.end <= span.start) errors.push("span binding is invalid");
    else {
      const priorEnd = priorEndBySource.get(String(span.sourceUnitId)) ?? -1;
      if (span.start < priorEnd) errors.push("span ranges overlap");
      priorEndBySource.set(String(span.sourceUnitId), Math.max(priorEnd, span.end));
      spanIds.add(span.id);
    }
  }
  if (errors.length > 0) return { valid: false, errors };
  const { seedHash: _seedHash, ...unsigned } = seed as GeneralPrObservationSeedV2;
  if (digest({ domain: "agentproof.general-pr.seed.v2", seed: unsigned }) !== seed.seedHash) return { valid: false, errors: ["seed hash does not match its contents"] };
  return { valid: true };
}

interface SourceInput {
  kind: GeneralPrSourceKindV2;
  authority: GeneralPrSourceAuthorityV2;
  admissionTier: GeneralPrSourceAdmissionTierV1;
  roleCeiling: "objective" | "context" | "policy_only";
  raw: string;
  redacted: string;
  supported: boolean;
  rawDigest: string;
  contentDigest: string;
  identityHash: string;
}

function buildSourceInputs(input: PullRequestInput): SourceInput[] {
  const hasAuthoritativeSource = input.taskText.trim().length > 0;
  const hasLinkedIssue = hasAuthoritativeSource && input.taskSource === "issue";
  const authoritativeKind = input.taskSource === "issue" ? "linked_issue" : "provided_requirement";
  const candidates: Array<{ kind: GeneralPrSourceKindV2; authority: GeneralPrSourceAuthorityV2; admissionTier: GeneralPrSourceAdmissionTierV1; roleCeiling: "objective" | "context" | "policy_only"; text: string }> = [];
  if (hasAuthoritativeSource) candidates.push({ kind: authoritativeKind, authority: "authoritative", admissionTier: "primary", roleCeiling: "objective", text: input.taskText });
  if (input.title.trim()) candidates.push({ kind: "pr_title", authority: "author_claim", admissionTier: hasLinkedIssue ? "fallback" : "primary", roleCeiling: "objective", text: input.title });
  if (input.description.trim()) candidates.push({ kind: "pr_body", authority: "author_claim", admissionTier: hasLinkedIssue ? "fallback" : "primary", roleCeiling: "objective", text: input.description });
  return candidates.map((candidate) => {
    const raw = normalizeNewlines(candidate.text);
    const rawSupported = isSupportedSourceView(raw);
    const redacted = rawSupported ? redactSecrets(raw) : "";
    const supported = rawSupported && isSupportedSourceView(redacted);
    const rawDigest = sha(raw);
    const contentDigest = sha(redacted);
    return {
      kind: candidate.kind,
      authority: candidate.authority,
      admissionTier: candidate.admissionTier,
      roleCeiling: candidate.roleCeiling,
      raw,
      redacted,
      supported,
      rawDigest,
      contentDigest,
      identityHash: candidate.authority === "authoritative" && isSha(input.requirementSourceIdentityHash)
        ? input.requirementSourceIdentityHash
        : digest({ domain: "agentproof.general-pr.source-identity.v2", kind: candidate.kind, rawDigest })
    };
  });
}

function titleSpan(source: SourceInput, sourceId: string, sourceIndex: number): GeneralPrSemanticSpanV2[] {
  if (!source.redacted) return [];
  return [{
    version: 2,
    id: `gpsp_${sourceIndex + 1}_1`,
    sourceUnitId: sourceId,
    structuralKind: "title",
    start: 0,
    end: source.redacted.length,
    textHash: sha(source.redacted),
    authorityCeiling: source.authority,
    deterministicRole: source.roleCeiling === "context"
      ? "supporting_context"
      : looksLikeObjective(source.redacted) ? "objective_candidate" : "supporting_context"
  }];
}

function parsedSpans(source: SourceInput, sourceId: string, sourceIndex: number, structure: ReturnType<typeof parseGeneralPrStructureV1>): GeneralPrSemanticSpanV2[] {
  if (structure.parseState !== "complete") return [];
  const classifications = new Map(classifyGeneralPrClaimsV1(source.redacted, structure).map((item) => [item.structuralSpanId, item]));
  return structure.spans.map((span, index) => ({
    version: 2,
    id: `gpsp_${sourceIndex + 1}_${index + 1}`,
    sourceUnitId: sourceId,
    structuralKind: span.kind,
    start: span.start,
    end: span.end,
    textHash: span.textHash,
    authorityCeiling: source.authority,
    deterministicRole: source.roleCeiling === "context"
      ? demoteContextObjective(toV2Role(classifications.get(span.id)?.role, source.redacted.slice(span.start, span.end), span.excluded))
      : toV2Role(classifications.get(span.id)?.role, source.redacted.slice(span.start, span.end), span.excluded)
  }));
}

function toV2Role(role: string | undefined, text: string, excluded: boolean): GeneralPrClaimRoleV2 | "unresolved" {
  if (excluded) return "template_or_process";
  if (role === "objective_candidate") return "objective_candidate";
  if (role === "problem_observation") return "problem_observation";
  if (role === "change_claim") return "implementation_claim";
  if (role === "test_or_validation_claim") return "test_claim";
  if (role === "mixed_or_unknown") return "mixed_or_ambiguous";
  if (role === "scope_or_follow_up") {
    if (/\bknown limitation|not supported\b/i.test(text)) return "known_limitation";
    if (/\bout of scope\b/i.test(text)) return "scope_exclusion";
    return "follow_up";
  }
  if (role === "process_or_template_meta") return /\brisk|revert\b/i.test(text) ? "risk_or_revert" : "template_or_process";
  if (role === "supporting_context") return "supporting_context";
  return "unresolved";
}

function demoteContextObjective(role: GeneralPrClaimRoleV2 | "unresolved"): GeneralPrClaimRoleV2 | "unresolved" {
  return role === "objective_candidate" ? "supporting_context" : role;
}

function normalizeNewlines(value: string): string { return value.replace(/\r\n/g, "\n"); }
function isSupportedSourceView(value: string): boolean { return Buffer.byteLength(value, "utf8") <= GENERAL_PR_OBSERVATION_MAX_SOURCE_VIEW_BYTES && !hasUnpairedSurrogate(value); }
function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}
function looksLikeObjective(value: string): boolean { return /\b(return|show|display|reject|allow|preserve|create|remove|emit|store|render|use|support)\b/i.test(value); }
function pullRequestNumber(url: string | undefined): number {
  const match = typeof url === "string" ? /\/pull\/(\d+)(?:$|[?#/])/.exec(url) : null;
  const value = Number(match?.[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}
function sha(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function digest(value: unknown): string { return createHash("sha256").update(stableJson(value), "utf8").digest("hex"); }
function stableJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (isRecord(value)) return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`; return JSON.stringify(value); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function isSha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function isShaLike(value: unknown): value is string { return typeof value === "string" && /^[a-zA-Z0-9._-]{2,128}$/.test(value); }
