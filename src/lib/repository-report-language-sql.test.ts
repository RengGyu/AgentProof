import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const modulePath=process.env.AGENTPROOF_TEST_PGLITE_MODULE;
type DB={exec(sql:string):Promise<unknown>;query(sql:string,args?:unknown[]):Promise<{rows:Record<string,any>[]}>;close():Promise<void>};
let db:DB;
const migration=()=>readFileSync('supabase/migrations/202610150001_repository_report_language.sql','utf8');
describe.skipIf(!modulePath)('repository report language SQL compatibility',()=>{
 beforeAll(async()=>{
  const {PGlite}=await import(/* @vite-ignore */ modulePath!);db=new PGlite();
  await db.exec('create role anon;create role authenticated;create role service_role;');
  await db.exec(readFileSync('supabase/migrations/202607120001_github_installation_single_tenant.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/202607140001_concierge_private_beta.sql','utf8').split('-- Concierge registration')[0]);
  await db.exec(readFileSync('supabase/migrations/202608070001_repository_llm_analysis_mode.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/202608120001_hybrid_planner_pilot.sql','utf8').split('-- This RPC serializes')[0]);
  await db.exec(readFileSync('supabase/migrations/202609240002_private_analysis_consent.sql','utf8'));
  await db.exec("insert into agentproof_tenants(tenant_id,name,status,plan) values('one','One','active','beta');insert into agentproof_github_installations(tenant_id,installation_id,status,created_at,updated_at) values('one',42,'active',now(),now());insert into agentproof_tenant_repository_grants(tenant_id,installation_id,repository_id,repository_full_name,enabled,analysis_enabled,save_reports_enabled,repository_is_private,private_analysis_consent_version,llm_analysis_mode) values('one',42,9,'owner/repo',true,true,true,true,'2026-09-24.v1','essential');create table fixture_reports(payload jsonb);create table fixture_jobs(payload jsonb);insert into fixture_reports values('{\"saved\":true}');insert into fixture_jobs values('{\"failed\":true}');");
  await db.exec(migration());
 });
 afterAll(async()=>{await db?.close();});
 it('is replayable without changing grants, reports or jobs',async()=>{
  const before=await db.query('select row_to_json(g) row from agentproof_tenant_repository_grants g');
  await db.exec(migration());
  expect((await db.query('select row_to_json(g) row from agentproof_tenant_repository_grants g')).rows).toEqual(before.rows);
  expect((await db.query('select report_language from agentproof_tenant_repository_grants')).rows).toEqual([{report_language:'en'}]);
  expect((await db.query('select * from fixture_reports')).rows).toEqual([{payload:{saved:true}}]);expect((await db.query('select * from fixture_jobs')).rows).toEqual([{payload:{failed:true}}]);
 });
 it('accepts new language writes and legacy 11-argument calls without resetting language or consent',async()=>{
  const written=await db.query("select * from agentproof_update_tenant_repository_grant_settings('one',42,9,null,null,null,null,null,null,null,null,'ko')");
  expect(written.rows[0]).toMatchObject({report_language:'ko',private_analysis_consent_version:'2026-09-24.v1',analysis_enabled:true,save_reports_enabled:true});
  const legacy=await db.query("select * from agentproof_update_tenant_repository_grant_settings('one',42,9,null,null,true,null,null,null,null,null)");
  expect(legacy.rows[0]).toMatchObject({report_language:'ko',comment_enabled:true,private_analysis_consent_version:'2026-09-24.v1'});
 });
 it('rejects invalid language and missing repository while keeping prior settings',async()=>{
  await expect(db.query("select * from agentproof_update_tenant_repository_grant_settings('one',42,9,null,null,null,null,null,null,null,null,'ja')")).rejects.toThrow('report language is invalid');
  await expect(db.query("update agentproof_tenant_repository_grants set report_language='ja'")).rejects.toThrow();
  await expect(db.query("select * from agentproof_update_tenant_repository_grant_settings('other',42,9,null,null,null,null,null,null,null,null,'en')")).rejects.toThrow('not found');
  expect((await db.query('select report_language from agentproof_tenant_repository_grants')).rows).toEqual([{report_language:'ko'}]);
 });
 it('retains service-only execution, RLS and existing private consent disable semantics',async()=>{
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{await expect(db.query("select * from agentproof_update_tenant_repository_grant_settings('one',42,9)")).rejects.toThrow();}finally{await db.exec('reset role');}}
  await db.exec('set role service_role');try{const rows=await db.query("select * from agentproof_update_tenant_repository_grant_settings('one',42,9,null,null,null,null,null,null,null,false,'en')");expect(rows.rows[0]).toMatchObject({report_language:'en',private_analysis_consent_version:null,analysis_enabled:false});}finally{await db.exec('reset role');}
  expect((await db.query("select relrowsecurity from pg_class where oid='public.agentproof_tenant_repository_grants'::regclass")).rows[0].relrowsecurity).toBe(true);
 });
});
