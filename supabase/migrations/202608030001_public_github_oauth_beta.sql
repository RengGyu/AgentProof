-- Public GitHub OAuth beta: one immutable GitHub numeric identity owns one
-- AgentProof tenant. OAuth tokens, GitHub responses, diffs, and logs have no
-- column in this schema and must never be inserted here.
create table if not exists public.agentproof_tenants (
  tenant_id text primary key,
  name text not null,
  status text not null check (status in ('active', 'trialing', 'suspended', 'deleted')),
  plan text not null check (plan in ('free', 'beta', 'team', 'pro', 'enterprise', 'custom')),
  created_at timestamptz not null default now()
);

create table if not exists public.agentproof_tenant_members (
  tenant_id text not null references public.agentproof_tenants(tenant_id) on delete cascade,
  member_id text not null,
  role text not null check (role in ('owner', 'admin', 'member')),
  status text not null check (status in ('active', 'invited', 'disabled')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, member_id)
);

create table if not exists public.agentproof_github_identities (
  github_user_id text primary key check (github_user_id ~ '^[0-9]{1,20}$'),
  tenant_id text not null references public.agentproof_tenants(tenant_id) on delete restrict,
  member_id text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, member_id),
  foreign key (tenant_id, member_id) references public.agentproof_tenant_members(tenant_id, member_id) on delete cascade
);

create table if not exists public.agentproof_tenant_auth_sessions (
  id text primary key,
  token_hash text not null unique,
  tenant_id text not null references public.agentproof_tenants(tenant_id) on delete cascade,
  member_id text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  foreign key (tenant_id, member_id) references public.agentproof_tenant_members(tenant_id, member_id) on delete cascade
);

-- Service-role server endpoints are the only database client for these tables.
-- Keep RLS enabled: no browser session receives a database credential.
alter table public.agentproof_tenants enable row level security;
alter table public.agentproof_tenant_members enable row level security;
alter table public.agentproof_github_identities enable row level security;
alter table public.agentproof_tenant_auth_sessions enable row level security;
