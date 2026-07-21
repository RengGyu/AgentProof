-- Metadata-only Concierge private beta execution and feedback boundary.
-- This schema must never receive task/PR text, report bodies, evidence, diffs,
-- logs, tokens, raw re-prompts, repository names/URLs, or contact details.

create table if not exists agentproof_tenants (
  tenant_id text primary key,
  name text not null,
  status text not null check (status in ('active','trialing','suspended','deleted','invite-only','unknown')),
  plan text not null,
  updated_at timestamptz not null default now()
);
create table if not exists agentproof_tenant_members (
  tenant_id text not null references agentproof_tenants(tenant_id),
  member_id text not null,
  role text not null check (role in ('owner','admin','member')),
  status text not null check (status in ('active','invited','disabled')),
  primary key (tenant_id, member_id)
);
create table if not exists agentproof_tenant_auth_sessions (
  id text primary key,
  token_hash text not null unique,
  tenant_id text not null,
  member_id text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  foreign key (tenant_id, member_id) references agentproof_tenant_members(tenant_id, member_id)
);
create table if not exists agentproof_tenant_repository_grants (
  tenant_id text not null,
  installation_id bigint not null,
  repository_id bigint not null,
  repository_full_name text not null,
  enabled boolean not null default true,
  analysis_enabled boolean not null default false,
  comment_enabled boolean not null default false,
  save_reports_enabled boolean not null default false,
  slack_notifications_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, installation_id, repository_id),
  foreign key (tenant_id, installation_id) references agentproof_github_installations(tenant_id, installation_id)
);
alter table agentproof_tenants enable row level security;
alter table agentproof_tenant_members enable row level security;
alter table agentproof_tenant_auth_sessions enable row level security;
alter table agentproof_tenant_repository_grants enable row level security;
revoke all on agentproof_tenants, agentproof_tenant_members, agentproof_tenant_auth_sessions, agentproof_tenant_repository_grants from public, anon, authenticated;
grant select, insert, update on agentproof_tenants, agentproof_tenant_members, agentproof_tenant_auth_sessions, agentproof_tenant_repository_grants to service_role;

-- Concierge registration must never merge into a pre-existing ordinary
-- onboarding grant. INSERT ... ON CONFLICT DO NOTHING is the atomic policy:
-- first registration gets manual-only defaults; every later registration
-- returns the existing row byte-for-byte at the settings boundary.
create or replace function agentproof_register_concierge_repository_grant(
  p_tenant_id text,
  p_installation_id bigint,
  p_repository_id bigint,
  p_repository_full_name text
)
returns table (
  outcome text,
  tenant_id text,
  installation_id bigint,
  repository_id bigint,
  repository_full_name text,
  enabled boolean,
  analysis_enabled boolean,
  comment_enabled boolean,
  save_reports_enabled boolean,
  slack_notifications_enabled boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  created boolean := false;
begin
  if p_tenant_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$'
    or p_installation_id <= 0 or p_repository_id <= 0
    or p_repository_full_name !~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' then
    raise exception 'invalid concierge repository metadata';
  end if;

  insert into public.agentproof_tenant_repository_grants (
    tenant_id, installation_id, repository_id, repository_full_name,
    enabled, analysis_enabled, comment_enabled, save_reports_enabled,
    slack_notifications_enabled
  ) values (
    p_tenant_id, p_installation_id, p_repository_id, p_repository_full_name,
    true, false, false, false, false
  ) on conflict on constraint agentproof_tenant_repository_grants_pkey do nothing;
  created := found;

  return query
    select
      case when created then 'created' else 'existing' end,
      grants.tenant_id, grants.installation_id, grants.repository_id,
      grants.repository_full_name, grants.enabled, grants.analysis_enabled,
      grants.comment_enabled, grants.save_reports_enabled,
      grants.slack_notifications_enabled
    from public.agentproof_tenant_repository_grants as grants
    where grants.tenant_id = p_tenant_id
      and grants.installation_id = p_installation_id
      and grants.repository_id = p_repository_id;
end;
$$;
revoke all on function agentproof_register_concierge_repository_grant(text, bigint, bigint, text) from public, anon, authenticated;
grant execute on function agentproof_register_concierge_repository_grant(text, bigint, bigint, text) to service_role;

create table if not exists agentproof_concierge_analysis_runs (
  request_key text primary key check (request_key ~ '^[a-f0-9]{64}$'),
  tenant_id text not null,
  installation_id bigint not null,
  repository_id bigint not null,
  status text not null check (status in ('reserved', 'completed', 'failed')),
  bounded_reason text not null check (bounded_reason ~ '^[a-z0-9_]{1,64}$'),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (request_key, tenant_id),
  foreign key (tenant_id, installation_id, repository_id) references agentproof_tenant_repository_grants(tenant_id, installation_id, repository_id)
);

alter table agentproof_concierge_analysis_runs enable row level security;
revoke all on agentproof_concierge_analysis_runs from public, anon, authenticated, service_role;

create or replace function agentproof_reserve_concierge_analysis(
  p_key text,
  p_tenant_id text,
  p_installation_id bigint,
  p_repository_id bigint
)
returns table (outcome text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_key !~ '^[a-f0-9]{64}$'
    or p_tenant_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$'
    or p_installation_id <= 0 or p_repository_id <= 0 then
    raise exception 'invalid concierge reservation metadata';
  end if;
  insert into public.agentproof_concierge_analysis_runs (
    request_key, tenant_id, installation_id, repository_id, status, bounded_reason
  ) values (
    p_key, p_tenant_id, p_installation_id, p_repository_id,
    'reserved', 'manual_analysis_reserved'
  ) on conflict do nothing;
  if found then return query select 'reserved'::text;
  else return query select 'duplicate'::text;
  end if;
end;
$$;

create or replace function agentproof_finish_concierge_analysis(
  p_key text,
  p_outcome text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_outcome not in ('completed', 'failed') or p_reason !~ '^[a-z0-9_]{1,64}$' then return false; end if;
  update public.agentproof_concierge_analysis_runs as runs
  set status = p_outcome, bounded_reason = p_reason, completed_at = now()
  where runs.request_key = p_key and runs.status = 'reserved';
  return found;
end;
$$;

revoke all on function agentproof_reserve_concierge_analysis(text, text, bigint, bigint) from public, anon, authenticated;
revoke all on function agentproof_finish_concierge_analysis(text, text, text) from public, anon, authenticated;
grant execute on function agentproof_reserve_concierge_analysis(text, text, bigint, bigint) to service_role;
grant execute on function agentproof_finish_concierge_analysis(text, text, text) to service_role;

create table if not exists agentproof_concierge_feedback (
  id bigint generated always as identity primary key,
  tenant_id text not null,
  schema_version text not null check (schema_version = 'concierge-feedback.v2'),
  partner_id text not null check (partner_id ~ '^partner_[A-Fa-f0-9]{8,55}$'),
  session_ordinal integer not null check (session_ordinal between 1 and 10000),
  case_id_or_hash text not null check (case_id_or_hash ~ '^[a-f0-9]{64}$'),
  task_source_quality text not null check (task_source_quality in ('explicit_task','linked_issue','unavailable','ambiguous')),
  pr_size_bucket text not null check (pr_size_bucket in ('small','medium','large')),
  pre_report_gap_category text not null check (pre_report_gap_category in ('implementation','targeted_test','execution','requirement','evidence_unavailable','none')),
  found_top_gap_within_30s boolean not null,
  time_to_top_gap_seconds integer check (time_to_top_gap_seconds between 0 and 3600),
  top_gap_agreement text not null check (top_gap_agreement in ('agree','partly','disagree','unclear')),
  first_inspection_action text not null check (first_inspection_action in ('file','check','requirement','none')),
  reprompt_action text not null check (reprompt_action in ('copied','edited','sent','not_used')),
  false_blocker boolean,
  usefulness integer not null check (usefulness between 1 and 5),
  operator_assisted boolean not null,
  operator_minutes_bucket text not null check (operator_minutes_bucket in ('0','1_5','6_15','16_plus')),
  actual_repeat_use_ordinal integer not null check (actual_repeat_use_ordinal between 1 and 10000),
  bounded_reason_category text not null check (bounded_reason_category in ('useful_gap','wrong_gap','missing_context','navigation','reprompt','other')),
  created_at timestamptz not null default now(),
  unique (tenant_id, partner_id, session_ordinal, case_id_or_hash),
  foreign key (case_id_or_hash, tenant_id) references agentproof_concierge_analysis_runs(request_key, tenant_id)
);
alter table public.agentproof_concierge_feedback drop column if exists optional_reason;
alter table public.agentproof_concierge_feedback
  drop constraint if exists agentproof_concierge_feedback_partner_id_check;
alter table public.agentproof_concierge_feedback
  add constraint agentproof_concierge_feedback_partner_id_check
  check (partner_id ~ '^partner_[A-Fa-f0-9]{8,55}$');
alter table public.agentproof_concierge_feedback
  drop constraint if exists agentproof_concierge_feedback_case_id_or_hash_check;
alter table public.agentproof_concierge_feedback
  add constraint agentproof_concierge_feedback_case_id_or_hash_check
  check (case_id_or_hash ~ '^[a-f0-9]{64}$');
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.agentproof_concierge_feedback'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (tenant_id, partner_id, session_ordinal, case_id_or_hash)'
  ) then
    alter table public.agentproof_concierge_feedback
      add constraint agentproof_concierge_feedback_event_identity_unique
      unique (tenant_id, partner_id, session_ordinal, case_id_or_hash);
  end if;
end;
$$;
alter table agentproof_concierge_feedback enable row level security;
revoke all on agentproof_concierge_feedback from public, anon, authenticated, service_role;

-- The first private-beta draft returned boolean. PostgreSQL cannot change a
-- function return type with CREATE OR REPLACE, so replace the bounded RPC
-- atomically instead of leaving upgrade deployments with the old contract.
drop function if exists public.agentproof_record_concierge_feedback(text, jsonb);
create or replace function agentproof_record_concierge_feedback(p_tenant_id text, p_feedback jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  field_count integer;
begin
  if jsonb_typeof(p_feedback) <> 'object' then return 'rejected'; end if;
  select count(*) into field_count from jsonb_object_keys(p_feedback);
  if field_count <> 18
    or not (p_feedback ?& array['schema_version','partner_id','session_ordinal','case_id_or_hash','task_source_quality','pr_size_bucket','pre_report_gap_category','found_top_gap_within_30s','time_to_top_gap_seconds','top_gap_agreement','first_inspection_action','reprompt_action','false_blocker','usefulness','operator_assisted','operator_minutes_bucket','actual_repeat_use_ordinal','bounded_reason_category'])
    or coalesce(p_feedback->>'schema_version','') <> 'concierge-feedback.v2'
    or coalesce(p_feedback->>'partner_id','') !~ '^partner_[A-Fa-f0-9]{8,55}$'
    or coalesce(p_feedback->>'case_id_or_hash','') !~ '^[a-f0-9]{64}$'
    or coalesce(p_feedback->>'session_ordinal','') !~ '^(?:[1-9][0-9]{0,3}|10000)$'
    or coalesce(p_feedback->>'actual_repeat_use_ordinal','') !~ '^(?:[1-9][0-9]{0,3}|10000)$'
    or coalesce(p_feedback->>'task_source_quality','') not in ('explicit_task','linked_issue','unavailable','ambiguous')
    or coalesce(p_feedback->>'pr_size_bucket','') not in ('small','medium','large')
    or coalesce(p_feedback->>'pre_report_gap_category','') not in ('implementation','targeted_test','execution','requirement','evidence_unavailable','none')
    or coalesce(p_feedback->>'top_gap_agreement','') not in ('agree','partly','disagree','unclear')
    or coalesce(p_feedback->>'first_inspection_action','') not in ('file','check','requirement','none')
    or coalesce(p_feedback->>'reprompt_action','') not in ('copied','edited','sent','not_used')
    or coalesce(p_feedback->>'operator_minutes_bucket','') not in ('0','1_5','6_15','16_plus')
    or coalesce(p_feedback->>'bounded_reason_category','') not in ('useful_gap','wrong_gap','missing_context','navigation','reprompt','other')
    or jsonb_typeof(p_feedback->'found_top_gap_within_30s') <> 'boolean'
    or jsonb_typeof(p_feedback->'operator_assisted') <> 'boolean'
    or jsonb_typeof(p_feedback->'false_blocker') not in ('boolean','null')
    or jsonb_typeof(p_feedback->'time_to_top_gap_seconds') not in ('number','null')
    or (p_feedback->>'time_to_top_gap_seconds' is not null and p_feedback->>'time_to_top_gap_seconds' !~ '^(0|[1-9][0-9]{0,3})$')
    or (coalesce(p_feedback->>'usefulness','') !~ '^[1-5]$')
    or not exists (
      select 1
      from public.agentproof_concierge_analysis_runs runs
      join public.agentproof_tenants tenants on tenants.tenant_id = runs.tenant_id and tenants.status in ('active','trialing','invite-only')
      join public.agentproof_github_installations installs on installs.tenant_id = runs.tenant_id and installs.installation_id = runs.installation_id and installs.status = 'active'
      join public.agentproof_tenant_repository_grants grants on grants.tenant_id = runs.tenant_id and grants.installation_id = runs.installation_id and grants.repository_id = runs.repository_id and grants.enabled
      where runs.request_key = p_feedback->>'case_id_or_hash' and runs.tenant_id = p_tenant_id and runs.status = 'completed'
    ) then return 'rejected';
  end if;
  insert into public.agentproof_concierge_feedback (
    tenant_id, schema_version, partner_id, session_ordinal, case_id_or_hash,
    task_source_quality, pr_size_bucket, pre_report_gap_category,
    found_top_gap_within_30s, time_to_top_gap_seconds, top_gap_agreement,
    first_inspection_action, reprompt_action, false_blocker, usefulness,
    operator_assisted, operator_minutes_bucket, actual_repeat_use_ordinal,
    bounded_reason_category
  ) values (
    p_tenant_id, p_feedback->>'schema_version', p_feedback->>'partner_id', (p_feedback->>'session_ordinal')::integer, p_feedback->>'case_id_or_hash',
    p_feedback->>'task_source_quality', p_feedback->>'pr_size_bucket', p_feedback->>'pre_report_gap_category',
    (p_feedback->>'found_top_gap_within_30s')::boolean, nullif(p_feedback->>'time_to_top_gap_seconds','')::integer, p_feedback->>'top_gap_agreement',
    p_feedback->>'first_inspection_action', p_feedback->>'reprompt_action', nullif(p_feedback->>'false_blocker','')::boolean, (p_feedback->>'usefulness')::integer,
    (p_feedback->>'operator_assisted')::boolean, p_feedback->>'operator_minutes_bucket', (p_feedback->>'actual_repeat_use_ordinal')::integer,
    p_feedback->>'bounded_reason_category'
  ) on conflict (tenant_id, partner_id, session_ordinal, case_id_or_hash) do nothing;
  if found then return 'stored'; end if;
  return 'duplicate';
exception when others then
  return 'rejected';
end;
$$;
revoke all on function agentproof_record_concierge_feedback(text, jsonb) from public, anon, authenticated;
grant execute on function agentproof_record_concierge_feedback(text, jsonb) to service_role;
