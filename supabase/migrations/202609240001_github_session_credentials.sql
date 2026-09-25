-- Approved exception: encrypted GitHub App user credentials are bound to one
-- revocable server-side GitHub login session. No browser or tenant role can
-- read these columns; only the service-role API may select or update them.
alter table public.agentproof_tenant_auth_sessions
  add column if not exists auth_source text not null default 'bootstrap'
    check (auth_source in ('bootstrap', 'github')),
  add column if not exists github_user_id text
    check (github_user_id is null or github_user_id ~ '^[0-9]{1,20}$'),
  add column if not exists github_access_ciphertext text,
  add column if not exists github_access_expires_at timestamptz,
  add column if not exists github_refresh_ciphertext text,
  add column if not exists github_refresh_expires_at timestamptz,
  add column if not exists github_refresh_lease_owner text,
  add column if not exists github_refresh_lease_until timestamptz;

revoke all on public.agentproof_tenant_auth_sessions from public, anon, authenticated;
grant select, insert, update on public.agentproof_tenant_auth_sessions to service_role;
