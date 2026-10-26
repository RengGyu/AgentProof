import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaidBudgetError, assertPaidAnalysisAllowed, calculateUsageMilliKrw, normalizePaidUsage, paidProviderCall, withPaidAnalysis } from './paid-budget';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const price = { inputUsdPerMillion: '0.75', outputUsdPerMillion: '3.75', callReserveKrw: '100', source: 'https://ai.google.dev/gemini-api/docs/pricing' };
const config = { timeZone: 'Asia/Seoul', krwPerUsd: '1000', validUntil: '2099-01-01T00:00:00Z', prices: { 'google/gemini-3.8-flash': price } };

describe('estimated cost accounting', () => {
 it('counts Gemini prompt, candidate and thought tokens exactly once', () => {
  const usage=normalizePaidUsage('google',{promptTokenCount:100,candidatesTokenCount:20,thoughtsTokenCount:30,totalTokenCount:150});
  expect(usage).toEqual({input:100,output:50});
  expect(calculateUsageMilliKrw(usage!,price,'1000')).toBe(263);
 });
 it('derives combined output from Gemini total when thoughts are omitted',()=>{
  expect(normalizePaidUsage('google',{promptTokenCount:100,candidatesTokenCount:20,totalTokenCount:150})).toEqual({input:100,output:50});
 });
 it.each([{}, {promptTokenCount:100,candidatesTokenCount:20}, {promptTokenCount:100,candidatesTokenCount:20,thoughtsTokenCount:30,totalTokenCount:120}])('does not turn absent/inconsistent usage into zero cost',usage=>{
  expect(normalizePaidUsage('google',usage)).toBeNull();
 });
 it('does not add OpenAI reasoning detail to already-inclusive output tokens',()=>{
  expect(normalizePaidUsage('openai',{input_tokens:100,output_tokens:50,output_tokens_details:{reasoning_tokens:30}})).toEqual({input:100,output:50});
 });
});

function storeMock(deny?: string, budgetConfig: typeof config = config) {
 vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_URL','https://budget.invalid');
 vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY','fake-key');
 const actions: Record<string, unknown>[]=[];
 vi.stubGlobal('fetch',vi.fn(async (_url,init)=>{
  const body=JSON.parse(String(init?.body));actions.push(body);
  if(body.p_action==='config')return Response.json({allowed:true,config:budgetConfig});
  if(deny && body.p_action==='reserve')return Response.json({allowed:false,reason:deny});
  return Response.json({allowed:true});
 }));
 return actions;
}

describe('paid transport boundary',()=>{
 it('fails closed with no analysis scope',async()=>{
  const invoke=vi.fn();
  await expect(paidProviderCall({provider:'google',model:'gemini-3.8-flash',invoke,usage:()=>null})).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
 });
 it.each(['soft_stop','hard_pause','duplicate'])('does not call the provider when reservation returns %s',async reason=>{
  storeMock(reason);const invoke=vi.fn();
  await expect(withPaidAnalysis('request',()=>paidProviderCall({provider:'google',model:'gemini-3.8-flash',invoke,usage:()=>null}))).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
 });
 it('retains an unknown charge on failure and does not expose raw error data',async()=>{
  const actions=storeMock();
  await expect(withPaidAnalysis('request',()=>paidProviderCall({provider:'google',model:'gemini-3.8-flash',invoke:async()=>{throw Error('provider_failed');},usage:()=>null}))).rejects.toThrow();
  expect(actions.find(a=>a.p_action==='settle')).toMatchObject({p_charge:null});
 });
 it('settles completed usage and closes the run without persisting prompts',async()=>{
  const actions=storeMock();
  await withPaidAnalysis('private request',()=>paidProviderCall({provider:'google',model:'gemini-3.8-flash',invoke:async()=>({text:'private output'}),usage:()=>({input:100,output:50})}));
  expect(actions.find(a=>a.p_action==='settle')).toMatchObject({p_charge:263});
  expect(actions.some(a=>a.p_action==='close')).toBe(true);
  expect(JSON.stringify(actions)).not.toMatch(/private request|private output/);
 });
});

import { submitReviewNavigationWithGemini } from './gemini-navigation';
import { budgetedOpenAIFetch } from './paid-budget';
import type { ReviewNavigationRequest } from './review-intent';
import * as diagnostics from './review-navigation-diagnostics';
const navigation:ReviewNavigationRequest={stage:'intent',model:'gemini-3.8-flash',sources:[],goals:[],artifacts:[],inventory:[],capabilities:{readPaths:false,searchScope:'supplied_artifacts',wholeRepository:false}};

it('separates actual transport from reservation, settlement and run close intervals', async () => {
 let now = 0;
 const trace = diagnostics.createReviewMeasurements(() => now);
 const context = { trace, parentId: trace.start('report') };
 storeMock();
 const baseFetch = fetch;
 vi.stubGlobal('fetch', async (url:RequestInfo|URL, init?:RequestInit) => {
  now += ({ config: 5, reserve: 7, settle: 11, close: 13 } as Record<string, number>)[JSON.parse(String(init?.body)).p_action] ?? 0;
  return baseFetch(url, init);
 });
 await withPaidAnalysis('fixture', () => diagnostics.measureReviewAsync(context, 'model', child => paidProviderCall({
  provider: 'google', model: 'gemini-3.8-flash', measurements: child,
  invoke: async () => { now += 19; return { text: 'PRIVATE_PROVIDER_OUTPUT' }; }, usage: () => ({ input: 100, output: 50 })
 })), context);
 const spans = trace.snapshot().spans;
 expect(spans.find(s => s.phase === 'model')?.durationMs).toBe(42);
 expect(spans.find(s => s.phase === 'budget_reserve')?.durationMs).toBe(12);
 expect(spans.find(s => s.phase === 'provider_transport')?.durationMs).toBe(19);
 expect(spans.find(s => s.phase === 'budget_settle')?.durationMs).toBe(11);
 expect(spans.find(s => s.phase === 'budget_close')?.durationMs).toBe(13);
 const callId = spans.find(s => s.phase === 'model')!.id;
 expect(spans.filter(s => ['budget_reserve','provider_transport','budget_settle'].includes(s.phase)).every(s => s.parentId === callId)).toBe(true);
 expect(JSON.stringify(trace.snapshot())).not.toContain('PRIVATE_PROVIDER_OUTPUT');
});

it('includes OpenAI response-body time in transport and excludes ledger work', async () => {
 let now=0;
 const trace=diagnostics.createReviewMeasurements(()=>now),context={trace,parentId:trace.start('report')};
 storeMock();const original=fetch;
 vi.stubGlobal('fetch',async (url:RequestInfo|URL,init?:RequestInit)=>{
  const action=JSON.parse(String(init?.body)).p_action;
  now+=({config:2,reserve:3,settle:5,close:7} as Record<string,number>)[action]??0;
  if(action==='config')return Response.json({allowed:true,config:{...config,prices:{'openai/gpt-fixture':price}}});
  return original(url,init);
 });
 const external=vi.fn(async()=>{now+=11;const response=Response.json({usage:{input_tokens:100,output_tokens:50}});const read=response.text.bind(response);response.text=async()=>{now+=13;return read();};return response;});
 await withPaidAnalysis('offline',()=>diagnostics.measureReviewAsync(context,'model',child=>budgetedOpenAIFetch('https://model.invalid',{method:'POST',body:JSON.stringify({model:'gpt-fixture'})},external,child)),context);
 expect(external).toHaveBeenCalledOnce();
 expect(trace.snapshot().spans.find(s=>s.phase==='provider_transport')?.durationMs).toBe(24);
 expect(trace.snapshot().spans.find(s=>s.phase==='model')?.durationMs).toBe(34);
});

it('records denial and failed transport with closed, text-free outcomes', async () => {
 const trace=diagnostics.createReviewMeasurements(),context={trace};
 storeMock('soft_stop');const invoke=vi.fn();
 await expect(withPaidAnalysis('denied',()=>paidProviderCall({provider:'google',model:'gemini-3.8-flash',invoke,usage:()=>null,measurements:context}),context)).rejects.toMatchObject({code:'soft_stop'});
 expect(invoke).not.toHaveBeenCalled();
 expect(trace.snapshot().spans).toEqual([expect.objectContaining({phase:'budget_reserve',outcome:'error'})]);
 storeMock();
 await expect(withPaidAnalysis('failed',()=>paidProviderCall({provider:'google',model:'gemini-3.8-flash',invoke:async()=>{throw Error('PRIVATE_FAILURE');},usage:()=>null,measurements:context}),context)).rejects.toThrow();
 expect(trace.snapshot().spans.find(s=>s.phase==='provider_transport')?.outcome).toBe('error');
 expect(trace.snapshot().spans.filter(s=>['budget_settle','budget_close'].includes(s.phase)).every(s=>s.outcome==='ok')).toBe(true);
 expect(JSON.stringify(trace.snapshot())).not.toContain('PRIVATE_FAILURE');
});

describe('real adapter budget wiring',()=>{
 it('meters one Gemini request once and disables SDK retries',async()=>{
  const actions=storeMock();
  const generateContent=vi.fn(async()=>({text:'{"goals":[]}',usageMetadata:{promptTokenCount:100,candidatesTokenCount:20,thoughtsTokenCount:30,totalTokenCount:150}}));
  await withPaidAnalysis('gemini',()=>submitReviewNavigationWithGemini(navigation,{apiKey:'test',generateContent}));
  expect(generateContent).toHaveBeenCalledOnce();
  expect(generateContent.mock.calls[0]).toBeDefined();
  expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({config:expect.objectContaining({abortSignal:expect.any(AbortSignal),httpOptions:{retryOptions:{attempts:1}}})}));
  expect(actions.filter(a=>a.p_action==='reserve')).toHaveLength(1);
  expect(actions.filter(a=>a.p_action==='settle')).toEqual([expect.objectContaining({p_charge:263})]);
 });
 it('blocks legacy background submission before any external call',async()=>{
  const external=vi.fn();
  await expect(budgetedOpenAIFetch('https://api.openai.com/v1/responses',{method:'POST',body:JSON.stringify({model:'test',background:true})},external)).rejects.toMatchObject({code:'unsupported_background'});
  expect(external).not.toHaveBeenCalled();
 });
 it('aborts an active request after durable hard pause and prevents a swallowed-error retry',async()=>{
  vi.useFakeTimers();
  try {
   const actions=storeMock();
   const base=fetch;
   vi.stubGlobal('fetch',vi.fn(async(url,init)=>JSON.parse(String(init?.body)).p_action==='check'?Response.json({allowed:false,reason:'hard_pause'}):base(url,init)));
   let started!:()=>void;const ready=new Promise<void>(resolve=>started=resolve);
   const invoke=vi.fn(async(signal:AbortSignal)=>{started();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));});
   const run=withPaidAnalysis('inflight',async()=>{
    try { await paidProviderCall({provider:'google',model:'gemini-3.8-flash',invoke,usage:()=>null}); } catch { /* caller's fallback must not bypass the pause */ }
    return paidProviderCall({provider:'google',model:'gemini-3.8-flash',invoke,usage:()=>null});
   });
   const result=run.catch(error=>error);
   await ready;await vi.advanceTimersByTimeAsync(1000);
   expect(await result).toMatchObject({code:'hard_pause'});
   expect(invoke).toHaveBeenCalledOnce();
   expect(actions.find(a=>a.p_action==='settle')).toMatchObject({p_charge:null});
  } finally { vi.useRealTimers(); }
 });
 it('retains reservation on timeout even when the provider ignores cancellation',async()=>{
  vi.useFakeTimers();
  try {
   const actions=storeMock();let started!:()=>void;const ready=new Promise<void>(resolve=>started=resolve);
   const result=withPaidAnalysis('timeout',()=>paidProviderCall({provider:'google',model:'gemini-3.8-flash',invoke:async()=>{started();return new Promise(()=>{});},usage:()=>null})).catch(error=>error);
   await ready;await vi.advanceTimersByTimeAsync(60_000);
   expect(await result).toMatchObject({code:'budget_call_timeout'});
   expect(actions.find(a=>a.p_action==='settle')).toMatchObject({p_charge:null});
  } finally { vi.useRealTimers(); }
 });
 it('caller-owned absolute deadline replaces only the fixed call timer and keeps its abort reason',async()=>{
  vi.useFakeTimers();
  try {
   const {purposeDeadline,purposeTimeoutMetadata}=await import('./purpose-timeout');
   let actions=storeMock();const late=purposeDeadline(180_000,'analysis_deadline');
   const done=withPaidAnalysis('long',()=>paidProviderCall({provider:'google',model:'gemini-3.8-flash',deadlineSignal:late.signal,invoke:()=>new Promise(resolve=>setTimeout(()=>resolve('ok'),70_000)),usage:()=>({input:100,output:50})}));
   await vi.advanceTimersByTimeAsync(70_000);expect(await done).toBe('ok');expect(actions.filter(a=>a.p_action==='settle')).toEqual([expect.objectContaining({p_charge:263})]);late.dispose();
   actions=storeMock();const d=purposeDeadline(90_000,'analysis_deadline');let settled=false;
   const result=withPaidAnalysis('deadline',()=>paidProviderCall({provider:'google',model:'gemini-3.8-flash',deadlineSignal:d.signal,invoke:async()=>new Promise(()=>{}),usage:()=>null})).catch(error=>error).finally(()=>{settled=true;});
   await vi.advanceTimersByTimeAsync(60_001);expect(settled).toBe(false);
   await vi.advanceTimersByTimeAsync(30_000);const error=await result;
   expect(error).toBe(d.signal.reason);expect(purposeTimeoutMetadata(error)?.timeoutOrigin).toBe('analysis_deadline');expect(error).not.toMatchObject({code:'budget_call_timeout'});
   expect(actions.filter(a=>a.p_action==='settle')).toEqual([expect.objectContaining({p_charge:null})]);expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
 });
 it('does not call a provider when the durable store is unreachable',async()=>{
  storeMock();vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('private store details');}));const invoke=vi.fn();
  const error=await withPaidAnalysis('store-down',()=>paidProviderCall({provider:'google',model:'gemini-3.8-flash',invoke,usage:()=>null})).catch(e=>e);
  expect(error).toMatchObject({code:'budget_store_unavailable'});expect(String(error)).not.toContain('private');expect(invoke).not.toHaveBeenCalled();
 });
});

it.each([
 {...config,krwPerUsd:''},
 {...config,prices:{}},
 {...config,validUntil:'2000-01-01T00:00:00Z'},
 {...config,validUntil:'2099-01-01'}
])('blocks incomplete or expired monetary settings before provider work',async invalid=>{
 storeMock();vi.stubGlobal('fetch',vi.fn(async()=>Response.json({allowed:true,config:invalid})));const invoke=vi.fn();
 await expect(withPaidAnalysis('invalid-config',()=>paidProviderCall({provider:'google',model:'gemini-3.8-flash',invoke,usage:()=>null}))).rejects.toThrow();
 expect(invoke).not.toHaveBeenCalled();
});

it('surfaces a swallowed budget denial before publication',async()=>{
 storeMock('soft_stop');let publicationError:unknown;
 await withPaidAnalysis('blocked-publish',async()=>{
  try { await paidProviderCall({provider:'google',model:'gemini-3.8-flash',invoke:vi.fn(),usage:()=>null}); } catch { /* deterministic fallback */ }
  try { assertPaidAnalysisAllowed(); } catch(error) { publicationError=error; }
 }).catch(()=>undefined);
 expect(publicationError).toBeInstanceOf(PaidBudgetError);
 expect(publicationError).toMatchObject({code:'soft_stop'});
});

it.each([
 {output:6001,reserve:'796.263',allowed:true},
 {output:32768,reserve:'796.263',allowed:true},
 {output:32769,reserve:'796.263',allowed:false},
 {output:32768,reserve:'530.841',allowed:false}
])('enforces DeepSeek admission output$output and reserve$reserve without weakening the budget boundary',async({output,reserve,allowed})=>{
 const actions=storeMock(undefined,{...config,krwPerUsd:'1500',prices:{'deepseek/deepseek-flash':{inputUsdPerMillion:'0.3',outputUsdPerMillion:'1.2',callReserveKrw:reserve,source:'https://api-docs.deepseek.com/quick_start/pricing/'}}} as any);
 const invoke=vi.fn(async()=>({ok:true}));
 const result=withPaidAnalysis('expanded-deepseek-admission',()=>paidProviderCall({provider:'deepseek',model:'deepseek-flash',admission:{input:1048576,output},invoke,usage:()=>({input:100,output:20})}));
 if(allowed){expect(await result).toEqual({ok:true});expect(invoke).toHaveBeenCalledOnce();expect(actions.find(a=>a.p_action==='reserve')).toMatchObject({p_reserve:796263});expect(actions.find(a=>a.p_action==='settle')).toMatchObject({p_charge:81});}
 else{await expect(result).rejects.toBeInstanceOf(PaidBudgetError);expect(invoke).not.toHaveBeenCalled();expect(actions.some(a=>a.p_action==='reserve')).toBe(false);}
});
