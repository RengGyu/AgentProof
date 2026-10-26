import { selectCanonicalSelectedSourceBundle } from "./extractors";
import { createHash } from "node:crypto";
import { buildGeneralPrObservationSeedV2 } from './general-pr-observation-source';
import { redactSecrets } from './redact';
import type { PullRequestInput } from './types';
import { isPurposeProposal, isPurposeExploreProposal, purposeHash, type PurposeSpec } from './purpose-contract';
export function buildPurposeSources(input: PullRequestInput) {
    const seed = buildGeneralPrObservationSeedV2(input);
    const canonical = selectCanonicalSelectedSourceBundle(input), selectedKind = input.taskText.trim() ? (input.taskSource === "issue" ? "linked_issue" : "provided_requirement") : "pr_body";
    const views = new Map(seed.sources.map(s => [s.id, redactSecrets((s.kind === 'provided_requirement' || s.kind === 'linked_issue' ? input.taskText : s.kind === 'pr_title' ? input.title : input.description).replace(/\r\n?/g, '\n'))]));
    const spans = seed.spans.slice(0, 256).flatMap(s => { const view = views.get(s.sourceUnitId) ?? ''; const text = view.length <= 24000 ? view.slice(s.start, s.end) : ''; if (text && createHash('sha256').update(text).digest('hex') !== s.textHash)
        throw new Error('purpose_source_hash'); return purposeHash(text) === purposeHash('') || !text ? [] : [{ id: s.id, kind: seed.sources.find(source=>source.id===s.sourceUnitId)!.kind, sourceUnitId:s.sourceUnitId, authority: s.authorityCeiling, text, start: s.start, end: s.end, textHash: s.textHash, canonicalAliases: seed.sources.find(source=>source.id===s.sourceUnitId)?.kind===selectedKind ? [...canonical.structureByRequirementId].filter(([,span])=>span.start===s.start&&span.end===s.end).flatMap(([id])=>{const r=canonical.canonical.requirements.find(r=>r.reportRequirementId===id);return r?[{id,text:r.text}]:[];}) : [] }]; });
    return { sourceBundleHash: seed.seedHash, headSha: seed.headSha, baseSha: seed.baseSha, complete: seed.parseState === 'complete' && seed.spans.length <= 256 && seed.sources.every(s => (views.get(s.id)?.length ?? 0) <= 24000), spans };
}
export function compilePurposeSpec(input: PullRequestInput, value: unknown, flow?: 'explore_final_v1'): PurposeSpec {
    const source = buildPurposeSources(input);
    let proposal = value;
    if (flow === 'explore_final_v1') {
        if (!isPurposeExploreProposal(value)) throw new Error('purpose_spec_invalid');
        const available = new Set(source.spans.map(s => s.id));
        const used = new Set(value.goals.flatMap(g => g.clauses.flatMap(c => c.sourceRefs)));
        if ([...used].some(id => !available.has(id))) throw new Error('purpose_source_closure');
        proposal = {goals: value.goals.map(g => ({sourceRefs: [...new Set(g.clauses.flatMap(c => c.sourceRefs))], clauses: g.clauses})), contextRefs: [], unprocessedSourceRefs: source.spans.filter(s => !used.has(s.id)).map(s => s.id), ambiguities: value.ambiguities};
    }
    if (!isPurposeProposal(proposal) || !source.headSha || !source.baseSha || proposal.goals.reduce((n, g) => n + g.clauses.length, 0) > 32)
        throw new Error('purpose_spec_invalid');
    const available = new Map(source.spans.map(s => [s.id, s]));
    const refs = [...proposal.contextRefs, ...proposal.unprocessedSourceRefs, ...proposal.goals.flatMap(g => [...g.sourceRefs, ...g.clauses.flatMap(c => c.sourceRefs)])];
    if (refs.some(r => !available.has(r)) || source.spans.some(s => !refs.includes(s.id)) || proposal.goals.some(g => !g.sourceRefs.length || !g.clauses.length || g.clauses.some(c => !c.sourceRefs.length || c.sourceRefs.some(r => !g.sourceRefs.includes(r)))))
        throw new Error('purpose_source_closure');
    // No semantic alias to a canonical requirement. Only exact whole-source equality may own one.
    const goals = proposal.goals.map(g => {
        const authority = g.sourceRefs.every(r => available.get(r)?.authority === 'authoritative') ? 'authoritative' as const : 'author_claim' as const;
        const clauses = g.clauses.map(c => ({ ...c, id: `pc_${purposeHash([source.sourceBundleHash, c]).slice(0, 24)}`, canonicalRequirementIds: c.sourceRefs.length===1&&!c.conditions.length&&!c.exceptions.length ? (available.get(c.sourceRefs[0])?.canonicalAliases??[]).filter(a=>a.text===c.expectedObservable).map(a=>a.id) : [] }));
        return { id: `pg_${purposeHash([source.sourceBundleHash, g]).slice(0, 24)}`, sourceRefs: [...g.sourceRefs], authority, clauses };
    });
    if (new Set(goals.flatMap(g => g.clauses.map(c => c.id))).size !== goals.reduce((n, g) => n + g.clauses.length, 0))
        throw new Error('purpose_duplicate_clause');
    return { version: 1, sourceBundleHash: source.sourceBundleHash, headSha: source.headSha, baseSha: source.baseSha, goals, unprocessedSourceRefs: proposal.unprocessedSourceRefs, ambiguities: [...proposal.ambiguities, ...(!source.complete ? ['source_incomplete'] : [])] };
}

/** Final units retain original member qualifiers; membership is provenance, not a semantic correctness proof. */
export function compilePurposeUnitSpec(original: PurposeSpec, proposal: import('./purpose-contract').PurposeUnitProposal, source: ReturnType<typeof buildPurposeSources>) {
    const candidates=new Map(original.goals.flatMap(g=>g.clauses.map(c=>[c.id,c] as const)));
    const spans=new Map(source.spans.map(s=>[s.id,s]));
    const rows: import('./purpose-contract').PurposeFacts['clauses']=[];
    const goals=proposal.units.map(unit=>{
        const members=unit.candidateClauseIds.map(id=>candidates.get(id)!);
        const sourceRefs=[...new Set(members.flatMap(c=>c.sourceRefs))];
        if(sourceRefs.length>32 || sourceRefs.some(id=>!spans.has(id)))throw new Error('purpose_source_closure');
        const identity=[original.sourceBundleHash,[...unit.candidateClauseIds].sort(),unit.purpose];
        const clauseId='pc_'+purposeHash(identity).slice(0,24), goalId='pg_'+purposeHash(identity).slice(0,24);
        const exact=members.length===1&&members[0].expectedObservable===unit.purpose;
        const clause: import('./purpose-contract').PurposeClause={id:clauseId,sourceRefs,canonicalRequirementIds:exact?[...members[0].canonicalRequirementIds]:[],expectedObservable:unit.purpose,conditions:[],exceptions:[],obligation:members.some(c=>c.obligation==='ambiguous')?'ambiguous':members.some(c=>c.obligation==='required')?'required':'optional',evidenceNeed:exact?members[0].evidenceNeed:members.every(c=>c.evidenceNeed==='static')?'static':'behavioral'};
        const {candidateClauseIds:_ids,purpose,...row}=unit;
        rows.push({...row,clauseId,purpose,intentMembers:members.map(m=>({clauseId:m.id,purpose:m.expectedObservable,conditions:[...m.conditions],exceptions:[...m.exceptions]}))});
        return {id:goalId,sourceRefs,authority:sourceRefs.every(r=>spans.get(r)!.authority==='authoritative')?'authoritative' as const:'author_claim' as const,clauses:[clause]};
    });
    return {spec:{...original,goals},rows};
}
