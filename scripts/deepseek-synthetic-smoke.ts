/** Server/CLI test helper, never an application route. One synthetic stage, no private input. */
import {randomUUID} from 'node:crypto';
import {paidProviderCall,withPaidAnalysis} from '../src/lib/paid-budget';
import {prepareDeepSeekPurposeTest,decodeDeepSeekPurposeTest,readDeepSeekTestUsage} from './deepseek-purpose-test-adapter';

class SmokeFailure extends Error {
  constructor(readonly code:string,readonly httpStatus?:number){super('DeepSeek synthetic smoke could not be completed.');}
}

/** Requires server credentials and an already configured durable budget; does not configure either. */
export async function runDeepSeekSyntheticSmoke(options:{apiKey:string;fetchFn?:typeof fetch},signal:AbortSignal) {
  signal.throwIfAborted();
  if(!options.apiKey.trim())throw new SmokeFailure('deepseek_key_missing');
  const prepared=prepareDeepSeekPurposeTest({stage:'purpose',flow:'explore_final_v1',reportLanguage:'en',sources:{spans:[{
    id:'gpsp_synthetic',kind:'pr_body',authority:'author_claim',text:'Show a clear error when the synthetic form has an empty name.'
  }]}},{model:'deepseek-flash',effort:'high'},signal,2048);
  const started=performance.now(),fetchFn=options.fetchFn??fetch;
  let status:number|undefined,providerMs=0;
  const result=await withPaidAnalysis(`deepseek-synthetic-smoke:${randomUUID()}`,()=>paidProviderCall({
    provider:'deepseek',model:prepared.model,admission:{input:1048576,output:prepared.maxOutputTokens},
    invoke:async budgetSignal=>{
      const joined=AbortSignal.any([signal,budgetSignal]);joined.throwIfAborted();
      const start=performance.now();
      try {
        const response=await fetchFn(prepared.manifest.endpoint,{method:'POST',redirect:'error',signal:joined,
          headers:{'Content-Type':'application/json',Authorization:`Bearer ${options.apiKey}`},body:prepared.bodyJson});
        status=response.status;
        // Do not read/retain arbitrary provider error bodies.
        if(!response.ok){await response.body?.cancel().catch(()=>{});throw new SmokeFailure('deepseek_provider_http',status);}
        const reader=response.body?.getReader();if(!reader)throw new SmokeFailure('deepseek_body_invalid',status);
        const chunks:Uint8Array[]=[];let bytes=0;
        const cancel=()=>{void reader.cancel().catch(()=>{});};joined.addEventListener('abort',cancel,{once:true});
        try{
          for(;;){joined.throwIfAborted();const part=await reader.read();joined.throwIfAborted();if(part.done)break;
            bytes+=part.value.byteLength;if(bytes>256000)throw new SmokeFailure('deepseek_body_limit',status);chunks.push(part.value);}
          try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new SmokeFailure('deepseek_body_invalid',status);}
        }finally{joined.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});}
      }catch(error){if(error instanceof SmokeFailure)throw error;throw new SmokeFailure(joined.aborted?'deepseek_aborted':'deepseek_transport',status);}
      finally{providerMs=performance.now()-start;}
    },
    usage:body=>{
      try{const u=readDeepSeekTestUsage(body?.usage);return body?.model===prepared.model&&u.input<=1048576&&u.output<=prepared.maxOutputTokens?{input:u.input,output:u.output}:null;}catch{return null;}
    }
  }));
  const decoded=decodeDeepSeekPurposeTest(prepared,result,signal);
  // Only closed status/counts leave this helper; generated text/reasoning stay ephemeral.
  return {model:prepared.model,servedVersionBasis:'official_alias_mapping',effort:'high',thinking:'enabled',
    httpStatus:status,schemaValid:true,usage:decoded.usage,providerMs,totalMs:performance.now()-started,
    preCount:'UNKNOWN',admissionInputUpperBound:1048576,outputLimit:prepared.maxOutputTokens,
    budgetValuation:'configured_peak_cache_miss_upper_estimate',providerInvoiceUsd:'UNKNOWN',
    manifest:{...prepared.manifest,liveAdmission:'ADMITTED_WITH_CONTEXT_UPPER_BOUND'}};
}
