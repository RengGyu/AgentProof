import { array, object, enumeration, str, strings, contract, purposeHash, type PurposeSpec, type PurposeEvidence, type PurposeCoverage } from './purpose-contract';
import { buildPurposeSources } from './purpose-spec';
import { getPurposeDiffIndex } from './purpose-github';
import { extractReviewSnippets } from './review-snippets';
import { redactSecretsPreservingLines } from './redact';
import type { PullRequestInput } from './types';
import type { PurposeProvider } from './purpose-provider';
import type { LocateAction, PurposeRepository } from './purpose-repository';
export const localizationProposalSchema = object({ actions: array(object({ kind: enumeration('browse', 'inspect', 'definition', 'references', 'searchText'), targetId: str, view: enumeration('none', 'source', 'outline', 'diff'), startLine: { type: 'integer', minimum: 0, maximum: 1000000 }, endLine: { type: 'integer', minimum: 0, maximum: 1000000 }, cursor: { type: 'integer', minimum: 0, maximum: 20000 }, literal: { type: 'string', maxLength: 120 }, clauseId: str }), 4), clauses: array(object({ clauseId: str, implementationRefs: strings(16), definitionRefs: strings(16), callerRefs: strings(16), testSetupRefs: strings(16), testAssertionRefs: strings(16), counterEvidenceRefs: strings(16), searchState: enumeration('collected', 'partial_access', 'budget_limited', 'not_found_in_searched_scope') }), 32), stopReason: enumeration('continue', 'selected', 'budget', 'unresolved') });
export interface LocatedClause {
    clauseId: string;
    implementationRefs: string[];
    definitionRefs: string[];
    callerRefs: string[];
    testSetupRefs: string[];
    testAssertionRefs: string[];
    counterEvidenceRefs: string[];
    searchState: 'collected' | 'partial_access' | 'budget_limited' | 'not_found_in_searched_scope';
}
interface LocalizationProposal {
    actions: LocateAction[];
    clauses: LocatedClause[];
    stopReason: 'continue' | 'selected' | 'budget' | 'unresolved';
}
/** Request-specific wire contract; runtime still owns exposure, ranges and phase validation. */
export function localizationRequestSchema(spec: unknown, finalOnly: boolean): object {
    const schema: any = structuredClone(localizationProposalSchema);
    const clauseIds = (spec as PurposeSpec | undefined)?.goals?.flatMap(g => g.clauses.map(c => c.id)) ?? [];
    const clauseId = clauseIds.length ? enumeration(...clauseIds) : {...str, pattern: '^.+$'};
    const base = schema.properties.actions.items.properties;
    schema.properties.actions.items = {anyOf: [
        ['browse', '^ld_', ['none']],
        ['inspect', '^(lf_|lo_)', ['source', 'outline', 'diff']],
        ['definition', '^lo_', ['none']],
        ['references', '^(ld_|lo_)', ['none']],
        ['searchText', '^(ld_|lo_)', ['none']],
    ].map(([kind, pattern, views]) => object({...base, kind: enumeration(kind as string), targetId: {...str, pattern}, view: enumeration(...views as string[]), clauseId}))} as any;
    schema.properties.clauses.items.properties.clauseId = clauseId;
    if (finalOnly) {
        schema.properties.actions.maxItems = 0;
        schema.properties.clauses = {...schema.properties.clauses, minItems: clauseIds.length, maxItems: clauseIds.length} as any;
        schema.properties.stopReason = enumeration('selected', 'budget', 'unresolved');
    }
    return schema;
}
const valid = contract<LocalizationProposal>(localizationProposalSchema);
const roles = ['implementationRefs', 'definitionRefs', 'callerRefs', 'testSetupRefs', 'testAssertionRefs', 'counterEvidenceRefs'] as const;
export type LocalizationMode = 'hunk' | 'lexical' | 'structural' | 'ai';
export async function localizePurpose(input: PullRequestInput, spec: PurposeSpec, repository: PurposeRepository, options: {
    mode: LocalizationMode;
    flow?: 'explore_final_v1';
    invoke: PurposeProvider;
    signal?: AbortSignal;
    onInvalid?: (event: {
        reason: string;
        proposal: string;
        hash: string;
    }) => void;
}) {
    const clauses = spec.goals.flatMap(g => g.clauses), ids = new Set(clauses.map(c => c.id)), trace: {
        round: number;
        kind: string;
        targetId: string;
        resultHash: string;
    }[] = [], limitations: string[] = [];
    if (clauses.length > 32)
        throw new Error('localization_spec_budget');
    const signal = AbortSignal.any([options.signal ?? new AbortController().signal, AbortSignal.timeout(90000)]), started = performance.now();
    const guard = () => {
        signal.throwIfAborted();
        if (performance.now() - started > 90000)
            throw new Error('localization_deadline');
    };
    const cumulative = options.flow === 'explore_final_v1';
    const readOutcomes: PurposeCoverage['readOutcomes'] = [], omittedToolResults = new Set<number>();
    let selected: LocatedClause[] = [], calls = 0, results: any[] = [];
    const run = async (a: LocateAction) => {
        guard();
        if (!ids.has(a.clauseId))
            throw new Error('localization_clause_reference');
        let result;
        try { result = await repository.execute(a); }
        catch (error) {
            if (cumulative && error instanceof Error && error.message === 'localization_tool_reference') readOutcomes.push({round: calls, kind: a.kind, targetId: a.targetId, startLine: a.startLine, endLine: a.endLine, evidenceRefs: [], outcome: 'rejected'});
            throw error;
        }
        if (cumulative) readOutcomes.push({round: calls, kind: a.kind, targetId: a.targetId, startLine: result.evidence?.[0]?.startLine ?? a.startLine, endLine: result.evidence?.[0]?.endLine ?? a.endLine, evidenceRefs: (result.evidence ?? []).map((e: PurposeEvidence) => e.id), outcome: result.evidence?.length ? 'available' : a.kind === 'inspect' && a.view === 'source' ? 'unavailable' : 'metadata_only'});
        guard();
        trace.push({ round: calls, kind: a.kind, targetId: a.targetId, resultHash: purposeHash(result) });
        return result;
    };
    if (options.mode === 'ai') {
        for (let round = 0; round < 4; round++) {
            guard();
            calls++;
            // Each stateless request carries bounded actual earlier source, not metadata-only memory.
            const selectionSources: PurposeEvidence[] = [], omittedCandidates: {id: string; reason: string}[] = [];
            for (const candidate of repository.candidates) {
                const next = [...selectionSources, candidate];
                if (next.length > 16 || Buffer.byteLength(JSON.stringify(next)) > 48000)
                    omittedCandidates.push({id: candidate.id, reason: 'selection_context_budget'});
                else selectionSources.push(candidate);
            }
            const available = new Set(selectionSources.map(e => e.id));
            if (omittedCandidates.length && !limitations.includes('localization_packet_budget')) limitations.push('localization_packet_budget');
            // Avoid duplicating raw source in the latest tool results. Full retained code is above.
            let toolMetadata = results.map(({evidence, ...result}) => ({...result, ...(evidence ? {evidence: evidence.map(({content: _content, ...e}: PurposeEvidence) => e)} : {})}));
            if (cumulative) {
                const bounded: typeof toolMetadata = [];
                toolMetadata.forEach((result, index) => {
                    if (Buffer.byteLength(JSON.stringify([...bounded, result])) > 16000) omittedToolResults.add(index);
                    else bounded.push(result);
                });
                toolMetadata = bounded;
            }
            const proposal = await options.invoke({ stage: 'locate', ...(cumulative ? {flow: 'explore_final_v1' as const} : {}), sources: buildPurposeSources(input), spec, localization: { initial: repository.initial(), results: toolMetadata, ...(cumulative ? {readOutcomes, omittedToolResults: [...omittedToolResults]} : {}), selectionSources, omittedCandidates, selectionRule: 'Select only selectionSources IDs; metadata/omitted IDs are not available source. Code is never summarized or byte-truncated.', candidateMetadata: repository.candidates.map(({ content: _content, ...e }) => e), round, actionsRemaining: round === 3 ? 0 : 4, roundsRemaining: 3 - round, protocol: { validClauseIds: [...ids], actionResponse: {clauses: [], stopReason: 'continue'}, finalResponse: {actions: [], clauses: 'Every validClauseId exactly once; role refs must be shown selectionSources IDs, or honest unresolved searchState'}, tools: {browse: {targetKinds: ['directory'], view: 'none'}, inspect: {targetKinds: ['file', 'occurrence'], views: ['source', 'outline', 'diff']}, definition: {targetKinds: ['occurrence'], view: 'none'}, references: {targetKinds: ['directory', 'occurrence'], view: 'none'}, searchText: {targetKinds: ['directory', 'occurrence'], view: 'none', literal: 'Nonempty literal <=120 characters'}}, unusedFields: 'Use view=none, startLine=endLine=cursor=0, literal=empty when not used; clauseId is always required and valid.' }, limits: { sourceRangeLines: 80, sourceRangeBytes: 8000, sourceReads: 24, sourceBytes: 4194304, evidenceSlots: 16, evidenceBytes: 48000 }, rolesAreHypotheses: true } }, signal);
            guard();
            try {
                if (!valid(proposal) || proposal.actions.some(a => !ids.has(a.clauseId)) || new Set(proposal.clauses.map(c => c.clauseId)).size !== proposal.clauses.length)
                    throw new Error('localization_schema');
                if (proposal.actions.length) {
                    if (round === 3 || proposal.clauses.length || proposal.stopReason !== 'continue')
                        throw new Error('localization_action_budget');
                    if (!cumulative) results = [];
                    for (const action of proposal.actions)
                        results.push(await run(action));
                    continue;
                }
                if (proposal.stopReason === 'continue' || proposal.clauses.length !== clauses.length || proposal.clauses.some(c => !ids.has(c.clauseId)))
                    throw new Error('localization_clause_reference');
                for (const c of proposal.clauses) {
                    const refs = roles.flatMap(r => c[r]);
                    if (refs.some(id => !available.has(id)))
                        throw new Error('localization_selection_reference');
                    if (c.searchState === 'collected' && !refs.length)
                        throw new Error('localization_selection_reference');
                }
                selected = proposal.clauses.map(c => omittedCandidates.some(o => repository.candidates.find(e => e.id === o.id)?.clauseIds.includes(c.clauseId)) ? {...c, searchState: 'budget_limited' as const} : c);
                break;
            }
            catch (error) {
                // Content/schema/tool-ID failures are not retries. Fatal source/cancel failures still fail closed.
                const reason = error instanceof Error ? error.message : 'localization_invalid';
                if (!/^(localization_(schema|action_budget|clause_reference|selection_reference|tool_reference))$/.test(reason))
                    throw error;
                const body = redactSecretsPreservingLines(JSON.stringify(proposal));
                options.onInvalid?.({ reason, proposal: Buffer.from(body).subarray(0, 65536).toString('utf8'), hash: purposeHash(proposal) });
                limitations.push('localization_invalid');
                break;
            }
        }
    }
    else {
        const hint = getPurposeDiffIndex(input).locators;
        const first = clauses[0]?.id;
        const seeds = hint.length ? hint : input.changedFiles.flatMap(f => { const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/m.exec(f.patch ?? ''); return h ? [{ path: f.path, side: 'head' as const, startLine: Math.max(1, Number(h[1])), endLine: Math.max(1, Number(h[1])) + Math.min(79, Math.max(0, Number(h[2] ?? 1) - 1)) }] : []; });
        if (first && options.mode !== 'lexical')
            for (const h of seeds) {
                guard();
                await repository.collector.read({ ...h, clauseId: first, reason: 'Source hunk structural seed' });
            }
        if (options.mode === 'lexical') {
            const terms = clauses.map(c => ({ id: c.id, terms: [...new Set([c.expectedObservable, ...c.conditions, ...c.exceptions].join(' ').toLowerCase().match(/[a-z_][a-z0-9_]*/g) ?? [])].slice(0, 64), anchors: seeds.filter(h => h.side === 'head').map(({ path, startLine, endLine }) => ({ path, startLine, endLine })) }));
            const files = repository.fileLocators().filter(f => f.side === 'head').sort((a, b) => Number(input.changedFiles.some(f => f.path === b.path)) - Number(input.changedFiles.some(f => f.path === a.path)) || b.path.split('/').filter(p => terms.some(g => g.terms.includes(p.replace(/\.[^.]+$/, '')))).length - a.path.split('/').filter(p => terms.some(g => g.terms.includes(p.replace(/\.[^.]+$/, '')))).length || a.path.localeCompare(b.path)).slice(0, 24);
            const source = [];
            for (const f of files) {
                guard();
                const b = await repository.controlSource(f.id);
                if (b)
                    source.push({ path: f.path, headSha: f.revision, content: b.content });
            }
            const chosen = await extractReviewSnippets(source, terms);
            if (chosen.limitations.length)
                limitations.push('localization_partial');
            for (const e of chosen.snippets)
                for (const clauseId of e.goalIds)
                    await repository.collector.read({ path: e.path, side: 'head', startLine: e.startLine, endLine: e.endLine, clauseId, reason: 'Matched lexical control' });
        }
        if (first && options.mode === 'structural') {
            const changed = repository.initial().changed.filter(f => f.side === 'head');
            let followed = 0;
            for (const f of changed) {
                guard();
                if (followed++ >= 8)
                    break;
                const b = await repository.controlSource(f.id);
                if (!b)
                    continue;
                // Relative imports are structural location hints. No text name is promoted to a resolved binding.
                const root = f.path.slice(0, Math.max(0, f.path.lastIndexOf('/')));
                const relatives = jsImports(b.content, root);
                const basename = f.path.split('/').at(-1)!.replace(/\.[^.]+$/, '');
                const next = repository.fileLocators().filter(x => x.side === 'head' && (relatives.includes(x.path) || /(?:test|spec)/i.test(x.path) && x.path.split('/').at(-1)!.includes(basename))).slice(0, 4);
                for (const target of next) {
                    const source = await repository.controlSource(target.id);
                    if (!source)
                        continue;
                    const end = Math.min(80, source.content.split('\n').length);
                    await repository.collector.read({ path: target.path, side: 'head', startLine: 1, endLine: end, clauseId: first, reason: 'Structural import/test path candidate' });
                }
            }
        }
    }
    if (!selected.length) {
        selected = clauses.map(c => ({ clauseId: c.id, implementationRefs: repository.candidates.filter(e => e.clauseIds.includes(c.id)).map(e => e.id), definitionRefs: [], callerRefs: [], testSetupRefs: [], testAssertionRefs: [], counterEvidenceRefs: [], searchState: 'budget_limited' }));
        if (!repository.candidates.length)
            selected = selected.map(c => ({ ...c, searchState: 'not_found_in_searched_scope' }));
    }
    const evidence = repository.select(selected.flatMap(c => roles.flatMap(r => c[r].map(id => ({ id, clauseId: c.clauseId })))), cumulative);
    const requested = new Set(selected.flatMap(c => roles.flatMap(r => c[r])));
    const included = new Set(evidence.map(e => e.id));
    if (cumulative && selected.some(c => c.counterEvidenceRefs.some(id => !included.has(id)))) throw new Error('purpose_final_counterevidence_budget');
    const coverage: PurposeCoverage = {
        omittedEvidence: repository.candidates.filter(e => !included.has(e.id)).map(({id,path,side,revision,startLine,endLine}) => ({id,path,side,revision,startLine,endLine,reason: cumulative || requested.has(id) ? 'packet_budget' : 'not_selected'})),
        readOutcomes, omittedToolResults: [...omittedToolResults],
    };
    // If a selected reference is rejected by packet cap, role completeness must also be downgraded.
    const sent = new Set(evidence.map(e => e.id));
    selected = selected.map(c => {
        const dropped = roles.some(r => c[r].some(id => !sent.has(id)));
        const kept = { ...c };
        for (const role of roles)
            kept[role] = c[role].filter(id => sent.has(id));
        return { ...kept, searchState: dropped ? 'budget_limited' as const : c.searchState };
    });
    return { evidence, coverage, clauses: selected, trace, calls, limitations: [...new Set([...limitations, ...repository.limitations])], elapsedMs: performance.now() - started, collector: repository.collector, sourceSpecHash: purposeHash(spec) };
}
import ts from 'typescript';
import path from 'node:path';
function jsImports(content: string, root: string) { return ts.preProcessFile(content, true, false).importedFiles.filter(x => x.fileName.startsWith('.')).flatMap(x => { const p = path.posix.normalize(path.posix.join(root, x.fileName)); return [p, p + '.ts', p + '.tsx', p + '.js', p + '.jsx', p + '/index.ts', p + '/index.js']; }); }
