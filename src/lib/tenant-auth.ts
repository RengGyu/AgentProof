import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { noStoreJson } from "./http";
import { redactSecrets } from "./redact";
import { readTenantAccountSummary, type TenantMemberRole } from "./tenant-accounts";

export const TENANT_AUTH_SESSION_COOKIE = "agentproof_tenant_auth_session";
export const DEFAULT_TENANT_AUTH_SESSIONS_TABLE = "agentproof_tenant_auth_sessions";
export const TENANT_AUTH_BOOTSTRAPS_ENV = "AGENTPROOF_TENANT_AUTH_BOOTSTRAPS";

const TENANT_AUTH_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export type TenantAuthAccessMethod = "durable-session";

export interface TenantAuthSession {
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

export function getTenantAuthSessionStoreStatus(env = process.env): { configured: boolean; durable: boolean; mode: "supabase" | "memory" | "disabled" } {
  const config = getTenantAuthSessionStoreConfig(env);
  if (config) return { configured: true, durable: true, mode: "supabase" };
  if (truthy(env.AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY)) return { configured: true, durable: false, mode: "memory" };
  return { configured: false, durable: false, mode: "disabled" };
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
    tenantId,
    memberId,
    role: member.role,
    expiresAt,
    sessionCookie: buildCookie(TENANT_AUTH_SESSION_COOKIE, sessionToken, expiresAt, now)
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

  return {
    authorized: true,
    tenantId,
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

export function tenantAuthUnavailableResponse() {
  return noStoreJson({
    error: "Tenant auth session storage is unavailable.",
    code: "tenant_auth_unavailable"
  }, { status: 503 });
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
      select: "id,token_hash,tenant_id,member_id,created_at,expires_at,revoked_at",
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
      body: JSON.stringify({ revoked_at: revokedAt })
    });
    if (!response.ok) {
      throw new TenantAuthStoreError(`Tenant auth session revoke failed with HTTP ${response.status}.`);
    }
    return;
  }

  const store = tenantAuthSessionStore();
  const record = store.get(tokenHash);
  if (record) {
    store.set(tokenHash, { ...record, revokedAt });
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
  const url = env.AGENTPROOF_TENANT_AUTH_SESSIONS_SUPABASE_URL || env.AGENTPROOF_CONTROL_PLANE_SUPABASE_URL || env.SUPABASE_URL || "";
  const serviceRoleKey =
    env.AGENTPROOF_TENANT_AUTH_SESSIONS_SUPABASE_SERVICE_ROLE_KEY ||
    env.AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
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
    revoked_at: record.revokedAt ?? null
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
    ...(revokedAt ? { revokedAt } : {})
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
