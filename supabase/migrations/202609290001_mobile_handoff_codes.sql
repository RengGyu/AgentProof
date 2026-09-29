create table if not exists public.agentproof_mobile_handoff_codes (
  code_hash text primary key check (code_hash ~ '^[a-f0-9]{64}$'),
  tenant_id text not null,
  member_id text not null,
  verifier_hash text not null,
  expires_at timestamptz not null
);

revoke all on public.agentproof_mobile_handoff_codes from public, anon, authenticated;
grant select, insert, delete on public.agentproof_mobile_handoff_codes to service_role;

create index if not exists agentproof_mobile_handoff_codes_expiry_idx
  on public.agentproof_mobile_handoff_codes (expires_at);
