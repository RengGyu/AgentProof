import { paidProviderCall, normalizePaidUsage, type PaidUsage } from './paid-budget';
import { recordReviewEvidence, type JevFailureCode, type ReviewMeasurementContext } from './review-navigation-diagnostics';

import { applyJevSelection, prepareJevSelection, type JevProposal, type PreparedSelection } from './jev-selection-contract';
export { applyJevSelection, prepareJevSelection, type JevSelectionContext, type JevProposal, type JevPreparationDiagnostics } from './jev-selection-contract';
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const bytes=(value:unknown)=>Buffer.byteLength(JSON.stringify(value));
/** Untrusted error bodies stay in bounded memory; only closed labels/numeric context survive. */
async function readJevError(response:Response):Promise<Partial<import('./review-navigation-diagnostics').ReviewEvidenceFields>> {
 const result:Partial<import('./review-navigation-diagnostics').ReviewEvidenceFields>={jevErrorBody:'unavailable',jevRejection:'unknown'};
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 try{
  if(!response.body)return result;
  reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768){result.jevErrorBody='too_large';await reader.cancel();return result;}chunks.push(value);}
  const body=JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;result.jevErrorBody='json';
  if(!object(body))return result;
  result.usagePresent=Object.hasOwn(body,'usage');
  const detail=body.detail,error=body.error;
  const rows=[body,...(object(detail)?[detail]:Array.isArray(detail)?detail.slice(0,8).filter(object):[]),...(object(error)?[error]:[])];
  const codes=['api_usage_error','validation_error','context_length_exceeded','invalid_request_error'] as const;
  const field=(loc:unknown):string|undefined=>{
   if(!Array.isArray(loc)||loc.length>6)return;
   const parts=loc[0]==='body'?loc.slice(1):loc;
   if(parts.length===1&&['state','model','questions'].includes(parts[0]))return parts[0];
   if(parts[0]==='questions'&&parts[1]==='selection'&&parts.length>=2&&parts.length<=4){
    if(parts.length===2)return 'questions.selection';
    if(parts.length===3&&['type','instructions','criteria'].includes(parts[2]))return 'questions.selection.'+parts[2];
    if(parts.length===4&&parts[2]==='criteria'&&parts[3]==='none')return 'questions.selection.criteria';
   }
  };
  for(const row of rows){
   for(const key of ['code','error_type','type'])if(codes.includes(row[key] as never))result.jevProviderErrorCode=row[key] as typeof codes[number];
   const loc=field(row.loc);if(loc){result.jevErrorField=loc as NonNullable<typeof result.jevErrorField>;result.jevRejection='field_validation';}
   // Only a message made entirely of fixed context-limit vocabulary is interpretable.
   // Paths, prompt/code, arbitrary identifiers, and unknown words cause the message to be discarded.
   for(const raw of [row.message,row.msg,typeof detail==='string'?detail:null,typeof error==='string'?error:null]){
    if(typeof raw!=='string'||raw.length>512)continue;
    const msg=raw.toLowerCase();
    const allowed=new Set('a an the of in to for and or is are was be must can cannot not no with by at most too many more than has have exceeded exceeds exceed exceeding maximum max minimum min limit limited limits allowed allowable length context window input state question questions selection tokens token count counts total combined number size reduce please received requested actual got your this model only supported per request invalid error less equal should each plus but it long large larger longer sum sums single all maximum_context_length'.split(' '));
    if(!/^[a-z0-9\s.,:;()<>+=_\-'"`]+$/.test(msg)||msg.match(/[a-z_]+/g)?.some(w=>!allowed.has(w)))continue;
    if(!/\btokens?\b/.test(msg)||!/(?:exceed|too many|maximum|max|limit|at most|cannot|must|<=)/.test(msg))continue;
    result.jevRejection='context_token_limit';
    const limit=msg.match(/(?:maximum|max|limit(?:ed)?|allowed|at most|<=)\s*(?:of\s*|is\s*|are\s*|to\s*|context\s*|length\s*|tokens?\s*|[:=(]\s*)*([0-9]+(?:,[0-9]{3})*)(?![0-9.,])\b/)?.[1]?.replaceAll(',','');
    const actual=msg.match(/(?:received|requested|actual|got|has|have)\s*(?:tokens?\s*|[:=(]\s*)*([0-9]+(?:,[0-9]{3})*)(?![0-9.,])\b/)?.[1]?.replaceAll(',','');
    if(limit&&Number(limit)>0&&Number(limit)<=1_000_000)result.jevContextTokenLimit=Number(limit);
    if(actual&&Number(actual)<=1_000_000)result.jevContextTokens=Number(actual);
   }
  }
  return result;
 }catch{if(result.jevErrorBody==='unavailable')result.jevErrorBody='non_json';return result;}
 finally{reader?.releaseLock();}
}
/** No automatic retries: each future attempt must obtain its own durable reservation. */
export async function submitJevSelection(prepared:PreparedSelection,options:{apiKey:string;signal?:AbortSignal;measurements?:ReviewMeasurementContext}):Promise<{proposal:JevProposal|null;model:string;usage:PaidUsage|null;confidence:number;choice:string;probabilities:Record<string,number>;transportMs:number}> {
 if(options.signal?.aborted)throw Error('jev_cancelled');
 if(!options.apiKey.trim())throw Error('jev_key_unconfigured');
 const request=prepared.request;
 if(request.model!=='jev-1.13.0'||bytes(request)>40_000||prepared.proposals.length>4||prepared.proposals.length===0)throw Error('jev_request_invalid');
 let transportMs=0,httpStatus:number|null=null;
 const fail:(code:JevFailureCode,message:string,usagePresent:boolean|null,details?:Partial<import('./review-navigation-diagnostics').ReviewEvidenceFields>)=>never=(code,message,usagePresent,details={})=>{
  recordReviewEvidence(options.measurements,'provider_failure',{...details,providerFailureCode:code,httpStatus,usagePresent,reason:code==='jev_http_error'&&httpStatus===429?'provider_rate_limited':code==='jev_response_invalid'||code==='jev_model_mismatch'||code==='jev_usage_unavailable'?'provider_response_invalid':'provider_unavailable',callSpanId:options.measurements?.parentId??undefined});
  throw Error(message);
 };
 const response=await paidProviderCall({provider:'typesafe',model:request.model,measurements:options.measurements,usage:raw=>object(raw)&&raw.model===request.model?normalizePaidUsage('typesafe',raw.usage):null,invoke:async signal=>{
  const started=performance.now(),combined=options.signal?AbortSignal.any([signal,options.signal]):signal;
  try{
   const r=await fetch('https://api.typesafe.ai/v1/systemone',{method:'POST',headers:{Authorization:`Bearer ${options.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(request),cache:'no-store',signal:combined});
   httpStatus=r.status;
   if(!r.ok){const details=await readJevError(r);fail('jev_http_error',`jev_http_${r.status}`,details.usagePresent??null,details);}
   try{return await r.json() as unknown;}catch{fail('jev_response_invalid','jev_response_invalid',null);}
  }catch(error){if(error instanceof Error&&/^jev_(?:http_\d{3}|response_invalid)$/.test(error.message))throw error;fail(combined.aborted?'jev_cancelled':'jev_transport_failed',combined.aborted?'jev_cancelled':'jev_transport_failed',null);}
  finally{transportMs=performance.now()-started;}
 }});
 if(!object(response))fail('jev_response_invalid','jev_response_invalid',null);
 const usagePresent=Object.hasOwn(response,'usage'),usage=normalizePaidUsage('typesafe',response.usage);
 if(response.model!==request.model)fail('jev_model_mismatch','jev_response_invalid',usagePresent);
 if(!usage)fail('jev_usage_unavailable','jev_response_invalid',usagePresent);
 if(!object(response.answers)||!object(response.answers.selection))fail('jev_response_invalid','jev_response_invalid',usagePresent);
 const answer=response.answers.selection,prob=answer.probabilities;
 const labels=Object.keys(request.questions.selection.criteria),unit=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1;
 if(answer.type!=='choice'||typeof answer.choice!=='string'||!labels.includes(answer.choice)||!unit(answer.confidence)||!object(prob)||Object.keys(prob).length!==labels.length||!labels.every(l=>unit(prob[l]))||Math.abs(Object.values(prob).reduce<number>((n,v)=>n+Number(v),0)-1)>0.001)fail('jev_response_invalid','jev_response_invalid',usagePresent);
 const proposal=answer.choice==='none'||answer.confidence<0.8||Number(prob[answer.choice])<0.8?null:prepared.proposals[Number(answer.choice.slice(7))-1]??null;
 return {proposal,model:response.model,usage,confidence:answer.confidence,choice:answer.choice,probabilities:prob as Record<string,number>,transportMs};
}
