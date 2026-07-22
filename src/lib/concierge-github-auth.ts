import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { noStoreJson } from "./http";
import { getConciergeStoreConfigurationStatus } from "./concierge-store-configuration";

export const CONCIERGE_GITHUB_OAUTH_COOKIE = "__Host-agentproof-concierge-github-oauth";
export const CONCIERGE_GITHUB_SESSION_COOKIE = "__Host-agentproof-concierge-github-session";
export const CONCIERGE_GITHUB_AUTH_VERSION = "github-user-oauth.v1";

const STATE_TTL_MS = 15 * 60 * 1000;
// A short-lived cookie limits exposure even if the GitHub authorization
// revocation delivery is delayed or misconfigured. The webhook path below is
// an additional control, not the only one.
const SESSION_TTL_MS = 55 * 60 * 1000;
const GITHUB_API_VERSION = "2022-11-28";
const NETWORK_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BODY_BYTES = 256 * 1024;
const MAX_USER_INSTALLATION_PAGES = 5;
const MAX_INSTALLATION_REPOSITORY_PAGES = 5;
const MAX_SESSION_REPOSITORIES = MAX_INSTALLATION_REPOSITORY_PAGES * 100;

export type ConciergeGitHubAuthReason =
  | "oauth_not_configured"
  | "oauth_state_invalid"
  | "oauth_state_replayed"
  | "oauth_provider_unavailable"
  | "oauth_identity_unavailable"
  | "personal_installation_required"
  | "organization_installation_unsupported"
  | "installation_not_active"
  | "repository_access_unavailable"
  | "private_repository_required"
  | "session_already_active"
  | "installation_inventory_too_large"
  | "repository_inventory_too_large"
  | "durable_store_mismatch"
  | "session_invalid";

export type ConciergeGitHubOAuthStateStage =
  | "query_invalid"
  | "state_missing"
  | "state_invalid_shape"
  | "code_missing"
  | "code_invalid_shape"
  | "provider_redirect_uri_mismatch"
  | "provider_access_denied"
  | "provider_error"
  | "installation_app_missing"
  | "installation_identity_mismatch"
  | "installation_multiple"
  | "cookie_missing"
  | "cookie_invalid"
  | "state_mismatch";

export interface GitHubUserIdentity { id: number; type: "User" | "Organization" | string }
export interface GitHubUserInstallation {
  id: number;
  appId: number;
  targetId: number;
  targetType: "User" | "Organization" | string;
  account: { id: number; type: "User" | "Organization" | string };
  suspendedAt?: string | null;
}
export interface GitHubUserRepository { id: number; fullName: string; private: boolean; ownerId: number; ownerType: string }
export interface ConciergeGitHubSession { tenantId: string; memberId: string; githubUserId: number; installationId: number; repositoryIds: number[]; expiresAt: string }

interface OAuthCookiePayload { state: string; verifier: string; expiresAt: string }
interface OAuthConfig { clientId: string; clientSecret: string; stateSecret: string; feedbackPseudonymSecret: string; callbackUrl: string; appId: number }
interface DurableConfig { url: string; key: string }

export interface ConciergeGitHubAuthDependencies {
  fetch: typeof fetch;
  now: () => number;
  random: (bytes: number) => string;
  networkTimeoutMs?: number;
}
const DEFAULT_DEPS: ConciergeGitHubAuthDependencies = { fetch, now: () => Date.now(), random: (bytes) => randomBytes(bytes).toString("base64url"), networkTimeoutMs: NETWORK_TIMEOUT_MS };

export function getConciergeGitHubAuthConfigStatus(env = process.env): { configured: boolean; missing: string[] } {
  const missing = [
    !env.AGENTPROOF_GITHUB_OAUTH_CLIENT_ID?.trim() && "AGENTPROOF_GITHUB_OAUTH_CLIENT_ID",
    !env.AGENTPROOF_GITHUB_OAUTH_CLIENT_SECRET?.trim() && "AGENTPROOF_GITHUB_OAUTH_CLIENT_SECRET",
    !validIndependentSecrets(env.AGENTPROOF_CONCIERGE_OAUTH_STATE_SECRET, env.AGENTPROOF_CONCIERGE_FEEDBACK_PSEUDONYM_SECRET) && "AGENTPROOF_CONCIERGE_OAUTH_STATE_SECRET/AGENTPROOF_CONCIERGE_FEEDBACK_PSEUDONYM_SECRET",
    !normalizeCallbackUrl(env.AGENTPROOF_CONCIERGE_OAUTH_CALLBACK_URL) && "AGENTPROOF_CONCIERGE_OAUTH_CALLBACK_URL",
    !positiveInt(env.GITHUB_APP_ID) && "GITHUB_APP_ID"
  ].filter((value): value is string => Boolean(value));
  const stores = getConciergeStoreConfigurationStatus(env);
  if (missing.length > 0) return { configured: false, missing };
  if (!durableConfig(env) || !stores.configured) return { configured: false, missing: ["AGENTPROOF_CONCIERGE_SUPABASE_URL/key and same-project durable stores"] };
  if (!stores.consistent) return { configured: false, missing: ["same Supabase project for every Concierge store"] };
  return { configured: true, missing: [] };
}

/** Fixed registered origin; never derive a post-login target from Host or query input. */
export function conciergeGitHubLandingUrl(env = process.env): string | null {
  try { return new URL("/concierge", requireConfig(env).callbackUrl).toString(); } catch { return null; }
}

export async function startConciergeGitHubOAuth(env = process.env, deps = DEFAULT_DEPS, cookieHeader?: string | null): Promise<{ redirectUrl: string; cookie: string }> {
  const config = requireConfig(env);
  // A second browser tab must not create another active Concierge session.
  // A durable read failure is intentionally propagated rather than guessing.
  if (readCookie(cookieHeader, CONCIERGE_GITHUB_SESSION_COOKIE)) {
    const existing = await readConciergeGitHubSession(cookieHeader, env, deps);
    if (existing) throw authError("session_already_active");
  }
  const state = deps.random(32);
  const verifier = deps.random(48);
  const now = deps.now();
  const expiresAt = new Date(now + STATE_TTL_MS).toISOString();
  const reserved = await oauthRpc<boolean>("agentproof_reserve_concierge_github_oauth_state", {
    p_state_hash: sha256(state), p_created_at: new Date(now).toISOString(), p_expires_at: expiresAt
  }, env, deps.fetch, timeoutFor(deps));
  if (reserved !== true) throw authError("oauth_provider_unavailable");
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", config.clientId);
  authorize.searchParams.set("redirect_uri", config.callbackUrl);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", pkceChallenge(verifier));
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("allow_signup", "false");
  return { redirectUrl: authorize.toString(), cookie: oauthCookie({ state, verifier, expiresAt }, config.stateSecret, expiresAt, now) };
}

export async function completeConciergeGitHubOAuth(
  input: { state?: string | null; code?: string | null; cookieHeader?: string | null },
  env = process.env,
  deps = DEFAULT_DEPS
): Promise<{ sessionCookie: string; expiresAt: string }> {
  const config = requireConfig(env);
  if (input.state === null || input.state === undefined || input.state === "") throw oauthStateError("state_missing");
  if (!boundedOAuthState(input.state)) throw oauthStateError("state_invalid_shape");
  if (input.code === null || input.code === undefined || input.code === "") throw oauthStateError("code_missing");
  if (!boundedOAuthCode(input.code)) throw oauthStateError("code_invalid_shape");
  const state = input.state;
  const code = input.code;
  const cookie = readCookie(input.cookieHeader, CONCIERGE_GITHUB_OAUTH_COOKIE);
  if (!cookie) throw oauthStateError("cookie_missing");
  const pending = parseOAuthCookie(cookie, config.stateSecret, deps.now());
  if (!pending) throw oauthStateError("cookie_invalid");
  if (!safeEqual(state, pending.state)) throw oauthStateError("state_mismatch");
  const timeoutMs = timeoutFor(deps);
  const consumed = await oauthRpc<boolean>("agentproof_consume_concierge_github_oauth_state", { p_state_hash: sha256(state), p_used_at: new Date(deps.now()).toISOString() }, env, deps.fetch, timeoutMs);
  if (consumed !== true) throw authError("oauth_state_replayed");

  // OAuth values are confined to this function scope. Do not log, store, or
  // return either the authorization code or the provider token response.
  const accessToken = await exchangeCode(code, pending.verifier, config, deps.fetch, timeoutMs);
  const user = await githubUser(accessToken, deps.fetch, timeoutMs);
  const installations = await githubInstallations(accessToken, deps.fetch, timeoutMs);
  const choice = selectPersonalInstallation(user, installations, config.appId);
  if (choice.kind !== "selected") throw authDiagnosticError(choice.reason, installationDiagnosticStage(user, installations, config.appId));
  const repositories = await githubInstallationRepositories(accessToken, choice.installation.id, deps.fetch, timeoutMs);
  const personalRepositories = repositories.filter((repository) => repository.ownerId === user.id && repository.ownerType === "User" && repository.private);
  if (personalRepositories.length === 0) {
    const hasPublicPersonalRepository = repositories.some((repository) => repository.ownerId === user.id && repository.ownerType === "User" && !repository.private);
    throw authError(hasPublicPersonalRepository ? "private_repository_required" : "repository_access_unavailable");
  }

  const token = deps.random(32);
  const now = deps.now();
  const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();
  const result = await oauthRpc<string>("agentproof_create_concierge_github_session", {
    p_token_hash: sha256(token), p_tenant_id: await tenantForInstallation(choice.installation.id, user.id, env, deps.fetch, timeoutMs),
    p_github_user_id: user.id, p_installation_id: choice.installation.id,
    p_repository_ids: personalRepositories.map((repository) => repository.id), p_created_at: new Date(now).toISOString(), p_expires_at: expiresAt
  }, env, deps.fetch, timeoutMs);
  if (result !== "created") throw authError(result === "identity_mismatch" ? "personal_installation_required" : "oauth_provider_unavailable");
  return { sessionCookie: secureCookie(CONCIERGE_GITHUB_SESSION_COOKIE, token, expiresAt, now), expiresAt };
}

export async function readConciergeGitHubSession(cookieHeader?: string | null, env = process.env, deps = DEFAULT_DEPS): Promise<ConciergeGitHubSession | null> {
  const token = readCookie(cookieHeader, CONCIERGE_GITHUB_SESSION_COOKIE);
  if (!token) return null;
  const rows = await oauthRpc<unknown>("agentproof_read_concierge_github_session", { p_token_hash: sha256(token), p_now: new Date(deps.now()).toISOString() }, env, deps.fetch, timeoutFor(deps));
  if (Array.isArray(rows) && rows.length === 0) return null;
  const session = normalizeSessionRows(rows);
  if (!session) throw authError("oauth_provider_unavailable");
  return session;
}

export async function revokeConciergeGitHubSession(cookieHeader?: string | null, env = process.env, deps = DEFAULT_DEPS): Promise<boolean> {
  const token = readCookie(cookieHeader, CONCIERGE_GITHUB_SESSION_COOKIE);
  if (!token) return true;
  const outcome = await oauthRpc<unknown>("agentproof_revoke_concierge_github_session", { p_token_hash: sha256(token), p_revoked_at: new Date(deps.now()).toISOString() }, env, deps.fetch, timeoutFor(deps));
  // Logout is idempotent: a stale cookie represents an already absent durable
  // session, so it has reached the same safe terminal state.
  return outcome === "revoked" || outcome === "already_revoked" || outcome === "not_found";
}

/** Signed GitHub authorization-revocation webhooks use this bounded, numeric-only transition. */
export async function revokeConciergeGitHubSessionsForUser(githubUserId: number, env = process.env, deps = DEFAULT_DEPS): Promise<number> {
  if (!positiveInt(githubUserId)) throw authError("oauth_identity_unavailable");
  const result = await oauthRpc<unknown>("agentproof_revoke_concierge_github_sessions_for_user", { p_github_user_id: githubUserId, p_revoked_at: new Date(deps.now()).toISOString() }, env, deps.fetch, timeoutFor(deps));
  if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 0) throw authError("oauth_provider_unavailable");
  return result;
}

export function clearConciergeGitHubCookies(now = Date.now()): string[] {
  return [clearConciergeGitHubOAuthCookie(now), clearConciergeGitHubSessionCookie(now)];
}

/** Pending PKCE state and the durable Concierge session have separate lifecycle contracts. */
export function clearConciergeGitHubOAuthCookie(now = Date.now()): string {
  return secureCookie(CONCIERGE_GITHUB_OAUTH_COOKIE, "deleted", new Date(now).toISOString(), now);
}

/** Clear this only after durable revoke confirmed a safe terminal result. */
export function clearConciergeGitHubSessionCookie(now = Date.now()): string {
  return secureCookie(CONCIERGE_GITHUB_SESSION_COOKIE, "deleted", new Date(now).toISOString(), now);
}

export function selectPersonalInstallation(user: GitHubUserIdentity, installations: GitHubUserInstallation[], expectedAppId: number): { kind: "selected"; installation: GitHubUserInstallation } | { kind: "blocked"; reason: ConciergeGitHubAuthReason } {
  const personal = installations.filter((installation) => installation.appId === expectedAppId && installation.account.type === "User" && installation.targetType === "User" && installation.account.id === user.id && installation.targetId === user.id && !installation.suspendedAt);
  if (personal.length === 1) return { kind: "selected", installation: personal[0]! };
  if (installations.some((installation) => installation.appId === expectedAppId && (installation.account.type === "Organization" || installation.targetType === "Organization"))) return { kind: "blocked", reason: "organization_installation_unsupported" };
  return { kind: "blocked", reason: "personal_installation_required" };
}

export function pkceChallenge(verifier: string): string { return createHash("sha256").update(verifier).digest("base64url"); }

/** A stable, non-reversible feedback subject. The numeric GitHub ID never leaves the server. */
export function pseudonymousConciergePartnerId(session: ConciergeGitHubSession, env = process.env): string | null {
  const secret = env.AGENTPROOF_CONCIERGE_FEEDBACK_PSEUDONYM_SECRET?.trim();
  if (!secret || !validIndependentSecrets(env.AGENTPROOF_CONCIERGE_OAUTH_STATE_SECRET, secret)) return null;
  return `partner_${createHmac("sha256", secret).update(`${session.tenantId}:${session.githubUserId}`).digest("hex").slice(0, 32)}`;
}

export function conciergeGitHubAuthErrorResponse(reason: ConciergeGitHubAuthReason, status: number) { return noStoreJson({ code: reason }, { status }); }

async function exchangeCode(code: string, verifier: string, config: OAuthConfig, request: typeof fetch, timeoutMs: number): Promise<string> {
  let result: { response: Response; json: unknown };
  try {
    result = await fetchJsonWithinBudget(request, "https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: config.callbackUrl, code_verifier: verifier }), cache: "no-store" }, timeoutMs);
  } catch { throw authError("oauth_provider_unavailable"); }
  const value = result.json as { access_token?: unknown } | null;
  if (!result.response.ok || !value || typeof value.access_token !== "string" || !value.access_token) throw authError("oauth_provider_unavailable");
  return value.access_token;
}
async function githubUser(token: string, request: typeof fetch, timeoutMs: number): Promise<GitHubUserIdentity> { return githubGet("/user", token, request, normalizeUser, timeoutMs); }
async function githubInstallations(token: string, request: typeof fetch, timeoutMs: number): Promise<GitHubUserInstallation[]> {
  const installations: GitHubUserInstallation[] = [];
  for (let page = 1; page <= MAX_USER_INSTALLATION_PAGES + 1; page += 1) {
    const rows = await githubGet(`/user/installations?per_page=100&page=${page}`, token, request, normalizeInstallationPage, timeoutMs);
    if (page > MAX_USER_INSTALLATION_PAGES) {
      if (rows.length > 0) throw authError("installation_inventory_too_large");
      break;
    }
    installations.push(...rows);
    if (rows.length < 100) break;
  }
  if (new Set(installations.map((installation) => installation.id)).size !== installations.length) throw authError("oauth_identity_unavailable");
  return installations;
}
async function githubInstallationRepositories(token: string, installationId: number, request: typeof fetch, timeoutMs: number): Promise<GitHubUserRepository[]> {
  const repositories: GitHubUserRepository[] = [];
  // The sixth request is a bounded sentinel: it prevents silently dropping a
  // 501st repository while retaining at most 500 authorization records.
  for (let page = 1; page <= MAX_INSTALLATION_REPOSITORY_PAGES + 1; page += 1) {
    const response = await githubGet(`/user/installations/${installationId}/repositories?per_page=100&page=${page}`, token, request, (json) => {
      if (!json || typeof json !== "object" || Array.isArray(json)) return null;
      const rows = (json as { repositories?: unknown }).repositories;
      if (!Array.isArray(rows) || rows.length > 100) return null;
      const normalized = rows.map(normalizeRepository);
      return normalized.every((item): item is GitHubUserRepository => Boolean(item)) ? normalized : null;
    }, timeoutMs);
    if (page > MAX_INSTALLATION_REPOSITORY_PAGES) {
      if (response.length > 0) throw authError("repository_inventory_too_large");
      break;
    }
    repositories.push(...response);
    if (response.length < 100) break;
  }
  if (new Map(repositories.map((repository) => [repository.id, repository])).size !== repositories.length) {
    throw authError("oauth_identity_unavailable");
  }
  return repositories;
}
async function githubGet<T>(path: string, token: string, request: typeof fetch, normalize: (value: unknown) => T | null, timeoutMs: number): Promise<T> {
  let result: { response: Response; json: unknown };
  try { result = await fetchJsonWithinBudget(request, `https://api.github.com${path}`, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": GITHUB_API_VERSION }, cache: "no-store" }, timeoutMs); }
  catch { throw authError("oauth_provider_unavailable"); }
  const value = normalize(result.json);
  if (!result.response.ok || !value) throw authError("oauth_identity_unavailable");
  return value;
}
async function tenantForInstallation(installationId: number, githubUserId: number, env: NodeJS.ProcessEnv, request: typeof fetch, timeoutMs: number): Promise<string> { const rows = await oauthRpc<unknown>("agentproof_resolve_concierge_github_installation", { p_installation_id: installationId, p_github_user_id: githubUserId }, env, request, timeoutMs); if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== "object" || typeof (rows[0] as { tenant_id?: unknown }).tenant_id !== "string") throw authError("personal_installation_required"); return (rows[0] as { tenant_id: string }).tenant_id; }

function requireConfig(env: NodeJS.ProcessEnv): OAuthConfig {
  const callbackUrl = normalizeCallbackUrl(env.AGENTPROOF_CONCIERGE_OAUTH_CALLBACK_URL);
  const clientId = env.AGENTPROOF_GITHUB_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.AGENTPROOF_GITHUB_OAUTH_CLIENT_SECRET?.trim();
  const stateSecret = env.AGENTPROOF_CONCIERGE_OAUTH_STATE_SECRET?.trim();
  const feedbackPseudonymSecret = env.AGENTPROOF_CONCIERGE_FEEDBACK_PSEUDONYM_SECRET?.trim();
  const appId = positiveInt(env.GITHUB_APP_ID);
  const stores = getConciergeStoreConfigurationStatus(env);
  if (!callbackUrl || !clientId || !clientSecret || !stateSecret || !feedbackPseudonymSecret || !validIndependentSecrets(stateSecret, feedbackPseudonymSecret) || !appId || !durableConfig(env) || !stores.configured) throw authError("oauth_not_configured");
  if (!stores.consistent) throw authError("durable_store_mismatch");
  return { callbackUrl, clientId, clientSecret, stateSecret, feedbackPseudonymSecret, appId };
}
function durableConfig(env: NodeJS.ProcessEnv): DurableConfig | null { const url = env.AGENTPROOF_CONCIERGE_SUPABASE_URL || env.AGENTPROOF_CONTROL_PLANE_SUPABASE_URL || env.SUPABASE_URL; const key = env.AGENTPROOF_CONCIERGE_SUPABASE_SERVICE_ROLE_KEY || env.AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY; if (!url || !key) return null; try { const parsed = new URL(url); return parsed.protocol === "https:" && parsed.pathname === "/" ? { url: parsed.origin, key } : null; } catch { return null; } }
async function oauthRpc<T>(name: string, body: Record<string, unknown>, env: NodeJS.ProcessEnv, request: typeof fetch, timeoutMs: number): Promise<T> {
  const config = durableConfig(env);
  if (!config) throw authError("oauth_not_configured");
  const stores = getConciergeStoreConfigurationStatus(env);
  if (!stores.configured) throw authError("oauth_not_configured");
  if (!stores.consistent) throw authError("durable_store_mismatch");
  let result: { response: Response; json: unknown };
  try {
    result = await fetchJsonWithinBudget(request, `${config.url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.key, Authorization: `Bearer ${config.key}` },
      body: JSON.stringify(body),
      cache: "no-store"
    }, timeoutMs);
  } catch {
    throw authError("oauth_provider_unavailable");
  }
  if (!result.response.ok) throw authError("oauth_provider_unavailable");
  return result.json as T;
}
function oauthCookie(value: OAuthCookiePayload, secret: string, expiresAt: string, now: number): string { const encoded = Buffer.from(JSON.stringify(value)).toString("base64url"); const signature = createHmac("sha256", secret).update(encoded).digest("base64url"); return secureCookie(CONCIERGE_GITHUB_OAUTH_COOKIE, `${encoded}.${signature}`, expiresAt, now); }
function parseOAuthCookie(value: string | null, secret: string, now: number): OAuthCookiePayload | null { if (!value) return null; const [encoded, signature, extra] = value.split("."); if (!encoded || !signature || extra) return null; const expected = createHmac("sha256", secret).update(encoded).digest("base64url"); if (!safeEqual(signature, expected)) return null; try { const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OAuthCookiePayload; return boundedOAuthState(parsed.state) && boundedPkceVerifier(parsed.verifier) && typeof parsed.expiresAt === "string" && Date.parse(parsed.expiresAt) > now ? parsed : null; } catch { return null; } }
function secureCookie(name: string, value: string, expiresAt: string, now: number): string { const seconds = Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000)); return [`${name}=${value}`, "Path=/", "HttpOnly", "Secure", "SameSite=Lax", `Max-Age=${seconds}`, `Expires=${new Date(Date.parse(expiresAt)).toUTCString()}`].join("; "); }
function normalizeUser(value: unknown): GitHubUserIdentity | null { if (!value || typeof value !== "object" || Array.isArray(value)) return null; const row = value as { id?: unknown; type?: unknown }; const id = positiveInt(row.id); return id && typeof row.type === "string" ? { id, type: row.type } : null; }
function normalizeInstallationPage(json: unknown): GitHubUserInstallation[] | null {
  const rows = json && typeof json === "object" && !Array.isArray(json) ? (json as { installations?: unknown }).installations : null;
  if (!Array.isArray(rows) || rows.length > 100) return null;
  const normalized = rows.map(normalizeInstallation);
  return normalized.every((item): item is GitHubUserInstallation => Boolean(item)) ? normalized : null;
}
function normalizeInstallation(value: unknown): GitHubUserInstallation | null { if (!value || typeof value !== "object" || Array.isArray(value)) return null; const row = value as { id?: unknown; app_id?: unknown; target_id?: unknown; target_type?: unknown; account?: { id?: unknown; type?: unknown }; suspended_at?: unknown }; const id = positiveInt(row.id), appId = positiveInt(row.app_id), targetId = positiveInt(row.target_id), accountId = positiveInt(row.account?.id); if (!id || !appId || !targetId || !accountId || typeof row.target_type !== "string" || typeof row.account?.type !== "string" || (row.suspended_at !== null && row.suspended_at !== undefined && typeof row.suspended_at !== "string")) return null; return { id, appId, targetId, targetType: row.target_type, account: { id: accountId, type: row.account.type }, suspendedAt: row.suspended_at as string | null | undefined }; }
function normalizeRepository(value: unknown): GitHubUserRepository | null { if (!value || typeof value !== "object" || Array.isArray(value)) return null; const row = value as { id?: unknown; full_name?: unknown; private?: unknown; owner?: { id?: unknown; type?: unknown } }; const id = positiveInt(row.id), ownerId = positiveInt(row.owner?.id); return id && ownerId && typeof row.full_name === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(row.full_name) && typeof row.private === "boolean" && typeof row.owner?.type === "string" ? { id, fullName: row.full_name, private: row.private, ownerId, ownerType: row.owner.type } : null; }
function normalizeSessionRows(value: unknown): ConciergeGitHubSession | null { if (!Array.isArray(value) || value.length < 1 || value.length > MAX_SESSION_REPOSITORIES) return null; let tenantId = "", memberId = "", userId = 0, installationId = 0; const ids: number[] = []; for (const item of value) { if (!item || typeof item !== "object" || Array.isArray(item)) return null; const row = item as { tenant_id?: unknown; member_id?: unknown; github_user_id?: unknown; installation_id?: unknown; repository_id?: unknown }; const t = typeof row.tenant_id === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$/.test(row.tenant_id) ? row.tenant_id : ""; const m = typeof row.member_id === "string" && /^github-user-[1-9][0-9]{0,18}$/.test(row.member_id) ? row.member_id : ""; const u = positiveInt(row.github_user_id), i = positiveInt(row.installation_id), r = positiveInt(row.repository_id); if (!t || !m || !u || !i || !r || m !== `github-user-${u}` || (tenantId && (tenantId !== t || memberId !== m || userId !== u || installationId !== i))) return null; tenantId = t; memberId = m; userId = u; installationId = i; ids.push(r); } return new Set(ids).size === ids.length ? { tenantId, memberId, githubUserId: userId, installationId, repositoryIds: ids.sort((a,b) => a-b), expiresAt: "session-bound" } : null; }
function timeoutFor(deps: ConciergeGitHubAuthDependencies): number { const candidate = deps.networkTimeoutMs; return typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= 10 && candidate <= 30_000 ? candidate : NETWORK_TIMEOUT_MS; }
async function fetchJsonWithinBudget(request: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<{ response: Response; json: unknown }> {
  const budget = { deadline: Date.now() + timeoutMs };
  const response = await boundedFetch(request, url, init, budget);
  const json = await boundedJson(response, budget);
  return { response, json };
}
async function boundedFetch(request: typeof fetch, url: string, init: RequestInit, budget: { deadline: number }): Promise<Response> {
  const controller = new AbortController();
  try {
    return await boundedAwait(request(url, { ...init, signal: controller.signal }), budget, () => controller.abort());
  } finally {
    if (Date.now() >= budget.deadline) controller.abort();
  }
}
async function boundedJson(response: Response, budget: { deadline: number }): Promise<unknown> {
  const body = response.body;
  if (!body) throw new Error("oauth_response_body_missing");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const part = await boundedAwait(reader.read(), budget, () => { void reader.cancel(); });
      if (part.done) break;
      byteLength += part.value.byteLength;
      if (byteLength > MAX_RESPONSE_BODY_BYTES) {
        void reader.cancel();
        throw new Error("oauth_response_body_too_large");
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (Date.now() >= budget.deadline) throw new Error("oauth_response_timeout");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed = JSON.parse(text) as unknown;
    if (Date.now() >= budget.deadline) throw new Error("oauth_response_timeout");
    return parsed;
  } finally {
    reader.releaseLock();
  }
}
async function boundedAwait<T>(operation: Promise<T>, budget: { deadline: number }, onTimeout: () => void): Promise<T> {
  const remaining = budget.deadline - Date.now();
  if (remaining <= 0) { onTimeout(); throw new Error("oauth_response_timeout"); }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => { onTimeout(); reject(new Error("oauth_response_timeout")); }, remaining);
    })]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
function readCookie(header: string | null | undefined, name: string): string | null { return header?.split(";").map((part) => part.trim()).map((part) => part.split("=", 2)).find(([key]) => key === name)?.[1] ?? null; }
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function positiveInt(value: unknown): number | null { const number = typeof value === "string" ? Number(value) : value; return typeof number === "number" && Number.isSafeInteger(number) && number > 0 ? number : null; }
function boundedOAuthState(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value); }
function boundedPkceVerifier(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]{64}$/.test(value); }
// GitHub documents the authorization code as an opaque temporary string.
// Bound size and control bytes, but do not invent a provider format contract.
function boundedOAuthCode(value: unknown): value is string { return typeof value === "string" && /^[\x20-\x7e]{1,1024}$/.test(value); }
function validIndependentSecrets(stateSecret: string | undefined, feedbackSecret: string | undefined): boolean {
  const state = stateSecret?.trim();
  const feedback = feedbackSecret?.trim();
  return Boolean(state && feedback && Buffer.byteLength(state, "utf8") >= 32 && Buffer.byteLength(feedback, "utf8") >= 32 && !safeEqual(state, feedback));
}
function normalizeCallbackUrl(value: string | undefined): string | null { if (!value) return null; try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/api/auth/github/callback" ? url.toString() : null; } catch { return null; } }
function safeEqual(left: string, right: string): boolean { const a = Buffer.from(left), b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
function authError(reason: ConciergeGitHubAuthReason): Error & { reason: ConciergeGitHubAuthReason } { return Object.assign(new Error(reason), { reason }); }
function authDiagnosticError(reason: ConciergeGitHubAuthReason, stage: ConciergeGitHubOAuthStateStage): Error & { reason: ConciergeGitHubAuthReason; oauthStateStage: ConciergeGitHubOAuthStateStage } { return Object.assign(new Error(reason), { reason, oauthStateStage: stage }); }
function installationDiagnosticStage(user: GitHubUserIdentity, installations: GitHubUserInstallation[], expectedAppId: number): ConciergeGitHubOAuthStateStage {
  const matchingApp = installations.filter((installation) => installation.appId === expectedAppId);
  if (matchingApp.length === 0) return "installation_app_missing";
  const matchingIdentity = matchingApp.filter((installation) => installation.account.type === "User" && installation.targetType === "User" && installation.account.id === user.id && installation.targetId === user.id && !installation.suspendedAt);
  return matchingIdentity.length > 1 ? "installation_multiple" : "installation_identity_mismatch";
}
function oauthStateError(stage: ConciergeGitHubOAuthStateStage): Error & { reason: "oauth_state_invalid"; oauthStateStage: ConciergeGitHubOAuthStateStage } {
  return Object.assign(new Error("oauth_state_invalid"), { reason: "oauth_state_invalid" as const, oauthStateStage: stage });
}
