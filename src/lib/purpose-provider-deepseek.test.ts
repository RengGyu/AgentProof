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
it('uses the operational profile, one generation, real budget boundary and actual cache/thinking usage without a false pre-count',async()=>{
 setup();const fetchFn=vi.fn(async()=>Response.json(body())),p=createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn});
 expect(await withPaidAnalysis('run',()=>p(request,new AbortController().signal))).toEqual({goals:[],ambiguities:[]});
 expect(fetchFn).toHaveBeenCalledOnce();const [url,init]=fetchFn.mock.calls[0] as any;const sent=JSON.parse(init.body);
 expect(url).toBe('https://api.deepseek.com/responses');expect(sent).toMatchObject({model:'deepseek-flash',reasoning:{effort:'high'},max_output_tokens:32768,store:false});expect(sent.input[0].role).toBe('system');
 expect(actions.map(a=>a.p_action)).toEqual(['config','reserve','settle','close']);expect(actions.find(a=>a.p_action==='settle').p_charge).toBe(81);
 expect(JSON.stringify(actions)).not.toMatch(/SOURCE_CANARY|REASONING_CANARY|KEY_CANARY|SERVICE_CANARY/);expect(DEEPSEEK_PURPOSE_PROFILE.inputUpperBound).toBe(1048576);
});
it.each(['refusal','incomplete','json','schema','usage','model','http','null','input_bound','output_bound'] as const)('keeps %s failure closed with no retry or fallback',async(kind)=>{
 setup();const raw:any=body();if(kind==='refusal')raw.output=[{type:'message',content:[{type:'refusal',refusal:'PRIVATE_CANARY'}]}];if(kind==='incomplete')raw.status='incomplete';if(kind==='schema')raw.output[1].content[0].text='{"goals":[],"arbitrary":"PRIVATE_CANARY"}';if(kind==='usage')delete raw.usage;if(kind==='input_bound')Object.assign(raw.usage,{input_tokens:1048577,total_tokens:1048597});if(kind==='output_bound')Object.assign(raw.usage,{output_tokens:32769,total_tokens:32869});if(kind==='model')raw.model='other';
 const fetchFn=vi.fn(async()=>kind==='null'?Response.json(null):kind==='json'?new Response('PRIVATE_CANARY'):kind==='http'?Response.json({error:{code:'insufficient_quota',message:'PRIVATE_CANARY'}},{status:429}):Response.json(raw));
 const p=createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn});let error:unknown;try{await withPaidAnalysis('failure',()=>p(request,new AbortController().signal));}catch(e){error=e;}
 expect(error).toBeTruthy();const d=purposeFailureDiagnostic(error);expect(d.code).not.toBe('unknown');expect(JSON.stringify(d)).not.toMatch(/PRIVATE_CANARY|KEY_CANARY|SOURCE_CANARY/);expect(fetchFn).toHaveBeenCalledOnce();
 expect(actions.find(a=>a.p_action==='settle').p_charge).toBe(['json','usage','model','http','null','input_bound','output_bound'].includes(kind)?null:81);
 if(kind==='http')expect(d).toMatchObject({providerHTTPStatus:429,code:'provider_insufficient_quota'});
});
it.each(['no_scope','missing_price','under_reserve','pause','revoked_before','revoked_at_reserve','revoked_after'] as const)('protects %s before returning any interpretation',async(kind)=>{
 let authorized=kind!=='revoked_before';setup({price:kind!=='missing_price',reserve:kind==='under_reserve'?'1':'1000',pause:kind==='pause',onReserve:()=>{if(kind==='revoked_at_reserve')authorized=false;}});
 const fetchFn=vi.fn(async()=>{if(kind==='revoked_after')authorized=false;return Response.json(body());});const p=createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn,authorizePrivate:async()=>authorized});
 const run=()=>p(request,new AbortController().signal);await expect(kind==='no_scope'?run():withPaidAnalysis('guard',run)).rejects.toThrow();expect(fetchFn).toHaveBeenCalledTimes(kind==='revoked_after'?1:0);
});
it('preserves a source/parent timeout origin and sends no call after abort',async()=>{
 setup();const fetchFn=vi.fn(async()=>Response.json(body())),p=createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn});const parent=purposeDeadline(0,'analysis_deadline');await new Promise(r=>setTimeout(r,1));
 let error:unknown;try{await withPaidAnalysis('abort',()=>p(request,parent.signal));}catch(e){error=e;}finally{parent.dispose();}
 expect(purposeTimeoutMetadata(error)?.timeoutOrigin).toBe('analysis_deadline');expect(fetchFn).not.toHaveBeenCalled();expect(actions).toHaveLength(0);
});
it('cancels a stalled response body at the unchanged provider deadline and keeps usage unknown',async()=>{
 setup();vi.useFakeTimers();let cancelled=false;
 const fetchFn=vi.fn(async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}})));
 const p=createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn});const outcome=withPaidAnalysis('timer',()=>p(request,new AbortController().signal)).then(()=>null,e=>e);
 await vi.advanceTimersByTimeAsync(60001);const error=await outcome;
 expect(purposeTimeoutMetadata(error)?.timeoutOrigin).toBe('provider_timeout');expect(cancelled).toBe(true);expect(fetchFn).toHaveBeenCalledOnce();expect(actions.find(a=>a.p_action==='settle').p_charge).toBeNull();
});

it('measures real DeepSeek reservation, transport, body and parse without changing calls or settlement',async()=>{
 const {withLocateTimings,setLocateTimingRound}=await import('./purpose-locate-timing');vi.useFakeTimers();setup();
 const sink=vi.spyOn(console,'info').mockImplementation(()=>{}),ledger=fetch;
 vi.stubGlobal('fetch',vi.fn(async(u,i)=>{const b=JSON.parse(String(i?.body));const wait=b.p_action==='config'?5:b.p_action==='reserve'?7:b.p_action==='settle'?9:0;if(wait)await new Promise(r=>setTimeout(r,wait));return ledger(u,i);}));
 const bytes=new TextEncoder().encode(JSON.stringify(body()));
 const remote=vi.fn(async()=>{await new Promise(r=>setTimeout(r,20));return new Response(new ReadableStream({start(c){setTimeout(()=>{c.enqueue(bytes);c.close();},30);}}));});
 const provider=createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn:remote});
 const result=withLocateTimings({requestCorrelation:'12de46cf-1155-4284-b387-088f5ee38930',pullRequestNumber:45},new AbortController().signal,async()=>{setLocateTimingRound(0);return withPaidAnalysis('mock-timing',()=>provider(request,new AbortController().signal));});
 await vi.advanceTimersByTimeAsync(100);expect(await result).toEqual({goals:[],ambiguities:[]});
 const events=sink.mock.calls.filter(c=>c[0]==='agentproof_locate_timing').map(c=>JSON.parse(String(c[1])));expect(events).toHaveLength(1);expect(events[0].operations).toEqual(expect.arrayContaining([expect.objectContaining({operation:'budget_reserve',inclusiveMs:12,completed:1}),expect.objectContaining({operation:'provider_transport',inclusiveMs:20,completed:1}),expect.objectContaining({operation:'provider_body',inclusiveMs:30,completed:1}),expect.objectContaining({operation:'budget_settle',inclusiveMs:9,completed:1}),expect.objectContaining({operation:'provider_parse',completed:1})]));
 expect(remote).toHaveBeenCalledOnce();expect(actions.map(a=>a.p_action)).toEqual(['config','reserve','settle','close']);expect(JSON.stringify(events)).not.toMatch(/CANARY|SOURCE_CANARY|REASONING_CANARY/);sink.mockRestore();
});

it('snapshots the real in-flight DeepSeek transport when the remaining locate budget wins over its60s timer',async()=>{
 const {withLocateTimings,setLocateTimingRound}=await import('./purpose-locate-timing');vi.useFakeTimers();setup();const d=purposeDeadline(90000,'localization_deadline'),sink=vi.spyOn(console,'info').mockImplementation(()=>{});
 const remote=vi.fn(async(_u:any,i:any)=>new Promise<Response>((_,reject)=>i.signal.addEventListener('abort',()=>reject(i.signal.reason),{once:true}))),provider=createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn:remote});
 const result=withLocateTimings({pullRequestNumber:45},d.signal,async()=>{await new Promise(r=>setTimeout(r,40000));setLocateTimingRound(1);return withPaidAnalysis('mock-pending',()=>provider(request,d.signal));}).catch(e=>e);
 await vi.advanceTimersByTimeAsync(90001);expect(purposeFailureDiagnostic(await result)).toMatchObject({code:'purpose_timeout',timeoutOrigin:'localization_deadline'});
 const events=sink.mock.calls.filter(c=>c[0]==='agentproof_locate_timing').map(c=>JSON.parse(String(c[1])));expect(events).toHaveLength(1);expect(events[0]).toMatchObject({outcome:'abort',totalMs:90000,unmeasuredMs:40000});expect(events[0].operations).toContainEqual(expect.objectContaining({round:1,operation:'provider_transport',pending:1,endMs:null,pendingElapsedMs:50000}));expect(remote).toHaveBeenCalledOnce();expect(actions.find(a=>a.p_action==='settle').p_charge).toBeNull();expect(vi.getTimerCount()).toBe(0);d.dispose();sink.mockRestore();
});

it('records only closed completion metadata for a real incomplete provider failure through the existing wrapped private logger',async()=>{
 setup();const raw:any=body();raw.status='incomplete';raw.incomplete_details={reason:'max_output_tokens',raw:'PRIVATE_BODY_CANARY'};raw.usage={input_tokens:120,output_tokens:6000,total_tokens:6120,input_tokens_details:{cached_tokens:7},output_tokens_details:{reasoning_tokens:5980}};
 const remote=vi.fn(async()=>Response.json(raw)),p=createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn:remote});
 const error=await withPaidAnalysis('mock-incomplete-diagnostic',()=>p(request,new AbortController().signal)).catch(e=>e);
 const {logPurposeFailure}=await import('./purpose-failure'),{PurposeAnalysisError}=await import('./purpose-runtime');const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 logPurposeFailure(new PurposeAnalysisError(error),'11111111-1111-4111-8111-111111111111');const safe=JSON.parse(String(warn.mock.calls[0][1]));
 expect(safe).toMatchObject({code:'purpose_provider_incomplete',stage:'purpose',phase:'parse',providerHTTPStatus:200,requestCorrelation:'11111111-1111-4111-8111-111111111111',providerResponse:{status:'incomplete',incompleteReason:'max_output_tokens',inputTokens:120,outputTokens:6000,totalTokens:6120,cachedInputTokens:7,reasoningTokens:5980}});
 expect(JSON.stringify(safe)).not.toMatch(/CANARY|raw|reasoning_text|source_text|output_text|message|stack/);expect(remote).toHaveBeenCalledOnce();expect(actions.map(a=>a.p_action)).toEqual(['config','reserve','settle','close']);expect(actions.find(a=>a.p_action==='settle').p_charge).toBeGreaterThan(0);
});

it.each(['content_filter','PRIVATE_REASON_CANARY',null])('retains strict incomplete rejection with a safe reason for %s',async reason=>{
 setup();const raw:any=body();raw.status='incomplete';raw.incomplete_details={reason};const remote=vi.fn(async()=>Response.json(raw));
 const e=await withPaidAnalysis('mock-reason',()=>createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn:remote})(request,new AbortController().signal)).catch(e=>e);
 expect(purposeFailureDiagnostic(e)).toMatchObject({code:'purpose_provider_incomplete',providerResponse:{status:'incomplete',incompleteReason:reason==='content_filter'?'content_filter':'unknown'}});expect(remote).toHaveBeenCalledOnce();expect(JSON.stringify(purposeFailureDiagnostic(e))).not.toContain('CANARY');
});

it.each([{output:6001,charge:10847},{output:32768,charge:59028}])('accepts $output inclusive output tokens and settles actual usage under the expanded reservation',async({output,charge})=>{
 setup({reserve:'796.263'});const raw=body();Object.assign(raw.usage,{output_tokens:output,total_tokens:100+output});raw.usage.output_tokens_details.reasoning_tokens=6000;
 const remote=vi.fn(async()=>Response.json(raw));
 expect(await withPaidAnalysis('expanded-output',()=>createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn:remote})(request,new AbortController().signal))).toEqual({goals:[],ambiguities:[]});
 const sent=JSON.parse(String((remote.mock.calls[0] as any)[1].body));expect(sent.max_output_tokens).toBe(32768);expect(remote).toHaveBeenCalledOnce();
 expect(actions.find(a=>a.p_action==='reserve').p_reserve).toBe(796263);expect(actions.find(a=>a.p_action==='settle').p_charge).toBe(charge);
});
