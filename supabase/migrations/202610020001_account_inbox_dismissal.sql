-- Account-scoped inbox dismissal is metadata on the existing member row.
-- Existing deletion guards, RLS and account/member deletion apply unchanged.
alter table public.agentproof_tenant_members
  add column inbox_dismissed_through timestamptz;

create function public.agentproof_dismiss_inbox(p_tenant_id text, p_member_id text)
returns table(dismissed_through timestamptz)
language sql
set search_path = public
as $$
  update public.agentproof_tenant_members m
  set inbox_dismissed_through = greatest(m.inbox_dismissed_through, date_trunc('milliseconds', clock_timestamp()))
  where m.tenant_id = p_tenant_id and m.member_id = p_member_id and m.status = 'active'
    and exists(select 1 from public.agentproof_tenants t
      where t.tenant_id = m.tenant_id and t.status in ('active', 'trialing'))
  returning m.inbox_dismissed_through;
$$;
revoke all on function public.agentproof_dismiss_inbox(text, text) from public, anon, authenticated;
grant execute on function public.agentproof_dismiss_inbox(text, text) to service_role;
