begin;

alter table public.agentproof_concierge_analysis_runs
  add column if not exists decision_card_state text;
alter table public.agentproof_concierge_analysis_runs
  drop constraint if exists agentproof_concierge_analysis_runs_decision_card_state_check;
alter table public.agentproof_concierge_analysis_runs
  add constraint agentproof_concierge_analysis_runs_decision_card_state_check
  check (decision_card_state is null or decision_card_state in ('has_top_gap','zero_gap','not_recorded'));

drop function if exists public.agentproof_finish_concierge_analysis(text, text, text);
create or replace function public.agentproof_finish_concierge_analysis(
  p_key text,
  p_outcome text,
  p_reason text,
  p_decision_card_state text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_outcome not in ('completed', 'failed') or p_reason !~ '^[a-z0-9_]{1,64}$' then return false; end if;
  if (p_outcome = 'completed' and p_decision_card_state not in ('has_top_gap','zero_gap'))
    or (p_outcome = 'failed' and p_decision_card_state <> 'not_recorded') then return false; end if;
  update public.agentproof_concierge_analysis_runs as runs
  set status = p_outcome, bounded_reason = p_reason, decision_card_state = p_decision_card_state, completed_at = now()
  where runs.request_key = p_key and runs.status = 'reserved';
  return found;
end;
$$;
revoke all on function public.agentproof_finish_concierge_analysis(text, text, text, text) from public, anon, authenticated;
grant execute on function public.agentproof_finish_concierge_analysis(text, text, text, text) to service_role;

-- Preserve legacy rows without pretending their reviewer cohort or zero-gap
-- meaning was observed. New writes use the exact v3 RPC contract below.
alter table public.agentproof_concierge_feedback
  add column if not exists participant_cohort text not null default 'legacy_unclassified',
  add column if not exists privacy_notice_version text not null default 'legacy_unversioned',
  add column if not exists top_gap_outcome text not null default 'legacy_unclassified';

alter table public.agentproof_concierge_feedback
  drop constraint if exists agentproof_concierge_feedback_schema_version_check,
  drop constraint if exists agentproof_concierge_feedback_pre_report_gap_category_check,
  drop constraint if exists agentproof_concierge_feedback_participant_cohort_check,
  drop constraint if exists agentproof_concierge_feedback_privacy_notice_version_check,
  drop constraint if exists agentproof_concierge_feedback_top_gap_outcome_check;

alter table public.agentproof_concierge_feedback
  add constraint agentproof_concierge_feedback_schema_version_check
    check (schema_version in ('concierge-feedback.v2','concierge-feedback.v3')),
  add constraint agentproof_concierge_feedback_pre_report_gap_category_check
    check (pre_report_gap_category in ('implementation','targeted_test','execution','requirement','evidence_unavailable','evidence_insufficient','none')),
  add constraint agentproof_concierge_feedback_participant_cohort_check
    check (participant_cohort in ('legacy_unclassified','self_internal','external_reviewer')),
  add constraint agentproof_concierge_feedback_privacy_notice_version_check
    check (privacy_notice_version in ('legacy_unversioned','human-beta-privacy.v1')),
  add constraint agentproof_concierge_feedback_top_gap_outcome_check
    check (top_gap_outcome in ('legacy_unclassified','found_within_30s','found_after_30s','not_found','not_applicable_zero_gap','not_observed'));

drop function if exists public.agentproof_record_concierge_feedback(text, jsonb);
create or replace function public.agentproof_record_concierge_feedback(p_tenant_id text, p_feedback jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  field_count integer;
begin
  if jsonb_typeof(p_feedback) <> 'object' then return 'rejected'; end if;
  select count(*) into field_count from jsonb_object_keys(p_feedback);
  if field_count <> 21
    or not (p_feedback ?& array['schema_version','participant_cohort','privacy_notice_version','partner_id','session_ordinal','case_id_or_hash','task_source_quality','pr_size_bucket','pre_report_gap_category','top_gap_outcome','found_top_gap_within_30s','time_to_top_gap_seconds','top_gap_agreement','first_inspection_action','reprompt_action','false_blocker','usefulness','operator_assisted','operator_minutes_bucket','actual_repeat_use_ordinal','bounded_reason_category'])
    or coalesce(p_feedback->>'schema_version','') <> 'concierge-feedback.v3'
    or coalesce(p_feedback->>'participant_cohort','') not in ('self_internal','external_reviewer')
    or coalesce(p_feedback->>'privacy_notice_version','') <> 'human-beta-privacy.v1'
    or coalesce(p_feedback->>'partner_id','') !~ '^partner_[A-Fa-f0-9]{8,55}$'
    or coalesce(p_feedback->>'case_id_or_hash','') !~ '^[a-f0-9]{64}$'
    or coalesce(p_feedback->>'session_ordinal','') !~ '^(?:[1-9][0-9]{0,3}|10000)$'
    or coalesce(p_feedback->>'actual_repeat_use_ordinal','') !~ '^(?:[1-9][0-9]{0,3}|10000)$'
    or coalesce(p_feedback->>'task_source_quality','') not in ('explicit_task','linked_issue','unavailable','ambiguous')
    or coalesce(p_feedback->>'pr_size_bucket','') not in ('small','medium','large')
    or coalesce(p_feedback->>'pre_report_gap_category','') not in ('implementation','targeted_test','execution','requirement','evidence_unavailable','evidence_insufficient','none')
    or coalesce(p_feedback->>'top_gap_outcome','') not in ('found_within_30s','found_after_30s','not_found','not_applicable_zero_gap','not_observed')
    or coalesce(p_feedback->>'top_gap_agreement','') not in ('agree','partly','disagree','unclear')
    or coalesce(p_feedback->>'first_inspection_action','') not in ('file','check','requirement','none')
    or coalesce(p_feedback->>'reprompt_action','') not in ('copied','edited','sent','not_used')
    or coalesce(p_feedback->>'operator_minutes_bucket','') not in ('0','1_5','6_15','16_plus')
    or coalesce(p_feedback->>'bounded_reason_category','') not in ('useful_gap','wrong_gap','missing_context','navigation','reprompt','other')
    or jsonb_typeof(p_feedback->'found_top_gap_within_30s') <> 'boolean'
    or jsonb_typeof(p_feedback->'operator_assisted') <> 'boolean'
    or jsonb_typeof(p_feedback->'false_blocker') not in ('boolean','null')
    or jsonb_typeof(p_feedback->'time_to_top_gap_seconds') not in ('number','null')
    or (p_feedback->>'time_to_top_gap_seconds' is not null and p_feedback->>'time_to_top_gap_seconds' !~ '^(0|[1-9][0-9]{0,3})$')
    or coalesce(p_feedback->>'usefulness','') !~ '^[1-5]$'
    or ((p_feedback->>'top_gap_outcome' = 'found_within_30s') <> (p_feedback->>'found_top_gap_within_30s')::boolean)
    or (p_feedback->>'top_gap_outcome' = 'found_within_30s' and (p_feedback->>'time_to_top_gap_seconds' is null or (p_feedback->>'time_to_top_gap_seconds')::integer > 30))
    or (p_feedback->>'top_gap_outcome' = 'found_after_30s' and ((p_feedback->>'found_top_gap_within_30s')::boolean or p_feedback->>'time_to_top_gap_seconds' is null or (p_feedback->>'time_to_top_gap_seconds')::integer <= 30))
    or (p_feedback->>'top_gap_outcome' not in ('found_within_30s','found_after_30s') and p_feedback->>'time_to_top_gap_seconds' is not null)
    or (p_feedback->>'top_gap_outcome' = 'not_applicable_zero_gap' and p_feedback->>'reprompt_action' <> 'not_used')
    or not exists (
      select 1
      from public.agentproof_concierge_analysis_runs runs
      join public.agentproof_tenants tenants on tenants.tenant_id = runs.tenant_id and tenants.status in ('active','trialing','invite-only')
      join public.agentproof_github_installations installs on installs.tenant_id = runs.tenant_id and installs.installation_id = runs.installation_id and installs.status = 'active'
      join public.agentproof_tenant_repository_grants grants on grants.tenant_id = runs.tenant_id and grants.installation_id = runs.installation_id and grants.repository_id = runs.repository_id and grants.enabled
      where runs.request_key = p_feedback->>'case_id_or_hash' and runs.tenant_id = p_tenant_id and runs.status = 'completed'
        and (
          (runs.decision_card_state = 'zero_gap' and p_feedback->>'top_gap_outcome' = 'not_applicable_zero_gap')
          or (runs.decision_card_state = 'has_top_gap' and p_feedback->>'top_gap_outcome' in ('found_within_30s','found_after_30s','not_found','not_observed'))
        )
    ) then return 'rejected';
  end if;

  insert into public.agentproof_concierge_feedback (
    tenant_id, schema_version, participant_cohort, privacy_notice_version,
    partner_id, session_ordinal, case_id_or_hash, task_source_quality,
    pr_size_bucket, pre_report_gap_category, top_gap_outcome,
    found_top_gap_within_30s, time_to_top_gap_seconds, top_gap_agreement,
    first_inspection_action, reprompt_action, false_blocker, usefulness,
    operator_assisted, operator_minutes_bucket, actual_repeat_use_ordinal,
    bounded_reason_category
  ) values (
    p_tenant_id, p_feedback->>'schema_version', p_feedback->>'participant_cohort', p_feedback->>'privacy_notice_version',
    p_feedback->>'partner_id', (p_feedback->>'session_ordinal')::integer, p_feedback->>'case_id_or_hash', p_feedback->>'task_source_quality',
    p_feedback->>'pr_size_bucket', p_feedback->>'pre_report_gap_category', p_feedback->>'top_gap_outcome',
    (p_feedback->>'found_top_gap_within_30s')::boolean, nullif(p_feedback->>'time_to_top_gap_seconds','')::integer, p_feedback->>'top_gap_agreement',
    p_feedback->>'first_inspection_action', p_feedback->>'reprompt_action', nullif(p_feedback->>'false_blocker','')::boolean, (p_feedback->>'usefulness')::integer,
    (p_feedback->>'operator_assisted')::boolean, p_feedback->>'operator_minutes_bucket', (p_feedback->>'actual_repeat_use_ordinal')::integer,
    p_feedback->>'bounded_reason_category'
  ) on conflict (tenant_id, partner_id, session_ordinal, case_id_or_hash) do nothing;
  if found then return 'stored'; end if;
  return 'duplicate';
exception when others then
  return 'rejected';
end;
$$;

revoke all on function public.agentproof_record_concierge_feedback(text, jsonb) from public, anon, authenticated;
grant execute on function public.agentproof_record_concierge_feedback(text, jsonb) to service_role;

commit;
