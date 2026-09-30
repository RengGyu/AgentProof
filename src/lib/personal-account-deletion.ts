import { createHash } from "crypto";
import { getControlPlaneSupabaseEnv } from "./control-plane-supabase";
import { verifySameOriginMutationRequest } from "./csrf";
import { noStoreJson } from "./http";
import { mobileCookieFromRequest } from "./mobile-auth";
import { clearTenantAuthSessionCookie, MOBILE_AUTH_SESSION_COOKIE, TENANT_AUTH_SESSION_COOKIE } from "./tenant-auth";
import { clearGitHubOAuthInstallCookie, clearGitHubOAuthStateCookie } from "./public-github-auth";
import { personalDeletionRpc, personalDeletionStore } from "./personal-deletion-store";
export { personalDeletionStore } from "./personal-deletion-store";

export async function handlePersonalAccountDeletion(request: Request, source: "web" | "mobile", env = process.env) {
  if (request.method !== "GET" && request.method !== "POST") return noStoreJson({ status: "unavailable" }, { status: 405 });
  if (source === "web" && request.method === "POST" && !verifySameOriginMutationRequest(request).ok) return noStoreJson({ status: "forbidden" }, { status: 403 });
  const header = source === "mobile" ? mobileCookieFromRequest(request) : request.headers.get("cookie");
  const name = source === "mobile" ? MOBILE_AUTH_SESSION_COOKIE : TENANT_AUTH_SESSION_COOKIE;
  const token = header?.split(";").map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return noStoreJson({ status: "unauthorized" }, { status: 401 });
  if (request.method === "POST") {
    const raw = await request.text();
    try {
      if (raw.length > 256) throw new Error();
      const body = JSON.parse(raw);
      if (body?.confirmation !== "DELETE" || Object.keys(body).length !== 1) throw new Error();
    } catch { return noStoreJson({ status: "confirmation_required" }, { status: 400 }); }
  }
  let claimUrlMismatch = false;
  const config = personalDeletionStore(env, name => {
    console.warn("Account deletion storage setup required:", name);
    claimUrlMismatch = name === "AGENTPROOF_GITHUB_INSTALLATION_CLAIMS_SUPABASE_URL:different_url";
  });
  if (!config) {
    if (request.method === "GET" && claimUrlMismatch) await diagnoseClaimStore(token, source, env);
    return noStoreJson({ status: "unavailable", reason: "storage_setup_required" }, { status: 503 });
  }
  try {
    const result = await personalDeletionRpc(config, "agentproof_delete_personal_account", { p_token_hash: createHash("sha256").update(token).digest("hex"), p_source: source === "mobile" ? "mobile" : "github", p_action: request.method === "POST" ? "delete" : "status", p_required_tables: config.requiredTables }) as { status?: unknown; reason?: unknown };
    const status = result?.status;
    if (!["ready", "completed", "pending", "shared_workspace", "unauthorized", "unavailable"].includes(String(status))) throw new Error();
    const code = status === "unauthorized" ? 401 : status === "shared_workspace" ? 409 : status === "unavailable" ? 503 : status === "pending" ? 202 : 200;
    const headers = new Headers();
    if (status === "completed" && source === "web") {
      for (const cookie of [clearTenantAuthSessionCookie(), clearGitHubOAuthInstallCookie(), clearGitHubOAuthStateCookie()]) headers.append("Set-Cookie", cookie);
    }
    return noStoreJson({ status, ...(result.reason === "work_draining" || result.reason === "retry_required" ? { reason: result.reason } : {}) }, { status: code, headers });
  } catch { return noStoreJson({ status: "unavailable" }, { status: 503 }); }
}

// Temporary diagnostic: remove this helper and its GET-only call after setup.
async function diagnoseClaimStore(token: string, source: "web" | "mobile", env: NodeJS.ProcessEnv) {
  try {
    const shared = getControlPlaneSupabaseEnv(env);
    if (!shared.url || !shared.serviceRoleKey) return;
    // The existing SQL status branch checks session/source/expiry, identity,
    // active owner and sole membership, then returns before any data DML.
    // Unlike normal session resolution, it cannot renew the session.
    const result = await personalDeletionRpc({ url: shared.url.replace(/\/+$/, ""), key: shared.serviceRoleKey, requiredTables: [] },
      "agentproof_delete_personal_account", {
        p_token_hash: createHash("sha256").update(token).digest("hex"),
        p_source: source === "mobile" ? "mobile" : "github",
        p_action: "status", p_required_tables: []
      }) as { status?: unknown } | null;
    // A completion receipt alone does not establish a current account owner.
    if (result?.status !== "ready" && result?.status !== "pending") return;
  } catch { return; }

  const log = (status: number, classification: "ok" | "authentication" | "table_or_schema_cache" | "unknown" | "request_failed" | "probe_not_configured") => {
    console.warn("account_deletion_claim_store_diagnostic", { status, classification });
  };
  const configuredUrl = env.AGENTPROOF_GITHUB_INSTALLATION_CLAIMS_SUPABASE_URL ?? "";
  // Never reuse the shared database's key for the mismatched URL. Only the
  // explicitly configured claim endpoint/key pair may authorize this read.
  const key = env.AGENTPROOF_GITHUB_INSTALLATION_CLAIMS_SUPABASE_SERVICE_ROLE_KEY;
  const table = env.AGENTPROOF_GITHUB_INSTALLATION_CLAIMS_TABLE || "agentproof_github_installation_claims";
  if (!key) { log(0, "probe_not_configured"); return; }
  try {
    const parsed = new URL(configuredUrl);
    if (configuredUrl !== configuredUrl.trim() || parsed.protocol !== "https:"
      || !/^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname) || parsed.port
      || parsed.username || parsed.password || parsed.search || parsed.hash
      || table !== "agentproof_github_installation_claims") { log(0, "probe_not_configured"); return; }
  } catch { log(0, "probe_not_configured"); return; }
  try {
    // Match the existing claim-store path construction. Do not fix/guess URLs.
    const response = await fetch(`${configuredUrl.replace(/\/+$/, "")}/rest/v1/${table}?select=id&limit=0`, {
      method: "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000),
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    if (response.ok) { await response.body?.cancel(); log(response.status, "ok"); return; }
    if (response.status === 401 || response.status === 403) { await response.body?.cancel(); log(response.status, "authentication"); return; }
    const body: unknown = await response.json().catch(() => null);
    const code = body && typeof body === "object" && !Array.isArray(body) ? (body as { code?: unknown }).code : undefined;
    log(response.status, code === "PGRST205" || code === "42P01" ? "table_or_schema_cache" : "unknown");
  } catch { log(0, "request_failed"); }
}
