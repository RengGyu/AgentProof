import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);
const image = process.env.AGENTPROOF_CONCIERGE_POSTGRES_IMAGE || "postgres:16-alpine";
const name = `agentproof-concierge-${process.pid}`;
const password = randomBytes(18).toString("hex");
const installationMigration = await readFile(new URL("../supabase/migrations/202607120001_github_installation_single_tenant.sql", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/202607140001_concierge_private_beta.sql", import.meta.url), "utf8");
const deletionStateMigration = await readFile(new URL("../supabase/migrations/202607160001_tenant_deletion_state.sql", import.meta.url), "utf8");
const humanBetaClarityMigration = await readFile(new URL("../supabase/migrations/202607200001_human_beta_feedback_clarity.sql", import.meta.url), "utf8");
let stage = "docker_prerequisite";

async function docker(args, options = {}) { return exec("docker", args, { maxBuffer: 4_000_000, ...options }); }
async function psql(sql, role) {
  const wrapped = role ? `set role ${role};\n${sql}` : sql;
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", name, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-At"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`psql command failed: ${stderr.replace(/[\r\n]+/g, " ").slice(0, 400)}`)));
    child.stdin.end(wrapped);
  });
}
function scalar(stdout) { return stdout.trim().split(/\r?\n/).at(-1) ?? ""; }
function feedbackPayload(caseKey, overrides = {}) {
  return JSON.stringify({
    schema_version: "concierge-feedback.v3", participant_cohort: "self_internal", privacy_notice_version: "human-beta-privacy.v1", partner_id: "partner_a1b2c3d4", session_ordinal: 1, case_id_or_hash: caseKey,
    task_source_quality: "linked_issue", pr_size_bucket: "small", pre_report_gap_category: "execution",
    top_gap_outcome: "found_within_30s",
    found_top_gap_within_30s: true, time_to_top_gap_seconds: 18, top_gap_agreement: "agree",
    first_inspection_action: "check", reprompt_action: "copied", false_blocker: false, usefulness: 4,
    operator_assisted: true, operator_minutes_bucket: "1_5", actual_repeat_use_ordinal: 1,
    bounded_reason_category: "useful_gap", ...overrides
  }).replaceAll("'", "''");
}
function feedbackPayloadV2(caseKey) {
  return JSON.stringify({
    schema_version: "concierge-feedback.v2", partner_id: "partner_1a2b3c4d", session_ordinal: 1, case_id_or_hash: caseKey,
    task_source_quality: "linked_issue", pr_size_bucket: "small", pre_report_gap_category: "execution",
    found_top_gap_within_30s: true, time_to_top_gap_seconds: 12, top_gap_agreement: "agree",
    first_inspection_action: "check", reprompt_action: "copied", false_blocker: false, usefulness: 4,
    operator_assisted: true, operator_minutes_bucket: "1_5", actual_repeat_use_ordinal: 1,
    bounded_reason_category: "useful_gap"
  }).replaceAll("'", "''");
}

try {
  stage = "start_container";
  await docker(["info"]);
  await docker(["image", "inspect", image]);
} catch {
  console.error(`PREREQUISITE_UNAVAILABLE: local Docker daemon and cached ${image} image are required.`);
  process.exit(2);
}

try {
  await docker(["run", "--rm", "-d", "--name", name, "-e", `POSTGRES_PASSWORD=${password}`, image]);
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      // The official image briefly starts a temporary server during initdb,
      // then restarts the final server. Require two SQL round trips across
      // that handoff instead of treating a one-shot readiness answer as final.
      await psql("select 1;");
      await new Promise((resolve) => setTimeout(resolve, 500));
      await psql("select 1;");
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!ready) throw new Error("PostgreSQL did not become ready.");
  stage = "create_roles";
  await psql("create role anon nologin; create role authenticated nologin; create role service_role nologin;");
  stage = "apply_migrations";
  await psql(`${installationMigration}\n${migration}\n${deletionStateMigration}`);
  stage = "seed_authorization";
  await psql(`
    insert into public.agentproof_tenants(tenant_id,name,status,plan) values ('tenant_alpha','Opaque tenant','active','invite');
    insert into public.agentproof_tenant_members(tenant_id,member_id,role,status) values ('tenant_alpha','member_alpha','owner','active');
    insert into public.agentproof_github_installations(tenant_id,installation_id,status,created_at,updated_at) values ('tenant_alpha',101,'active',now(),now());
    insert into public.agentproof_tenant_repository_grants(tenant_id,installation_id,repository_id,repository_full_name,enabled,analysis_enabled,save_reports_enabled,comment_enabled,slack_notifications_enabled) values ('tenant_alpha',101,202,'opaque/repository',true,true,true,true,true);
    insert into public.agentproof_tenants(tenant_id,name,status,plan) values ('tenant_bravo','Opaque tenant 2','active','invite');
    insert into public.agentproof_tenant_members(tenant_id,member_id,role,status) values ('tenant_bravo','member_bravo','owner','active');
    insert into public.agentproof_github_installations(tenant_id,installation_id,status,created_at,updated_at) values ('tenant_bravo',102,'active',now(),now());
    insert into public.agentproof_tenant_repository_grants(tenant_id,installation_id,repository_id,repository_full_name,enabled) values ('tenant_bravo',102,203,'opaque/repository-2',true);
  `);

  stage = "seed_legacy_feedback_before_upgrade";
  const legacyKey = "6".repeat(64);
  const legacyReserve = scalar((await psql(`select outcome from public.agentproof_reserve_concierge_analysis('${legacyKey}','tenant_alpha',101,202);`, "service_role")).stdout);
  const legacyComplete = scalar((await psql(`select public.agentproof_finish_concierge_analysis('${legacyKey}','completed','manual_report_validated');`, "service_role")).stdout);
  const legacyFeedback = scalar((await psql(`select public.agentproof_record_concierge_feedback('tenant_alpha','${feedbackPayloadV2(legacyKey)}'::jsonb);`, "service_role")).stdout);
  if (legacyReserve !== "reserved" || legacyComplete !== "t" || legacyFeedback !== "stored") throw new Error("Legacy v2 setup failed before clarity migration.");

  stage = "apply_human_beta_clarity_upgrade";
  await psql(humanBetaClarityMigration);
  const legacyPreserved = scalar((await psql(`select schema_version || ':' || participant_cohort || ':' || privacy_notice_version || ':' || top_gap_outcome from public.agentproof_concierge_feedback where case_id_or_hash='${legacyKey}';`)).stdout);
  const legacyDecisionState = scalar((await psql(`select coalesce(decision_card_state,'null') from public.agentproof_concierge_analysis_runs where request_key='${legacyKey}';`)).stdout);
  if (legacyPreserved !== "concierge-feedback.v2:legacy_unclassified:legacy_unversioned:legacy_unclassified" || legacyDecisionState !== "null") throw new Error("Legacy rows were changed or falsely classified during clarity migration.");

  stage = "concierge_grant_preservation";
  const existingGrant = scalar((await psql("select outcome || ':' || enabled || ':' || analysis_enabled || ':' || save_reports_enabled || ':' || comment_enabled || ':' || slack_notifications_enabled from public.agentproof_register_concierge_repository_grant('tenant_alpha',101,202,'opaque/repository');", "service_role")).stdout);
  if (existingGrant !== "existing:true:true:true:true:true") throw new Error("Existing repository grant settings were changed by Concierge registration.");
  const registrationSql = "select outcome from public.agentproof_register_concierge_repository_grant('tenant_alpha',101,204,'opaque/repository-new');";
  const registrationOutcomes = await Promise.all(Array.from({ length: 20 }, () => psql(registrationSql, "service_role").then(({ stdout }) => scalar(stdout))));
  if (registrationOutcomes.filter((value) => value === "created").length !== 1 || registrationOutcomes.filter((value) => value === "existing").length !== 19) throw new Error("Concurrent Concierge registration invariant failed.");
  const newGrant = scalar((await psql("select enabled || ':' || analysis_enabled || ':' || save_reports_enabled || ':' || comment_enabled || ':' || slack_notifications_enabled from public.agentproof_tenant_repository_grants where tenant_id='tenant_alpha' and installation_id=101 and repository_id=204;")).stdout);
  if (newGrant !== "true:false:false:false:false") throw new Error("New Concierge grant was not manual-only.");

  stage = "deletion_state_schema_and_permissions";
  const deletionColumns = scalar((await psql("select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='agentproof_tenant_deletion_state';")).stdout);
  if (deletionColumns !== "tenant_id,status,started_at,updated_at") throw new Error("Tenant deletion state schema is not metadata-only.");
  const deletionRls = scalar((await psql("select relrowsecurity from pg_class where oid='public.agentproof_tenant_deletion_state'::regclass;")).stdout);
  if (deletionRls !== "t") throw new Error("Tenant deletion state RLS is not enabled.");
  const absentDeletionState = scalar((await psql("select active from public.agentproof_tenant_deletion_state_active('tenant_alpha');", "service_role")).stdout);
  if (absentDeletionState !== "f") throw new Error("Absent tenant deletion state did not allow normal authorization.");
  const createdDeletionState = scalar((await psql("select outcome from public.agentproof_mark_tenant_deletion_active('tenant_alpha');", "service_role")).stdout);
  const activeDeletionState = scalar((await psql("select active from public.agentproof_tenant_deletion_state_active('tenant_alpha');", "service_role")).stdout);
  const duplicateDeletionState = scalar((await psql("select outcome from public.agentproof_mark_tenant_deletion_active('tenant_alpha');", "service_role")).stdout);
  if (createdDeletionState !== "created" || activeDeletionState !== "t" || duplicateDeletionState !== "existing") throw new Error("Tenant deletion state lifecycle invariant failed.");
  for (const role of ["anon", "authenticated", "service_role"]) {
    let selectRejected = false;
    let insertRejected = false;
    try { await psql("select * from public.agentproof_tenant_deletion_state;", role); } catch { selectRejected = true; }
    try { await psql("insert into public.agentproof_tenant_deletion_state(tenant_id,status) values ('tenant_bravo','active');", role); } catch { insertRejected = true; }
    if (!selectRejected || !insertRejected) throw new Error(`${role} direct deletion-state access was not rejected.`);
  }
  for (const role of ["anon", "authenticated"]) {
    let readRpcRejected = false;
    let markRpcRejected = false;
    try { await psql("select * from public.agentproof_tenant_deletion_state_active('tenant_alpha');", role); } catch { readRpcRejected = true; }
    try { await psql("select * from public.agentproof_mark_tenant_deletion_active('tenant_bravo');", role); } catch { markRpcRejected = true; }
    if (!readRpcRejected || !markRpcRejected) throw new Error(`${role} deletion-state RPC access was not rejected.`);
  }
  let invalidStatusRejected = false;
  try { await psql("insert into public.agentproof_tenant_deletion_state(tenant_id,status) values ('tenant_bravo','released');"); } catch { invalidStatusRejected = true; }
  if (!invalidStatusRejected) throw new Error("Invalid tenant deletion state transition was accepted.");

  const key = "a".repeat(64);
  const reserveSql = `select outcome from public.agentproof_reserve_concierge_analysis('${key}','tenant_alpha',101,202);`;
  stage = "concurrent_reserve";
  const outcomes = await Promise.all(Array.from({ length: 20 }, () => psql(reserveSql, "service_role").then(({ stdout }) => scalar(stdout))));
  if (outcomes.filter((value) => value === "reserved").length !== 1 || outcomes.filter((value) => value === "duplicate").length !== 19) throw new Error("Concurrent reservation invariant failed.");

  stage = "direct_dml";
  for (const role of ["anon", "authenticated", "service_role"]) {
    let rejected = false;
    try { await psql("insert into public.agentproof_concierge_analysis_runs(request_key,tenant_id,installation_id,repository_id,status,bounded_reason) values ('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','tenant_alpha',1,1,'reserved','manual');", role); } catch { rejected = true; }
    if (!rejected) throw new Error(`${role} direct table DML was not rejected.`);
  }
  stage = "rpc_permissions";
  let anonRpcRejected = false;
  try { await psql(`select * from public.agentproof_reserve_concierge_analysis('${"c".repeat(64)}','tenant_alpha',101,202);`, "anon"); } catch { anonRpcRejected = true; }
  if (!anonRpcRejected) throw new Error("anon RPC access was not rejected.");
  let authenticatedRpcRejected = false;
  try { await psql(`select * from public.agentproof_reserve_concierge_analysis('${"c".repeat(64)}','tenant_alpha',101,202);`, "authenticated"); } catch { authenticatedRpcRejected = true; }
  if (!authenticatedRpcRejected) throw new Error("authenticated RPC access was not rejected.");
  let anonFeedbackRpcRejected = false;
  try { await psql(`select public.agentproof_record_concierge_feedback('tenant_alpha','${feedbackPayload(key)}'::jsonb);`, "anon"); } catch { anonFeedbackRpcRejected = true; }
  if (!anonFeedbackRpcRejected) throw new Error("anon feedback RPC access was not rejected.");
  let authenticatedFeedbackRpcRejected = false;
  try { await psql(`select public.agentproof_record_concierge_feedback('tenant_alpha','${feedbackPayload(key)}'::jsonb);`, "authenticated"); } catch { authenticatedFeedbackRpcRejected = true; }
  if (!authenticatedFeedbackRpcRejected) throw new Error("authenticated feedback RPC access was not rejected.");
  let anonGrantRegistrationRpcRejected = false;
  try { await psql("select * from public.agentproof_register_concierge_repository_grant('tenant_alpha',101,205,'opaque/repository-denied');", "anon"); } catch { anonGrantRegistrationRpcRejected = true; }
  if (!anonGrantRegistrationRpcRejected) throw new Error("anon Concierge registration RPC access was not rejected.");
  let authenticatedGrantRegistrationRpcRejected = false;
  try { await psql("select * from public.agentproof_register_concierge_repository_grant('tenant_alpha',101,205,'opaque/repository-denied');", "authenticated"); } catch { authenticatedGrantRegistrationRpcRejected = true; }
  if (!authenticatedGrantRegistrationRpcRejected) throw new Error("authenticated Concierge registration RPC access was not rejected.");

  stage = "terminal_transition";
  const completed = scalar((await psql(`select public.agentproof_finish_concierge_analysis('${key}','completed','manual_report_validated','has_top_gap');`, "service_role")).stdout);
  const reversed = scalar((await psql(`select public.agentproof_finish_concierge_analysis('${key}','failed','provider_unavailable','not_recorded');`, "service_role")).stdout);
  if (completed !== "t" || reversed !== "f") throw new Error("Terminal transition invariant failed.");

  stage = "feedback_binding";
  const feedbackOutcomes = await Promise.all(Array.from({ length: 20 }, () => psql(`select public.agentproof_record_concierge_feedback('tenant_alpha','${feedbackPayload(key)}'::jsonb);`, "service_role").then(({ stdout }) => scalar(stdout))));
  if (feedbackOutcomes.filter((value) => value === "stored").length !== 1 || feedbackOutcomes.filter((value) => value === "duplicate").length !== 19) throw new Error("Concurrent feedback idempotency invariant failed.");
  const feedbackRows = scalar((await psql(`select count(*) from public.agentproof_concierge_feedback where tenant_id = 'tenant_alpha' and partner_id = 'partner_a1b2c3d4' and session_ordinal = 1 and case_id_or_hash = '${key}';`)).stdout);
  if (feedbackRows !== "1") throw new Error("Feedback unique identity invariant failed.");

  const externalZeroGapKey = "7".repeat(64);
  const externalZeroGapReserve = scalar((await psql(`select outcome from public.agentproof_reserve_concierge_analysis('${externalZeroGapKey}','tenant_alpha',101,202);`, "service_role")).stdout);
  const externalZeroGapComplete = scalar((await psql(`select public.agentproof_finish_concierge_analysis('${externalZeroGapKey}','completed','manual_report_validated','zero_gap');`, "service_role")).stdout);
  const externalZeroGapFeedback = scalar((await psql(`select public.agentproof_record_concierge_feedback('tenant_alpha','${feedbackPayload(externalZeroGapKey, { participant_cohort: "external_reviewer", pre_report_gap_category: "evidence_insufficient", top_gap_outcome: "not_applicable_zero_gap", found_top_gap_within_30s: false, time_to_top_gap_seconds: null, reprompt_action: "not_used" })}'::jsonb);`, "service_role")).stdout);
  const externalZeroGapStored = scalar((await psql(`select participant_cohort || ':' || pre_report_gap_category || ':' || top_gap_outcome from public.agentproof_concierge_feedback where case_id_or_hash='${externalZeroGapKey}';`)).stdout);
  if (externalZeroGapReserve !== "reserved" || externalZeroGapComplete !== "t" || externalZeroGapFeedback !== "stored" || externalZeroGapStored !== "external_reviewer:evidence_insufficient:not_applicable_zero_gap") throw new Error("Feedback cohort or zero-gap classification invariant failed.");
  const inconsistentTiming = scalar((await psql(`select public.agentproof_record_concierge_feedback('tenant_alpha','${feedbackPayload(externalZeroGapKey, { participant_cohort: "external_reviewer", top_gap_outcome: "not_applicable_zero_gap", found_top_gap_within_30s: true, time_to_top_gap_seconds: 4 })}'::jsonb);`, "service_role")).stdout);
  if (inconsistentTiming !== "rejected") throw new Error("Inconsistent zero-gap timing metadata was accepted.");
  const inconsistentZeroGapAction = scalar((await psql(`select public.agentproof_record_concierge_feedback('tenant_alpha','${feedbackPayload(externalZeroGapKey, { participant_cohort: "external_reviewer", top_gap_outcome: "not_applicable_zero_gap", found_top_gap_within_30s: false, time_to_top_gap_seconds: null, reprompt_action: "sent" })}'::jsonb);`, "service_role")).stdout);
  if (inconsistentZeroGapAction !== "rejected") throw new Error("A zero-gap report accepted a re-prompt action.");

  const reservedFeedbackKey = "e".repeat(64);
  const reservedFeedbackReserve = scalar((await psql(`select outcome from public.agentproof_reserve_concierge_analysis('${reservedFeedbackKey}','tenant_alpha',101,202);`, "service_role")).stdout);
  const reservedFeedback = scalar((await psql(`select public.agentproof_record_concierge_feedback('tenant_alpha','${feedbackPayload(reservedFeedbackKey)}'::jsonb);`, "service_role")).stdout);
  const unknownFeedback = scalar((await psql(`select public.agentproof_record_concierge_feedback('tenant_alpha','${feedbackPayload("f".repeat(64))}'::jsonb);`, "service_role")).stdout);
  if (reservedFeedbackReserve !== "reserved" || reservedFeedback !== "rejected" || unknownFeedback !== "rejected") throw new Error("Pre-completion feedback binding invariant failed.");

  const tenantBravoKey = "9".repeat(64);
  const bravoReserve = scalar((await psql(`select outcome from public.agentproof_reserve_concierge_analysis('${tenantBravoKey}','tenant_bravo',102,203);`, "service_role")).stdout);
  const bravoComplete = scalar((await psql(`select public.agentproof_finish_concierge_analysis('${tenantBravoKey}','completed','manual_report_validated','has_top_gap');`, "service_role")).stdout);
  const crossTenantFeedback = scalar((await psql(`select public.agentproof_record_concierge_feedback('tenant_alpha','${feedbackPayload(tenantBravoKey)}'::jsonb);`, "service_role")).stdout);
  if (bravoReserve !== "reserved" || bravoComplete !== "t" || crossTenantFeedback !== "rejected") throw new Error("Cross-tenant feedback isolation invariant failed.");

  for (const role of ["anon", "authenticated", "service_role"]) {
    let feedbackDmlRejected = false;
    try { await psql(`insert into public.agentproof_concierge_feedback(tenant_id,schema_version,partner_id,session_ordinal,case_id_or_hash,task_source_quality,pr_size_bucket,pre_report_gap_category,found_top_gap_within_30s,top_gap_agreement,first_inspection_action,reprompt_action,usefulness,operator_assisted,operator_minutes_bucket,actual_repeat_use_ordinal,bounded_reason_category) values ('tenant_alpha','concierge-feedback.v2','partner_e5f6a7b8',1,'${key}','linked_issue','small','execution',true,'agree','check','copied',4,true,'1_5',1,'other');`, role); } catch { feedbackDmlRejected = true; }
    if (!feedbackDmlRejected) throw new Error(`${role} direct feedback DML was not rejected.`);
  }
  const rawFeedback = scalar((await psql(`select public.agentproof_record_concierge_feedback('tenant_alpha','${feedbackPayload(key, { raw_evidence: "diff --git a/private b/private" })}'::jsonb);`, "service_role")).stdout);
  if (rawFeedback !== "rejected") throw new Error("Raw-looking feedback field was accepted.");
  const removedOptionalReasonColumn = scalar((await psql("select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'agentproof_concierge_feedback' and column_name = 'optional_reason';")).stdout);
  if (removedOptionalReasonColumn !== "0") throw new Error("Removed optional_reason column remains in the durable schema.");

  const failedKey = "d".repeat(64);
  const failedReserve = scalar((await psql(`select outcome from public.agentproof_reserve_concierge_analysis('${failedKey}','tenant_alpha',101,202);`, "service_role")).stdout);
  const failedTerminal = scalar((await psql(`select public.agentproof_finish_concierge_analysis('${failedKey}','failed','provider_unavailable','not_recorded');`, "service_role")).stdout);
  const failedReverse = scalar((await psql(`select public.agentproof_finish_concierge_analysis('${failedKey}','completed','manual_report_validated','has_top_gap');`, "service_role")).stdout);
  const failedDuplicate = scalar((await psql(`select outcome from public.agentproof_reserve_concierge_analysis('${failedKey}','tenant_alpha',101,202);`, "service_role")).stdout);
  if (failedReserve !== "reserved" || failedTerminal !== "t" || failedReverse !== "f" || failedDuplicate !== "duplicate") throw new Error("Failed terminal lifecycle invariant failed.");

  console.log(JSON.stringify({ status: "passed", legacyV2UpgradePreserved: true, conciergeGrantPreservation: { existingUnchanged: true, concurrentCreated: 1, concurrentExisting: 19, newManualOnly: true }, deletionState: { metadataOnlySchema: true, rlsEnabled: true, absentAllowsAuthorization: true, activeBlocksAuthorization: true, duplicateStartIsIdempotent: true, directTableAccessRejected: ["anon", "authenticated", "service_role"], nonServiceRpcRejected: true, invalidTransitionRejected: true }, concurrentReserve: { reserved: 1, duplicate: 19 }, directDmlRejected: ["anon", "authenticated", "service_role"], anonRpcRejected: true, authenticatedRpcRejected: true, anonFeedbackRpcRejected: true, authenticatedFeedbackRpcRejected: true, anonGrantRegistrationRpcRejected: true, authenticatedGrantRegistrationRpcRejected: true, terminalReversalRejected: true, failedTerminalLifecycleRejected: true, feedbackConcurrentIdempotency: { stored: 1, duplicate: 19, rowCount: 1 }, feedbackCohortAndZeroGapBounded: true, preCompletionAndUnknownFeedbackRejected: true, crossTenantFeedbackRejected: true, feedbackRawFieldRejected: true, optionalReasonColumnAbsent: true }));
} catch (error) {
  throw new Error(`concierge DB integration failed at ${stage}: ${error instanceof Error ? error.message : "unknown"}`);
} finally {
  await docker(["rm", "-f", name]).catch(() => undefined);
}
