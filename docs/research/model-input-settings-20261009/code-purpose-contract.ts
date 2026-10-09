import Ajv from 'ajv';
import { createHash } from 'node:crypto';
import { containsSecretPattern } from './redact';
export const purposeContentHash = (text: string) => createHash("sha256").update(text).digest("hex");
export const purposeHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type PurposeMode = 'off' | 'shadow' | 'advisory';
export type Achievement = 'fulfilled' | 'partial' | 'unclear' | 'not_fulfilled';
export interface PurposeClause {
    id: string;
    sourceRefs: string[];
    canonicalRequirementIds: string[];
    expectedObservable: string;
    conditions: string[];
    exceptions: string[];
    obligation: 'required' | 'optional' | 'ambiguous';
    evidenceNeed: 'static' | 'behavioral' | 'execution_claim' | 'measurement';
}
export interface PurposeSpec {
    version: 1;
    sourceBundleHash: string;
    headSha: string;
    baseSha: string;
    goals: {
        id: string;
        sourceRefs: string[];
        authority: 'authoritative' | 'author_claim';
        clauses: PurposeClause[];
    }[];
    unprocessedSourceRefs: string[];
    ambiguities: string[];
}
export interface PurposeEvidence {
    id: string;
    repositoryHash: string;
    path: string;
    side: 'head' | 'base';
    revision: string;
    startLine: number;
    endLine: number;
    rawHash: string;
    contentHash: string;
    content: string;
    completeness: 'complete_interval';
    collection: 'exact_blob';
    clauseIds: string[];
}
export interface PurposeClauseResult {
    clauseId: string;
    implementation: 'supports' | 'contradicts' | 'unknown';
    testRelation: 'relevant' | 'inadequate' | 'unknown' | 'not_required';
    execution: 'checked_pass' | 'checked_fail' | 'reported_pass' | 'reported_fail' | 'not_observed' | 'not_required';
    evidenceRefs: string[];
    counterEvidenceRefs: string[];
    openQuestions: string[];
    reasonCodes: string[];
    criterionEvidenceRefs: string[];
}
export interface PurposeObservation {
    basis: 'source_text' | 'model_interpretation';
    text: string;
    evidenceRefs: string[];
}
export interface PurposeFinalProposal {
    clauses: Array<Omit<AssessmentProposal['clauses'][number], 'openQuestions'> & {
        changeObservations: PurposeObservation[];
        testObservations: PurposeObservation[];
        remainingQuestions: {text: string; evidenceRefs: string[]}[];
    }>;
}
export interface PurposeCoverage {
    omittedEvidence: Array<{id: string; path: string; side: 'head' | 'base'; revision: string; startLine: number; endLine: number; reason: 'not_selected' | 'packet_budget'}>;
    readOutcomes: Array<{round: number; kind: string; targetId: string; startLine: number; endLine: number; evidenceRefs: string[]; outcome: 'available' | 'unavailable' | 'metadata_only' | 'rejected'}>;
    omittedToolResults: number[];
}
/** Request-local private detail only. Portable/persisted summary never contains these observations. */
export interface PurposeFacts {
    version: 1;
    clauses: Array<PurposeFinalProposal['clauses'][number] & {purpose: string}>;
    coverage: PurposeCoverage;
}
export interface PurposeAssessment {
    version: 1;
    scope: 'stated_purpose_at_snapshot';
    subjectDigest: string;
    state: 'complete' | 'limited' | 'unavailable';
    goals: {
        goalId: string;
        authority: 'authoritative' | 'author_claim';
        clauseResults: PurposeClauseResult[];
        achievement: Achievement;
        assurance: 'deterministic_checked' | 'evidence_assessed' | 'insufficient';
    }[];
    overall: Achievement;
    limitations: string[];
    evidenceIndex: Omit<PurposeEvidence, 'content' | 'clauseIds'>[];
    traceDigest: string;
    facts?: PurposeFacts;
}
/** Portable, no source spans, hashes, repository paths, raw code or model rationale. */
export interface PurposeAssessmentSummary {
    version: 1;
    flow?: 'explore_final_v1';
    scope: 'stated_purpose_at_snapshot';
    state: PurposeAssessment['state'];
    overall: Achievement;
    goals: {
        goalId: string;
        authority: 'authoritative' | 'author_claim';
        achievement: Achievement;
        assurance: 'deterministic_checked' | 'evidence_assessed' | 'insufficient';
        implementation: 'supports' | 'contradicts' | 'unknown';
        testRelation: 'relevant' | 'inadequate' | 'unknown' | 'not_required';
        execution: PurposeClauseResult['execution'];
    }[];
    limitations: string[];
}
export const str = { type: 'string', maxLength: 600, minLength: 1 };
export const strings = (max = 32) => ({ type: 'array', items: str, maxItems: max, uniqueItems: true });
export const enumeration = (...values: string[]) => ({ type: 'string', enum: values });
export const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const array = (items: unknown, maxItems: number) => ({ type: 'array', items, maxItems });
const ajv = new Ajv({ allErrors: false });
export function contract<T>(schema: object) { const validate = ajv.compile(schema); return (value: unknown): value is T => Boolean(validate(value)) && !containsSecretPattern(JSON.stringify(value)); }
export const purposeProposalSchema = object({ goals: array(object({ sourceRefs: strings(), clauses: array(object({ sourceRefs: strings(), expectedObservable: str, conditions: strings(8), exceptions: strings(8), obligation: enumeration('required', 'optional', 'ambiguous'), evidenceNeed: enumeration('static', 'behavioral', 'execution_claim', 'measurement') }), 32) }), 16), contextRefs: strings(256), unprocessedSourceRefs: strings(256), ambiguities: strings(32) });
export interface PurposeProposal {
    goals: {
        sourceRefs: string[];
        clauses: Omit<PurposeClause, 'id' | 'canonicalRequirementIds'>[];
    }[];
    contextRefs: string[];
    unprocessedSourceRefs: string[];
    ambiguities: string[];
}
export const isPurposeProposal = contract<PurposeProposal>(purposeProposalSchema);
const implementation = enumeration('supports', 'contradicts', 'unknown'), testRelation = enumeration('relevant', 'inadequate', 'unknown', 'not_required');
export const readSchema = object({ path: str, side: enumeration('head', 'base'), startLine: { type: 'integer', minimum: 1, maximum: 1000000 }, endLine: { type: 'integer', minimum: 1, maximum: 1000000 }, clauseId: str, reason: str });
export interface PurposeReadRequest {
    path: string;
    side: 'head' | 'base';
    startLine: number;
    endLine: number;
    clauseId: string;
    reason: string;
}
export const isPurposeReadRequest = contract<PurposeReadRequest>(readSchema);
export const assessmentProposalSchema = object({ clauses: array(object({ clauseId: str, implementation, testRelation, evidenceRefs: strings(16), counterEvidenceRefs: strings(16), openQuestions: strings(8) }), 32), readRequests: array(readSchema, 8), searchRequests: array(object({ query: str, paths: strings(8), clauseId: str }), 8) });
export interface AssessmentProposal {
    clauses: Omit<PurposeClauseResult, 'execution' | 'reasonCodes' | 'criterionEvidenceRefs'>[];
    readRequests: PurposeReadRequest[];
    searchRequests: {
        query: string;
        paths: string[];
        clauseId: string;
    }[];
}
export const isAssessmentProposal = contract<AssessmentProposal>(assessmentProposalSchema);
const observationSchema = object({ basis: enumeration('source_text', 'model_interpretation'), text: str, evidenceRefs: {...strings(16), minItems: 1} });
/** Final interpretation has no tools, execution status, authority or overall grade fields. */
export const purposeFinalSchema = object({clauses: array(object({clauseId: str, implementation, testRelation, evidenceRefs: strings(16), counterEvidenceRefs: strings(16), changeObservations: array(observationSchema, 8), testObservations: array(observationSchema, 8), remainingQuestions: array(object({text: str, evidenceRefs: strings(16)}), 8)}), 32)});
/** Wire constraint only: local source closure remains the trust boundary. */
export function purposeFinalRequestSchema(spec: unknown, evidence: unknown): object {
    const schema: any = structuredClone(purposeFinalSchema);
    const clauseIds = (spec as PurposeSpec | undefined)?.goals?.flatMap(g => g.clauses.map(c => c.id)) ?? [];
    const evidenceIds = Array.isArray(evidence) ? evidence.map(e => e.id) : [];
    const row = schema.properties.clauses.items.properties;
    row.clauseId = clauseIds.length ? enumeration(...clauseIds) : str;
    schema.properties.clauses.minItems = clauseIds.length;
    schema.properties.clauses.maxItems = clauseIds.length;
    const refs = () => evidenceIds.length ? {...strings(16), items: enumeration(...evidenceIds)} : {...strings(16), maxItems: 0};
    row.evidenceRefs = refs(); row.counterEvidenceRefs = refs();
    for (const key of ['changeObservations', 'testObservations']) {
        row[key].items.properties.evidenceRefs = evidenceIds.length ? {...refs(), minItems: 1} : refs();
        if (!evidenceIds.length) row[key].maxItems = 0;
    }
    row.remainingQuestions.items.properties.evidenceRefs = refs();
    return schema;
}
export const isPurposeFinalProposal = contract<PurposeFinalProposal>(purposeFinalSchema);
export function validatePurposeFinal(value: unknown, spec: PurposeSpec, evidence: PurposeEvidence[]): PurposeFinalProposal {
    if (!isPurposeFinalProposal(value)) throw new Error('purpose_final_schema');
    const ids = new Set(spec.goals.flatMap(g => g.clauses.map(c => c.id))), sent = new Map(evidence.map(e => [e.id, e]));
    if (value.clauses.length !== ids.size || new Set(value.clauses.map(c => c.clauseId)).size !== ids.size || value.clauses.some(c => !ids.has(c.clauseId))) throw new Error('purpose_final_clause_reference');
    for (const c of value.clauses) {
        const observations = [...c.changeObservations, ...c.testObservations];
        const refs = [...c.evidenceRefs, ...c.counterEvidenceRefs, ...observations.flatMap(o => o.evidenceRefs), ...c.remainingQuestions.flatMap(q => q.evidenceRefs)];
        if (refs.some(id => !sent.has(id))) throw new Error('purpose_final_reference');
        for (const o of observations) if (o.basis === 'source_text' && (o.evidenceRefs.length !== 1 || !sent.get(o.evidenceRefs[0])!.content.includes(o.text))) throw new Error('purpose_final_quote');
    }
    return value;
}

export const checkerSchema = object({ disputes: array(object({ clauseId: str, evidenceRefs: strings(16), reason: enumeration('condition_missing', 'unsupported_relation', 'possible_counterexample') }), 32) });
export interface CheckerProposal {
    disputes: {
        clauseId: string;
        evidenceRefs: string[];
        reason: string;
    }[];
}
export const isCheckerProposal = contract<CheckerProposal>(checkerSchema);
const achievement = enumeration('fulfilled', 'partial', 'unclear', 'not_fulfilled'), assurance = enumeration('deterministic_checked', 'evidence_assessed', 'insufficient'), authority = enumeration('authoritative', 'author_claim'), execution = enumeration('checked_pass', 'checked_fail', 'reported_pass', 'reported_fail', 'not_observed', 'not_required');
const limitation = enumeration('localization_partial', 'localization_invalid', 'localization_read_budget', 'localization_source_budget', 'localization_packet_budget', 'locator_inventory_budget', 'case_execution_not_verified', 'normalized_manifest_unavailable', 'patch_unavailable', 'patch_index_budget', 'raw_patch_index_unavailable', 'source_unprocessed', 'source_ambiguous', 'search_supplied_no_hit', 'reassessment_budget', 'additional_evidence_uncollected', 'initial_batch_budget', 'checker_budget', 'checker_dispute', 'read_rejected', 'source_unavailable', 'read_budget', 'source_binding_unavailable', 'source_budget', 'interval_unavailable', 'artifact_budget', 'source_read_failed', 'limitation_overflow');
const summarySchema = object({ version: { const: 1 }, scope: { const: 'stated_purpose_at_snapshot' }, state: enumeration('complete', 'limited', 'unavailable'), overall: achievement, goals: array(object({ goalId: { type: 'string', pattern: '^pg_[a-f0-9]{24}$' }, authority, achievement, assurance, implementation, testRelation, execution }), 16), limitations: array(limitation, 32) });
const summaryShape = contract<PurposeAssessmentSummary>({...summarySchema, properties: {...summarySchema.properties, flow: enumeration('explore_final_v1')}});
export function isPurposeSummary(value:unknown):value is PurposeAssessmentSummary {
 if(!summaryShape(value)||new Set(value.goals.map(g=>g.goalId)).size!==value.goals.length)return false;
 const states=value.goals.map(g=>g.achievement);
 const overall=states.includes('not_fulfilled')?'not_fulfilled':states.length&&states.every(s=>s==='fulfilled')?'fulfilled':states.some(s=>s==='partial'||s==='fulfilled')?'partial':'unclear';
 return value.overall===overall&&value.goals.every(g=>g.achievement!=='fulfilled'||g.assurance==='deterministic_checked');
}
export function projectPurposeSummary(a: PurposeAssessment): PurposeAssessmentSummary {
    const summary: PurposeAssessmentSummary = { version: 1, ...(a.facts ? {flow: 'explore_final_v1' as const} : {}), scope: a.scope, state: a.state, overall: a.overall, goals: a.goals.map(g => ({ goalId: g.goalId, authority: g.authority, achievement: g.achievement, assurance: g.assurance, implementation: g.clauseResults.some(c => c.implementation === 'contradicts') ? 'contradicts' : g.clauseResults.some(c => c.implementation === 'supports') ? 'supports' : 'unknown', testRelation: g.clauseResults.some(c => c.testRelation === 'inadequate') ? 'inadequate' : g.clauseResults.some(c => c.testRelation === 'relevant') ? 'relevant' : 'unknown', execution: g.clauseResults.some(c => c.execution === 'checked_fail') ? 'checked_fail' : g.clauseResults.every(c => c.execution === 'not_required') ? 'not_required' : g.clauseResults.every(c => c.execution === 'checked_pass' || c.execution === 'not_required') ? 'checked_pass' : 'not_observed' })), limitations: [...a.limitations] };
    if (!isPurposeSummary(summary))
        throw new Error('purpose_summary_invalid');
    return summary;
}
