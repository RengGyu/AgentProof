-- Estimated KRW ledger, not a provider invoice. 1 KRW = 1000 milli-KRW.
-- Configuration is intentionally absent until the owner sets FX, calendar,
-- verified model prices, price expiry and conservative per-call reservations.
create table if not exists public.agentproof_paid_budget_settings (
  singleton boolean primary key default true check (singleton),
  config jsonb,
  paused boolean not null default false
);
insert into public.agentproof_paid_budget_settings(singleton) values(true) on conflict do nothing;
create table if not exists public.agentproof_paid_budget_months (
  period text primary key,
  time_zone text not null,
  paused boolean not null default false
);
create table if not exists public.agentproof_paid_budget_runs (
  run_key text primary key,
  owner_id uuid not null,
  period text not null,
  config jsonb not null,
  closed boolean not null default false
);
create table if not exists public.agentproof_paid_budget_calls (
  call_id uuid primary key,
  run_key text not null references public.agentproof_paid_budget_runs(run_key),
  period text not null references public.agentproof_paid_budget_months(period),
  reserved_milli_krw bigint not null check (reserved_milli_krw > 0),
  charged_milli_krw bigint check (charged_milli_krw >= 0),
  state text not null default 'pending' check(state in ('pending','known','unknown')),
  created_at timestamptz not null default now()
);
create index if not exists agentproof_paid_budget_calls_period on public.agentproof_paid_budget_calls(period);

alter table public.agentproof_paid_budget_settings enable row level security;
alter table public.agentproof_paid_budget_months enable row level security;
alter table public.agentproof_paid_budget_runs enable row level security;
alter table public.agentproof_paid_budget_calls enable row level security;
revoke all on public.agentproof_paid_budget_settings,public.agentproof_paid_budget_months,public.agentproof_paid_budget_runs,public.agentproof_paid_budget_calls from public,anon,authenticated;
grant select,insert,update on public.agentproof_paid_budget_settings,public.agentproof_paid_budget_months,public.agentproof_paid_budget_runs,public.agentproof_paid_budget_calls to service_role;

create or replace function public.agentproof_paid_budget(
  p_action text, p_run text default null, p_owner uuid default null,
  p_call uuid default null, p_reserve bigint default null,
  p_charge bigint default null, p_config jsonb default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  cfg jsonb; global_pause boolean; month_key text; zone text;
  r public.agentproof_paid_budget_runs%rowtype;
  c public.agentproof_paid_budget_calls%rowtype;
  spent bigint; held bigint; total bigint; new_period boolean;
begin
  -- One transaction lock covers every tenant, worker and period. No process-local counter.
  perform pg_advisory_xact_lock(20260922,300005000);
  select config,paused into cfg,global_pause from public.agentproof_paid_budget_settings where singleton;
  if p_action in ('settle','close','check') then
    select * into r from public.agentproof_paid_budget_runs where run_key=p_run;
    if not found or r.owner_id is distinct from p_owner then return jsonb_build_object('allowed',false,'reason','duplicate'); end if;
    if p_action='close' then
      update public.agentproof_paid_budget_runs set closed=true where run_key=p_run;
      return jsonb_build_object('allowed',true);
    end if;
    select * into c from public.agentproof_paid_budget_calls where call_id=p_call and run_key=p_run;
    if not found then return jsonb_build_object('allowed',false,'reason','missing_call'); end if;
    month_key=c.period;
    if p_action='settle' then
      if p_charge is not null and (p_charge<0 or p_charge>9007199254740991) then return jsonb_build_object('allowed',false,'reason','invalid_charge'); end if;
      -- Exactly once. Unknown/missing usage never releases the reserved amount.
      if c.state='pending' then
        update public.agentproof_paid_budget_calls set charged_milli_krw=p_charge,
          state=case when p_charge is null then 'unknown' else 'known' end where call_id=p_call;
      end if;
      select coalesce(sum(coalesce(charged_milli_krw,reserved_milli_krw)),0) into total
        from public.agentproof_paid_budget_calls where period=month_key;
      if total>=50000000 then update public.agentproof_paid_budget_months set paused=true where period=month_key; end if;
      return jsonb_build_object('allowed',true);
    end if;
    if global_pause or cfg is null or r.closed or exists(select 1 from public.agentproof_paid_budget_months where period=month_key and paused) then
      return jsonb_build_object('allowed',false,'reason','hard_pause');
    end if;
    return jsonb_build_object('allowed',true);
  end if;
  if cfg is null or jsonb_typeof(cfg)<>'object' or not(cfg ?& array['timeZone','krwPerUsd','prices','validUntil']) then
    return jsonb_build_object('allowed',false,'reason','unconfigured');
  end if;
  zone=cfg->>'timeZone';
  if not exists(select 1 from pg_timezone_names where name=zone) or
    (cfg->>'validUntil')::timestamptz<=clock_timestamp() or
    exists(select 1 from public.agentproof_paid_budget_months where time_zone<>zone) then
    return jsonb_build_object('allowed',false,'reason','invalid_config');
  end if;
  month_key=to_char(clock_timestamp() at time zone zone,'YYYY-MM');
  if global_pause then return jsonb_build_object('allowed',false,'reason','hard_pause'); end if;
  if p_action='config' then return jsonb_build_object('allowed',true,'config',cfg); end if;
  if p_action<>'reserve' or p_run is null or p_run !~ '^[a-f0-9]{64}$' or p_owner is null or p_call is null or
    p_reserve is null or p_reserve<=0 or p_reserve>50000000 then
    return jsonb_build_object('allowed',false,'reason','invalid_request');
  end if;
  select * into r from public.agentproof_paid_budget_runs where run_key=p_run;
  if found and (r.owner_id<>p_owner or r.closed) then return jsonb_build_object('allowed',false,'reason','duplicate'); end if;
  new_period=r.run_key is null or r.period<>month_key;
  if (r.run_key is null and p_config is distinct from cfg) or
     (r.run_key is not null and p_config is distinct from r.config) or
     (p_config->>'validUntil')::timestamptz<=clock_timestamp() then
    return jsonb_build_object('allowed',false,'reason','config_changed');
  end if;
  -- RPC retry cannot grant a second provider invocation for the same call id.
  if exists(select 1 from public.agentproof_paid_budget_calls where call_id=p_call) then
    return jsonb_build_object('allowed',false,'reason','duplicate');
  end if;
  insert into public.agentproof_paid_budget_months(period,time_zone) values(month_key,zone) on conflict do nothing;
  select coalesce(sum(charged_milli_krw),0),
    coalesce(sum(case when charged_milli_krw is null then reserved_milli_krw else 0 end),0)
    into spent,held from public.agentproof_paid_budget_calls where period=month_key;
  total=spent+held;
  if total>=50000000 then update public.agentproof_paid_budget_months set paused=true where period=month_key; end if;
  if exists(select 1 from public.agentproof_paid_budget_months where period=month_key and paused) or total+p_reserve>=50000000 then
    return jsonb_build_object('allowed',false,'reason','hard_pause','estimatedMilliKrw',spent,'reservedMilliKrw',held);
  end if;
  -- Reservations may stop new analyses before actual usage reaches 30,000 KRW.
  -- An admitted run may make follow-up calls until the hard boundary.
  if new_period and (total>=30000000 or total+p_reserve>30000000) then
    return jsonb_build_object('allowed',false,'reason','soft_stop','estimatedMilliKrw',spent,'reservedMilliKrw',held);
  end if;
  insert into public.agentproof_paid_budget_runs(run_key,owner_id,period,config) values(p_run,p_owner,month_key,p_config)
    on conflict(run_key) do update set period=excluded.period;
  insert into public.agentproof_paid_budget_calls(call_id,run_key,period,reserved_milli_krw) values(p_call,p_run,month_key,p_reserve);
  return jsonb_build_object('allowed',true,'period',month_key,'estimatedMilliKrw',spent,'reservedMilliKrw',held+p_reserve);
end;
$$;
revoke all on function public.agentproof_paid_budget(text,text,uuid,uuid,bigint,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.agentproof_paid_budget(text,text,uuid,uuid,bigint,bigint,jsonb) to service_role;
