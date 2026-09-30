-- Apply after the account, mobile, report/job and enabled service-store schemas.
-- All tenant-owned stores must be in this database, using the default names.
-- These two documented service stores may not have been provisioned by an
-- earlier migration. Create them before installing write guards and purging.
create table if not exists public.agentproof_usage_records (
  id text primary key,
  tenant_id text not null,
  period text not null,
  feature text not null check (feature in ('github_app_analysis')),
  idempotency_key_hash text not null,
  created_at timestamptz not null
);
create index if not exists agentproof_usage_records_tenant_period_feature_idx
  on public.agentproof_usage_records (tenant_id, period, feature);
create unique index if not exists agentproof_usage_records_unique_delivery_idx
  on public.agentproof_usage_records (tenant_id, period, feature, idempotency_key_hash);
alter table public.agentproof_usage_records enable row level security;
revoke all on public.agentproof_usage_records from public, anon, authenticated;
grant select, insert, update, delete on public.agentproof_usage_records to service_role;

create table if not exists public.agentproof_audit_events (
  id text primary key,
  created_at timestamptz not null,
  actor text not null check (actor in ('github_app', 'system')),
  action text not null,
  result text not null check (result in ('blocked', 'completed', 'failed', 'skipped')),
  tenant_id text,
  repository_full_name text,
  installation_id bigint,
  pull_request_number integer,
  head_sha_prefix text,
  request_id text,
  status_code integer,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists agentproof_audit_events_tenant_created_idx
  on public.agentproof_audit_events (tenant_id, created_at desc);
alter table public.agentproof_audit_events enable row level security;
revoke all on public.agentproof_audit_events from public, anon, authenticated;
grant select, insert, update, delete on public.agentproof_audit_events to service_role;

alter table public.agentproof_tenant_deletion_state
  add column if not exists self_service boolean not null default false,
  add column if not exists required_tables text[] not null default '{}';
-- A short-lived status receipt contains no account/identity data. Old tokens
-- can confirm completion, but cannot regain access to any service data.
create table if not exists public.agentproof_personal_deletion_receipts (
  token_hash text primary key, source text not null check(source in ('github','mobile')),
  expires_at timestamptz not null
);
alter table public.agentproof_personal_deletion_receipts enable row level security;
revoke all on public.agentproof_personal_deletion_receipts from public,anon,authenticated,service_role;

create or replace function public.agentproof_personal_deletion_tables()
returns text[] language sql immutable set search_path = '' as $$
 select array['agentproof_concierge_feedback','agentproof_concierge_analysis_runs',
 'agentproof_saved_reports','agentproof_analysis_jobs','agentproof_mobile_handoff_codes',
 'agentproof_github_installation_claims','agentproof_github_onboarding_states',
 'agentproof_github_webhook_deliveries','agentproof_usage_records','agentproof_audit_events',
 'agentproof_billing_webhook_events','agentproof_billing_subscriptions',
 'agentproof_tenant_repository_grants','agentproof_concierge_github_sessions',
 'agentproof_github_installations',
 'agentproof_github_identities','agentproof_tenant_auth_sessions','agentproof_tenant_members']::text[];
$$;

create or replace function public.agentproof_guard_personal_data_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare t text := new.tenant_id; pending boolean;
begin
 if tg_op = 'UPDATE' and old.tenant_id is distinct from t and (old.tenant_id ~ '^(gh_|acct_)' or t ~ '^(gh_|acct_)') then
   raise exception 'personal tenant reassignment is forbidden';
 end if;
 if t is null or t !~ '^(gh_|acct_)' then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended(t, 8129));
 if not exists(select 1 from public.agentproof_tenants where tenant_id=t) then
   raise exception 'personal account is unavailable';
 end if;
 select exists(select 1 from public.agentproof_tenant_deletion_state where tenant_id=t and status='active') into pending;
 if pending then
   -- Revocation may only reduce access, never refresh or restore a session.
   if tg_op='UPDATE' and tg_table_name='agentproof_tenant_auth_sessions' then
     if to_jsonb(new)->>'revoked_at' is not null
       and to_jsonb(new)->>'github_access_ciphertext' is null and to_jsonb(new)->>'github_refresh_ciphertext' is null
       and (to_jsonb(new)-array['revoked_at','github_access_ciphertext','github_refresh_ciphertext','github_refresh_lease_owner','github_refresh_lease_until'])
         = (to_jsonb(old)-array['revoked_at','github_access_ciphertext','github_refresh_ciphertext','github_refresh_lease_owner','github_refresh_lease_until']) then return new; end if;
   end if;
   -- Verified OAuth may issue a deletion-only session/handoff for retry. The
   -- suspended account cannot use normal authenticated APIs. No OAuth secrets.
   if tg_op='INSERT' and tg_table_name in ('agentproof_tenant_auth_sessions','agentproof_mobile_handoff_codes')
     and exists(select 1 from public.agentproof_github_identities i where i.tenant_id=t and i.member_id=new.member_id) then
     if tg_table_name='agentproof_mobile_handoff_codes' then return new; end if;
     if to_jsonb(new)->>'auth_source' in ('github','mobile')
       and to_jsonb(new)->>'github_access_ciphertext' is null
       and to_jsonb(new)->>'github_refresh_ciphertext' is null then return new; end if;
   end if;
   raise exception 'personal account deletion is in progress';
 end if;
 return new;
end;
$$;

do $$ declare t text; begin
 foreach t in array public.agentproof_personal_deletion_tables() loop
   if to_regclass('public.'||t) is not null then
     execute format('drop trigger if exists agentproof_personal_write_guard on public.%I',t);
     execute format('create trigger agentproof_personal_write_guard before insert or update on public.%I for each row execute function public.agentproof_guard_personal_data_write()',t);
   end if;
 end loop;
end $$;

-- Refuse unsupported or incomplete schemas, including on scheduled retries.
create or replace function public.agentproof_personal_deletion_ready(p_required text[] default '{}')
returns boolean language plpgsql security definer set search_path = '' as $$
declare tab text;
begin
 if exists(select 1 from information_schema.columns where table_schema='public' and column_name='tenant_id'
   and table_name like 'agentproof_%' and table_name not in ('agentproof_tenants','agentproof_tenant_deletion_state')
   and table_name<>all(public.agentproof_personal_deletion_tables())) then return false; end if;
 foreach tab in array public.agentproof_personal_deletion_tables() loop
   if (to_regclass('public.'||tab) is null and
       (tab not in ('agentproof_billing_webhook_events','agentproof_billing_subscriptions','agentproof_concierge_github_sessions')
        or tab=any(p_required)))
     or (to_regclass('public.'||tab) is not null and not exists(select 1 from pg_trigger
     where tgrelid=to_regclass('public.'||tab) and tgname='agentproof_personal_write_guard' and tgenabled='O')) then return false; end if;
 end loop;
 return exists(select 1 from pg_trigger where tgrelid='public.agentproof_tenants'::regclass
   and tgname='agentproof_personal_account_guard' and tgenabled='O');
end;
$$;

create or replace function public.agentproof_guard_personal_account()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(old.tenant_id,8129));
 if exists(select 1 from public.agentproof_tenant_deletion_state where tenant_id=old.tenant_id and status='active')
   and (new.status<>'suspended' or new.tenant_id<>old.tenant_id) then
   raise exception 'personal account deletion is in progress';
 end if;
 return new;
end;
$$;
drop trigger if exists agentproof_personal_account_guard on public.agentproof_tenants;
create trigger agentproof_personal_account_guard before update on public.agentproof_tenants
 for each row execute function public.agentproof_guard_personal_account();

create or replace function public.agentproof_finish_personal_deletion(p_tenant text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t text; busy boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_tenant,8129));
 if not exists(select 1 from public.agentproof_tenant_deletion_state where tenant_id=p_tenant and self_service and status='active') then
   raise exception 'self-service deletion was not authorized';
 end if;
 if not public.agentproof_personal_deletion_ready((select required_tables from public.agentproof_tenant_deletion_state where tenant_id=p_tenant)) then raise exception 'account deletion storage setup required'; end if;
 -- Any concurrent late writes are rejected by the installed database guards.
 -- Allow an existing worker/provider request to drain before erasing its row.
 if to_regclass('public.agentproof_analysis_jobs') is not null then
   select exists(select 1 from public.agentproof_analysis_jobs where tenant_id=p_tenant and
     ((status='processing' and coalesce(locked_at,updated_at,created_at)>clock_timestamp()-interval '15 minutes')
       or provider_expires_at>clock_timestamp())) into busy;
   if busy then return jsonb_build_object('status','pending','reason','work_draining'); end if;
 end if;
 insert into public.agentproof_personal_deletion_receipts(token_hash,source,expires_at)
 select token_hash,auth_source,clock_timestamp()+interval '24 hours' from public.agentproof_tenant_auth_sessions
 where tenant_id=p_tenant and auth_source in ('github','mobile') and revoked_at is null and expires_at>clock_timestamp()
 on conflict(token_hash) do nothing;
 foreach t in array public.agentproof_personal_deletion_tables() loop
   if to_regclass('public.'||t) is not null then
     execute format('delete from public.%I where tenant_id=$1',t) using p_tenant;
   end if;
 end loop;
 -- Remove the deletion-state FK first. There is no live account left to
 -- authorize an old session or accept a late write after this transaction.
 delete from public.agentproof_tenant_deletion_state where tenant_id=p_tenant;
 delete from public.agentproof_tenants where tenant_id=p_tenant;
 return jsonb_build_object('status','completed');
end;
$$;

create or replace function public.agentproof_delete_personal_account(p_token_hash text,p_source text,p_action text,p_required_tables text[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.agentproof_tenant_auth_sessions%rowtype; t text; tab text; n integer; pending boolean;
begin
 if p_action not in ('status','delete') or p_source not in ('github','mobile') then
   return jsonb_build_object('status','unauthorized');
 end if;
 select * into s from public.agentproof_tenant_auth_sessions where token_hash=p_token_hash
   and auth_source=p_source and revoked_at is null and expires_at>clock_timestamp();
 if not found then
   if exists(select 1 from public.agentproof_personal_deletion_receipts where token_hash=p_token_hash and source=p_source and expires_at>clock_timestamp()) then
     return jsonb_build_object('status','completed');
   end if;
   return jsonb_build_object('status','unauthorized');
 end if;
 t := s.tenant_id;
 if t !~ '^(gh_|acct_)' then return jsonb_build_object('status','unavailable'); end if;
 perform pg_advisory_xact_lock(hashtextextended(t,8129));
 perform 1 from public.agentproof_tenants where tenant_id=t for update;
 if not found or not exists(select 1 from public.agentproof_github_identities i
   join public.agentproof_tenant_members m on m.tenant_id=i.tenant_id and m.member_id=i.member_id
   where i.tenant_id=t and i.member_id=s.member_id and m.role='owner' and m.status='active'
   and i.member_id='github:'||i.github_user_id) then return jsonb_build_object('status','unauthorized'); end if;
 select count(*) into n from public.agentproof_tenant_members where tenant_id=t;
 if n<>1 then return jsonb_build_object('status','shared_workspace'); end if;
 if not public.agentproof_personal_deletion_ready(p_required_tables) then
   return jsonb_build_object('status','unavailable','reason','storage_setup_required');
 end if;
 select exists(select 1 from public.agentproof_tenant_deletion_state where tenant_id=t and self_service) into pending;
 if p_action='status' then return jsonb_build_object('status',case when pending then 'pending' else 'ready' end); end if;
 if not pending then
   if not exists(select 1 from public.agentproof_tenants where tenant_id=t and status in ('active','trialing'))
     or exists(select 1 from public.agentproof_tenant_deletion_state where tenant_id=t) then
     return jsonb_build_object('status','unavailable');
   end if;
   update public.agentproof_tenant_auth_sessions set github_access_ciphertext=null,github_refresh_ciphertext=null where tenant_id=t;
   insert into public.agentproof_tenant_deletion_state(tenant_id,status,self_service,required_tables) values(t,'active',true,coalesce(p_required_tables,'{}'));
   update public.agentproof_tenants set status='suspended' where tenant_id=t;
 end if;
 begin
   return public.agentproof_finish_personal_deletion(t);
 exception when others then
   -- The entire purge rolls back; the block and request remain for retry.
   return jsonb_build_object('status','pending','reason','retry_required');
 end;
end;
$$;

create or replace function public.agentproof_continue_personal_deletions()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; result jsonb; done integer:=0; waiting integer:=0;
begin
 delete from public.agentproof_personal_deletion_receipts where expires_at<=clock_timestamp();
 -- Unlinked cost ledger rows contain hashes/random ids, not tenant identity.
 -- Retain only 90 days of activity; this function is invoked by the daily cron.
 if to_regclass('public.agentproof_paid_budget_calls') is not null then
   perform pg_advisory_xact_lock(20260922,300005000);
   delete from public.agentproof_paid_budget_calls where created_at<clock_timestamp()-interval '90 days';
   delete from public.agentproof_paid_budget_runs budget_run where budget_run.created_at<clock_timestamp()-interval '90 days'
     and not exists(select 1 from public.agentproof_paid_budget_calls c where c.run_key=budget_run.run_key);
 end if;
 for r in select tenant_id from public.agentproof_tenant_deletion_state where self_service and status='active' order by updated_at,started_at,tenant_id limit 100 loop
   -- Rotate attempted requests so a draining/failing batch cannot starve later
   -- requests. Keep the original start time and the existing lock order.
   perform pg_advisory_xact_lock(hashtextextended(r.tenant_id,8129));
   update public.agentproof_tenant_deletion_state set updated_at=clock_timestamp() where tenant_id=r.tenant_id;
   begin
     result:=public.agentproof_finish_personal_deletion(r.tenant_id);
     if result->>'status'='completed' then done:=done+1; else waiting:=waiting+1; end if;
   exception when others then waiting:=waiting+1;
   end;
 end loop;
 return jsonb_build_object('completed',done,'pending',waiting);
end;
$$;

do $$ begin
 if to_regclass('public.agentproof_paid_budget_runs') is not null then
   alter table public.agentproof_paid_budget_runs add column if not exists created_at timestamptz not null default now();
 end if;
end $$;

-- New identities get a new opaque workspace generation. Serializing on the
-- GitHub identity prevents concurrent first logins from creating orphan rows.
create or replace function public.agentproof_github_personal_account(p_github_id text)
returns table(tenant_id text,member_id text,deletion_pending boolean)
language plpgsql security definer set search_path = '' as $$
declare t text; m text;
begin
 if p_github_id !~ '^[0-9]{1,20}$' then raise exception 'invalid identity'; end if;
 perform pg_advisory_xact_lock(hashtextextended('github:'||p_github_id,8129));
 select i.tenant_id,i.member_id into t,m from public.agentproof_github_identities i where github_user_id=p_github_id;
 if found then
   return query select t,m,exists(select 1 from public.agentproof_tenant_deletion_state d where d.tenant_id=t and d.self_service);
   return;
 end if;
 t:='acct_'||replace(gen_random_uuid()::text,'-',''); m:='github:'||p_github_id;
 insert into public.agentproof_tenants(tenant_id,name,status,plan) values(t,'GitHub workspace','active','beta');
 insert into public.agentproof_tenant_members(tenant_id,member_id,role,status) values(t,m,'owner','active');
 insert into public.agentproof_github_identities(github_user_id,tenant_id,member_id) values(p_github_id,t,m);
 return query select t,m,false;
end;
$$;

revoke all on function public.agentproof_delete_personal_account(text,text,text,text[]),public.agentproof_finish_personal_deletion(text),public.agentproof_continue_personal_deletions(),public.agentproof_github_personal_account(text) from public,anon,authenticated;
grant execute on function public.agentproof_delete_personal_account(text,text,text,text[]),public.agentproof_continue_personal_deletions(),public.agentproof_github_personal_account(text) to service_role;
-- finish is deliberately callable only through the checked entry points.
revoke all on function public.agentproof_finish_personal_deletion(text) from service_role;

revoke all on function public.agentproof_personal_deletion_ready(text[]),public.agentproof_guard_personal_account(),public.agentproof_guard_personal_data_write(),public.agentproof_personal_deletion_tables() from public,anon,authenticated,service_role;
