import { createHash } from 'node:crypto';
import { containsSecretPattern } from './redact';
import { str, strings, enumeration, object, array, contract } from './purpose-schema';
export { str, strings, enumeration, object, array, contract } from './purpose-schema';
import { isPurposeSummary } from './purpose-summary';
export { isPurposeSummary } from './purpose-summary';
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
export interface PurposeCitedDescription { text: string; evidenceRefs: string[]; }
export interface PurposeFinalProposal {
    clauses: Array<Omit<AssessmentProposal['clauses'][number], 'openQuestions'> & {
        changeSummary?: PurposeCitedDescription;
        scopeNotes?: PurposeCitedDescription[];
        changeObservations: PurposeObservation[];
        testObservations: PurposeObservation[];
        remainingQuestions: {text: string; evidenceRefs: string[]}[];
    }>;
}
export interface PurposeIntentMember { clauseId: string; purpose: string; conditions: string[]; exceptions: string[]; }
export interface PurposeUnitProposal {
    units: Array<Omit<PurposeFinalProposal['clauses'][number], 'clauseId'> & {candidateClauseIds: string[]; purpose: string}>;
    contextClauseIds: string[];
}
export interface PurposeCoverage {
    readQuestions?: Array<{round: number; clauseId: string; targetId: string; question: string; knownRefs: string[]; reportImpact: string}>;
    diffCoverage?: {comparison: {baseRefSha: string; diffBaseSha: string; headSha: string} | null; files: Array<{path: string; previousPath: string; state: 'provided' | 'partial' | 'unavailable'}>; hunks: Array<{id: string; complete: boolean; evidenceRefs: string[]}>};
    omittedEvidence: Array<{id: string; path: string; side: 'head' | 'base'; revision: string; startLine: number; endLine: number; reason: 'not_selected' | 'packet_budget'}>;
    collection?: {
        changedPaths: Array<{path: string; side: 'head' | 'base'; revision: string; state: 'acquired' | 'unread' | 'unavailable'; ranges: {startLine: number; endLine: number}[]}>;
        accessFailures: Array<{path: string; side: 'head' | 'base'; revision: string; reason: string}>;
        readStops?: Array<{path: string; side: 'head' | 'base'; revision: string; reason: string}>;
        explorationCallExhausted: boolean;
        searchActions: number;
    };
    readOutcomes: Array<{requested?: {startLine: number; endLine: number}; returned?: {startLine: number; endLine: number}[]; reason?: string; round: number; kind: string; targetId: string; startLine: number; endLine: number; evidenceRefs: string[]; outcome: 'available' | 'unavailable' | 'metadata_only' | 'rejected'}>;
    omittedToolResults: number[];
}
/** Request-local private detail only. Portable/persisted summary never contains these observations. */
export interface PurposeFacts {
    version: 1;
    clauses: Array<PurposeFinalProposal['clauses'][number] & {purpose: string; intentMembers?: PurposeIntentMember[]}>;
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
/** Authenticated tenant reviewer projection; never raw source or private rationale. */
export interface PurposeReview {
    /** Generated language, absent in legacy reports (en); never follow live settings. */
    locale?: import('./tenant-report-language').ReportLanguage;
    version: 1;
    flow: 'explore_final_v1';
    headSha: string;
    baseSha: string;
    // Reference revisions: baseSha is the verified PR diff base, not necessarily the branch tip.
    clauses: {intentMembers?: PurposeIntentMember[]; changeSummary?: PurposeCitedDescription; scopeNotes?: PurposeCitedDescription[]; clauseId: string; goalId: string; purpose: string; conditions?: string[]; exceptions?: string[]; evidenceRefs?: string[]; counterEvidenceRefs?: string[]; implementation: PurposeClauseResult['implementation']; changeDescriptions: {text: string; evidenceRefs: string[]}[]; testDescriptions: {text: string; evidenceRefs: string[]}[]}[];
    references: Pick<PurposeEvidence, 'id' | 'path' | 'side' | 'revision' | 'startLine' | 'endLine'>[];
}
/** Portable summary deliberately excludes tenant reviewer prose and locations. */
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
const purposeClauseSchema = object({sourceRefs: strings(), expectedObservable: str, conditions: strings(8), exceptions: strings(8), obligation: enumeration('required', 'optional', 'ambiguous'), evidenceNeed: enumeration('static', 'behavioral', 'execution_claim', 'measurement')});
export const purposeProposalSchema = object({ goals: array(object({ sourceRefs: strings(), clauses: array(purposeClauseSchema, 32) }), 16), contextRefs: strings(256), unprocessedSourceRefs: strings(256), ambiguities: strings(32) });
/** Common one-shot purpose wire: the server derives parent/document bookkeeping. */
export const purposeExploreProposalSchema = object({goals: array(object({clauses: array(purposeClauseSchema, 32)}), 16), ambiguities: strings(32)});
export type PurposeExploreProposal = {goals: {clauses: PurposeProposal['goals'][number]['clauses']}[]; ambiguities: string[]};
export const isPurposeExploreProposal = contract<PurposeExploreProposal>(purposeExploreProposalSchema);
/** Purpose wire only: ignore unused keys, never fill/coerce values or repair source references. */
export function normalizePurposeExploreWire(value: unknown): unknown {
    const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
    const pick=(v:unknown,keys:string[]):unknown=>record(v)?Object.fromEntries(keys.filter(k=>Object.hasOwn(v,k)).map(k=>[k,v[k]])):v;
    const root=pick(value,Object.keys(purposeExploreProposalSchema.properties));
    if(record(root)&&Array.isArray(root.goals))root.goals=root.goals.map(value=>{
        const goal=pick(value,['clauses']);
        if(record(goal)&&Array.isArray(goal.clauses))goal.clauses=goal.clauses.map(c=>pick(c,Object.keys(purposeClauseSchema.properties)));
        return goal;
    });
    return root;
}

export function purposeExploreRequestSchema(sources: unknown): object {
    const schema: any = structuredClone(purposeExploreProposalSchema);
    const ids = (sources as {spans?: {id: string}[]})?.spans?.map(s => s.id) ?? [];
    const refs = schema.properties.goals.items.properties.clauses.items.properties.sourceRefs;
    if (ids.length) refs.items = enumeration(...ids); else refs.maxItems = 0;
    return schema;
}
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
const citedDescriptionSchema = object({text: str, evidenceRefs: {...strings(16), minItems: 1}});
const finalClauseProperties = {changeSummary: citedDescriptionSchema, scopeNotes: array(citedDescriptionSchema, 8), clauseId: str, implementation, testRelation, evidenceRefs: strings(16), counterEvidenceRefs: strings(16), changeObservations: array(observationSchema, 8), testObservations: array(observationSchema, 8), remainingQuestions: array(object({text: str, evidenceRefs: strings(16)}), 8)};
export const purposeFinalSchema = object({clauses: array({...object(finalClauseProperties), required: Object.keys(finalClauseProperties).filter(k => k !== 'changeSummary' && k !== 'scopeNotes')}, 32)});
/** Provider-only quote shape. Internal report/storage contracts stay unchanged. */
const wireObservationSchema = {anyOf: [
    object({basis: enumeration('source_text'), text: str, evidenceId: str}),
    object({basis: enumeration('model_interpretation'), text: str, evidenceRefs: {...strings(16), minItems: 1}}),
]};
const {testRelation: _wireTestRelation, remainingQuestions: _wireQuestions, ...wireClauseProperties} = finalClauseProperties;
const purposeFinalWireSchema = object({clauses: array(object({...wireClauseProperties,
    changeSummary: {anyOf: [citedDescriptionSchema, {type: 'null'}]},
    changeObservations: array(wireObservationSchema, 8), testObservations: array(wireObservationSchema, 8),
}), 32)});
type WireObservation = {basis: 'source_text'; text: string; evidenceId: string} | PurposeObservation;
const legacyCompatibleWireSchema: any = structuredClone(purposeFinalWireSchema);
legacyCompatibleWireSchema.properties.clauses.items.required = legacyCompatibleWireSchema.properties.clauses.items.required.filter((k: string) => k !== 'changeSummary' && k !== 'scopeNotes');
const validFinalWire = contract<{clauses: Array<Omit<PurposeFinalProposal['clauses'][number], 'testRelation' | 'remainingQuestions' | 'changeObservations' | 'testObservations' | 'changeSummary'> & {changeSummary?: PurposeCitedDescription | null; changeObservations: WireObservation[]; testObservations: WireObservation[]}>}>(legacyCompatibleWireSchema);
const {clauseId: _unitClauseId, ...unitFields} = wireClauseProperties;
const unitWireSchema = object({units: array(object({...unitFields,
    candidateClauseIds: {...strings(32), minItems: 1}, purpose: str,
    changeSummary: {anyOf: [citedDescriptionSchema, {type: 'null'}]},
    changeObservations: array(wireObservationSchema, 8), testObservations: array(wireObservationSchema, 8),
}), 16), contextClauseIds: strings(32)});
const validUnitWire = contract<{units: Array<Omit<PurposeUnitProposal['units'][number], 'testRelation' | 'remainingQuestions' | 'changeObservations' | 'testObservations' | 'changeSummary'> & {changeSummary: PurposeCitedDescription | null; changeObservations: WireObservation[]; testObservations: WireObservation[]}>; contextClauseIds: string[]}>(unitWireSchema);
const parsedObservation = (o: WireObservation): PurposeObservation => 'evidenceId' in o
    ? {basis: 'source_text', text: o.text, evidenceRefs: [o.evidenceId]} : o;
export function parsePurposeUnitsWire(value: unknown): PurposeUnitProposal {
    if (!validUnitWire(value)) throw new Error('purpose_final_wire_schema');
    return {units: value.units.map(({changeSummary, ...u}) => ({...u, ...(changeSummary ? {changeSummary} : {}), testRelation: 'unknown', remainingQuestions: [], changeObservations: u.changeObservations.map(parsedObservation), testObservations: u.testObservations.map(parsedObservation)})), contextClauseIds: [...value.contextClauseIds]};
}
export function parsePurposeFinalWire(value: unknown): PurposeFinalProposal {
    if (!validFinalWire(value)) throw new Error('purpose_final_wire_schema');
    return {clauses: value.clauses.map(({changeSummary, ...c}) => ({...c, ...(changeSummary ? {changeSummary} : {}), testRelation: 'unknown', remainingQuestions: [], changeObservations: c.changeObservations.map(parsedObservation), testObservations: c.testObservations.map(parsedObservation)}))};
}
/** Wire constraint only: local source closure remains the trust boundary. */
export function purposeFinalRequestSchema(spec: unknown, evidence: unknown, format?: 'purpose_units_v1'): object {
    const schema: any = structuredClone(format ? unitWireSchema : purposeFinalWireSchema);
    const clauseIds = (spec as PurposeSpec | undefined)?.goals?.flatMap(g => g.clauses.map(c => c.id)) ?? [];
    const evidenceIds = Array.isArray(evidence) ? evidence.map(e => e.id) : [];
    const row = (format ? schema.properties.units : schema.properties.clauses).items.properties;
    if (format) {
        row.candidateClauseIds.items = clauseIds.length ? enumeration(...clauseIds) : str;
        schema.properties.contextClauseIds.items = clauseIds.length ? enumeration(...clauseIds) : str;
    } else {
        row.clauseId = clauseIds.length ? enumeration(...clauseIds) : str;
        schema.properties.clauses.minItems = clauseIds.length;
        schema.properties.clauses.maxItems = clauseIds.length;
    }
    const refs = () => evidenceIds.length ? {...strings(16), items: enumeration(...evidenceIds)} : {...strings(16), maxItems: 0};
    row.evidenceRefs = refs(); row.counterEvidenceRefs = refs();
    row.changeSummary.anyOf[0].properties.evidenceRefs = {...refs(), minItems: 1};
    row.scopeNotes.items.properties.evidenceRefs = {...refs(), minItems: 1};
    if (!evidenceIds.length) { row.changeSummary = {type: 'null'}; row.scopeNotes.maxItems = 0; }
    for (const key of ['changeObservations', 'testObservations']) {
        const [quote, interpretation] = row[key].items.anyOf;
        quote.properties.evidenceId = evidenceIds.length ? enumeration(...evidenceIds) : str;
        interpretation.properties.evidenceRefs = evidenceIds.length ? {...refs(), minItems: 1} : refs();
        if (!evidenceIds.length) row[key].maxItems = 0;
    }
    return schema;
}
export const isPurposeFinalProposal = contract<PurposeFinalProposal>(purposeFinalSchema);
export function validatePurposeFinal(value: unknown, spec: PurposeSpec, evidence: PurposeEvidence[]): PurposeFinalProposal {
    if (!isPurposeFinalProposal(value)) throw new Error('purpose_final_schema');
    const ids = new Set(spec.goals.flatMap(g => g.clauses.map(c => c.id)));
    if (value.clauses.length !== ids.size || new Set(value.clauses.map(c => c.clauseId)).size !== ids.size || value.clauses.some(c => !ids.has(c.clauseId))) throw new Error('purpose_final_clause_reference');
    validateFinalReferences(value.clauses, evidence);
    return value;
}
function validateFinalReferences(clauses: PurposeFinalProposal['clauses'], evidence: PurposeEvidence[]): void {
    const sent = new Map(evidence.map(e => [e.id, e]));
    for (const c of clauses) {
        const observations = [...c.changeObservations, ...c.testObservations];
        const refs = [...c.evidenceRefs, ...c.counterEvidenceRefs, ...observations.flatMap(o => o.evidenceRefs), ...c.remainingQuestions.flatMap(q => q.evidenceRefs), ...(c.changeSummary?.evidenceRefs ?? []), ...(c.scopeNotes ?? []).flatMap(n => n.evidenceRefs)];
        if (refs.some(id => !sent.has(id))) throw new Error('purpose_final_reference');
        for (const o of observations) if (o.basis === 'source_text' && (o.evidenceRefs.length !== 1 || !sent.get(o.evidenceRefs[0])!.content.includes(o.text))) throw new Error('purpose_final_quote');
    }
}
const {clauseId: _unitInternalClauseId, ...unitInternalFields} = finalClauseProperties;
const unitProposalShape = contract<PurposeUnitProposal>(object({units: array({...object({...unitInternalFields, candidateClauseIds: {...strings(32),minItems:1}, purpose:str}), required: Object.keys({...unitInternalFields,candidateClauseIds:0,purpose:0}).filter(k=>k!=='changeSummary'&&k!=='scopeNotes')},16),contextClauseIds:strings(32)}));
export function validatePurposeUnits(value: unknown, spec: PurposeSpec, evidence: PurposeEvidence[], counterByCandidate: Array<{clauseId:string;counterEvidenceRefs:string[]}> = []): PurposeUnitProposal {
    if (!unitProposalShape(value)) throw new Error('purpose_final_schema');
    const expected = new Set(spec.goals.flatMap(g=>g.clauses.map(c=>c.id)));
    const assigned = [...value.units.flatMap(u=>u.candidateClauseIds),...value.contextClauseIds];
    if (assigned.length!==expected.size || new Set(assigned).size!==expected.size || assigned.some(id=>!expected.has(id))) throw new Error('purpose_final_clause_reference');
    validateFinalReferences(value.units.map(u=>({...u,clauseId:u.candidateClauseIds[0]})),evidence);
    for (const link of counterByCandidate) {
        const unit=value.units.find(u=>u.candidateClauseIds.includes(link.clauseId));
        if (link.counterEvidenceRefs.some(id=>!unit?.counterEvidenceRefs.includes(id))) throw new Error('purpose_final_counter_reference');
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
export function projectPurposeSummary(a: PurposeAssessment): PurposeAssessmentSummary {
    const summary: PurposeAssessmentSummary = { version: 1, ...(a.facts ? {flow: 'explore_final_v1' as const} : {}), scope: a.scope, state: a.state, overall: a.overall, goals: a.goals.map(g => ({ goalId: g.goalId, authority: g.authority, achievement: g.achievement, assurance: g.assurance, implementation: g.clauseResults.some(c => c.implementation === 'contradicts') ? 'contradicts' : g.clauseResults.some(c => c.implementation === 'supports') ? 'supports' : 'unknown', testRelation: g.clauseResults.some(c => c.testRelation === 'inadequate') ? 'inadequate' : g.clauseResults.some(c => c.testRelation === 'relevant') ? 'relevant' : 'unknown', execution: g.clauseResults.some(c => c.execution === 'checked_fail') ? 'checked_fail' : g.clauseResults.every(c => c.execution === 'not_required') ? 'not_required' : g.clauseResults.every(c => c.execution === 'checked_pass' || c.execution === 'not_required') ? 'checked_pass' : 'not_observed' })), limitations: [...a.limitations] };
    if (!isPurposeSummary(summary))
        throw new Error('purpose_summary_invalid');
    return summary;
}
