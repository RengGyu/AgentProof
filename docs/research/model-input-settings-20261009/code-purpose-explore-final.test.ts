import {describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {assessPurpose} from './purpose-assessment';
import {buildPurposeSources,compilePurposeSpec} from './purpose-spec';
import {generateVerificationReportV2FromInput} from './verifier';
import type {PullRequestInput} from './types';
const head='a'.repeat(40),base='b'.repeat(40);
const input:PullRequestInput={title:'Retain pending work',taskText:'',description:'Keep pending work unless cancelled.',repositoryPrivate:false,url:'https://github.com/acme/work/pull/8',changedFiles:[{path:'queue.py',status:'modified',patch:'@@ -1,2 +1,2 @@\n-old\n+new'}],checks:[],logs:[],sourceProvenance:{version:1,origin:'github_snapshot',headSha:head,baseSha:base,evidenceCapturedAt:'2026-10-08T00:00:00Z',inputFingerprint:{version:1,algorithm:'sha256',value:'c'.repeat(64),coverage:'github_metadata'}}};
function frozen(){const s=buildPurposeSources(input);return compilePurposeSpec(input,{goals:[{sourceRefs:[s.spans[0].id],clauses:[{sourceRefs:[s.spans[0].id],expectedObservable:'Retain pending work',conditions:['unless cancelled'],exceptions:[],obligation:'required',evidenceNeed:'behavioral'}]}],contextRefs:s.spans.slice(1).map(s=>s.id),unprocessedSourceRefs:[],ambiguities:[]});}
const spec=frozen(),clauseId=spec.goals[0].clauses[0].id;
function backend(){const content=(revision:string)=>revision===head?'pending = retain()\n# cancellation helper not shown':'pending = discard()\n# old implementation';const sha=(s:string)=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0').update(s).digest('hex');return {manifest:async(_side:any,revision:string)=>({repository:'acme/work',revision,treeSha:'c'.repeat(40),complete:true,entries:[{path:'queue.py',mode:'100644' as const,size:Buffer.byteLength(content(revision)),blobSha:sha(content(revision))}]}),readBlob:vi.fn(async(e:any,revision:string)=>({path:e.path,revision,blobSha:e.blobSha,content:content(revision),complete:true,bytesRead:Buffer.byteLength(content(revision))}))};}
function final(q:any){const refs=q.evidence.map((e:any)=>e.id);return {clauses:[{clauseId,implementation:'unknown',testRelation:'unknown',evidenceRefs:refs,counterEvidenceRefs:[],changeObservations:[{basis:'source_text',text:'pending = retain()',evidenceRefs:[q.evidence.find((e:any)=>e.side==='head').id]}],testObservations:[{basis:'model_interpretation',text:'The cancellation helper and assertions are not supplied.',evidenceRefs:refs}],remainingQuestions:[{text:'What does the cancellation helper do?',evidenceRefs:refs}]}]};}
function explorer(seen:any[],answer=(q:any)=>final(q)){return vi.fn(async(q:any)=>{seen.push(structuredClone(q));if(q.stage==='locate'){const l=q.localization;if(l.round<3){const f=l.initial.changed.find((e:any)=>e.side===(l.round===1?'base':'head'));return {actions:[{kind:'inspect',targetId:f.id,view:'source',startLine:l.round===2?2:1,endLine:2,cursor:0,literal:'',clauseId}],clauses:[],stopReason:'continue'};}return {actions:[],clauses:[{clauseId,implementationRefs:l.selectionSources.map((e:any)=>e.id),definitionRefs:[],callerRefs:[],testSetupRefs:[],testAssertionRefs:[],counterEvidenceRefs:[],searchState:'collected'}],stopReason:'selected'};}return answer(q);});}
async function run(call:any,b=backend(),more:any={}){return assessPurpose(input,generateVerificationReportV2FromInput(input),{mode:'advisory',flow:'explore_final_v1',frozenSpec:spec,provider:call,readCurrentInput:async()=>input,localization:{mode:'ai',backend:b},...more} as any);}
describe('explore then final assessment opt-in',()=>{
 it('keeps earlier source and tool results, caches same SHA reads, then assesses once without checker/refinement',async()=>{const seen:any[]=[],b=backend();const r=await run(explorer(seen),b);const locate=seen.filter(q=>q.stage==='locate');expect(locate[2].localization.results).toHaveLength(2);expect(locate[2].localization.selectionSources.map((e:any)=>e.side).sort()).toEqual(['base','head']);expect(b.readBlob).toHaveBeenCalledTimes(2);expect(seen.map(q=>q.stage)).toEqual(['locate','locate','locate','locate','assess']);const q=seen.at(-1);expect(q.flow).toBe('explore_final_v1');expect(q.evidence).toHaveLength(2);expect(q.coverage.readOutcomes).toHaveLength(3);expect(r.assessment?.goals[0].clauseResults[0]).toMatchObject({implementation:'unknown',execution:'not_observed',openQuestions:['What does the cancellation helper do?']});expect((r.assessment as any).facts.clauses[0].changeObservations[0].basis).toBe('source_text');});
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
 for(const text of ['Changes','Test meaning','Execution','Remaining questions','Source quotation','Model interpretation','pending = retain()','not observed'])expect(html).toContain(text);
 expect(html).not.toContain('Purpose 1: unclear');
 const saved=prepareTenantDetailReportForStorage(r.report,'verified_agentproof','fixture-signing-secret');
 expect(validateTenantPersistedReport(projectTenantPersistedReport(saved,'fixture-signing-secret'),'fixture-signing-secret').valid).toBe(true);
 for(const projected of [saved,sanitizeReportForShare(r.report)]){expect(JSON.stringify(projected)).not.toContain('pending = retain()');expect(JSON.stringify(projected)).not.toContain('"facts"');expect(JSON.stringify(projected)).toContain('explore_final_v1');}
 const summaryHtml=renderToStaticMarkup(createElement(PrEvidenceReview,{review:buildPrEvidenceReview(saved)}));expect(summaryHtml).toContain('Only the saved summary');expect(summaryHtml).not.toContain('pending = retain()');
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
 const repository:any={candidates,initial:()=>({changed:[]}),select:(refs:{id:string}[])=>candidates.filter(e=>refs.some(r=>r.id===e.id)).slice(0,16),limitations:[],metrics:()=>({}),collector:{limitations:[]}};
 const seen:any[]=[];
 const invoke=async(q:any)=>{seen.push(q);return {actions:[],clauses:[{clauseId,implementationRefs:q.localization.selectionSources.map((e:any)=>e.id),definitionRefs:[],callerRefs:[],testSetupRefs:[],testAssertionRefs:[],counterEvidenceRefs:[],searchState:'collected'}],stopReason:'selected'};};
 const result=await localizePurpose(input,spec,repository,{mode:'ai',flow:'explore_final_v1',invoke});
 expect(seen[0].localization.selectionSources).toHaveLength(16);expect(Buffer.byteLength(JSON.stringify(seen[0].localization.selectionSources))).toBeLessThanOrEqual(48000);expect(seen[0].localization.omittedCandidates).toEqual([{id:'e16',reason:'selection_context_budget'}]);expect(result.coverage.omittedEvidence).toContainEqual(expect.objectContaining({id:'e16',reason:'packet_budget'}));expect(result.limitations).toContain('localization_packet_budget');
 const droppedCounter = {...repository,select:(refs:{id:string}[])=>repository.select(refs).slice(0,15)};
 await expect(localizePurpose(input,spec,droppedCounter,{mode:'ai',flow:'explore_final_v1',invoke:async(q:any)=>{const p=await invoke(q);p.clauses[0].counterEvidenceRefs=['e15'] as any;return p;}})).rejects.toThrow('purpose_final_counterevidence_budget');

});
