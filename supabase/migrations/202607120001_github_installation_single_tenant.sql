-- AgentProof P0: one GitHub App installation may belong to exactly one tenant.
-- Apply this migration before enabling durable GitHub App onboarding. It is
-- deliberately fail-closed: existing duplicate installation claims require
-- operator remediation instead of silently picking a tenant.

create table if not exists agentproof_github_installations (
  tenant_id text not null,
  installation_id bigint not null,
  account_id bigint,
  account_login text,
  account_type text,
  status text not null check (status in ('active', 'suspended', 'deleted')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  suspended_at timestamptz,
  deleted_at timestamptz,
  primary key (tenant_id, installation_id)
);

do $$
begin
  if exists (
    select 1
    from agentproof_github_installations
    group by installation_id
    having count(distinct tenant_id) > 1
  ) then
    raise exception 'AgentProof cannot add the installation ownership constraint while duplicate installation claims exist.';
  end if;
end
$$;

create unique index if not exists agentproof_github_installations_installation_idx
  on agentproof_github_installations (installation_id);

create index if not exists agentproof_github_installations_tenant_idx
  on agentproof_github_installations (tenant_id);

alter table agentproof_github_installations enable row level security;
