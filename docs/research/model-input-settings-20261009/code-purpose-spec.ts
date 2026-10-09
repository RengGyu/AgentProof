import { selectCanonicalSelectedSourceBundle } from "./extractors";
import { createHash } from "node:crypto";
import { buildGeneralPrObservationSeedV2 } from './general-pr-observation-source';
import { redactSecrets } from './redact';
import type { PullRequestInput } from './types';
import { isPurposeProposal, purposeHash, type PurposeSpec } from './purpose-contract';
export function buildPurposeSources(input: PullRequestInput) {
    const seed = buildGeneralPrObservationSeedV2(input);
    const canonical = selectCanonicalSelectedSourceBundle(input), selectedKind = input.taskText.trim() ? (input.taskSource === "issue" ? "linked_issue" : "provided_requirement") : "pr_body";
    const views = new Map(seed.sources.map(s => [s.id, redactSecrets((s.kind === 'provided_requirement' || s.kind === 'linked_issue' ? input.taskText : s.kind === 'pr_title' ? input.title : input.description).replace(/\r\n?/g, '\n'))]));
    const spans = seed.spans.slice(0, 256).flatMap(s => { const view = views.get(s.sourceUnitId) ?? ''; const text = view.length <= 24000 ? view.slice(s.start, s.end) : ''; if (text && createHash('sha256').update(text).digest('hex') !== s.textHash)
        throw new Error('purpose_source_hash'); return purposeHash(text) === purposeHash('') || !text ? [] : [{ id: s.id, authority: s.authorityCeiling, text, start: s.start, end: s.end, textHash: s.textHash, canonicalAliases: seed.sources.find(source=>source.id===s.sourceUnitId)?.kind===selectedKind ? [...canonical.structureByRequirementId].filter(([,span])=>span.start===s.start&&span.end===s.end).flatMap(([id])=>{const r=canonical.canonical.requirements.find(r=>r.reportRequirementId===id);return r?[{id,text:r.text}]:[];}) : [] }]; });
    return { sourceBundleHash: seed.seedHash, headSha: seed.headSha, baseSha: seed.baseSha, complete: seed.parseState === 'complete' && seed.spans.length <= 256 && seed.sources.every(s => (views.get(s.id)?.length ?? 0) <= 24000), spans };
}
export function compilePurposeSpec(input: PullRequestInput, proposal: unknown): PurposeSpec {
    const source = buildPurposeSources(input);
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
