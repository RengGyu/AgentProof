import {AsyncLocalStorage} from 'node:async_hooks';
import {purposeFailureDiagnostic} from './purpose-failure';

/** Closed private timing summary only; independent of the verbose diagnostics flags. */
export interface LocateTimingAnchor {requestCorrelation?:string|null;repositoryHash?:string;pullRequestNumber?:number}
const operations=['authorization','private_grant','repository_visibility','request_prepare','budget_reserve','budget_settle','provider_transport','provider_body','provider_parse','source_read','round_invoke'] as const;
type Operation=typeof operations[number];
type Interval=[number,number];
type Failure={code:string;timeoutOrigin?:string;timeoutMs?:number};
type Metric={round:number;operation:Operation;startMs:number;endMs:number|null;completed:number;failed:number;inclusiveMs:number;exclusiveMs:number;failure?:Failure};
type Span={round:number;operation:Operation;start:number;parent?:Span;children:Interval[]};
type Trace={start:number;round:number;metrics:Map<string,Metric>;active:Set<Span>;covered:Interval[];closed:boolean;unknownOperations:number;anchor:LocateTimingAnchor};
const scope=new AsyncLocalStorage<{trace:Trace;parent?:Span}>();
const elapsed=(start:number,end=performance.now())=>Math.max(0,end-start);
const ms=(n:number)=>Math.round(Math.max(0,Number.isFinite(n)?n:0));
const failure=(error:unknown):Failure=>{const f=purposeFailureDiagnostic(error);return {code:f.code,...(f.timeoutOrigin?{timeoutOrigin:f.timeoutOrigin}:{}),...('timeoutMs' in f?{timeoutMs:f.timeoutMs}: {})};};
function merge(intervals:Interval[]):Interval[]{const out:Interval[]=[];for(const [a,b] of intervals.sort((x,y)=>x[0]-y[0])){const last=out.at(-1);if(last&&a<=last[1])last[1]=Math.max(last[1],b);else out.push([a,b]);}return out;}
function length(intervals:Interval[],start:number,end:number){return merge(intervals.map(([a,b])=>[Math.max(a,start),Math.min(b,end)] as Interval).filter(([a,b])=>b>a)).reduce((n,[a,b])=>n+b-a,0);}
function exclusive(t:Trace,s:Span,end:number){return Math.max(0,elapsed(s.start,end)-length([...s.children,...[...t.active].filter(c=>c.parent===s).map(c=>[c.start,end] as Interval)],s.start,end));}
function begin(operation:Operation){
 const ctx=scope.getStore();if(!ctx||ctx.trace.closed)return null;
 if(!operations.includes(operation)){ctx.trace.unknownOperations++;return null;}
 const span:Span={round:ctx.trace.round,operation,start:performance.now(),parent:ctx.parent,children:[]};
 ctx.trace.active.add(span);return {trace:ctx.trace,span};
}
function end(t:Trace,s:Span,error?:unknown,failed=false){
 try{const now=performance.now();if(!t.closed){
  const key=s.round+':'+s.operation;let m=t.metrics.get(key);
  if(!m){m={round:s.round,operation:s.operation,startMs:elapsed(t.start,s.start),endMs:null,completed:0,failed:0,inclusiveMs:0,exclusiveMs:0};t.metrics.set(key,m);}
  m.startMs=Math.min(m.startMs,elapsed(t.start,s.start));m.endMs=Math.max(m.endMs??0,elapsed(t.start,now));m.inclusiveMs+=elapsed(s.start,now);m.exclusiveMs+=exclusive(t,s,now);
  if(failed){m.failed++;m.failure=failure(error);}else m.completed++;
  if(s.parent)s.parent.children=merge([...s.parent.children,[s.start,now]]);else t.covered=merge([...t.covered,[s.start,now]]);
 }}catch{/* Timing must never affect the operation. */}finally{t.active.delete(s);}
}
/** Sync preparation/parsing stays synchronous. */
export function timeLocateSync<T>(operation:Operation,work:()=>T):T{
 const b=begin(operation);if(!b)return work();
 return scope.run({trace:b.trace,parent:b.span},()=>{try{const value=work();end(b.trace,b.span);return value;}catch(error){end(b.trace,b.span,error,true);throw error;}});
}
export async function timeLocate<T>(operation:Operation,work:()=>Promise<T>):Promise<T>{
 const b=begin(operation);if(!b)return work();
 return scope.run({trace:b.trace,parent:b.span},async()=>{try{const value=await work();end(b.trace,b.span);return value;}catch(error){end(b.trace,b.span,error,true);throw error;}});
}
/** Current product rounds are sequential; spans retain their start round across later changes. */
export function setLocateTimingRound(round:number){const s=scope.getStore();if(s&&Number.isInteger(round)&&round>=0&&round<4)s.trace.round=round;}
function emit(t:Trace,outcome:'success'|'failure'|'abort',error?:unknown){
 if(t.closed)return;t.closed=true;
 try{
  const now=performance.now(),metrics=[...t.metrics.values()].map(m=>({...m}));
  for(const s of t.active){let m=metrics.find(m=>m.round===s.round&&m.operation===s.operation) as (Metric&{pending?:number;pendingElapsedMs?:number})|undefined;
   if(!m){m={round:s.round,operation:s.operation,startMs:elapsed(t.start,s.start),endMs:null,completed:0,failed:0,inclusiveMs:0,exclusiveMs:0};metrics.push(m);}
   m.startMs=Math.min(m.startMs,elapsed(t.start,s.start));m.pending=(m.pending??0)+1;m.pendingElapsedMs=(m.pendingElapsedMs??0)+elapsed(s.start,now);
   m.inclusiveMs+=elapsed(s.start,now);m.exclusiveMs+=exclusive(t,s,now);
  }
  const clean=metrics.sort((a,b)=>a.round-b.round||a.startMs-b.startMs).map(m=>({...m,startMs:ms(m.startMs),endMs:m.endMs===null?null:ms(m.endMs),inclusiveMs:ms(m.inclusiveMs),exclusiveMs:ms(m.exclusiveMs),...('pendingElapsedMs' in m?{pendingElapsedMs:ms(m.pendingElapsedMs as number)}:{})}));
  const covered=length([...t.covered,...[...t.active].filter(s=>!s.parent).map(s=>[s.start,now] as Interval)],t.start,now);
  console.info('agentproof_locate_timing',JSON.stringify({version:1,...t.anchor,outcome,totalMs:ms(elapsed(t.start,now)),budgetMs:90000,remainingMs:ms(Math.max(0,90000-elapsed(t.start,now))),unmeasuredMs:ms(Math.max(0,elapsed(t.start,now)-covered)),unknownOperations:t.unknownOperations,semantics:'inclusive_nested_overlap;exclusive_direct_child_union',operations:clean,...(outcome==='success'?{}:{failure:failure(error)})}));
 }catch{/* Private telemetry is best effort, including a failing log sink. */}
}
export async function withLocateTimings<T>(anchor:LocateTimingAnchor|undefined,signal:AbortSignal,work:()=>Promise<T>):Promise<T>{
 const correlation=purposeFailureDiagnostic(null,anchor?.requestCorrelation).requestCorrelation;
 const safe:LocateTimingAnchor={requestCorrelation:correlation,...(/^[a-f0-9]{64}$/.test(anchor?.repositoryHash??'')?{repositoryHash:anchor!.repositoryHash}:{}),...(Number.isSafeInteger(anchor?.pullRequestNumber)&&anchor!.pullRequestNumber!>0?{pullRequestNumber:anchor!.pullRequestNumber}:{})};
 const trace:Trace={start:performance.now(),round:-1,metrics:new Map(),active:new Set(),covered:[],closed:false,unknownOperations:0,anchor:safe};
 return scope.run({trace},async()=>{
  const aborted=()=>emit(trace,'abort',signal.reason);signal.addEventListener('abort',aborted,{once:true});
  if(signal.aborted)aborted();
  try{const value=await work();emit(trace,'success');return value;}catch(error){emit(trace,'failure',error);throw error;}finally{signal.removeEventListener('abort',aborted);}
 });
}
