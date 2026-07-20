-- Human-beta durable session creation must be atomic per tenant member.
-- Stores only bounded session metadata; bootstrap credentials never enter SQL.

create or replace function agentproof_create_tenant_auth_session(
  p_id text,
  p_token_hash text,
  p_tenant_id text,
  p_member_id text,
  p_created_at timestamptz,
  p_expires_at timestamptz
)
returns table (outcome text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_id !~ '^[A-Za-z0-9_-]{16,200}$'
    or p_token_hash !~ '^[a-f0-9]{64}$'
    or p_tenant_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$'
    or p_member_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,119}$'
    or p_created_at is null or p_expires_at <= p_created_at
    or p_expires_at > p_created_at + interval '12 hours 1 minute' then
    raise exception 'invalid tenant auth session metadata';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id || ':' || p_member_id, 0)
  );

  update public.agentproof_tenant_auth_sessions
  set revoked_at = p_created_at
  where tenant_id = p_tenant_id and member_id = p_member_id
    and revoked_at is null and expires_at <= p_created_at;

  if exists (
    select 1 from public.agentproof_tenant_auth_sessions
    where tenant_id = p_tenant_id and member_id = p_member_id
      and revoked_at is null and expires_at > p_created_at
  ) then
    return query select 'active_exists'::text;
    return;
  end if;

  insert into public.agentproof_tenant_auth_sessions (
    id, token_hash, tenant_id, member_id, created_at, expires_at, revoked_at
  ) values (
    p_id, p_token_hash, p_tenant_id, p_member_id, p_created_at, p_expires_at, null
  );

  return query select 'created'::text;
end;
$$;

revoke all on function agentproof_create_tenant_auth_session(text,text,text,text,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function agentproof_create_tenant_auth_session(text,text,text,text,timestamptz,timestamptz) to service_role;
revoke insert on public.agentproof_tenant_auth_sessions from service_role;
