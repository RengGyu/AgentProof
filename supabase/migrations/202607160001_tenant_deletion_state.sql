-- Durable, metadata-only tenant deletion tombstone.
-- This table intentionally has no repository, PR, evidence, report, token,
-- actor, free-text reason, or raw payload columns. A started deletion is an
-- immutable application-level block; any future release workflow requires a
-- separately reviewed migration and explicit lifecycle contract.

create table if not exists public.agentproof_tenant_deletion_state (
  tenant_id text primary key references public.agentproof_tenants(tenant_id),
  status text not null check (status = 'active'),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (updated_at >= started_at)
);

alter table public.agentproof_tenant_deletion_state enable row level security;
revoke all on table public.agentproof_tenant_deletion_state from public, anon, authenticated, service_role;

-- Return one bounded boolean only. Direct table reads are intentionally
-- unavailable even to the service role used by the application adapter.
create or replace function public.agentproof_tenant_deletion_state_active(p_tenant_id text)
returns table (active boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_tenant_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$' then
    raise exception 'invalid tenant deletion metadata';
  end if;

  return query
    select exists (
      select 1
      from public.agentproof_tenant_deletion_state as state
      where state.tenant_id = p_tenant_id and state.status = 'active'
    );
end;
$$;

-- The only application transition is absent -> active. Repeated starts are
-- bounded idempotent reads, not updates; no application release/unlock path
-- exists in this migration.
create or replace function public.agentproof_mark_tenant_deletion_active(p_tenant_id text)
returns table (outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  created boolean := false;
begin
  if p_tenant_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$' then
    raise exception 'invalid tenant deletion metadata';
  end if;

  insert into public.agentproof_tenant_deletion_state (tenant_id, status)
  values (p_tenant_id, 'active')
  on conflict (tenant_id) do nothing;
  created := found;

  return query select case when created then 'created' else 'existing' end;
end;
$$;

revoke all on function public.agentproof_tenant_deletion_state_active(text) from public, anon, authenticated;
revoke all on function public.agentproof_mark_tenant_deletion_active(text) from public, anon, authenticated;
grant execute on function public.agentproof_tenant_deletion_state_active(text) to service_role;
grant execute on function public.agentproof_mark_tenant_deletion_active(text) to service_role;
