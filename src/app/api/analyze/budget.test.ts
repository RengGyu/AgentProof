import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST } from './route';
import * as github from '@/lib/github';
import * as observation from '@/lib/general-pr-observation-service';
import { demoScenarios } from '@/lib/sample-data';
vi.mock('@/lib/tenant-auth',async original=>({...await original<typeof import('@/lib/tenant-auth')>(),resolveTenantAuthAccess:async()=>({authorized:true})}));
vi.mock('@/lib/github-analysis-access', () => ({ resolveGitHubAnalysisCredential: vi.fn(async () => ({ ok: true, token: 'server-selected-test-token', kind: 'user' })) }));

beforeEach(()=>{
 vi.stubEnv('GEMINI_API_KEY','fake');vi.stubEnv('AGENTPROOF_GENERAL_PR_OBSERVATION_MODE','advisory');
 vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_URL','https://budget.invalid');vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY','fake');
 vi.spyOn(github,'buildPullRequestInput').mockResolvedValue(demoScenarios.clean);
 vi.spyOn(observation,'isGeneralPrSemanticObserverEligibleV2').mockReturnValue(true);
 // Exercise the real attached Gemini adapter and budget scope, without sending model traffic.
 vi.spyOn(observation,'runGeneralPrObservationNowV2').mockImplementation(async options=>{
  await options.navigation!.provider!({stage:'intent',model:'gemini-3.8-flash',sources:[],goals:[],artifacts:[],inventory:[],capabilities:{readPaths:false,searchScope:'supplied_artifacts',wholeRepository:false}});
  throw Error('Provider should have been blocked');
 });
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();});
it.each(['soft_stop','hard_pause','unconfigured'])('returns a bounded %s error through the public analyze route',async reason=>{
 const calls:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
  calls.push(String(url));
  const action=JSON.parse(String(init?.body)).p_action;
  if(action==='config'&&reason!=='unconfigured')return Response.json({allowed:true,config:{timeZone:'UTC',krwPerUsd:'1000',validUntil:'2099-01-01T00:00:00Z',prices:{'google/gemini-3.8-flash':{inputUsdPerMillion:'0.75',outputUsdPerMillion:'3.75',callReserveKrw:'100',source:'https://ai.google.dev/gemini-api/docs/pricing'}}}});
  return Response.json({allowed:false,reason});
 }));
 const response=await POST(new Request('http://localhost/api/analyze',{method:'POST',headers:{Origin:'http://localhost','x-agentproof-analysis-key':'same-attempt'},body:JSON.stringify({prUrl:'https://github.com/acme/repo/pull/1'})}));
 const json=await response.json();
 expect(response.status,JSON.stringify(json)).toBe(reason==='soft_stop'?429:503);
 expect(json).toHaveProperty('code',reason==='unconfigured'?'budget_unavailable':reason);
 expect(calls.every(url=>url==='https://budget.invalid/rest/v1/rpc/agentproof_paid_budget')).toBe(true);
});
