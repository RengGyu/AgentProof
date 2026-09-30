import { createHash } from "crypto";
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
  const config = personalDeletionStore(env, name => console.warn("Account deletion storage setup required:", name));
  if (!config) return noStoreJson({ status: "unavailable", reason: "storage_setup_required" }, { status: 503 });
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
