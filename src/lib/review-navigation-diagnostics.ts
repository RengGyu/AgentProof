import { createHash } from 'crypto';
import { redactSecrets } from './redact';
import type { ReviewNavigationRequest } from './review-intent';

export type ReviewPhase = 'request'|'initial_evidence'|'report'|'model'|'budget_reserve'|'provider_transport'|'budget_settle'|'budget_close'|'artifact_read'|'freshness_read'|'access_recheck'|'snippet_extraction'|'packet'|'local_validation'|'runtime_validation'|'session_recheck'|'response_projection'|'display_projection'|'storage'|'storage_validation'|'storage_projection'|'storage_write'|'additional_read';
export const NAVIGATION_FAILURE_REASONS=['provider_incomplete','provider_invalid_json','provider_output_unavailable','provider_invalid_output','provider_response_invalid','provider_timeout','provider_rate_limited','provider_unavailable','local_shape','unknown_source_ref','unsafe_summary','unknown_goal_ref','duplicate_goal_ref','unknown_artifact_ref','first_not_candidate','read_unavailable','unknown'] as const;
export type ReviewEvidenceStage = 'read_candidate'|'read'|'snippet_candidate'|'snippet'|'artifact'|'packet'|'model_choice'|'local_validation'|'provider_failure'|'read_failure'|'failure'|'projection';
const reasons = new Set<string>([...NAVIGATION_FAILURE_REASONS,'limitations_overflow','included','selected','reused','covered','merged','remapped','duplicate','file_budget_exceeded','snippet_budget_exceeded','packet_budget_exceeded','artifact_budget_exceeded','truncated','unsafe_path','unavailable','invalid_reference','requested_path_unread','unknown_artifact_ref','local_shape','accepted','shared_supplied_artifact','first_not_candidate','binding_mismatch','missing_artifact','displayed','freshness_rejected','unsafe_summary','unknown_source_ref','unknown_goal_ref','duplicate_goal_ref','read_unavailable']);
export interface ReviewEvidenceFields { artifactId?:string; packetHash?:string; callSpanId?:string; fileId?:string; goalId?:string; parentIds?:string[]; hash?:string; pathHash?:string; revisionHash?:string; startLine?:number; endLine?:number; bytes?:number; count?:number; reason?:string;failureStage?:'intent'|'ranking'|'refinement'|'read' }
interface ReviewSpan { id:string;parentId:string|null;phase:ReviewPhase;startMs:number;endMs:number|null;durationMs:number|null;outcome:'open'|'ok'|'error' }
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export const reviewFileId=(path:string,revision:string)=>`file_${digest(JSON.stringify([path,revision])).slice(0,24)}`;
export const reviewArtifactId=(a:{path:string;revision:string;startLine:number;endLine:number;hash:string})=>`read_${digest(JSON.stringify([a.path,a.revision,a.startLine,a.endLine,a.hash])).slice(0,24)}`;
const reference=(id:string)=>/^(?:read_|file_)[a-f0-9]{24}$|^goal_\d{1,6}$/.test(id)?id:`ref_${digest(id).slice(0,24)}`;
/** Request-local, bounded, text-free metadata. Intervals are inclusive, never additive. */
export function createReviewMeasurements(now:()=>number=()=>performance.now()) {
 const origin=now(),spans:ReviewSpan[]=[],evidence:Array<ReviewEvidenceFields&{id:string;spanId:string|null;stage:ReviewEvidenceStage}>=[];
 let droppedSpans=0,droppedEvidence=0,bytes=0,evidenceClosed=false;
 const time=()=>Math.max(0,now()-origin);
 return {
  start(phase:ReviewPhase,parentId?:string|null):string { if(spans.length>=256){droppedSpans++;return '';}const id=`span_${spans.length+1}`;spans.push({id,parentId:spans.some(s=>s.id===parentId)?parentId!:null,phase,startMs:time(),endMs:null,durationMs:null,outcome:'open'});return id; },
  finish(id:string,outcome:'ok'|'error'='ok') {const s=spans.find(s=>s.id===id);if(s&&s.endMs===null){s.endMs=time();s.durationMs=Math.max(0,s.endMs-s.startMs);s.outcome=outcome;}},
  canRecordEvidence(){return !evidenceClosed&&evidence.length<1024&&bytes<220_000;},
  dropEvidence(){droppedEvidence++;},
  record(stage:ReviewEvidenceStage,fields:ReviewEvidenceFields,parentId?:string|null) {
   if(evidenceClosed||evidence.length>=1024||bytes>=220_000){droppedEvidence++;return;}
   const clean:ReviewEvidenceFields={};
   for(const key of ['artifactId','fileId','goalId'] as const)if(typeof fields[key]==='string')clean[key]=reference(fields[key]!);
   if(Array.isArray(fields.parentIds))clean.parentIds=fields.parentIds.slice(0,16).filter(v=>typeof v==='string').map(reference);
   for(const key of ['hash','pathHash','revisionHash','packetHash'] as const)if(typeof fields[key]==='string'&&/^[a-f0-9]{64}$/.test(fields[key]!))clean[key]=fields[key];
   for(const key of ['startLine','endLine','bytes','count'] as const)if(count(fields[key])!==null)clean[key]=fields[key];
   if(typeof fields.callSpanId==='string'&&spans.some(s=>s.id===fields.callSpanId))clean.callSpanId=fields.callSpanId;
   if(fields.reason&&reasons.has(fields.reason))clean.reason=fields.reason;
   if(fields.failureStage&&['intent','ranking','refinement','read'].includes(fields.failureStage))clean.failureStage=fields.failureStage;
   const entry={id:`event_${evidence.length+1}`,spanId:spans.some(s=>s.id===parentId)?parentId!:null,stage,...clean},size=Buffer.byteLength(JSON.stringify(entry));
   if(bytes+size>220_000){evidenceClosed=true;droppedEvidence++;return;}bytes+=size;evidence.push(entry);
  },
  snapshot(){return structuredClone({version:1,timingMeaning:'inclusive_intervals_do_not_sum' as const,spans,evidence,droppedSpans,droppedEvidence});}
 };
}
export interface ReviewMeasurementContext { trace:ReturnType<typeof createReviewMeasurements>;parentId?:string|null }
export function recordReviewEvidence(context:ReviewMeasurementContext|undefined,stage:ReviewEvidenceStage,fields:ReviewEvidenceFields|(()=>ReviewEvidenceFields)) {
 if(!context)return;
 if(!context.trace.canRecordEvidence()){context.trace.dropEvidence();return;}
 context.trace.record(stage,typeof fields==='function'?fields():fields,context.parentId);
}
export async function measureReviewAsync<T>(context:ReviewMeasurementContext|undefined,phase:ReviewPhase,work:(child?:ReviewMeasurementContext)=>Promise<T>):Promise<T> {
 if(!context)return work();const id=context.trace.start(phase,context.parentId),child={trace:context.trace,parentId:id};
 try{const result=await work(child);context.trace.finish(id);return result;}catch(error){context.trace.finish(id,'error');throw error;}
}
export function measureReviewSync<T>(context:ReviewMeasurementContext|undefined,phase:ReviewPhase,work:(child?:ReviewMeasurementContext)=>T):T {
 if(!context)return work();const id=context.trace.start(phase,context.parentId);
 try{const result=work({trace:context.trace,parentId:id});context.trace.finish(id);return result;}catch(error){context.trace.finish(id,'error');throw error;}
}
const packetMeasurements=new WeakMap<ReviewNavigationRequest,ReviewMeasurementContext>();
export const setNavigationMeasurements=(packet:ReviewNavigationRequest,context:ReviewMeasurementContext|undefined)=>{if(context)packetMeasurements.set(packet,context);};
export const getNavigationMeasurements=(packet:ReviewNavigationRequest)=>packetMeasurements.get(packet);

export interface NavigationTransportDiagnostics {
 provider:'google'|'openai'; modelVersion:string|null; inputTokens:number|null; outputTokens:number|null; thoughtTokens:number|null;
 /** Legacy adapter duration includes budget work; provider_transport spans isolate the guarded invocation. */
 finishReasons:string[]; latencyMs:number; outputBytes:number; outputHash:string|null; callSpanId?:string;
}
const transports=new WeakMap<ReviewNavigationRequest,NavigationTransportDiagnostics>();
export const getNavigationTransportDiagnostics=(request:ReviewNavigationRequest)=>transports.get(request);
const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=100_000_000?v:null;
/** Store only bounded metadata; arbitrary provider text and keys never enter diagnostics. */
export function recordNavigationTransport(request:ReviewNavigationRequest,input:{provider:'google'|'openai';modelVersion?:unknown;inputTokens?:unknown;outputTokens?:unknown;thoughtTokens?:unknown;finishReasons?:unknown[];started:number;text?:string},onDiagnostics?:(data:NavigationTransportDiagnostics)=>void){
 const model=input.modelVersion;
 const data:NavigationTransportDiagnostics={provider:input.provider,modelVersion:typeof model==='string'&&model.length<=128&&/^(?:models\/)?(?:gemini-|gpt-|chatgpt-|o[134])[-\w./:]*$/.test(model)&&redactSecrets(model)===model?model:null,inputTokens:count(input.inputTokens),outputTokens:count(input.outputTokens),thoughtTokens:count(input.thoughtTokens),finishReasons:(input.finishReasons??[]).slice(0,4).map(v=>['STOP','MAX_TOKENS','SAFETY','RECITATION','OTHER','BLOCKLIST','PROHIBITED_CONTENT','SPII','MALFORMED_FUNCTION_CALL','completed','incomplete','failed'].includes(String(v))?String(v):'OTHER'),latencyMs:Math.max(0,Date.now()-input.started),outputBytes:Buffer.byteLength(input.text??''),outputHash:input.text?createHash('sha256').update(input.text).digest('hex'):null};
 const callSpanId=getNavigationMeasurements(request)?.parentId;if(callSpanId)data.callSpanId=callSpanId;
 transports.set(request,data);try{onDiagnostics?.(structuredClone(data));}catch{/* Diagnostics must not discard usable results. */}
 return data;
}
