create table if not exists public.agentproof_analysis_jobs (
  id text primary key,
  status text not null check (status in ('queued', 'processing', 'completed', 'failed_retryable', 'failed_terminal')),
  tenant_id text,
  idempotency_key_hash text not null,
  delivery_id text,
  event text not null,
  action text,
  installation_id bigint not null,
  repository_id bigint,
  repository_full_name text not null,
  pull_request_number integer not null,
  pull_request_url text not null,
  head_sha text not null,
  save_report boolean not null default false,
  comment boolean not null default false,
  slack_summary boolean not null default false,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_summary text,
  result_summary jsonb,
  claim_generation text,
  provider_response_id text,
  provider_status text,
  provider_poll_attempts integer not null default 0,
  provider_submitted_at timestamptz,
  provider_expires_at timestamptz
);

alter table public.agentproof_analysis_jobs
  add column if not exists claim_generation text,
  add column if not exists provider_response_id text,
  add column if not exists provider_status text,
  add column if not exists provider_poll_attempts integer not null default 0,
  add column if not exists provider_submitted_at timestamptz,
  add column if not exists provider_expires_at timestamptz;

alter table public.agentproof_analysis_jobs
  drop constraint if exists agentproof_analysis_jobs_provider_status_check,
  add constraint agentproof_analysis_jobs_provider_status_check
    check (provider_status is null or provider_status in ('submitting', 'queued', 'in_progress')),
  drop constraint if exists agentproof_analysis_jobs_provider_poll_attempts_check,
  add constraint agentproof_analysis_jobs_provider_poll_attempts_check
    check (provider_poll_attempts between 0 and 100),
  drop constraint if exists agentproof_analysis_jobs_provider_response_id_check,
  add constraint agentproof_analysis_jobs_provider_response_id_check
    check (provider_response_id is null or provider_response_id ~ '^resp_[A-Za-z0-9_-]{1,180}$');

alter table public.agentproof_analysis_jobs
  drop constraint if exists agentproof_analysis_jobs_claim_generation_check,
  add constraint agentproof_analysis_jobs_claim_generation_check
    check (claim_generation is null or claim_generation ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');

create index if not exists agentproof_analysis_jobs_status_run_after_idx
  on public.agentproof_analysis_jobs (status, run_after);

create index if not exists agentproof_analysis_jobs_tenant_created_idx
  on public.agentproof_analysis_jobs (tenant_id, created_at desc);

create index if not exists agentproof_analysis_jobs_status_updated_idx
  on public.agentproof_analysis_jobs (status, updated_at);

alter table public.agentproof_analysis_jobs enable row level security;

revoke all on table public.agentproof_analysis_jobs from anon, authenticated;
grant select, insert, update, delete on table public.agentproof_analysis_jobs to service_role;
