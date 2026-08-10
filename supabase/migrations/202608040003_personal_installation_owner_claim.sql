-- Public OAuth may encounter a personal GitHub App installation that was
-- connected before GitHub identities had durable owner tenants. Re-home only
-- that narrow legacy case. The caller must still prove live installation
-- access with the transient GitHub OAuth credential before invoking this RPC.
create or replace function public.agentproof_claim_personal_github_installation(
  target_tenant_id text,
  target_installation_id bigint,
  verified_github_user_id text,
  claim_time timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  source_installation public.agentproof_github_installations%rowtype;
  target_member_id text;
  legacy_grants jsonb := '[]'::jsonb;
  legacy_analysis_runs jsonb := '[]'::jsonb;
begin
  -- This is an operator-only maintenance RPC, not a browser request path.
  -- Serializable isolation protects the report-empty predicate; the advisory
  -- lock prevents two maintenance claims for the same installation.
  if current_setting('transaction_isolation') <> 'serializable' then
    return false;
  end if;
  perform pg_advisory_xact_lock(target_installation_id);

  if target_tenant_id !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$'
    or target_installation_id <= 0
    or verified_github_user_id !~ '^[0-9]{1,20}$'
    or claim_time is null
  then
    return false;
  end if;

  select *
  into source_installation
  from public.agentproof_github_installations
  where installation_id = target_installation_id
  for update;

  if not found or source_installation.tenant_id = target_tenant_id then
    return false;
  end if;

  -- A personal installation can be adopted only by that same immutable
  -- GitHub identity and its active owner tenant. Organization installations
  -- remain fail-closed for explicit operator handling.
  select identity.member_id
  into target_member_id
  from public.agentproof_github_identities identity
  join public.agentproof_tenant_members member
    on member.tenant_id = identity.tenant_id
   and member.member_id = identity.member_id
  where identity.github_user_id = verified_github_user_id
    and identity.tenant_id = target_tenant_id
    and member.role = 'owner'
    and member.status = 'active'
  for share of identity, member;

  if lower(coalesce(source_installation.account_type, '')) <> 'user'
    or source_installation.account_id is null
    or source_installation.account_id::text is distinct from verified_github_user_id
    or target_member_id is null
    or exists (
      select 1
      from public.agentproof_github_identities identity
      where identity.tenant_id = source_installation.tenant_id
    )
  then
    return false;
  end if;

  -- Do not carry another user's or an active legacy browser session across
  -- the tenant boundary. Matching expired sessions and their token hashes are
  -- removed at claim time instead of being rewritten as a different member.
  if exists (
    select 1
    from public.agentproof_concierge_github_sessions session
    where session.tenant_id = source_installation.tenant_id
      and session.installation_id = target_installation_id
      and (
        session.github_user_id is null
        or session.github_user_id::text is distinct from verified_github_user_id
        or session.expires_at is null
        or (session.revoked_at is null and session.expires_at > claim_time)
      )
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.agentproof_concierge_analysis_runs analysis_run
    where analysis_run.tenant_id = source_installation.tenant_id
      and analysis_run.installation_id = target_installation_id
      and (
        analysis_run.completed_at is null
        or analysis_run.status is null
        or analysis_run.status not in ('completed', 'failed')
      )
  ) then
    return false;
  end if;

  -- Never move stored reports across a tenant boundary. Legacy installations
  -- with report history require an explicit operator migration.
  if exists (
    select 1
    from public.agentproof_saved_reports report
    where report.tenant_id = source_installation.tenant_id
  ) then
    return false;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'repository_id', grant_row.repository_id,
    'repository_full_name', grant_row.repository_full_name,
    'enabled', grant_row.enabled,
    'analysis_enabled', grant_row.analysis_enabled,
    'save_reports_enabled', grant_row.save_reports_enabled,
    'created_at', grant_row.created_at
  )), '[]'::jsonb)
  into legacy_grants
  from public.agentproof_tenant_repository_grants grant_row
  where grant_row.tenant_id = source_installation.tenant_id
    and grant_row.installation_id = target_installation_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'request_key', analysis_run.request_key,
    'repository_id', analysis_run.repository_id,
    'status', analysis_run.status,
    'bounded_reason', analysis_run.bounded_reason,
    'created_at', analysis_run.created_at,
    'completed_at', analysis_run.completed_at,
    'decision_card_state', analysis_run.decision_card_state
  )), '[]'::jsonb)
  into legacy_analysis_runs
  from public.agentproof_concierge_analysis_runs analysis_run
  where analysis_run.tenant_id = source_installation.tenant_id
    and analysis_run.installation_id = target_installation_id;

  delete from public.agentproof_concierge_analysis_runs
  where tenant_id = source_installation.tenant_id
    and installation_id = target_installation_id;

  delete from public.agentproof_tenant_repository_grants
  where tenant_id = source_installation.tenant_id
    and installation_id = target_installation_id;

  delete from public.agentproof_concierge_github_sessions
  where tenant_id = source_installation.tenant_id
    and installation_id = target_installation_id;

  delete from public.agentproof_github_installations
  where tenant_id = source_installation.tenant_id
    and installation_id = target_installation_id;

  insert into public.agentproof_github_installations (
    tenant_id,
    installation_id,
    account_id,
    account_login,
    account_type,
    status,
    created_at,
    updated_at,
    suspended_at,
    deleted_at
  ) values (
    target_tenant_id,
    source_installation.installation_id,
    source_installation.account_id,
    source_installation.account_login,
    source_installation.account_type,
    'active',
    source_installation.created_at,
    claim_time,
    null,
    null
  );

  insert into public.agentproof_tenant_repository_grants (
    tenant_id,
    installation_id,
    repository_id,
    repository_full_name,
    enabled,
    analysis_enabled,
    comment_enabled,
    save_reports_enabled,
    slack_notifications_enabled,
    created_at,
    updated_at
  )
  select
    target_tenant_id,
    target_installation_id,
    grant_row.repository_id,
    grant_row.repository_full_name,
    grant_row.enabled,
    grant_row.analysis_enabled,
    false,
    grant_row.save_reports_enabled,
    false,
    grant_row.created_at,
    claim_time
  from jsonb_to_recordset(legacy_grants) as grant_row(
    repository_id bigint,
    repository_full_name text,
    enabled boolean,
    analysis_enabled boolean,
    save_reports_enabled boolean,
    created_at timestamptz
  );

  insert into public.agentproof_concierge_analysis_runs (
    request_key,
    tenant_id,
    installation_id,
    repository_id,
    status,
    bounded_reason,
    created_at,
    completed_at,
    decision_card_state
  )
  select
    analysis_run.request_key,
    target_tenant_id,
    target_installation_id,
    analysis_run.repository_id,
    analysis_run.status,
    analysis_run.bounded_reason,
    analysis_run.created_at,
    analysis_run.completed_at,
    analysis_run.decision_card_state
  from jsonb_to_recordset(legacy_analysis_runs) as analysis_run(
    request_key text,
    repository_id bigint,
    status text,
    bounded_reason text,
    created_at timestamptz,
    completed_at timestamptz,
    decision_card_state text
  );

  return true;
end;
$$;

revoke all on function public.agentproof_claim_personal_github_installation(text, bigint, text, timestamptz) from public, anon, authenticated;
grant execute on function public.agentproof_claim_personal_github_installation(text, bigint, text, timestamptz) to service_role;
