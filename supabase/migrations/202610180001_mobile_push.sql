-- Additive native push registry/outbox. No report/code/prose; service-role RPC only.
begin;
create table public.agentproof_mobile_push_devices (
 device_id uuid primary key,
 tenant_id text not null,
 member_id text not null,
 session_hash text not null references public.agentproof_tenant_auth_sessions(token_hash) on delete cascade,
 platform text not null check(platform in ('ios','android')),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 token_ciphertext text not null check(length(token_ciphertext) <= 8192),
 enabled boolean not null default true,
 updated_at timestamptz not null default now(),
 foreign key(tenant_id,member_id) references public.agentproof_tenant_members(tenant_id,member_id) on delete cascade
);
create table public.agentproof_mobile_push_deliveries (
 event_key text not null check(event_key ~ '^[a-f0-9]{64}$'),
 device_id uuid not null references public.agentproof_mobile_push_devices on delete cascade,
 token_hash text not null,
 state text not null check(state in ('sending','sent','invalid','retryable','failed','unknown','unconfigured')),
 attempts integer not null default 1 check(attempts between 1 and 2),
 retry_at timestamptz,
 created_at timestamptz not null default now(),
 primary key(event_key,device_id)
);
alter table public.agentproof_mobile_push_devices enable row level security;
alter table public.agentproof_mobile_push_deliveries enable row level security;
revoke all on public.agentproof_mobile_push_devices, public.agentproof_mobile_push_deliveries from public, anon, authenticated, service_role;

create function public.agentproof_mobile_push_current(p_device uuid,p_token_hash text,p_session_hash text,p_repository bigint default null)
returns boolean language sql security definer set search_path=public,pg_catalog as $$
 select exists(select 1 from agentproof_mobile_push_devices d
 join agentproof_tenant_auth_sessions s on s.token_hash=d.session_hash and s.tenant_id=d.tenant_id and s.member_id=d.member_id
 join agentproof_tenant_members m on m.tenant_id=s.tenant_id and m.member_id=s.member_id and m.status='active'
 join agentproof_tenants t on t.tenant_id=m.tenant_id and t.status in ('active','trialing')
 where d.device_id=p_device and d.enabled and d.token_hash=p_token_hash and d.session_hash=p_session_hash
 and (p_repository is null or exists(select 1 from agentproof_tenant_repository_grants g where g.tenant_id=d.tenant_id and g.repository_id=p_repository and g.enabled and g.save_reports_enabled))
 and s.auth_source='mobile' and s.revoked_at is null and s.expires_at>now()
 and not exists(select 1 from agentproof_tenant_deletion_state x where x.tenant_id=t.tenant_id and x.status='active'));
$$;

create function public.agentproof_mobile_push_device(p_session_hash text,p_device uuid,p_operation text,
 p_platform text default null,p_token_hash text default null,p_ciphertext text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare s agentproof_tenant_auth_sessions; d agentproof_mobile_push_devices;
begin
 perform pg_advisory_xact_lock(hashtextextended('mobile-push-device:'||p_device::text,0));
 select a.* into s from agentproof_tenant_auth_sessions a
 join agentproof_tenant_members m on m.tenant_id=a.tenant_id and m.member_id=a.member_id and m.status='active'
 join agentproof_tenants t on t.tenant_id=m.tenant_id and t.status in ('active','trialing')
 where a.token_hash=p_session_hash and a.auth_source='mobile' and a.revoked_at is null and a.expires_at>now()
 and not exists(select 1 from agentproof_tenant_deletion_state x where x.tenant_id=t.tenant_id and x.status='active') for share of a;
 if s.id is null then raise exception 'push_session_invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended('mobile-push-member:'||s.tenant_id||':'||s.member_id,0));
 if p_operation='register' then
  if p_platform not in ('ios','android') or p_token_hash is null or p_ciphertext is null then raise exception 'push_registration_invalid'; end if;
  -- One physical installation/token belongs to one account at a time. Old token versions are removed on rotation.
  delete from agentproof_mobile_push_devices where token_hash=p_token_hash and device_id<>p_device;
  if (select count(*) from agentproof_mobile_push_devices where tenant_id=s.tenant_id and member_id=s.member_id and device_id<>p_device)>=20 then raise exception 'push_devices_limit'; end if;
  insert into agentproof_mobile_push_devices(device_id,tenant_id,member_id,session_hash,platform,token_hash,token_ciphertext)
  values(p_device,s.tenant_id,s.member_id,p_session_hash,p_platform,p_token_hash,p_ciphertext)
  on conflict(device_id) do update set tenant_id=excluded.tenant_id,member_id=excluded.member_id,session_hash=excluded.session_hash,platform=excluded.platform,
   token_hash=excluded.token_hash,token_ciphertext=excluded.token_ciphertext,enabled=true,updated_at=now();
 elsif p_operation='disable' then
  delete from agentproof_mobile_push_devices where device_id=p_device and tenant_id=s.tenant_id and member_id=s.member_id;
 elsif p_operation<>'read' then raise exception 'push_operation_invalid'; end if;
 select * into d from agentproof_mobile_push_devices where device_id=p_device and tenant_id=s.tenant_id and member_id=s.member_id;
 return jsonb_build_object('enabled',coalesce(d.enabled,false));
end $$;

create function public.agentproof_claim_mobile_push(p_tenant text,p_event text,p_report text,p_repository bigint,p_job text default null)
returns table(device_id uuid,platform text,token_hash text,token_ciphertext text,session_hash text)
language plpgsql security definer set search_path=public,pg_catalog as $$
begin
 -- Report identity is validated against the actual stored tenant row, never a caller-supplied report object.
 if p_report is not null then
  if not exists(select 1 from agentproof_saved_reports r where r.id=p_report and r.tenant_id=p_tenant and r.repository_id=p_repository) then return; end if;
 else
  if not exists(select 1 from agentproof_analysis_jobs j where j.id=p_job and j.tenant_id=p_tenant and j.repository_id=p_repository and j.status='failed_terminal' and j.is_historical is not true) then return; end if;
 end if;
 if not exists(select 1 from agentproof_tenant_repository_grants g where g.tenant_id=p_tenant and g.repository_id=p_repository and g.enabled and g.save_reports_enabled) then return; end if;
 -- Short-lived bookkeeping; token rows cascade on account/session deletion.
 delete from agentproof_mobile_push_deliveries delivery where delivery.created_at<now()-interval '7 days' and delivery.device_id in (select d.device_id from agentproof_mobile_push_devices d where d.tenant_id=p_tenant);
 delete from agentproof_mobile_push_devices d where d.tenant_id=p_tenant and not exists(select 1 from agentproof_tenant_auth_sessions s where s.token_hash=d.session_hash and s.revoked_at is null and s.expires_at>now());
 return query with candidates as (
  select d.* from agentproof_mobile_push_devices d where d.tenant_id=p_tenant
   and agentproof_mobile_push_current(d.device_id,d.token_hash,d.session_hash,p_repository)
 ), claimed as (
  insert into agentproof_mobile_push_deliveries(event_key,device_id,token_hash,state)
  select p_event,c.device_id,c.token_hash,'sending' from candidates c
  on conflict on constraint agentproof_mobile_push_deliveries_pkey do update set state='sending',attempts=agentproof_mobile_push_deliveries.attempts+1
   where agentproof_mobile_push_deliveries.state='retryable' and agentproof_mobile_push_deliveries.attempts<2 and agentproof_mobile_push_deliveries.retry_at<=now()
  returning agentproof_mobile_push_deliveries.device_id,agentproof_mobile_push_deliveries.token_hash
 ) select c.device_id,c.platform,c.token_hash,c.token_ciphertext,c.session_hash from candidates c join claimed q on q.device_id=c.device_id and q.token_hash=c.token_hash;
end $$;

create function public.agentproof_finish_mobile_push(p_event text,p_device uuid,p_token_hash text,p_outcome text)
returns void language plpgsql security definer set search_path=public,pg_catalog as $$
begin
 update agentproof_mobile_push_deliveries set state=p_outcome,retry_at=case when p_outcome='retryable' then now()+interval '1 second' end
 where event_key=p_event and device_id=p_device and token_hash=p_token_hash and state='sending';
 if p_outcome='invalid' then delete from agentproof_mobile_push_devices where device_id=p_device and token_hash=p_token_hash;end if;
end $$;
revoke all on function public.agentproof_mobile_push_current(uuid,text,text,bigint),public.agentproof_mobile_push_device(text,uuid,text,text,text,text),public.agentproof_claim_mobile_push(text,text,text,bigint,text),public.agentproof_finish_mobile_push(text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.agentproof_mobile_push_current(uuid,text,text,bigint),public.agentproof_mobile_push_device(text,uuid,text,text,text,text),public.agentproof_claim_mobile_push(text,text,text,bigint,text),public.agentproof_finish_mobile_push(text,uuid,text,text) to service_role;
-- Logout revocation and account deletion clean the token registry with existing auth rows.
create function public.agentproof_mobile_push_session_revoked() returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
begin
 if new.revoked_at is not null then delete from agentproof_mobile_push_devices where session_hash=new.token_hash;end if;
 return new;
end $$;
create trigger agentproof_mobile_push_session_revoked after update of revoked_at on public.agentproof_tenant_auth_sessions for each row execute function public.agentproof_mobile_push_session_revoked();
revoke all on function public.agentproof_mobile_push_session_revoked() from public,anon,authenticated;
commit;
