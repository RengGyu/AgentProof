import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
const modulePath = process.env.AGENTPROOF_TEST_PGLITE_MODULE;
let db: { exec(sql: string): Promise<unknown>; query(sql: string, args?: unknown[]): Promise<{ rows: Record<string, any>[] }>; close(): Promise<void> };
const migration = "supabase/migrations/202610020001_account_inbox_dismissal.sql";
describe.skipIf(!modulePath)("account inbox dismissal SQL", () => {
  beforeAll(async () => {
    const { PGlite } = await import(/* @vite-ignore */ modulePath!); db = new PGlite();
    await db.exec("create role anon; create role authenticated; create role service_role;");
    await db.exec(readFileSync("supabase/migrations/202608030001_public_github_oauth_beta.sql", "utf8"));
    if (existsSync(migration)) await db.exec(readFileSync(migration, "utf8"));
    await db.exec("create table fixture_reports(id text); create table fixture_jobs(id text); insert into fixture_reports values('report'); insert into fixture_jobs values('job');");
  });
  beforeEach(async () => {
    await db.exec("truncate agentproof_tenants cascade; insert into agentproof_tenants(tenant_id,name,status,plan) values ('one','One','active','beta'),('two','Two','active','beta'); insert into agentproof_tenant_members(tenant_id,member_id,role,status) values ('one','a','owner','active'),('one','b','member','active'),('two','a','owner','active');");
  });
  afterAll(async () => { await db?.close(); });
  it("advances only the selected member's server cutoff, preserving reports and jobs", async () => {
    const first = (await db.query("select * from agentproof_dismiss_inbox('one','a')")).rows[0];
    const next = (await db.query("select * from agentproof_dismiss_inbox('one','a')")).rows[0];
    expect(Date.parse(next.dismissed_through)).toBeGreaterThanOrEqual(Date.parse(first.dismissed_through));
    const rows = (await db.query("select tenant_id,member_id,inbox_dismissed_through from agentproof_tenant_members order by tenant_id,member_id")).rows;
    expect(rows[0].inbox_dismissed_through).not.toBeNull(); expect(rows[1].inbox_dismissed_through).toBeNull(); expect(rows[2].inbox_dismissed_through).toBeNull();
    expect((await db.query("select * from fixture_reports")).rows).toHaveLength(1); expect((await db.query("select * from fixture_jobs")).rows).toHaveLength(1);
  });
  it("denies inactive and missing accounts/members without inventing a cutoff", async () => {
    await db.exec("update agentproof_tenant_members set status='disabled' where tenant_id='one' and member_id='a'");
    expect((await db.query("select * from agentproof_dismiss_inbox('one','a')")).rows).toEqual([]);
    expect((await db.query("select * from agentproof_dismiss_inbox('one','missing')")).rows).toEqual([]);
    await db.exec("update agentproof_tenants set status='suspended' where tenant_id='two'");
    expect((await db.query("select * from agentproof_dismiss_inbox('two','a')")).rows).toEqual([]);
  });
  it("keeps dismissal metadata inside the existing account deletion boundary", async () => {
    await db.query("select * from agentproof_dismiss_inbox('one','a')");
    await db.exec("delete from agentproof_tenants where tenant_id='one'");
    expect((await db.query("select * from agentproof_tenant_members where tenant_id='one'")).rows).toEqual([]);
    expect((await db.query("select * from agentproof_tenant_members where tenant_id='two'")).rows).toHaveLength(1);
  });
  it("does not expose the dismissal RPC to browser roles", async () => {
    await db.exec("set role anon");
    try { await expect(db.query("select * from agentproof_dismiss_inbox('one','a')")).rejects.toThrow(); }
    finally { await db.exec("reset role"); }
  });
});
