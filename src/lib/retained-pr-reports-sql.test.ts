import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const modulePath = process.env.AGENTPROOF_TEST_PGLITE_MODULE;
type DB = { exec(sql: string): Promise<unknown>; query(sql: string, args?: unknown[]): Promise<{ rows: Record<string, any>[] }>; close(): Promise<void> };
let db: DB;
const migration = "supabase/migrations/202610010001_retained_pr_report_versions.sql";
const store = (id: string, tenant: string, expiry: string | null = null, head = "a".repeat(40)) => db.query(
  "select * from agentproof_store_tenant_report($1,now(),$2,'{}'::jsonb,$3,42,9,7,$4)", [id, expiry, tenant, head]);
describe.skipIf(!modulePath)("retained PR versions database contract", () => {
  beforeAll(async () => {
    const { PGlite } = await import(/* @vite-ignore */ modulePath!);
    db = new PGlite();
    await db.exec("create role service_role;");
    const schema = [...readFileSync("docs/saved-report-storage.md", "utf8").matchAll(/```sql\n([\s\S]*?)```/g)].map(m=>m[1]).find(sql=>sql.includes("create table if not exists agentproof_saved_reports ("))!;
    await db.exec(schema);
    await db.exec(readFileSync("supabase/migrations/202608040001_saved_reports_stale_metadata.sql", "utf8"));
    await db.exec(readFileSync("supabase/migrations/202608090001_saved_reports_same_head_upsert.sql", "utf8"));
    await store("legacy", "tenant_a", "2020-01-02T00:00:00Z");
    await db.exec(readFileSync(migration, "utf8"));
  });
  afterAll(async () => { await db?.close(); });
  it("preserves old expiry, appends same-head/new-head versions, and never expires retained versions", async () => {
    await store("new-one", "tenant_a");
    await store("new-two", "tenant_a");
    await store("new-head", "tenant_a", null, "b".repeat(40));
    const rows = (await db.query("select id, expires_at, stale_at from agentproof_saved_reports order by id")).rows;
    expect(rows).toHaveLength(4);
    expect(rows.find(r=>r.id==="legacy")!.expires_at.toISOString()).toBe("2020-01-02T00:00:00.000Z");
    expect(rows.filter(r=>r.id!=="legacy").every(r=>r.expires_at === null)).toBe(true);
    expect(rows.filter(r=>r.stale_at === null).map(r=>r.id)).toEqual(["new-head"]);
    await db.exec("delete from agentproof_saved_reports where expires_at <= '2099-01-01'::timestamptz");
    expect((await db.query("select id from agentproof_saved_reports order by id")).rows.map(r=>r.id)).toEqual(["new-head","new-one","new-two"]);
  });
  it("an old TTL writer cannot overwrite a retained same-head version", async () => {
    await store("retained", "tenant_b");
    await store("old-writer", "tenant_b", "2099-01-01T00:00:00Z");
    expect((await db.query("select id from agentproof_saved_reports where tenant_id='tenant_b' order by id")).rows.map(r=>r.id)).toEqual(["old-writer","retained"]);
    expect((await db.query("select expires_at from agentproof_saved_reports where id='retained'")).rows[0].expires_at).toBeNull();
  });
  it("rolls back old-version marking on failed insert and deletes all versions only in the chosen tenant", async () => {
    await store("rollback-first", "tenant_delete");
    await store("rollback-current", "tenant_delete");
    await store("other-tenant", "tenant_keep");
    await expect(store("rollback-current", "tenant_delete")).rejects.toThrow();
    expect((await db.query("select stale_at from agentproof_saved_reports where id='rollback-current'")).rows[0].stale_at).toBeNull();
    await db.exec("delete from agentproof_saved_reports where tenant_id='tenant_delete'");
    expect((await db.query("select count(*)::int n from agentproof_saved_reports where tenant_id='tenant_delete'")).rows[0].n).toBe(0);
    expect((await db.query("select count(*)::int n from agentproof_saved_reports where tenant_id='tenant_keep'")).rows[0].n).toBe(1);
    await expect(db.exec("insert into agentproof_saved_reports(id,created_at,expires_at,report) values('unowned',now(),null,'{}')")).rejects.toThrow();
  });
});
