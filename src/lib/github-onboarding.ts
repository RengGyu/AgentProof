import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { upsertTenantGitHubInstallation } from "./github-installations";
import { redactSecrets } from "./redact";

export const DEFAULT_ONBOARDING_STATES_TABLE = "agentproof_github_onboarding_states";
export const ONBOARDING_NONCE_COOKIE = "agentproof_github_onboarding_nonce";
export const ONBOARDING_ACTIVATION_COOKIE = "agentproof_github_activation";
export const TENANT_ADMIN_SESSION_COOKIE = "agentproof_tenant_admin_session";

const STATE_TTL_MS = 15 * 60 * 1000;
const TENANT_ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const TENANT_ADMIN_SESSION_AUDIENCE = "agentproof.tenant-admin";

export interface GitHubOnboardingStartInput {
  tenantId: string;
}

export interface GitHubOnboardingConfigStatus {
  configured: boolean;
  appSlugConfigured: boolean;
  stateSecretConfigured: boolean;
  inviteTokenConfigured: boolean;
}

export interface GitHubOnboardingRepository {
  id: number;
  fullName: string;
  private: boolean;
  defaultBranch?: string;
}

export interface GitHubInstallSession {
  installUrl: string;
  expiresAt: string;
  nonceCookie: string;
}

export interface GitHubActivationSession {
  valid: boolean;
  tenantId?: string;
  installationId?: number;
  expiresAt?: string;
  reason?: "missing" | "not-found" | "expired" | "used" | "nonce-mismatch" | "installation-mismatch";
}

export interface GitHubInstallCallbackResult {
  tenantId: string;
  installationId: number;
  expiresAt: string;
  activationCookie: string;
}

export interface TenantAdminSession {
  tenantId: string;
  expiresAt: string;
  sessionCookie: string;
}

export interface TenantAdminAccessResult {
  authorized: boolean;
  tenantId?: string;
  method?: "session" | "invite";
}

interface GitHubRepositoryApiItem {
  id?: unknown;
  full_name?: unknown;
  private?: unknown;
  default_branch?: unknown;
}

type SessionKind = "install" | "activation";

interface OnboardingSessionRecord {
  id: string;
  kind: SessionKind;
  tokenHash: string;
  tenantId: string;
  expiresAt: string;
  createdAt: string;
  nonceHash?: string;
  installationId?: number;
  usedAt?: string;
}

interface SupabaseOnboardingSessionRow {
  id: string;
  kind: SessionKind;
  token_hash: string;
  tenant_id: string;
  expires_at: string;
  created_at: string;
  nonce_hash?: string | null;
  installation_id?: number | null;
  used_at?: string | null;
}

interface BetaInviteRecord {
  tenantId: string;
  token?: string;
  tokenHash?: string;
}

interface OnboardingStoreConfig {
  url: string;
  serviceRoleKey: string;
  table: string;
}

type GlobalWithOnboardingSessions = typeof globalThis & {
  __agentproofGitHubOnboardingSessions?: Map<string, OnboardingSessionRecord>;
};

export class GitHubOnboardingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubOnboardingError";
  }
}

export class GitHubOnboardingStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubOnboardingStoreError";
  }
}

export function getGitHubOnboardingConfigStatus(env = process.env): GitHubOnboardingConfigStatus {
  const appSlugConfigured = Boolean(normalizeAppSlug(env.AGENTPROOF_GITHUB_APP_SLUG));
  const stateSecretConfigured = Boolean(env.AGENTPROOF_ONBOARDING_STATE_SECRET?.trim());
  const inviteRecords = readBetaInviteRecords(env);
  const inviteTokenConfigured = Array.isArray(inviteRecords) && inviteRecords.length > 0;

  return {
    configured: appSlugConfigured && stateSecretConfigured && inviteTokenConfigured,
    appSlugConfigured,
    stateSecretConfigured,
    inviteTokenConfigured
  };
}

export async function createGitHubAppInstallSession(
  input: GitHubOnboardingStartInput,
  env = process.env,
  now = Date.now()
): Promise<GitHubInstallSession> {
  const appSlug = normalizeAppSlug(env.AGENTPROOF_GITHUB_APP_SLUG);
  const tenantId = normalizeTenantId(input.tenantId);
  const secret = env.AGENTPROOF_ONBOARDING_STATE_SECRET?.trim();

  if (!appSlug || !tenantId || !secret) {
    throw new GitHubOnboardingError("GitHub App onboarding session input is invalid.");
  }

  const state = randomToken();
  const nonce = randomToken();
  const expiresAt = new Date(now + STATE_TTL_MS).toISOString();
  await storeOnboardingSession({
    id: randomToken(),
    kind: "install",
    tokenHash: hashOnboardingValue(state, secret),
    nonceHash: hashOnboardingValue(nonce, secret),
    tenantId,
    createdAt: new Date(now).toISOString(),
    expiresAt
  }, env);

  const installUrl = new URL(`https://github.com/apps/${appSlug}/installations/new`);
  installUrl.searchParams.set("state", state);

  return {
    installUrl: installUrl.toString(),
    expiresAt,
    nonceCookie: buildCookie(ONBOARDING_NONCE_COOKIE, nonce, expiresAt, now)
  };
}

export async function completeGitHubAppInstallCallback(
  input: {
    state?: string | null;
    nonceCookieHeader?: string | null;
    installationId?: number | null;
  },
  env = process.env,
  now = Date.now()
): Promise<GitHubInstallCallbackResult> {
  const secret = env.AGENTPROOF_ONBOARDING_STATE_SECRET?.trim();
  const nonce = readCookie(input.nonceCookieHeader, ONBOARDING_NONCE_COOKIE);

  if (!secret || !input.state || !nonce || !input.installationId) {
    throw new GitHubOnboardingError("GitHub App onboarding callback is invalid.");
  }

  const consumed = await consumeOnboardingSession({
    kind: "install",
    tokenHash: hashOnboardingValue(input.state, secret),
    now,
    nonceHash: hashOnboardingValue(nonce, secret)
  }, env);

  if (!consumed) {
    throw new GitHubOnboardingError("GitHub App onboarding state is invalid or expired.");
  }

  const activationToken = randomToken();
  const expiresAt = new Date(now + STATE_TTL_MS).toISOString();
  await upsertTenantGitHubInstallation({
    tenantId: consumed.tenantId,
    installationId: input.installationId,
    status: "active"
  }, env, now);
  await storeOnboardingSession({
    id: randomToken(),
    kind: "activation",
    tokenHash: hashOnboardingValue(activationToken, secret),
    tenantId: consumed.tenantId,
    installationId: input.installationId,
    createdAt: new Date(now).toISOString(),
    expiresAt
  }, env);

  return {
    tenantId: consumed.tenantId,
    installationId: input.installationId,
    expiresAt,
    activationCookie: buildCookie(ONBOARDING_ACTIVATION_COOKIE, activationToken, expiresAt, now)
  };
}

export async function verifyGitHubActivationSession(
  input: { cookieHeader?: string | null; installationId?: number | null },
  env = process.env,
  now = Date.now()
): Promise<GitHubActivationSession> {
  const secret = env.AGENTPROOF_ONBOARDING_STATE_SECRET?.trim();
  const activationToken = readCookie(input.cookieHeader, ONBOARDING_ACTIVATION_COOKIE);

  if (!secret || !activationToken || !input.installationId) {
    return { valid: false, reason: "missing" };
  }

  const session = await findOnboardingSession({
    kind: "activation",
    tokenHash: hashOnboardingValue(activationToken, secret)
  }, env);

  return validateActivationSession(session, input.installationId, now);
}

export async function consumeGitHubActivationSession(
  input: { cookieHeader?: string | null; installationId?: number | null },
  env = process.env,
  now = Date.now()
): Promise<GitHubActivationSession> {
  const secret = env.AGENTPROOF_ONBOARDING_STATE_SECRET?.trim();
  const activationToken = readCookie(input.cookieHeader, ONBOARDING_ACTIVATION_COOKIE);

  if (!secret || !activationToken || !input.installationId) {
    return { valid: false, reason: "missing" };
  }

  const consumed = await consumeOnboardingSession({
    kind: "activation",
    tokenHash: hashOnboardingValue(activationToken, secret),
    now,
    installationId: input.installationId
  }, env);

  return validateActivationSession(consumed, input.installationId, now);
}

export function verifyBetaInviteToken(token: string | undefined, env = process.env): boolean {
  const expected = env.AGENTPROOF_BETA_INVITE_TOKEN?.trim();
  if (!expected || !token) return false;

  return safeEqual(token.trim(), expected);
}

export function verifyBetaInviteTokenForTenant(
  token: string | undefined,
  tenantId: unknown,
  env = process.env
): boolean {
  const normalizedTenantId = normalizeTenantId(tenantId);
  if (!normalizedTenantId || !token) return false;

  const invites = readBetaInviteRecords(env);
  if (invites === null) return false;
  if (invites) {
    return betaInviteRecordsContain(invites, token, normalizedTenantId);
  }

  return verifyBetaInviteToken(token, env);
}

export function verifyTenantBoundBetaInviteToken(
  token: string | undefined,
  tenantId: unknown,
  env = process.env
): boolean {
  const normalizedTenantId = normalizeTenantId(tenantId);
  if (!normalizedTenantId || !token) return false;

  const invites = readBetaInviteRecords(env);
  if (!invites) return false;

  return betaInviteRecordsContain(invites, token, normalizedTenantId);
}

export function createTenantAdminSession(
  input: { tenantId: unknown; inviteToken?: string },
  env = process.env,
  now = Date.now()
): TenantAdminSession {
  const tenantId = normalizeTenantId(input.tenantId);
  const secret = tenantSessionSecret(env);

  if (!tenantId || !secret || !verifyTenantBoundBetaInviteToken(input.inviteToken, tenantId, env)) {
    throw new GitHubOnboardingError("Tenant admin session request is invalid.");
  }

  const expiresAt = new Date(now + TENANT_ADMIN_SESSION_TTL_MS).toISOString();
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    aud: TENANT_ADMIN_SESSION_AUDIENCE,
    tenantId,
    iat: now,
    exp: Date.parse(expiresAt),
    nonce: randomToken()
  })).toString("base64url");
  const signature = signTenantSessionPayload(payload, secret);

  return {
    tenantId,
    expiresAt,
    sessionCookie: buildCookie(TENANT_ADMIN_SESSION_COOKIE, `${payload}.${signature}`, expiresAt, now)
  };
}

export function clearTenantAdminSessionCookie(now = Date.now()): string {
  return buildCookie(TENANT_ADMIN_SESSION_COOKIE, "deleted", new Date(now).toISOString(), now);
}

export function verifyTenantAdminAccess(
  input: {
    tenantId: unknown;
    inviteToken?: string;
    cookieHeader?: string | null;
  },
  env = process.env,
  now = Date.now()
): TenantAdminAccessResult {
  const tenantId = normalizeTenantId(input.tenantId);
  if (!tenantId) return { authorized: false };

  if (verifyTenantAdminSession({ tenantId, cookieHeader: input.cookieHeader }, env, now)) {
    return { authorized: true, tenantId, method: "session" };
  }

  if (verifyTenantBoundBetaInviteToken(input.inviteToken, tenantId, env)) {
    return { authorized: true, tenantId, method: "invite" };
  }

  return { authorized: false };
}

export function verifyTenantAdminSession(
  input: { tenantId: unknown; cookieHeader?: string | null },
  env = process.env,
  now = Date.now()
): boolean {
  const tenantId = normalizeTenantId(input.tenantId);
  const secret = tenantSessionSecret(env);
  const cookieValue = readCookie(input.cookieHeader, TENANT_ADMIN_SESSION_COOKIE);
  if (!tenantId || !secret || !cookieValue) return false;

  const [payload, signature] = cookieValue.split(".");
  if (!payload || !signature) return false;
  if (!safeEqual(signTenantSessionPayload(payload, secret), signature)) return false;

  const session = parseTenantSessionPayload(payload);
  if (!session) return false;
  if (session.tenantId !== tenantId) return false;
  if (session.exp <= now) return false;
  if (session.iat > now + 60_000) return false;
  if (session.exp - session.iat > TENANT_ADMIN_SESSION_TTL_MS) return false;

  return true;
}

export function normalizeInstallationId(value: unknown): number | null {
  const numberValue = typeof value === "string" ? Number(value) : value;
  return typeof numberValue === "number" && Number.isInteger(numberValue) && numberValue > 0
    ? numberValue
    : null;
}

export function normalizeRepositoryId(value: unknown): number | null {
  return normalizeInstallationId(value);
}

export function normalizeRepositorySelection(value: unknown): string | null {
  return normalizeRepositoryFullName(value);
}

export function normalizeGitHubInstallationRepositories(value: unknown): GitHubOnboardingRepository[] {
  const repositories = Array.isArray(value)
    ? value
    : value && typeof value === "object" && !Array.isArray(value)
      ? (value as { repositories?: unknown }).repositories
      : undefined;

  if (!Array.isArray(repositories)) return [];

  return repositories
    .map((item) => normalizeRepositoryApiItem(item))
    .filter((item): item is GitHubOnboardingRepository => Boolean(item))
    .slice(0, 100);
}

export function clearGitHubOnboardingSessionsForTests() {
  onboardingSessionStore().clear();
}

function validateActivationSession(
  session: OnboardingSessionRecord | undefined,
  installationId: number,
  now: number
): GitHubActivationSession {
  if (!session) return { valid: false, reason: "not-found" };
  if (session.usedAt) return { valid: false, reason: "used" };
  if (Date.parse(session.expiresAt) <= now) return { valid: false, reason: "expired" };
  if (session.installationId !== installationId) return { valid: false, reason: "installation-mismatch" };

  return {
    valid: true,
    tenantId: session.tenantId,
    installationId: session.installationId,
    expiresAt: session.expiresAt
  };
}

async function storeOnboardingSession(record: OnboardingSessionRecord, env = process.env): Promise<void> {
  const config = getOnboardingStoreConfig(env);
  if (config) {
    await createSupabaseOnboardingSession(config, record);
  } else if (truthy(env.AGENTPROOF_ONBOARDING_ALLOW_MEMORY)) {
    onboardingSessionStore().set(sessionKey(record.kind, record.tokenHash), record);
  } else {
    throw new GitHubOnboardingStoreError("GitHub onboarding state store is not configured.");
  }
}

async function findOnboardingSession(
  input: { kind: SessionKind; tokenHash: string },
  env = process.env
): Promise<OnboardingSessionRecord | undefined> {
  const config = getOnboardingStoreConfig(env);
  if (config) {
    return findSupabaseOnboardingSession(config, input);
  }

  if (!truthy(env.AGENTPROOF_ONBOARDING_ALLOW_MEMORY)) {
    throw new GitHubOnboardingStoreError("GitHub onboarding state store is not configured.");
  }

  return onboardingSessionStore().get(sessionKey(input.kind, input.tokenHash));
}

async function consumeOnboardingSession(
  input: { kind: SessionKind; tokenHash: string; now: number; nonceHash?: string; installationId?: number },
  env = process.env
): Promise<OnboardingSessionRecord | undefined> {
  const config = getOnboardingStoreConfig(env);
  if (config) {
    return consumeSupabaseOnboardingSession(config, input);
  }

  if (!truthy(env.AGENTPROOF_ONBOARDING_ALLOW_MEMORY)) {
    throw new GitHubOnboardingStoreError("GitHub onboarding state store is not configured.");
  }

  const key = sessionKey(input.kind, input.tokenHash);
  const session = onboardingSessionStore().get(key);
  if (!session || session.usedAt || Date.parse(session.expiresAt) <= input.now) return undefined;
  if (input.nonceHash && session.nonceHash !== input.nonceHash) return undefined;
  if (input.installationId && session.installationId !== input.installationId) return undefined;

  const consumed = { ...session };
  session.usedAt = new Date(input.now).toISOString();
  onboardingSessionStore().set(key, session);

  return consumed;
}

async function createSupabaseOnboardingSession(config: OnboardingStoreConfig, record: OnboardingSessionRecord) {
  const response = await onboardingFetch(config, "", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify(toSupabaseOnboardingRow(record))
  });

  if (!response.ok) {
    throw new GitHubOnboardingStoreError(`GitHub onboarding state store failed with HTTP ${response.status}.`);
  }
}

async function findSupabaseOnboardingSession(
  config: OnboardingStoreConfig,
  input: { kind: SessionKind; tokenHash: string }
): Promise<OnboardingSessionRecord | undefined> {
  const response = await onboardingFetch(
    config,
    [
      `?kind=eq.${encodeURIComponent(input.kind)}`,
      `token_hash=eq.${encodeURIComponent(input.tokenHash)}`,
      "select=id,kind,token_hash,tenant_id,nonce_hash,installation_id,expires_at,created_at,used_at",
      "limit=1"
    ].join("&"),
    { method: "GET" }
  );

  if (!response.ok) {
    throw new GitHubOnboardingStoreError(`GitHub onboarding state lookup failed with HTTP ${response.status}.`);
  }

  const rows = (await response.json().catch(() => [])) as unknown;
  if (!Array.isArray(rows)) return undefined;

  return rowToOnboardingSession(rows[0]);
}

async function consumeSupabaseOnboardingSession(
  config: OnboardingStoreConfig,
  input: { kind: SessionKind; tokenHash: string; now: number; nonceHash?: string; installationId?: number }
): Promise<OnboardingSessionRecord | undefined> {
  const session = await findSupabaseOnboardingSession(config, input);
  if (!session || session.usedAt || Date.parse(session.expiresAt) <= input.now) return undefined;
  if (input.nonceHash && session.nonceHash !== input.nonceHash) return undefined;
  if (input.installationId && session.installationId !== input.installationId) return undefined;

  const usedAt = new Date(input.now).toISOString();
  const response = await onboardingFetch(
    config,
    [
      `?id=eq.${encodeURIComponent(session.id)}`,
      "used_at=is.null"
    ].join("&"),
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({ used_at: usedAt })
    }
  );

  if (!response.ok) {
    throw new GitHubOnboardingStoreError(`GitHub onboarding state consume failed with HTTP ${response.status}.`);
  }

  const rows = (await response.json().catch(() => [])) as unknown;
  const updated = Array.isArray(rows) ? rowToOnboardingSession(rows[0]) : undefined;
  if (!updated) return undefined;

  return session;
}

async function onboardingFetch(config: OnboardingStoreConfig, query: string, init: RequestInit) {
  return fetch(`${config.url}/rest/v1/${encodeURIComponent(config.table)}${query}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      ...(init.headers ?? {})
    }
  });
}

function getOnboardingStoreConfig(env = process.env): OnboardingStoreConfig | null {
  const url = env.AGENTPROOF_ONBOARDING_SUPABASE_URL || env.AGENTPROOF_CONTROL_PLANE_SUPABASE_URL || env.SUPABASE_URL || "";
  const serviceRoleKey =
    env.AGENTPROOF_ONBOARDING_SUPABASE_SERVICE_ROLE_KEY ||
    env.AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    "";

  if (!url && !serviceRoleKey) return null;

  if (!url || !serviceRoleKey) {
    throw new GitHubOnboardingStoreError("GitHub onboarding Supabase env is incomplete.");
  }

  return {
    url: trimTrailingSlash(url),
    serviceRoleKey,
    table: env.AGENTPROOF_ONBOARDING_STATES_TABLE || DEFAULT_ONBOARDING_STATES_TABLE
  };
}

function normalizeRepositoryApiItem(value: unknown): GitHubOnboardingRepository | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as GitHubRepositoryApiItem;
  const id = typeof item.id === "number" && Number.isInteger(item.id) && item.id > 0 ? item.id : null;
  const fullName = normalizeRepositoryFullName(item.full_name);
  const privateRepo = typeof item.private === "boolean" ? item.private : null;
  const defaultBranch = typeof item.default_branch === "string"
    ? redactSecrets(item.default_branch).trim().slice(0, 120)
    : undefined;

  if (!id || !fullName || privateRepo === null) return null;

  return {
    id,
    fullName,
    private: privateRepo,
    defaultBranch: defaultBranch || undefined
  };
}

function toSupabaseOnboardingRow(record: OnboardingSessionRecord): SupabaseOnboardingSessionRow {
  return {
    id: record.id,
    kind: record.kind,
    token_hash: record.tokenHash,
    tenant_id: record.tenantId,
    nonce_hash: record.nonceHash ?? null,
    installation_id: record.installationId ?? null,
    expires_at: record.expiresAt,
    created_at: record.createdAt,
    used_at: record.usedAt ?? null
  };
}

function rowToOnboardingSession(row: unknown): OnboardingSessionRecord | undefined {
  if (!row || typeof row !== "object" || Array.isArray(row)) return undefined;
  const value = row as Partial<SupabaseOnboardingSessionRow>;
  const tenantId = normalizeTenantId(value.tenant_id);
  const kind = value.kind === "install" || value.kind === "activation" ? value.kind : undefined;

  if (!tenantId || !kind || typeof value.id !== "string" || typeof value.token_hash !== "string" || typeof value.expires_at !== "string" || typeof value.created_at !== "string") {
    return undefined;
  }

  return {
    id: value.id,
    kind,
    tokenHash: value.token_hash,
    tenantId,
    nonceHash: typeof value.nonce_hash === "string" ? value.nonce_hash : undefined,
    installationId: typeof value.installation_id === "number" ? value.installation_id : undefined,
    expiresAt: value.expires_at,
    createdAt: value.created_at,
    usedAt: typeof value.used_at === "string" ? value.used_at : undefined
  };
}

function readBetaInviteRecords(env = process.env): BetaInviteRecord[] | null | undefined {
  const raw = env.AGENTPROOF_BETA_INVITES;
  if (!raw?.trim()) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;

  const invites: BetaInviteRecord[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const value = item as { tenantId?: unknown; token?: unknown; tokenHash?: unknown };
    const tenantId = normalizeTenantId(value.tenantId);
    const token = typeof value.token === "string" && value.token.trim().length >= 16
      ? value.token.trim()
      : undefined;
    const tokenHash = typeof value.tokenHash === "string" && /^[a-f0-9]{64}$/i.test(value.tokenHash.trim())
      ? value.tokenHash.trim().toLowerCase()
      : undefined;

    if (!tenantId || (!token && !tokenHash)) return null;

    invites.push({
      tenantId,
      ...(token ? { token } : {}),
      ...(tokenHash ? { tokenHash } : {})
    });
  }

  return invites.slice(0, 100);
}

function betaInviteRecordsContain(invites: BetaInviteRecord[], token: string, tenantId: string): boolean {
  const providedToken = token.trim();
  const providedHash = hashInviteToken(providedToken);

  return invites.some((invite) => {
    if (invite.tenantId !== tenantId) return false;
    if (invite.token && safeEqual(providedToken, invite.token)) return true;

    return Boolean(invite.tokenHash && safeEqual(providedHash, invite.tokenHash));
  });
}

function normalizeTenantId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = redactSecrets(value).trim();

  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(normalized) ? normalized : null;
}

function normalizeRepositoryFullName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = redactSecrets(value).trim();

  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized) ? normalized : null;
}

function normalizeAppSlug(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = redactSecrets(value).trim();

  return /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/i.test(normalized) ? normalized : null;
}

function hashOnboardingValue(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function signTenantSessionPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function tenantSessionSecret(env = process.env): string | undefined {
  return env.AGENTPROOF_TENANT_SESSION_SECRET?.trim() || undefined;
}

function parseTenantSessionPayload(payload: string): { tenantId: string; iat: number; exp: number } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const value = parsed as { v?: unknown; aud?: unknown; tenantId?: unknown; exp?: unknown; iat?: unknown; nonce?: unknown };
  if (value.v !== 1) return null;
  if (value.aud !== TENANT_ADMIN_SESSION_AUDIENCE) return null;
  const tenantId = normalizeTenantId(value.tenantId);
  if (!tenantId) return null;
  if (typeof value.exp !== "number" || !Number.isFinite(value.exp)) return null;
  if (typeof value.iat !== "number" || !Number.isFinite(value.iat)) return null;
  if (typeof value.nonce !== "string" || value.nonce.length < 32) return null;

  return {
    tenantId,
    iat: value.iat,
    exp: value.exp
  };
}

function hashInviteToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function buildCookie(name: string, value: string, expiresAt: string, now: number): string {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000));

  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;

  return header
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function sessionKey(kind: SessionKind, tokenHash: string): string {
  return `${kind}:${tokenHash}`;
}

function onboardingSessionStore() {
  const globalStore = globalThis as GlobalWithOnboardingSessions;
  globalStore.__agentproofGitHubOnboardingSessions ??= new Map<string, OnboardingSessionRecord>();

  return globalStore.__agentproofGitHubOnboardingSessions;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) return false;

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function truthy(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
