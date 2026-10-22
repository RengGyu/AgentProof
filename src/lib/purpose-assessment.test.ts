import { describe, it, expect, vi } from 'vitest';
import { buildPurposeSources, compilePurposeSpec } from './purpose-spec';
import { createPurposeCollector } from './purpose-evidence';
import { assessPurpose as runPurpose, hasPurposeContext } from './purpose-assessment';
import { generateVerificationReportV2FromInput } from './verifier';
import { validateRuntimeReportBoundary } from './report-runtime-validation';
import type { PullRequestInput } from './types';
const assessPurpose: typeof runPurpose = (i, r, o = {}) => runPurpose(i, r, { readCurrentInput: async () => i, ...o });
const head = 'a'.repeat(40), base = 'b'.repeat(40);
const input: PullRequestInput = { title: 'Retry pending work', description: 'Keep pending work until completion.', taskText: 'Preserve pending work unless cancelled.', taskSource: 'task', url: 'https://github.com/acme/queue/pull/1', repositoryPrivate: false, changedFiles: [{ path: 'src/queue.ts', patch: '@@ -1 +1 @@\n-old\n+pending();', status: 'modified' }], checks: [], logs: [], sourceProvenance: { version: 1, origin: 'github_snapshot', headSha: head, baseSha: base, evidenceCapturedAt: '2026-10-07T00:00:00Z', inputFingerprint: { version: 1, algorithm: 'sha256', value: 'c'.repeat(64), coverage: 'github_metadata' } } };
function proposal(i = input) { const sources = buildPurposeSources(i); return { goals: [{ sourceRefs: [sources.spans[0]!.id], clauses: [{ sourceRefs: [sources.spans[0]!.id], expectedObservable: 'Pending work is preserved unless cancelled.', conditions: [], exceptions: ['unless cancelled'], obligation: 'required', evidenceNeed: 'behavioral' }] }], contextRefs: sources.spans.slice(1).map(x => x.id), unprocessedSourceRefs: [], ambiguities: [] }; }
const provider = () => async (q: any) => q.stage === 'purpose' ? proposal() : q.stage === 'check' ? { disputes: [] } : { clauses: q.spec.goals.flatMap((g: any) => g.clauses.map((c: any) => ({ clauseId: c.id, implementation: 'supports', testRelation: 'relevant', evidenceRefs: q.evidence.map((e: any) => e.id), counterEvidenceRefs: [], openQuestions: [] }))), readRequests: [], searchRequests: [] };
describe('purpose assessment source and authority', () => {
    it('binds stable clauses to source authority and preserves closure', () => { const a = compilePurposeSpec(input, proposal()); expect(a).toEqual(compilePurposeSpec(input, proposal())); expect(a.goals[0]!.authority).toBe('authoritative'); expect(a.goals[0]!.clauses[0]!.exceptions).toEqual(['unless cancelled']); });
    it('rejects invented references and unaccounted source spans', () => { const p = proposal(); p.contextRefs = []; expect(() => compilePurposeSpec(input, p)).toThrow(); p.goals[0]!.sourceRefs = ['invented']; expect(() => compilePurposeSpec(input, p)).toThrow(); });
    it('rejects model-authored authority and executed status', () => { expect(() => compilePurposeSpec(input, { ...proposal(), authority: 'authoritative' })).toThrow(); });
    it('off performs no new work and preserves report identity', async () => { const report = generateVerificationReportV2FromInput(input), call = vi.fn(); const r = await assessPurpose(input, report, { mode: 'off', provider: call }); expect(r.report).toBe(report); expect(call).not.toHaveBeenCalled(); });
    it('source test plus successful CI does not prove behavior executed', async () => { const i = { ...input, checks: [{ name: 'tests', status: 'passed' as const }] }; const r = await assessPurpose(i, generateVerificationReportV2FromInput(i), { mode: 'advisory', variant: 'fixed', provider: provider(), readSource: async (req) => ({ path: req.path, revision: req.revision, content: 'assert(pending());', complete: true }) }); expect(r.assessment?.overall).toBe('partial'); expect(r.assessment?.goals[0]!.clauseResults[0]!.execution).toBe('not_observed'); expect(hasPurposeContext(r.report.purposeAssessment!, i, r.report)).toBe(true); const copy = structuredClone(r.report); expect(validateRuntimeReportBoundary({ boundary: 'inbound_untrusted_full', report: copy }).valid).toBe(false); });
    it('shadow leaves the public report unchanged', async () => { const report = generateVerificationReportV2FromInput(input); const r = await assessPurpose(input, report, { mode: 'shadow', variant: 'fixed', provider: provider() }); expect(r.report).toBe(report); expect(r.assessment?.overall).toBe('unclear'); });
    it('stale snapshot discards assessment', async () => { const report = generateVerificationReportV2FromInput(input); await expect(assessPurpose(input, report, { mode: 'advisory', provider: provider(), readCurrentInput: async () => ({ ...input, title: 'changed' }) })).rejects.toThrow('purpose_stale'); });
});
describe('purpose exact source collection', () => {
    it('masks before slicing, binds side/SHA/hash and does not retry failed reads', async () => { const read = vi.fn(async (req: any) => ({ path: req.path, revision: req.revision, content: '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----\nassert(pending());', complete: true })); const c = createPurposeCollector(input, read); const e = await c.read({ path: 'src/queue.ts', side: 'head', startLine: 2, endLine: 4, clauseId: 'clause', reason: 'Inspect assertion' }); expect(e?.content).not.toContain('secret'); expect(e?.revision).toBe(head); expect(e?.endLine).toBe(4); await c.read({ path: 'src/queue.ts', side: 'head', startLine: 2, endLine: 4, clauseId: 'clause', reason: 'Inspect assertion' }); expect(read).toHaveBeenCalledTimes(1); });
    it('rejects traversal, invented inventory and wrong revision without evidence', async () => { const read = vi.fn(async (req: any) => ({ path: req.path, revision: base, content: 'pending();', complete: true })); const c = createPurposeCollector(input, read); expect(await c.read({ path: '../secret', side: 'head', startLine: 1, endLine: 1, clauseId: 'c', reason: 'x' })).toBeNull(); expect(read).not.toHaveBeenCalled(); expect(await c.read({ path: 'src/queue.ts', side: 'head', startLine: 1, endLine: 1, clauseId: 'c', reason: 'x' })).toBeNull(); });
    it('never silently truncates overlong evidence', async () => { const c = createPurposeCollector(input, async (req) => ({ path: req.path, revision: req.revision, content: 'x'.repeat(8001), complete: true })); expect(await c.read({ path: 'src/queue.ts', side: 'head', startLine: 1, endLine: 1, clauseId: 'c', reason: 'x' })).toBeNull(); expect(c.limitations).toContain('artifact_budget'); });
});
it('validates generated assessment, rejects mutation and preserves privacy in signed/share projections', async () => {
    const { projectTenantPersistedReport, validateTenantPersistedReport } = await import('./tenant-report-validation');
    const { sanitizeReportForShare } = await import('./report-share');
    const r = await assessPurpose(input, generateVerificationReportV2FromInput(input), { mode: 'advisory', variant: 'fixed', provider: provider(), readSource: async (req) => ({ path: req.path, revision: req.revision, content: 'pending();', complete: true }) });
    const validation = validateRuntimeReportBoundary({ boundary: 'generated_private_full', input, report: r.report });
    expect(validation.valid, JSON.stringify(validation)).toBe(true);
    const { prepareTenantDetailReportForStorage } = await import('./server-report-store');
    const safe = prepareTenantDetailReportForStorage(r.report, 'verified_agentproof', 'fixture-signing-secret');
    const persisted = projectTenantPersistedReport(safe, 'fixture-signing-secret');
    expect(validateTenantPersistedReport(persisted, 'fixture-signing-secret').valid, JSON.stringify(validateTenantPersistedReport(persisted, 'fixture-signing-secret'))).toBe(true);
    const share = sanitizeReportForShare(r.report);
    expect(JSON.stringify(share)).not.toContain('purposeAssessment"');
    expect(JSON.stringify(share)).not.toContain('rawHash');
    expect((share as import("./types").VerificationReportV2).purposeAssessmentSummary).toBeDefined();
    r.report.purposeAssessment!.overall = 'fulfilled';
    expect(validateRuntimeReportBoundary({ boundary: 'generated_private_full', input, report: r.report }).valid).toBe(false);
});
it('refuses invented or unsent evidence and does not accept executed model fields', async () => {
    const p = provider();
    const call: any = async (q: any) => q.stage === 'purpose' ? p(q) : { clauses: [{ clauseId: q.spec.goals[0].clauses[0].id, implementation: 'supports', testRelation: 'relevant', execution: 'checked_pass', evidenceRefs: ['invented'], counterEvidenceRefs: [], openQuestions: [] }], readRequests: [], searchRequests: [] };
    await expect(assessPurpose(input, generateVerificationReportV2FromInput(input), { mode: 'shadow', provider: call })).rejects.toThrow('purpose_assessment_schema');
});
it('propagates authoritative budget denial and stops without a fallback paid call', async () => {
    const { PaidBudgetError } = await import('./paid-budget');
    const call = vi.fn(async () => { throw new PaidBudgetError('hard_pause'); });
    await expect(assessPurpose(input, generateVerificationReportV2FromInput(input), { mode: 'advisory', provider: call })).rejects.toBeInstanceOf(PaidBudgetError);
    expect(call).toHaveBeenCalledTimes(1);
});
it('adaptive reads use the frozen clauses; checker cannot see assessor verdict', async () => {
    const seen: any[] = [];
    let assessments = 0;
    const call: any = async (q: any) => { seen.push(q); if (q.stage === 'purpose')
        return proposal(); if (q.stage === 'check') {
        expect(q.sources.spans.some((s:any)=>s.text.includes('unless cancelled'))).toBe(true);expect(JSON.stringify(q)).not.toContain('implementation":"supports');
        return { disputes: [{ clauseId: q.spec.goals[0].clauses[0].id, evidenceRefs: [], reason: 'condition_missing' }] };
    } assessments++; return { clauses: [{ clauseId: q.spec.goals[0].clauses[0].id, implementation: 'supports', testRelation: 'relevant', evidenceRefs: q.evidence.map((e: any) => e.id), counterEvidenceRefs: [], openQuestions: [] }], readRequests: assessments === 1 ? [{ path: 'src/queue.ts', side: 'head', startLine: 2, endLine: 2, clauseId: q.spec.goals[0].clauses[0].id, reason: 'Read cancellation path' }] : [], searchRequests: [] }; };
    const r = await assessPurpose(input, generateVerificationReportV2FromInput(input), { mode: 'shadow', variant: 'adaptive', provider: call, readSource: async (req) => ({ path: req.path, revision: req.revision, content: 'pending();\nif (cancelled) stop();', complete: true }) });
    expect(assessments).toBe(2);
    expect(r.assessment?.goals[0].clauseResults[0].reasonCodes).toContain('checker_dispute');
    expect(seen.filter(q => q.stage === 'assess').every(q => q.spec.sourceBundleHash === r.spec!.sourceBundleHash)).toBe(true);
});
it('parent cancellation prevents initial paid work', async () => { const c = new AbortController(); c.abort(); const call = vi.fn(); await expect(assessPurpose(input, generateVerificationReportV2FromInput(input), { mode: 'shadow', provider: call, signal: c.signal })).rejects.toThrow(); expect(call).not.toHaveBeenCalled(); });
it('composes purpose with the existing review projection and renders no execution-success claim', async () => {
    const { buildPrEvidenceReview } = await import('./pr-evidence-review');
    const { PrEvidenceReview } = await import('../components/PrEvidenceReview');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');
    const r = await assessPurpose(input, generateVerificationReportV2FromInput(input), { mode: 'advisory', variant: 'fixed', provider: provider(), readSource: async (req) => ({ path: req.path, revision: req.revision, content: 'pending();', complete: true }) });
    const review = buildPrEvidenceReview(r.report);
    expect(review.purpose?.overall).toBe('partial');
    const html = renderToStaticMarkup(createElement(PrEvidenceReview, { review }));
    expect(html).toContain('Stated purpose: partial');
    expect(html).toContain('execution: not observed');
    expect(html).not.toMatch(/Tests passed|merge-ready|verification complete/i);
});
it('default-off service uses the identical ordinary flow; advisory skips legacy semantic/navigation', async () => {
    const { runGeneralPrObservationNowV2 } = await import('./general-pr-observation-service');
    const { resolveGeneralPrAssessmentRuntimePolicyV1 } = await import('./general-pr-runtime-policy');
    const report = generateVerificationReportV2FromInput(input), base = { input, policy: resolveGeneralPrAssessmentRuntimePolicyV1('disabled'), generateReport: () => report, validateDeterministicReport: () => true };
    const first = await runGeneralPrObservationNowV2(base);
    const call = vi.fn();
    const off = await runGeneralPrObservationNowV2({ ...base, purpose: { mode: 'off', provider: call } });
    expect(JSON.stringify(off)).toBe(JSON.stringify(first));
    expect(call).not.toHaveBeenCalled();
    const nav = vi.fn();
    const advisory = await runGeneralPrObservationNowV2({ ...base, navigation: { model: 'fixture', provider: nav }, purpose: { mode: 'advisory', variant: 'fixed', provider: provider(), readCurrentInput: async () => input } });
    expect(nav).not.toHaveBeenCalled();
    expect((advisory.report as import('./types').VerificationReportV2).purposeAssessmentSummary).toBeDefined();
});
it('reported normalized pass, empty/skipped suites and mismatched SHA never close execution', async () => {
    const { collectPurposeTestEvidence } = await import('./purpose-test-evidence');
    const subjectDigest = 'd'.repeat(64), json = JSON.stringify({ version: 1, subjectDigest, declaredTestCount: 1, tests: [{ id: 'one', outcome: 'passed' }] });
    const observed = collectPurposeTestEvidence(input, { json, subjectDigest });
    expect(observed.normalized).toMatchObject({ level: 'reported', passed: 1 });
    expect(observed.limitations).toContain('case_execution_not_verified');
    expect(collectPurposeTestEvidence(input, { json, subjectDigest: 'e'.repeat(64) }).normalized).toBeNull();
    expect(collectPurposeTestEvidence(input, { json: JSON.stringify({ version: 1, subjectDigest, declaredTestCount: 0, tests: [] }), subjectDigest }).normalized?.count).toBe(0);
});
it('source privacy and changed revision invalidate bound assessment without new source retention', async () => {
    const secret = { ...input, description: 'token=sk-fixture-secret-key' };
    expect(JSON.stringify(buildPurposeSources(secret))).not.toContain('sk-fixture-secret-key');
    const r = await assessPurpose(input, generateVerificationReportV2FromInput(input), { mode: 'advisory', variant: 'fixed', provider: provider() });
    expect(hasPurposeContext(r.report.purposeAssessment!, { ...input, sourceProvenance: { ...input.sourceProvenance!, headSha: 'e'.repeat(40) } }, r.report)).toBe(false);
});
it('retains all evidence across actual serialized batch boundaries', async () => {
    const { purposeBatches } = await import('./purpose-evidence');
    const c = createPurposeCollector(input, async (req) => ({ path: req.path, revision: req.revision, content: Array.from({ length: 8 }, () => 'const pending = true; '.repeat(300)).join('\n'), complete: true }));
    for (let line = 1; line <= 8; line++)
        await c.read({ path: 'src/queue.ts', side: 'head', startLine: line, endLine: line, clauseId: 'clause', reason: 'Read interval' });
    const batches = purposeBatches(c.evidence);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat().map(e => e.id)).toEqual(c.evidence.map(e => e.id));
    expect(batches.every(b => b.length <= 16 && Buffer.byteLength(JSON.stringify(b)) <= 48000)).toBe(true);
});

it.each([['ready now','fulfilled'],['different','not_fulfilled']] as const)('consumes only whole-source validated static criterion: %s',async(content,outcome)=>{
 const {attachOrdinaryRequirementOutcomes}=await import('./ordinary-requirement-outcomes');const {selectCanonicalRequirements}=await import('./extractors');
 vi.stubEnv('AGENTPROOF_VERIFICATION_CAPABILITIES_V2','documentation_literal');
 const i={...input,title:'Documentation',description:'Documentation update',taskText:'## Requirements\n- `README.md` must contain `ready now`.',changedFiles:[]};const report=await attachOrdinaryRequirementOutcomes(i,generateVerificationReportV2FromInput(i),{collectDocumentationArtifacts:async()=>[{path:'README.md',headSha:head,content}]});
 const sources=buildPurposeSources(i),selected=sources.spans.find(s=>s.text.includes('must contain'))!,text=selectCanonicalRequirements({kind:"selected_source",input:i}).requirements[0].text;
 const call:any=async(q:any)=>q.stage==='purpose'?{goals:[{sourceRefs:[selected.id],clauses:[{sourceRefs:[selected.id],expectedObservable:text,conditions:[],exceptions:[],obligation:'required',evidenceNeed:'static'}]}],contextRefs:sources.spans.filter(s=>s.id!==selected.id).map(s=>s.id),unprocessedSourceRefs:[],ambiguities:[]}:q.stage==='check'?{disputes:[]}:{clauses:[],readRequests:[],searchRequests:[]};
 const r=await assessPurpose(i,report,{mode:'advisory',variant:'adaptive',provider:call});expect(r.assessment?.overall).toBe(outcome);expect(r.assessment?.goals[0].assurance).toBe('deterministic_checked');expect(r.assessment?.goals[0].clauseResults[0].execution).toBe('not_required');vi.unstubAllEnvs();
});

it('admits bounded unchanged helper locators from supplied imports, never arbitrary paths',async()=>{
 const c=createPurposeCollector(input,async req=>({path:req.path,revision:req.revision,content:req.path==='src/queue.ts'?"import { pending } from './helper';\npending();":"export const pending=()=>true;",complete:true}));await c.read({path:'src/queue.ts',side:'head',startLine:1,endLine:2,clauseId:'c',reason:'Inspect changed implementation'});
 expect(c.paths()).toContain('src/helper.ts');expect(await c.read({path:'src/helper.ts',side:'head',startLine:1,endLine:1,clauseId:'c',reason:'Inspect supplied import locator'})).not.toBeNull();expect(await c.read({path:'arbitrary/secret.ts',side:'head',startLine:1,endLine:1,clauseId:'c',reason:'Invented locator'})).toBeNull();
});

it('freshness compares exact source/subject/access, not the collector wall clock',async()=>{
 const report=generateVerificationReportV2FromInput(input);const current={...input,sourceProvenance:{...input.sourceProvenance!,evidenceCapturedAt:'2026-10-07T00:00:01Z'}};await expect(assessPurpose(input,report,{mode:'advisory',variant:'fixed',provider:provider(),readCurrentInput:async()=>current})).resolves.toMatchObject({assessment:{overall:'unclear'}});
});

it('a shape-valid summary alone cannot create generated assessment authority',async()=>{
 const r=await assessPurpose(input,generateVerificationReportV2FromInput(input),{mode:'advisory',variant:'fixed',provider:provider()});const {purposeAssessment:_private,...forged}=r.report;expect(validateRuntimeReportBoundary({boundary:'generated_private_full',input,report:forged}).valid).toBe(false);
});

it('checker disagreement downgrades semantic partial in persisted summary and visible UI; no dispute preserves B', async () => {
 const {prepareTenantDetailReportForStorage}=await import('./server-report-store');
 const {buildPrEvidenceReview}=await import('./pr-evidence-review');
 const {PrEvidenceReview}=await import('../components/PrEvidenceReview');
 const {renderToStaticMarkup}=await import('react-dom/server');
 const {createElement}=await import('react');
 const original=provider();
 const run=async(variant:'fixed'|'adaptive',disagree:boolean)=>assessPurpose(input,generateVerificationReportV2FromInput(input),{mode:'advisory',variant,provider:async(q,s)=>q.stage==='check'?{disputes:disagree?[{clauseId:(q.spec as any).goals[0].clauses[0].id,evidenceRefs:[],reason:'condition_missing'}]:[]}:original(q),readSource:async(req)=>({path:req.path,revision:req.revision,content:'pending();',complete:true})});
 const b=await run('fixed',false), same=await run('adaptive',false), disputed=await run('adaptive',true);
 expect(same.report.purposeAssessmentSummary).toEqual(b.report.purposeAssessmentSummary);
 expect(b.assessment?.overall).toBe('partial');
 expect(disputed.assessment?.overall).toBe('unclear');
 const saved=prepareTenantDetailReportForStorage(disputed.report,'verified_agentproof','fixture-signing-secret') as import('./types').VerificationReportV2;
 expect(saved.purposeAssessmentSummary?.overall).toBe('unclear');
 expect(saved.purposeAssessmentSummary?.goals[0].assurance).toBe('insufficient');
 expect(saved.purposeAssessmentSummary?.limitations).toContain('checker_dispute');
 const html=renderToStaticMarkup(createElement(PrEvidenceReview,{review:buildPrEvidenceReview(saved)}));
 expect(html).toContain('Stated purpose: unclear');
 expect(html).toContain('checker dispute');expect(html).toContain('Semantic interpretation');
});
