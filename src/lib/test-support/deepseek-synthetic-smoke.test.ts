import {afterEach,expect,it,vi} from 'vitest';
import {runDeepSeekSyntheticSmoke} from '../../../scripts/deepseek-synthetic-smoke';
import {paidProviderCall,withPaidAnalysis} from '../paid-budget';

const key='KEY_CANARY_DO_NOT_LOG',model='deepseek-flash';
const price={inputUsdPerMillion:'0.3',outputUsdPerMillion:'1.2',callReserveKrw:'1000',source:'https://api-docs.deepseek.com/quick_start/pricing/'};
let actions:any[],provider:ReturnType<typeof vi.fn>;
function setup(change:(config:any)=>void=()=>{}){
 actions=[];
 vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_URL','https://ledger.fixture');vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY','fixture-service');
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
  const b=JSON.parse(String(init?.body));actions.push(b);
  const config={timeZone:'UTC',krwPerUsd:'1500',validUntil:'2099-01-01T00:00:00Z',prices:{'deepseek/deepseek-flash':{...price}}};change(config);
  return Response.json({allowed:true,...(b.p_action==='config'?{config}:{})});
 }));
 provider=vi.fn(async()=>Response.json({model,status:'completed',usage:{input_tokens:100,output_tokens:20,total_tokens:120,input_tokens_details:{cached_tokens:5},output_tokens_details:{reasoning_tokens:12}},
  output:[{type:'reasoning',content:[{type:'reasoning_text',text:'REASONING_CANARY'}]},{type:'message',content:[{type:'output_text',text:JSON.stringify({goals:[],ambiguities:[]})}]}]}));
}
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('reserves a conservative full-context upper bound under the true provider then settles one synthetic call',async()=>{
 setup();const result=await runDeepSeekSyntheticSmoke({apiKey:key,fetchFn:provider as any},new AbortController().signal);
 expect(provider).toHaveBeenCalledOnce();const [url,init]=provider.mock.calls[0] as any;expect(url).toBe('https://api.deepseek.com/responses');
 const body=JSON.parse(init.body);expect(body).toMatchObject({model,reasoning:{effort:'high'},max_output_tokens:2048,store:false,stream:false});expect(body.input[1].content).not.toContain('github.com');
 expect(actions.map(a=>a.p_action)).toEqual(['config','reserve','settle','close']);
 expect(actions.find(a=>a.p_action==='reserve').p_config.prices).toHaveProperty('deepseek/deepseek-flash');
 expect(actions.find(a=>a.p_action==='settle').p_charge).toBe(81);
 expect(result).toMatchObject({model,thinking:'enabled',effort:'high',schemaValid:true,preCount:'UNKNOWN',admissionInputUpperBound:1048576,usage:{input:100,output:20,cachedInput:5,reasoning:12},providerInvoiceUsd:'UNKNOWN'});
 expect(JSON.stringify({actions,result})).not.toMatch(/KEY_CANARY|REASONING_CANARY|synthetic form|Authorization|fixture-service/);
});
it.each(['missing_price','offpeak_price','wrong_source','reserve_too_small','pause'] as const)('denies %s before contacting provider',async(kind)=>{
 setup(c=>{const p=c.prices['deepseek/deepseek-flash'];if(kind==='missing_price')delete c.prices['deepseek/deepseek-flash'];if(kind==='offpeak_price')p.inputUsdPerMillion='0.15';if(kind==='wrong_source')p.source='https://other.example';if(kind==='reserve_too_small')p.callReserveKrw='1';});
 if(kind==='pause')vi.stubGlobal('fetch',vi.fn(async()=>Response.json({allowed:false,reason:'hard_pause'})));
 await expect(runDeepSeekSyntheticSmoke({apiKey:key,fetchFn:provider as any},new AbortController().signal)).rejects.toThrow();expect(provider).not.toHaveBeenCalled();
});
it.each(['missing_admission','too_small_input','excess_output','wrong_model'] as const)('rejects %s budget admission instead of disguising DeepSeek as OpenAI',async(kind)=>{
 setup();const invoke=vi.fn(),admission=kind==='missing_admission'?undefined:{input:kind==='too_small_input'?100:1048576,output:kind==='excess_output'?32769:2048};
 await expect(withPaidAnalysis('negative',()=>paidProviderCall({provider:'deepseek',model:kind==='wrong_model'?'deepseek-v4-pro':model,admission,invoke,usage:()=>null}))).rejects.toThrow();expect(invoke).not.toHaveBeenCalled();
});
it('honors an already cancelled caller and missing key without budget/provider work',async()=>{
 setup();const c=new AbortController();c.abort();await expect(runDeepSeekSyntheticSmoke({apiKey:key,fetchFn:provider as any},c.signal)).rejects.toThrow();
 await expect(runDeepSeekSyntheticSmoke({apiKey:'',fetchFn:provider as any},new AbortController().signal)).rejects.toMatchObject({code:'deepseek_key_missing'});expect(actions).toHaveLength(0);expect(provider).not.toHaveBeenCalled();
});
it.each(['http','transport','usage','model','output','json'] as const)('accounts for %s failure without retry or raw-body disclosure',async(kind)=>{
 setup();provider.mockImplementation(async()=>{
  if(kind==='http')return new Response('RAW_ERROR_CANARY',{status:429});if(kind==='transport')throw new TypeError('RAW_NETWORK_CANARY');
  return Response.json({model:kind==='model'?'other':model,status:'completed',usage:kind==='usage'?undefined:{input_tokens:100,output_tokens:kind==='output'?2049:20,total_tokens:kind==='output'?2149:120},output:[{type:'message',content:[{type:'output_text',text:kind==='json'?'RAW_JSON_CANARY':'{"goals":[],"ambiguities":[]}'}]}]});
 });
 await expect(runDeepSeekSyntheticSmoke({apiKey:key,fetchFn:provider as any},new AbortController().signal)).rejects.toThrow();expect(provider).toHaveBeenCalledOnce();
 expect(actions.find(a=>a.p_action==='settle').p_charge).toBe(kind==='json'?81:null);expect(JSON.stringify(actions)).not.toMatch(/CANARY|Authorization/);
});
it('propagates parent abort through transport and preserves the unknown-usage reservation',async()=>{
 setup();const c=new AbortController();provider.mockImplementation(async(_u,init:any)=>{c.abort();init.signal.throwIfAborted();});
 await expect(runDeepSeekSyntheticSmoke({apiKey:key,fetchFn:provider as any},c.signal)).rejects.toMatchObject({code:'deepseek_aborted'});
 expect(provider).toHaveBeenCalledOnce();expect(actions.find(a=>a.p_action==='settle').p_charge).toBeNull();
});
it('applies the existing provider deadline rather than adding a longer timeout',async()=>{
 setup();vi.useFakeTimers();provider.mockImplementation(async(_u,init:any)=>new Promise((_r,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true})));
 const run=runDeepSeekSyntheticSmoke({apiKey:key,fetchFn:provider as any},new AbortController().signal);
 const outcome=run.then(()=>({code:'unexpected_success'}),error=>({code:error.code}));
 try{await vi.advanceTimersByTimeAsync(60001);expect(await outcome).toEqual({code:'budget_call_timeout'});expect(provider).toHaveBeenCalledOnce();expect(actions.find(a=>a.p_action==='settle').p_charge).toBeNull();}finally{vi.useRealTimers();}
});
