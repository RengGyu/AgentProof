import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "crypto";
import { noStoreJson } from "./http";
import { redactSecrets } from "./redact";
import { getControlPlaneSupabaseEnv } from "./control-plane-supabase";
import { readTenantAccountSummary, type TenantMemberRole } from "./tenant-accounts";

export const TENANT_AUTH_SESSION_COOKIE = "agentproof_tenant_auth_session";
export const DEFAULT_TENANT_AUTH_SESSIONS_TABLE = "agentproof_tenant_auth_sessions";
export const TENANT_AUTH_BOOTSTRAPS_ENV = "AGENTPROOF_TENANT_AUTH_BOOTSTRAPS";

const TENANT_AUTH_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const GITHUB_SESSION_IDLE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const GITHUB_SESSION_COOKIE_TTL_MS = 400 * 24 * 60 * 60 * 1000;
const GITHUB_SESSION_RENEW_BELOW_MS = 29 * 24 * 60 * 60 * 1000;
const GITHUB_ACCESS_EXPIRY_SKEW_MS = 60 * 1000;
const GITHUB_REFRESH_LEASE_MS = 30 * 1000;

export type TenantAuthAccessMethod = "durable-session";

export interface TenantAuthSession {
  sessionId: string;
  tenantId: string;
  memberId: string;
  role: TenantMemberRole;
  expiresAt: string;
  sessionCookie: string;
}

export interface TenantAuthAccessResult {
  authorized: boolean;
  tenantId?: string;
  memberId?: string;
  role?: TenantMemberRole;
  method?: TenantAuthAccessMethod;
  sessionState?: "active";
}

interface TenantAuthBootstrapInput {
  tenantId?: unknown;
  memberId?: unknown;
  token?: unknown;
  tokenHash?: unknown;
}

interface TenantAuthBootstrapRecord {
  tenantId: string;
  memberId: string;
  token?: string;
  tokenHash?: string;
}

interface TenantAuthSessionRecord {
  id: string;
  tokenHash: string;
  tenantId: string;
  memberId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  authSource?: "github" | "bootstrap";
  githubUserId?: string;
  githubAccessCiphertext?: string;
  githubAccessExpiresAt?: string;
  githubRefreshCiphertext?: string;
  githubRefreshExpiresAt?: string;
  githubRefreshLeaseOwner?: string;
  githubRefreshLeaseUntil?: string;
}

interface TenantAuthSessionStoreConfig {
  url: string;
  serviceRoleKey: string;
  table: string;
}

interface SupabaseTenantAuthSessionRow {
  id?: unknown;
  token_hash?: unknown;
  tenant_id?: unknown;
  member_id?: unknown;
  created_at?: unknown;
  expires_at?: unknown;
  revoked_at?: unknown;
  auth_source?: unknown;
  github_user_id?: unknown;
  github_access_ciphertext?: unknown;
  github_access_expires_at?: unknown;
  github_refresh_ciphertext?: unknown;
  github_refresh_expires_at?: unknown;
  github_refresh_lease_owner?: unknown;
  github_refresh_lease_until?: unknown;
}

type GlobalWithTenantAuthSessions = typeof globalThis & {
  __agentproofTenantAuthSessions?: Map<string, TenantAuthSessionRecord>;
};

export class TenantAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantAuthError";
  }
}

export class TenantAuthStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantAuthStoreError";
  }
}

export async function createTenantAuthSession(
  input: { tenantId?: unknown; memberId?: unknown; bootstrapToken?: string | null },
  env = process.env,
  now = Date.now()
): Promise<TenantAuthSession> {
  const tenantId = normalizeTenantId(input.tenantId);
  const memberId = normalizeMemberId(input.memberId);
  const token = typeof input.bootstrapToken === "string" ? input.bootstrapToken.trim() : "";
  if (!tenantId || !memberId || !token) {
    throw new TenantAuthError("Tenant auth session request is invalid.");
  }

  const bootstrap = findTenantAuthBootstrap({ tenantId, memberId, token }, env);
  if (!bootstrap) {
    throw new TenantAuthError("Tenant auth bootstrap credential is invalid.");
  }

  const member = await readActiveTenantMember({ tenantId, memberId }, env);
  if (!member) {
    throw new TenantAuthError("Tenant auth member is not active.");
  }

  const sessionToken = randomToken();
  const expiresAt = new Date(now + TENANT_AUTH_SESSION_TTL_MS).toISOString();
  const record: TenantAuthSessionRecord = {
    id: randomToken(),
    tokenHash: hashToken(sessionToken),
    tenantId,
    memberId,
    createdAt: new Date(now).toISOString(),
    expiresAt
  };
  await storeTenantAuthSession(record, env);

  return {
    sessionId: record.id,
    tenantId,
    memberId,
    role: member.role,
    expiresAt,
    sessionCookie: buildCookie(TENANT_AUTH_SESSION_COOKIE, sessionToken, expiresAt, now)
  };
}

/**
 * Creates the same revocable, opaque session used by invite onboarding after a
 * GitHub identity has been verified. OAuth credentials are attached separately
 * after this session is created and remain encrypted and session-bound.
 */
export async function createTenantAuthSessionForMember(
  input: { tenantId?: unknown; memberId?: unknown },
  env = process.env,
  now = Date.now()
): Promise<TenantAuthSession> {
  const tenantId = normalizeTenantId(input.tenantId);
  const memberId = normalizeMemberId(input.memberId);
  if (!tenantId || !memberId) {
    throw new TenantAuthError("Tenant auth session request is invalid.");
  }

  const member = await readActiveTenantMember({ tenantId, memberId }, env);
  if (!member) {
    throw new TenantAuthError("Tenant auth member is not active.");
  }

  const sessionToken = randomToken();
  const expiresAt = new Date(now + GITHUB_SESSION_IDLE_TTL_MS).toISOString();
  const sessionId = randomToken();
  await storeTenantAuthSession({
    id: sessionId,
    tokenHash: hashToken(sessionToken),
    tenantId,
    memberId,
    createdAt: new Date(now).toISOString(),
    expiresAt,
    authSource: "github"
  }, env);

  return {
    sessionId,
    tenantId,
    memberId,
    role: member.role,
    expiresAt,
    // The opaque browser cookie outlives the server's rolling 30-day idle
    // expiry; a stale cookie alone never authorizes a request.
    sessionCookie: buildCookie(TENANT_AUTH_SESSION_COOKIE, sessionToken, new Date(now + GITHUB_SESSION_COOKIE_TTL_MS).toISOString(), now)
  };
}

export async function verifyTenantAuthAccess(
  input: { tenantId?: unknown; cookieHeader?: string | null },
  env = process.env,
  now = Date.now()
): Promise<TenantAuthAccessResult> {
  const tenantId = normalizeTenantId(input.tenantId);
  const sessionToken = readCookie(input.cookieHeader, TENANT_AUTH_SESSION_COOKIE);
  if (!tenantId || !sessionToken) return { authorized: false };

  const record = await findTenantAuthSession({ tokenHash: hashToken(sessionToken) }, env);
  if (!record) return { authorized: false };
  if (record.tenantId !== tenantId) return { authorized: false };
  if (Date.parse(record.expiresAt) <= now) return { authorized: false };
  if (record.revokedAt) return { authorized: false };

  const member = await readActiveTenantMember({ tenantId, memberId: record.memberId }, env);
  if (!member) return { authorized: false };

  if (!await renewGitHubSessionIfNeeded(record, env, now)) return { authorized: false };

  return {
    authorized: true,
    tenantId,
    memberId: record.memberId,
    role: member.role,
    method: "durable-session",
    sessionState: "active"
  };
}

/** Resolves the tenant solely from the opaque session cookie. */
export async function resolveTenantAuthAccess(
  input: { cookieHeader?: string | null },
  env = process.env,
  now = Date.now()
): Promise<TenantAuthAccessResult> {
  const sessionToken = readCookie(input.cookieHeader, TENANT_AUTH_SESSION_COOKIE);
  if (!sessionToken) return { authorized: false };

  const record = await findTenantAuthSession({ tokenHash: hashToken(sessionToken) }, env);
  if (!record || Date.parse(record.expiresAt) <= now || record.revokedAt) return { authorized: false };

  const member = await readActiveTenantMember({ tenantId: record.tenantId, memberId: record.memberId }, env);
  if (!member) return { authorized: false };

  if (!await renewGitHubSessionIfNeeded(record, env, now)) return { authorized: false };

  return {
    authorized: true,
    tenantId: record.tenantId,
    memberId: record.memberId,
    role: member.role,
    method: "durable-session",
    sessionState: "active"
  };
}

export async function revokeTenantAuthSession(
  input: { cookieHeader?: string | null },
  env = process.env,
  now = Date.now()
): Promise<void> {
  const sessionToken = readCookie(input.cookieHeader, TENANT_AUTH_SESSION_COOKIE);
  if (!sessionToken) return;
  await revokeTenantAuthSessionByHash(hashToken(sessionToken), new Date(now).toISOString(), env);
}

export function clearTenantAuthSessionCookie(now = Date.now()): string {
  return buildCookie(TENANT_AUTH_SESSION_COOKIE, "deleted", new Date(now).toISOString(), now);
}

export function readTenantAuthBootstrapRecords(env = process.env): TenantAuthBootstrapRecord[] | null {
  const raw = env[TENANT_AUTH_BOOTSTRAPS_ENV];
  if (!raw?.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;

  const records: TenantAuthBootstrapRecord[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = normalizeTenantAuthBootstrapRecord(item as TenantAuthBootstrapInput);
    if (!record) return null;
    records.push(record);
  }

  return records.slice(0, 100);
}

export function clearTenantAuthSessionsForTests() {
  tenantAuthSessionStore().clear();
}

/** Removes session-bound credentials after login expiry; never returns token data. */
export async function cleanupExpiredGitHubSessionCredentials(env = process.env, now = Date.now()): Promise<number> {
  const config = getTenantAuthSessionStoreConfig(env);
  if (config) {
    const params = new URLSearchParams({
      auth_source: "eq.github",
      and: `(or(expires_at.lte.${new Date(now).toISOString()},revoked_at.not.is.null),or(github_access_ciphertext.not.is.null,github_refresh_ciphertext.not.is.null))`,
      select: "id"
    });
    const response = await tenantAuthFetch(config, `?${params.toString()}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({
        github_access_ciphertext: null,
        github_refresh_ciphertext: null,
        github_refresh_lease_owner: null,
        github_refresh_lease_until: null
      })
    });
    const rows = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(rows)) throw new TenantAuthStoreError("GitHub session credential cleanup is unavailable.");
    return rows.length;
  }
  if (!truthy(env.AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY)) throw new TenantAuthStoreError("Tenant auth session store is not configured.");
  let cleared = 0;
  const store = tenantAuthSessionStore();
  for (const [tokenHash, record] of store) {
    if (record.authSource !== "github" || (!record.revokedAt && Date.parse(record.expiresAt) > now)) continue;
    if (!record.githubAccessCiphertext && !record.githubRefreshCiphertext) continue;
    store.set(tokenHash, { ...record, githubAccessCiphertext: undefined, githubRefreshCiphertext: undefined, githubRefreshLeaseOwner: undefined, githubRefreshLeaseUntil: undefined });
    cleared += 1;
  }
  return cleared;
}

export type GitHubUserCredentialResult =
  | { status: "ready"; accessToken: string; githubUserId: string }
  | { status: "reauth" | "unavailable" };

/** Attach credentials only to the GitHub session just created by the callback. */
export async function saveGitHubUserCredentials(input: {
  sessionCookie: string;
  githubUserId: string;
  accessToken: string;
  accessExpiresAt?: number | null;
  refreshToken?: string | null;
  refreshExpiresAt?: number | null;
}, env = process.env, now = Date.now()): Promise<void> {
  const token = readCookie(input.sessionCookie, TENANT_AUTH_SESSION_COOKIE);
  const record = token ? await findTenantAuthSession({ tokenHash: hashToken(token) }, env) : null;
  if (!record || record.authSource !== "github" || record.memberId !== `github:${input.githubUserId}` || record.revokedAt || Date.parse(record.expiresAt) <= now || !normalizeGitHubUserId(input.githubUserId) || !input.accessToken) {
    throw new TenantAuthError("GitHub credential session is invalid.");
  }
  if (input.accessExpiresAt && (!input.refreshToken || !input.refreshExpiresAt || input.refreshExpiresAt <= now)) {
    throw new TenantAuthError("GitHub expiring credential is not renewable.");
  }
  const secret = credentialSecret(env);
  const fields = {
    github_user_id: input.githubUserId,
    github_access_ciphertext: sealGitHubToken(input.accessToken, record.id, "access", secret),
    github_access_expires_at: input.accessExpiresAt ? new Date(input.accessExpiresAt).toISOString() : null,
    github_refresh_ciphertext: input.refreshToken ? sealGitHubToken(input.refreshToken, record.id, "refresh", secret) : null,
    github_refresh_expires_at: input.refreshExpiresAt ? new Date(input.refreshExpiresAt).toISOString() : null,
    github_refresh_lease_owner: null,
    github_refresh_lease_until: null
  };
  const config = getTenantAuthSessionStoreConfig(env);
  if (config) {
    const params = new URLSearchParams({ token_hash: `eq.${record.tokenHash}`, auth_source: "eq.github", revoked_at: "is.null", select: "id" });
    const response = await tenantAuthFetch(config, `?${params.toString()}`, { method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(fields) });
    const rows = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(rows) || rows.length !== 1) throw new TenantAuthStoreError("GitHub credential storage is unavailable.");
    return;
  }
  tenantAuthSessionStore().set(record.tokenHash, {
    ...record,
    githubUserId: input.githubUserId,
    githubAccessCiphertext: fields.github_access_ciphertext,
    githubAccessExpiresAt: fields.github_access_expires_at ?? undefined,
    githubRefreshCiphertext: fields.github_refresh_ciphertext ?? undefined,
    githubRefreshExpiresAt: fields.github_refresh_expires_at ?? undefined
  });
}

/** Never returns a credential for a different session, tenant, or GitHub user. */
export async function getGitHubUserCredentialForSession(
  input: { cookieHeader?: string | null; tenantId: string; memberId: string },
  env = process.env,
  now = Date.now(),
  fetchImpl: typeof fetch = fetch
): Promise<GitHubUserCredentialResult> {
  const token = readCookie(input.cookieHeader, TENANT_AUTH_SESSION_COOKIE);
  if (!token) return { status: "reauth" };
  const tokenHash = hashToken(token);
  let record = await findTenantAuthSession({ tokenHash }, env);
  if (!record || record.authSource !== "github" || record.tenantId !== input.tenantId || record.memberId !== input.memberId || record.githubUserId !== input.memberId.slice(7) || record.revokedAt || Date.parse(record.expiresAt) <= now) return { status: "reauth" };
  if (!await readActiveTenantMember({ tenantId: record.tenantId, memberId: record.memberId }, env)) return { status: "reauth" };
  const secret = credentialSecret(env);
  const current = readableGitHubAccess(record, secret, now);
  if (current) return current;
  if (!record.githubRefreshCiphertext || !record.githubRefreshExpiresAt || Date.parse(record.githubRefreshExpiresAt) <= now) return { status: "reauth" };

  const leaseOwner = randomToken();
  const claimed = await claimGitHubRefresh(record, leaseOwner, env, now);
  if (!claimed) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      record = await findTenantAuthSession({ tokenHash }, env);
      if (!record || record.revokedAt || Date.parse(record.expiresAt) <= now) return { status: "reauth" };
      const updated = readableGitHubAccess(record, secret, now);
      if (updated) return updated;
      if (!record.githubRefreshLeaseOwner) return { status: "reauth" };
    }
    return { status: "unavailable" };
  }

  let refreshToken: string;
  try {
    refreshToken = openGitHubToken(record.githubRefreshCiphertext, record.id, "refresh", secret);
  } catch {
    await clearFailedGitHubRefresh(record, leaseOwner, env);
    return { status: "reauth" };
  }
  const clientId = env.AGENTPROOF_GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = env.AGENTPROOF_GITHUB_APP_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return { status: "unavailable" };
  let response: Response;
  try {
    response = await fetchImpl("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: refreshToken }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000)
    });
  } catch {
    return { status: "unavailable" };
  }
  const body = await response.json().catch(() => null) as { access_token?: unknown; expires_in?: unknown; refresh_token?: unknown; refresh_token_expires_in?: unknown; error?: unknown } | null;
  if (!response.ok || !body || typeof body.access_token !== "string" || typeof body.refresh_token !== "string" || !validExpiresIn(body.expires_in) || !validExpiresIn(body.refresh_token_expires_in)) {
    if (body?.error === "bad_refresh_token") {
      await clearFailedGitHubRefresh(record, leaseOwner, env);
      return { status: "reauth" };
    }
    return { status: "unavailable" };
  }
  const fields = {
    github_access_ciphertext: sealGitHubToken(body.access_token, record.id, "access", secret),
    github_access_expires_at: new Date(now + body.expires_in * 1000).toISOString(),
    github_refresh_ciphertext: sealGitHubToken(body.refresh_token, record.id, "refresh", secret),
    github_refresh_expires_at: new Date(now + body.refresh_token_expires_in * 1000).toISOString(),
    github_refresh_lease_owner: null,
    github_refresh_lease_until: null
  };
  if (!await completeGitHubRefresh(record, leaseOwner, fields, env)) return { status: "unavailable" };
  return { status: "ready", accessToken: body.access_token, githubUserId: record.githubUserId! };
}

export function tenantAuthUnavailableResponse() {
  return noStoreJson({
    error: "Tenant auth session storage is unavailable.",
    code: "tenant_auth_unavailable"
  }, { status: 503 });
}

async function renewGitHubSessionIfNeeded(record: TenantAuthSessionRecord, env: NodeJS.ProcessEnv, now: number): Promise<boolean> {
  if (record.authSource !== "github" || Date.parse(record.expiresAt) - now > GITHUB_SESSION_RENEW_BELOW_MS) return true;
  const expiresAt = new Date(now + GITHUB_SESSION_IDLE_TTL_MS).toISOString();
  const config = getTenantAuthSessionStoreConfig(env);
  if (config) {
    const params = new URLSearchParams({ token_hash: `eq.${record.tokenHash}`, revoked_at: "is.null", auth_source: "eq.github", expires_at: `gt.${new Date(now).toISOString()}`, select: "id" });
    const response = await tenantAuthFetch(config, `?${params.toString()}`, { method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ expires_at: expiresAt }) });
    if (!response.ok) throw new TenantAuthStoreError(`GitHub session renewal failed with HTTP ${response.status}.`);
    const rows = await response.json().catch(() => null);
    return Array.isArray(rows) && rows.length === 1;
  }
  const current = tenantAuthSessionStore().get(record.tokenHash);
  if (!current || current.revokedAt || Date.parse(current.expiresAt) <= now) return false;
  tenantAuthSessionStore().set(record.tokenHash, { ...current, expiresAt });
  return true;
}

function readableGitHubAccess(record: TenantAuthSessionRecord, secret: string, now: number): GitHubUserCredentialResult & { status: "ready" } | null {
  if (!record.githubAccessCiphertext || !record.githubUserId || (record.githubAccessExpiresAt && Date.parse(record.githubAccessExpiresAt) <= now + GITHUB_ACCESS_EXPIRY_SKEW_MS)) return null;
  try {
    return { status: "ready", accessToken: openGitHubToken(record.githubAccessCiphertext, record.id, "access", secret), githubUserId: record.githubUserId };
  } catch {
    return null;
  }
}

async function claimGitHubRefresh(record: TenantAuthSessionRecord, leaseOwner: string, env: NodeJS.ProcessEnv, now: number): Promise<boolean> {
  const until = new Date(now + GITHUB_REFRESH_LEASE_MS).toISOString();
  const config = getTenantAuthSessionStoreConfig(env);
  if (config) {
    const params = new URLSearchParams({ token_hash: `eq.${record.tokenHash}`, auth_source: "eq.github", revoked_at: "is.null", or: `(github_refresh_lease_until.is.null,github_refresh_lease_until.lt.${new Date(now).toISOString()})`, select: "id" });
    const response = await tenantAuthFetch(config, `?${params.toString()}`, { method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ github_refresh_lease_owner: leaseOwner, github_refresh_lease_until: until }) });
    if (!response.ok) throw new TenantAuthStoreError("GitHub refresh lease is unavailable.");
    const rows = await response.json().catch(() => null);
    return Array.isArray(rows) && rows.length === 1;
  }
  const current = tenantAuthSessionStore().get(record.tokenHash);
  if (!current || current.revokedAt || (current.githubRefreshLeaseUntil && Date.parse(current.githubRefreshLeaseUntil) > now)) return false;
  tenantAuthSessionStore().set(record.tokenHash, { ...current, githubRefreshLeaseOwner: leaseOwner, githubRefreshLeaseUntil: until });
  return true;
}

async function completeGitHubRefresh(record: TenantAuthSessionRecord, leaseOwner: string, fields: {
  github_access_ciphertext: string; github_access_expires_at: string;
  github_refresh_ciphertext: string; github_refresh_expires_at: string;
  github_refresh_lease_owner: null; github_refresh_lease_until: null;
}, env: NodeJS.ProcessEnv): Promise<boolean> {
  const config = getTenantAuthSessionStoreConfig(env);
  if (config) {
    const params = new URLSearchParams({ token_hash: `eq.${record.tokenHash}`, github_refresh_lease_owner: `eq.${leaseOwner}`, revoked_at: "is.null", select: "id" });
    const response = await tenantAuthFetch(config, `?${params.toString()}`, { method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(fields) });
    if (!response.ok) throw new TenantAuthStoreError("GitHub refresh storage is unavailable.");
    const rows = await response.json().catch(() => null);
    return Array.isArray(rows) && rows.length === 1;
  }
  const current = tenantAuthSessionStore().get(record.tokenHash);
  if (!current || current.revokedAt || current.githubRefreshLeaseOwner !== leaseOwner) return false;
  tenantAuthSessionStore().set(record.tokenHash, { ...current, githubAccessCiphertext: fields.github_access_ciphertext, githubAccessExpiresAt: fields.github_access_expires_at, githubRefreshCiphertext: fields.github_refresh_ciphertext, githubRefreshExpiresAt: fields.github_refresh_expires_at, githubRefreshLeaseOwner: undefined, githubRefreshLeaseUntil: undefined });
  return true;
}

async function clearFailedGitHubRefresh(record: TenantAuthSessionRecord, leaseOwner: string, env: NodeJS.ProcessEnv): Promise<void> {
  const config = getTenantAuthSessionStoreConfig(env);
  if (config) {
    const params = new URLSearchParams({ token_hash: `eq.${record.tokenHash}`, github_refresh_lease_owner: `eq.${leaseOwner}` });
    const response = await tenantAuthFetch(config, `?${params.toString()}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ github_access_ciphertext: null, github_refresh_ciphertext: null, github_refresh_lease_owner: null, github_refresh_lease_until: null }) });
    if (!response.ok) throw new TenantAuthStoreError("GitHub credential revocation is unavailable.");
    return;
  }
  const current = tenantAuthSessionStore().get(record.tokenHash);
  if (current?.githubRefreshLeaseOwner === leaseOwner) tenantAuthSessionStore().set(record.tokenHash, { ...current, githubAccessCiphertext: undefined, githubRefreshCiphertext: undefined, githubRefreshLeaseOwner: undefined, githubRefreshLeaseUntil: undefined });
}

function credentialSecret(env: NodeJS.ProcessEnv): string {
  const secret = env.AGENTPROOF_PUBLIC_AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) throw new TenantAuthStoreError("GitHub credential encryption is unavailable.");
  return secret;
}

function sealGitHubToken(value: string, sessionId: string, kind: "access" | "refresh", secret: string): string {
  const key = createHash("sha256").update("agentproof-github-session-v1\0").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${sessionId}:${kind}`));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

function openGitHubToken(packed: string, sessionId: string, kind: "access" | "refresh", secret: string): string {
  const [version, iv, tag, ciphertext] = packed.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new TenantAuthError("GitHub credential is invalid.");
  const key = createHash("sha256").update("agentproof-github-session-v1\0").update(secret).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(`${sessionId}:${kind}`));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

function validExpiresIn(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 366 * 24 * 60 * 60;
}

function normalizeGitHubUserId(value: unknown): string | null {
  return typeof value === "string" && /^\d{1,20}$/.test(value) ? value : null;
}

async function readActiveTenantMember(
  input: { tenantId: string; memberId: string },
  env = process.env
): Promise<{ role: TenantMemberRole } | null> {
  const summary = await readTenantAccountSummary({ tenantId: input.tenantId }, env);
  if (summary.account.status !== "active" && summary.account.status !== "trialing") return null;

  const member = summary.members.find((item) => item.memberId === input.memberId);
  if (!member || member.status !== "active") return null;

  return { role: member.role };
}

function findTenantAuthBootstrap(
  input: { tenantId: string; memberId: string; token: string },
  env = process.env
): TenantAuthBootstrapRecord | null {
  const records = readTenantAuthBootstrapRecords(env);
  if (!records) return null;

  return records.find((record) => {
    if (record.tenantId !== input.tenantId || record.memberId !== input.memberId) return false;
    if (record.token && safeEqual(record.token, input.token)) return true;
    if (record.tokenHash && safeEqual(record.tokenHash, hashToken(input.token))) return true;
    return false;
  }) ?? null;
}

function normalizeTenantAuthBootstrapRecord(input: TenantAuthBootstrapInput): TenantAuthBootstrapRecord | null {
  const tenantId = normalizeTenantId(input.tenantId);
  const memberId = normalizeMemberId(input.memberId);
  const token = normalizeSecret(input.token);
  const tokenHash = normalizeHash(input.tokenHash);
  if (!tenantId || !memberId || (!token && !tokenHash)) return null;

  return {
    tenantId,
    memberId,
    ...(token ? { token } : {}),
    ...(tokenHash ? { tokenHash } : {})
  };
}

async function storeTenantAuthSession(record: TenantAuthSessionRecord, env = process.env): Promise<void> {
  const config = getTenantAuthSessionStoreConfig(env);
  if (config) {
    const response = await tenantAuthFetch(config, "", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toSupabaseTenantAuthSessionRow(record))
    });
    if (!response.ok) {
      throw new TenantAuthStoreError(`Tenant auth session insert failed with HTTP ${response.status}.`);
    }
    return;
  }

  if (!truthy(env.AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY)) {
    throw new TenantAuthStoreError("Tenant auth session store is not configured.");
  }

  tenantAuthSessionStore().set(record.tokenHash, record);
}

async function findTenantAuthSession(
  input: { tokenHash: string },
  env = process.env
): Promise<TenantAuthSessionRecord | null> {
  const config = getTenantAuthSessionStoreConfig(env);
  if (config) {
    const params = new URLSearchParams({
      token_hash: `eq.${input.tokenHash}`,
      select: "id,token_hash,tenant_id,member_id,created_at,expires_at,revoked_at,auth_source,github_user_id,github_access_ciphertext,github_access_expires_at,github_refresh_ciphertext,github_refresh_expires_at,github_refresh_lease_owner,github_refresh_lease_until",
      limit: "1"
    });
    const response = await tenantAuthFetch(config, `?${params.toString()}`, { method: "GET" });
    if (!response.ok) {
      throw new TenantAuthStoreError(`Tenant auth session lookup failed with HTTP ${response.status}.`);
    }
    const rows = (await response.json().catch(() => [])) as unknown;
    return Array.isArray(rows) ? normalizeSupabaseTenantAuthSessionRow(rows[0]) : null;
  }

  if (!truthy(env.AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY)) return null;

  return tenantAuthSessionStore().get(input.tokenHash) ?? null;
}

async function revokeTenantAuthSessionByHash(tokenHash: string, revokedAt: string, env = process.env): Promise<void> {
  const config = getTenantAuthSessionStoreConfig(env);
  if (config) {
    const params = new URLSearchParams({ token_hash: `eq.${tokenHash}` });
    const response = await tenantAuthFetch(config, `?${params.toString()}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revoked_at: revokedAt, github_access_ciphertext: null, github_refresh_ciphertext: null, github_refresh_lease_owner: null, github_refresh_lease_until: null })
    });
    if (!response.ok) {
      throw new TenantAuthStoreError(`Tenant auth session revoke failed with HTTP ${response.status}.`);
    }
    return;
  }

  const store = tenantAuthSessionStore();
  const record = store.get(tokenHash);
  if (record) {
    store.set(tokenHash, { ...record, revokedAt, githubAccessCiphertext: undefined, githubRefreshCiphertext: undefined, githubRefreshLeaseOwner: undefined, githubRefreshLeaseUntil: undefined });
  }
}

function tenantAuthFetch(config: TenantAuthSessionStoreConfig, query: string, init: RequestInit) {
  return fetch(`${config.url}/rest/v1/${encodeURIComponent(config.table)}${query}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      Prefer: "return=minimal",
      ...(init.headers ?? {})
    }
  });
}

function getTenantAuthSessionStoreConfig(env = process.env): TenantAuthSessionStoreConfig | null {
  const shared = getControlPlaneSupabaseEnv(env);
  const url = env.AGENTPROOF_TENANT_AUTH_SESSIONS_SUPABASE_URL || shared.url;
  const serviceRoleKey =
    env.AGENTPROOF_TENANT_AUTH_SESSIONS_SUPABASE_SERVICE_ROLE_KEY ||
    shared.serviceRoleKey ||
    "";

  if (!url && !serviceRoleKey) return null;

  if (!url || !serviceRoleKey) {
    throw new TenantAuthStoreError("Tenant auth session Supabase env is incomplete.");
  }

  return {
    url: trimTrailingSlash(url),
    serviceRoleKey,
    table: env.AGENTPROOF_TENANT_AUTH_SESSIONS_TABLE || DEFAULT_TENANT_AUTH_SESSIONS_TABLE
  };
}

function toSupabaseTenantAuthSessionRow(record: TenantAuthSessionRecord) {
  return {
    id: record.id,
    token_hash: record.tokenHash,
    tenant_id: record.tenantId,
    member_id: record.memberId,
    created_at: record.createdAt,
    expires_at: record.expiresAt,
    revoked_at: record.revokedAt ?? null,
    auth_source: record.authSource ?? "bootstrap"
  };
}

function normalizeSupabaseTenantAuthSessionRow(row: unknown): TenantAuthSessionRecord | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const value = row as SupabaseTenantAuthSessionRow;
  const id = normalizeId(value.id);
  const tokenHash = normalizeHash(value.token_hash);
  const tenantId = normalizeTenantId(value.tenant_id);
  const memberId = normalizeMemberId(value.member_id);
  const createdAt = normalizeIsoDate(value.created_at);
  const expiresAt = normalizeIsoDate(value.expires_at);
  const revokedAt = value.revoked_at === null || value.revoked_at === undefined
    ? undefined
    : normalizeIsoDate(value.revoked_at);
  if (!id || !tokenHash || !tenantId || !memberId || !createdAt || !expiresAt) return null;
  if (value.revoked_at !== null && value.revoked_at !== undefined && !revokedAt) return null;

  return {
    id,
    tokenHash,
    tenantId,
    memberId,
    createdAt,
    expiresAt,
    ...(revokedAt ? { revokedAt } : {}),
    authSource: value.auth_source === "github" ? "github" : "bootstrap",
    githubUserId: normalizeGitHubUserId(value.github_user_id) ?? undefined,
    githubAccessCiphertext: typeof value.github_access_ciphertext === "string" ? value.github_access_ciphertext : undefined,
    githubAccessExpiresAt: normalizeIsoDate(value.github_access_expires_at) ?? undefined,
    githubRefreshCiphertext: typeof value.github_refresh_ciphertext === "string" ? value.github_refresh_ciphertext : undefined,
    githubRefreshExpiresAt: normalizeIsoDate(value.github_refresh_expires_at) ?? undefined,
    githubRefreshLeaseOwner: typeof value.github_refresh_lease_owner === "string" ? value.github_refresh_lease_owner : undefined,
    githubRefreshLeaseUntil: normalizeIsoDate(value.github_refresh_lease_until) ?? undefined
  };
}

function tenantAuthSessionStore(): Map<string, TenantAuthSessionRecord> {
  const global = globalThis as GlobalWithTenantAuthSessions;
  if (!global.__agentproofTenantAuthSessions) {
    global.__agentproofTenantAuthSessions = new Map();
  }

  return global.__agentproofTenantAuthSessions;
}

function normalizeTenantId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = redactSecrets(value).trim();

  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(normalized) ? normalized : null;
}

function normalizeMemberId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = redactSecrets(value).trim();

  return /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{1,119}$/.test(normalized) ? normalized : null;
}

function normalizeSecret(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized.length < 12 || normalized.length > 500) return null;

  return normalized;
}

function normalizeHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();

  return /^[a-f0-9]{64}$/i.test(normalized) ? normalized.toLowerCase() : null;
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = redactSecrets(value).trim();

  return /^[a-zA-Z0-9_-]{16,160}$/.test(normalized) ? normalized : null;
}

function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;

  return new Date(time).toISOString();
}

function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;

  return timingSafeEqual(left, right);
}

function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [rawName, ...valueParts] = part.trim().split("=");
    if (rawName === name) {
      return valueParts.join("=") || null;
    }
  }

  return null;
}

function buildCookie(name: string, value: string, expiresAt: string, now: number): string {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000));

  return [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    `Expires=${new Date(Date.parse(expiresAt)).toUTCString()}`
  ].join("; ");
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function truthy(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}
