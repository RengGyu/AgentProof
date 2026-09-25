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

function storeMock(deny?: string) {
 vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_URL','https://budget.invalid');
 vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY','fake-key');
 const actions: Record<string, unknown>[]=[];
 vi.stubGlobal('fetch',vi.fn(async (_url,init)=>{
  const body=JSON.parse(String(init?.body));actions.push(body);
  if(body.p_action==='config')return Response.json({allowed:true,config});
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
const navigation:ReviewNavigationRequest={stage:'intent',model:'gemini-3.8-flash',sources:[],goals:[],artifacts:[],inventory:[],capabilities:{readPaths:false,searchScope:'supplied_artifacts',wholeRepository:false}};

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
