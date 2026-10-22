/** Timer provenance is process-private and follows the original abort reason, never message text. */
export type PurposeTimeoutOrigin = 'analysis_deadline' | 'localization_deadline' | 'provider_timeout' | 'source_read_deadline' | 'source_manifest_deadline' | 'budget_call_timeout';
const origins=new Set(['analysis_deadline','localization_deadline','provider_timeout','source_read_deadline','source_manifest_deadline','budget_call_timeout']);
const reasons = new WeakMap<object,{timeoutOrigin:PurposeTimeoutOrigin;timeoutMs:number;timeoutElapsedMs:number}>();
export function recordPurposeTimeout<T extends Error>(error:T, origin:PurposeTimeoutOrigin, ms:number, started:number):T {
 if(!origins.has(origin)||!Number.isSafeInteger(ms)||ms<0||!Number.isFinite(started))return error;
 if(!reasons.has(error))reasons.set(error,{timeoutOrigin:origin,timeoutMs:ms,timeoutElapsedMs:Math.max(0,Math.round(performance.now()-started))});
 return error;
}
export function purposeTimeoutMetadata(error:unknown) {return error instanceof Error?reasons.get(error):undefined;}
export function purposeDeadline(ms:number,origin:PurposeTimeoutOrigin,parent?:AbortSignal) {
 const controller=new AbortController(),started=performance.now();
 const timer=setTimeout(()=>controller.abort(recordPurposeTimeout(new DOMException('','TimeoutError'),origin,ms,started)),ms);
 timer.unref?.();
 const signal=parent?AbortSignal.any([parent,controller.signal]):controller.signal;
 const dispose=()=>{clearTimeout(timer);signal.removeEventListener('abort',dispose);};
 if(signal.aborted)dispose();else signal.addEventListener('abort',dispose,{once:true});
 return {signal,dispose};
}
