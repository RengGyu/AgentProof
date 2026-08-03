-- Additive metadata for tenant-scoped report history. Existing summary rows
-- remain readable with NULL identity fields and are never retroactively stale.
alter table public.agentproof_saved_reports
  add column if not exists installation_id bigint,
  add column if not exists repository_id bigint,
  add column if not exists pull_request_number integer,
  add column if not exists head_sha text,
  add column if not exists stale_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'agentproof_saved_reports_identity_metadata_check'
      and conrelid = 'public.agentproof_saved_reports'::regclass
  ) then
    alter table public.agentproof_saved_reports
      add constraint agentproof_saved_reports_identity_metadata_check
      check (
        (installation_id is null and repository_id is null and pull_request_number is null and head_sha is null)
        or
        (
          tenant_id is not null
          and installation_id is not null
          and repository_id is not null
          and pull_request_number is not null
          and head_sha is not null
          and installation_id > 0
          and repository_id > 0
          and pull_request_number > 0
          and head_sha ~ '^[a-f0-9]{6,64}$'
        )
      ) not valid;
  end if;
end
$$;

create index if not exists agentproof_saved_reports_pr_head_idx
  on public.agentproof_saved_reports (tenant_id, repository_id, pull_request_number, head_sha)
  where tenant_id is not null and repository_id is not null and pull_request_number is not null;

-- Verified tenant writes use this RPC so competing heads for one PR serialize
-- before either the stale update or insert observes database state.
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
      id,
      created_at,
      expires_at,
      report,
      tenant_id,
      installation_id,
      repository_id,
      pull_request_number,
      head_sha
    ) values (
      p_id,
      p_created_at,
      p_expires_at,
      p_report,
      p_tenant_id,
      p_installation_id,
      p_repository_id,
      p_pull_request_number,
      p_head_sha
    )
    returning *;
end
$$;

revoke all on function public.agentproof_store_tenant_report(
  text, timestamptz, timestamptz, jsonb, text, bigint, bigint, integer, text
) from public;
grant execute on function public.agentproof_store_tenant_report(
  text, timestamptz, timestamptz, jsonb, text, bigint, bigint, integer, text
) to service_role;

-- The stale transition and the new insert share one database transaction.
-- This avoids a committed new head with an unstaled prior head if a second
-- HTTP request fails after insertion.
create or replace function public.agentproof_mark_prior_reports_stale()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.tenant_id is not null
    and new.repository_id is not null
    and new.pull_request_number is not null
    and new.head_sha is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(
        new.tenant_id || ':' || new.repository_id::text || ':' || new.pull_request_number::text,
        0
      )
    );
    update public.agentproof_saved_reports
      set stale_at = coalesce(stale_at, new.created_at, now())
      where tenant_id = new.tenant_id
        and repository_id = new.repository_id
        and pull_request_number = new.pull_request_number
        and head_sha is distinct from new.head_sha
        and stale_at is null;
  end if;
  return new;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'agentproof_saved_reports_mark_prior_stale'
      and tgrelid = 'public.agentproof_saved_reports'::regclass
  ) then
    create trigger agentproof_saved_reports_mark_prior_stale
      before insert on public.agentproof_saved_reports
      for each row execute function public.agentproof_mark_prior_reports_stale();
  end if;
end
$$;
