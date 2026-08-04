-- Repository onboarding verifies that the tenant is not being deleted before
-- it lists or grants a repository. The server-only service role needs read
-- access to this bounded deletion-state metadata.
grant select on table public.agentproof_tenant_deletion_state to service_role;
