import type { LocateAction } from './purpose-repository';
import { it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { buildPurposeSources, compilePurposeSpec } from './purpose-spec';
import { purposeHash } from './purpose-contract';
import { assessPurpose } from './purpose-assessment';
import { generateVerificationReportV2FromInput } from './verifier';
import type { PullRequestInput } from './types';
const head = 'a'.repeat(40), base = 'b'.repeat(40);
const input = { title: 'Keep outstanding work', description: 'Preserve jobs until complete.', taskText: '', url: 'https://github.com/acme/jobs/pull/1', repositoryPrivate: false, changedFiles: [{ path: 'src/start.ts', patch: '@@ -1 +1 @@\n-old\n+dispatch();', status: 'modified' }], checks: [], logs: [], sourceProvenance: { version: 1, origin: 'github_snapshot', headSha: head, baseSha: base, evidenceCapturedAt: '2026-10-07T00:00:00Z', inputFingerprint: { version: 1, algorithm: 'sha256', value: 'c'.repeat(64), coverage: 'github_metadata' } } } as PullRequestInput;
const files: Record<string, string> = { 'src/start.ts': 'import { retain } from "./state";\nexport function dispatch() {\n  return retain();\n}', 'src/state.ts': 'export function retain() {\n  return 7;\n}', 'test/state.test.ts': 'import { retain } from "../src/state";\nfunction assertion() {\n  if (retain() !== 7) throw Error("state");\n}', 'other/opaque.py': 'def identity():\n    return 42\n' };
const sha = (s: string) => createHash('sha1').update('blob ' + Buffer.byteLength(s) + '\0').update(s).digest('hex');
function fixture(contents = files) {
    const entries = Object.entries(contents).map(([path, content]) => ({ path, blobSha: sha(content), size: Buffer.byteLength(content), mode: '100644' as const }));
    const read = vi.fn(async (e: any, revision: string) => ({ path: e.path, revision, blobSha: e.blobSha, content: contents[e.path], complete: true, bytesRead: Buffer.byteLength(contents[e.path]) }));
    return { manifest: vi.fn(async (side: any, revision: string) => ({ repository: 'acme/jobs', revision, treeSha: 'c'.repeat(40), complete: true, entries })), readBlob: read };
}
function spec() { const s = buildPurposeSources(input); return compilePurposeSpec(input, { goals: [{ sourceRefs: [s.spans[0].id], clauses: [{ sourceRefs: [s.spans[0].id], expectedObservable: 'Preserve outstanding jobs', conditions: [], exceptions: [], obligation: 'required', evidenceNeed: 'behavioral' }] }], contextRefs: s.spans.slice(1).map(x => x.id), unprocessedSourceRefs: [], ambiguities: [] }); }
const action = (kind: LocateAction['kind'], targetId: string, clauseId = spec().goals[0].clauses[0].id, extra: Partial<LocateAction> = {}): LocateAction => ({ kind, targetId, view: 'none', startLine: 0, endLine: 0, cursor: 0, literal: '', clauseId, ...extra });
async function repo(backend = fixture(), options = {}) { const { createPurposeRepository } = await import('./purpose-repository'); return createPurposeRepository(input, backend, { signal: new AbortController().signal, ...options }); }
it('manifest browsing exposes unchanged files without purpose-word matching and binds SHA/blob/source', async () => {
    const r = await repo();
    const root = r.initial().roots.find((x: any) => x.side === 'head')!;
    const a = await r.execute(action('browse', root.id));
    const other = a.items.find((x: any) => x.path === 'other')!;
    const b = await r.execute(action('browse', other.id));
    const f = b.items.find((x: any) => x.path === 'other/opaque.py')!;
    const v = await r.execute(action('inspect', f.id, undefined, { view: 'source', startLine: 2, endLine: 2 }));
    expect(v.evidence[0].content).toContain('return 42');
    expect(v.evidence[0].revision).toBe(head);
    expect(v.evidence[0].rawHash).toHaveLength(64);
    expect(v.capabilities.symbolBinding).toBe('unsupported');
    r.dispose();
});
it('public-only gate, wrong SHA, duplicate manifest and forged complete blob fail before source exposure', async () => {
    const { createPurposeRepository } = await import('./purpose-repository');
    const b = fixture();
    await expect(createPurposeRepository({ ...input, repositoryPrivate: true }, b, { signal: new AbortController().signal })).rejects.toThrow('localization_public_required');
    expect(b.manifest).not.toHaveBeenCalled();
    const wrong = { ...fixture(), manifest: async () => ({ repository: 'acme/jobs', revision: base, treeSha: head, complete: true, entries: [] }) };
    await expect(repo(wrong as any)).rejects.toThrow('localization_manifest_invalid');
    const b2 = fixture();
    b2.readBlob.mockImplementation(async (e: any, revision: string) => ({ path: e.path, revision, blobSha: e.blobSha, content: 'forged', complete: true, bytesRead: 6 }));
    const r = await repo(b2);
    await expect(r.execute(action('inspect', r.initial().changed[0].id, undefined, { view: 'source', startLine: 1, endLine: 1 }))).rejects.toThrow('localization_blob_invalid');
    r.dispose();
});
it('rejects invented tool references and unbounded traversal before backend reads', async () => {
    const b = fixture(), r = await repo(b);
    await expect(r.execute(action('inspect', 'https://evil.test', undefined, { view: 'source', startLine: 1, endLine: 1 }))).rejects.toThrow('localization_tool_reference');
    await expect(r.execute(action('inspect', r.initial().changed[0].id, undefined, { view: 'source', startLine: 1, endLine: 1000001 }))).rejects.toThrow();
    expect(b.readBlob).not.toHaveBeenCalled();
    r.dispose();
});
it('inspects full bounded TS function context and labels a longer unit as split rather than complete', async () => {
    const r = await repo(fixture({ 'src/start.ts': 'export function unrelated() {\n  const a = 1;\n  return a;\n}' }));
    const v = await r.execute(action('inspect', r.initial().changed[0].id, undefined, { view: 'source', startLine: 3, endLine: 3 }));
    expect(v.evidence[0].startLine).toBe(1);
    expect(v.evidence[0].endLine).toBe(4);
    expect(v.unitCompleteness).toBe('full_unit');
    r.dispose();
    const z = await repo(fixture({ 'src/start.ts': 'export function long() {\n' + '  void 1;\n'.repeat(90) + '}' }));
    const p = await z.execute(action('inspect', z.initial().changed[0].id, undefined, { view: 'source', startLine: 2, endLine: 2 }));
    expect(p.unitCompleteness).toBe('split_unit');
    expect(p.evidence[0].endLine - p.evidence[0].startLine).toBeLessThan(80);
    z.dispose();
});
it('same-source reads share budget and cancellation stops future tools', async () => {
    const b = fixture(), r = await repo(b, { maxReads: 1 });
    const id = r.initial().changed[0].id;
    await r.execute(action('inspect', id, undefined, { view: 'source', startLine: 1, endLine: 1 }));
    await r.execute(action('inspect', id, undefined, { view: 'source', startLine: 2, endLine: 2 }));
    expect(b.readBlob).toHaveBeenCalledTimes(1);
    expect(r.metrics().attempts).toBe(1);
    r.dispose();
    const abort = new AbortController();
    const q = await repo(fixture(), { signal: abort.signal });
    abort.abort();
    await expect(q.execute(action('browse', q.initial().roots[0].id))).rejects.toThrow();
    q.dispose();
});
it('JS/TS definition resolves loaded relative binding only; Python symbols remain unsupported', async () => {
    const r = await repo();
    const first = await r.execute(action('inspect', r.initial().changed[0].id, undefined, { view: 'outline' }));
    const root = r.initial().roots.find((x: any) => x.side === 'head')!;
    const top = await r.execute(action('browse', root.id));
    const dir = top.items.find((x: any) => x.path === 'src');
    const listing = await r.execute(action('browse', dir.id));
    const state = listing.items.find((x: any) => x.path === 'src/state.ts');
    await r.execute(action('inspect', state.id, undefined, { view: 'outline' }));
    const occ = first.occurrences.filter((x: any) => x.name === 'retain').at(-1)!;
    const d = await r.execute(action('definition', occ.id));
    expect(d.resolution).toBe('resolved_static');
    expect(d.targets.some((x: any) => x.path === 'src/state.ts')).toBe(true);
    r.dispose();
});
it('search scans unread manifest scope with an honest cursor and never claims semantic search', async () => {
    const b = fixture({ ...files, ...Object.fromEntries(Array.from({ length: 7 }, (_, i) => ['extra/f' + i + '.py', 'match_token\n'])) }), r = await repo(b);
    const roots = await r.execute(action('browse', r.initial().roots.find((x: any) => x.side === 'head')!.id));
    const d = roots.items.find((x: any) => x.path === 'extra');
    const h = await r.execute(action('searchText', d.id, undefined, { literal: 'match_token' }));
    expect(h.filesScanned).toBe(4);
    expect(h.filesAvailable).toBe(7);
    expect(h.complete).toBe(false);
    expect(h.nextCursor).toBe(4);
    expect(h.resolution).toBe('literal_only');
    expect(b.readBlob).toHaveBeenCalledTimes(4);
    r.dispose();
});
it('AI direct-browse selects actual source outside lexical candidates and passes it to normal assessor', async () => {
    const b = fixture(), s = spec(), seen: any[] = [];
    let phase = 0;
    const provider = vi.fn(async (q: any) => {
        seen.push(q);
        if (q.stage === 'locate') {
            if (phase++ === 0)
                return { actions: [action('browse', q.localization.initial.roots.find((x: any) => x.side === 'head').id)], clauses: [], stopReason: 'continue' };
            if (phase === 2)
                return { actions: [action('browse', q.localization.results[0].items.find((x: any) => x.path === 'other').id)], clauses: [], stopReason: 'continue' };
            if (phase === 3)
                return { actions: [action('inspect', q.localization.results[0].items[0].id, undefined, { view: 'source', startLine: 1, endLine: 2 })], clauses: [], stopReason: 'continue' };
            return { actions: [], clauses: [{ clauseId: s.goals[0].clauses[0].id, implementationRefs: [q.localization.results[0].evidence[0].id], definitionRefs: [], callerRefs: [], testSetupRefs: [], testAssertionRefs: [], counterEvidenceRefs: [], searchState: 'collected' }], stopReason: 'selected' };
        }
        return { clauses: [{ clauseId: s.goals[0].clauses[0].id, implementation: 'supports', testRelation: 'unknown', evidenceRefs: q.evidence.map((e: any) => e.id), counterEvidenceRefs: [], openQuestions: ['Runtime not checked'] }], readRequests: [], searchRequests: [] };
    });
    const r = await assessPurpose(input, generateVerificationReportV2FromInput(input), { mode: 'shadow', variant: 'fixed', frozenSpec: s, provider, localization: { mode: 'ai', backend: b } } as any);
    const sent = seen.find(q => q.stage === 'assess');
    expect(sent.evidence[0].path).toBe('other/opaque.py');
    expect(r.metrics!.calls).toBe(5);
    expect(r.assessment!.overall).toBe('partial');
    expect(r.report.purposeAssessment).toBeUndefined();
    expect(seen.filter(q => q.stage === 'locate')).toHaveLength(4);
});
it('off ignores localization and preserves identity, private opt-in never calls planner/backend', async () => {
    const report = generateVerificationReportV2FromInput(input), b = fixture(), p = vi.fn();
    expect((await assessPurpose(input, report, { mode: 'off', provider: p, localization: { mode: 'ai', backend: b } } as any)).report).toBe(report);
    expect(b.manifest).not.toHaveBeenCalled();
    await expect(assessPurpose({ ...input, repositoryPrivate: true }, report, { mode: 'shadow', privateConsent: true, providerRetentionApproved: true, provider: p, localization: { mode: 'ai', backend: b } } as any)).rejects.toThrow('localization_public_required');
    expect(p).not.toHaveBeenCalled();
});
it('invalid model selection is privately captured and no invented source or automatic paid retry is sent downstream', async () => {
    const { localizePurpose } = await import('./purpose-localization');
    const r = await repo(), diagnostic = vi.fn(), p = vi.fn(async () => ({ actions: [], clauses: [{ clauseId: spec().goals[0].clauses[0].id, implementationRefs: ['invented'], definitionRefs: [], callerRefs: [], testSetupRefs: [], testAssertionRefs: [], counterEvidenceRefs: [], searchState: 'collected' }], stopReason: 'selected' }));
    const out = await localizePurpose(input, spec(), r, { mode: 'ai', invoke: p, onInvalid: diagnostic });
    expect(out.evidence).toEqual([]);
    expect(out.limitations).toContain('localization_invalid');
    expect(p).toHaveBeenCalledTimes(1);
    expect(diagnostic.mock.calls[0][0].reason).toBe('localization_selection_reference');
    r.dispose();
});
it('unread relative import cannot be promoted to resolved binding; exact revision scopes stay separate', async () => {
    const r = await repo();
    const outline = await r.execute(action('inspect', r.initial().changed[0].id, undefined, { view: 'outline' }));
    const o = outline.occurrences.filter((x: any) => x.name === 'retain').at(-1);
    const d = await r.execute(action('definition', o.id));
    expect(d.resolution).toBe('unresolved');
    expect(d.targets).toEqual([]);
    r.dispose();
});
it('packet selection enforces real UTF8 serialized bytes and slots without hidden replacement', async () => {
    const more = Object.fromEntries(Array.from({ length: 17 }, (_, i) => ['pad/f' + i + '.py', '# ' + ('界 '.repeat(1200))]));
    const r = await repo(fixture({ ...files, ...more }));
    for (const f of r.fileLocators().filter(x => x.side === 'head' && x.path.startsWith('pad/')))
        await r.collector.read({ path: f.path, side: 'head', startLine: 1, endLine: 1, clauseId: spec().goals[0].clauses[0].id, reason: 'source' });
    const packet = r.select(r.candidates.map(e => ({ id: e.id, clauseId: spec().goals[0].clauses[0].id })));
    expect(packet.length).toBeLessThanOrEqual(16);
    expect(Buffer.byteLength(JSON.stringify(packet))).toBeLessThanOrEqual(48000);
    expect(r.limitations).toContain('localization_packet_budget');
    expect(packet[0].path).toBe('pad/f0.py');
    r.dispose();
});
it('redacts complete source before exposing selected windows and rejects duplicate manifest entries', async () => {
    const source = '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----\nreturn_value = 1';
    const r = await repo(fixture({ 'src/start.ts': source }));
    const result = await r.execute(action('inspect', r.initial().changed[0].id, undefined, { view: 'source', startLine: 2, endLine: 3 }));
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result.evidence[0].startLine).toBe(2);
    r.dispose();
    const b = fixture();
    const original = b.manifest;
    b.manifest = vi.fn(async (side: any, revision: string) => { const m = await original(side, revision); return { ...m, entries: [...m.entries, m.entries[0]] }; });
    await expect(repo(b)).rejects.toThrow('localization_manifest_invalid');
});
it('structural control follows relative import candidates with same source store, never claiming graph relevance verified', async () => {
    const { localizePurpose } = await import('./purpose-localization');
    const r = await repo();
    const v = await localizePurpose(input, spec(), r, { mode: 'structural', invoke: vi.fn() });
    expect(v.evidence.some(e => e.path === 'src/state.ts')).toBe(true);
    expect(v.calls).toBe(0);
    expect(r.metrics().attempts).toBeLessThanOrEqual(24);
    r.dispose();
});
it('malformed action stops one locate response with no tool read or paid retry', async () => {
    const { localizePurpose } = await import('./purpose-localization');
    const r = await repo();
    const p = vi.fn(async () => ({ actions: [action('inspect', 'not-issued', undefined, { view: 'source', startLine: 1, endLine: 1 })], clauses: [], stopReason: 'continue' }));
    const v = await localizePurpose(input, spec(), r, { mode: 'ai', invoke: p });
    expect(v.limitations).toContain('localization_invalid');
    expect(r.metrics().attempts).toBe(0);
    expect(p).toHaveBeenCalledTimes(1);
    r.dispose();
});
it('merging selected IDs across many clauses keeps serialized packet bounds atomically', async () => {
    const more = Object.fromEntries(Array.from({ length: 9 }, (_, i) => ['pads/f' + i + '.py', '# ' + ('界 '.repeat(1200))]));
    const r = await repo(fixture({ ...files, ...more }));
    for (const f of r.fileLocators().filter(x => x.side === 'head' && x.path.startsWith('pads/')))
        await r.collector.read({ path: f.path, side: 'head', startLine: 1, endLine: 1, clauseId: 'first', reason: 'source' });
    const refs = Array.from({ length: 32 }, (_, i) => r.candidates.map(e => ({ id: e.id, clauseId: 'pc_' + ('0'.repeat(22)) + i }))).flat();
    const v = r.select(refs);
    expect(Buffer.byteLength(JSON.stringify(v))).toBeLessThanOrEqual(48000);
    r.dispose();
});
it('small non-JS whole source is returned as context, never a false full-unit label on one selected line', async () => {
    const r = await repo();
    const target = r.fileLocators().find(x => x.side === 'head' && x.path === 'other/opaque.py')!;
    const b = await r.collector.read({ path: target.path, side: 'head', startLine: 2, endLine: 2, clauseId: 'c', reason: 'source' });
    expect(b!.content).toContain('def identity():');
    expect(b!.startLine).toBe(1);
    r.dispose();
});
it('packet-dropped source IDs are not handed to the downstream assessor as available role refs', async () => {
    const { localizePurpose } = await import('./purpose-localization');
    const more = Object.fromEntries(Array.from({ length: 12 }, (_, i) => ['pad/f' + i + '.py', '# ' + ('界 '.repeat(1200))]));
    const r = await repo(fixture(more)), clauseId = spec().goals[0].clauses[0].id;
    for (const f of r.fileLocators().filter(x => x.side === 'head'))
        await r.collector.read({ path: f.path, side: 'head', startLine: 1, endLine: 1, clauseId, reason: 'source' });
    const chosen = r.candidates.map(e => e.id);
    const out = await localizePurpose(input, spec(), r, { mode: 'ai', invoke: vi.fn(async (q: any) => ({ actions: [], clauses: [{ clauseId, implementationRefs: q.localization.selectionSources.map((e: any) => e.id), definitionRefs: [], callerRefs: [], testSetupRefs: [], testAssertionRefs: [], counterEvidenceRefs: [], searchState: 'collected' }], stopReason: 'selected' })) });
    expect(out.evidence.length).toBeLessThan(chosen.length);
    const sent = new Set(out.evidence.map(e => e.id));
    expect(out.clauses[0].implementationRefs.every(id => sent.has(id))).toBe(true);
    expect(out.clauses[0].searchState).toBe('budget_limited');
    r.dispose();
});
it('bounded references return static loaded witnesses and never repository-wide or runtime completeness', async () => {
    const r = await repo();
    for (const f of r.fileLocators().filter(x => x.side === 'head')) {
        await r.controlSource(f.id);
        await r.execute(action('inspect', f.id, undefined, { view: 'outline' }));
    }
    const source = r.fileLocators().find(x => x.side === 'head' && x.path === 'src/start.ts')!;
    const outline = await r.execute(action('inspect', source.id, undefined, { view: 'outline' }));
    const call = outline.occurrences.filter((x: any) => x.name === 'retain').at(-1);
    const result = await r.execute(action('references', call.id));
    expect(result.hits.some((x: any) => x.fileId === r.fileLocators().find(f => f.side === 'head' && f.path === 'test/state.test.ts')!.id)).toBe(true);
    expect(result.resolution).toBe('loaded_subset_static');
    expect(result.capabilities.projectCompleteness).toBe('loaded_subset_only');
    expect(result.capabilities.execution).toBe('never');
    r.dispose();
});
it('source byte admission prevents the next large read before backend I/O', async () => {
    const b = fixture(Object.fromEntries(Array.from({ length: 5 }, (_, i) => ['data/f' + i + '.py', '#'.repeat(1048576)]))), r = await repo(b);
    for (const f of r.fileLocators().filter(x => x.side === 'head'))
        await r.controlSource(f.id);
    expect(b.readBlob).toHaveBeenCalledTimes(4);
    expect(r.metrics().bytes).toBe(4194304);
    expect(r.limitations).toContain('localization_source_budget');
    r.dispose();
});
it('normal assessor refinements share source store and call caps while leaving execution authority unchanged', async () => {
    const s = spec(), cid = s.goals[0].clauses[0].id, seen: any[] = [];
    const provider = vi.fn(async (q: any) => {
        seen.push(q);
        if (q.stage === 'check')
            return { disputes: [] };
        return { clauses: [{ clauseId: cid, implementation: 'supports', testRelation: 'unknown', evidenceRefs: q.evidence.map((e: any) => e.id), counterEvidenceRefs: [], openQuestions: [] }], readRequests: seen.filter(x => x.stage === 'assess').length === 1 ? [{ clauseId: cid, path: 'src/state.ts', side: 'head', startLine: 1, endLine: 3, reason: 'Inspect helper' }] : [], searchRequests: [] };
    });
    const out = await assessPurpose(input, generateVerificationReportV2FromInput(input), { mode: 'shadow', frozenSpec: s, provider, localization: { mode: 'hunk', backend: fixture() } });
    expect(seen.filter(q => q.stage === 'assess')).toHaveLength(2);
    expect(seen[1].evidence.some((e: any) => e.path === 'src/state.ts')).toBe(true);
    expect(out.metrics!.attempts).toBe(2);
    expect(out.metrics!.calls).toBeLessThanOrEqual(9);
    expect(out.assessment!.goals[0].clauseResults[0].execution).toBe('not_observed');
    expect(out.assessment!.overall).toBe('partial');
});
it('full-unit expansion never drops the end of an explicitly requested multi-unit source interval', async () => {
    const r = await repo(fixture({ 'src/start.ts': 'export function first() {\n  return 1;\n}\nexport function second() {\n  return 2;\n}' }));
    const v = await r.execute(action('inspect', r.initial().changed[0].id, undefined, { view: 'source', startLine: 1, endLine: 6 }));
    expect(v.evidence[0].content).toContain('return 2;');
    expect(v.evidence[0].endLine).toBe(6);
    r.dispose();
});
it('final selection retains early inspected raw source when later rounds only return outlines', async () => {
    const { localizePurpose } = await import('./purpose-localization');
    const r = await repo(), cid = spec().goals[0].clauses[0].id; let phase = 0; const seen: any[] = [];
    const invoke = vi.fn(async (q: any) => {
        seen.push(q); phase++;
        const target = q.localization.initial.changed.find((x: any) => x.side === 'head').id;
        if (phase === 1) return {actions:[action('inspect',target,cid,{view:'source',startLine:1,endLine:4})],clauses:[],stopReason:'continue'};
        if (phase < 4) return {actions:[action('inspect',target,cid,{view:'outline'})],clauses:[],stopReason:'continue'};
        return {actions:[],clauses:[{clauseId:cid,implementationRefs:[q.localization.candidateMetadata[0].id],definitionRefs:[],callerRefs:[],testSetupRefs:[],testAssertionRefs:[],counterEvidenceRefs:[],searchState:'collected'}],stopReason:'selected'};
    });
    await localizePurpose(input,spec(),r,{mode:'ai',invoke});
    expect(seen.at(-1).localization.selectionSources[0].content).toBe(files['src/start.ts']);
    expect(Buffer.byteLength(JSON.stringify(seen.at(-1).localization.selectionSources))).toBeLessThanOrEqual(48000);
    r.dispose();
});
it('overflow context is bounded, explicitly omitted, and unavailable selection refs are rejected', async () => {
    const { localizePurpose } = await import('./purpose-localization');
    const r=await repo(fixture(Object.fromEntries(Array.from({length:12},(_,i)=>['pad/f'+i+'.py','# '+'界 '.repeat(1200)])))), cid=spec().goals[0].clauses[0].id;
    for(const f of r.fileLocators().filter(f=>f.side==='head'))await r.collector.read({path:f.path,side:'head',startLine:1,endLine:1,clauseId:cid,reason:'fixture source'});
    let seen:any;const out=await localizePurpose(input,spec(),r,{mode:'ai',invoke:async(q:any)=>{
        seen=q;return {actions:[],clauses:[{clauseId:cid,implementationRefs:[q.localization.candidateMetadata.at(-1).id],definitionRefs:[],callerRefs:[],testSetupRefs:[],testAssertionRefs:[],counterEvidenceRefs:[],searchState:'collected'}],stopReason:'selected'};
    }});
    expect(seen.localization.selectionSources.length).toBeLessThan(12);
    expect(Buffer.byteLength(JSON.stringify(seen.localization.selectionSources))).toBeLessThanOrEqual(48000);
    expect(seen.localization.omittedCandidates.length).toBeGreaterThan(0);
    expect(out.limitations).toContain('localization_invalid');r.dispose();
});

it('advertises action/final phases, actual tool target kinds and 80-line/8000-byte source bounds before reading',async()=>{
 const {localizePurpose}=await import('./purpose-localization');const r=await repo(),cid=spec().goals[0].clauses[0].id;let phase=0;
 const out=await localizePurpose(input,spec(),r,{mode:'ai',invoke:async(q:any)=>{
  expect(q.localization.protocol.actionResponse).toEqual({clauses:[],stopReason:'continue'});
  expect(q.localization.protocol.finalResponse.actions).toEqual([]);
  expect(q.localization.protocol.validClauseIds).toEqual([cid]);
  expect(q.localization.protocol.tools.browse.targetKinds).toEqual(['directory']);
  expect(q.localization.protocol.tools.inspect.targetKinds).toEqual(['file','occurrence']);
  expect(q.localization.limits.sourceRangeLines).toBe(80);expect(q.localization.limits.sourceRangeBytes).toBe(8000);
  if(phase++===0)return {actions:[action('inspect',q.localization.initial.changed.find((x:any)=>x.side==='head').id,cid,{view:'source',startLine:1,endLine:4})],clauses:[],stopReason:'continue'};
  return {actions:[],clauses:[{clauseId:cid,implementationRefs:[q.localization.selectionSources[0].id],definitionRefs:[],callerRefs:[],testSetupRefs:[],testAssertionRefs:[],counterEvidenceRefs:[],searchState:'collected'}],stopReason:'selected'};
 }});expect(out.evidence[0].content).toBe(files['src/start.ts']);r.dispose();
});
it('retained failure classes remain rejected with exact authority: mixed phase, file browse, blank clause and 81-line inspect',async()=>{
 const {localizePurpose}=await import('./purpose-localization');
 for(const failure of ['mixed','browse','clause','range']){
  const b=fixture(),r=await repo(b),cid=spec().goals[0].clauses[0].id,id=r.initial().changed[0].id;
  const a=action(failure==='browse'?'browse':'inspect',id,failure==='clause'?'':cid,{view:'source',startLine:1,endLine:failure==='range'?81:4});
  const out=await localizePurpose(input,spec(),r,{mode:'ai',invoke:async()=>({actions:[a],clauses:failure==='mixed'?[{clauseId:cid,implementationRefs:[],definitionRefs:[],callerRefs:[],testSetupRefs:[],testAssertionRefs:[],counterEvidenceRefs:[],searchState:'not_found_in_searched_scope'}]:[],stopReason:'continue'})});
  expect(out.limitations).toContain('localization_invalid');expect(b.readBlob).not.toHaveBeenCalled();expect(out.evidence).toEqual([]);r.dispose();
 }
});
it('clamps complete EOF only after request limit validation and reports actual range/lineCount',async()=>{
 const content=Array.from({length:60},(_,i)=>`line${i+1}`).join('\n');const r=await repo(fixture({'src/start.ts':content}));const id=r.initial().changed.find(x=>x.side==='head')!.id;
 const result=await r.execute(action('inspect',id,undefined,{view:'source',startLine:1,endLine:65}));expect(result.lineCount).toBe(60);expect(result.evidence[0]).toMatchObject({startLine:1,endLine:60,content});
 const missing=await r.execute(action('inspect',id,undefined,{view:'source',startLine:61,endLine:80}));expect(missing.lineCount).toBe(60);expect(missing.evidence).toEqual([]);
 await expect(r.execute(action('inspect',id,undefined,{view:'source',startLine:1,endLine:81}))).rejects.toThrow('localization_tool_reference');r.dispose();
});
it('new cumulative selection fills acquired candidates after selected roles, respects exact bytes and leaves legacy unchanged',async()=>{
 const r=await repo(fixture({'src/start.ts':'first\nsecond'}));const id=r.initial().changed.find(x=>x.side==='head')!.id;
 const first=(await r.execute(action('inspect',id,undefined,{view:'source',startLine:1,endLine:1}))).evidence[0];const second=(await r.execute(action('inspect',id,undefined,{view:'source',startLine:2,endLine:2}))).evidence[0];
 const selected=[{id:second.id,clauseId:spec().goals[0].clauses[0].id}];expect(r.select(selected).map(e=>e.id)).toEqual([second.id]);expect(r.select(selected,true).map(e=>e.id)).toEqual([second.id,first.id]);expect(r.select(selected,true)[1].clauseIds).toEqual(first.clauseIds);
 const {localizePurpose}=await import('./purpose-localization');
 const invoke=async()=>({actions:[],clauses:[{clauseId:spec().goals[0].clauses[0].id,implementationRefs:[],definitionRefs:[],callerRefs:[],testSetupRefs:[],testAssertionRefs:[],counterEvidenceRefs:[second.id],searchState:'collected'}],stopReason:'selected'});
 const filled=await localizePurpose(input,spec(),r,{mode:'ai',flow:'explore_final_v1',invoke});expect(filled.evidence.map(e=>e.id)).toEqual([second.id,first.id]);expect(filled.clauses[0].counterEvidenceRefs).toEqual([second.id]);expect(filled.clauses[0].implementationRefs).toEqual([]);expect(filled.coverage.omittedEvidence).toEqual([]);
 const legacy=await localizePurpose(input,spec(),r,{mode:'ai',invoke});expect(legacy.evidence.map(e=>e.id)).toEqual([second.id]);
 // Synthetic packet records isolate the unchanged exact serializer bound; source authority is tested separately.
 for(let i=0;i<20;i++)r.candidates.push({...first,id:`bounded_${i}`,content:'x'.repeat(7900)});
 const packet=r.select(selected,true);expect(packet[0].id).toBe(second.id);expect(packet.length).toBeLessThanOrEqual(16);expect(Buffer.byteLength(JSON.stringify(packet))).toBeLessThanOrEqual(48000);expect(r.limitations).toContain('localization_packet_budget');r.dispose();
});
