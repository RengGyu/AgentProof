alter table public.agentproof_analysis_jobs
  add column if not exists semantic_retry_attempts integer not null default 0,
  add column if not exists prior_provider_response_id text,
  add column if not exists prior_provider_submitted_at timestamptz,
  add column if not exists prior_provider_expires_at timestamptz;

alter table public.agentproof_analysis_jobs
  drop constraint if exists agentproof_analysis_jobs_semantic_retry_attempts_check,
  add constraint agentproof_analysis_jobs_semantic_retry_attempts_check
    check (semantic_retry_attempts between 0 and 1),
  drop constraint if exists agentproof_analysis_jobs_prior_provider_response_id_check,
  add constraint agentproof_analysis_jobs_prior_provider_response_id_check
    check (
      prior_provider_response_id is null
      or prior_provider_response_id ~ '^resp_[A-Za-z0-9_-]{1,180}$'
    ),
  drop constraint if exists agentproof_analysis_jobs_prior_provider_continuation_check,
  add constraint agentproof_analysis_jobs_prior_provider_continuation_check
    check (
      (
        semantic_retry_attempts = 0
        and prior_provider_response_id is null
        and prior_provider_submitted_at is null
        and prior_provider_expires_at is null
      )
      or
      (
        semantic_retry_attempts = 1
        and prior_provider_response_id is not null
        and prior_provider_submitted_at is not null
        and prior_provider_expires_at is not null
        and prior_provider_expires_at > prior_provider_submitted_at
        and prior_provider_expires_at <= prior_provider_submitted_at + interval '10 minutes'
      )
    );

alter table public.agentproof_analysis_jobs enable row level security;

revoke all on table public.agentproof_analysis_jobs from anon, authenticated;
grant select, insert, update, delete on table public.agentproof_analysis_jobs to service_role;
