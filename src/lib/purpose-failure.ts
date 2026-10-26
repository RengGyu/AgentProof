import {purposeTimeoutMetadata} from './purpose-timeout';
/** Request-local metadata only. Never serialize exceptions or provider bodies. */
const closedCodes = new Set(['purpose_final_counter_reference', 'budget_amount_invalid', 'budget_call_timeout', 'budget_fx_invalid', 'budget_period_invalid', 'budget_price_invalid', 'budget_price_unconfigured', 'budget_reserve_invalid', 'budget_scope_required', 'budget_store_unavailable', 'budget_store_unconfigured', 'budget_unavailable', 'budget_unconfigured', 'duplicate', 'hard_pause', 'localization_action_budget', 'localization_blob_invalid', 'localization_clause_reference', 'localization_deadline', 'localization_diff_base_unconfirmed', 'localization_diff_snapshot_invalid', 'localization_disposed', 'localization_manifest_invalid', 'localization_metadata_body', 'localization_metadata_budget', 'localization_public_required', 'localization_private_access_changed', 'localization_schema', 'localization_scope_expansion', 'localization_selection_reference', 'localization_spec_budget', 'localization_tool_reference', 'purpose_account_contract_unconfirmed', 'purpose_assessment_schema', 'purpose_cache_usage_unconfirmed', 'purpose_call_budget', 'purpose_cancelled', 'purpose_checker_schema', 'purpose_core_unavailable', 'purpose_no_core_goal', 'purpose_no_citable_material', 'purpose_projection_shape', 'purpose_projection_text', 'purpose_projection_refs', 'purpose_projection_source', 'purpose_count_mismatch', 'purpose_duplicate_clause', 'purpose_final_checker_forbidden', 'purpose_final_clause_reference', 'purpose_final_counterevidence_budget', 'purpose_final_localization_required', 'purpose_final_packet_budget', 'purpose_final_quote', 'purpose_final_reference', 'purpose_final_schema', 'purpose_final_wire_schema', 'purpose_freshness_required', 'purpose_frozen_spec_mismatch', 'purpose_key_missing', 'purpose_model_mismatch', 'purpose_private_consent_required', 'purpose_provider_assignment_conflict', 'purpose_provider_body', 'purpose_provider_body_budget', 'purpose_provider_http', 'provider_invalid_request_error', 'provider_insufficient_quota', 'provider_model_not_found', 'provider_unsupported_parameter', 'provider_invalid_api_key', 'provider_rate_limit_exceeded', 'purpose_provider_incomplete', 'purpose_provider_refusal', 'purpose_provider_schema', 'purpose_provider_unavailable', 'purpose_public_required', 'purpose_review_unsafe', 'purpose_snapshot_required', 'purpose_source_closure', 'purpose_source_hash', 'purpose_spec_invalid', 'purpose_stage_flow_required', 'purpose_stage_provider_unavailable', 'purpose_stale', 'purpose_summary_invalid', 'purpose_timeout', 'purpose_token_count_unavailable', 'purpose_unsent_reference', 'purpose_usage_unconfirmed', 'purpose_wire_schema_unsupported', 'soft_stop', 'unknown', 'unsupported_background']);
export type PurposeFailureStage = 'runtime' | 'purpose' | 'locate' | 'assess' | 'check';
export type PurposeFailurePhase = 'setup' | 'schema' | 'count' | 'budget' | 'transport' | 'usage' | 'parse' | 'validation' | 'source' | 'freshness' | 'projection';
type Context = {stage: PurposeFailureStage; phase: PurposeFailurePhase; providerHTTPStatus?: number | null; code?: string; providerResponse?:ReturnType<typeof closedProviderResponseMetadata>; schemaFailure?:{reason:string;keyword?:string}; counts?: Partial<Record<'clauses'|'evidence'|'changeQuotes'|'changeInterpretations'|'testQuotes'|'testInterpretations'|'projectedDescriptions'|'projectedRefs',number>>};
const contexts = new WeakMap<object, Context>();
/** Annotating keeps the original Error/PaidBudgetError identity and budget behavior. */
export function annotatePurposeFailure(error: unknown, context: Context): void {
 if(error instanceof Error && !contexts.has(error)) contexts.set(error, {...context,...(context.providerResponse?{providerResponse:closedProviderResponseMetadata(context.providerResponse)}:{}),...(context.schemaFailure?{schemaFailure:closedSchemaFailure(context.schemaFailure)}:{})});
}
export function purposeFailureDiagnostic(error: unknown, correlation?: string | null) {
 let current=error, context:Context|undefined, code='unknown';
 let timeout:ReturnType<typeof purposeTimeoutMetadata>;
 const seen=new Set<unknown>();
 for(let depth=0;current instanceof Error && depth<8 && !seen.has(current);depth++) {
  seen.add(current); timeout??=purposeTimeoutMetadata(current); const found=contexts.get(current); if(found)context=found;
  const candidate='code' in current ? (current as Error & {code:unknown}).code : current.message;
  if(typeof candidate==='string' && closedCodes.has(candidate))code=candidate;
  if(current.name==='TimeoutError')code='purpose_timeout';
  if(current.name==='AbortError')code='purpose_cancelled';
  current=current.cause;
 }
 if(context?.code && closedCodes.has(context.code))code=context.code;
 const status=context?.providerHTTPStatus;
 const timeoutFields=timeout??(['purpose_timeout','purpose_cancelled'].includes(code)?{timeoutOrigin:'external_unknown' as const}:{});
 return {...timeoutFields,stage:context?.stage??'runtime',phase:context?.phase??'setup',code,
  providerHTTPStatus:Number.isInteger(status)&&status!>=100&&status!<=599?status!:null,
  ...(context?.counts ? {counts:Object.fromEntries(['clauses','evidence','changeQuotes','changeInterpretations','testQuotes','testInterpretations','projectedDescriptions','projectedRefs'].flatMap(key=>{const n=context.counts![key as keyof NonNullable<Context['counts']>];return typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=1024?[[key,n]]:[];}))} : {}),
  ...(context?.providerResponse?{providerResponse:closedProviderResponseMetadata(context.providerResponse)}:{}),
  ...(context?.schemaFailure?{schemaFailure:closedSchemaFailure(context.schemaFailure)}:{}),
  requestCorrelation:typeof correlation==='string' && (/^[a-z0-9]{1,12}(?:::[a-z0-9]{1,12})?-\d{13}-[a-f0-9]{12,32}$/.test(correlation)||/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(correlation))?correlation:null};
}
export function logPurposeFailure(error:unknown, correlation?:string|null, anchor?:{repositoryHash:string;pullRequestNumber:number}):void {
 const safeAnchor=anchor&&/^[a-f0-9]{64}$/.test(anchor.repositoryHash)&&Number.isSafeInteger(anchor.pullRequestNumber)&&anchor.pullRequestNumber>0?{repositoryHash:anchor.repositoryHash,pullRequestNumber:anchor.pullRequestNumber}:{};
 console.warn('agentproof_purpose_failure',JSON.stringify({...purposeFailureDiagnostic(error,correlation),...safeAnchor}));
}

/** Only fixed provider discriminators, never arbitrary message/type/param or body. */
export function closedProviderFailure(body:unknown):string|undefined {
 const code=(body as {error?:{code?:unknown}}|null)?.error?.code;
 return typeof code==='string' && ['invalid_request_error','insufficient_quota','model_not_found','unsupported_parameter','invalid_api_key','rate_limit_exceeded'].includes(code)?'provider_'+code:undefined;
}

/** Fixed local-schema failure reason and allowlisted keyword only; anything else is unknown or omitted. */
export function closedSchemaFailure(value:unknown) {
 const v=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
 const keyword=typeof v.keyword==='string'&&['required','additionalProperties','enum','type','minItems','maxItems','minLength','maxLength','anyOf','pattern','const'].includes(v.keyword)?v.keyword:undefined;
 return {reason:typeof v.reason==='string'&&['output_bound','empty','size','json','schema'].includes(v.reason)?v.reason:'unknown',...(keyword?{keyword}:{})};
}

/** Flat closed metadata only: never retain a provider body, reason text or reasoning. */
export function closedProviderResponseMetadata(value:unknown) {
 const v=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
 const token=(key:string)=>typeof v[key]==='number'&&Number.isSafeInteger(v[key])&&v[key]>=0?v[key] as number:null;
 return {
  status:typeof v.status==='string'&&['in_progress','completed','incomplete','failed'].includes(v.status)?v.status:'unknown',
  incompleteReason:typeof v.incompleteReason==='string'&&['max_output_tokens','content_filter'].includes(v.incompleteReason)?v.incompleteReason:'unknown',
  inputTokens:token('inputTokens'),outputTokens:token('outputTokens'),totalTokens:token('totalTokens'),
  cachedInputTokens:token('cachedInputTokens'),reasoningTokens:token('reasoningTokens')
 };
}
