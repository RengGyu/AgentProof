import type {LocateTimingAnchor} from './purpose-locate-timing';
import {purposeDeadline} from './purpose-timeout';
import {analysisDiagnostic,analysisHash} from './analysis-diagnostics';
import { resolveReportLanguage, type ReportLanguage } from './tenant-report-language';
import {annotatePurposeFailure, purposeFailureDiagnostic, type PurposeFailureStage, type PurposeFailurePhase} from './purpose-failure';
import { createPurposeRepository, type PurposeRepositoryBackend } from './purpose-repository';
import { localizePurpose, type LocalizationMode } from './purpose-localization';
import { getPurposeDiffIndex } from "./purpose-github";
import { buildPurposeSources, compilePurposeSpec } from './purpose-spec';
import { createPurposeCollector, purposeBatches, type PurposeSourceReader } from './purpose-evidence';
import { collectPurposeTestEvidence } from './purpose-test-evidence';
import { isAssessmentProposal, isCheckerProposal, projectPurposeSummary, purposeHash, type PurposeMode, type PurposeAssessment, type PurposeClause, type PurposeClauseResult, type PurposeSpec, type Achievement, type AssessmentProposal, type PurposeFacts, validatePurposeFinal } from './purpose-contract';
import {isPurposeReview,safePurposeReviewText,purposeReviewFailure} from './purpose-summary';
import { createStagedPurposeProvider, type PurposeProvider } from './purpose-provider';
import type { PullRequestInput, VerificationReportV2 } from './types';
import { validateRuntimeReportBoundary, registerPurposeValidationContext } from './report-runtime-validation';
export interface PurposeAssessmentOptions {
    mode?: PurposeMode;
    reportLanguage?: ReportLanguage;
    variant?: 'fixed' | 'adaptive';
    flow?: 'explore_final_v1';
    provider?: PurposeProvider;
    stageProviders?: Parameters<typeof createStagedPurposeProvider>[0];
    readSource?: PurposeSourceReader;
    signal?: AbortSignal;
    /** Server-owned current grant; never read from the analysis request body. */
    authorizePrivate?: (signal?: AbortSignal) => Promise<boolean>;
    readCurrentInput?: () => Promise<PullRequestInput | null>;
    frozenSpec?: PurposeSpec;
    localization?: { mode: LocalizationMode; timingAnchor?:LocateTimingAnchor; backend: PurposeRepositoryBackend; onInvalid?: (event: {reason: string; proposal: string; hash: string}) => void };
}
const contexts = new WeakMap<object, {
    inputHash: string;
    reportHash: string;
    assessmentHash: string;
    summaryHash: string;
    reviewHash: string;
}>();
export function hasPurposeContext(assessment: PurposeAssessment, input: PullRequestInput, report: VerificationReportV2) { const c = contexts.get(assessment); return !!c && c.inputHash === purposeHash(input) && c.assessmentHash === purposeHash(assessment) && c.summaryHash === purposeHash(report.purposeAssessmentSummary) && c.reviewHash === purposeHash(report.purposeReview ?? null) && c.reportHash === purposeHash(withoutPurpose(report)); }
function withoutPurpose(report: VerificationReportV2) { const { purposeAssessment: _a, purposeAssessmentSummary: _s, purposeReview: _r, ...base } = report; return base; }
export async function assessPurpose(input: PullRequestInput, report: VerificationReportV2, options: PurposeAssessmentOptions = {}) {
    if (options.mode !== 'shadow' && options.mode !== 'advisory')
        return { report, assessment: null };
    if (options.flow === 'explore_final_v1' && !options.localization) throw new Error('purpose_final_localization_required');
    if (options.stageProviders && options.flow !== 'explore_final_v1') throw new Error('purpose_stage_flow_required');
    if (input.repositoryPrivate !== false && (input.repositoryPrivate !== true || !options.authorizePrivate))
        throw new Error('purpose_private_consent_required');
    if (options.mode === 'advisory' && !options.readCurrentInput)
        throw new Error('purpose_freshness_required');
    if (options.provider && options.stageProviders) throw new Error('purpose_provider_assignment_conflict');
    const reportLanguage = resolveReportLanguage(options.reportLanguage);
    analysisDiagnostic('settings','success',()=>({locale:reportLanguage,hashes:{profile:analysisHash({flow:options.flow,mode:options.mode,variant:options.variant,reportLanguage})}}));
    const provider = options.stageProviders ? createStagedPurposeProvider(options.stageProviders) : options.provider;
    if (!provider) throw new Error('purpose_provider_unavailable');
    if (input.sourceProvenance?.origin !== 'github_snapshot')
        throw new Error('purpose_snapshot_required');
    const deadline=purposeDeadline(180000,'analysis_deadline',options.signal),signal=deadline.signal;
    let disposeLocalization = () => {};
    let failureStage:PurposeFailureStage='purpose', failurePhase:PurposeFailurePhase='validation';
    const authorizePrivate = async (active=signal) => {active.throwIfAborted();if(input.repositoryPrivate===true&&!await options.authorizePrivate!(active))throw new Error('purpose_private_consent_required');active.throwIfAborted();};
    try {
    await authorizePrivate();
    const inputHash = purposeHash(input), sources = buildPurposeSources(input), finalOnly = options.flow === 'explore_final_v1', adaptive = !finalOnly && options.variant !== "fixed";
    let calls = 0;
    const stageTimes: {
        stage: string;
        elapsedMs: number;
    }[] = [];
    const started = performance.now();
    const invoke = async (q: Parameters<PurposeProvider>[0], stageSignal=signal) => { failureStage=q.stage; const active=AbortSignal.any([signal,stageSignal]); await authorizePrivate(active); if (++calls > 9)
        throw new Error('purpose_call_budget'); const callDeadline=purposeDeadline(60000,'provider_timeout',active),start = performance.now(); try {
        const proposal=await provider(structuredClone({...q, reportLanguage, ...(options.flow ? {flow: options.flow} : {})}), callDeadline.signal);
        await authorizePrivate(callDeadline.signal);
        return proposal;
    }
    finally {
        callDeadline.dispose();
        stageTimes.push({ stage: q.stage, elapsedMs: performance.now() - start });
    } };
    analysisDiagnostic('purpose','start',()=>({hashes:{source:sources.sourceBundleHash},counts:{sources:sources.spans.length}}));
    const sourceSpec = options.frozenSpec ?? compilePurposeSpec(input, await invoke({ stage: 'purpose', sources }), options.flow);
    // A frozen spec must be independently source-validated; a forged accepted-looking object has no authority.
    const rebuilt = compilePurposeSpec(input, { goals: sourceSpec.goals.map(g => ({ sourceRefs: g.sourceRefs, clauses: g.clauses.map(({ id: _id, canonicalRequirementIds: _r, ...c }) => c) })), contextRefs: sources.spans.filter(s => !sourceSpec.goals.some(g => g.sourceRefs.includes(s.id)) && !sourceSpec.unprocessedSourceRefs.includes(s.id)).map(s => s.id), unprocessedSourceRefs: sourceSpec.unprocessedSourceRefs, ambiguities: sourceSpec.ambiguities.filter(a => a !== 'source_incomplete') });
    if (purposeHash(rebuilt) !== purposeHash(sourceSpec))
        throw new Error('purpose_frozen_spec_mismatch');
    const spec = structuredClone(sourceSpec), clauses = spec.goals.flatMap(g => g.clauses);
    analysisDiagnostic('purpose','success',()=>({hashes:{source:sources.sourceBundleHash,spec:analysisHash(spec)},counts:{clauses:clauses.length,conditions:clauses.reduce((n,c)=>n+c.conditions.length,0),exceptions:clauses.reduce((n,c)=>n+c.exceptions.length,0)},parts:clauses.map(c=>({idHash:analysisHash(c.id),textHash:analysisHash(c.expectedObservable),conditions:c.conditions.map(analysisHash),exceptions:c.exceptions.map(analysisHash),refs:c.sourceRefs.map(analysisHash)}))}));
    if(finalOnly&&!clauses.length){const error=new Error('purpose_no_core_goal');annotatePurposeFailure(error,{stage:'purpose',phase:'validation',counts:{clauses:0,evidence:0}});throw error;}
    const readSource:PurposeSourceReader|undefined=options.readSource?async (request,readSignal)=>{await authorizePrivate();const source=await options.readSource!(request,readSignal);await authorizePrivate();return source;}:undefined;
    let collector = createPurposeCollector(input, readSource, signal);
    let localization: Awaited<ReturnType<typeof localizePurpose>> | undefined;
    if (options.localization) {
        failureStage='locate';failurePhase='source';
        const repository = await createPurposeRepository(input, options.localization.backend, {signal,authorizePrivate:options.authorizePrivate});
        disposeLocalization = () => repository.dispose();
        failurePhase='validation';
        localization = await localizePurpose(input, spec, repository, {...options.localization, flow: options.flow, invoke, signal});
        collector = localization.collector;
    }
    // Exact hunk coordinates are location hints, never support or source-goal association proof.
    const diffIndex = getPurposeDiffIndex(input);
    if (!options.localization) {
    for (const locator of diffIndex.locators) {
        await collector.read({ ...locator, clauseId: "initial_locator", reason: "Original patch hunk locator" });
    }
    if (!diffIndex.locators.length)
        for (const file of input.changedFiles) {
            const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/m.exec(file.patch ?? '');
            if (!hunk || !clauses.length)
                continue;
            const start = Math.max(1, Number(hunk[1])), end = start + Math.min(79, Math.max(0, Number(hunk[2] ?? 1) - 1));
            await collector.read({ path: file.path, side: 'head', startLine: start, endLine: end, clauseId: 'initial_locator', reason: 'Changed hunk locator' });
        }
    }
    const signals = collectPurposeTestEvidence(input);
    const observations = new Map<string, AssessmentProposal['clauses'][number]>(), sent = new Map<string, Set<string>>();
    const limitations = [...(localization?.limitations ?? []), ...diffIndex.limitations, ...signals.limitations, ...(spec.unprocessedSourceRefs.length ? ['source_unprocessed'] : []), ...(spec.ambiguities.length ? ['source_ambiguous'] : [])];
    let facts: PurposeFacts | undefined;
    if (finalOnly) {
        failureStage='assess';failurePhase='validation';
        const evidence = collector.evidence;
        if(!evidence.length){const error=new Error('purpose_no_citable_material');annotatePurposeFailure(error,{stage:'assess',phase:'source',counts:{clauses:clauses.length,evidence:0}});throw error;}
        if (evidence.length > 16 || Buffer.byteLength(JSON.stringify(evidence)) > 48000) throw new Error('purpose_final_packet_budget');
        analysisDiagnostic('final','start',()=>({hashes:{packet:analysisHash(evidence)},counts:{selected:evidence.length,bytes:Buffer.byteLength(JSON.stringify(evidence))}}));
        const raw = validatePurposeFinal(await invoke({stage: 'assess', flow: 'explore_final_v1', sources, spec, evidence, limitations: [...limitations, ...collector.limitations], coverage: {omittedEvidence:localization!.coverage.omittedEvidence}}), spec, evidence);
        analysisDiagnostic('final','success',()=>({hashes:{final:analysisHash(raw),packet:analysisHash(evidence)},counts:{clauses:raw.clauses.length},parts:raw.clauses.map(c=>({idHash:analysisHash(c.clauseId),changeHash:analysisHash(c.changeObservations.map(o=>o.text)),testHash:analysisHash(c.testObservations.map(o=>o.text)),textHash:analysisHash(c),refs:c.evidenceRefs.map(analysisHash),counterRefs:c.counterEvidenceRefs.map(analysisHash)}))}));
        facts = {version: 1, clauses: raw.clauses.map(c => ({...c, purpose: clauses.find(s => s.id === c.clauseId)!.expectedObservable})), coverage: localization!.coverage};
        for (const row of raw.clauses) {
            const interpreted=[...row.changeObservations,...row.testObservations].some(o=>o.basis==='model_interpretation');
            if(!interpreted)limitations.push('purpose_interpretation_unavailable');
            observations.set(row.clauseId, {...row,implementation:interpreted?row.implementation:'unknown',evidenceRefs:[...new Set([...row.evidenceRefs,...[...row.changeObservations,...row.testObservations].flatMap(o=>o.evidenceRefs)])],openQuestions: row.remainingQuestions.map(q => q.text)});
            sent.set(row.clauseId, new Set(evidence.map(e => e.id)));
        }
    }
    let initial = 0, reassess = 0;
    const work = finalOnly ? [] : [...purposeBatches(collector.evidence)];
    if (!finalOnly && !work.length)
        work.push([]);
    async function assessBatch(batch: typeof collector.evidence) {
        const q = { stage: 'assess' as const, sources, spec, evidence: batch, executionSignals: signals, limitations: [...limitations, ...collector.limitations], inventory: collector.paths(), ...(localization ? { localization: { clauses: localization.clauses, rolesAreHypotheses: true } } : {}) };
        const raw = await invoke(q);
        if (!isAssessmentProposal(raw))
            throw new Error('purpose_assessment_schema');
        const ids = new Set(batch.map(e => e.id)), clauseIds = new Set(clauses.map(c => c.id));
        if (raw.clauses.some(c => !clauseIds.has(c.clauseId) || [...c.evidenceRefs, ...c.counterEvidenceRefs].some(id => !ids.has(id))) || new Set(raw.clauses.map(c => c.clauseId)).size !== raw.clauses.length || raw.readRequests.some(r => !clauseIds.has(r.clauseId)) || raw.searchRequests.some(r => !clauseIds.has(r.clauseId)))
            throw new Error('purpose_unsent_reference');
        for (const row of raw.clauses) {
            const previous = observations.get(row.clauseId);
            sent.set(row.clauseId, new Set([...(sent.get(row.clauseId) ?? []), ...ids]));
            observations.set(row.clauseId, previous ? { ...row, implementation: previous.implementation === 'contradicts' || row.implementation === 'contradicts' ? 'contradicts' : previous.implementation === 'supports' || row.implementation === 'supports' ? 'supports' : 'unknown', evidenceRefs: [...new Set([...previous.evidenceRefs, ...row.evidenceRefs])], counterEvidenceRefs: [...new Set([...previous.counterEvidenceRefs, ...row.counterEvidenceRefs])], openQuestions: [...new Set([...previous.openQuestions, ...row.openQuestions])].slice(0, 8) } : row);
        }
        return raw;
    }
    while (work.length && initial < (localization ? 1 : 4)) {
        const batch = work.shift()!;
        initial++;
        const raw = await assessBatch(batch);
        if (adaptive && reassess < (localization ? 1 : 2)) {
            const before = collector.evidence.length;
            for (const request of raw.readRequests)
                await collector.read(request);
            for (const search of raw.searchRequests) {
                const hits = collector.search(search.query, search.paths);
                if (!hits.length)
                    limitations.push('search_supplied_no_hit');
                for (const hit of hits)
                    await collector.read({ ...hit, clauseId: search.clauseId, reason: 'Supplied literal hit' });
            }
            const added = collector.evidence.slice(before);
            if (added.length) {
                for (const extra of purposeBatches(added)) {
                    if (reassess >= (localization ? 1 : 2)) {
                        limitations.push('reassessment_budget');
                        break;
                    }
                    const extraResult = await assessBatch(extra);
                    if (extraResult.readRequests.length || extraResult.searchRequests.length)
                        limitations.push("additional_evidence_uncollected");
                    reassess++;
                }
            }
        }
        else if (raw.readRequests.length || raw.searchRequests.length)
            limitations.push('additional_evidence_uncollected');
    }
    if (work.length)
        limitations.push('initial_batch_budget');
    const validBase = validateRuntimeReportBoundary({ boundary: 'generated_private_full', input, report }).valid;
    const disputes = new Set<string>();
    if (adaptive) {
        const candidates = clauses.filter(c => !reduceClause(c,undefined,false,validBase?report:null).reasonCodes.some(r=>r==='source_owned_static_result'||r==='source_owned_execution_result') && (observations.get(c.id)?.implementation === 'supports' || observations.get(c.id)?.implementation === 'contradicts'));
        let checked = 0;
        // The checker receives original conditions and evidence, never the assessor verdict/rationale.
        for (const batch of purposeBatches(collector.evidence)) {
            if (!candidates.length)
                break;
            if (checked >= 2) {
                limitations.push('checker_budget');
                candidates.forEach(c => disputes.add(c.id));
                break;
            }
            checked++;
            const raw = await invoke({ stage: 'check', sources, spec, evidence: batch, executionSignals: signals, limitations: [...limitations, ...collector.limitations] });
            if (!isCheckerProposal(raw) || raw.disputes.some(d => !clauses.some(c => c.id === d.clauseId) || d.evidenceRefs.some(id => !batch.some(e => e.id === id))))
                throw new Error('purpose_checker_schema');
            raw.disputes.forEach(d => disputes.add(d.clauseId));
        }
    }

    const results = new Map(clauses.map(c => [c.id, reduceClause(c, observations.get(c.id), disputes.has(c.id), validBase ? report : null)]));
    const goals = spec.goals.map(g => { const required = g.clauses.filter(c => c.obligation !== 'optional'), rows = g.clauses.map(c => results.get(c.id)!); const states = required.map(c => clauseAchievement(c, results.get(c.id)!)); const limited = spec.unprocessedSourceRefs.length > 0 || spec.ambiguities.length > 0 || required.some(c => c.obligation === 'ambiguous'); let achievement = aggregate(states); if (limited && achievement === 'fulfilled')
        achievement = 'partial'; return { goalId: g.id, authority: g.authority, clauseResults: rows, achievement, assurance: rows.every(r => r.reasonCodes.includes('source_owned_static_result')||r.reasonCodes.includes('source_owned_execution_result')) ? 'deterministic_checked' as const : rows.some(r => r.implementation === 'supports' && r.evidenceRefs.length && !r.reasonCodes.includes('checker_dispute')) ? 'evidence_assessed' as const : 'insufficient' as const }; });
    const uniqueLimitations = [...new Set([...limitations, ...collector.limitations, ...(goals.some(g => g.clauseResults.some(r => r.reasonCodes.includes('checker_dispute'))) ? ['checker_dispute'] : [])])];
    const closedLimitations = uniqueLimitations.length > 32 ? [...uniqueLimitations.slice(0, 31), "limitation_overflow"] : uniqueLimitations;
    const assessment: PurposeAssessment = { version: 1, ...(facts ? {facts} : {}), scope: 'stated_purpose_at_snapshot', subjectDigest: purposeHash([input.url, spec.headSha, spec.baseSha, spec.sourceBundleHash]), state: closedLimitations.length ? 'limited' : goals.length ? 'complete' : 'unavailable', goals, overall: aggregate(goals.map(g => g.achievement)), limitations: closedLimitations, evidenceIndex: collector.evidence.map(({ content: _content, clauseIds: _clauses, ...e }) => e), traceDigest: purposeHash({ calls, metrics: collector.metrics(), sent: [...sent].map(([id, refs]) => [id, [...refs]]) }) };
    await authorizePrivate();
    if (options.readCurrentInput) {
        failurePhase='freshness';
        const current = await options.readCurrentInput();
        if (!current || freshnessHash(current,finalOnly) !== freshnessHash(input,finalOnly))
            throw new Error('purpose_stale');
    }
    await authorizePrivate();
    signal.throwIfAborted();
    if (options.mode === 'shadow')
        return { report, assessment, spec, metrics: { calls, ...collector.metrics(), stageTimes, totalMs: performance.now() - started, ...(localization ? { localization: { clauses: localization.clauses, trace: localization.trace, calls: localization.calls, elapsedMs: localization.elapsedMs, sourceSpecHash: localization.sourceSpecHash } } : {}) } };
    failurePhase='projection';
    const summary = projectPurposeSummary(assessment), purposeReview = finalOnly ? projectReview(assessment, spec, collector.evidence, getPurposeDiffIndex(input).comparison?.diffBaseSha ?? spec.baseSha, reportLanguage) : undefined;
    const next = { ...report, purposeAssessment: assessment, purposeAssessmentSummary: summary, ...(purposeReview ? {purposeReview} : {}) };
    contexts.set(assessment, { inputHash, reportHash: purposeHash(report), assessmentHash: purposeHash(assessment), summaryHash: purposeHash(summary), reviewHash: purposeHash(purposeReview ?? null) });
    registerPurposeValidationContext(assessment, (currentInput, currentReport) => hasPurposeContext(assessment, currentInput, currentReport));
    return { report: next, assessment, spec, metrics: { calls, ...collector.metrics(), stageTimes, totalMs: performance.now() - started, ...(localization ? { localization: { clauses: localization.clauses, trace: localization.trace, calls: localization.calls, elapsedMs: localization.elapsedMs, sourceSpecHash: localization.sourceSpecHash } } : {}) } };
    } catch(error) {annotatePurposeFailure(error,{stage:failureStage,phase:failurePhase});analysisDiagnostic(failureStage==='locate'?'selection':failureStage==='purpose'?'purpose':'final','failure',()=>({failure:purposeFailureDiagnostic(error)}));throw error;} finally { deadline.dispose(); disposeLocalization(); }
}
function reduceClause(clause: PurposeClause, row: AssessmentProposal['clauses'][number] | undefined, dispute: boolean, report: VerificationReportV2 | null): PurposeClauseResult {
    const result: PurposeClauseResult = { clauseId: clause.id, implementation: (row?.evidenceRefs.length||row?.counterEvidenceRefs.length) ? row!.implementation : 'unknown', testRelation: row?.evidenceRefs.length ? row.testRelation : 'unknown', execution: clause.evidenceNeed === 'static' ? 'not_required' : 'not_observed', evidenceRefs: row?.evidenceRefs ?? [], counterEvidenceRefs: row?.counterEvidenceRefs ?? [], openQuestions: row?.openQuestions ?? [], criterionEvidenceRefs:[], reasonCodes: [...(dispute ? ['checker_dispute'] : [])] };
    // Whole source-owned canonical equality; no semantic similarity receipt transfer.
    const requirement = clause.canonicalRequirementIds.length===1 ? report?.requirements.find(r=>r.requirementId===clause.canonicalRequirementIds[0]) : null;
    const owned = requirement ? report?.ordinaryRequirementOutcomes?.requirements.find(r => r.requirementId === requirement.requirementId) : null;
    if (clause.evidenceNeed === 'static' && owned?.interpretation === 'source_explicit' && owned.criterion && ['documentation_literal', 'typescript_union_member', 'typescript_assignability'].includes(owned.criterion.kind) && owned.criterion.state !== 'unavailable') {
        result.criterionEvidenceRefs=[...owned.criterion.evidenceRefs];
        result.implementation = owned.criterion.state === 'satisfied' ? 'supports' : 'contradicts';
        result.reasonCodes = ['source_owned_static_result', ...(owned.criterion.state === 'violated' ? ['deterministic_violation'] : [])];
    }
    else if((clause.evidenceNeed==='behavioral'||clause.evidenceNeed==='execution_claim')&&owned?.interpretation==='source_explicit'&&owned.criterion?.kind==='standalone_scalar'&&owned.criterion.state!=='unavailable') {
        result.criterionEvidenceRefs=[...owned.criterion.evidenceRefs];
        result.implementation=owned.criterion.state==='satisfied'?'supports':'contradicts';
        result.execution=owned.criterion.state==='satisfied'?'checked_pass':'checked_fail';
        result.testRelation='not_required';
        result.reasonCodes=['source_owned_execution_result','standalone_scalar_case_only',...(owned.criterion.state==='violated'?['deterministic_violation']:[])];
    }
    else
        result.reasonCodes.push(clause.evidenceNeed === 'static' ? 'static_check_not_available' : 'required_execution_not_verified');
    return result;
}
function clauseAchievement(c: PurposeClause, r: PurposeClauseResult): Achievement { if (r.reasonCodes.includes('deterministic_violation'))
    return 'not_fulfilled'; if (r.implementation === 'supports' && (r.reasonCodes.includes('source_owned_static_result')||r.reasonCodes.includes('source_owned_execution_result')) && !r.openQuestions.length && !r.reasonCodes.includes('checker_dispute') && c.obligation !== 'ambiguous')
    return 'fulfilled'; return !r.reasonCodes.includes('checker_dispute') && r.implementation === 'supports' && r.evidenceRefs.length ? 'partial' : 'unclear'; }
export function aggregate(states: Achievement[]): Achievement { return states.includes('not_fulfilled') ? 'not_fulfilled' : states.length && states.every(s => s === 'fulfilled') ? 'fulfilled' : states.some(s => s === 'partial' || s === 'fulfilled') ? 'partial' : 'unclear'; }

function freshnessHash(input:PullRequestInput,staticPurpose=false){
 if(!staticPurpose)return purposeHash({...input,sourceProvenance:input.sourceProvenance?{...input.sourceProvenance,evidenceCapturedAt:undefined}:undefined});
 return purposeHash({url:input.url,repositoryPrivate:input.repositoryPrivate,title:input.title,description:input.description,taskText:input.taskText,taskSource:input.taskSource,requirementSourceIdentityHash:input.requirementSourceIdentityHash,origin:input.sourceProvenance?.origin,headSha:input.sourceProvenance?.headSha,baseSha:input.sourceProvenance?.baseSha,comparison:getPurposeDiffIndex(input).comparison??null,changes:input.changedFiles.map(({path,previousPath,status,patch})=>({path,previousPath,status,patch}))});
}

function projectReview(assessment: PurposeAssessment, spec: PurposeSpec, evidence: import('./purpose-contract').PurposeEvidence[], diffBaseSha: string, locale: ReportLanguage): import('./purpose-contract').PurposeReview {
 const facts=assessment.facts;
 const counts={clauses:facts?.clauses.length??0,evidence:evidence.length,changeQuotes:0,changeInterpretations:0,testQuotes:0,testInterpretations:0,projectedDescriptions:0,projectedRefs:0};
 for(const c of facts?.clauses??[]){counts.changeQuotes+=c.changeObservations.filter(o=>o.basis==='source_text').length;counts.changeInterpretations+=c.changeObservations.filter(o=>o.basis==='model_interpretation').length;counts.testQuotes+=c.testObservations.filter(o=>o.basis==='source_text').length;counts.testInterpretations+=c.testObservations.filter(o=>o.basis==='model_interpretation').length;}
 const fail=(code:string):never=>{const error=new Error(code);annotatePurposeFailure(error,{stage:'assess',phase:'projection',counts});throw error;};
 if(!facts?.clauses.length)fail('purpose_no_core_goal');
 const safe=(text:string)=>{if(!safePurposeReviewText(text))fail('purpose_projection_text');return text;};
 const clauses=facts!.clauses.map(c=>{const goal=assessment.goals.find(g=>g.clauseResults.some(r=>r.clauseId===c.clauseId))!,clause=spec.goals.flatMap(g=>g.clauses).find(s=>s.id===c.clauseId)!;
  const descriptions=(items:typeof c.changeObservations)=>items.filter(o=>o.basis==='model_interpretation').map(o=>({text:safe(o.text),evidenceRefs:[...o.evidenceRefs]}));
  const changeDescriptions=descriptions(c.changeObservations),testDescriptions=descriptions(c.testObservations);counts.projectedDescriptions+=changeDescriptions.length+testDescriptions.length;
  return {...(c.changeSummary?{changeSummary:{text:safe(c.changeSummary.text),evidenceRefs:[...c.changeSummary.evidenceRefs]}}:{}),...(c.scopeNotes?{scopeNotes:c.scopeNotes.map(n=>({text:safe(n.text),evidenceRefs:[...n.evidenceRefs]}))}:{}),clauseId:c.clauseId,goalId:goal.goalId,purpose:safe(c.purpose),conditions:clause.conditions.map(safe),exceptions:clause.exceptions.map(safe),implementation:changeDescriptions.length||testDescriptions.length?goal.clauseResults.find(r=>r.clauseId===c.clauseId)!.implementation:'unknown' as const,changeDescriptions,testDescriptions,evidenceRefs:[...new Set([...c.evidenceRefs,...[...c.changeObservations,...c.testObservations].flatMap(o=>o.evidenceRefs)])],counterEvidenceRefs:[...c.counterEvidenceRefs]};});
 const used=new Set(clauses.flatMap(c=>[...c.evidenceRefs,...c.counterEvidenceRefs,...(c.changeSummary?.evidenceRefs??[]),...(c.scopeNotes??[]).flatMap(n=>n.evidenceRefs)]));counts.projectedRefs=used.size;
 if([...used].some(id=>!evidence.some(e=>e.id===id)))fail('purpose_projection_refs');
 const review:import('./purpose-contract').PurposeReview={version:1,flow:'explore_final_v1',locale,headSha:spec.headSha,baseSha:diffBaseSha,clauses,references:evidence.filter(e=>used.has(e.id)).map(({id,path,side,revision,startLine,endLine})=>({id,path,side,revision,startLine,endLine}))};
 const rejected=purposeReviewFailure(review);if(rejected)fail(rejected);
 analysisDiagnostic('projection','success',()=>({hashes:{projection:analysisHash(review)},counts:{clauses:clauses.length,changes:counts.changeInterpretations,tests:counts.testInterpretations,refs:used.size},parts:clauses.map(c=>({idHash:analysisHash(c.clauseId),changeHash:analysisHash(c.changeDescriptions.map(o=>o.text)),testHash:analysisHash(c.testDescriptions.map(o=>o.text)),textHash:analysisHash(c),conditions:c.conditions.map(analysisHash),exceptions:c.exceptions.map(analysisHash),refs:c.evidenceRefs.map(analysisHash),counterRefs:c.counterEvidenceRefs.map(analysisHash)}))}));return review;
}
