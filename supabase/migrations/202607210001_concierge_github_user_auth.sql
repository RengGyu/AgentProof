-- Concierge GitHub user-to-server OAuth boundary.  This migration deliberately
-- stores only hashes and numeric authority identifiers: no OAuth code, access
-- token, refresh token, login name, repository name, task, PR or report text.

create table if not exists public.agentproof_concierge_github_oauth_states (
  state_hash text primary key check (state_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '16 minutes')
);

create table if not exists public.agentproof_concierge_github_sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  tenant_id text not null,
  member_id text not null check (member_id ~ '^github-user-[1-9][0-9]{0,18}$'),
  github_user_id bigint not null check (github_user_id > 0),
  installation_id bigint not null check (installation_id > 0),
  auth_version text not null check (auth_version = 'github-user-oauth.v1'),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '1 hour 1 minute'),
  foreign key (tenant_id, installation_id) references public.agentproof_github_installations(tenant_id, installation_id),
  foreign key (tenant_id, member_id) references public.agentproof_tenant_members(tenant_id, member_id),
  check (member_id = 'github-user-' || github_user_id::text)
);

create table if not exists public.agentproof_concierge_github_session_repositories (
  token_hash text not null references public.agentproof_concierge_github_sessions(token_hash) on delete cascade,
  repository_id bigint not null check (repository_id > 0),
  primary key (token_hash, repository_id)
);

-- There can be one durable Concierge OAuth session for a GitHub user in a
-- tenant. The RPC below serializes replacement; this index is the database
-- backstop if a caller or future code path is wrong.
create unique index if not exists agentproof_concierge_github_sessions_one_active_user
  on public.agentproof_concierge_github_sessions(tenant_id, github_user_id)
  where revoked_at is null;

alter table public.agentproof_concierge_github_oauth_states enable row level security;
alter table public.agentproof_concierge_github_sessions enable row level security;
alter table public.agentproof_concierge_github_session_repositories enable row level security;
revoke all on public.agentproof_concierge_github_oauth_states, public.agentproof_concierge_github_sessions, public.agentproof_concierge_github_session_repositories from public, anon, authenticated, service_role;

create or replace function public.agentproof_reserve_concierge_github_oauth_state(
  p_state_hash text, p_created_at timestamptz, p_expires_at timestamptz
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_state_hash !~ '^[a-f0-9]{64}$' or p_created_at is null or p_expires_at is null
    or p_expires_at <= p_created_at or p_expires_at > p_created_at + interval '16 minutes' then return false; end if;
  insert into public.agentproof_concierge_github_oauth_states(state_hash, created_at, expires_at)
  values (p_state_hash, p_created_at, p_expires_at) on conflict do nothing;
  return found;
end; $$;

create or replace function public.agentproof_consume_concierge_github_oauth_state(
  p_state_hash text, p_used_at timestamptz
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_state_hash !~ '^[a-f0-9]{64}$' or p_used_at is null then return false; end if;
  update public.agentproof_concierge_github_oauth_states set used_at = p_used_at
  where state_hash = p_state_hash and used_at is null and expires_at > p_used_at;
  return found;
end; $$;

-- The personal-account check is repeated in the database against the durable
-- installation row. It never uses login names as authorization facts.
create or replace function public.agentproof_create_concierge_github_session(
  p_token_hash text, p_tenant_id text, p_github_user_id bigint, p_installation_id bigint,
  p_repository_ids jsonb, p_created_at timestamptz, p_expires_at timestamptz
) returns text language plpgsql security definer set search_path = '' as $$
declare
  member_value text := 'github-user-' || p_github_user_id::text;
  repository_value jsonb;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' or p_tenant_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$'
    or p_github_user_id <= 0 or p_installation_id <= 0 or jsonb_typeof(p_repository_ids) <> 'array'
    or p_created_at is null or p_expires_at is null or p_expires_at <= p_created_at
    or p_expires_at > p_created_at + interval '1 hour 1 minute' then return 'rejected'; end if;
  if not exists (
    select 1 from public.agentproof_github_installations installations
    join public.agentproof_tenants tenants on tenants.tenant_id = installations.tenant_id
    where installations.tenant_id = p_tenant_id and installations.installation_id = p_installation_id
      and installations.status = 'active' and installations.account_id = p_github_user_id
      and installations.account_type = 'User' and tenants.status in ('active','trialing','invite-only')
  ) then return 'identity_mismatch'; end if;
  -- OAuth never creates, revives, or changes a tenant member. An operator
  -- must have admitted this exact numeric GitHub identity as an active member.
  if not exists (
    select 1 from public.agentproof_tenant_members members
    where members.tenant_id = p_tenant_id and members.member_id = member_value
      and members.status = 'active' and members.role = 'member'
  ) then return 'member_unavailable'; end if;
  -- OAuth reads at most five GitHub pages of 100 repositories. Keep the
  -- durable contract aligned with that bounded intersection.
  if jsonb_array_length(p_repository_ids) < 1 or jsonb_array_length(p_repository_ids) > 500 then return 'rejected'; end if;
  for repository_value in select value from jsonb_array_elements(p_repository_ids) loop
    if jsonb_typeof(repository_value) <> 'number' or (repository_value #>> '{}') !~ '^[1-9][0-9]{0,18}$' then return 'rejected'; end if;
  end loop;
  if exists (select 1 from jsonb_array_elements_text(p_repository_ids) values_grouped(value) group by value having count(*) > 1) then return 'rejected'; end if;
  -- Serialize same-user callbacks. A successful new login replaces a prior
  -- active session atomically; a duplicate token never changes prior state.
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id || ':' || p_github_user_id::text, 0));
  if exists (select 1 from public.agentproof_concierge_github_sessions where token_hash = p_token_hash) then return 'duplicate'; end if;
  update public.agentproof_concierge_github_sessions
  set revoked_at = p_created_at
  where tenant_id = p_tenant_id and github_user_id = p_github_user_id and revoked_at is null;
  -- Concierge's table is the only session authority. Do not duplicate an OAuth
  -- session in the generic tenant-auth session table.
  insert into public.agentproof_concierge_github_sessions(token_hash, tenant_id, member_id, github_user_id, installation_id, auth_version, created_at, expires_at)
  values(p_token_hash, p_tenant_id, member_value, p_github_user_id, p_installation_id, 'github-user-oauth.v1', p_created_at, p_expires_at)
  on conflict do nothing;
  if not found then return 'rejected'; end if;
  insert into public.agentproof_concierge_github_session_repositories(token_hash, repository_id)
  select p_token_hash, (value #>> '{}')::bigint from jsonb_array_elements(p_repository_ids);
  return 'created';
end; $$;

create or replace function public.agentproof_resolve_concierge_github_installation(
  p_installation_id bigint, p_github_user_id bigint
) returns table(tenant_id text) language sql security definer set search_path = '' as $$
  select installations.tenant_id
  from public.agentproof_github_installations installations
  join public.agentproof_tenants tenants on tenants.tenant_id = installations.tenant_id
  where installations.installation_id = p_installation_id and installations.account_id = p_github_user_id
    and installations.account_type = 'User' and installations.status = 'active'
    and tenants.status in ('active','trialing','invite-only')
  limit 1;
$$;

create or replace function public.agentproof_read_concierge_github_session(p_token_hash text, p_now timestamptz)
returns table(tenant_id text, member_id text, github_user_id bigint, installation_id bigint, repository_id bigint)
language sql security definer set search_path = '' as $$
  select sessions.tenant_id, sessions.member_id, sessions.github_user_id, sessions.installation_id, repositories.repository_id
  from public.agentproof_concierge_github_sessions sessions
  join public.agentproof_concierge_github_session_repositories repositories on repositories.token_hash = sessions.token_hash
  join public.agentproof_tenants tenants on tenants.tenant_id = sessions.tenant_id and tenants.status in ('active','trialing','invite-only')
  join public.agentproof_tenant_members members on members.tenant_id = sessions.tenant_id and members.member_id = sessions.member_id and members.status = 'active' and members.role = 'member'
  join public.agentproof_github_installations installations on installations.tenant_id = sessions.tenant_id and installations.installation_id = sessions.installation_id and installations.status = 'active' and installations.account_id = sessions.github_user_id and installations.account_type = 'User'
  join public.agentproof_tenant_repository_grants grants on grants.tenant_id = sessions.tenant_id and grants.installation_id = sessions.installation_id and grants.repository_id = repositories.repository_id and grants.enabled
  left join public.agentproof_tenant_deletion_state deletion_state on deletion_state.tenant_id = sessions.tenant_id and deletion_state.status = 'active'
  where sessions.token_hash = p_token_hash and sessions.revoked_at is null and sessions.expires_at > p_now
    and deletion_state.tenant_id is null;
$$;

create or replace function public.agentproof_revoke_concierge_github_session(p_token_hash text, p_revoked_at timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' or p_revoked_at is null then return 'rejected'; end if;
  update public.agentproof_concierge_github_sessions set revoked_at = p_revoked_at where token_hash = p_token_hash and revoked_at is null;
  if found then return 'revoked'; end if;
  if exists (select 1 from public.agentproof_concierge_github_sessions where token_hash = p_token_hash) then return 'already_revoked'; end if;
  return 'not_found';
end; $$;

-- Signed github_app_authorization revocation events may repeat. This is an
-- idempotent numeric-identity transition and stores no webhook payload.
create or replace function public.agentproof_revoke_concierge_github_sessions_for_user(p_github_user_id bigint, p_revoked_at timestamptz)
returns integer language plpgsql security definer set search_path = '' as $$
declare changed_count integer;
begin
  if p_github_user_id <= 0 or p_revoked_at is null then raise exception 'invalid github authorization revocation metadata'; end if;
  update public.agentproof_concierge_github_sessions set revoked_at = p_revoked_at
  where github_user_id = p_github_user_id and revoked_at is null;
  get diagnostics changed_count = row_count;
  return changed_count;
end; $$;

-- Metadata retention only: state hashes are retained briefly for replay
-- forensics, then expired state/session rows are removed by an explicit
-- service-role maintenance job. It never unlocks or revives a session.
create or replace function public.agentproof_cleanup_concierge_github_auth(p_now timestamptz)
returns table(expired_state_count integer, expired_session_count integer)
language plpgsql security definer set search_path = '' as $$
declare states integer; sessions integer;
begin
  if p_now is null then raise exception 'invalid concierge auth cleanup metadata'; end if;
  delete from public.agentproof_concierge_github_oauth_states where expires_at < p_now - interval '24 hours';
  get diagnostics states = row_count;
  delete from public.agentproof_concierge_github_sessions where expires_at < p_now - interval '7 days' or revoked_at < p_now - interval '7 days';
  get diagnostics sessions = row_count;
  return query select states, sessions;
end; $$;

revoke all on function public.agentproof_reserve_concierge_github_oauth_state(text,timestamptz,timestamptz), public.agentproof_consume_concierge_github_oauth_state(text,timestamptz), public.agentproof_create_concierge_github_session(text,text,bigint,bigint,jsonb,timestamptz,timestamptz), public.agentproof_resolve_concierge_github_installation(bigint,bigint), public.agentproof_read_concierge_github_session(text,timestamptz), public.agentproof_revoke_concierge_github_session(text,timestamptz), public.agentproof_revoke_concierge_github_sessions_for_user(bigint,timestamptz), public.agentproof_cleanup_concierge_github_auth(timestamptz) from public, anon, authenticated;
grant execute on function public.agentproof_reserve_concierge_github_oauth_state(text,timestamptz,timestamptz), public.agentproof_consume_concierge_github_oauth_state(text,timestamptz), public.agentproof_create_concierge_github_session(text,text,bigint,bigint,jsonb,timestamptz,timestamptz), public.agentproof_resolve_concierge_github_installation(bigint,bigint), public.agentproof_read_concierge_github_session(text,timestamptz), public.agentproof_revoke_concierge_github_session(text,timestamptz), public.agentproof_revoke_concierge_github_sessions_for_user(bigint,timestamptz), public.agentproof_cleanup_concierge_github_auth(timestamptz) to service_role;
