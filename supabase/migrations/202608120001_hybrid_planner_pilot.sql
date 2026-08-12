-- Task 4: internal seed-binding metadata for the transport-disabled hybrid planner pilot.
-- This migration stores only frozen contract metadata and a SHA-256 seed hash.

alter table public.agentproof_tenant_repository_grants
  add column if not exists repository_is_private boolean,
  add column if not exists hybrid_planner_consent_version text;

alter table public.agentproof_tenant_repository_grants
  drop constraint if exists agentproof_tenant_repository_grants_hybrid_planner_consent_check,
  add constraint agentproof_tenant_repository_grants_hybrid_planner_consent_check check (
    hybrid_planner_consent_version is null
    or (
      hybrid_planner_consent_version = '2026-08-12.v1'
      and llm_analysis_mode = 'enhanced'
      and repository_is_private = true
    )
  );

-- This RPC serializes every app-owned settings mutation for the canonical
-- grant table. In particular, it cannot leave a hidden consent value behind
-- when mode is Essential or visibility is not explicitly private.
create or replace function public.agentproof_update_tenant_repository_grant_settings(
  p_tenant_id text,
  p_installation_id bigint,
  p_repository_id bigint,
  p_enabled boolean default null,
  p_analysis_enabled boolean default null,
  p_comment_enabled boolean default null,
  p_save_reports_enabled boolean default null,
  p_slack_notifications_enabled boolean default null,
  p_llm_analysis_mode text default null,
  p_hybrid_planner_consent_requested boolean default null
)
returns setof public.agentproof_tenant_repository_grants
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  existing public.agentproof_tenant_repository_grants%rowtype;
  effective_mode text;
  effective_consent text;
begin
  select * into existing
  from public.agentproof_tenant_repository_grants
  where tenant_id = p_tenant_id
    and installation_id = p_installation_id
    and repository_id = p_repository_id
  for update;

  if not found then
    raise exception 'tenant repository grant was not found';
  end if;
  if p_llm_analysis_mode is not null and p_llm_analysis_mode not in ('essential', 'enhanced') then
    raise exception 'tenant repository grant mode is invalid';
  end if;

  effective_mode := coalesce(p_llm_analysis_mode, existing.llm_analysis_mode, 'essential');
  if p_hybrid_planner_consent_requested = true
    and (effective_mode <> 'enhanced' or existing.repository_is_private is not true) then
    raise exception 'tenant repository grant consent is invalid for this repository mode';
  end if;

  if effective_mode <> 'enhanced' then
    effective_consent := null;
  elsif p_llm_analysis_mode = 'enhanced' then
    effective_consent := case when p_hybrid_planner_consent_requested = true then '2026-08-12.v1' else null end;
  elsif p_hybrid_planner_consent_requested = true then
    effective_consent := '2026-08-12.v1';
  elsif p_hybrid_planner_consent_requested = false then
    effective_consent := null;
  else
    effective_consent := existing.hybrid_planner_consent_version;
  end if;

  return query
  update public.agentproof_tenant_repository_grants
  set enabled = coalesce(p_enabled, existing.enabled),
      analysis_enabled = coalesce(p_analysis_enabled, existing.analysis_enabled),
      comment_enabled = coalesce(p_comment_enabled, existing.comment_enabled),
      save_reports_enabled = coalesce(p_save_reports_enabled, existing.save_reports_enabled),
      slack_notifications_enabled = coalesce(p_slack_notifications_enabled, existing.slack_notifications_enabled),
      llm_analysis_mode = effective_mode,
      hybrid_planner_consent_version = effective_consent,
      updated_at = now()
  where tenant_id = p_tenant_id
    and installation_id = p_installation_id
    and repository_id = p_repository_id
  returning *;
end;
$$;

revoke all on function public.agentproof_update_tenant_repository_grant_settings(text, bigint, bigint, boolean, boolean, boolean, boolean, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.agentproof_update_tenant_repository_grant_settings(text, bigint, bigint, boolean, boolean, boolean, boolean, boolean, text, boolean) to service_role;

alter table public.agentproof_analysis_jobs
  add column if not exists hybrid_planner_requested boolean not null default false,
  add column if not exists planner_contract_version text,
  add column if not exists planner_input_hash text;

alter table public.agentproof_analysis_jobs
  drop constraint if exists agentproof_analysis_jobs_planner_binding_check,
  add constraint agentproof_analysis_jobs_planner_binding_check check (
    (
      hybrid_planner_requested = false
      and planner_contract_version is null
      and planner_input_hash is null
    )
    or (
      hybrid_planner_requested = true
      and (
        (planner_contract_version is null and planner_input_hash is null)
        or (
          planner_contract_version = 'hybrid_requirement_planner.v1'
          and planner_input_hash ~ '^[a-f0-9]{64}$'
        )
      )
    )
  );

-- A new canonical revision must never inherit an old seed or live provider
-- continuation. It fires only for an actual successor revision, so a fresh
-- binding written on the current revision is never silently removed.
create or replace function public.agentproof_clear_hybrid_planner_binding_on_revision()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.desired_revision is distinct from old.desired_revision then
    new.planner_contract_version := null;
    new.planner_input_hash := null;
    new.provider_response_id := null;
    new.provider_status := null;
    new.provider_poll_attempts := 0;
    new.provider_submitted_at := null;
    new.provider_expires_at := null;
    new.provider_webhook_id_hash := null;
    new.provider_webhook_received_at := null;
    new.semantic_retry_attempts := 0;
    new.prior_provider_response_id := null;
    new.prior_provider_submitted_at := null;
    new.prior_provider_expires_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists agentproof_clear_hybrid_planner_binding_on_revision
  on public.agentproof_analysis_jobs;

create trigger agentproof_clear_hybrid_planner_binding_on_revision
before update on public.agentproof_analysis_jobs
for each row execute function public.agentproof_clear_hybrid_planner_binding_on_revision();

-- Replace the canonical enqueue RPC so the intent bit advances atomically with
-- the desired revision. The trigger above clears old bindings/continuations.
create or replace function public.agentproof_enqueue_analysis_job(job_payload jsonb)
returns setof public.agentproof_analysis_jobs
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  return query
  insert into public.agentproof_analysis_jobs (
    id, status, tenant_id, idempotency_key_hash, delivery_id, event, action,
    installation_id, repository_id, repository_full_name, pull_request_number,
    pull_request_url, head_sha, canonical_key_hash, is_historical, desired_revision,
    running_revision, sealed_revision, publication_sealed_at,
    sealed_delivery_id, sealed_event, sealed_action, sealed_save_report,
    sealed_comment, sealed_slack_summary,
    save_report, comment, slack_summary, attempts, created_at,
    updated_at, run_after, locked_at, completed_at, error_code, error_summary,
    result_summary, claim_generation, provider_response_id, provider_status,
    provider_poll_attempts, provider_submitted_at, provider_expires_at,
    provider_webhook_id_hash, provider_webhook_received_at,
    semantic_retry_attempts, prior_provider_response_id,
    prior_provider_submitted_at, prior_provider_expires_at,
    hybrid_planner_requested, planner_contract_version, planner_input_hash
  ) values (
    job_payload->>'id', 'queued', job_payload->>'tenant_id',
    job_payload->>'idempotency_key_hash', job_payload->>'delivery_id',
    job_payload->>'event', job_payload->>'action',
    (job_payload->>'installation_id')::bigint,
    (job_payload->>'repository_id')::bigint,
    job_payload->>'repository_full_name',
    (job_payload->>'pull_request_number')::integer,
    job_payload->>'pull_request_url', job_payload->>'head_sha',
    job_payload->>'canonical_key_hash', false, 1, null, null, null,
    null, null, null, null, null, null,
    coalesce((job_payload->>'save_report')::boolean, false),
    coalesce((job_payload->>'comment')::boolean, false),
    coalesce((job_payload->>'slack_summary')::boolean, false),
    0, (job_payload->>'created_at')::timestamptz,
    (job_payload->>'updated_at')::timestamptz,
    (job_payload->>'run_after')::timestamptz,
    null, null, null, null, null, null, null, null, 0, null, null, null, null,
    0, null, null, null,
    coalesce((job_payload->>'hybrid_planner_requested')::boolean, false), null, null
  )
  on conflict (canonical_key_hash) where is_historical = false do update set
    status = case when agentproof_analysis_jobs.status = 'processing' then 'processing' else 'queued' end,
    tenant_id = excluded.tenant_id,
    idempotency_key_hash = excluded.idempotency_key_hash,
    delivery_id = excluded.delivery_id,
    event = excluded.event,
    action = excluded.action,
    repository_id = excluded.repository_id,
    repository_full_name = excluded.repository_full_name,
    pull_request_url = excluded.pull_request_url,
    save_report = excluded.save_report,
    comment = excluded.comment,
    slack_summary = excluded.slack_summary,
    hybrid_planner_requested = excluded.hybrid_planner_requested,
    desired_revision = agentproof_analysis_jobs.desired_revision + 1,
    running_revision = case when agentproof_analysis_jobs.status = 'processing' then agentproof_analysis_jobs.running_revision else null end,
    sealed_revision = case when agentproof_analysis_jobs.status = 'processing' then agentproof_analysis_jobs.sealed_revision else null end,
    publication_sealed_at = case when agentproof_analysis_jobs.status = 'processing' then agentproof_analysis_jobs.publication_sealed_at else null end,
    sealed_delivery_id = case when agentproof_analysis_jobs.status = 'processing' then agentproof_analysis_jobs.sealed_delivery_id else null end,
    sealed_event = case when agentproof_analysis_jobs.status = 'processing' then agentproof_analysis_jobs.sealed_event else null end,
    sealed_action = case when agentproof_analysis_jobs.status = 'processing' then agentproof_analysis_jobs.sealed_action else null end,
    sealed_save_report = case when agentproof_analysis_jobs.status = 'processing' then agentproof_analysis_jobs.sealed_save_report else null end,
    sealed_comment = case when agentproof_analysis_jobs.status = 'processing' then agentproof_analysis_jobs.sealed_comment else null end,
    sealed_slack_summary = case when agentproof_analysis_jobs.status = 'processing' then agentproof_analysis_jobs.sealed_slack_summary else null end,
    attempts = case when agentproof_analysis_jobs.status = 'processing' then agentproof_analysis_jobs.attempts else 0 end,
    updated_at = excluded.updated_at,
    run_after = excluded.run_after,
    locked_at = case when agentproof_analysis_jobs.status = 'processing' then agentproof_analysis_jobs.locked_at else null end,
    completed_at = null,
    error_code = null,
    error_summary = null,
    result_summary = null,
    claim_generation = case when agentproof_analysis_jobs.status = 'processing' then agentproof_analysis_jobs.claim_generation else null end,
    provider_response_id = case when agentproof_analysis_jobs.status = 'processing' then agentproof_analysis_jobs.provider_response_id else null end,
    provider_status = case when agentproof_analysis_jobs.status = 'processing' then agentproof_analysis_jobs.provider_status else null end,
    provider_poll_attempts = case when agentproof_analysis_jobs.status = 'processing' then agentproof_analysis_jobs.provider_poll_attempts else 0 end,
    provider_submitted_at = case when agentproof_analysis_jobs.status = 'processing' then agentproof_analysis_jobs.provider_submitted_at else null end,
    provider_expires_at = case when agentproof_analysis_jobs.status = 'processing' then agentproof_analysis_jobs.provider_expires_at else null end,
    provider_webhook_id_hash = case when agentproof_analysis_jobs.status = 'processing' then agentproof_analysis_jobs.provider_webhook_id_hash else null end,
    provider_webhook_received_at = case when agentproof_analysis_jobs.status = 'processing' then agentproof_analysis_jobs.provider_webhook_received_at else null end,
    semantic_retry_attempts = case when agentproof_analysis_jobs.status = 'processing' then agentproof_analysis_jobs.semantic_retry_attempts else 0 end,
    prior_provider_response_id = case when agentproof_analysis_jobs.status = 'processing' then agentproof_analysis_jobs.prior_provider_response_id else null end,
    prior_provider_submitted_at = case when agentproof_analysis_jobs.status = 'processing' then agentproof_analysis_jobs.prior_provider_submitted_at else null end,
    prior_provider_expires_at = case when agentproof_analysis_jobs.status = 'processing' then agentproof_analysis_jobs.prior_provider_expires_at else null end
  returning *;
end;
$$;

revoke all on function public.agentproof_enqueue_analysis_job(jsonb) from public, anon, authenticated;
grant execute on function public.agentproof_enqueue_analysis_job(jsonb) to service_role;
