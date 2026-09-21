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
it('records safe usage and finish reason while retaining parseable output at the token limit',async()=>{
 const events:any[]=[];await expect(submitReviewNavigationWithGemini(request('intent'),{apiKey:'test-key',generateContent:async()=>({text:'{"goals":[]}',modelVersion:'gemini-test-001',usageMetadata:{promptTokenCount:123,candidatesTokenCount:45,thoughtsTokenCount:6},candidates:[{finishReason:'MAX_TOKENS'}]}),onDiagnostics:(d:any)=>events.push(d)} as any)).resolves.toEqual({goals:[]});
 expect(events[0]).toMatchObject({modelVersion:'gemini-test-001',inputTokens:123,outputTokens:45,thoughtTokens:6,finishReasons:['MAX_TOKENS']});expect(events[0].outputHash).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(events)).not.toContain('"goals"');
});
it('records safe transport diagnostics on an unavailable Gemini provider',async()=>{
 const events:any[]=[];await expect(submitReviewNavigationWithGemini(request('intent'),{apiKey:'test-key',generateContent:async()=>{throw Error('PRIVATE_PROVIDER_BODY');},onDiagnostics:d=>events.push(d)})).rejects.toThrow('Gemini navigation provider unavailable.');expect(events[0]).toMatchObject({finishReasons:['failed'],modelVersion:null,outputHash:null});expect(JSON.stringify(events)).not.toContain('PRIVATE');
});
it('does not retain unsafe provider metadata or raw output in diagnostics',async()=>{
 const secret='ghp_'+'q'.repeat(36),events:any[]=[];await submitReviewNavigationWithGemini(request('intent'),{apiKey:'test-key',generateContent:async()=>({text:JSON.stringify({note:secret}),modelVersion:secret,usageMetadata:{promptTokenCount:-5},candidates:[{finishReason:secret}]}),onDiagnostics:d=>{events.push(d);throw Error('sink');}});expect(events[0]).toMatchObject({modelVersion:null,inputTokens:null,finishReasons:['OTHER']});expect(JSON.stringify(events)).not.toContain(secret);
});
