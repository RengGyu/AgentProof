import {timeLocate,timeLocateSync} from './purpose-locate-timing';
/** DeepSeek syntax adapter for the common purpose wire; no model-specific instructions. */
import Ajv from 'ajv';
import {createHash} from 'node:crypto';
import {purposeProviderInput,purposeRequestSchema,purposeResponseText,purposeWireSchema,boundedPurposeJson,type PurposeProviderRequest,type PurposeProvider} from './purpose-provider';
import {parsePurposeFinalWire,parsePurposeUnitsWire,normalizePurposeExploreWire} from './purpose-contract';
import {assertPaidAnalysisScope,PaidBudgetError,DEEPSEEK_MAX_OUTPUT_TOKENS} from './paid-budget';
import {purposeDeadline} from './purpose-timeout';
import {closedProviderResponseMetadata,annotatePurposeFailure,closedProviderFailure,purposeFailureDiagnostic,type PurposeFailurePhase} from './purpose-failure';
import {analysisDiagnostic,analysisHash,nextAnalysisDiagnosticCall} from './analysis-diagnostics';

export const DEEPSEEK_PURPOSE_PROFILE={provider:'deepseek',model:'deepseek-flash',effort:'high',maxOutputTokens:DEEPSEEK_MAX_OUTPUT_TOKENS,inputUpperBound:1048576} as const;

export interface DeepSeekProfile {
  model: 'deepseek-flash' | 'deepseek-v4-pro';
  effort: 'none' | 'low' | 'high' | 'max';
}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const token=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;

/** Reuse the current common instructions verbatim, adapting only the native role/format. */
export function prepareDeepSeekPurposeRequest(request:PurposeProviderRequest,profile:DeepSeekProfile,signal:AbortSignal,maxOutputTokens:number=DEEPSEEK_PURPOSE_PROFILE.maxOutputTokens) {
  signal.throwIfAborted();
  if(request.flow!=='explore_final_v1'||!['purpose','locate','assess'].includes(request.stage))throw new Error('purpose_stage_flow_required');
  if(!['deepseek-flash','deepseek-v4-pro'].includes(profile.model)||!['none','low','high','max'].includes(profile.effort))throw new Error('purpose_stage_provider_unavailable');
  if(!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>DEEPSEEK_MAX_OUTPUT_TOKENS)throw new Error('purpose_provider_schema');
  const localSchema=purposeRequestSchema(request);
  // DeepSeek treats developer as user. Keep the unchanged instructions in its system role.
  const input=purposeProviderInput(request).map(m=>({...m,role:m.role==='developer'?'system':m.role}));
  const body={model:profile.model,input,reasoning:{effort:profile.effort},
    text:{format:{type:'json_schema',name:request.stage==='assess'?'purpose_final_v1':`purpose_${request.stage}_v1`,schema:purposeWireSchema(localSchema)}},
    max_output_tokens:maxOutputTokens,store:false,stream:false};
  // Freeze before any future counting/admission/transport. Do not log body or localSchema.
  const bodyJson=JSON.stringify(body),schemaJson=JSON.stringify(localSchema);
  return {bodyJson,schemaJson,model:profile.model,stage:request.stage,finalFormat:request.finalFormat,maxOutputTokens,manifest:{
    provider:'deepseek',stage:request.stage,model:profile.model,effort:profile.effort,
    bodyHash:hash(body),inputHash:hash(input),promptHash:hash(input[0]),schemaHash:hash(localSchema),
    endpoint:'https://api.deepseek.com/responses',preCount:'UNVERIFIED',liveAdmission:'BLOCKED'
  } as const};
}

/** Actual returned counts only. Missing cache/reasoning detail remains unknown, never zero. */
export function readDeepSeekUsage(raw:unknown) {
  const u=raw as {input_tokens?:unknown;output_tokens?:unknown;total_tokens?:unknown;input_tokens_details?:{cached_tokens?:unknown};output_tokens_details?:{reasoning_tokens?:unknown}}|null;
  if(!u||!token(u.input_tokens)||!token(u.output_tokens)||!token(u.total_tokens)||u.total_tokens!==u.input_tokens+u.output_tokens)throw new Error('purpose_usage_unconfirmed');
  const cached=u.input_tokens_details?.cached_tokens,reasoning=u.output_tokens_details?.reasoning_tokens;
  if(cached!==undefined&&(!token(cached)||cached>u.input_tokens)||reasoning!==undefined&&(!token(reasoning)||reasoning>u.output_tokens))throw new Error('purpose_usage_unconfirmed');
  return {input:u.input_tokens,output:u.output_tokens,total:u.total_tokens,cachedInput:cached??null,reasoning:reasoning??null};
}

const SCHEMA_KEYWORDS=new Set(['required','additionalProperties','enum','type','minItems','maxItems','minLength','maxLength','anyOf','pattern','const']);
const schemaFailures=new WeakMap<Error,{reason:'output_bound'|'empty'|'size'|'json'|'schema';keyword?:string}>();
/** Same closed code; only a fixed reason and an allowlisted JSON Schema keyword are kept, never text, paths or values. */
function schemaFailure(reason:'output_bound'|'empty'|'size'|'json'|'schema',keyword?:unknown){
  const error=new Error('purpose_provider_schema');
  schemaFailures.set(error,{reason,...(typeof keyword==='string'&&SCHEMA_KEYWORDS.has(keyword)?{keyword}:{})});
  return error;
}

/** Syntax/local-schema adapter; downstream compiler, exact quote and source guards still apply. */
export function decodeDeepSeekPurposeResponse(prepared:ReturnType<typeof prepareDeepSeekPurposeRequest>,raw:unknown,signal:AbortSignal) {
  signal.throwIfAborted();
  const body=raw as {model?:unknown;status?:unknown;usage?:unknown;output?:unknown}|null;
  if(!body||body.model!==prepared.model)throw new Error('purpose_model_mismatch');
  const usage=readDeepSeekUsage(body.usage);
  if(usage.output>prepared.maxOutputTokens)throw schemaFailure('output_bound');
  if(body.status!=='completed')throw new Error('purpose_provider_incomplete');
  const text=purposeResponseText(body.output);
  if(!text.length)throw schemaFailure('empty');
  if(Buffer.byteLength(text)>256000)throw schemaFailure('size');
  let value:unknown;
  try{value=JSON.parse(text);}catch{throw schemaFailure('json');}
  if(prepared.stage==='purpose')value=normalizePurposeExploreWire(value);
  const validate=new Ajv().compile(JSON.parse(prepared.schemaJson));
  if(!validate(value))throw schemaFailure('schema',validate.errors?.[0]?.keyword);
  signal.throwIfAborted();
  return {value:prepared.stage==='assess'?(prepared.finalFormat?parsePurposeUnitsWire(value):parsePurposeFinalWire(value)):value,usage};
}

/** One shared operational provider for purpose, every locate round and final; no fallback. */
/** callerAuthorizesAround: the assessment invoke checks the same authorizer immediately before and after this call; only synchronous preparation/decoding lies between, so the adapter adds none. */
export function createDeepSeekPurposeProvider(options:{apiKey:string;fetchFn?:typeof fetch;authorizePrivate?:(signal?:AbortSignal)=>Promise<boolean>;callerAuthorizesAround?:boolean}):PurposeProvider {
 return async(request,parentSignal)=>{
  const call=nextAnalysisDiagnosticCall();
  let phase:PurposeFailurePhase='setup',providerHTTPStatus:number|null=null,failureCode:string|undefined;
  let providerResponse:ReturnType<typeof closedProviderResponseMetadata>|undefined;
  // Purpose and final assess are bounded by the caller's absolute analysis deadline instead of a fresh 60s.
  const callerDeadline=request.flow==='explore_final_v1'&&(request.stage==='purpose'||request.stage==='assess');
  const deadline=callerDeadline?{signal:parentSignal,dispose:()=>{}}:purposeDeadline(60000,'provider_timeout',parentSignal),signal=deadline.signal;
  try{
   assertPaidAnalysisScope();signal.throwIfAborted();
   if(!options.apiKey.trim())throw new Error('purpose_key_missing');
   phase='schema';
   const prepared=timeLocateSync('request_prepare',()=>prepareDeepSeekPurposeRequest(request,DEEPSEEK_PURPOSE_PROFILE,signal));
   const authorize=async()=>{signal.throwIfAborted();if(options.authorizePrivate&&!await options.authorizePrivate(signal))throw new Error('purpose_private_consent_required');signal.throwIfAborted();};
   const measuredUsage=(body:any)=>{
    if(!body||typeof body!=='object'||Array.isArray(body))throw new PaidBudgetError('purpose_usage_unconfirmed');
    if(body.model!==DEEPSEEK_PURPOSE_PROFILE.model)throw new PaidBudgetError('purpose_model_mismatch');
    try{const u=readDeepSeekUsage(body.usage);if(u.input>DEEPSEEK_PURPOSE_PROFILE.inputUpperBound||u.output>DEEPSEEK_PURPOSE_PROFILE.maxOutputTokens)throw new Error();return {input:u.input,output:u.output};}
    catch{throw new PaidBudgetError('purpose_usage_unconfirmed');}
   };
   if(!options.callerAuthorizesAround)await authorize();
   signal.throwIfAborted();phase='transport';
   // Beta cost control is the DeepSeek prepaid balance: no per-call app reservation, settlement or pause poll.
   const start=performance.now();
   analysisDiagnostic('provider_generate','start',()=>({purposeStage:request.stage,model:DEEPSEEK_PURPOSE_PROFILE.model,effort:'high',counts:{call},hashes:{common:prepared.manifest.bodyHash,schema:prepared.manifest.schemaHash,prompt:prepared.manifest.promptHash,input:prepared.manifest.inputHash,profile:analysisHash(DEEPSEEK_PURPOSE_PROFILE)}}));
   const exchange=(async()=>{
    const response=await timeLocate('provider_transport',()=>(options.fetchFn??fetch)(prepared.manifest.endpoint,{method:'POST',redirect:'error',signal,
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${options.apiKey}`},body:prepared.bodyJson}));
    providerHTTPStatus=response.status;
    if(!response.ok)failureCode='purpose_provider_http';
    const body=await timeLocate('provider_body',()=>boundedPurposeJson(response,signal));
    providerResponse=closedProviderResponseMetadata({status:body?.status,incompleteReason:body?.incomplete_details?.reason,inputTokens:body?.usage?.input_tokens,outputTokens:body?.usage?.output_tokens,totalTokens:body?.usage?.total_tokens,cachedInputTokens:body?.usage?.input_tokens_details?.cached_tokens,reasoningTokens:body?.usage?.output_tokens_details?.reasoning_tokens});
    if(!response.ok)failureCode=closedProviderFailure(body)??'purpose_provider_http';
    let usage:ReturnType<typeof readDeepSeekUsage>|null=null;try{usage=readDeepSeekUsage(body.usage);}catch{/* Reported below as unconfirmed usage. */}
    analysisDiagnostic('provider_generate',response.ok?'success':'failure',()=>({purposeStage:request.stage,counts:{call,status:response.status,transportMs:performance.now()-start,inputTokens:usage?.input??null,outputTokens:usage?.output??null,reasoningTokens:usage?.reasoning??null},hashes:{common:prepared.manifest.bodyHash,responseModel:analysisHash(body?.model)}}));
    return {ok:response.ok,body};
   })();
   exchange.catch(()=>{});
   // End the wait at the deadline/cancel even if transport ignores its signal.
   let onAbort=()=>{};
   const aborted=new Promise<never>((_resolve,reject)=>{onAbort=()=>reject(signal.reason);signal.addEventListener('abort',onAbort,{once:true});});
   aborted.catch(()=>{});
   let result:{ok:boolean;body:any};
   try{result=await Promise.race([exchange,aborted]);}finally{signal.removeEventListener('abort',onAbort);}
   phase='usage';
   if(!result.ok)throw new Error(failureCode??'purpose_provider_http');
   try{measuredUsage(result.body);}catch(error){failureCode=(error as PaidBudgetError).code;throw error;}
   if(!options.callerAuthorizesAround)await authorize();
   phase='parse';
   const decoded=timeLocateSync('provider_parse',()=>decodeDeepSeekPurposeResponse(prepared,result.body,signal));
   analysisDiagnostic('provider_budget','success',()=>({purposeStage:request.stage,usageKnown:true,counts:{call,inputTokens:decoded.usage.input,outputTokens:decoded.usage.output,reasoningTokens:decoded.usage.reasoning}}));
   return decoded.value;
  }catch(error){
   if(error instanceof PaidBudgetError&&error.code!=='purpose_usage_unconfirmed'&&error.code!=='purpose_model_mismatch'){failureCode=undefined;if(error.code!=='budget_call_timeout')phase='budget';}
   annotatePurposeFailure(error,{stage:request.stage,phase,providerHTTPStatus,code:failureCode,...(error instanceof Error&&error.message==='purpose_provider_incomplete'&&providerResponse?{providerResponse}:{}),...(error instanceof Error&&schemaFailures.has(error)?{schemaFailure:schemaFailures.get(error)}:{})});
   analysisDiagnostic(['budget','usage'].includes(phase)?'provider_budget':'provider_generate','failure',()=>({purposeStage:request.stage,counts:{call},failure:purposeFailureDiagnostic(error)}));
   throw error;
  }finally{deadline.dispose();}
 };
}
