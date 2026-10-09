import { createPurposeRepository, type PurposeRepositoryBackend } from './purpose-repository';
import { localizePurpose, type LocalizationMode } from './purpose-localization';
import { getPurposeDiffIndex } from "./purpose-github";
import { buildPurposeSources, compilePurposeSpec } from './purpose-spec';
import { createPurposeCollector, purposeBatches, type PurposeSourceReader } from './purpose-evidence';
import { collectPurposeTestEvidence } from './purpose-test-evidence';
import { isAssessmentProposal, isCheckerProposal, projectPurposeSummary, purposeHash, type PurposeMode, type PurposeAssessment, type PurposeClause, type PurposeClauseResult, type PurposeSpec, type Achievement, type AssessmentProposal, type PurposeFacts, validatePurposeFinal } from './purpose-contract';
import type { PurposeProvider } from './purpose-provider';
import type { PullRequestInput, VerificationReportV2 } from './types';
import { validateRuntimeReportBoundary } from './report-runtime-validation';
export interface PurposeAssessmentOptions {
    mode?: PurposeMode;
    variant?: 'fixed' | 'adaptive';
    flow?: 'explore_final_v1';
    provider?: PurposeProvider;
    readSource?: PurposeSourceReader;
    signal?: AbortSignal;
    privateConsent?: boolean;
    providerRetentionApproved?: boolean;
    readCurrentInput?: () => Promise<PullRequestInput | null>;
    frozenSpec?: PurposeSpec;
    localization?: { mode: LocalizationMode; backend: PurposeRepositoryBackend; onInvalid?: (event: {reason: string; proposal: string; hash: string}) => void };
}
const contexts = new WeakMap<object, {
    inputHash: string;
    reportHash: string;
    assessmentHash: string;
    summaryHash: string;
}>();
export function hasPurposeContext(assessment: PurposeAssessment, input: PullRequestInput, report: VerificationReportV2) { const c = contexts.get(assessment); return !!c && c.inputHash === purposeHash(input) && c.assessmentHash === purposeHash(assessment) && c.summaryHash === purposeHash(report.purposeAssessmentSummary) && c.reportHash === purposeHash(withoutPurpose(report)); }
function withoutPurpose(report: VerificationReportV2) { const { purposeAssessment: _a, purposeAssessmentSummary: _s, ...base } = report; return base; }
export async function assessPurpose(input: PullRequestInput, report: VerificationReportV2, options: PurposeAssessmentOptions = {}) {
    if (options.mode !== 'shadow' && options.mode !== 'advisory')
        return { report, assessment: null };
    if (options.flow === 'explore_final_v1' && !options.localization) throw new Error('purpose_final_localization_required');
    if (options.localization && input.repositoryPrivate !== false)
        throw new Error('localization_public_required');
    if (input.repositoryPrivate && (!options.privateConsent || !options.providerRetentionApproved))
        throw new Error('purpose_private_consent_required');
    if (options.mode === 'advisory' && !options.readCurrentInput)
        throw new Error('purpose_freshness_required');
    if (!options.provider)
        throw new Error('purpose_provider_unavailable');
    if (input.sourceProvenance?.origin !== 'github_snapshot')
        throw new Error('purpose_snapshot_required');
    const signal = AbortSignal.any([options.signal ?? new AbortController().signal, AbortSignal.timeout(180000)]);
    let disposeLocalization = () => {};
    try {
    const inputHash = purposeHash(input), sources = buildPurposeSources(input), finalOnly = options.flow === 'explore_final_v1', adaptive = !finalOnly && options.variant !== "fixed";
    let calls = 0;
    const stageTimes: {
        stage: string;
        elapsedMs: number;
    }[] = [];
    const started = performance.now();
    const invoke = async (q: Parameters<PurposeProvider>[0]) => { signal.throwIfAborted(); if (++calls > 9)
        throw new Error('purpose_call_budget'); const start = performance.now(); try {
        return await options.provider!(structuredClone(q), AbortSignal.any([signal, AbortSignal.timeout(60000)]));
    }
    finally {
        stageTimes.push({ stage: q.stage, elapsedMs: performance.now() - start });
    } };
    const sourceSpec = options.frozenSpec ?? compilePurposeSpec(input, await invoke({ stage: 'purpose', sources }));
    // A frozen spec must be independently source-validated; a forged accepted-looking object has no authority.
    const rebuilt = compilePurposeSpec(input, { goals: sourceSpec.goals.map(g => ({ sourceRefs: g.sourceRefs, clauses: g.clauses.map(({ id: _id, canonicalRequirementIds: _r, ...c }) => c) })), contextRefs: sources.spans.filter(s => !sourceSpec.goals.some(g => g.sourceRefs.includes(s.id)) && !sourceSpec.unprocessedSourceRefs.includes(s.id)).map(s => s.id), unprocessedSourceRefs: sourceSpec.unprocessedSourceRefs, ambiguities: sourceSpec.ambiguities.filter(a => a !== 'source_incomplete') });
    if (purposeHash(rebuilt) !== purposeHash(sourceSpec))
        throw new Error('purpose_frozen_spec_mismatch');
    const spec = structuredClone(sourceSpec), clauses = spec.goals.flatMap(g => g.clauses);
    let collector = createPurposeCollector(input, options.readSource, signal);
    let localization: Awaited<ReturnType<typeof localizePurpose>> | undefined;
    if (options.localization) {
        const repository = await createPurposeRepository(input, options.localization.backend, {signal});
        disposeLocalization = () => repository.dispose();
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
        const evidence = collector.evidence;
        if (evidence.length > 16 || Buffer.byteLength(JSON.stringify(evidence)) > 48000) throw new Error('purpose_final_packet_budget');
        const raw = validatePurposeFinal(await invoke({stage: 'assess', flow: 'explore_final_v1', sources, spec, evidence, executionSignals: signals, limitations: [...limitations, ...collector.limitations], coverage: localization!.coverage, localization: {clauses: localization!.clauses, rolesAreHypotheses: true}}), spec, evidence);
        facts = {version: 1, clauses: raw.clauses.map(c => ({...c, purpose: clauses.find(s => s.id === c.clauseId)!.expectedObservable})), coverage: localization!.coverage};
        for (const row of raw.clauses) {
            observations.set(row.clauseId, {...row, openQuestions: row.remainingQuestions.map(q => q.text)});
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
    if (options.readCurrentInput) {
        const current = await options.readCurrentInput();
        if (!current || freshnessHash(current) !== freshnessHash(input))
            throw new Error('purpose_stale');
    }
    signal.throwIfAborted();
    if (options.mode === 'shadow')
        return { report, assessment, spec, metrics: { calls, ...collector.metrics(), stageTimes, totalMs: performance.now() - started, ...(localization ? { localization: { clauses: localization.clauses, trace: localization.trace, calls: localization.calls, elapsedMs: localization.elapsedMs, sourceSpecHash: localization.sourceSpecHash } } : {}) } };
    const summary = projectPurposeSummary(assessment), next = { ...report, purposeAssessment: assessment, purposeAssessmentSummary: summary };
    contexts.set(assessment, { inputHash, reportHash: purposeHash(report), assessmentHash: purposeHash(assessment), summaryHash: purposeHash(summary) });
    return { report: next, assessment, spec, metrics: { calls, ...collector.metrics(), stageTimes, totalMs: performance.now() - started, ...(localization ? { localization: { clauses: localization.clauses, trace: localization.trace, calls: localization.calls, elapsedMs: localization.elapsedMs, sourceSpecHash: localization.sourceSpecHash } } : {}) } };
    } finally { disposeLocalization(); }
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

function freshnessHash(input:PullRequestInput){return purposeHash({...input,sourceProvenance:input.sourceProvenance?{...input.sourceProvenance,evidenceCapturedAt:undefined}:undefined});}
