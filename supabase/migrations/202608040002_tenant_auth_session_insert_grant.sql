-- Public GitHub OAuth beta needs to persist only a hashed, revocable tenant
-- session after a verified identity has created its owner tenant. Browser
-- clients receive no database credentials; RLS remains enabled.
grant insert on table public.agentproof_tenant_auth_sessions to service_role;
