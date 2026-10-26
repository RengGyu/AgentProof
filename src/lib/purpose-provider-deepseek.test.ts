import {afterEach,expect,it,vi} from 'vitest';
import {createDeepSeekPurposeProvider,DEEPSEEK_PURPOSE_PROFILE} from './purpose-provider-deepseek';
import {withPaidAnalysis} from './paid-budget';
import {purposeFailureDiagnostic} from './purpose-failure';
import {purposeDeadline,purposeTimeoutMetadata} from './purpose-timeout';
import {createRuntimePurposeOptions} from './purpose-runtime';

const request={stage:'purpose',flow:'explore_final_v1',sources:{spans:[{id:'gpsp_one',text:'SOURCE_CANARY'}]}} as const;
let actions:any[];
function setup(options:{price?:boolean;reserve?:string;pause?:boolean;onReserve?:()=>void}={}){
 actions=[];vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_URL','https://budget.fixture');vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY','SERVICE_CANARY');
 vi.stubGlobal('fetch',vi.fn(async(_u,init)=>{const b=JSON.parse(String(init?.body));actions.push(b);if(b.p_action==='reserve')options.onReserve?.();return Response.json({allowed:!options.pause,...(options.pause?{reason:'hard_pause'}:{}),...(b.p_action==='config'?{config:{timeZone:'UTC',krwPerUsd:'1500',validUntil:'2099-01-01T00:00:00Z',prices:options.price===false?{}:{'deepseek/deepseek-flash':{inputUsdPerMillion:'0.3',outputUsdPerMillion:'1.2',callReserveKrw:options.reserve??'1000',source:'https://api-docs.deepseek.com/quick_start/pricing/'}}}}:{})});}));
}
const body=()=>({model:'deepseek-flash',status:'completed',usage:{input_tokens:100,output_tokens:20,total_tokens:120,input_tokens_details:{cached_tokens:7},output_tokens_details:{reasoning_tokens:12}},output:[{type:'reasoning',content:[{type:'reasoning_text',text:'REASONING_CANARY'}]},{type:'message',content:[{type:'output_text',text:'{"goals":[],"ambiguities":[]}'}]}]});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.useRealTimers();});
it('pins the shared server/worker runtime to DeepSeek and never falls back to an OpenAI key',async()=>{
 const input={repositoryPrivate:false,url:'https://github.com/owner/repo/pull/7'} as any;
 expect(()=>createRuntimePurposeOptions(input,{env:{OPENAI_API_KEY:'OLD_KEY_CANARY'},readCurrentInput:async()=>input})).toThrow();
 setup();const replies=vi.mocked(fetch),ledger=fetch;let calls=0;
 vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
  if(String(url)==='https://api.deepseek.com/responses'){calls++;expect(new Headers(init?.headers).get('authorization')).toBe('Bearer DS_KEY_CANARY');return Response.json(body());}
  return ledger(url,init);
 }));
 const runtime=createRuntimePurposeOptions(input,{env:{DEEPSEEK_API_KEY:'DS_KEY_CANARY',OPENAI_API_KEY:'OLD_KEY_CANARY'},readCurrentInput:async()=>input});
 await withPaidAnalysis('runtime',()=>runtime.provider!(request,new AbortController().signal));
 expect(calls).toBe(1);expect(replies.mock.calls.some(c=>String(c[0]).includes('openai.com'))).toBe(false);
});
it('uses the operational profile, one generation and actual cache/thinking usage with no per-call budget RPC or pre-count',async()=>{
 setup();const fetchFn=vi.fn(async()=>Response.json(body())),p=createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn});
 expect(await withPaidAnalysis('run',()=>p(request,new AbortController().signal))).toEqual({goals:[],ambiguities:[]});
 expect(fetchFn).toHaveBeenCalledOnce();const [url,init]=fetchFn.mock.calls[0] as any;const sent=JSON.parse(init.body);
 expect(url).toBe('https://api.deepseek.com/responses');expect(sent).toMatchObject({model:'deepseek-flash',reasoning:{effort:'high'},max_output_tokens:32768,store:false});expect(sent.input[0].role).toBe('system');
 expect(actions).toEqual([]);
 expect(JSON.stringify(actions)).not.toMatch(/SOURCE_CANARY|REASONING_CANARY|KEY_CANARY|SERVICE_CANARY/);expect(DEEPSEEK_PURPOSE_PROFILE.inputUpperBound).toBe(1048576);
});
it.each(['refusal','incomplete','json','schema','usage','model','http','null','input_bound','output_bound'] as const)('keeps %s failure closed with no retry or fallback',async(kind)=>{
 setup();const raw:any=body();if(kind==='refusal')raw.output=[{type:'message',content:[{type:'refusal',refusal:'PRIVATE_CANARY'}]}];if(kind==='incomplete')raw.status='incomplete';if(kind==='schema')raw.output[1].content[0].text='{"goals":[],"arbitrary":"PRIVATE_CANARY"}';if(kind==='usage')delete raw.usage;if(kind==='input_bound')Object.assign(raw.usage,{input_tokens:1048577,total_tokens:1048597});if(kind==='output_bound')Object.assign(raw.usage,{output_tokens:32769,total_tokens:32869});if(kind==='model')raw.model='other';
 const fetchFn=vi.fn(async()=>kind==='null'?Response.json(null):kind==='json'?new Response('PRIVATE_CANARY'):kind==='http'?Response.json({error:{code:'insufficient_quota',message:'PRIVATE_CANARY'}},{status:429}):Response.json(raw));
 const p=createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn});let error:unknown;try{await withPaidAnalysis('failure',()=>p(request,new AbortController().signal));}catch(e){error=e;}
 expect(error).toBeTruthy();const d=purposeFailureDiagnostic(error);expect(d.code).not.toBe('unknown');expect(JSON.stringify(d)).not.toMatch(/PRIVATE_CANARY|KEY_CANARY|SOURCE_CANARY/);expect(fetchFn).toHaveBeenCalledOnce();
 expect(actions).toEqual([]);
 if(kind==='http')expect(d).toMatchObject({providerHTTPStatus:429,code:'provider_insufficient_quota'});
});
it.each(['no_scope','revoked_before','revoked_after'] as const)('protects %s before returning any interpretation',async(kind)=>{
 let authorized=kind!=='revoked_before';setup();
 const fetchFn=vi.fn(async()=>{if(kind==='revoked_after')authorized=false;return Response.json(body());});const p=createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn,authorizePrivate:async()=>authorized});
 const run=()=>p(request,new AbortController().signal);await expect(kind==='no_scope'?run():withPaidAnalysis('guard',run)).rejects.toThrow();expect(fetchFn).toHaveBeenCalledTimes(kind==='revoked_after'?1:0);expect(actions).toEqual([]);
});
it.each(['missing_price','under_reserve','pause'] as const)('DeepSeek beta path never consults the app budget store (%s)',async kind=>{
 setup({price:kind!=='missing_price',reserve:kind==='under_reserve'?'1':'1000',pause:kind==='pause'});const fetchFn=vi.fn(async()=>Response.json(body()));
 expect(await withPaidAnalysis('provider-balance',()=>createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn})(request,new AbortController().signal))).toEqual({goals:[],ambiguities:[]});expect(fetchFn).toHaveBeenCalledOnce();expect(actions).toEqual([]);
});
it('preserves a source/parent timeout origin and sends no call after abort',async()=>{
 setup();const fetchFn=vi.fn(async()=>Response.json(body())),p=createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn});const parent=purposeDeadline(0,'analysis_deadline');await new Promise(r=>setTimeout(r,1));
 let error:unknown;try{await withPaidAnalysis('abort',()=>p(request,parent.signal));}catch(e){error=e;}finally{parent.dispose();}
 expect(purposeTimeoutMetadata(error)?.timeoutOrigin).toBe('analysis_deadline');expect(fetchFn).not.toHaveBeenCalled();expect(actions).toHaveLength(0);
});
it('cancels a stalled locate response body at the unchanged provider deadline and keeps usage unknown',async()=>{
 setup();vi.useFakeTimers();let cancelled=false;
 const fetchFn=vi.fn(async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}})));
 const p=createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn});const outcome=withPaidAnalysis('timer',()=>p({...request,stage:'locate'} as any,new AbortController().signal)).then(()=>null,e=>e);
 await vi.advanceTimersByTimeAsync(60001);const error=await outcome;
 expect(purposeTimeoutMetadata(error)?.timeoutOrigin).toBe('provider_timeout');expect(cancelled).toBe(true);expect(fetchFn).toHaveBeenCalledOnce();expect(actions).toEqual([]);
});

it('caller-owned checks leave no adjacent adapter check; a standalone adapter keeps one check before transport and one after the response',async()=>{
 for(const owned of [true,false]){
  setup();const order:string[]=[];const fetchFn=vi.fn(async()=>{order.push('transport');return Response.json(body());});
  const p=createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn,authorizePrivate:async()=>{order.push('auth');return true;},callerAuthorizesAround:owned});
  expect(await withPaidAnalysis('owned',()=>p(request,new AbortController().signal))).toEqual({goals:[],ambiguities:[]});
  expect(order).toEqual(owned?['transport']:['auth','transport','auth']);expect(actions).toEqual([]);vi.unstubAllGlobals();vi.unstubAllEnvs();
 }
});
it('ends the wait at the deadline even when transport ignores its abort signal',async()=>{
 setup();vi.useFakeTimers();const fetchFn=vi.fn(async()=>new Promise<Response>(()=>{}));
 const outcome=withPaidAnalysis('ignored-abort',()=>createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn})({...request,stage:'locate'} as any,new AbortController().signal)).then(()=>null,e=>e);
 await vi.advanceTimersByTimeAsync(60001);expect(purposeFailureDiagnostic(await outcome)).toMatchObject({stage:'locate',phase:'transport',code:'purpose_timeout',timeoutOrigin:'provider_timeout',timeoutMs:60000});expect(actions).toEqual([]);
});

const clauseJson=(extra:Record<string,unknown>={})=>({sourceRefs:['gpsp_one'],expectedObservable:'Keep pending work',conditions:[],exceptions:[],obligation:'required',evidenceNeed:'static',...extra});
it.each([
 ['an extra server-owned field without required clause content',JSON.stringify({goals:[{clauses:[{authority:'PRIVATE_CANARY'}]}],ambiguities:[]}),{reason:'schema',keyword:'required'}],
 ['a missing required field',JSON.stringify({goals:[{clauses:[clauseJson()]}]}),{reason:'schema',keyword:'required'}],
 ['an invalid enum value',JSON.stringify({goals:[{clauses:[clauseJson({obligation:'PRIVATE_CANARY'})]}],ambiguities:[]}),{reason:'schema',keyword:'enum'}],
 ['a reference outside the supplied spans',JSON.stringify({goals:[{clauses:[clauseJson({sourceRefs:['gpsp_PRIVATE_CANARY']})]}],ambiguities:[]}),{reason:'schema',keyword:'enum'}],
 ['invalid JSON','{"goals":[PRIVATE_CANARY',{reason:'json'}],
 ['empty output','',{reason:'empty'}],
] as const)('rejects %s with the same closed code and only a fixed reason/keyword in the private log',async(_label,text,expected)=>{
 setup();const raw:any=body();raw.output[1].content[0].text=text;
 const error=await withPaidAnalysis('schema-reason',()=>createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn:vi.fn(async()=>Response.json(raw))})(request,new AbortController().signal)).catch(e=>e);
 expect(purposeFailureDiagnostic(error)).toMatchObject({stage:'purpose',phase:'parse',code:'purpose_provider_schema',providerHTTPStatus:200,schemaFailure:expected});
 expect(purposeFailureDiagnostic(error).schemaFailure).toEqual(expected);
 const {logPurposeFailure}=await import('./purpose-failure'),{PurposeAnalysisError}=await import('./purpose-runtime');const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 logPurposeFailure(new PurposeAnalysisError(error),'11111111-1111-4111-8111-111111111111');const logged=String(warn.mock.calls[0][1]);warn.mockRestore();
 expect(JSON.parse(logged).schemaFailure).toEqual(expected);expect(logged).not.toMatch(/CANARY|authority|obligation|gpsp_|goals|instancePath|message/);
});
it('an oversized response stops at the existing body budget before any schema decoding',async()=>{
 setup();const raw:any=body();raw.output[1].content[0].text='"'+'x'.repeat(256001)+'"';
 const error=await withPaidAnalysis('schema-size',()=>createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn:vi.fn(async()=>Response.json(raw))})(request,new AbortController().signal)).catch(e=>e);
 expect(purposeFailureDiagnostic(error)).toMatchObject({code:'purpose_provider_body_budget',phase:'transport'});expect(purposeFailureDiagnostic(error)).not.toHaveProperty('schemaFailure');
});
it('accepts a schema-valid purpose clause unchanged and adds no failure metadata',async()=>{
 setup();const raw:any=body();const value={goals:[{clauses:[clauseJson()]}],ambiguities:[]};raw.output[1].content[0].text=JSON.stringify(value);
 expect(await withPaidAnalysis('schema-valid',()=>createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn:vi.fn(async()=>Response.json(raw))})(request,new AbortController().signal))).toEqual(value);
});

const finalRequest={stage:'assess',flow:'explore_final_v1',spec:{goals:[{clauses:[{id:'pc_one'}]}]},evidence:[{id:'pe_sent',content:'return value;'}]} as any;
const finalBody=()=>({...body(),output:[{type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text:JSON.stringify({clauses:[{changeSummary:null,scopeNotes:[],clauseId:'pc_one',implementation:'unknown',evidenceRefs:['pe_sent'],counterEvidenceRefs:[],changeObservations:[{basis:'source_text',text:'return value;',evidenceId:'pe_sent'}],testObservations:[]}]})}]}]});
it.each(['en','ko'] as const)('sends reader-facing %s final guidance once in both wire formats while retaining the exact evidence packet',async reportLanguage=>{
 for(const finalFormat of [undefined,'purpose_units_v1'] as const){
  setup();const req={...finalRequest,reportLanguage,...(finalFormat?{finalFormat}:{})};
  const raw=finalBody();if(finalFormat)raw.output[0].content[0].text=JSON.stringify({units:[],contextClauseIds:['pc_one']});
  const fetchFn=vi.fn(async()=>Response.json(raw));const provider=createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn});
  const result=await withPaidAnalysis('final-expression',()=>provider(req,new AbortController().signal));
  expect(fetchFn).toHaveBeenCalledOnce();const sent=JSON.parse(String((fetchFn.mock.calls[0] as any)[1].body));
  expect(sent.input.map((m:any)=>m.role)).toEqual(['system','user']);expect(sent.input[1].content).toBe(JSON.stringify(req));
  expect(sent.input[0].content).toContain(`Write reader-facing prose in ${reportLanguage==='ko'?'Korean':'English'}.`);
  expect(sent.input[0].content).toContain('detecting a condition, reporting it, and allowing or stopping an operation are different facts');
  expect(sent.input[0].content).not.toContain('Write purpose and report explanations');
  expect(sent.model).toBe('deepseek-flash');expect(sent.reasoning.effort).toBe('high');expect(sent.store).toBe(false);
  if(finalFormat)expect(result).toEqual({units:[],contextClauseIds:['pc_one']});
  else expect((result as any).clauses[0].changeObservations[0]).toEqual({basis:'source_text',text:'return value;',evidenceRefs:['pe_sent']});
 }
});
const slowFetch=(ms:number)=>vi.fn(async(_url:any,init:any)=>{await new Promise<void>((resolve,reject)=>{const t=setTimeout(resolve,ms);init.signal.addEventListener('abort',()=>{clearTimeout(t);reject(init.signal.reason);},{once:true});});return Response.json(finalBody());});
it('final assess runs past 60s inside the caller absolute deadline with no budget RPC',async()=>{
 setup();vi.useFakeTimers();const parent=purposeDeadline(180000,'analysis_deadline'),fetchFn=slowFetch(90000);
 const p=createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn});const outcome=withPaidAnalysis('final',()=>p(finalRequest,parent.signal)).then(value=>({value}),error=>({error}));
 await vi.advanceTimersByTimeAsync(90001);const result:any=await outcome;
 expect(result.error).toBeUndefined();expect(result.value.clauses[0].clauseId).toBe('pc_one');expect(fetchFn).toHaveBeenCalledOnce();
 expect(actions).toEqual([]);parent.dispose();
});
it('final assess stops at the remaining absolute deadline with its origin',async()=>{
 setup();vi.useFakeTimers();const parent=purposeDeadline(100000,'analysis_deadline'),fetchFn=slowFetch(500000);let settled=false;
 const p=createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn});const outcome=withPaidAnalysis('final',()=>p(finalRequest,parent.signal)).then(()=>null,e=>e).finally(()=>{settled=true;});
 await vi.advanceTimersByTimeAsync(60001);expect(settled).toBe(false);
 await vi.advanceTimersByTimeAsync(40000);const error=await outcome;
 expect(purposeFailureDiagnostic(error)).toMatchObject({stage:'assess',code:'purpose_timeout',timeoutOrigin:'analysis_deadline',timeoutMs:100000});
 expect(fetchFn).toHaveBeenCalledOnce();expect(actions).toEqual([]);
});
it('purpose runs past 60s inside the caller absolute deadline and stops only at that deadline',async()=>{
 const slow=(ms:number)=>vi.fn(async(_u:any,init:any)=>{await new Promise<void>((resolve,reject)=>{const t=setTimeout(resolve,ms);init.signal.addEventListener('abort',()=>{clearTimeout(t);reject(init.signal.reason);},{once:true});});return Response.json(body());});
 setup();vi.useFakeTimers();let parent=purposeDeadline(300000,'analysis_deadline');const ok=withPaidAnalysis('purpose-long',()=>createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn:slow(90000)})(request,parent.signal)).then(v=>v,e=>e);
 await vi.advanceTimersByTimeAsync(90001);expect(await ok).toEqual({goals:[],ambiguities:[]});parent.dispose();
 parent=purposeDeadline(100000,'analysis_deadline');let settled=false;const cut=withPaidAnalysis('purpose-cut',()=>createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn:slow(500000)})(request,parent.signal)).then(()=>null,e=>e).finally(()=>{settled=true;});
 await vi.advanceTimersByTimeAsync(60001);expect(settled).toBe(false);await vi.advanceTimersByTimeAsync(40000);
 expect(purposeFailureDiagnostic(await cut)).toMatchObject({stage:'purpose',code:'purpose_timeout',timeoutOrigin:'analysis_deadline',timeoutMs:100000});expect(actions).toEqual([]);
});
it('locate keeps its own 60s provider timer under a longer analysis deadline',async()=>{
 setup();vi.useFakeTimers();const parent=purposeDeadline(180000,'analysis_deadline'),fetchFn=slowFetch(61000);
 const p=createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn});const outcome=withPaidAnalysis('locate',()=>p({...request,stage:'locate'} as any,parent.signal)).then(()=>null,e=>e);
 await vi.advanceTimersByTimeAsync(60001);expect(purposeTimeoutMetadata(await outcome)).toMatchObject({timeoutOrigin:'provider_timeout',timeoutMs:60000});parent.dispose();
});

it('measures real DeepSeek transport, body and parse with no reservation or settlement timing',async()=>{
 const {withLocateTimings,setLocateTimingRound}=await import('./purpose-locate-timing');vi.useFakeTimers();setup();
 const sink=vi.spyOn(console,'info').mockImplementation(()=>{}),ledger=fetch;
 vi.stubGlobal('fetch',vi.fn(async(u,i)=>{const b=JSON.parse(String(i?.body));const wait=b.p_action==='config'?5:b.p_action==='reserve'?7:b.p_action==='settle'?9:0;if(wait)await new Promise(r=>setTimeout(r,wait));return ledger(u,i);}));
 const bytes=new TextEncoder().encode(JSON.stringify(body()));
 const remote=vi.fn(async()=>{await new Promise(r=>setTimeout(r,20));return new Response(new ReadableStream({start(c){setTimeout(()=>{c.enqueue(bytes);c.close();},30);}}));});
 const provider=createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn:remote});
 const result=withLocateTimings({requestCorrelation:'12de46cf-1155-4284-b387-088f5ee38930',pullRequestNumber:45},new AbortController().signal,async()=>{setLocateTimingRound(0);return withPaidAnalysis('mock-timing',()=>provider(request,new AbortController().signal));});
 await vi.advanceTimersByTimeAsync(100);expect(await result).toEqual({goals:[],ambiguities:[]});
 const events=sink.mock.calls.filter(c=>c[0]==='agentproof_locate_timing').map(c=>JSON.parse(String(c[1])));expect(events).toHaveLength(1);expect(events[0].operations).toEqual(expect.arrayContaining([expect.objectContaining({operation:'provider_transport',inclusiveMs:20,completed:1}),expect.objectContaining({operation:'provider_body',inclusiveMs:30,completed:1}),expect.objectContaining({operation:'provider_parse',completed:1})]));expect(events[0].operations.some((o:any)=>/^budget_/.test(o.operation))).toBe(false);expect(events[0].totalMs).toBe(50);
 expect(remote).toHaveBeenCalledOnce();expect(actions).toEqual([]);expect(JSON.stringify(events)).not.toMatch(/CANARY|SOURCE_CANARY|REASONING_CANARY/);sink.mockRestore();
});

it('snapshots the real in-flight DeepSeek transport when the remaining locate budget wins over its60s timer',async()=>{
 const {withLocateTimings,setLocateTimingRound}=await import('./purpose-locate-timing');vi.useFakeTimers();setup();const d=purposeDeadline(90000,'localization_deadline'),sink=vi.spyOn(console,'info').mockImplementation(()=>{});
 const remote=vi.fn(async(_u:any,i:any)=>new Promise<Response>((_,reject)=>i.signal.addEventListener('abort',()=>reject(i.signal.reason),{once:true}))),provider=createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn:remote});
 const result=withLocateTimings({pullRequestNumber:45},d.signal,async()=>{await new Promise(r=>setTimeout(r,40000));setLocateTimingRound(1);return withPaidAnalysis('mock-pending',()=>provider(request,d.signal));}).catch(e=>e);
 await vi.advanceTimersByTimeAsync(90001);expect(purposeFailureDiagnostic(await result)).toMatchObject({code:'purpose_timeout',timeoutOrigin:'localization_deadline'});
 const events=sink.mock.calls.filter(c=>c[0]==='agentproof_locate_timing').map(c=>JSON.parse(String(c[1])));expect(events).toHaveLength(1);expect(events[0]).toMatchObject({outcome:'abort',totalMs:90000,unmeasuredMs:40000});expect(events[0].operations).toContainEqual(expect.objectContaining({round:1,operation:'provider_transport',pending:1,endMs:null,pendingElapsedMs:50000}));expect(remote).toHaveBeenCalledOnce();expect(actions).toEqual([]);expect(vi.getTimerCount()).toBe(0);d.dispose();sink.mockRestore();
});

it('records only closed completion metadata for a real incomplete provider failure through the existing wrapped private logger',async()=>{
 setup();const raw:any=body();raw.status='incomplete';raw.incomplete_details={reason:'max_output_tokens',raw:'PRIVATE_BODY_CANARY'};raw.usage={input_tokens:120,output_tokens:6000,total_tokens:6120,input_tokens_details:{cached_tokens:7},output_tokens_details:{reasoning_tokens:5980}};
 const remote=vi.fn(async()=>Response.json(raw)),p=createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn:remote});
 const error=await withPaidAnalysis('mock-incomplete-diagnostic',()=>p(request,new AbortController().signal)).catch(e=>e);
 const {logPurposeFailure}=await import('./purpose-failure'),{PurposeAnalysisError}=await import('./purpose-runtime');const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 logPurposeFailure(new PurposeAnalysisError(error),'11111111-1111-4111-8111-111111111111');const safe=JSON.parse(String(warn.mock.calls[0][1]));
 expect(safe).toMatchObject({code:'purpose_provider_incomplete',stage:'purpose',phase:'parse',providerHTTPStatus:200,requestCorrelation:'11111111-1111-4111-8111-111111111111',providerResponse:{status:'incomplete',incompleteReason:'max_output_tokens',inputTokens:120,outputTokens:6000,totalTokens:6120,cachedInputTokens:7,reasoningTokens:5980}});
 expect(JSON.stringify(safe)).not.toMatch(/CANARY|raw|reasoning_text|source_text|output_text|message|stack/);expect(remote).toHaveBeenCalledOnce();expect(actions).toEqual([]);
});

it.each(['content_filter','PRIVATE_REASON_CANARY',null])('retains strict incomplete rejection with a safe reason for %s',async reason=>{
 setup();const raw:any=body();raw.status='incomplete';raw.incomplete_details={reason};const remote=vi.fn(async()=>Response.json(raw));
 const e=await withPaidAnalysis('mock-reason',()=>createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn:remote})(request,new AbortController().signal)).catch(e=>e);
 expect(purposeFailureDiagnostic(e)).toMatchObject({code:'purpose_provider_incomplete',providerResponse:{status:'incomplete',incompleteReason:reason==='content_filter'?'content_filter':'unknown'}});expect(remote).toHaveBeenCalledOnce();expect(JSON.stringify(purposeFailureDiagnostic(e))).not.toContain('CANARY');
});

it.each([{output:6001},{output:32768}])('accepts $output inclusive output tokens within the unchanged output ceiling',async({output})=>{
 setup();const raw=body();Object.assign(raw.usage,{output_tokens:output,total_tokens:100+output});raw.usage.output_tokens_details.reasoning_tokens=6000;
 const remote=vi.fn(async()=>Response.json(raw));
 expect(await withPaidAnalysis('expanded-output',()=>createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn:remote})(request,new AbortController().signal))).toEqual({goals:[],ambiguities:[]});
 const sent=JSON.parse(String((remote.mock.calls[0] as any)[1].body));expect(sent.max_output_tokens).toBe(32768);expect(remote).toHaveBeenCalledOnce();
 expect(actions).toEqual([]);
});
