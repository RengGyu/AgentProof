alter table public.agentproof_github_webhook_deliveries
  add column if not exists tenant_id text;

create index if not exists agentproof_github_webhook_deliveries_tenant_expires_idx
  on public.agentproof_github_webhook_deliveries (tenant_id, expires_at);
