-- Preserve any pre-existing duplicate same-head rows as history before the
-- current-row uniqueness rule is installed.
with ranked_current_reports as (
  select id,
    row_number() over (
      partition by tenant_id, repository_id, pull_request_number, head_sha
      order by created_at desc, id desc
    ) as current_rank
  from public.agentproof_saved_reports
  where tenant_id is not null
    and repository_id is not null
    and pull_request_number is not null
    and head_sha is not null
    and stale_at is null
)
update public.agentproof_saved_reports as reports
  set stale_at = coalesce(reports.stale_at, reports.created_at, now())
  from ranked_current_reports
  where reports.id = ranked_current_reports.id
    and ranked_current_reports.current_rank > 1;

-- One CURRENT tenant report per repository/PR/head. A completed Check can
-- refresh the same head without creating duplicate CURRENT results while old
-- same-head history remains available.
create unique index if not exists agentproof_saved_reports_pr_head_unique_idx
  on public.agentproof_saved_reports (tenant_id, repository_id, pull_request_number, head_sha)
  where tenant_id is not null
    and repository_id is not null
    and pull_request_number is not null
    and head_sha is not null
    and stale_at is null;

create or replace function public.agentproof_store_tenant_report(
  p_id text,
  p_created_at timestamptz,
  p_expires_at timestamptz,
  p_report jsonb,
  p_tenant_id text,
  p_installation_id bigint,
  p_repository_id bigint,
  p_pull_request_number integer,
  p_head_sha text
)
returns setof public.agentproof_saved_reports
language plpgsql
set search_path = public
as $$
begin
  if p_tenant_id is null
    or p_installation_id is null
    or p_repository_id is null
    or p_pull_request_number is null
    or p_head_sha is null then
    raise exception 'tenant report identity metadata is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_tenant_id || ':' || p_repository_id::text || ':' || p_pull_request_number::text,
      0
    )
  );

  update public.agentproof_saved_reports
    set stale_at = coalesce(stale_at, p_created_at, now())
    where tenant_id = p_tenant_id
      and repository_id = p_repository_id
      and pull_request_number = p_pull_request_number
      and head_sha is distinct from p_head_sha
      and stale_at is null;

  return query
    insert into public.agentproof_saved_reports (
      id, created_at, expires_at, report, tenant_id, installation_id,
      repository_id, pull_request_number, head_sha, stale_at
    ) values (
      p_id, p_created_at, p_expires_at, p_report, p_tenant_id,
      p_installation_id, p_repository_id, p_pull_request_number, p_head_sha, null
    )
    on conflict (tenant_id, repository_id, pull_request_number, head_sha)
      where tenant_id is not null
        and repository_id is not null
        and pull_request_number is not null
        and head_sha is not null
        and stale_at is null
    do update set
      created_at = excluded.created_at,
      expires_at = excluded.expires_at,
      report = excluded.report,
      installation_id = excluded.installation_id,
      stale_at = null
    returning *;
end
$$;

revoke all on function public.agentproof_store_tenant_report(
  text, timestamptz, timestamptz, jsonb, text, bigint, bigint, integer, text
) from public;
grant execute on function public.agentproof_store_tenant_report(
  text, timestamptz, timestamptz, jsonb, text, bigint, bigint, integer, text
) to service_role;
