/** Developer-only metadata; no report/source/exception text enters this buffer or sink. */
const buffer: Record<string,unknown>[]=[];
const pending:Record<string,unknown>[]=[];
const disposers=new Set<()=>void>();
let dropped=0, timer:ReturnType<typeof setTimeout>|undefined;
let sentAt:number[]=[];
let epoch=0;
let sending=false, removeFlushListeners:(()=>void)|undefined;
const phases=['fetch_start','headers','body_parsed','body_failed','saved_ack','view_selected','view_ignored','abort','network_error','http_error','validation_error','view_error','report_list_read','report_detail_read','offline','online','visibility','pagehide'] as const;
type Phase=typeof phases[number];
const operations=['analysis','report_detail','report_list'] as const;
const uuid=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
const integer=(x:unknown,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(x)&&Number(x)>=0&&Number(x)<=max;
const stamp=(x:unknown)=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x)&&Number.isFinite(Date.parse(x));
/** Shared strict metadata contract; unknown fields are rejected, never accepted as text. */
export function parseAnalysisClientEvent(value:unknown):Record<string,unknown>|null {
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const v=value as Record<string,unknown>,allowed=['version','client','correlation','sequence','phase','operation','at','elapsedMs','status','selectionVersion','reportHash','createdAt','droppedEvents','online','visibility','errorKind','aborted','responseBytes'];
 if(Object.keys(v).some(k=>!allowed.includes(k))||v.version!==1||!uuid(v.client)||!(v.correlation===null||uuid(v.correlation))||!integer(v.sequence,512)||!phases.includes(v.phase as Phase)||!operations.includes(v.operation as typeof operations[number])||!stamp(v.at)||typeof v.elapsedMs!=='number'||!Number.isFinite(v.elapsedMs)||v.elapsedMs<0||v.elapsedMs>3600000)return null;
 if(v.status!==undefined&&(!integer(v.status,599)||Number(v.status)<100))return null;
 for(const k of ['selectionVersion','droppedEvents','responseBytes'])if(v[k]!==undefined&&!integer(v[k]))return null;
 if(v.reportHash!==undefined&&(typeof v.reportHash!=='string'||! /^[a-f0-9]{64}$/.test(v.reportHash)))return null;
 if(v.createdAt!==undefined&&!stamp(v.createdAt))return null;
 for(const k of ['online','aborted'])if(v[k]!==undefined&&typeof v[k]!=='boolean')return null;
 if(v.visibility!==undefined&&!['visible','hidden','prerender','unknown'].includes(String(v.visibility)))return null;
 if(v.errorKind!==undefined&&!['type_error','abort_error','timeout_error','other'].includes(String(v.errorKind)))return null;
 return {...v};
}
export function analysisClientErrorKind(error:unknown):'type_error'|'abort_error'|'timeout_error'|'other'{try{if(error instanceof TypeError)return 'type_error';if(error instanceof Error&&error.name==='AbortError')return 'abort_error';if(error instanceof Error&&error.name==='TimeoutError')return 'timeout_error';}catch{}return 'other';}
const browser=()=>typeof window!=='undefined'&&typeof window.addEventListener==='function';
/** Best effort, no retry and never awaited by analysis. Auth/CSRF are checked again at the sink. */
const scheduleFlush=()=>{if(!timer)timer=setTimeout(()=>{timer=undefined;void flushAnalysisClientDiagnostics();},250);};
export async function flushAnalysisClientDiagnostics(){
 if(sending)return;
 if(timer){clearTimeout(timer);timer=undefined;}
 if(process.env.NEXT_PUBLIC_AGENTPROOF_ANALYSIS_DIAGNOSTICS!=='1'||!browser()||!pending.length||sending)return;
 sentAt=sentAt.filter(t=>t>Date.now()-60000);
 if(sentAt.length>=10){dropped+=pending.length;pending.length=0;return;}
 const uploadEpoch=epoch,events=pending.splice(0,16);sentAt.push(Date.now());
 sending=true;let delivered=false;
 try{const response=await fetch('/api/dashboard/analysis-diagnostics',{method:'POST',credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'no-store',keepalive:true,signal:AbortSignal.timeout(3000),headers:{'Content-Type':'application/json','x-agentproof-csrf':'same-origin'},body:JSON.stringify({events})});delivered=response.ok;}catch{
  // Keep bounded metadata for a later ordinary event/online signal; no retry timer.
  if(uploadEpoch===epoch){const keep=[...events,...pending];pending.splice(0,pending.length,...keep.slice(0,32));dropped+=Math.max(0,keep.length-32);}
 }finally{sending=false;}
 if((delivered||uploadEpoch!==epoch)&&pending.length)scheduleFlush();
}
const enqueue=(event:Record<string,unknown>)=>{if(!browser())return;
 if(!removeFlushListeners){const flush=()=>{void flushAnalysisClientDiagnostics();};window.addEventListener('online',flush);window.addEventListener('pagehide',flush);removeFlushListeners=()=>{window.removeEventListener('online',flush);window.removeEventListener('pagehide',flush);};}
 if(pending.length>=32){dropped++;return;}pending.push(event);scheduleFlush();
};
export const readAnalysisClientDiagnostics=()=>structuredClone(buffer);
export const clearAnalysisClientDiagnostics=()=>{epoch++;buffer.length=0;pending.length=0;dropped=0;sentAt=[];if(timer)clearTimeout(timer);timer=undefined;for(const dispose of [...disposers])dispose();removeFlushListeners?.();removeFlushListeners=undefined;};
export function startAnalysisClientDiagnostic(client?:string,version?:number,operation:typeof operations[number]='analysis'){
 if(process.env.NEXT_PUBLIC_AGENTPROOF_ANALYSIS_DIAGNOSTICS!=='1')return undefined;
 try {
 const traceEpoch=epoch,started=performance.now();let correlation:string|null=null,sequence=0,dispose=()=>{};
 const request=uuid(client)?client:crypto.randomUUID();
 const record=(phase:Phase,data:{status?:number;version?:number;reportHash?:string;createdAt?:string;errorKind?:ReturnType<typeof analysisClientErrorKind>;aborted?:boolean;responseBytes?:number}={})=>{
  try{
   if(traceEpoch!==epoch||!phases.includes(phase)||sequence>=64)return;
   const event:Record<string,unknown>={version:1,client:request,correlation,sequence:++sequence,operation,phase,at:new Date().toISOString(),elapsedMs:Math.max(0,performance.now()-started)};
   if(Number.isInteger(data.status)&&data.status!>=100&&data.status!<=599)event.status=data.status;
   if(integer(data.version))event.selectionVersion=data.version;
   if(typeof data.reportHash==='string'&&/^[a-f0-9]{64}$/.test(data.reportHash))event.reportHash=data.reportHash;
   if(stamp(data.createdAt))event.createdAt=data.createdAt;
   if(['type_error','abort_error','timeout_error','other'].includes(data.errorKind!))event.errorKind=data.errorKind;
   if(typeof data.aborted==='boolean')event.aborted=data.aborted;
   if(integer(data.responseBytes))event.responseBytes=data.responseBytes;
   if(typeof navigator!=='undefined'&&typeof navigator.onLine==='boolean')event.online=navigator.onLine;
   if(typeof document!=='undefined')event.visibility=['visible','hidden','prerender'].includes(document.visibilityState)?document.visibilityState:'unknown';
   if(buffer.length===512){buffer.shift();dropped++;}if(dropped)event.droppedEvents=dropped;
   const safe=parseAnalysisClientEvent(event);if(!safe)return;
   buffer.push(safe);enqueue(safe);
   try{console.info('agentproof_analysis_client',JSON.stringify(safe));}catch{/* Local console failure does not suppress the authenticated queue. */}
   if(['body_failed','abort','network_error','http_error','validation_error','view_error','view_selected','view_ignored','report_list_read','report_detail_read'].includes(phase))dispose();
  }catch{/* Diagnostic collection never affects request/response handling. */}
 };
 if(browser()&&disposers.size<32){
  const online=()=>record('online'),offline=()=>record('offline'),visibility=()=>record('visibility'),pagehide=()=>{record('pagehide');void flushAnalysisClientDiagnostics();dispose();};
  window.addEventListener('online',online);window.addEventListener('offline',offline);window.addEventListener('pagehide',pagehide);document?.addEventListener('visibilitychange',visibility);
  const ttl=setTimeout(()=>dispose(),600000);if(typeof ttl==='object')ttl.unref?.();
  dispose=()=>{clearTimeout(ttl);window.removeEventListener('online',online);window.removeEventListener('offline',offline);window.removeEventListener('pagehide',pagehide);document?.removeEventListener('visibilitychange',visibility);disposers.delete(dispose);};disposers.add(dispose);
 }
 record('fetch_start',{version});
 return {client:request,record,headers(response:Response){try{const value=response.headers.get('x-agentproof-diagnostic-request');if(uuid(value))correlation=value;const bytes=response.headers.get('x-agentproof-diagnostic-bytes');record('headers',{status:response.status,...(bytes&&/^\d+$/.test(bytes)?{responseBytes:Number(bytes)}:{})});}catch{}},saved(id:unknown,createdAt:unknown){
  try{if(typeof id!=='string')return;void crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(id))).then(bytes=>record('saved_ack',{reportHash:Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join(''),createdAt:typeof createdAt==='string'?createdAt:undefined})).catch(()=>{});}catch{}
 }};
 }catch{return undefined;}
}
