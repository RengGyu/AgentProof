-- Compatibility baseline for the previously deployed four-column report table.
-- The fields are opaque access metadata only: raw reports remain in `report`,
-- and raw tokens are never written (only an optional SHA-256 hash).
alter table public.agentproof_saved_reports
  add column if not exists tenant_id text,
  add column if not exists access_token_hash text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'agentproof_saved_reports_tenant_access_check'
      and conrelid = 'public.agentproof_saved_reports'::regclass
  ) then
    alter table public.agentproof_saved_reports
      add constraint agentproof_saved_reports_tenant_access_check
      check (
        (tenant_id is null and access_token_hash is null)
        or (
          tenant_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$'
          and (access_token_hash is null or access_token_hash ~ '^[a-f0-9]{64}$')
        )
      ) not valid;
  end if;
end
$$;

-- Reports are accessed only through server-side service-role routes.
alter table public.agentproof_saved_reports enable row level security;
revoke all on table public.agentproof_saved_reports from anon, authenticated;
