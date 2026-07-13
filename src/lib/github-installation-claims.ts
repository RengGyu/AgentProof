import { createHash, randomBytes, timingSafeEqual } from "crypto";

export const ONBOARDING_INSTALLATION_CLAIM_COOKIE = "agentproof_github_installation_claim";
export const DEFAULT_GITHUB_INSTALLATION_CLAIMS_TABLE = "agentproof_github_installation_claims";
export const ACTIVATE_GITHUB_INSTALLATION_CLAIM_RPC = "agentproof_activate_github_installation_claim";
const CLAIM_TTL_MS = 30 * 60 * 1000;

type ClaimStatus = "pending" | "approved" | "rejected" | "activated";

interface ClaimRecord {
  id: string;
  browserTokenHash: string;
  operatorCodeHash: string;
  tenantId: string;
  installationId: number;
  status: ClaimStatus;
  expiresAt: string;
  createdAt: string;
  decidedAt?: string;
}

interface ClaimStoreConfig { url: string; serviceRoleKey: string; table: string; }
export interface ClaimActivationSessionInput {
  id: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
}
interface ClaimRow {
  id?: unknown; browser_token_hash?: unknown; operator_code_hash?: unknown; tenant_id?: unknown; installation_id?: unknown;
  status?: unknown; expires_at?: unknown; created_at?: unknown; decided_at?: unknown;
}

type GlobalClaims = typeof globalThis & { __agentproofInstallationClaims?: Map<string, ClaimRecord> };

export class GitHubInstallationClaimStoreError extends Error {
  constructor(message: string) { super(message); this.name = "GitHubInstallationClaimStoreError"; }
}

export async function createPendingInstallationClaim(input: { tenantId: string; installationId: number }, env = process.env, now = Date.now()) {
  const browserToken = randomToken();
  const operatorRequestCode = randomToken();
  const expiresAt = new Date(now + CLAIM_TTL_MS).toISOString();
  const record: ClaimRecord = {
    id: randomToken(),
    browserTokenHash: hash(browserToken),
    operatorCodeHash: hash(operatorRequestCode),
    tenantId: input.tenantId,
    installationId: input.installationId,
    status: "pending",
    expiresAt,
    createdAt: new Date(now).toISOString()
  };
  await createClaim(record, env);
  return { operatorRequestCode, expiresAt, claimCookie: buildCookie(browserToken, expiresAt, now) };
}

export async function decidePendingInstallationClaim(input: { operatorRequestCode?: string; operatorToken?: string; decision?: "approve" | "reject" }, env = process.env, now = Date.now()) {
  if (!operatorCredentialValid(input.operatorToken, env) || !input.operatorRequestCode || (input.decision !== "approve" && input.decision !== "reject")) {
    return { valid: false as const };
  }
  const record = await findClaim({ operatorCodeHash: hash(input.operatorRequestCode) }, env);
  if (!record || record.status !== "pending" || Date.parse(record.expiresAt) <= now) return { valid: false as const };
  const status = input.decision === "approve" ? "approved" : "rejected";
  const updated = await transitionClaim(record, "pending", status, now, env);
  return updated
    ? { valid: true as const, status, tenantId: record.tenantId, installationId: record.installationId }
    : { valid: false as const };
}

export async function consumeApprovedInstallationClaim(input: { cookieHeader?: string | null; activationSession?: ClaimActivationSessionInput }, env = process.env, now = Date.now()) {
  const token = readCookie(input.cookieHeader, ONBOARDING_INSTALLATION_CLAIM_COOKIE);
  if (!token) return null;
  const config = getClaimStoreConfig(env);
  if (config) {
    if (!input.activationSession) throw new GitHubInstallationClaimStoreError("GitHub installation claim activation session is missing.");
    return activateSupabaseClaim(config, hash(token), input.activationSession, now);
  }
  const record = await findClaim({ browserTokenHash: hash(token) }, env);
  if (!record || Date.parse(record.expiresAt) <= now || record.status !== "approved") return null;
  if (!await transitionClaim(record, "approved", "activated", now, env)) return null;
  return { tenantId: record.tenantId, installationId: record.installationId };
}

async function activateSupabaseClaim(config: ClaimStoreConfig, browserTokenHash: string, session: ClaimActivationSessionInput, now: number) {
  const response = await fetch(`${config.url}/rest/v1/rpc/${ACTIVATE_GITHUB_INSTALLATION_CLAIM_RPC}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`
    },
    body: JSON.stringify({
      claim_browser_token_hash: browserTokenHash,
      activation_time: new Date(now).toISOString(),
      activation_session_id: session.id,
      activation_session_token_hash: session.tokenHash,
      activation_session_expires_at: session.expiresAt,
      activation_session_created_at: session.createdAt
    })
  });
  if (!response.ok) throw new GitHubInstallationClaimStoreError("GitHub installation claim activation failed.");
  const rows = await response.json().catch(() => []);
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const value = row as { tenant_id?: unknown; installation_id?: unknown };
  return typeof value.tenant_id === "string" && typeof value.installation_id === "number"
    ? { tenantId: value.tenant_id, installationId: value.installation_id }
    : null;
}

export function clearInstallationClaimsForTests() { claimStore().clear(); }

function operatorCredentialValid(provided: string | undefined, env: NodeJS.ProcessEnv) {
  const expected = env.AGENTPROOF_GITHUB_INSTALLATION_CLAIM_OPERATOR_TOKEN?.trim();
  return Boolean(expected && provided && safeEqual(expected, provided.trim()));
}

async function createClaim(record: ClaimRecord, env: NodeJS.ProcessEnv) {
  const config = getClaimStoreConfig(env);
  if (config) {
    const response = await claimFetch(config, "", { method: "POST", headers: { "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(toRow(record)) });
    if (!response.ok) throw new GitHubInstallationClaimStoreError("GitHub installation claim storage failed.");
    return;
  }
  if (!truthy(env.AGENTPROOF_GITHUB_INSTALLATION_CLAIMS_ALLOW_MEMORY)) throw new GitHubInstallationClaimStoreError("GitHub installation claim storage is not configured.");
  claimStore().set(record.id, record);
}

async function findClaim(input: { browserTokenHash?: string; operatorCodeHash?: string }, env: NodeJS.ProcessEnv): Promise<ClaimRecord | undefined> {
  const config = getClaimStoreConfig(env);
  if (config) {
    const filter = input.browserTokenHash ? `browser_token_hash=eq.${encodeURIComponent(input.browserTokenHash)}` : `operator_code_hash=eq.${encodeURIComponent(input.operatorCodeHash ?? "")}`;
    const response = await claimFetch(config, `?${filter}&select=id,browser_token_hash,operator_code_hash,tenant_id,installation_id,status,expires_at,created_at,decided_at&limit=1`, { method: "GET" });
    if (!response.ok) throw new GitHubInstallationClaimStoreError("GitHub installation claim lookup failed.");
    const rows = await response.json().catch(() => []);
    return Array.isArray(rows) ? fromRow(rows[0]) : undefined;
  }
  if (!truthy(env.AGENTPROOF_GITHUB_INSTALLATION_CLAIMS_ALLOW_MEMORY)) throw new GitHubInstallationClaimStoreError("GitHub installation claim storage is not configured.");
  return [...claimStore().values()].find((item) => input.browserTokenHash ? safeEqual(item.browserTokenHash, input.browserTokenHash) : safeEqual(item.operatorCodeHash, input.operatorCodeHash ?? ""));
}

async function transitionClaim(record: ClaimRecord, from: ClaimStatus, to: ClaimStatus, now: number, env: NodeJS.ProcessEnv): Promise<boolean> {
  const config = getClaimStoreConfig(env);
  if (config) {
    const response = await claimFetch(config, `?id=eq.${encodeURIComponent(record.id)}&status=eq.${from}`, { method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ status: to, decided_at: new Date(now).toISOString() }) });
    if (!response.ok) throw new GitHubInstallationClaimStoreError("GitHub installation claim transition failed.");
    const rows = await response.json().catch(() => []);
    return Array.isArray(rows) && rows.length === 1;
  }
  if (!truthy(env.AGENTPROOF_GITHUB_INSTALLATION_CLAIMS_ALLOW_MEMORY)) throw new GitHubInstallationClaimStoreError("GitHub installation claim storage is not configured.");
  const current = claimStore().get(record.id);
  if (!current || current.status !== from) return false;
  current.status = to; current.decidedAt = new Date(now).toISOString(); claimStore().set(record.id, current); return true;
}

function getClaimStoreConfig(env: NodeJS.ProcessEnv): ClaimStoreConfig | null {
  const url = env.AGENTPROOF_GITHUB_INSTALLATION_CLAIMS_SUPABASE_URL || env.AGENTPROOF_CONTROL_PLANE_SUPABASE_URL || env.SUPABASE_URL || "";
  const serviceRoleKey = env.AGENTPROOF_GITHUB_INSTALLATION_CLAIMS_SUPABASE_SERVICE_ROLE_KEY || env.AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url && !serviceRoleKey) return null;
  if (!url || !serviceRoleKey) throw new GitHubInstallationClaimStoreError("GitHub installation claim Supabase env is incomplete.");
  return { url: url.replace(/\/+$/, ""), serviceRoleKey, table: env.AGENTPROOF_GITHUB_INSTALLATION_CLAIMS_TABLE || DEFAULT_GITHUB_INSTALLATION_CLAIMS_TABLE };
}

function claimFetch(config: ClaimStoreConfig, query: string, init: RequestInit) { return fetch(`${config.url}/rest/v1/${encodeURIComponent(config.table)}${query}`, { ...init, cache: "no-store", headers: { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}`, ...(init.headers ?? {}) } }); }
function toRow(record: ClaimRecord) { return { id: record.id, browser_token_hash: record.browserTokenHash, operator_code_hash: record.operatorCodeHash, tenant_id: record.tenantId, installation_id: record.installationId, status: record.status, expires_at: record.expiresAt, created_at: record.createdAt, decided_at: record.decidedAt ?? null }; }
function fromRow(value: unknown): ClaimRecord | undefined { if (!value || typeof value !== "object" || Array.isArray(value)) return undefined; const row = value as ClaimRow; return typeof row.id === "string" && typeof row.browser_token_hash === "string" && typeof row.operator_code_hash === "string" && typeof row.tenant_id === "string" && typeof row.installation_id === "number" && (row.status === "pending" || row.status === "approved" || row.status === "rejected" || row.status === "activated") && typeof row.expires_at === "string" && typeof row.created_at === "string" ? { id: row.id, browserTokenHash: row.browser_token_hash, operatorCodeHash: row.operator_code_hash, tenantId: row.tenant_id, installationId: row.installation_id, status: row.status, expiresAt: row.expires_at, createdAt: row.created_at, decidedAt: typeof row.decided_at === "string" ? row.decided_at : undefined } : undefined; }

function claimStore() {
  const globalStore = globalThis as GlobalClaims;
  globalStore.__agentproofInstallationClaims ??= new Map<string, ClaimRecord>();
  return globalStore.__agentproofInstallationClaims;
}
function randomToken() { return randomBytes(32).toString("base64url"); }
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function safeEqual(left: string, right: string) { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
function truthy(value: string | undefined) { return /^(1|true|yes|on)$/i.test(value?.trim() ?? ""); }
function readCookie(header: string | null | undefined, name: string) { return header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1); }
function buildCookie(value: string, expiresAt: string, now: number) { const seconds = Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000)); return `${ONBOARDING_INSTALLATION_CLAIM_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`; }
