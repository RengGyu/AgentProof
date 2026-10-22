import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash, randomUUID} from 'node:crypto';
import {purposeFailureDiagnostic} from './purpose-failure';

/** Private, opt-in metadata. No request/proposal bodies or exception strings reach the sink. */
const stages = ['request','input','settings','purpose','read','cache','selection','final','projection','store','response','provider_count','provider_generate','provider_budget'] as const;
type Stage = typeof stages[number];
type Outcome = 'start'|'success'|'failure'|'abort'|'reused';
const hashKeys = ['input','source','schema','prompt','common','spec','packet','final','projection','profile','head','base','path','content','client','report','job','responseModel','request','localSchema','tenant'] as const;
const countKeys = ['status','clauses','conditions','exceptions','changes','tests','refs','counterRefs','sources','bytes','startLine','endLine','returnedStart','returnedEnd','candidates','selected','omitted','reads','cacheHits','round','inputTokens','outputTokens','reasoningTokens','elapsedMs','countMs','transportMs','budgetedCallMs','droppedEvents','droppedParts','call','changeQuotes','changeInterpretations','testQuotes','testInterpretations','projectedDescriptions','projectedRefs','droppedRefs'] as const;
export interface AnalysisDiagnosticData {
 hashes?: Partial<Record<typeof hashKeys[number],string>>;
 counts?: Partial<Record<typeof countKeys[number],number|null>>;
 locale?: 'en'|'ko'; model?: 'gpt-6-luna'|'gpt-6.1-sol'|'deepseek-flash'; effort?: 'medium'|'high';
 purposeStage?: 'purpose'|'locate'|'assess'|'check';
 reason?: 'continue'|'selected'|'budget'|'unresolved'|'available'|'unavailable'|'rejected'|'metadata_only'|'complete'|'partial'|'unknown';
 usageKnown?: boolean; reportCreatedAt?:string;
 failure?: ReturnType<typeof purposeFailureDiagnostic>;
 parts?: Array<{idHash:string; textHash?:string; changeHash?:string; testHash?:string; conditions?:string[]; exceptions?:string[]; refs?:string[]; counterRefs?:string[]; startLine?:number; endLine?:number; bytes?:number; contentHash?:string; pathHash?:string; revisionHash?:string}>;
}
const scope = new AsyncLocalStorage<{correlation:string; start:number; sequence:number; dropped:number; calls:number; terminal:boolean; bytes:number; tenantHash?:string}>();
const hash = (x:unknown): x is string => typeof x==='string' && /^[a-f0-9]{64}$/.test(x);
const numeric = (x:unknown): x is number => typeof x==='number' && Number.isFinite(x) && x>=0 && x<=Number.MAX_SAFE_INTEGER;
export const analysisHash = (value:unknown) => createHash('sha256').update(JSON.stringify(value)??'null').digest('hex');
/** Called only after the existing session/CSRF guard; request bodies cannot set the owner. */
export function bindAnalysisDiagnosticTenant(tenantId:string){const s=scope.getStore();if(s)s.tenantHash=analysisHash(tenantId);}
export const nextAnalysisDiagnosticCall=()=>{const s=scope.getStore();return s?++s.calls:null;};
/** Lazy builders ensure OFF never hashes source, allocates trace entries or calls the sink. */
export function analysisDiagnostic(stage:Stage,outcome:Outcome,build:()=>AnalysisDiagnosticData=()=>({})):void {
 const s=scope.getStore();if(!s)return;
 if(s.sequence>=256){if(stage!=='response'||outcome==='start'||s.terminal){s.dropped++;return;}s.terminal=true;}
 try {
  if(!stages.includes(stage)||!['start','success','failure','abort','reused'].includes(outcome))return;
  const data=build(), clean:Record<string,unknown>={version:1,correlation:s.correlation,sequence:++s.sequence,at:new Date().toISOString(),elapsedMs:Math.max(0,performance.now()-s.start),stage,outcome};
  const hashes:Record<string,string>={}, counts:Record<string,number|null>={};
  for(const k of hashKeys)if(hash(data.hashes?.[k]))hashes[k]=data.hashes![k]!;
  if(s.tenantHash)hashes.tenant=s.tenantHash;else delete hashes.tenant;
  for(const k of countKeys){const n=data.counts?.[k];if(n===null||numeric(n))counts[k]=n;}
  if(s.dropped)counts.droppedEvents=s.dropped;
  clean.hashes=hashes;clean.counts=counts;
  if(['en','ko'].includes(data.locale!))clean.locale=data.locale;
  if(['gpt-6-luna','gpt-6.1-sol','deepseek-flash'].includes(data.model!))clean.model=data.model;
  if(['medium','high'].includes(data.effort!))clean.effort=data.effort;
  if(['purpose','locate','assess','check'].includes(data.purposeStage!))clean.purposeStage=data.purposeStage;
  if(['continue','selected','budget','unresolved','available','unavailable','rejected','metadata_only','complete','partial','unknown'].includes(data.reason!))clean.reason=data.reason;
  if(typeof data.reportCreatedAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(data.reportCreatedAt)&&Number.isFinite(Date.parse(data.reportCreatedAt)))clean.reportCreatedAt=data.reportCreatedAt;
  if(typeof data.usageKnown==='boolean')clean.usageKnown=data.usageKnown;
  if(data.failure){
   const f=data.failure;const code=purposeFailureDiagnostic(new Error(typeof f.code==='string'?f.code:'unknown')).code;
   if(f.counts)for(const k of countKeys){const n=(f.counts as Record<string,unknown>)[k];if(numeric(n))counts[k]=n;}
   clean.failure={code,...(['runtime','purpose','locate','assess','check'].includes(f.stage)?{stage:f.stage}:{}),...(['setup','schema','count','budget','transport','usage','parse','validation','source','freshness','projection'].includes(f.phase)?{phase:f.phase}:{}),providerHTTPStatus:Number.isInteger(f.providerHTTPStatus)&&f.providerHTTPStatus!>=100&&f.providerHTTPStatus!<=599?f.providerHTTPStatus:null};
  }
  if(Array.isArray(data.parts)){
   counts.droppedParts=Math.max(0,data.parts.length-96);
   counts.droppedRefs=data.parts.slice(0,96).reduce((sum,p)=>sum+['conditions','exceptions','refs','counterRefs'].reduce((n,k)=>n+Math.max(0,((p as any)[k]?.length??0)-64),0),0);
   clean.parts=data.parts.slice(0,96).filter(p=>hash(p.idHash)).map(p=>{
    const part:Record<string,unknown>={idHash:p.idHash};
    for(const k of ['textHash','changeHash','testHash','contentHash','pathHash','revisionHash'] as const)if(hash(p[k]))part[k]=p[k];
    for(const k of ['conditions','exceptions','refs','counterRefs'] as const)if(Array.isArray(p[k]))part[k]=p[k]!.slice(0,64).filter(hash);
    for(const k of ['startLine','endLine','bytes'] as const)if(numeric(p[k]))part[k]=p[k];
    return part;
   });
  }
  const line=JSON.stringify(clean),bytes=Buffer.byteLength(line);
  if(s.bytes+bytes>220_000&&stage!=='response'){s.dropped++;return;}
  s.bytes+=bytes;console.info('agentproof_analysis_diagnostic',line);
 }catch{/* Observability must not affect admission, analysis, storage or response delivery. */}
}
export async function withAnalysisDiagnostics(request:Request,work:()=>Promise<Response>):Promise<Response>{
 if(process.env.AGENTPROOF_ANALYSIS_DIAGNOSTICS!=='1')return work();
 const client=request.headers.get('x-agentproof-analysis-key');
 const correlation=typeof client==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(client)?client:randomUUID();
 return scope.run({correlation,start:performance.now(),sequence:0,dropped:0,calls:0,terminal:false,bytes:0},async()=>{
  const correlation=scope.getStore()!.correlation;
  const aborted=AsyncLocalStorage.bind(()=>analysisDiagnostic('request','abort'));
  request.signal.addEventListener('abort',aborted,{once:true});
  analysisDiagnostic('request','start',()=>({hashes:{client:analysisHash(client),request:analysisHash(request.headers.get('x-vercel-id')??null)}}));
  try {
   const response=await work();
   // This records a response object return, never network commit/client receipt.
   analysisDiagnostic('response','success',()=>({counts:{status:response.status}}));
   try{response.headers.set('x-agentproof-diagnostic-request',correlation);}catch{/* Immutable responses stay intact. */}
   return response;
  }catch(error){analysisDiagnostic('request',request.signal.aborted?'abort':'failure',()=>({failure:purposeFailureDiagnostic(error)}));throw error;}
  finally{request.signal.removeEventListener('abort',aborted);}
 });
}
