-- Pending, privacy-bounded operator/OAuth approval claims. Raw browser tokens,
-- operator request codes, OAuth tokens, repository identity, and account data
-- are never stored here.
create table if not exists agentproof_github_installation_claims (
  id text primary key,
  browser_token_hash text not null unique,
  operator_code_hash text not null unique,
  tenant_id text not null,
  installation_id bigint not null,
  status text not null check (status in ('pending', 'approved', 'rejected', 'activated')),
  expires_at timestamptz not null,
  created_at timestamptz not null,
  decided_at timestamptz
);

create index if not exists agentproof_github_installation_claims_expiry_idx
  on agentproof_github_installation_claims (expires_at);
create index if not exists agentproof_github_installation_claims_installation_idx
  on agentproof_github_installation_claims (installation_id, status);
alter table agentproof_github_installation_claims enable row level security;

create table if not exists agentproof_github_onboarding_states (
  id text primary key,
  kind text not null check (kind in ('install', 'activation')),
  token_hash text not null,
  tenant_id text not null,
  nonce_hash text,
  installation_id bigint,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  used_at timestamptz
);
create unique index if not exists agentproof_github_onboarding_states_token_idx
  on agentproof_github_onboarding_states (kind, token_hash);
alter table agentproof_github_onboarding_states enable row level security;

-- The browser claim may only activate once. This single transaction binds an
-- approved claim to the globally unique installation owner before marking it
-- activated, so a failed ownership check cannot consume the claim.
create or replace function agentproof_activate_github_installation_claim(
  claim_browser_token_hash text,
  activation_time timestamptz,
  activation_session_id text,
  activation_session_token_hash text,
  activation_session_expires_at timestamptz,
  activation_session_created_at timestamptz
)
returns table (tenant_id text, installation_id bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  claim agentproof_github_installation_claims%rowtype;
begin
  select * into claim
  from agentproof_github_installation_claims
  where browser_token_hash = claim_browser_token_hash
    and status = 'approved'
    and expires_at > activation_time
  for update;

  if not found then return; end if;

  if exists (
    select 1 from agentproof_github_installations
    where installation_id = claim.installation_id
      and tenant_id <> claim.tenant_id
  ) then
    raise exception 'GitHub installation metadata is already assigned to another tenant.';
  end if;

  insert into agentproof_github_installations (
    tenant_id, installation_id, status, created_at, updated_at
  ) values (
    claim.tenant_id, claim.installation_id, 'active', activation_time, activation_time
  )
  on conflict (installation_id) do update
  set status = 'active', updated_at = excluded.updated_at,
      suspended_at = null, deleted_at = null
  where agentproof_github_installations.tenant_id = excluded.tenant_id;

  if not found then
    raise exception 'GitHub installation metadata is already assigned to another tenant.';
  end if;

  insert into agentproof_github_onboarding_states (
    id, kind, token_hash, tenant_id, nonce_hash, installation_id,
    expires_at, created_at, used_at
  ) values (
    activation_session_id, 'activation', activation_session_token_hash,
    claim.tenant_id, null, claim.installation_id,
    activation_session_expires_at, activation_session_created_at, null
  );

  update agentproof_github_installation_claims
  set status = 'activated', decided_at = activation_time
  where id = claim.id and status = 'approved';

  return query select claim.tenant_id, claim.installation_id;
end;
$$;

revoke all on function agentproof_activate_github_installation_claim(text, timestamptz, text, text, timestamptz, timestamptz) from public;
grant execute on function agentproof_activate_github_installation_claim(text, timestamptz, text, text, timestamptz, timestamptz) to service_role;
