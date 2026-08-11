-- Canonical PR-head queue revisions and bounded recovery scheduling.
-- Before applying in production, create these Vault secrets without putting
-- their values in SQL or source control:
--   agentproof_analysis_worker_url        (deployment origin, no trailing slash)
--   agentproof_analysis_worker_cron_token (same value as AGENTPROOF_CRON_TOKEN)

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

alter table public.agentproof_analysis_jobs
  add column if not exists canonical_key_hash text,
  add column if not exists desired_revision bigint,
  add column if not exists running_revision bigint,
  add column if not exists sealed_revision bigint,
  add column if not exists publication_sealed_at timestamptz;

update public.agentproof_analysis_jobs
set
  canonical_key_hash = encode(extensions.digest(
    concat_ws(
      chr(31),
      coalesce(tenant_id, 'operator'),
      installation_id::text,
      case
        when repository_id is not null then 'id:' || repository_id::text
        else 'name:' || lower(repository_full_name)
      end,
      pull_request_number::text,
      lower(head_sha)
    ),
    'sha256'
  ), 'hex'),
  desired_revision = coalesce(desired_revision, 1),
  running_revision = case
    when status = 'processing' then coalesce(running_revision, desired_revision, 1)
    else null
  end
where canonical_key_hash is null
   or desired_revision is null
   or (status = 'processing' and running_revision is null);

-- Preserve every older delivery-specific row. The freshest row retains the
-- canonical identity; material history and active continuations receive a
-- deterministic, non-conflicting legacy identity without changing any status,
-- result, claim, or provider metadata.
with ranked as (
  select id, canonical_key_hash, row_number() over (
    partition by canonical_key_hash
    order by updated_at desc, created_at desc, id desc
  ) as position
  from public.agentproof_analysis_jobs
)
update public.agentproof_analysis_jobs jobs
set canonical_key_hash = encode(extensions.digest(
  concat_ws(chr(31), 'legacy', ranked.canonical_key_hash, jobs.id),
  'sha256'
), 'hex')
from ranked
where jobs.id = ranked.id and ranked.position > 1;

alter table public.agentproof_analysis_jobs
  alter column canonical_key_hash set not null,
  alter column desired_revision set default 1,
  alter column desired_revision set not null,
  drop constraint if exists agentproof_analysis_jobs_canonical_key_hash_check,
  add constraint agentproof_analysis_jobs_canonical_key_hash_check
    check (canonical_key_hash ~ '^[a-f0-9]{64}$'),
  drop constraint if exists agentproof_analysis_jobs_desired_revision_check,
  add constraint agentproof_analysis_jobs_desired_revision_check
    check (desired_revision between 1 and 9223372036854775807),
  drop constraint if exists agentproof_analysis_jobs_running_revision_check,
  add constraint agentproof_analysis_jobs_running_revision_check
    check (running_revision is null or running_revision between 1 and desired_revision),
  drop constraint if exists agentproof_analysis_jobs_running_revision_status_check,
  add constraint agentproof_analysis_jobs_running_revision_status_check
    check ((status = 'processing') = (running_revision is not null)),
  drop constraint if exists agentproof_analysis_jobs_sealed_revision_check,
  add constraint agentproof_analysis_jobs_sealed_revision_check
    check (
      sealed_revision is null
      or (status = 'processing' and sealed_revision = running_revision)
    ),
  drop constraint if exists agentproof_analysis_jobs_publication_seal_check,
  add constraint agentproof_analysis_jobs_publication_seal_check
    check ((sealed_revision is null) = (publication_sealed_at is null));

create unique index agentproof_analysis_jobs_canonical_key_idx
  on public.agentproof_analysis_jobs (canonical_key_hash);

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
    pull_request_url, head_sha, canonical_key_hash, desired_revision,
    running_revision, sealed_revision, publication_sealed_at,
    save_report, comment, slack_summary, attempts, created_at,
    updated_at, run_after, locked_at, completed_at, error_code, error_summary,
    result_summary, claim_generation, provider_response_id, provider_status,
    provider_poll_attempts, provider_submitted_at, provider_expires_at,
    provider_webhook_id_hash, provider_webhook_received_at,
    semantic_retry_attempts, prior_provider_response_id,
    prior_provider_submitted_at, prior_provider_expires_at
  ) values (
    job_payload->>'id', 'queued', job_payload->>'tenant_id',
    job_payload->>'idempotency_key_hash', job_payload->>'delivery_id',
    job_payload->>'event', job_payload->>'action',
    (job_payload->>'installation_id')::bigint,
    (job_payload->>'repository_id')::bigint,
    job_payload->>'repository_full_name',
    (job_payload->>'pull_request_number')::integer,
    job_payload->>'pull_request_url', job_payload->>'head_sha',
    job_payload->>'canonical_key_hash', 1, null, null, null,
    coalesce((job_payload->>'save_report')::boolean, false),
    coalesce((job_payload->>'comment')::boolean, false),
    coalesce((job_payload->>'slack_summary')::boolean, false),
    0, (job_payload->>'created_at')::timestamptz,
    (job_payload->>'updated_at')::timestamptz,
    (job_payload->>'run_after')::timestamptz,
    null, null, null, null, null, null, null, null, 0, null, null, null, null,
    0, null, null, null
  )
  on conflict (canonical_key_hash) do update set
    status = case
      when agentproof_analysis_jobs.status = 'processing' then 'processing'
      else 'queued'
    end,
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
    desired_revision = agentproof_analysis_jobs.desired_revision + 1,
    running_revision = case
      when agentproof_analysis_jobs.status = 'processing' then agentproof_analysis_jobs.running_revision
      else null
    end,
    sealed_revision = case when agentproof_analysis_jobs.status = 'processing' then agentproof_analysis_jobs.sealed_revision else null end,
    publication_sealed_at = case when agentproof_analysis_jobs.status = 'processing' then agentproof_analysis_jobs.publication_sealed_at else null end,
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

create or replace function public.agentproof_fence_analysis_job_revision(
  job_id text,
  claim_token text,
  claim_revision bigint,
  fence_time timestamptz
)
returns setof public.agentproof_analysis_jobs
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  current_job public.agentproof_analysis_jobs%rowtype;
begin
  select * into current_job
  from public.agentproof_analysis_jobs
  where id = job_id
  for update;

  if not found
     or current_job.status <> 'processing'
     or current_job.claim_generation is distinct from claim_token
     or current_job.running_revision is distinct from claim_revision then
    return;
  end if;

  if current_job.sealed_revision = claim_revision then
    return next current_job;
    return;
  end if;

  if current_job.desired_revision <> claim_revision then
    update public.agentproof_analysis_jobs set
      status = 'queued', attempts = 0, updated_at = fence_time,
      locked_at = null, completed_at = null, error_code = null,
      error_summary = null, result_summary = null, claim_generation = null,
      running_revision = null, sealed_revision = null,
      publication_sealed_at = null, provider_response_id = null,
      provider_status = null, provider_poll_attempts = 0,
      provider_submitted_at = null, provider_expires_at = null,
      provider_webhook_id_hash = null, provider_webhook_received_at = null,
      semantic_retry_attempts = 0, prior_provider_response_id = null,
      prior_provider_submitted_at = null, prior_provider_expires_at = null
    where id = job_id;
    return;
  end if;

  return next current_job;
end;
$$;

create or replace function public.agentproof_seal_analysis_job_revision(
  job_id text,
  claim_token text,
  claim_revision bigint,
  seal_time timestamptz
)
returns setof public.agentproof_analysis_jobs
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  current_job public.agentproof_analysis_jobs%rowtype;
begin
  select * into current_job from public.agentproof_analysis_jobs
  where id = job_id for update;

  if not found or current_job.status <> 'processing'
     or current_job.claim_generation is distinct from claim_token
     or current_job.running_revision is distinct from claim_revision then
    return;
  end if;
  if current_job.sealed_revision = claim_revision then
    return next current_job;
    return;
  end if;
  if current_job.sealed_revision is not null
     or current_job.desired_revision <> claim_revision then
    if current_job.sealed_revision is null then
      update public.agentproof_analysis_jobs set
        status = 'queued', attempts = 0, updated_at = seal_time,
        locked_at = null, completed_at = null, error_code = null,
        error_summary = null, result_summary = null, claim_generation = null,
        running_revision = null, sealed_revision = null,
        publication_sealed_at = null, provider_response_id = null,
        provider_status = null, provider_poll_attempts = 0,
        provider_submitted_at = null, provider_expires_at = null,
        provider_webhook_id_hash = null, provider_webhook_received_at = null,
        semantic_retry_attempts = 0, prior_provider_response_id = null,
        prior_provider_submitted_at = null, prior_provider_expires_at = null
      where id = job_id;
    end if;
    return;
  end if;

  update public.agentproof_analysis_jobs set
    sealed_revision = claim_revision,
    publication_sealed_at = seal_time,
    updated_at = seal_time,
    locked_at = seal_time
  where id = job_id
  returning * into current_job;
  return next current_job;
end;
$$;

create or replace function public.agentproof_complete_analysis_job(
  job_id text,
  claim_token text,
  result_payload jsonb,
  finish_time timestamptz
)
returns setof public.agentproof_analysis_jobs
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  current_job public.agentproof_analysis_jobs%rowtype;
  was_sealed boolean;
begin
  select * into current_job from public.agentproof_analysis_jobs
  where id = job_id for update;
  if not found or current_job.status <> 'processing'
     or current_job.claim_generation is distinct from claim_token
     or current_job.running_revision is null then
    return;
  end if;
  was_sealed := current_job.sealed_revision = current_job.running_revision;
  if current_job.sealed_revision is not null and not was_sealed then return; end if;

  if current_job.desired_revision <> current_job.running_revision then
    update public.agentproof_analysis_jobs set
      status = 'queued', attempts = 0, updated_at = finish_time,
      locked_at = null, completed_at = null, error_code = null,
      error_summary = null, result_summary = null, claim_generation = null,
      running_revision = null, sealed_revision = null,
      publication_sealed_at = null, provider_response_id = null,
      provider_status = null, provider_poll_attempts = 0,
      provider_submitted_at = null, provider_expires_at = null,
      provider_webhook_id_hash = null, provider_webhook_received_at = null,
      semantic_retry_attempts = 0, prior_provider_response_id = null,
      prior_provider_submitted_at = null, prior_provider_expires_at = null
    where id = job_id returning * into current_job;
    if was_sealed then return next current_job; end if;
    return;
  end if;

  update public.agentproof_analysis_jobs set
    status = 'completed', updated_at = finish_time, completed_at = finish_time,
    locked_at = null, error_code = null, error_summary = null,
    result_summary = result_payload, claim_generation = null,
    running_revision = null, sealed_revision = null,
    publication_sealed_at = null, provider_response_id = null,
    provider_status = null, provider_poll_attempts = 0,
    provider_submitted_at = null, provider_expires_at = null,
    provider_webhook_id_hash = null, provider_webhook_received_at = null,
    semantic_retry_attempts = 0, prior_provider_response_id = null,
    prior_provider_submitted_at = null, prior_provider_expires_at = null
  where id = job_id returning * into current_job;
  return next current_job;
end;
$$;

create or replace function public.agentproof_fail_analysis_job(
  job_id text,
  claim_token text,
  retryable_failure boolean,
  failure_code text,
  failure_summary text,
  fail_time timestamptz,
  retry_after_ms bigint,
  maximum_attempts integer
)
returns setof public.agentproof_analysis_jobs
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  current_job public.agentproof_analysis_jobs%rowtype;
  was_sealed boolean;
  should_retry boolean;
begin
  select * into current_job from public.agentproof_analysis_jobs
  where id = job_id for update;
  if not found or current_job.status <> 'processing'
     or current_job.claim_generation is distinct from claim_token
     or current_job.running_revision is null then return; end if;
  was_sealed := current_job.sealed_revision = current_job.running_revision;
  if current_job.sealed_revision is not null and not was_sealed then return; end if;

  if current_job.desired_revision <> current_job.running_revision then
    update public.agentproof_analysis_jobs set
      status = 'queued', attempts = 0, updated_at = fail_time,
      locked_at = null, completed_at = null, error_code = null,
      error_summary = null, result_summary = null, claim_generation = null,
      running_revision = null, sealed_revision = null,
      publication_sealed_at = null, provider_response_id = null,
      provider_status = null, provider_poll_attempts = 0,
      provider_submitted_at = null, provider_expires_at = null,
      provider_webhook_id_hash = null, provider_webhook_received_at = null,
      semantic_retry_attempts = 0, prior_provider_response_id = null,
      prior_provider_submitted_at = null, prior_provider_expires_at = null
    where id = job_id returning * into current_job;
    if was_sealed then return next current_job; end if;
    return;
  end if;

  should_retry := retryable_failure and current_job.attempts < maximum_attempts;
  update public.agentproof_analysis_jobs set
    status = case when should_retry then 'failed_retryable' else 'failed_terminal' end,
    updated_at = fail_time,
    run_after = case when should_retry then fail_time + retry_after_ms * interval '1 millisecond' else fail_time end,
    locked_at = null, error_code = failure_code, error_summary = failure_summary,
    result_summary = null, claim_generation = null, running_revision = null,
    sealed_revision = null, publication_sealed_at = null,
    provider_response_id = case when should_retry then provider_response_id else null end,
    provider_status = case when should_retry then provider_status else null end,
    provider_poll_attempts = case when should_retry then provider_poll_attempts else 0 end,
    provider_submitted_at = case when should_retry then provider_submitted_at else null end,
    provider_expires_at = case when should_retry then provider_expires_at else null end,
    provider_webhook_id_hash = case when should_retry then provider_webhook_id_hash else null end,
    provider_webhook_received_at = case when should_retry then provider_webhook_received_at else null end,
    semantic_retry_attempts = case when should_retry then semantic_retry_attempts else 0 end,
    prior_provider_response_id = case when should_retry then prior_provider_response_id else null end,
    prior_provider_submitted_at = case when should_retry then prior_provider_submitted_at else null end,
    prior_provider_expires_at = case when should_retry then prior_provider_expires_at else null end
  where id = job_id returning * into current_job;
  return next current_job;
end;
$$;

revoke all on function public.agentproof_enqueue_analysis_job(jsonb) from public, anon, authenticated;
grant execute on function public.agentproof_enqueue_analysis_job(jsonb) to service_role;
revoke all on function public.agentproof_fence_analysis_job_revision(text, text, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.agentproof_fence_analysis_job_revision(text, text, bigint, timestamptz) to service_role;
revoke all on function public.agentproof_seal_analysis_job_revision(text, text, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.agentproof_seal_analysis_job_revision(text, text, bigint, timestamptz) to service_role;
revoke all on function public.agentproof_complete_analysis_job(text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.agentproof_complete_analysis_job(text, text, jsonb, timestamptz) to service_role;
revoke all on function public.agentproof_fail_analysis_job(text, text, boolean, text, text, timestamptz, bigint, integer) from public, anon, authenticated;
grant execute on function public.agentproof_fail_analysis_job(text, text, boolean, text, text, timestamptz, bigint, integer) to service_role;

do $$
begin
  if exists (select 1 from vault.decrypted_secrets where name = 'agentproof_analysis_worker_url')
     and exists (select 1 from vault.decrypted_secrets where name = 'agentproof_analysis_worker_cron_token') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'agentproof-analysis-recovery';

    perform cron.schedule(
      'agentproof-analysis-recovery',
      '* * * * *',
      $command$
        select net.http_get(
          url := rtrim((select decrypted_secret from vault.decrypted_secrets where name = 'agentproof_analysis_worker_url'), '/') || '/api/cron/analysis-jobs/run',
          headers := jsonb_build_object(
            'x-agentproof-cron-token',
            (select decrypted_secret from vault.decrypted_secrets where name = 'agentproof_analysis_worker_cron_token')
          ),
          timeout_milliseconds := 120000
        );
      $command$
    );
  else
    raise notice 'AgentProof recovery cron not scheduled: create both documented Vault secrets, then re-run this migration schedule block.';
  end if;
end;
$$;
