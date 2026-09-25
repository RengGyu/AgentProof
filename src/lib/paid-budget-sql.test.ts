import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

// Optional local PostgreSQL WASM engine; never connects to the configured service DB.
// Set AGENTPROOF_TEST_PGLITE_MODULE to an installed PGlite ESM entrypoint.
const modulePath=process.env.AGENTPROOF_TEST_PGLITE_MODULE;
const config={timeZone:'Asia/Seoul',krwPerUsd:'1000',validUntil:'2099-01-01T00:00:00Z',prices:{}};
type DB={exec:(sql:string)=>Promise<unknown>;query:(sql:string,args?:unknown[])=>Promise<{rows:Record<string,any>[]}>;close:()=>Promise<void>};
let db:DB;
const key=(value:string)=>createHash('sha256').update(value).digest('hex');
const owner=randomUUID();
const call=async(action:string,run:string|null=null,id:string|null=null,reserve:number|null=null,charge:number|null=null,who=owner)=>{
 const result=await db.query('select public.agentproof_paid_budget($1,$2,$3,$4,$5,$6,$7) as result',[action,run?key(run):null,who,id,reserve,charge,config]);
 return result.rows[0].result;
};

describe.skipIf(!modulePath)('durable paid budget SQL',()=>{
 beforeAll(async()=>{
  const {PGlite}=await import(/* @vite-ignore */ modulePath!);
  db=new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(readFileSync('supabase/migrations/202609220001_paid_analysis_budget.sql','utf8'));
 });
 beforeEach(async()=>{
  await db.exec('truncate public.agentproof_paid_budget_calls,public.agentproof_paid_budget_runs,public.agentproof_paid_budget_months;');
  await db.query('update public.agentproof_paid_budget_settings set config=$1,paused=false',[config]);
 });
 afterAll(async()=>db?.close());
 it('admits below 30,000, blocks at/after it, but allows an existing run to finish',async()=>{
  const first=randomUUID();
  expect((await call('reserve','old',first,29_000_000)).allowed).toBe(true);
  expect((await call('reserve','new',randomUUID(),1_000_000)).allowed).toBe(true);
  expect(await call('reserve','blocked',randomUUID(),1)).toMatchObject({allowed:false,reason:'soft_stop',reservedMilliKrw:30_000_000});
  expect((await call('reserve','old',randomUUID(),1_000_000)).allowed).toBe(true);
  expect((await call('settle','old',first,null,29_000_000)).allowed).toBe(true);
  expect((await call('close','old')).allowed).toBe(true);
 });
 it('does not let two concurrent admissions spend the same remaining budget',async()=>{
  await call('reserve','seed',randomUUID(),29_000_000);
  const results=await Promise.all(['a','b'].map(run=>call('reserve',run,randomUUID(),1_000_000)));
  expect(results.filter(r=>r.allowed)).toHaveLength(1);
 });
 it('rejects duplicate owners, duplicate call IDs, and replay of a closed run',async()=>{
  const id=randomUUID();await call('reserve','same',id,1000);
  expect((await call('reserve','same',randomUUID(),1000,null,randomUUID())).reason).toBe('duplicate');
  expect((await call('reserve','same',id,1000)).reason).toBe('duplicate');
  await call('close','same');
  expect((await call('reserve','same',randomUUID(),1000)).reason).toBe('duplicate');
 });
 it('latches a 50,000 pause on settlement and blocks existing calls and retries',async()=>{
  const id=randomUUID();await call('reserve','active',id,1000);
  await call('settle','active',id,null,50_000_000);
  expect((await call('check','active',id)).reason).toBe('hard_pause');
  expect((await call('reserve','active',randomUUID(),1000)).reason).toBe('hard_pause');
  expect((await call('reserve','new',randomUUID(),1000)).reason).toBe('hard_pause');
 });
 it('retains unknown/pending reservations and settles known usage only once',async()=>{
  const unknown=randomUUID(),known=randomUUID();
  await call('reserve','a',unknown,20_000_000);await call('settle','a',unknown);
  await call('settle','a',unknown,null,0);
  await call('reserve','a',known,1000);await call('settle','a',known,null,500);
  await call('settle','a',known,null,100);
  const rows=(await db.query('select state,charged_milli_krw,reserved_milli_krw from public.agentproof_paid_budget_calls order by reserved_milli_krw desc')).rows;
  expect(rows).toEqual([{state:'unknown',charged_milli_krw:null,reserved_milli_krw:20_000_000},{state:'known',charged_milli_krw:500,reserved_milli_krw:1000}]);
 });
 it('fails closed for missing config and immutable calendar changes',async()=>{
  await db.exec('update public.agentproof_paid_budget_settings set config=null');
  expect((await call('config')).allowed).toBe(false);
  await db.query('update public.agentproof_paid_budget_settings set config=$1',[config]);
  await call('reserve','a',randomUUID(),1000);
  await db.query('update public.agentproof_paid_budget_settings set config=$1',[{...config,timeZone:'UTC'}]);
  expect((await call('config')).allowed).toBe(false);
 });
 it('uses the configured calendar and rechecks admission for a run crossing a month',async()=>{
  const id=randomUUID();await call('reserve','old',id,29_000_000);
  const expected=(await db.query("select to_char(clock_timestamp() at time zone 'Asia/Seoul','YYYY-MM') as month")).rows[0].month;
  expect((await db.query('select period from public.agentproof_paid_budget_calls')).rows[0].period).toBe(expected);
  await db.exec("update public.agentproof_paid_budget_runs set period='2000-01'");
  expect((await call('reserve','old',randomUUID(),2_000_000)).reason).toBe('soft_stop');
 });
 it('prevents unauthenticated roles from calling the money RPC or reading ledger rows',async()=>{
  await db.exec('set role anon');
  await expect(db.query("select public.agentproof_paid_budget('config')")).rejects.toThrow();
  await expect(db.query('select * from public.agentproof_paid_budget_calls')).rejects.toThrow();
  await db.exec('reset role');
 });
});
