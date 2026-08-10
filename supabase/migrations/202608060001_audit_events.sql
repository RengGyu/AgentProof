create table if not exists public.agentproof_audit_events (
  id text primary key,
  created_at timestamptz not null,
  actor text not null check (actor in ('github_app', 'system')),
  action text not null,
  result text not null check (result in ('blocked', 'completed', 'failed', 'skipped')),
  tenant_id text,
  repository_full_name text,
  installation_id bigint,
  pull_request_number integer,
  head_sha_prefix text,
  request_id text,
  status_code integer,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists agentproof_audit_events_tenant_created_idx
  on public.agentproof_audit_events (tenant_id, created_at desc);

alter table public.agentproof_audit_events enable row level security;

revoke all on table public.agentproof_audit_events from anon, authenticated;
grant select, insert on table public.agentproof_audit_events to service_role;
