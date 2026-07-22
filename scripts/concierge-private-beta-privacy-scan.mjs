import { readFile } from "node:fs/promises";

const runtimeFiles = [
  "src/app/api/tenants/concierge/analyze/route.ts",
  "src/app/api/tenants/concierge/feedback/route.ts",
  "src/app/api/tenants/concierge/repositories/route.ts",
  "src/app/api/auth/github/start/route.ts",
  "src/app/api/auth/github/callback/route.ts",
  "src/app/api/auth/github/repositories/route.ts",
  "src/app/api/auth/github/session/route.ts",
  "src/app/api/auth/me/route.ts",
  "src/components/ConciergeWorkspace.tsx",
  "src/components/ConciergeFeedbackForm.tsx",
  "src/lib/concierge-analysis-store.ts",
  "src/lib/concierge-feedback.ts",
  "src/lib/concierge-private-beta.ts",
  "src/lib/concierge-side-effect-telemetry.ts"
  ,"src/lib/concierge-github-auth.ts"
];
const forbiddenRuntime = /\b(?:localStorage|sessionStorage|indexedDB|console\.(?:log|warn|error|debug))\b/;
const migrationPath = "supabase/migrations/202607140001_concierge_private_beta.sql";
const clarityMigrationPath = "supabase/migrations/202607200001_human_beta_feedback_clarity.sql";
const oauthMigrationPath = "supabase/migrations/202607210001_concierge_github_user_auth.sql";
const forbiddenDurableColumns = /\b(?:raw_(?:task|pr|diff|log|report|prompt|reprompt|evidence)|(?:task|pr|report|prompt|diff|log)_body|token|authorization|cookie)\b/i;

const findings = [];
for (const file of runtimeFiles) {
  const source = await readFile(file, "utf8");
  if (forbiddenRuntime.test(source)) findings.push({ file, code: "runtime_persistence_or_logging" });
}

const migration = await readFile(migrationPath, "utf8");
for (const table of ["agentproof_concierge_analysis_runs", "agentproof_concierge_feedback"]) {
  const match = migration.match(new RegExp(`create table if not exists ${table} \\(([\\s\\S]*?)\\n\\);`, "i"));
  if (!match) findings.push({ file: migrationPath, code: `table_definition_missing:${table}` });
  else if (forbiddenDurableColumns.test(match[1])) findings.push({ file: migrationPath, code: `forbidden_durable_column:${table}` });
}
const clarityMigration = await readFile(clarityMigrationPath, "utf8");
for (const match of clarityMigration.matchAll(/add column if not exists\s+([a-z0-9_]+)\s+/gi)) {
  if (forbiddenDurableColumns.test(match[1])) findings.push({ file: clarityMigrationPath, code: `forbidden_durable_column:${match[1]}` });
}
const oauthMigration = await readFile(oauthMigrationPath, "utf8");
for (const table of ["agentproof_concierge_github_oauth_states", "agentproof_concierge_github_sessions", "agentproof_concierge_github_session_repositories"]) {
  const match = oauthMigration.match(new RegExp(`create table if not exists public\\.${table} \\(([\\s\\S]*?)\\n\\);`, "i"));
  if (!match) findings.push({ file: oauthMigrationPath, code: `table_definition_missing:${table}` });
  else if (/\b(?:access_token|refresh_token|oauth_code|code_verifier|authorization|cookie|raw_(?:task|pr|diff|log|report|prompt|reprompt|evidence))\b/i.test(match[1])) findings.push({ file: oauthMigrationPath, code: `forbidden_oauth_durable_column:${table}` });
}

if (findings.length > 0) {
  console.error(JSON.stringify({ status: "failed", scan: "concierge-runtime-privacy.v1", findings }));
  process.exit(1);
}
console.log(JSON.stringify({ status: "passed", scan: "concierge-runtime-privacy.v2", runtimeFileCount: runtimeFiles.length, durableTableCount: 5 }));
