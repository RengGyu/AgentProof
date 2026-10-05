import {expect,it,vi} from 'vitest';
import {extractReviewSnippets} from './review-snippets';
import * as navigation from './review-intent';
import * as snippets from './review-snippets';
const hashes=vi.hoisted(()=>({enabled:false,packets:0,fixtureSnippets:0}));
vi.mock('crypto',async original=>{const module=await original<typeof import('crypto')>();return {...module,createHash:(...args:Parameters<typeof module.createHash>)=>{const hash=module.createHash(...args),update=hash.update.bind(hash);hash.update=((data:any,...rest:any[])=>{if(hashes.enabled&&typeof data==='string'){if(data.startsWith('{"stage":'))hashes.packets++;if(data.includes('HASH_FIXTURE'))hashes.fixtureSnippets++;}return (update as any)(data,...rest);}) as typeof hash.update;return hash;}};});
import {generateVerificationReportV2FromInput} from './verifier';
import {createReviewMeasurements,recordReviewEvidence} from './review-navigation-diagnostics';
const head='a'.repeat(40),base='b'.repeat(40);
const input=(description:string,patch=''):any=>({title:'Change',url:'https://github.com/example/repo/pull/1',repositoryPrivate:false,taskText:'',description,changedFiles:[{path:'src/service.ts',status:'modified',patch}],checks:[],logs:[],sourceProvenance:{version:1,origin:'github_snapshot',headSha:head,baseSha:base,evidenceCapturedAt:'2026-10-04T00:00:00Z',inputFingerprint:{version:1,algorithm:'sha256',value:'c'.repeat(64),coverage:'github_metadata'}}});
it('exact-head lexical matches do not assign unrelated goal evidence',async()=>{
 const i=input('Retry queue jobs keep their retry flag.\n\nBilling invoice totals are doubled.','@@ -11,1 +11,1 @@\n-old\n+export function retryQueue(job){ return job.retry; }\n...[truncated for privacy and token control]');
 const blob=Array.from({length:120},(_,n)=>n===10?'export function retryQueue(job){ return job.retry; }':n===90?'export function billingInvoice(total){ return total*2; }':'// padding').join('\n');let packet:any;
 await navigation.enrichReviewNavigation(i,generateVerificationReportV2FromInput(i),{model:'fixture',readArtifacts:async paths=>paths.map(path=>({path,headSha:head,content:blob})),provider:async(q:any)=>{
  if(q.stage==='intent'){const s=q.sources.find((s:any)=>s.id==='description').spans;return {goals:s.map((sp:any,n:number)=>({summary:n?'Double billed totals':'Retain retry status',emphasis:'primary',sourceRefs:[sp.id],facets:[],openQuestions:[]})),unprocessed:[]};}
  packet=q;return {rankings:q.goals.map((g:any)=>({goalId:g.id,firstInspection:null,candidates:[],uncertainty:[]})),readPaths:[]};
 }});
 expect(packet.artifacts.find((a:any)=>a.startLine===11&&a.origin==='snapshot').goalIds).toEqual(['goal_1']);expect(packet.artifacts.find((a:any)=>a.startLine===91&&a.origin==='snapshot').goalIds).toEqual(['goal_2']);
});
it('full selected function is not labelled as a partial branch prefix',async()=>{
 const content=['export function dispatchQueue(job) {',' if (!job) {','  return null;',' }',' const window = job.dispatchWindow;',' return window;','}'].join('\n');
 const r=await extractReviewSnippets([{path:'src/queue.ts',headSha:head,content}],[{id:'goal_1',terms:['dispatchqueue','dispatchwindow','window'],anchors:[]}]);
 expect(r.snippets.some(s=>s.startLine===1&&s.endLine===7)).toBe(true);expect(r.limitations).not.toContain('retrieval_branch_prefix');
});
it('generated limitations stay closed and within12 with explicit overflow',()=>{
 const limits=['diff_context_incomplete','artifact_context_truncated','invalid_reference','retrieval_file_budget_exceeded','retrieval_budget_exceeded','retrieval_unverified_fallback','requested_path_unread','retrieval_language_unsupported','retrieval_no_matching_anchor','retrieval_parse_failed','retrieval_python_indentation','retrieval_scan_budget_exceeded','retrieval_branch_prefix'];
 const bound=(navigation as any).boundNavigationLimitations;expect(typeof bound).toBe('function');
 const result=bound(limits);expect(result).toHaveLength(12);expect(result).toContain('limitations_overflow');expect(bound(['unsafe invented raw reason'])).toEqual(['unknown_limitation']);
});
it.each(['provider_timeout','provider_rate_limited','provider_invalid_json'])('preserves %s and connects provider failure to intent stage',async reason=>{
 const codes:any={provider_timeout:'openai_timeout',provider_rate_limited:'openai_rate_limited',provider_invalid_json:'openai_output_invalid'};
 const trace=createReviewMeasurements(),i=input('Inspect the requested behavior.');
 await navigation.enrichReviewNavigation(i,generateVerificationReportV2FromInput(i),{model:'fixture',measurements:{trace},provider:async()=>{throw Object.assign(new Error('untrusted provider body'),{code:codes[reason],...(reason==='provider_invalid_json'?{navigationReason:reason}:{})});}});
 expect(trace.snapshot().evidence).toContainEqual(expect.objectContaining({stage:'provider_failure',reason,failureStage:'intent'}));expect(JSON.stringify(trace.snapshot())).not.toContain('untrusted provider body');
});
it('cap skips lazy diagnostic metadata rather than hashing discarded source',()=>{
 const trace=createReviewMeasurements(),build=vi.fn(()=>({reason:'included'}));recordReviewEvidence({trace},'snippet',build as any);expect(build).toHaveBeenCalledTimes(1);
 for(let n=0;n<1023;n++)trace.record('artifact',{reason:'included'});recordReviewEvidence({trace},'snippet',build as any);
 expect(build).toHaveBeenCalledTimes(1);expect(trace.snapshot().droppedEvidence).toBe(1);
});
it('bounded goal selection stays within the CPU boundary when retired facet hints are supplied',async()=>{
 await import('typescript');const terms=Array.from({length:40},(_,n)=>'token'+n);
 const files=Array.from({length:8},(_,f)=>({path:`src/mod${f}.ts`,headSha:head,content:Array.from({length:250},(_,n)=>`export function fn${n}(retryQueue,billingInvoice){if(retryQueue.token${n%40}) return billingInvoice.token${(n+3)%40};}`).join('\n')}));
 const goals=Array.from({length:16},(_,n)=>({id:`goal_${n+1}`,terms:['retryqueue','billinginvoice',...terms.slice(n,n+10)],anchors:[],conditions:Array.from({length:12},(_,f)=>({id:`c${f}`,terms:['retryqueue','billinginvoice',terms[(n+f)%40]!]}))}));
 const start=performance.now();const r=await extractReviewSnippets(files,goals);expect(performance.now()-start).toBeLessThan(5000);expect(r.snippets.length).toBeLessThanOrEqual(16);
},30_000);

it('finish with13 generated limits passes report schema and records overflow count',async()=>{
 const codes=['retrieval_file_budget_exceeded','retrieval_budget_exceeded','retrieval_unverified_fallback','requested_path_unread','retrieval_language_unsupported','retrieval_no_matching_anchor','retrieval_parse_failed','retrieval_python_indentation','retrieval_scan_budget_exceeded','retrieval_branch_prefix','artifact_context_truncated','invalid_reference'];
 const spy=vi.spyOn(snippets,'extractReviewSnippets').mockResolvedValueOnce({snippets:[],limitations:codes});
 try{const i=input('Retain retry queue behavior.',''),trace=createReviewMeasurements();
 const report=await navigation.enrichReviewNavigation(i,generateVerificationReportV2FromInput(i),{model:'fixture',measurements:{trace},readArtifacts:async paths=>paths.map(path=>({path,headSha:head,content:'export function retryQueue(){ return true; }'})),provider:async q=>q.stage==='intent'?{goals:[{summary:'Retain retry queue',emphasis:'primary',sourceRefs:[q.sources[0].spans[0].id],facets:[],openQuestions:[]}],unprocessed:[]}:{rankings:[],readPaths:[]}});
 const nav=report.reviewCandidates!.navigation!;expect(navigation.validReviewNavigation(nav)).toBe(true);expect(nav.limitations).toHaveLength(12);expect(nav.limitations).toContain('limitations_overflow');expect(trace.snapshot().evidence).toContainEqual(expect.objectContaining({reason:'limitations_overflow',count:2}));
 }finally{spy.mockRestore();}
});
it('hashes each request packet once regardless of candidate edges',async()=>{
 const i=input('Retain retry queue behavior.','@@ -1,2 +1,2 @@\n+export function retryQueue(){\n+ return true;');hashes.packets=0;hashes.enabled=true;
 try{await navigation.enrichReviewNavigation(i,generateVerificationReportV2FromInput(i),{model:'fixture',measurements:{trace:createReviewMeasurements()},provider:async q=>q.stage==='intent'?{goals:[{summary:'Retain retry queue',emphasis:'primary',sourceRefs:[q.sources[0].spans[0].id],facets:[],openQuestions:[]}],unprocessed:[]}:{rankings:q.goals.map(g=>({goalId:g.id,firstInspection:q.artifacts[0]?.id??null,candidates:q.artifacts.map(a=>({artifactId:a.id,relevance:'possible',whyInspect:'Inspect source',reviewQuestion:'Is retry retained?',uncertainty:''})),uncertainty:[]})),readPaths:[]}});expect(hashes.packets).toBe(2);
 }finally{hashes.enabled=false;}
});
it('does not hash snippet metadata after the evidence trace closes',async()=>{
 const trace=createReviewMeasurements();for(let n=0;n<1024;n++)trace.record('artifact',{reason:'included'});
 hashes.fixtureSnippets=0;hashes.enabled=true;try{const r=await extractReviewSnippets([{path:'src/fixture.ts',headSha:head,content:'export function HASH_FIXTURE(retryQueue){ return retryQueue; }'}],[{id:'goal_1',terms:['retryqueue'],anchors:[]}],{trace});expect(r.snippets).toHaveLength(1);expect(hashes.fixtureSnippets).toBe(0);expect(trace.snapshot().droppedEvidence).toBeGreaterThan(0);}finally{hashes.enabled=false;}
});

it('provider failure retains the ranking stage instead of local validation',async()=>{
 const i=input('Retain retry queue behavior.','@@ -1 +1 @@\n+retryQueue();'),trace=createReviewMeasurements();
 await navigation.enrichReviewNavigation(i,generateVerificationReportV2FromInput(i),{model:'fixture',measurements:{trace},provider:async q=>{if(q.stage==='intent')return {goals:[{summary:'Retain retry queue',emphasis:'primary',sourceRefs:[q.sources[0].spans[0].id],facets:[],openQuestions:[]}],unprocessed:[]};throw Object.assign(new Error('PRIVATE_BODY'),{code:'openai_timeout'});}});
 expect(trace.snapshot().evidence).toContainEqual(expect.objectContaining({stage:'provider_failure',reason:'provider_timeout',failureStage:'ranking'}));expect(JSON.stringify(trace.snapshot())).not.toContain('PRIVATE_BODY');
});
