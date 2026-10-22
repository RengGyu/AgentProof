import {describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {capturePurposeDiffIndex} from './purpose-github';
import {assessPurpose} from './purpose-assessment';
import {buildPurposeSources,compilePurposeSpec} from './purpose-spec';
import {generateVerificationReportV2FromInput} from './verifier';
import type {PullRequestInput} from './types';
const head='a'.repeat(40),base='b'.repeat(40);
const input:PullRequestInput={title:'Retain pending work',taskText:'',description:'Keep pending work unless cancelled.',repositoryPrivate:false,url:'https://github.com/acme/work/pull/8',changedFiles:[{path:'queue.py',status:'modified',patch:'@@ -1 +1 @@\n-old\n+new'}],checks:[],logs:[],sourceProvenance:{version:1,origin:'github_snapshot',headSha:head,baseSha:base,evidenceCapturedAt:'2026-10-08T00:00:00Z',inputFingerprint:{version:1,algorithm:'sha256',value:'c'.repeat(64),coverage:'github_metadata'}}};
capturePurposeDiffIndex(input,input.changedFiles.map(f=>({filename:f.path,patch:f.patch})),{baseRefSha:base,diffBaseSha:base,headSha:head});
function frozen(){const s=buildPurposeSources(input);return compilePurposeSpec(input,{goals:[{sourceRefs:[s.spans[0].id],clauses:[{sourceRefs:[s.spans[0].id],expectedObservable:'Retain pending work',conditions:['unless cancelled'],exceptions:[],obligation:'required',evidenceNeed:'behavioral'}]}],contextRefs:s.spans.slice(1).map(s=>s.id),unprocessedSourceRefs:[],ambiguities:[]});}
const spec=frozen(),clauseId=spec.goals[0].clauses[0].id;
function backend(){const content=(revision:string)=>revision===head?'pending = retain()\n# cancellation helper not shown':'pending = discard()\n# old implementation';const sha=(s:string)=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex');return {manifest:async(_side:any,revision:string)=>({repository:'acme/work',revision,treeSha:'c'.repeat(40),complete:true,entries:[{path:'queue.py',mode:'100644' as const,size:Buffer.byteLength(content(revision)),blobSha:sha(content(revision))}]}),readBlob:vi.fn(async(e:any,revision:string)=>({path:e.path,revision,blobSha:e.blobSha,content:content(revision),complete:true,bytesRead:Buffer.byteLength(content(revision))}))};}
function final(q:any){const refs=q.evidence.map((e:any)=>e.id);return {clauses:[{clauseId,implementation:'unknown',testRelation:'unknown',evidenceRefs:refs,counterEvidenceRefs:[],changeObservations:[{basis:'source_text',text:'pending = retain()',evidenceRefs:[q.evidence.find((e:any)=>e.side==='head').id]},{basis:'model_interpretation',text:'The changed source retains pending work.',evidenceRefs:refs}],testObservations:[],remainingQuestions:[]}]};}
function explorer(seen:any[],answer=(q:any)=>final(q)){return vi.fn(async(q:any)=>{seen.push(structuredClone(q));if(q.stage==='locate'){const l=q.localization;if(l.round<3){const f=l.initial.changed.find((e:any)=>e.side===(l.round===1?'base':'head'));return {actions:[{targetId:f.id,startLine:l.round===2?2:1,endLine:2,clauseId}],clauses:[],stopReason:'continue'};}return {actions:[],clauses:[{clauseId,evidenceRefs:l.selectionSources.map((e:any)=>e.id),counterEvidenceRefs:[]}],stopReason:'selected'};}return answer(q);});}
async function run(call:any,b=backend(),more:any={}){return assessPurpose(input,generateVerificationReportV2FromInput(input),{mode:'advisory',flow:'explore_final_v1',frozenSpec:spec,provider:call,readCurrentInput:async()=>input,localization:{mode:'ai',backend:b},...more} as any);}
describe('explore then final assessment opt-in',()=>{
 it('keeps earlier source and tool results, caches same SHA reads, then assesses once without checker/refinement',async()=>{const seen:any[]=[],b=backend();const r=await run(explorer(seen),b);const locate=seen.filter(q=>q.stage==='locate');expect(locate[2].localization.results).toHaveLength(2);expect(locate[2].localization.selectionSources.map((e:any)=>e.side).sort()).toEqual(['base','head']);expect(b.readBlob).toHaveBeenCalledTimes(2);expect(seen.map(q=>q.stage)).toEqual(['locate','locate','locate','locate','assess']);const q=seen.at(-1);expect(q.flow).toBe('explore_final_v1');expect(q.evidence).toHaveLength(3);expect(q.coverage).not.toHaveProperty('readOutcomes');expect(q).not.toHaveProperty('executionSignals');expect(r.assessment!.facts!.coverage.readOutcomes).toHaveLength(3);expect(r.assessment?.goals[0].clauseResults[0]).toMatchObject({implementation:'unknown',execution:'not_observed',openQuestions:[]});expect((r.assessment as any).facts.clauses[0].changeObservations[0].basis).toBe('source_text');});
 it.each(['readRequests','searchRequests','execution'])('strict final rejects %s without executing another read or call',async(field)=>{const seen:any[]=[],b=backend();const call=explorer(seen,q=>({...final(q),[field]:field==='execution'?'checked_pass':[]}));await expect(run(call,b)).rejects.toThrow('purpose_final_schema');expect(b.readBlob).toHaveBeenCalledTimes(2);expect(seen.filter(q=>q.stage==='check')).toHaveLength(0);expect(seen.filter(q=>q.stage==='assess')).toHaveLength(1);});
 it('rejects invented quotes and unsent refs without fabricating facts',async()=>{for(const tamper of [(q:any)=>{const p=final(q);p.clauses[0].changeObservations[0].text='tests passed';return p;},(q:any)=>{const p=final(q);p.clauses[0].changeObservations[0].evidenceRefs=[q.sources.spans[0].id];return p;}])await expect(run(explorer([],tamper))).rejects.toThrow(/purpose_final_(quote|reference)/);});
 it('keeps default off identical and requires explicit localization for the new flow',async()=>{const report=generateVerificationReportV2FromInput(input),provider=vi.fn();expect((await assessPurpose(input,report,{flow:'explore_final_v1',provider} as any)).report).toBe(report);expect(provider).not.toHaveBeenCalled();await expect(assessPurpose(input,report,{mode:'shadow',flow:'explore_final_v1',provider} as any)).rejects.toThrow('purpose_final_localization_required');});
});

it('private facts are bound against mutation and never persisted/shared; saved UI invents no detail or grades',async()=>{
 const {validateRuntimeReportBoundary}=await import('./report-runtime-validation');
 const {prepareTenantDetailReportForStorage}=await import('./server-report-store');
 const {sanitizeReportForShare}=await import('./report-share');
 const {projectTenantPersistedReport,validateTenantPersistedReport}=await import('./tenant-report-validation');
 const {buildPrEvidenceReview,buildDashboardPrEvidenceReview}=await import('./pr-evidence-review');
 const {PrEvidenceReview}=await import('../components/PrEvidenceReview');
 const {renderToStaticMarkup}=await import('react-dom/server');const {createElement}=await import('react');
 const r=await run(explorer([]));expect(validateRuntimeReportBoundary({boundary:'generated_private_full',input,report:r.report}).valid).toBe(true);
 const html=renderToStaticMarkup(createElement(PrEvidenceReview,{review:buildPrEvidenceReview(r.report)}));
 for(const text of ['<h4>Changes</h4>','Model interpretation','The changed source retains pending work.'])expect(html).toContain(text);expect(html).not.toContain('pending = retain()');expect(html).not.toMatch(/Remaining questions|Collection limits/);
 expect(html).not.toContain('Purpose 1: unclear');
 const saved=prepareTenantDetailReportForStorage(r.report,'verified_agentproof','fixture-signing-secret');
 expect(validateTenantPersistedReport(projectTenantPersistedReport(saved,'fixture-signing-secret'),'fixture-signing-secret').valid).toBe(true);
 for(const projected of [saved,sanitizeReportForShare(r.report)]){expect(JSON.stringify(projected)).not.toContain('pending = retain()');expect(JSON.stringify(projected)).not.toContain('"facts"');expect(JSON.stringify(projected)).toContain('explore_final_v1');}
 const summaryHtml=renderToStaticMarkup(createElement(PrEvidenceReview,{review:buildPrEvidenceReview(saved)}));expect(summaryHtml).toContain('The changed source retains pending work.');expect(summaryHtml).not.toContain('Only the saved summary');expect(summaryHtml).not.toContain('pending = retain()');
 const dashboard=buildDashboardPrEvidenceReview({report:saved} as any);expect(dashboard?.purpose?.flow).toBe('explore_final_v1');expect(dashboard?.purposeFacts).toBeUndefined();
 r.assessment!.facts!.clauses[0].changeObservations[0].text='tests passed';expect(validateRuntimeReportBoundary({boundary:'generated_private_full',input,report:r.report}).valid).toBe(false);
});
it('aborts before final interpretation and never retries cancelled exploration',async()=>{
 const controller=new AbortController(),seen:any[]=[];const p=explorer(seen);await expect(run(async(q:any)=>{const answer=await p(q);controller.abort();return answer;},backend(),{signal:controller.signal})).rejects.toThrow();expect(seen.map(q=>q.stage)).toEqual(['locate']);
});

it('bounded round context discloses omitted source and never lets an omitted ID become selected evidence',async()=>{
 const {localizePurpose}=await import('./purpose-localization');
 const {purposeContentHash}=await import('./purpose-contract');
 const candidates=Array.from({length:17},(_,i)=>({id:`e${i}`,repositoryHash:'r',path:`file${i}.py`,side:'head',revision:head,startLine:1,endLine:1,content:'value = 1',contentHash:purposeContentHash('value = 1'),clauseIds:[clauseId]}));
 const repository:any={collectionFacts:()=>({changedPaths:[],accessFailures:[]}),candidates,initial:()=>({changed:[]}),select:(refs:{id:string}[])=>candidates.filter(e=>refs.some(r=>r.id===e.id)).slice(0,16),limitations:[],metrics:()=>({}),collector:{limitations:[]}};
 const seen:any[]=[];
 const invoke=async(q:any)=>{seen.push(q);return {actions:[],clauses:[{clauseId,evidenceRefs:q.localization.selectionSources.map((e:any)=>e.id),counterEvidenceRefs:[]}],stopReason:'selected'};};
 const result=await localizePurpose(input,spec,repository,{mode:'ai',flow:'explore_final_v1',invoke});
 expect(seen[0].localization.selectionSources).toHaveLength(16);expect(Buffer.byteLength(JSON.stringify(seen[0].localization.selectionSources))).toBeLessThanOrEqual(48000);expect(seen[0].localization.omittedCandidates).toEqual([{id:'e16',reason:'selection_context_budget'}]);expect(result.coverage.omittedEvidence).toContainEqual(expect.objectContaining({id:'e16',reason:'packet_budget'}));expect(result.limitations).toContain('localization_packet_budget');
 const droppedCounter = {...repository,select:(refs:{id:string}[])=>repository.select(refs).slice(0,15)};
 await expect(localizePurpose(input,spec,droppedCounter,{mode:'ai',flow:'explore_final_v1',invoke:async(q:any)=>{const p=await invoke(q);p.clauses[0].counterEvidenceRefs=['e15'] as any;return p;}})).rejects.toThrow('purpose_final_counterevidence_budget');

});

it('final carries actual collection receipts without requiring or synthesizing model searchState',async()=>{
 const seen:any[]=[];const provider=vi.fn(async(q:any)=>{seen.push(q);if(q.stage!=='locate')return final(q);const l=q.localization;
 if(l.round===0)return {actions:[{targetId:l.initial.changed.find((f:any)=>f.side==='head').id,startLine:1,endLine:1,clauseId}],clauses:[],stopReason:'continue'};
 return {actions:[],clauses:[{clauseId,evidenceRefs:l.selectionSources.map((e:any)=>e.id),counterEvidenceRefs:[]}],stopReason:'unresolved'};});
 const result=await run(provider);const q=seen.at(-1),facts=result.assessment!.facts!.coverage.collection!;
 expect(facts.explorationCallExhausted).toBe(false);expect(facts.accessFailures).toEqual([]);expect(facts.searchActions).toBe(0);
 expect(facts.changedPaths.find((p:any)=>p.side==='head')).toMatchObject({state:'acquired',ranges:[{startLine:1,endLine:1}]});
 expect(facts.changedPaths.find((p:any)=>p.side==='base')).toMatchObject({state:'unread',ranges:[]});
 expect(q.localization).toBeUndefined();expect(q.coverage).not.toHaveProperty('collection');
 expect(result.assessment!.facts!.coverage.readOutcomes[0]).toMatchObject({requested:{startLine:1,endLine:1},returned:[{startLine:1,endLine:1}]});
});

it('server reports real failed access and actual exhausted exploration calls to final without inventing absence',async()=>{
 const seen:any[]=[],b=backend();const original=b.readBlob.getMockImplementation()!;
 b.readBlob.mockImplementation(async(e:any,revision:string)=>revision===base?null as any:original(e,revision));
 const provider=explorer(seen),result=await run(provider,b);
 const facts=result.assessment!.facts!.coverage.collection!;
 expect(facts.explorationCallExhausted).toBe(true);expect(facts.accessFailures).toEqual([{path:'queue.py',side:'base',revision:base,reason:'source_unavailable'}]);
 expect(facts.changedPaths.find((p:any)=>p.side==='base')).toMatchObject({state:'unavailable',ranges:[]});
 expect(result.assessment!.facts!.coverage.readOutcomes.find((o:any)=>o.outcome==='unavailable')).toMatchObject({reason:'source_unavailable',returned:[]});
 expect(seen.filter(q=>q.stage==='assess')).toHaveLength(1);expect(seen.filter(q=>q.stage==='check')).toHaveLength(0);
});

it('single provider receives common flow for purpose and skipped source remains unprocessed, never fulfilled',async()=>{
 const seen:any[]=[];await expect(run(async(q:any)=>{seen.push(q);if(q.stage==='purpose')return {goals:[],ambiguities:[]};if(q.stage==='locate')return {actions:[],clauses:[],stopReason:'unresolved'};return {clauses:[]};},backend(),{frozenSpec:undefined})).rejects.toThrow('purpose_no_core_goal');
 expect(seen.map(q=>[q.stage,q.flow])).toEqual([['purpose','explore_final_v1']]);
 const empty=compilePurposeSpec(input,{goals:[],ambiguities:[]},'explore_final_v1');expect(empty.unprocessedSourceRefs.length).toBe(buildPurposeSources(input).spans.length);

});

it('retains only reviewer-safe purpose explanations and locations across signed tenant storage, never portable/raw detail',async()=>{
 const {prepareTenantDetailReportForStorage}=await import('./server-report-store');const {projectTenantPersistedReport,decodeTenantPersistedReport}=await import('./tenant-report-validation');const {sanitizeReportForShare}=await import('./report-share');const {buildDashboardPrEvidenceReview}=await import('./pr-evidence-review');
 const r=await run(explorer([]));const review=(r.report as any).purposeReview;
 expect(review?.clauses[0]).toMatchObject({purpose:'Retain pending work',changeDescriptions:[{text:'The changed source retains pending work.'}]});
 const safe=prepareTenantDetailReportForStorage(r.report,'verified_agentproof','fixture-signing-secret');const stored=projectTenantPersistedReport(safe,'fixture-signing-secret');const decoded=decodeTenantPersistedReport(stored,{signingSecret:'fixture-signing-secret',createdAt:'2026-10-13T00:00:00Z'});expect(decoded.status).toBe('valid');
 if(decoded.status!=='valid')throw Error('decode failed');
 expect((decoded.report as any).purposeReview).toEqual(review);
 const tampered=structuredClone(stored);tampered.purposeReview!.clauses[0].purpose='Different purpose';expect(decodeTenantPersistedReport(tampered,{signingSecret:'fixture-signing-secret',createdAt:'2026-10-13T00:00:00Z'}).status).toBe('invalid');
 expect((buildDashboardPrEvidenceReview({report:decoded.report as any,headSha:head,repositoryFullName:'acme/work'} as any) as any)?.purposeReview).toEqual(review);
 expect(JSON.stringify(stored)).not.toMatch(/pending = retain\(\)|"facts"|readOutcomes|rawHash|traceDigest/);
 expect((sanitizeReportForShare(r.report) as any).purposeReview).toBeUndefined();
});
it.each([
 'Updates the import  behavior and export names for a class option.',
 'The function signature lets users select *.{js,ts} and {name}.',
 'Does not establish that tests passed or verified behavior.',
 '테스트 통과 여부는 확인하지 않았다. 실행 후 성공 메시지는 기능 설명이다.',
 'Tests passed.',
 'pending = retain()',
 'The {name} placeholder maps input => output.'
])('preserves model prose without inferring code copying or execution: %s',async text=>{
 const r=await run(explorer([],q=>{const p=final(q);p.clauses[0].implementation='supports';p.clauses[0].changeObservations[1].text=text;return p;}));
 expect(r.report.purposeReview!.clauses[0].changeDescriptions.map(d=>d.text)).toEqual([text]);
 expect(r.assessment!.goals[0]).toMatchObject({achievement:'partial',assurance:'evidence_assessed',clauseResults:[expect.objectContaining({implementation:'supports',execution:'not_observed'})]});
 const {prepareTenantDetailReportForStorage}=await import('./server-report-store'),{projectTenantPersistedReport,decodeTenantPersistedReport}=await import('./tenant-report-validation'),{sanitizeReportForShare}=await import('./report-share');
 const stored=projectTenantPersistedReport(prepareTenantDetailReportForStorage(r.report,'verified_agentproof','fixture-signing-secret'),'fixture-signing-secret');
 const decoded=decodeTenantPersistedReport(stored,{signingSecret:'fixture-signing-secret',createdAt:'2026-10-14T00:00:00Z'});expect(decoded.status).toBe('valid');
 if(decoded.status!=='valid')throw Error('decode failed');
 expect((decoded.report as any).purposeReview).toEqual(r.report.purposeReview);
 expect(JSON.stringify(stored)).not.toMatch(/"source_text"|"changeObservations"|"facts"|"content"/);
 expect((sanitizeReportForShare(r.report) as any).purposeReview).toBeUndefined();
});
it('preserves an author purpose overlapping acquired source without an echo classifier',async()=>{
 const purpose='Preserve pending = retain() as the setting.',sample={...input,description:purpose};
 capturePurposeDiffIndex(sample,sample.changedFiles.map(f=>({filename:f.path,patch:f.patch})),{baseRefSha:base,diffBaseSha:base,headSha:head});
 const sources=buildPurposeSources(sample),sourceRef=sources.spans.find(s=>s.text.includes(purpose))!.id;
 const frozen=compilePurposeSpec(sample,{goals:[{clauses:[{sourceRefs:[sourceRef],expectedObservable:purpose,conditions:['pending = retain()'],exceptions:[],obligation:'required',evidenceNeed:'behavioral'}]}],ambiguities:[]},'explore_final_v1');
 const provider=async(q:any)=>{const answer=await explorer([])(q),id=q.spec.goals[0].clauses[0].id;if('actions' in answer)for(const row of answer.actions??[])row.clauseId=id;for(const row of answer.clauses??[])row.clauseId=id;return answer;};
 const r=await assessPurpose(sample,generateVerificationReportV2FromInput(sample),{mode:'advisory',flow:'explore_final_v1',frozenSpec:frozen,provider,localization:{mode:'ai',backend:backend()},readCurrentInput:async()=>sample});
 expect(r.report.purposeReview!.clauses[0]).toMatchObject({purpose,conditions:['pending = retain()']});
});
it('keeps prose hygiene, secret and DTO/source reference guards after removing meaning classifiers',async()=>{
 const {safePurposeReviewText,isPurposeReview}=await import('./purpose-summary');
 for(const value of ['', 'x'.repeat(601),'text\u0000tail','text\nnext','text\u007ftail',' padded '])expect(safePurposeReviewText(value)).toBe(false);
 const r=await run(explorer([])),review=r.report.purposeReview!;expect(isPurposeReview(review)).toBe(true);
 for(const mutate of [(v:any)=>v.clauses[0].changeDescriptions[0].text='api_key=fixture_secret_value',(v:any)=>v.clauses[0].changeDescriptions[0].evidenceRefs=['pe_'+'f'.repeat(24)],(v:any)=>v.references[0].revision='f'.repeat(40),(v:any)=>v.references[0].path='../private.py',(v:any)=>v.clauses[0].execution='checked_pass',(v:any)=>v.clauses[0].changeDescriptions[0].rawCode='raw']){const changed=structuredClone(review);mutate(changed);expect(isPurposeReview(changed)).toBe(false);}
 await expect(run(explorer([],q=>{const p=final(q);p.clauses[0].changeObservations[1].text='text\u0000tail';return p;}))).rejects.toThrow('purpose_projection_text');
});
it('retains exact verified merge-base references when the base branch tip differs, and rejects fabricated reviewer refs',async()=>{
 const diffBase='d'.repeat(40),sample={...input};capturePurposeDiffIndex(sample,input.changedFiles.map(f=>({filename:f.path,patch:f.patch})),{baseRefSha:base,diffBaseSha:diffBase,headSha:head});
 const r=await assessPurpose(sample,generateVerificationReportV2FromInput(sample),{mode:'advisory',flow:'explore_final_v1',frozenSpec:spec,provider:explorer([]),readCurrentInput:async()=>sample,localization:{mode:'ai',backend:backend()}});
 const review=r.report.purposeReview!;expect(review.baseSha).toBe(diffBase);expect(review.references.filter(e=>e.side==='base').every(e=>e.revision===diffBase)).toBe(true);expect(review.references.some(e=>e.side==='base')).toBe(true);
 const {isPurposeReviewForSummary}=await import('./purpose-summary');expect(isPurposeReviewForSummary(review,r.report.purposeAssessmentSummary)).toBe(true);
 for(const alter of [(v:any)=>v.clauses[0].goalId='pg_'+'f'.repeat(24),(v:any)=>v.references[0].revision='f'.repeat(40),(v:any)=>v.clauses[0].changeDescriptions[0].evidenceRefs=['pe_'+'f'.repeat(24)]]){const forged=structuredClone(review);alter(forged);expect(isPurposeReviewForSummary(forged,r.report.purposeAssessmentSummary)).toBe(false);}
});

it.each(['test_only','quote_only','ref_only'] as const)('preserves safe %s partial utility without inventing explanation or promoting locations',async(kind)=>{
 const result=await run(explorer([],q=>{const p:any=final(q),c=p.clauses[0];c.implementation='supports';c.changeObservations=kind==='quote_only'?[c.changeObservations[0]]:[];c.testObservations=kind==='test_only'?[{basis:'model_interpretation',text:'The static assertion covers retained work; it is not an execution result.',evidenceRefs:c.evidenceRefs}]:[];return p;}));
 const review=result.report.purposeReview!;expect(review.clauses[0].testDescriptions.length).toBe(kind==='test_only'?1:0);expect(review.clauses[0].changeDescriptions).toEqual([]);expect(review.references.length).toBeGreaterThan(0);expect(JSON.stringify(review)).not.toContain('pending = retain()');
 expect(review.clauses[0].implementation).toBe(kind==='test_only'?'supports':'unknown');
});
it('keeps static purpose fresh across CI-only changes but rejects original source or revision/access changes',async()=>{
 const ci={...input,checks:[{name:'CI',status:'passed' as const}],logs:[],sourceProvenance:{...input.sourceProvenance!,inputFingerprint:{...input.sourceProvenance!.inputFingerprint,value:'e'.repeat(64)}}};capturePurposeDiffIndex(ci,input.changedFiles.map(f=>({filename:f.path,patch:f.patch})),{baseRefSha:base,diffBaseSha:base,headSha:head});
 await expect(run(explorer([]),backend(),{readCurrentInput:async()=>ci})).resolves.toBeTruthy();
 for(const changed of [{...input,description:'A different purpose'},{...input,repositoryPrivate:true},{...input,sourceProvenance:{...input.sourceProvenance!,headSha:'f'.repeat(40)}}])await expect(run(explorer([]),backend(),{readCurrentInput:async()=>changed})).rejects.toThrow('purpose_stale');
});
it('preserves optional conditions/exceptions, old signed field shapes and exact quote validation',async()=>{
 const r=await run(explorer([]));expect(r.report.purposeReview!.clauses[0].conditions).toEqual(['unless cancelled']);
 const {isPurposeReviewForSummary}=await import('./purpose-summary');const old=structuredClone(r.report.purposeReview!);for(const c of old.clauses){delete c.conditions;delete c.exceptions;delete c.evidenceRefs;delete c.counterEvidenceRefs;}expect(isPurposeReviewForSummary(old,r.report.purposeAssessmentSummary)).toBe(true);
 await expect(run(explorer([],q=>{const p=final(q);p.clauses[0].changeObservations[0].text='pending  = retain()';return p;}))).rejects.toThrow('purpose_final_quote');
 const changed={...input};capturePurposeDiffIndex(changed,input.changedFiles.map(f=>({filename:f.path,patch:f.patch})),{baseRefSha:base,diffBaseSha:'f'.repeat(40),headSha:head});await expect(run(explorer([]),backend(),{readCurrentInput:async()=>changed})).rejects.toThrow('purpose_stale');
});
it('partial diff reasons remain closed and valid head evidence survives unconfirmed diff base',async()=>{
 const sample={...input};capturePurposeDiffIndex(sample,[{filename:'queue.py',patch:'@@ -1,3 +1,3 @@\n-old\n+new'}]);
 const provider=async(q:any)=>{if(q.stage==='locate')return q.localization.round===0?{actions:[{targetId:q.localization.initial.changed.find((f:any)=>f.side==='head').id,startLine:1,endLine:1,clauseId}],clauses:[],stopReason:'continue'}:{actions:[],clauses:[{clauseId,evidenceRefs:q.localization.selectionSources.map((e:any)=>e.id),counterEvidenceRefs:[]}],stopReason:'selected'};return final(q);};
 const result=await assessPurpose(sample,generateVerificationReportV2FromInput(sample),{mode:'advisory',flow:'explore_final_v1',frozenSpec:spec,provider,localization:{mode:'ai',backend:backend()},readCurrentInput:async()=>sample});expect(result.report.purposeAssessmentSummary!.limitations).toEqual(expect.arrayContaining(['patch_hunk_partial','diff_base_unconfirmed']));expect(result.report.purposeReview!.references.every(e=>e.side==='head')).toBe(true);
});
it('old signed optional-field-free purpose DTO hydrates unchanged and shares no reviewer DTO or prose',async()=>{
 const {prepareTenantDetailReportForStorage}=await import('./server-report-store'),{projectTenantPersistedReport,decodeTenantPersistedReport}=await import('./tenant-report-validation'),{sanitizeReportForShare}=await import('./report-share');const result=await run(explorer([]));const safe=prepareTenantDetailReportForStorage(result.report,'verified_agentproof','fixture-signing-secret');
 for(const c of (safe as import('./types').VerificationReportV2).purposeReview!.clauses){delete c.conditions;delete c.exceptions;delete c.evidenceRefs;delete c.counterEvidenceRefs;}
 (safe as import('./types').VerificationReportV2).purposeReview!.references[0].path='docs/'+ 'a'.repeat(340)+'.md';
 const stored=projectTenantPersistedReport(safe,'fixture-signing-secret'),before=JSON.stringify(stored);expect(decodeTenantPersistedReport(stored,{signingSecret:'fixture-signing-secret',createdAt:'2026-10-13T00:00:00Z'}).status).toBe('valid');expect(JSON.stringify(stored)).toBe(before);
 const share=JSON.stringify(sanitizeReportForShare(result.report));expect(share).not.toContain('The changed source retains pending work.');expect(share).not.toContain('purposeReview');expect(share).not.toContain('changeDescriptions');expect(share).not.toContain('counterEvidenceRefs');
});

it.each(['en','ko'] as const)('projects cited hierarchy through signed storage and owner exports in %s without sharing prose',async locale=>{
 const title=locale==='ko'?'대기 작업 보존':'Retain pending work';
 const scopeText=locale==='ko'?'인용된 취소 조건 범위의 변경입니다.':'This interpretation covers the cited cancellation condition.';
 const result=await run(explorer([],q=>{const p:any=final(q);p.clauses[0].changeSummary={text:title,evidenceRefs:[q.evidence[0].id]};p.clauses[0].scopeNotes=[{text:scopeText,evidenceRefs:[q.evidence.at(-1).id]}];return p;}),backend(),{reportLanguage:locale});
 const review=result.report.purposeReview!;expect(review.clauses[0]).toMatchObject({changeSummary:{text:title},scopeNotes:[{text:scopeText}]});
 const {prepareTenantDetailReportForStorage}=await import('./server-report-store'),{projectTenantPersistedReport,decodeTenantPersistedReport}=await import('./tenant-report-validation'),{sanitizeReportForShare}=await import('./report-share');
 const stored=projectTenantPersistedReport(prepareTenantDetailReportForStorage(result.report,'verified_agentproof','fixture-signing-secret'),'fixture-signing-secret');
 const decoded=decodeTenantPersistedReport(stored,{signingSecret:'fixture-signing-secret',createdAt:'2026-10-16T00:00:00Z'});expect(decoded.status).toBe('valid');if(decoded.status!=='valid')throw Error('decode');
 expect((decoded.report as any).purposeReview).toEqual(review);
 const {selectedReportToText,dashboardReportToMarkdown,dashboardReportToJson}=await import('./dashboard-report-export'),{reportToMarkdown,reportToGitHubComment}=await import('./markdown');
 const detail:any={repositoryFullName:'acme/work',pullRequestNumber:8,headSha:head,createdAt:'2026-10-16T00:00:00Z',freshness:'current',copyEligible:true,report:decoded.report};
 for(const text of [selectedReportToText(detail,'DOM_DUPLICATE_SENTINEL'),dashboardReportToMarkdown(detail),reportToMarkdown(decoded.report)]){expect(text).toContain(title);expect(text).toContain(scopeText);expect(text).not.toContain('DOM_DUPLICATE_SENTINEL');expect(text).not.toContain('pending = retain()');}
 expect(JSON.parse(dashboardReportToJson(detail)).purposeReview).toEqual(review);
 expect(reportToMarkdown(decoded.report)).toMatch(/\n- /);expect(dashboardReportToMarkdown(detail)).toContain('/blob/');
 expect(JSON.stringify(sanitizeReportForShare(result.report))).not.toContain(scopeText);expect(reportToGitHubComment(result.report)).not.toContain(scopeText);
 const tampered=structuredClone(stored);(tampered.purposeReview!.clauses[0] as any).scopeNotes[0].text='Changed scope';expect(decodeTenantPersistedReport(tampered,{signingSecret:'fixture-signing-secret',createdAt:'2026-10-16T00:00:00Z'}).status).toBe('invalid');
});
it('hierarchy fields never supply a fit judgment or bypass local source/secret closure',async()=>{
 const {isPurposeReview}=await import('./purpose-summary');
 const result=await run(explorer([],q=>{const p:any=final(q),c=p.clauses[0];c.implementation='supports';c.changeObservations=[];c.changeSummary={text:'Selected changed material',evidenceRefs:c.evidenceRefs};c.scopeNotes=[];return p;}));
 expect(result.report.purposeReview!.clauses[0].implementation).toBe('unknown');
 for(const mutate of [(v:any)=>v.clauses[0].changeSummary.evidenceRefs=['pe_'+'f'.repeat(24)],(v:any)=>v.clauses[0].changeSummary.evidenceRefs=[],(v:any)=>v.clauses[0].changeSummary.text='api_key=fixture_secret_value',(v:any)=>v.clauses[0].scopeNotes=[{text:'Scope',evidenceRefs:['pe_'+'f'.repeat(24)]}]]){const v=structuredClone(result.report.purposeReview);mutate(v);expect(isPurposeReview(v)).toBe(false);}
 await expect(run(explorer([],q=>{const p:any=final(q);p.clauses[0].scopeNotes=[{text:'Scope',evidenceRefs:['pe_'+'f'.repeat(24)]}];return p;}))).rejects.toThrow('purpose_final_reference');
});
