import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/202607140001_concierge_private_beta.sql", "utf8");
const deletionStateSql = readFileSync("supabase/migrations/202607160001_tenant_deletion_state.sql", "utf8");
const humanBetaClaritySql = readFileSync("supabase/migrations/202607200001_human_beta_feedback_clarity.sql", "utf8");
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

  it("makes tenant deletion state metadata-only and RPC-only", () => {
    expect(deletionStateSql).toContain("agentproof_tenant_deletion_state");
    expect(deletionStateSql).toContain("tenant_id text primary key references public.agentproof_tenants");
    expect(deletionStateSql).toContain("check (status = 'active')");
    expect(deletionStateSql).toContain("enable row level security");
    expect(deletionStateSql).toContain("revoke all on table public.agentproof_tenant_deletion_state from public, anon, authenticated, service_role");
    expect(deletionStateSql).toContain("agentproof_tenant_deletion_state_active");
    expect(deletionStateSql).toContain("agentproof_mark_tenant_deletion_active");
    expect(deletionStateSql).toContain("security definer");
    expect(deletionStateSql).toContain("set search_path = ''");
    expect(deletionStateSql).toContain("grant execute on function public.agentproof_tenant_deletion_state_active(text) to service_role");
    expect(deletionStateSql).not.toMatch(/(?:raw_(?:diff|log|prompt|report)|token|reason|repository|pull_request|evidence)\s+(?:text|jsonb)/i);
  });

  it("separates internal and external feedback and represents zero-gap without free text", () => {
    expect(humanBetaClaritySql).toContain("concierge-feedback.v3");
    expect(humanBetaClaritySql).toContain("participant_cohort");
    expect(humanBetaClaritySql).toContain("self_internal");
    expect(humanBetaClaritySql).toContain("external_reviewer");
    expect(humanBetaClaritySql).toContain("evidence_insufficient");
    expect(humanBetaClaritySql).toContain("not_applicable_zero_gap");
    expect(humanBetaClaritySql).toContain("field_count <> 21");
    expect(humanBetaClaritySql).toContain("security definer");
    expect(humanBetaClaritySql).toContain("set search_path = ''");
    expect(humanBetaClaritySql).not.toMatch(/raw_(?:diff|log|prompt|report)|token\s+text/i);
  });
});
