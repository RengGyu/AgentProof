-- Automatic webhook events may refresh a queued head, but cannot restart a processing or completed head.
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
  where coalesce((job_payload->>'once_per_head')::boolean, false) = false
    or agentproof_analysis_jobs.status = 'queued'
  returning *;

  if not found then
    return query
    select * from public.agentproof_analysis_jobs
    where canonical_key_hash = job_payload->>'canonical_key_hash'
      and is_historical = false;
  end if;
end;
$$;

revoke all on function public.agentproof_enqueue_analysis_job(jsonb) from public, anon, authenticated;
grant execute on function public.agentproof_enqueue_analysis_job(jsonb) to service_role;
