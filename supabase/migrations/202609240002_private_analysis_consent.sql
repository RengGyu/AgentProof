-- A private connection is inactive until its owner/admin accepts the new
-- bounded code-to-model notice. Existing private ON grants are not promoted.
alter table public.agentproof_tenant_repository_grants
  add column if not exists private_analysis_consent_version text
    check (private_analysis_consent_version is null or
      (private_analysis_consent_version = '2026-09-24.v1' and repository_is_private = true));

update public.agentproof_tenant_repository_grants
set analysis_enabled = false, updated_at = now()
where repository_is_private is true and private_analysis_consent_version is null and analysis_enabled is true;

drop function if exists public.agentproof_update_tenant_repository_grant_settings(text, bigint, bigint, boolean, boolean, boolean, boolean, boolean, text, boolean);

create function public.agentproof_update_tenant_repository_grant_settings(
  p_tenant_id text,
  p_installation_id bigint,
  p_repository_id bigint,
  p_enabled boolean default null,
  p_analysis_enabled boolean default null,
  p_comment_enabled boolean default null,
  p_save_reports_enabled boolean default null,
  p_slack_notifications_enabled boolean default null,
  p_llm_analysis_mode text default null,
  p_hybrid_planner_consent_requested boolean default null,
  p_private_analysis_consent_requested boolean default null
)
returns setof public.agentproof_tenant_repository_grants
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  existing public.agentproof_tenant_repository_grants%rowtype;
  effective_mode text;
  effective_hybrid_consent text;
  effective_private_consent text;
begin
  select * into existing from public.agentproof_tenant_repository_grants
  where tenant_id = p_tenant_id and installation_id = p_installation_id and repository_id = p_repository_id
  for update;
  if not found then raise exception 'tenant repository grant was not found'; end if;
  if p_llm_analysis_mode is not null and p_llm_analysis_mode not in ('essential', 'enhanced') then
    raise exception 'tenant repository grant mode is invalid';
  end if;
  effective_mode := coalesce(p_llm_analysis_mode, existing.llm_analysis_mode, 'essential');
  if p_hybrid_planner_consent_requested = true and
    (effective_mode <> 'enhanced' or existing.repository_is_private is not true) then
    raise exception 'tenant repository grant consent is invalid for this repository mode';
  end if;
  if effective_mode <> 'enhanced' then
    effective_hybrid_consent := null;
  elsif p_llm_analysis_mode = 'enhanced' then
    effective_hybrid_consent := case when p_hybrid_planner_consent_requested = true then '2026-08-12.v1' else null end;
  elsif p_hybrid_planner_consent_requested = true then
    effective_hybrid_consent := '2026-08-12.v1';
  elsif p_hybrid_planner_consent_requested = false then
    effective_hybrid_consent := null;
  else
    effective_hybrid_consent := existing.hybrid_planner_consent_version;
  end if;

  if p_private_analysis_consent_requested = true and existing.repository_is_private is not true then
    raise exception 'private analysis consent requires a private repository';
  end if;
  effective_private_consent := case
    when p_private_analysis_consent_requested = true then '2026-09-24.v1'
    when p_private_analysis_consent_requested = false then null
    else existing.private_analysis_consent_version
  end;
  if existing.repository_is_private is true and p_analysis_enabled = true and effective_private_consent is null then
    raise exception 'private analysis consent is required';
  end if;

  return query update public.agentproof_tenant_repository_grants
  set enabled = coalesce(p_enabled, existing.enabled),
      analysis_enabled = case when p_private_analysis_consent_requested = false then false else coalesce(p_analysis_enabled, existing.analysis_enabled) end,
      comment_enabled = coalesce(p_comment_enabled, existing.comment_enabled),
      save_reports_enabled = coalesce(p_save_reports_enabled, existing.save_reports_enabled),
      slack_notifications_enabled = coalesce(p_slack_notifications_enabled, existing.slack_notifications_enabled),
      llm_analysis_mode = effective_mode,
      hybrid_planner_consent_version = effective_hybrid_consent,
      private_analysis_consent_version = effective_private_consent,
      updated_at = now()
  where tenant_id = p_tenant_id and installation_id = p_installation_id and repository_id = p_repository_id
  returning *;
end;
$$;

revoke all on function public.agentproof_update_tenant_repository_grant_settings(text, bigint, bigint, boolean, boolean, boolean, boolean, boolean, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.agentproof_update_tenant_repository_grant_settings(text, bigint, bigint, boolean, boolean, boolean, boolean, boolean, text, boolean, boolean) to service_role;
