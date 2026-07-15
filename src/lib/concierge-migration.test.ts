import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/202607140001_concierge_private_beta.sql", "utf8");
describe("concierge durable migration contract", () => {
  it("uses RLS, RPC-only execution mutation, and automation-off grants", () => {
    expect(sql).toContain("analysis_enabled boolean not null default false");
    expect(sql).toContain("agentproof_concierge_analysis_runs enable row level security");
    expect(sql).toContain("revoke all on agentproof_concierge_analysis_runs from public, anon, authenticated, service_role");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("agentproof_record_concierge_feedback");
    expect(sql).toContain("runs.status = 'completed'");
    expect(sql).toContain("grants.enabled");
    expect(sql).toContain("revoke all on agentproof_concierge_feedback from public, anon, authenticated, service_role");
    expect(sql).toContain("foreign key (tenant_id, installation_id) references agentproof_github_installations");
    expect(sql).toContain("agentproof_register_concierge_repository_grant");
    expect(sql).toContain("on conflict on constraint agentproof_tenant_repository_grants_pkey do nothing");
    expect(sql).toContain("'created' else 'existing'");
    expect(sql).not.toMatch(/raw_(?:diff|log|prompt|report)|token\s+text/i);
  });
});
