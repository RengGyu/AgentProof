import {it,expect,vi,afterEach} from 'vitest';
import {annotatePurposeFailure,purposeFailureDiagnostic,logPurposeFailure} from './purpose-failure';
import {PurposeAnalysisError,createRuntimePurposeOptions} from './purpose-runtime';
afterEach(()=>vi.restoreAllMocks());
it('preserves a closed nested failure and never logs arbitrary messages, proposals, headers or stack',()=>{
 const error=new Error('purpose_final_quote',{cause:new Error('secret source prompt')});
 annotatePurposeFailure(error,{stage:'assess',phase:'validation',providerHTTPStatus:200});
 const wrapped=new PurposeAnalysisError(error);const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
 logPurposeFailure(wrapped,'cookie secret');
 expect(warn).toHaveBeenCalledWith('agentproof_purpose_failure',JSON.stringify({stage:'assess',phase:'validation',code:'purpose_final_quote',providerHTTPStatus:200,requestCorrelation:null}));
 expect(wrapped.message).toBe('Core purpose analysis could not be completed. No report was saved.');
 expect(purposeFailureDiagnostic(new Error('private unknown code/prompt'))).toMatchObject({code:'unknown'});
});
it('keeps inner transport stage over outer wrapping and restricts correlation to existing validated IDs',()=>{
 const e=new Error('purpose_token_count_unavailable');annotatePurposeFailure(e,{stage:'purpose',phase:'count',providerHTTPStatus:400});annotatePurposeFailure(e,{stage:'runtime',phase:'validation'});
 expect(purposeFailureDiagnostic(new PurposeAnalysisError(e),'p87dg-1791872898005-1e3d54e4fb97')).toEqual({stage:'purpose',phase:'count',code:'purpose_token_count_unavailable',providerHTTPStatus:400,requestCorrelation:'p87dg-1791872898005-1e3d54e4fb97'});
});
it('retains localization invalid reason without retaining raw proposal and identifies missing key separately',()=>{
 const input={repositoryPrivate:false,url:'https://github.com/owner/repo/pull/7'} as any;
 const o=createRuntimePurposeOptions(input,{env:{DEEPSEEK_API_KEY:'fixture'},readCurrentInput:async()=>null});
 let e:unknown;try{o.localization!.onInvalid!({reason:'localization_clause_reference',proposal:'secret code',hash:'raw'});}catch(x){e=x;}
 expect(purposeFailureDiagnostic(e)).toMatchObject({stage:'locate',phase:'validation',code:'localization_clause_reference'});
 try{createRuntimePurposeOptions(input,{env:{},readCurrentInput:async()=>null});}catch(x){expect(purposeFailureDiagnostic(x)).toMatchObject({code:'purpose_key_missing'});}
});
it('keeps projection diagnostics limited to closed code and bounded numeric counts',()=>{
 const error=new Error('purpose_projection_refs');annotatePurposeFailure(error,{stage:'assess',phase:'projection',counts:{clauses:2,evidence:3,projectedDescriptions:1,projectedRefs:3,changeQuotes:NaN,testQuotes:2048,rawText:'SECRET',prompt:'CODE'} as any});
 const d=purposeFailureDiagnostic(error);expect(d).toMatchObject({code:'purpose_projection_refs',counts:{clauses:2,evidence:3,projectedDescriptions:1,projectedRefs:3}});expect(JSON.stringify(d)).not.toMatch(/SECRET|CODE|NaN|2048|rawText|prompt/);
});
it('logs only a tenant-bound repository hash and PR number beside the existing private correlation',()=>{
 const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});const error=new Error('secret prose');
 logPurposeFailure(error,null,{repositoryHash:'a'.repeat(64),pullRequestNumber:48});
 expect(JSON.parse(warn.mock.calls[0][1] as string)).toMatchObject({repositoryHash:'a'.repeat(64),pullRequestNumber:48,code:'unknown'});
 logPurposeFailure(error,null,{repositoryHash:'raw/private-repo TOKEN',pullRequestNumber:NaN});expect(warn.mock.calls[1][1]).not.toMatch(/repositoryHash|TOKEN|private-repo|secret/);
});

it('normalizes malformed provider completion fields and token values without logging free text',()=>{
 const e=new Error('purpose_provider_incomplete');annotatePurposeFailure(e,{stage:'purpose',phase:'parse',providerHTTPStatus:200,providerResponse:{status:'PRIVATE_STATUS_CANARY',incompleteReason:'PRIVATE_REASON_CANARY',inputTokens:NaN,outputTokens:Infinity,totalTokens:-1,cachedInputTokens:'TOKEN_CANARY',reasoningTokens:{raw:'SOURCE_CANARY'},raw:'RAW_CANARY'}} as any);
 const safe=purposeFailureDiagnostic(new PurposeAnalysisError(e));expect(safe).toMatchObject({providerResponse:{status:'unknown',incompleteReason:'unknown',inputTokens:null,outputTokens:null,totalTokens:null,cachedInputTokens:null,reasoningTokens:null}});expect(JSON.stringify(safe)).not.toMatch(/CANARY|NaN|Infinity|raw/);
});

it.each(['in_progress','completed','incomplete','failed'] as const)('keeps only allowlisted provider status %s and preserves valid zero token counts',status=>{
 const e=new Error('purpose_provider_incomplete');annotatePurposeFailure(e,{stage:'purpose',phase:'parse',providerResponse:{status,incompleteReason:'content_filter',inputTokens:0,outputTokens:1,totalTokens:1,cachedInputTokens:0,reasoningTokens:0}});
 expect(purposeFailureDiagnostic(e)).toMatchObject({providerResponse:{status,incompleteReason:'content_filter',inputTokens:0,outputTokens:1,totalTokens:1,cachedInputTokens:0,reasoningTokens:0}});
});
it.each([undefined,null,[],{status:{raw:'PRIVATE_CANARY'},incompleteReason:['PRIVATE_CANARY'],inputTokens:1.5,outputTokens:Number.MAX_SAFE_INTEGER+1}])('maps missing/malformed completion metadata to unknown and missing counts to null',value=>{
 const e=new Error('purpose_provider_incomplete');annotatePurposeFailure(e,{stage:'purpose',phase:'parse',providerResponse:value??{}} as any);const safe=purposeFailureDiagnostic(e);
 expect(safe).toMatchObject({providerResponse:{status:'unknown',incompleteReason:'unknown',inputTokens:null,outputTokens:null,totalTokens:null,cachedInputTokens:null,reasoningTokens:null}});expect(JSON.stringify(safe)).not.toMatch(/PRIVATE_CANARY|9007199254740992|1\.5/);
});

it('reports the final unit counter-reference rejection as its closed code instead of unknown',async()=>{
 const {purposeFailureDiagnostic,annotatePurposeFailure}=await import('./purpose-failure');const error=new Error('purpose_final_counter_reference');annotatePurposeFailure(error,{stage:'assess',phase:'validation'});
 expect(purposeFailureDiagnostic(error)).toMatchObject({stage:'assess',phase:'validation',code:'purpose_final_counter_reference'});
 expect(purposeFailureDiagnostic(new Error('purpose_final_counter_reference PRIVATE_CANARY')).code).toBe('unknown');
});
