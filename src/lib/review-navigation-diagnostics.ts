import { createHash } from 'crypto';
import { redactSecrets } from './redact';
import type { ReviewNavigationRequest } from './review-intent';

export interface NavigationTransportDiagnostics {
 provider:'google'|'openai'; modelVersion:string|null; inputTokens:number|null; outputTokens:number|null; thoughtTokens:number|null;
 finishReasons:string[]; latencyMs:number; outputBytes:number; outputHash:string|null;
}
const transports=new WeakMap<ReviewNavigationRequest,NavigationTransportDiagnostics>();
export const getNavigationTransportDiagnostics=(request:ReviewNavigationRequest)=>transports.get(request);
const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=100_000_000?v:null;
/** Store only bounded metadata; arbitrary provider text and keys never enter diagnostics. */
export function recordNavigationTransport(request:ReviewNavigationRequest,input:{provider:'google'|'openai';modelVersion?:unknown;inputTokens?:unknown;outputTokens?:unknown;thoughtTokens?:unknown;finishReasons?:unknown[];started:number;text?:string},onDiagnostics?:(data:NavigationTransportDiagnostics)=>void){
 const model=input.modelVersion;
 const data:NavigationTransportDiagnostics={provider:input.provider,modelVersion:typeof model==='string'&&model.length<=128&&/^(?:models\/)?(?:gemini-|gpt-|chatgpt-|o[134])[-\w./:]*$/.test(model)&&redactSecrets(model)===model?model:null,inputTokens:count(input.inputTokens),outputTokens:count(input.outputTokens),thoughtTokens:count(input.thoughtTokens),finishReasons:(input.finishReasons??[]).slice(0,4).map(v=>['STOP','MAX_TOKENS','SAFETY','RECITATION','OTHER','BLOCKLIST','PROHIBITED_CONTENT','SPII','MALFORMED_FUNCTION_CALL','completed','incomplete','failed'].includes(String(v))?String(v):'OTHER'),latencyMs:Math.max(0,Date.now()-input.started),outputBytes:Buffer.byteLength(input.text??''),outputHash:input.text?createHash('sha256').update(input.text).digest('hex'):null};
 transports.set(request,data);try{onDiagnostics?.(structuredClone(data));}catch{/* Diagnostics must not discard usable results. */}
 return data;
}
