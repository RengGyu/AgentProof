-- New verified tenant PR reports may be retained until explicit deletion.
-- Existing expiry values and historical report payloads are not changed.
alter table public.agentproof_saved_reports alter column expires_at drop not null;
alter table public.agentproof_saved_reports add constraint agentproof_retained_report_identity
  check (expires_at is not null or (
    tenant_id is not null and installation_id is not null and repository_id is not null
    and pull_request_number is not null and head_sha is not null and access_token_hash is null
  ));

-- Keep the existing service-only RPC, transaction lock, RLS and deletion guards.
-- A new retained generation archives the previous current version, including
-- the same head. Older TTL writers may not overwrite retained versions either.
create or replace function public.agentproof_store_tenant_report(
  p_id text, p_created_at timestamptz, p_expires_at timestamptz, p_report jsonb,
  p_tenant_id text, p_installation_id bigint, p_repository_id bigint,
  p_pull_request_number integer, p_head_sha text
)
returns setof public.agentproof_saved_reports
language plpgsql
set search_path = public
as $$
begin
  if p_tenant_id is null or p_installation_id is null or p_repository_id is null
    or p_pull_request_number is null or p_head_sha is null then
    raise exception 'tenant report identity metadata is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant_id || ':' || p_repository_id::text || ':' || p_pull_request_number::text, 0));
  update public.agentproof_saved_reports
    set stale_at = coalesce(stale_at, p_created_at, now())
    where tenant_id = p_tenant_id and repository_id = p_repository_id
      and pull_request_number = p_pull_request_number and stale_at is null
      and (p_expires_at is null or expires_at is null or head_sha is distinct from p_head_sha);
  return query
    insert into public.agentproof_saved_reports (
      id, created_at, expires_at, report, tenant_id, installation_id,
      repository_id, pull_request_number, head_sha, stale_at
    ) values (
      p_id, p_created_at, p_expires_at, p_report, p_tenant_id, p_installation_id,
      p_repository_id, p_pull_request_number, p_head_sha, null
    )
    on conflict (tenant_id, repository_id, pull_request_number, head_sha)
      where tenant_id is not null and repository_id is not null
        and pull_request_number is not null and head_sha is not null and stale_at is null
    do update set created_at = excluded.created_at, expires_at = excluded.expires_at,
      report = excluded.report, installation_id = excluded.installation_id, stale_at = null
    returning *;
end
$$;
revoke all on function public.agentproof_store_tenant_report(
  text, timestamptz, timestamptz, jsonb, text, bigint, bigint, integer, text
) from public;
grant execute on function public.agentproof_store_tenant_report(
  text, timestamptz, timestamptz, jsonb, text, bigint, bigint, integer, text
) to service_role;
