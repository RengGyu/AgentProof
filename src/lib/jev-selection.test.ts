import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { prepareJevSelection, applyJevSelection, submitJevSelection, type JevSelectionContext } from './jev-selection';
import { withPaidAnalysis } from './paid-budget';
import { createReviewMeasurements, reviewArtifactId } from './review-navigation-diagnostics';
import { extractReviewSnippets } from './review-snippets';
import { enrichReviewNavigation, validReviewNavigation, type ReviewNavigationRequest } from './review-intent';
import { generateVerificationReportV2FromInput } from './verifier';
import type { PullRequestInput } from './types';
const head='a'.repeat(40),base='b'.repeat(40);
const artifact=(n:number,kind:'code'|'test'='code',goalIds=['goal_1'])=>{
 const content=`function work${n}() { return mainValue${n}; }`,hash=createHash('sha256').update(content).digest('hex');
 const data={path:`${kind==='test'?'tests':'src'}/work${n}.ts`,revision:head,side:'head' as const,startLine:1,endLine:1,hash,kind,origin:'snapshot' as const,content,goalIds};
 return {...data,id:reviewArtifactId(data)};
};
const context=(count=2):JevSelectionContext=>({repositoryPrivate:false,headSha:head,baseSha:base,protectedIds:[],packet:{stage:'ranking',model:'unchanged-final',sources:[],goals:[],artifacts:Array.from({length:count},(_,i)=>artifact(i)),inventory:[],capabilities:{readPaths:false,searchScope:'supplied_artifacts',wholeRepository:false}},candidates:[artifact(99)]});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});

it('adds one supplied interval and preserves the final model and original packet',()=>{
 const c=context(),p=prepareJevSelection(c)!;
 const r=applyJevSelection(c,p.proposals[0]);
 expect(r.accepted).toBe(true);expect(r.artifacts.map(a=>a.id)).toEqual([...c.packet.artifacts.map(a=>a.id),artifact(99).id]);
 expect(c.packet.artifacts).toHaveLength(2);expect(c.packet.model).toBe('unchanged-final');
});
it('allows at most one replacement and refuses protected IDs or lost goal/kind coverage',()=>{
 const c=context(16);c.protectedIds=c.packet.artifacts.slice(0,15).map(a=>a.id);
 const proposal=prepareJevSelection(c)!.proposals[0];expect(proposal.removeId).toBe(c.packet.artifacts[15].id);
 expect(applyJevSelection(c,proposal).artifacts).toHaveLength(16);
 expect(applyJevSelection(c,{addId:artifact(99).id,removeId:c.packet.artifacts[0].id}).accepted).toBe(false);
 c.packet.artifacts[15]={...c.packet.artifacts[15],goalIds:['goal_2']};
 expect(applyJevSelection(c,proposal).accepted).toBe(false);
 c.protectedIds=c.packet.artifacts.map(a=>a.id);expect(prepareJevSelection(c)).toBeNull();
});
it('refuses stale, non-redacted, forged and oversized artifacts without mutating baseline',()=>{
 for(const candidate of [{...artifact(99),revision:base},{...artifact(99),content:'password="secret-value"'},{...artifact(99),id:'forged'}, {...artifact(99),endLine:200}]){
 const c=context();c.candidates=[candidate];expect(prepareJevSelection(c)).toBeNull();expect(applyJevSelection(c,{addId:candidate.id,removeId:null}).accepted).toBe(false);
 }
 expect(prepareJevSelection({...context(),repositoryPrivate:true})).toBeNull();
});
it('keeps exact serialized UTF-8 bytes at 48k and rejects the next byte without truncation',()=>{
 const content=(a:ReviewNavigationRequest['artifacts'][number],value:string)=>{const next={...a,content:value,hash:createHash('sha256').update(value).digest('hex')};return {...next,id:reviewArtifactId(next)};};
 const c=context(5);c.packet.artifacts=c.packet.artifacts.map(a=>content(a,'é'.repeat(3800)));
 c.protectedIds=c.packet.artifacts.map(a=>a.id);
 let extra=content(artifact(99),'é'.repeat(3800));
 let remaining=48000-Buffer.byteLength(JSON.stringify([...c.packet.artifacts,extra]));
 expect(remaining).toBeGreaterThan(0);
 c.packet.artifacts=c.packet.artifacts.map(a=>{const size=Math.min(remaining,8000-Buffer.byteLength(a.content));remaining-=size;return content(a,a.content+'x'.repeat(size));});
 expect(remaining).toBe(0);c.protectedIds=c.packet.artifacts.map(a=>a.id);c.candidates=[extra];
 const proposal={addId:extra.id,removeId:null};
 expect(applyJevSelection(c,proposal).accepted).toBe(true);
 expect(Buffer.byteLength(JSON.stringify(applyJevSelection(c,proposal).artifacts))).toBe(48000);
 c.candidates=[content(extra,extra.content+'x')];
 expect(applyJevSelection(c,{addId:c.candidates[0].id,removeId:null}).accepted).toBe(false);expect(prepareJevSelection(c)).toBeNull();
});
it('captures bounded pre-budget candidates without changing normal snippet selection',async()=>{
 const content=Array.from({length:24},(_,n)=>`function work${n}() { return mainValue${n}; }`).join('\n');
 const files=[{path:'src/work.ts',headSha:head,content}],goals=[{id:'goal_1',terms:['main'],anchors:[]}];
 let candidates:unknown[]=[];
 const normal=await extractReviewSnippets(files,goals);
 const observed=await extractReviewSnippets(files,goals,undefined,pool=>{candidates=pool;});
 expect(observed).toEqual(normal);expect(candidates.length).toBeGreaterThan(observed.snippets.length);expect(candidates.length).toBeLessThanOrEqual(64);
});

function ledger(price={inputUsdPerMillion:'0.042',outputUsdPerMillion:'0',callReserveKrw:'3',source:'https://docs.typesafe.ai/models'},response?:unknown,deny=false){
 vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_URL','https://budget.invalid');vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY','fixture');
 const actions:Record<string,unknown>[]=[];const provider:RequestInit[]=[];
 vi.stubGlobal('fetch',async(url:RequestInfo|URL,init?:RequestInit)=>{
 if(String(url).startsWith('https://budget.invalid')){const body=JSON.parse(String(init?.body));actions.push(body);return Response.json(body.p_action==='config'?{allowed:true,config:{timeZone:'Asia/Seoul',krwPerUsd:'1000',validUntil:'2099-01-01T00:00:00Z',prices:{'typesafe/jev-1.13.0':price}}}:body.p_action==='reserve'&&deny?{allowed:false,reason:'hard_pause'}:{allowed:true});}
 provider.push(init!);if(init?.signal?.aborted)throw new Error('cancelled');
 return Response.json(response??{model:'jev-1.13.0',usage:{input_tokens:1000,output_tokens:20},answers:{selection:{type:'choice',choice:'option_1',confidence:0.9,probabilities:{none:0.1,option_1:0.9}}}});
 });return {actions,provider};
}
it('reserves before transport, accounts input-only usage and returns text-free metadata',async()=>{
 const l=ledger(),prepared=prepareJevSelection(context())!;
 const r=await withPaidAnalysis('fixture',()=>submitJevSelection(prepared,{apiKey:'fixture-key'}));
 expect(r.proposal).toEqual(prepared.proposals[0]);expect(r.usage).toEqual({input:1000,output:20});expect(r.model).toBe('jev-1.13.0');
 expect(l.actions.find(a=>a.p_action==='settle')).toMatchObject({p_charge:42});expect(l.actions.at(-1)?.p_action).toBe('close');expect(l.provider).toHaveLength(1);
 expect(JSON.stringify(r)).not.toContain('mainValue');expect(JSON.stringify(l.actions)).not.toMatch(/fixture-key|mainValue/);
});
it('retains reservation on missing usage and rejects mismatched model or malformed probabilities',async()=>{
 for(const response of [{model:'jev-1.13.0',answers:{}},{model:'jev-future',usage:{input_tokens:1000,output_tokens:20},answers:{}},{model:'jev-1.13.0',usage:{input_tokens:1000,output_tokens:20},answers:{selection:{type:'choice',choice:'option_1',confidence:0.9,probabilities:{none:0.5,option_1:0.9}}}}]){
 const l=ledger(undefined,response);await expect(withPaidAnalysis('fixture',()=>submitJevSelection(prepareJevSelection(context())!,{apiKey:'fixture'}))).rejects.toThrow();
 expect(l.actions.find(a=>a.p_action==='settle')).toBeDefined();if(!('usage' in response))expect(l.actions.find(a=>a.p_action==='settle')?.p_charge).toBeNull();
 }
});
it('fails closed before any provider call without scope, with pause, or under-reserved zero-output pricing',async()=>{
 const p=prepareJevSelection(context())!;const l=ledger();await expect(submitJevSelection(p,{apiKey:'fixture'})).rejects.toThrow();expect(l.provider).toHaveLength(0);
 const paused=ledger(undefined,undefined,true);await expect(withPaidAnalysis('fixture',()=>submitJevSelection(p,{apiKey:'fixture'}))).rejects.toThrow();expect(paused.provider).toHaveLength(0);
 const under=ledger({inputUsdPerMillion:'0.042',outputUsdPerMillion:'0',callReserveKrw:'0.001',source:'https://docs.typesafe.ai/models'});await expect(withPaidAnalysis('fixture',()=>submitJevSelection(p,{apiKey:'fixture'}))).rejects.toThrow();expect(under.provider).toHaveLength(0);
});
it('uses no implicit retry or raw provider error text',async()=>{
 const l=ledger();const original=fetch;vi.stubGlobal('fetch',async(url:RequestInfo|URL,init?:RequestInit)=>String(url).startsWith('https://api.typesafe.ai')?new Response('SECRET_RAW_ERROR',{status:429}):original(url,init));
 await expect(withPaidAnalysis('fixture',()=>submitJevSelection(prepareJevSelection(context())!,{apiKey:'fixture'}))).rejects.toThrow('jev_http_429');
 expect(l.actions.find(a=>a.p_action==='settle')?.p_charge).toBeNull();
});

it('runs opt-in once and exposes a pre-snippet-budget interval to the final model and local validator',async()=>{
 const content=Array.from({length:24},(_,n)=>`function work${n}() { return mainValue${n}; }`).join('\n');
 const i:PullRequestInput={title:'Inspect main behavior',taskSource:'task',taskText:'Inspect main behavior',description:'',url:'https://github.com/example/repo/pull/1',repositoryPrivate:false,changedFiles:[{path:'src/work.ts',status:'modified',patch:''}],checks:[],logs:[],sourceProvenance:{version:1,origin:'github_snapshot',headSha:head,baseSha:base,evidenceCapturedAt:'2026-10-06T00:00:00Z',inputFingerprint:{version:1,algorithm:'sha256',value:'c'.repeat(64),coverage:'github_metadata'}}};
 let supplements=0,chosen:string|undefined,final:ReviewNavigationRequest|undefined;
 const r=await enrichReviewNavigation(i,generateVerificationReportV2FromInput(i),{model:'fixture',readArtifacts:async paths=>paths.map(path=>({path,headSha:head,content})),selectionExperiment:async c=>{
 supplements++;const p=prepareJevSelection(c);expect(p).not.toBeNull();chosen=p!.proposals[0].addId;return p!.proposals[0];
 },provider:async q=>{
 if(q.stage==='intent')return {goals:[{summary:'Inspect main behavior',emphasis:'primary',sourceRefs:[q.sources[0].spans[0].id],facets:[],openQuestions:[]}],unprocessed:[]};
 final=q;return {rankings:q.goals.map(g=>({goalId:g.id,firstInspection:chosen??q.artifacts[0].id,candidates:[{artifactId:chosen??q.artifacts[0].id,relevance:'relevant',whyInspect:'Inspect bounded supplied logic',reviewQuestion:'Does the supplied interval support this goal?',uncertainty:'Not executed'}],uncertainty:[]})),readPaths:[]};
 }});
 expect(supplements).toBe(1);expect(final!.artifacts.some(a=>a.id===chosen)).toBe(true);expect(r.reviewCandidates?.navigation?.goals[0].firstInspection).toBe(chosen);expect(validReviewNavigation(r.reviewCandidates?.navigation)).toBe(true);
});

it('settles unknown usage once on caller cancellation without retry',async()=>{
 const l=ledger(),original=fetch,controller=new AbortController();
 vi.stubGlobal('fetch',async(url:RequestInfo|URL,init?:RequestInit)=>{
  if(!String(url).startsWith('https://api.typesafe.ai'))return original(url,init);
  return await new Promise<Response>((_resolve,reject)=>{init!.signal!.addEventListener('abort',()=>reject(Error('RAW_ABORT')), {once:true});controller.abort();});
 });
 await expect(withPaidAnalysis('fixture',()=>submitJevSelection(prepareJevSelection(context())!,{apiKey:'fixture',signal:controller.signal}))).rejects.toThrow('jev_cancelled');
 expect(l.actions.filter(a=>a.p_action==='reserve')).toHaveLength(1);expect(l.actions.filter(a=>a.p_action==='settle')).toHaveLength(1);expect(l.actions.find(a=>a.p_action==='settle')?.p_charge).toBeNull();
});

it('preserves safe Jev failure metadata after the navigation catch without exposing raw errors or changing settlement',async()=>{
 const samples=[
  {reply:()=>new Response('SECRET_PROVIDER_BODY',{status:400}),code:'jev_http_error',status:400,usage:null,charge:null},
  {reply:()=>new Response('SECRET_PROVIDER_BODY',{status:429}),code:'jev_http_error',status:429,usage:null,charge:null},
  {reply:()=>{throw Error('SECRET_TRANSPORT');},code:'jev_transport_failed',status:null,usage:null,charge:null},
  {reply:()=>new Response('SECRET_INVALID_JSON',{status:200}),code:'jev_response_invalid',status:200,usage:null,charge:null},
  {reply:()=>Response.json({model:'jev-1.13.0',answers:{}}),code:'jev_usage_unavailable',status:200,usage:false,charge:null},
  {reply:()=>Response.json({model:'SECRET_DIFFERENT_MODEL',usage:{input_tokens:1000,output_tokens:20},answers:{}}),code:'jev_model_mismatch',status:200,usage:true,charge:null},
  {reply:()=>Response.json({model:'jev-1.13.0',usage:{input_tokens:1000,output_tokens:20},answers:{selection:{type:'choice',choice:'none',confidence:0.9,probabilities:{none:2}}}}),code:'jev_response_invalid',status:200,usage:true,charge:42},
 ];
 const input:PullRequestInput={title:'Inspect main behavior',taskSource:'task',taskText:'Inspect main behavior',description:'',url:'https://github.com/example/repo/pull/1',repositoryPrivate:false,changedFiles:[{path:'src/work.ts',status:'modified',patch:''}],checks:[],logs:[],sourceProvenance:{version:1,origin:'github_snapshot',headSha:head,baseSha:base,evidenceCapturedAt:'2026-10-06T00:00:00Z',inputFingerprint:{version:1,algorithm:'sha256',value:'c'.repeat(64),coverage:'github_metadata'}}};
 for(const sample of samples){
  const l=ledger(),original=fetch,trace=createReviewMeasurements();let attempts=0;
  vi.stubGlobal('fetch',async(url:RequestInfo|URL,init?:RequestInit)=>{if(!String(url).startsWith('https://api.typesafe.ai'))return original(url,init);attempts++;return sample.reply();});
  const report=await withPaidAnalysis('failure-fixture',()=>enrichReviewNavigation(input,generateVerificationReportV2FromInput(input),{model:'fixture',measurements:{trace},readArtifacts:async paths=>paths.map(path=>({path,headSha:head,content:Array.from({length:24},(_,n)=>`function work${n}() { return mainValue${n}; }`).join('\n')})),selectionExperiment:async(c,measurements)=>{await submitJevSelection(prepareJevSelection(c)!,{apiKey:'fixture-key',measurements});return null;},provider:async q=>q.stage==='intent'?{goals:[{summary:'Inspect main behavior',emphasis:'primary',sourceRefs:[q.sources[0].spans[0].id],facets:[],openQuestions:[]}],unprocessed:[]}:{rankings:[],readPaths:[]}}));
  const failures=trace.snapshot().evidence.filter(e=>e.stage==='provider_failure'&&e.providerFailureCode);
  expect(failures).toHaveLength(1);expect(failures[0]).toMatchObject({providerFailureCode:sample.code,httpStatus:sample.status,usagePresent:sample.usage});
  expect(validReviewNavigation(report.reviewCandidates?.navigation)).toBe(true);
  const serialized=JSON.stringify({trace:trace.snapshot(),navigation:report.reviewCandidates?.navigation});
  expect(serialized).not.toMatch(/SECRET_|fixture-key|mainValue|providerFailureCode.*SECRET/);
  expect(JSON.stringify(report.reviewCandidates?.navigation)).not.toMatch(/httpStatus|providerFailureCode|usagePresent/);
  expect(attempts).toBe(1);expect(l.actions.filter(a=>a.p_action==='reserve')).toHaveLength(1);expect(l.actions.filter(a=>a.p_action==='settle')).toHaveLength(1);expect(l.actions.find(a=>a.p_action==='settle')).toMatchObject({p_charge:sample.charge});expect(l.actions.at(-1)?.p_action).toBe('close');
 }
 const trace=createReviewMeasurements();trace.record('provider_failure',{providerFailureCode:'SECRET_CODE' as never,httpStatus:NaN,usagePresent:'SECRET_USAGE' as never});
 expect(trace.snapshot().evidence[0]).not.toHaveProperty('providerFailureCode');expect(trace.snapshot().evidence[0]).not.toHaveProperty('usagePresent');
});

it('extracts bounded HTTP400 diagnostics without raw messages and retains unknown settlement',async()=>{
 const samples=[
  {body:{detail:{error_type:'api_usage_error',message:'State and question tokens exceed maximum 32768 tokens; received 39000 tokens.'}},expected:{jevErrorBody:'json',jevRejection:'context_token_limit',jevProviderErrorCode:'api_usage_error',jevContextTokenLimit:32768,jevContextTokens:39000,usagePresent:false}},
  {body:{detail:[{type:'validation_error',loc:['body','questions','selection','criteria'],msg:'SECRET_PRIVATE_PROMPT',input:'SECRET_CODE'}]},expected:{jevErrorBody:'json',jevRejection:'field_validation',jevErrorField:'questions.selection.criteria',usagePresent:false}},
  {body:{error:{code:'SECRET_CODE',message:'SECRET_CONTEXT maximum 32768 tokens; received 39000 tokens.'},detail:[{loc:['body','SECRET_PATH'],msg:'SECRET'}],usage:{}},expected:{jevErrorBody:'json',jevRejection:'unknown',usagePresent:true}},
  {body:'SECRET_HTML',expected:{jevErrorBody:'non_json',jevRejection:'unknown',usagePresent:null}},
  {body:'SECRET_LARGE'.repeat(4000),expected:{jevErrorBody:'too_large',jevRejection:'unknown',usagePresent:null}},
 ];
 for(const sample of samples){
  const l=ledger(),original=fetch,trace=createReviewMeasurements();let attempts=0;
  vi.stubGlobal('fetch',async(url:RequestInfo|URL,init?:RequestInit)=>{if(!String(url).startsWith('https://api.typesafe.ai'))return original(url,init);attempts++;return typeof sample.body==='string'?new Response(sample.body,{status:400}):Response.json(sample.body,{status:400});});
  await expect(withPaidAnalysis('fixture400',()=>submitJevSelection(prepareJevSelection(context())!,{apiKey:'fixture-key',measurements:{trace}}))).rejects.toThrow('jev_http_400');
  const e=trace.snapshot().evidence.find(e=>e.providerFailureCode)!;expect(e).toMatchObject({providerFailureCode:'jev_http_error',httpStatus:400,...sample.expected});
  expect(JSON.stringify(trace.snapshot())).not.toMatch(/SECRET|fixture-key|State and question/);
  expect(attempts).toBe(1);expect(l.actions.filter(a=>a.p_action==='reserve')).toHaveLength(1);expect(l.actions.filter(a=>a.p_action==='settle')).toHaveLength(1);expect(l.actions.find(a=>a.p_action==='settle')?.p_charge).toBeNull();expect(l.actions.at(-1)?.p_action).toBe('close');
 }
 const trace=createReviewMeasurements();trace.record('provider_failure',{jevErrorField:'SECRET' as never,jevProviderErrorCode:'SECRET' as never,jevContextTokens:NaN,jevContextTokenLimit:1_000_001});
 expect(trace.snapshot().evidence[0]).not.toHaveProperty('jevErrorField');expect(trace.snapshot().evidence[0]).not.toHaveProperty('jevProviderErrorCode');expect(trace.snapshot().evidence[0]).not.toHaveProperty('jevContextTokens');expect(trace.snapshot().evidence[0]).not.toHaveProperty('jevContextTokenLimit');
});


it('slims metadata with closed aliases, preserves all source and caps candidates in supplied order',()=>{
 const c=context(16);c.candidates=Array.from({length:9},(_,i)=>artifact(100+i));
 const before=structuredClone(c),p=prepareJevSelection(c)!;
 expect(p.proposals).toHaveLength(4);expect(p.excluded).toBe(5);
 expect(p.proposals.map(x=>x.addId)).toEqual(c.candidates.slice(0,4).map(a=>a.id));
 expect(p.request.state.baseline.map(a=>a.content)).toEqual(c.packet.artifacts.map(a=>a.content));
 expect(p.request.state.candidates.map(a=>a.content)).toEqual(c.candidates.slice(0,4).map(a=>a.content));
 expect(p.request.state.goals).toEqual(c.packet.goals);expect(c).toEqual(before);
 expect(p.request.state.baseline[0].id).toBe('a0');expect(p.request.state.candidates[0].id).toBe('a16');
 expect(p.request.questions.selection.criteria.option_1).toEqual({add:'a16',remove:'a15'});
 expect(JSON.stringify(p.request)).not.toContain(c.packet.artifacts[0].revision);
 expect(JSON.stringify(p.request)).not.toContain(c.packet.artifacts[0].id);
 expect(Buffer.byteLength(JSON.stringify(p.request))).toBeLessThanOrEqual(40000);
 for(let i=0;i<c.packet.artifacts.length;i++)for(const k of ['path','side','startLine','endLine','kind','origin','goalIds','content'] as const)expect(p.request.state.baseline[i][k]).toEqual(c.packet.artifacts[i][k]);
});
it('reports oversize baseline as a local no-op and skips oversized whole candidates without truncation',()=>{
 const replace=(a:ReviewNavigationRequest['artifacts'][number],content:string)=>{const next={...a,content,hash:createHash('sha256').update(content).digest('hex')};return {...next,id:reviewArtifactId(next)};};
 const c=context(5);c.packet.artifacts=c.packet.artifacts.map(a=>replace(a,'x'.repeat(7300)));
 c.protectedIds=c.packet.artifacts.map(a=>a.id);c.candidates=[replace(artifact(98),'x'.repeat(7300)),artifact(99)];
 const d:NonNullable<Parameters<typeof prepareJevSelection>[1]>={};const p=prepareJevSelection(c,d)!;
 expect(p.proposals.map(x=>x.addId)).toEqual([artifact(99).id]);expect(p.excluded).toBe(1);expect(d.reason).toBe('ready');
 expect(p.request.state.baseline.map(a=>a.content)).toEqual(c.packet.artifacts.map(a=>a.content));
 c.packet.artifacts=c.packet.artifacts.map(a=>replace(a,'x'.repeat(7900)));const before=structuredClone(c);
 expect(prepareJevSelection(c,d)).toBeNull();expect(d.reason).toBe('baseline_byte_cap');expect(c).toEqual(before);
});
it('returns exact safe probabilities and original proposal references after alias-based transport',async()=>{
 const l=ledger(),c=context(),p=prepareJevSelection(c)!;
 const r=await withPaidAnalysis('alias-fixture',()=>submitJevSelection(p,{apiKey:'fixture-key'}));
 expect(r.proposal).toEqual({addId:c.candidates[0].id,removeId:null});
 expect(r.choice).toBe('option_1');expect(r.probabilities).toEqual({none:0.1,option_1:0.9});
 const sent=JSON.parse(String(l.provider[0].body));expect(sent.questions.selection.criteria.option_1).toEqual({add:'a2',remove:null});
 expect(l.actions.filter(a=>a.p_action==='reserve')).toHaveLength(1);expect(l.actions.filter(a=>a.p_action==='settle')).toHaveLength(1);
 const over={...p,request:{...p.request,state:{...p.request.state,goals:[{summary:'x'.repeat(40001)}]}}};
 await expect(withPaidAnalysis('oversized-fixture',()=>submitJevSelection(over as never,{apiKey:'fixture-key'}))).rejects.toThrow('jev_request_invalid');
 expect(l.provider).toHaveLength(1);
});
