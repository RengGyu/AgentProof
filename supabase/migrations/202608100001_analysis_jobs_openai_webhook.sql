alter table public.agentproof_analysis_jobs
  add column if not exists provider_webhook_id_hash text,
  add column if not exists provider_webhook_received_at timestamptz;

alter table public.agentproof_analysis_jobs
  drop constraint if exists agentproof_analysis_jobs_provider_webhook_id_hash_check,
  add constraint agentproof_analysis_jobs_provider_webhook_id_hash_check
    check (provider_webhook_id_hash is null or provider_webhook_id_hash ~ '^[a-f0-9]{64}$');

create unique index if not exists agentproof_analysis_jobs_provider_response_id_idx
  on public.agentproof_analysis_jobs (provider_response_id)
  where provider_response_id is not null;
