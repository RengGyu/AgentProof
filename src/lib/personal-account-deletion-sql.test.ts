import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
const modulePath = process.env.AGENTPROOF_TEST_PGLITE_MODULE;
type DB = { exec(sql: string): Promise<unknown>; query(sql: string, args?: unknown[]): Promise<{ rows: Record<string, any>[] }>; close(): Promise<void> };
let db: DB;
const call = async (action = "delete", token = "a".repeat(64), source = "github") => (await db.query("select public.agentproof_delete_personal_account($1,$2,$3) as result", [token, source, action])).rows[0].result;
describe.skipIf(!modulePath)("personal account deletion database boundary", () => {
  beforeAll(async () => {
    const { PGlite } = await import(/* @vite-ignore */ modulePath!);
    db = new PGlite();
    await db.exec("create role anon; create role authenticated; create role service_role;");
    await db.exec(readFileSync("supabase/migrations/202608030001_public_github_oauth_beta.sql", "utf8"));
    await db.exec(readFileSync("supabase/migrations/202607160001_tenant_deletion_state.sql", "utf8"));
    await db.exec(`alter table agentproof_tenant_auth_sessions add column auth_source text default 'github', add column github_access_ciphertext text, add column github_refresh_ciphertext text;
      create table agentproof_saved_reports(id text primary key,tenant_id text,report jsonb);
      create table agentproof_analysis_jobs(id text primary key,tenant_id text,status text,locked_at timestamptz,updated_at timestamptz,created_at timestamptz,provider_expires_at timestamptz);
      create table agentproof_github_installations(tenant_id text,installation_id bigint,primary key(tenant_id,installation_id));
      create table agentproof_concierge_github_sessions(token_hash text primary key,tenant_id text,member_id text,installation_id bigint,
        foreign key(tenant_id,installation_id) references agentproof_github_installations,
        foreign key(tenant_id,member_id) references agentproof_tenant_members);
      create table agentproof_tenant_repository_grants(tenant_id text,installation_id bigint,foreign key(tenant_id,installation_id) references agentproof_github_installations);
      create table agentproof_mobile_handoff_codes(tenant_id text,member_id text);
      create table agentproof_billing_subscriptions(tenant_id text);
      create table agentproof_billing_webhook_events(tenant_id text);
      create table agentproof_concierge_feedback(tenant_id text);
      create table agentproof_concierge_analysis_runs(tenant_id text);
      create table agentproof_github_installation_claims(tenant_id text);
      create table agentproof_github_onboarding_states(tenant_id text);
      create table agentproof_github_webhook_deliveries(tenant_id text);`);
    await db.exec(readFileSync("supabase/migrations/202609220001_paid_analysis_budget.sql", "utf8"));
    await db.exec(readFileSync("supabase/migrations/202609300001_self_service_account_deletion.sql", "utf8"));
  });
  beforeEach(async () => {
    await db.exec(`truncate agentproof_personal_deletion_receipts,agentproof_paid_budget_calls,agentproof_paid_budget_runs,agentproof_tenant_deletion_state,agentproof_tenants cascade;
      truncate agentproof_saved_reports,agentproof_analysis_jobs,agentproof_github_installations,agentproof_tenant_repository_grants,agentproof_mobile_handoff_codes,agentproof_usage_records,agentproof_audit_events,agentproof_billing_subscriptions,agentproof_billing_webhook_events cascade;
      insert into agentproof_tenants(tenant_id,name,status,plan) values ('gh_123','Personal','active','beta'),('gh_456','Other','active','beta');
      insert into agentproof_tenant_members values ('gh_123','github:123','owner','active',now()),('gh_456','github:456','owner','active',now());
      insert into agentproof_github_identities values ('123','gh_123','github:123',now()),('456','gh_456','github:456',now());
      insert into agentproof_tenant_auth_sessions(id,token_hash,tenant_id,member_id,created_at,expires_at,auth_source) values ('session1',repeat('a',64),'gh_123','github:123',now(),now()+interval '1 day','github');
      insert into agentproof_saved_reports values ('report1','gh_123','{}'),('report2','gh_456','{}');
      insert into agentproof_github_installations values ('gh_123',123),('gh_456',456);
      insert into agentproof_concierge_github_sessions values (repeat('d',64),'gh_123','github:123',123);
      insert into agentproof_tenant_repository_grants values ('gh_123',123),('gh_456',456);
      insert into agentproof_usage_records(id,tenant_id,period,feature,idempotency_key_hash,created_at)
        values ('usage1','gh_123','2026-09','github_app_analysis',repeat('e',64),now());
      insert into agentproof_audit_events(id,created_at,actor,action,result,tenant_id)
        values ('audit1',now(),'system','test','completed','gh_123');
      insert into agentproof_mobile_handoff_codes values ('gh_123','github:123');`);
  });
  afterAll(async () => db?.close());
  it("purges live personal data and identity/session mappings, preserving another account", async () => {
    expect(await call("status")).toMatchObject({ status: "ready" });
    expect(await call()).toMatchObject({ status: "completed" });
    for (const table of ["tenants", "tenant_members", "github_identities", "tenant_auth_sessions", "saved_reports", "github_installations", "concierge_github_sessions", "tenant_repository_grants", "usage_records", "audit_events", "mobile_handoff_codes", "tenant_deletion_state"]) {
      expect((await db.query(`select count(*)::int as n from agentproof_${table} where tenant_id='gh_123'`)).rows[0].n).toBe(0);
    }
    expect((await db.query("select count(*)::int as n from agentproof_saved_reports where tenant_id='gh_456'")).rows[0].n).toBe(1);
    expect(await call()).toMatchObject({ status: "completed" });
    await expect(db.exec("insert into agentproof_saved_reports values ('late','gh_123','{}')")).rejects.toThrow();
  });
  it("rejects unauthorized, wrong-source and shared-workspace deletion", async () => {
    expect(await call("delete", "z".repeat(64))).toMatchObject({ status: "unauthorized" });
    expect(await call("delete", "a".repeat(64), "mobile")).toMatchObject({ status: "unauthorized" });
    await db.exec("insert into agentproof_tenant_members values ('gh_123','other_member','member','disabled',now())");
    expect(await call()).toMatchObject({ status: "shared_workspace" });
    expect((await db.query("select status from agentproof_tenants where tenant_id='gh_123'")).rows[0].status).toBe("active");
  });
  it("blocks writes and old-session data access while an in-flight job drains, then retries automatically", async () => {
    await db.exec("insert into agentproof_analysis_jobs values ('job','gh_123','processing',now(),now(),now(),null)");
    expect(await call()).toMatchObject({ status: "pending" });
    expect((await db.query("select status from agentproof_tenants where tenant_id='gh_123'")).rows[0].status).toBe("suspended");
    await expect(db.exec("insert into agentproof_saved_reports values ('late','gh_123','{}')")).rejects.toThrow();
    await expect(db.exec("insert into agentproof_tenant_members values ('gh_123','late','member','active',now())")).rejects.toThrow();
    await expect(db.exec("update agentproof_tenants set status='active' where tenant_id='gh_123'")).rejects.toThrow();
    await db.exec("insert into agentproof_tenant_auth_sessions(id,token_hash,tenant_id,member_id,created_at,expires_at,auth_source) values ('resume',repeat('b',64),'gh_123','github:123',now(),now()+interval '1 day','mobile')");
    expect(await call("status", "b".repeat(64), "mobile")).toMatchObject({ status: "pending" });
    await db.exec("delete from agentproof_analysis_jobs where id='job'");
    await db.query("select public.agentproof_continue_personal_deletions()");
    expect(await call()).toMatchObject({ status: "completed" });
  });
  it("rolls back all purges on a store failure and succeeds on retry without operator deletion", async () => {
    await db.exec("create table deletion_test_dependency(report_id text references agentproof_saved_reports(id)); insert into deletion_test_dependency values ('report1')");
    expect(await call()).toMatchObject({ status: "pending", reason: "retry_required" });
    expect((await db.query("select count(*)::int as n from agentproof_tenant_repository_grants where tenant_id='gh_123'")).rows[0].n).toBe(1);
    await db.exec("drop table deletion_test_dependency");
    expect(await call()).toMatchObject({ status: "completed" });
  });
  it("re-login creates a fresh account and never returns removed report data", async () => {
    expect(await call()).toMatchObject({ status: "completed" });
    const a = (await db.query("select * from public.agentproof_github_personal_account('123')")).rows[0];
    const b = (await db.query("select * from public.agentproof_github_personal_account('123')")).rows[0];
    expect(a.tenant_id).not.toBe("gh_123");
    expect(b.tenant_id).toBe(a.tenant_id);
    expect((await db.query("select count(*)::int as n from agentproof_saved_reports where tenant_id=$1", [a.tenant_id])).rows[0].n).toBe(0);
  });
  it("refuses unknown tenant stores, disabled write guards, and missing stores without starting deletion", async () => {
    await db.exec("create table agentproof_unhandled(tenant_id text)");
    expect(await call()).toMatchObject({ status: "unavailable" });
    await db.exec("drop table agentproof_unhandled; alter table agentproof_saved_reports disable trigger agentproof_personal_write_guard");
    expect(await call()).toMatchObject({ status: "unavailable" });
    await db.exec("alter table agentproof_saved_reports enable trigger agentproof_personal_write_guard; alter table agentproof_concierge_feedback rename to missing_feedback");
    expect(await call()).toMatchObject({ status: "unavailable" });
    await db.exec("alter table missing_feedback rename to agentproof_concierge_feedback");
    expect((await db.query("select status from agentproof_tenants where tenant_id='gh_123'")).rows[0].status).toBe("active");
  });
  it("expires receipts and bounds the unlinked cost ledger while preserving recent spend", async () => {
    expect(await call()).toMatchObject({ status: "completed" });
    await db.exec(`update agentproof_personal_deletion_receipts set expires_at=now()-interval '1 hour';
      insert into agentproof_paid_budget_months(period,time_zone) values ('old','UTC'),('recent','UTC') on conflict do nothing;
      insert into agentproof_paid_budget_runs(run_key,owner_id,period,config,created_at) values ('old','00000000-0000-0000-0000-000000000001','old','{}',now()-interval '91 days'),('recent','00000000-0000-0000-0000-000000000002','recent','{}',now());
      insert into agentproof_paid_budget_calls(call_id,run_key,period,reserved_milli_krw,created_at) values ('00000000-0000-0000-0000-000000000001','old','old',10,now()-interval '91 days'),('00000000-0000-0000-0000-000000000002','recent','recent',10,now());`);
    expect(await call()).toMatchObject({ status: "unauthorized" });
    await db.query("select agentproof_continue_personal_deletions()");
    expect((await db.query("select count(*)::int n from agentproof_personal_deletion_receipts")).rows[0].n).toBe(0);
    expect((await db.query("select run_key from agentproof_paid_budget_runs")).rows).toEqual([{run_key:"recent"}]);
    expect((await db.query("select run_key from agentproof_paid_budget_calls")).rows).toEqual([{run_key:"recent"}]);
  });
  it("rejects expired and revoked sessions", async () => {
    await db.exec("update agentproof_tenant_auth_sessions set expires_at=now()-interval '1 second'");
    expect(await call()).toMatchObject({status:"unauthorized"});
    await db.exec("update agentproof_tenant_auth_sessions set expires_at=now()+interval '1 day',revoked_at=now()");
    expect(await call()).toMatchObject({status:"unauthorized"});
  });
  it("retries later requests even when the first 100 keep draining", async () => {
    await db.exec(`insert into agentproof_tenants(tenant_id,name,status,plan)
      select 'acct_retry_'||n,'Retry','suspended','beta' from generate_series(1,101) n;
      insert into agentproof_analysis_jobs(id,tenant_id,status,provider_expires_at)
      select 'retry_job_'||n,'acct_retry_'||n,'processing',now()+interval '1 day' from generate_series(1,100) n;
      insert into agentproof_tenant_deletion_state(tenant_id,status,self_service,started_at,updated_at,required_tables)
      select 'acct_retry_'||n,'active',true,case when n<=100 then now()-interval '2 days' else now()-interval '1 day' end,
        case when n<=100 then now()-interval '1 day' else now() end,
        array[]::text[] from generate_series(1,101) n;`);
    expect((await db.query("select agentproof_continue_personal_deletions() as result")).rows[0].result).toEqual({completed:0,pending:100});
    expect((await db.query("select agentproof_continue_personal_deletions() as result")).rows[0].result.completed).toBe(1);
    expect((await db.query("select count(*)::int as n from agentproof_tenants where tenant_id='acct_retry_101'")).rows[0].n).toBe(0);
  });
  it("does not grant browser roles execution of deletion or signup RPCs", async () => {
    await db.exec("set role anon");
    await expect(call()).rejects.toThrow();
    await expect(db.query("select * from public.agentproof_github_personal_account('123')")).rejects.toThrow();
    await db.exec("reset role");
  });
  it("gives the server role access to newly provisioned usage and audit stores", async () => {
    const rows = (await db.query("select has_table_privilege('service_role','public.agentproof_usage_records','SELECT') as usage, has_table_privilege('service_role','public.agentproof_audit_events','INSERT') as audit")).rows;
    expect(rows[0]).toEqual({ usage: true, audit: true });
  });
});

describe.skipIf(!modulePath)("personal deletion with repository schemas", () => {
  it("applies the migration to the documented stores and real migration chain, then purges FK-linked data", async () => {
    const { PGlite } = await import(/* @vite-ignore */ modulePath!);
    const { pgcrypto } = await import(/* @vite-ignore */ modulePath!.replace(/index\.js$/, "contrib/pgcrypto.js"));
    const actual: DB = new PGlite({ extensions: { pgcrypto } });
    try {
      await actual.exec("create role anon; create role authenticated; create role service_role; create schema extensions;");
      await actual.exec(readFileSync("supabase/migrations/202608030001_public_github_oauth_beta.sql", "utf8"));
      for (const [file, table] of [
        ["docs/github-app-onboarding.md", "agentproof_github_installations"],
        ["docs/github-app-onboarding.md", "agentproof_github_onboarding_states"],
        ["docs/github-app-webhook.md", "agentproof_analysis_jobs"],
        ["docs/github-app-webhook.md", "agentproof_usage_records"],
        ["docs/github-app-webhook.md", "agentproof_github_webhook_deliveries"],
        ["docs/saved-report-storage.md", "agentproof_saved_reports"]
      ]) {
        const block = [...readFileSync(file, "utf8").matchAll(/```sql\n([\s\S]*?)```/g)].map(match=>match[1]).find(sql=>sql.includes(`create table if not exists ${table} (`));
        if (!block) throw new Error(`Missing documented schema: ${table}`);
        await actual.exec(block);
      }
      for (const migration of readdirSync("supabase/migrations").filter(name=>name.endsWith(".sql")).sort()) {
        let sql = readFileSync(`supabase/migrations/${migration}`, "utf8");
        if (migration === "202609300001_self_service_account_deletion.sql") {
          // Older deployments can have the service-store configuration without
          // these two documented tables; the deletion migration must add them.
          await actual.exec("drop table agentproof_usage_records, agentproof_audit_events");
        }
        // PGlite exercises data schemas/functions, not Supabase's managed
        // network scheduler or Vault. Leave the new deletion migration intact.
        if (migration === "202608110001_analysis_jobs_canonical_recovery.sql") {
          sql = sql.replace(/^create extension if not exists (pg_net|pg_cron).*$/gm, "");
          sql = sql.slice(0, sql.indexOf("\ndo $$\nbegin\n  if exists (select 1 from vault.decrypted_secrets"));
        }
        await actual.exec(sql);
      }
      expect((await actual.query("select to_regclass('public.agentproof_usage_records') as usage, to_regclass('public.agentproof_audit_events') as audit")).rows[0])
        .toEqual({usage:"agentproof_usage_records",audit:"agentproof_audit_events"});
      const owner=(await actual.query("select * from agentproof_github_personal_account('987')")).rows[0];
      await actual.query("insert into agentproof_tenant_auth_sessions(id,token_hash,tenant_id,member_id,created_at,expires_at,auth_source) values ('live-schema-session',repeat('c',64),$1,$2,now(),now()+interval '1 day','github')",[owner.tenant_id,owner.member_id]);
      await actual.query("insert into agentproof_github_installations(tenant_id,installation_id,status,created_at,updated_at) values($1,987,'active',now(),now())",[owner.tenant_id]);
      await actual.query("insert into agentproof_tenant_repository_grants(tenant_id,installation_id,repository_id,repository_full_name) values($1,987,123,'fixture/repo')",[owner.tenant_id]);
      await actual.query("insert into agentproof_concierge_analysis_runs(request_key,tenant_id,installation_id,repository_id,status,bounded_reason) values(repeat('d',64),$1,987,123,'completed','fixture')",[owner.tenant_id]);
      // The nullable-expiry migration must retain both generations and still
      // participate in the existing transactional account deletion.
      for (const id of ["retained-first", "retained-second"]) {
        await actual.query("select * from agentproof_store_tenant_report($1,now(),null,'{}'::jsonb,$2,987,123,7,repeat('a',40))", [id, owner.tenant_id]);
      }
      expect((await actual.query("select count(*)::int n from agentproof_saved_reports where expires_at is null")).rows[0].n).toBe(2);
      const result=(await actual.query("select agentproof_delete_personal_account(repeat('c',64),'github','delete') result")).rows[0].result;
      expect(result).toEqual({status:"completed"});
      expect((await actual.query("select count(*)::int n from agentproof_concierge_analysis_runs")).rows[0].n).toBe(0);
      expect((await actual.query("select count(*)::int n from agentproof_tenants")).rows[0].n).toBe(0);
      expect((await actual.query("select count(*)::int n from agentproof_saved_reports")).rows[0].n).toBe(0);
    } finally { await actual.close(); }
  }, 20000);
});
