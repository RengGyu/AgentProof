alter table public.agentproof_tenant_auth_sessions
  drop constraint if exists agentproof_tenant_auth_sessions_auth_source_check;

alter table public.agentproof_tenant_auth_sessions
  add constraint agentproof_tenant_auth_sessions_auth_source_check
  check (auth_source in ('bootstrap', 'github', 'mobile'));
