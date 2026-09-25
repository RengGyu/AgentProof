import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { getControlPlaneSupabaseEnv } from './control-plane-supabase';

export class PaidBudgetError extends Error {
  constructor(public readonly code: string) { super('Paid analysis is paused or its budget could not be verified. Existing reports remain available.'); this.name='PaidBudgetError'; }
}
export interface PaidUsage { input: number; output: number }
interface Price { inputUsdPerMillion: string; outputUsdPerMillion: string; callReserveKrw: string; source: string }
interface BudgetConfig { timeZone: string; krwPerUsd: string; validUntil: string; prices: Record<string, Price> }
interface Scope { key: string; owner: string; config?: BudgetConfig; failure?: PaidBudgetError; started: boolean; closed: boolean }
const scopes = new AsyncLocalStorage<Scope>();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const CALL_TIMEOUT_MS=60_000;
const PAUSE_POLL_MS=1_000;

/** Stop fallback orchestration before it saves or publishes a blocked analysis. */
export function assertPaidAnalysisAllowed():void {
  const failure=scopes.getStore()?.failure;
  if(failure)throw failure;
}

/** Scope carries no prompt or credential to the durable ledger. Admission is lazy. */
export async function withPaidAnalysis<T>(key: string, work: () => Promise<T>): Promise<T> {
  const scope: Scope={key:hash(key),owner:randomUUID(),started:false,closed:false};
  return scopes.run(scope, async()=>{
    try {
      const result=await work();
      if(scope.failure)throw scope.failure;
      return result;
    } catch (error) {
      // Provider adapters may wrap errors; retain the authoritative budget denial.
      throw scope.failure ?? error;
    } finally {
      scope.closed=true;
      if(scope.started)await rpc({p_action:'close',p_run:scope.key,p_owner:scope.owner});
    }
  });
}

async function rpc(body: Record<string,unknown>): Promise<Record<string,unknown>> {
  const config=getControlPlaneSupabaseEnv();
  if(!config.url || !config.serviceRoleKey)throw new PaidBudgetError('budget_store_unconfigured');
  try {
    const response=await fetch(`${config.url.replace(/\/$/,'')}/rest/v1/rpc/agentproof_paid_budget`,{
      method:'POST',headers:{'Content-Type':'application/json',apikey:config.serviceRoleKey,Authorization:`Bearer ${config.serviceRoleKey}`},
      body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(5000)
    });
    const result=await response.json();
    if(!response.ok || !result || typeof result!=='object' || typeof result.allowed!=='boolean')throw new Error();
    if(!result.allowed)throw new PaidBudgetError(['soft_stop','hard_pause','duplicate','unsupported_background'].includes(result.reason)?result.reason:'budget_unavailable');
    return result;
  } catch(error) {
    if(error instanceof PaidBudgetError)throw error;
    throw new PaidBudgetError('budget_store_unavailable');
  }
}

function decimal(value:unknown,scale:number):bigint {
  if(typeof value!=='string' || !/^\d{1,9}(\.\d{1,6})?$/.test(value))throw new PaidBudgetError('budget_price_invalid');
  const [whole,fraction='']=value.split('.');
  if(fraction.length>scale)throw new PaidBudgetError('budget_price_invalid');
  return BigInt(whole)*10n**BigInt(scale)+BigInt(fraction.padEnd(scale,'0'));
}
function safeNumber(value:bigint):number {
  if(value<0n || value>BigInt(Number.MAX_SAFE_INTEGER))throw new PaidBudgetError('budget_amount_invalid');
  return Number(value);
}
function ceilDivide(value:bigint,divisor:bigint):bigint { return (value+divisor-1n)/divisor; }
export function calculateUsageMilliKrw(usage:PaidUsage,price:Price,fx:string):number {
  const input=decimal(price.inputUsdPerMillion,6), output=decimal(price.outputUsdPerMillion,6);
  return safeNumber(ceilDivide((BigInt(usage.input)*input+BigInt(usage.output)*output)*decimal(fx,3),1_000_000_000_000n));
}
function token(value:unknown):value is number { return typeof value==='number' && Number.isSafeInteger(value) && value>=0; }
/** Gemini total already includes thoughts; OpenAI output already includes reasoning. */
export function normalizePaidUsage(provider:'google'|'openai',raw:unknown):PaidUsage|null {
  if(!raw || typeof raw!=='object')return null;
  const u=raw as Record<string,unknown>;
  if(provider==='openai')return token(u.input_tokens)&&token(u.output_tokens)?{input:u.input_tokens,output:u.output_tokens}:null;
  if(!token(u.promptTokenCount)||!token(u.candidatesTokenCount)||!token(u.totalTokenCount))return null;
  const output=u.totalTokenCount-u.promptTokenCount;
  if(output<u.candidatesTokenCount || (u.thoughtsTokenCount!==undefined && (!token(u.thoughtsTokenCount)||output!==u.candidatesTokenCount+u.thoughtsTokenCount)) || (u.toolUsePromptTokenCount!==undefined && u.toolUsePromptTokenCount!==0))return null;
  return {input:u.promptTokenCount,output};
}
function validateConfig(raw:unknown):BudgetConfig {
  if(!raw || typeof raw!=='object')throw new PaidBudgetError('budget_unconfigured');
  const c=raw as BudgetConfig;
  if(typeof c.timeZone!=='string'||typeof c.validUntil!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(c.validUntil)||!Number.isFinite(Date.parse(c.validUntil))||Date.parse(c.validUntil)<=Date.now()||!c.prices||typeof c.prices!=='object')throw new PaidBudgetError('budget_unconfigured');
  try { new Intl.DateTimeFormat('en',{timeZone:c.timeZone}); } catch { throw new PaidBudgetError('budget_period_invalid'); }
  if(decimal(c.krwPerUsd,3)<=0n)throw new PaidBudgetError('budget_fx_invalid');
  return c;
}

export async function paidProviderCall<T>(options:{provider:'google'|'openai';model:string;invoke:(signal:AbortSignal)=>Promise<T>;usage:(result:T)=>PaidUsage|null}):Promise<T> {
  const scope=scopes.getStore();
  if(!scope || scope.closed)throw new PaidBudgetError('budget_scope_required');
  if(scope.failure)throw scope.failure;
  let price:Price;
  const callId=randomUUID();
  try {
    scope.config ??= validateConfig((await rpc({p_action:'config'})).config);
    price=scope.config.prices[`${options.provider}/${options.model}`];
    if(!price || typeof price.source!=='string' || !price.source.startsWith('https://'))throw new PaidBudgetError('budget_price_unconfigured');
    if(decimal(price.inputUsdPerMillion,6)<=0n||decimal(price.outputUsdPerMillion,6)<=0n)throw new PaidBudgetError('budget_price_invalid');
    const reserve=safeNumber(decimal(price.callReserveKrw,3));
    if(reserve<=0)throw new PaidBudgetError('budget_reserve_invalid');
    await rpc({p_action:'reserve',p_run:scope.key,p_owner:scope.owner,p_call:callId,p_reserve:reserve,p_config:scope.config});
    scope.started=true;
  } catch(error) {
    scope.failure=error instanceof PaidBudgetError?error:new PaidBudgetError('budget_unavailable');
    throw scope.failure;
  }
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  let done=false;
  const timeout=setTimeout(()=>controller.abort(new PaidBudgetError('budget_call_timeout')),CALL_TIMEOUT_MS);
  const poll=async()=>{
    try { await rpc({p_action:'check',p_run:scope.key,p_owner:scope.owner,p_call:callId}); }
    catch(error) { if(!done){scope.failure=error instanceof PaidBudgetError?error:new PaidBudgetError('budget_unavailable');controller.abort(scope.failure);} }
    if(!done&&!controller.signal.aborted)timer=setTimeout(poll,PAUSE_POLL_MS);
  };
  timer=setTimeout(poll,PAUSE_POLL_MS);
  let charge:number|null=null;
  try {
    const result=await Promise.race([
      options.invoke(controller.signal),
      new Promise<never>((_resolve,reject)=>controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true}))
    ]);
    const usage=options.usage(result);
    charge=usage?calculateUsageMilliKrw(usage,price,scope.config.krwPerUsd):null;
    return result;
  } finally {
    done=true;clearTimeout(timeout);if(timer)clearTimeout(timer);
    // Missing usage, cancellation and provider/network failure retain the reservation.
    // A failed settlement also leaves the durable pending reservation in place.
    try { await rpc({p_action:'settle',p_run:scope.key,p_owner:scope.owner,p_call:callId,p_charge:charge}); }
    catch(error) { scope.failure=error instanceof PaidBudgetError?error:new PaidBudgetError('budget_unavailable');throw scope.failure; }
  }
}

/** All OpenAI POSTs pass here; legacy background submissions fail closed. GETs do not create work. */
export async function budgetedOpenAIFetch(url:string,init:RequestInit,fetchFn:typeof fetch=fetch):Promise<Response> {
  if(init.method==='GET')return fetchFn(url,init);
  const body=JSON.parse(String(init.body));
  if(body.background){
    const error=new PaidBudgetError('unsupported_background');
    const scope=scopes.getStore();if(scope)scope.failure=error;
    throw error;
  }
  if(typeof body.model!=='string')throw new PaidBudgetError('budget_price_unconfigured');
  return paidProviderCall({provider:'openai',model:body.model,
    invoke:async signal=>{
      const response=await fetchFn(url,{...init,signal:init.signal?AbortSignal.any([signal,init.signal]):signal});
      // Read within the guarded lifetime; a stalled response body is cancellable too.
      const payload=await response.text();
      return {response:new Response(payload,{status:response.status,headers:response.headers}),payload};
    },
    usage:result=>{
      if(!result.response.ok)return null;
      try { return normalizePaidUsage('openai',JSON.parse(result.payload).usage); } catch { return null; }
    }
  }).then(result=>result.response);
}
