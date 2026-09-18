import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewNavigationRequest } from './review-intent';
import { resolveNavigationProvider, submitReviewNavigationWithGemini } from './gemini-navigation';

const request=(stage:'intent'|'ranking'):ReviewNavigationRequest=>({stage,model:'google/gemini-test',sources:[],goals:[],artifacts:[],inventory:[],capabilities:{readPaths:false,searchScope:'supplied_artifacts',wholeRepository:false}});
beforeEach(()=>vi.clearAllMocks());

describe('Gemini navigation through Vercel AI Gateway',()=>{
 it.each(['intent','ranking'] as const)('uses the gateway Responses endpoint for %s',async stage=>{
  const output=stage==='intent'?{goals:[],unprocessed:[]}:{rankings:[],readPaths:[]};
  const fetchFn=vi.fn(async(_url:string|URL|Request,_init?:RequestInit)=>Response.json({output_text:JSON.stringify(output)}));
  expect(await submitReviewNavigationWithGemini(request(stage),{apiKey:'test-key',fetchFn})).toEqual(output);
  expect(fetchFn).toHaveBeenCalledWith('https://ai-gateway.vercel.sh/v1/responses',expect.objectContaining({method:'POST'}));
  const body=JSON.parse(String(fetchFn.mock.calls[0]![1]?.body));
  expect(body.model).toBe('google/gemini-test');
  expect(body.text.format).toMatchObject({type:'json_schema',strict:true});
 });
 it('prefers the gateway key and normalizes the Gemini model id',async()=>{
  const selected=resolveNavigationProvider({AI_GATEWAY_API_KEY:' gateway-key ',AGENTPROOF_LLM_MODEL:' gemini-3.8-flash ',OPENAI_API_KEY:'openai-key',OPENAI_MODEL:'openai-model'});
  expect(selected.model).toBe('google/gemini-3.8-flash');
  const fetchFn=vi.fn(async(_url:string|URL|Request,_init?:RequestInit)=>Response.json({output_text:JSON.stringify({goals:[],unprocessed:[]})}));
  vi.stubGlobal('fetch',fetchFn);
  await selected.provider!({...request('intent'),model:selected.model});
  expect(fetchFn).toHaveBeenCalledWith('https://ai-gateway.vercel.sh/v1/responses',expect.any(Object));
 });
 it('preserves an already-qualified gateway model id',()=>{expect(resolveNavigationProvider({AI_GATEWAY_API_KEY:'key',AGENTPROOF_LLM_MODEL:'google/gemini-3.8-flash'}).model).toBe('google/gemini-3.8-flash');});
 it('uses the requested Gemini default with only its key',()=>{expect(resolveNavigationProvider({AI_GATEWAY_API_KEY:'key'}).model).toBe('google/gemini-3.8-flash');});
 it('keeps OpenAI model and adapter when the gateway key is absent',()=>{expect(resolveNavigationProvider({AI_GATEWAY_API_KEY:' ',AGENTPROOF_LLM_MODEL:'gemini-other',OPENAI_API_KEY:'openai-key',OPENAI_MODEL:'openai-model'}).model).toBe('openai-model');});
 it('leaves navigation unavailable without a configured provider',()=>{expect(resolveNavigationProvider({})).toEqual({model:'unconfigured'});expect(resolveNavigationProvider({OPENAI_API_KEY:'key'}).provider).toBeUndefined();});
});
