import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewNavigationRequest } from './review-intent';
import { resolveNavigationProvider, submitReviewNavigationWithGemini } from './gemini-navigation';

const request=(stage:'intent'|'ranking'):ReviewNavigationRequest=>({stage,model:'google/gemini-test',sources:[],goals:[],artifacts:[],inventory:[],capabilities:{readPaths:false,searchScope:'supplied_artifacts',wholeRepository:false}});
beforeEach(()=>vi.clearAllMocks());

describe('Gemini navigation through the Google Gemini API',()=>{
 it.each(['intent','ranking'] as const)('uses Google generateContent with structured JSON for %s',async stage=>{
  const output=stage==='intent'?{goals:[],unprocessed:[]}:{rankings:[],readPaths:[]};
  const generateContent=vi.fn(async()=>({text:JSON.stringify(output)}));
  expect(await submitReviewNavigationWithGemini(request(stage),{apiKey:'test-key',generateContent})).toEqual(output);
  expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({
   model:'gemini-test',
   contents:JSON.stringify(request(stage)),
   config:expect.objectContaining({responseMimeType:'application/json',responseJsonSchema:expect.any(Object)})
  }));
 });
 it('uses the configured key directly with an unqualified Gemini model id',async()=>{
  const selected=resolveNavigationProvider({AI_GATEWAY_API_KEY:' gateway-key ',AGENTPROOF_LLM_MODEL:' gemini-3.8-flash ',OPENAI_API_KEY:'openai-key',OPENAI_MODEL:'openai-model'});
  expect(selected.model).toBe('gemini-3.8-flash');
 });
 it('removes an accidental Google gateway prefix',()=>{expect(resolveNavigationProvider({AI_GATEWAY_API_KEY:'key',AGENTPROOF_LLM_MODEL:'google/gemini-3.8-flash'}).model).toBe('gemini-3.8-flash');});
 it('uses the requested Gemini default with only its key',()=>{expect(resolveNavigationProvider({AI_GATEWAY_API_KEY:'key'}).model).toBe('gemini-3.8-flash');});
 it('keeps OpenAI model and adapter when the gateway key is absent',()=>{expect(resolveNavigationProvider({AI_GATEWAY_API_KEY:' ',AGENTPROOF_LLM_MODEL:'gemini-other',OPENAI_API_KEY:'openai-key',OPENAI_MODEL:'openai-model'}).model).toBe('openai-model');});
 it('leaves navigation unavailable without a configured provider',()=>{expect(resolveNavigationProvider({})).toEqual({model:'unconfigured'});expect(resolveNavigationProvider({OPENAI_API_KEY:'key'}).provider).toBeUndefined();});
});
