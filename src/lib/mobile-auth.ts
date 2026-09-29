import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { getControlPlaneSupabaseEnv } from "./control-plane-supabase";
import { createTenantAuthSessionForMobileMember, MOBILE_AUTH_SESSION_COOKIE, revokeTenantAuthSession } from "./tenant-auth";

const HANDOFF_TTL_MS = 2 * 60 * 1000;
const MOBILE_SESSION_PREFIX = "apm_";
const CODES_TABLE = "agentproof_mobile_handoff_codes";
type Handoff = { code_hash: string; tenant_id: string; member_id: string; verifier_hash: string; expires_at: string };
type Globals = typeof globalThis & { __agentproofMobileCodes?: Map<string, Handoff> };
export class MobileAuthStoreError extends Error {}

export function mobileAuthConfigured(env = process.env): boolean {
  const shared = getControlPlaneSupabaseEnv(env);
  return Boolean(shared.url && shared.serviceRoleKey) || memoryAllowed(env);
}
export function validMobileVerifier(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]{43,128}$/.test(value); }
export function validMobileChallenge(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value); }
export function hashMobileVerifier(value: string): string { return createHash("sha256").update(value).digest("base64url"); }

export async function createMobileHandoff(input: { verifierChallenge: string; tenantId: string; memberId: string }, env = process.env, now = Date.now()): Promise<string> {
  if (!validMobileChallenge(input.verifierChallenge) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(input.tenantId) || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{1,119}$/.test(input.memberId)) throw new MobileAuthStoreError("Invalid handoff.");
  const code = randomBytes(32).toString("base64url");
  const row: Handoff = { code_hash: sha256(code), tenant_id: input.tenantId, member_id: input.memberId, verifier_hash: input.verifierChallenge, expires_at: new Date(now + HANDOFF_TTL_MS).toISOString() };
  const config = storeConfig(env);
  if (config) {
    const response = await dbFetch(config, "", { method: "POST", body: JSON.stringify(row) });
    if (!response.ok) throw new MobileAuthStoreError("Mobile handoff storage failed.");
  } else if (memoryAllowed(env)) memoryStore().set(row.code_hash, row);
  else throw new MobileAuthStoreError("Mobile handoff storage unavailable.");
  return code;
}

export async function exchangeMobileHandoff(input: { code: unknown; verifier: unknown }, env = process.env, now = Date.now()): Promise<string | null> {
  if (typeof input.code !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.code) || !validMobileVerifier(input.verifier)) return null;
  const hash = sha256(input.code);
  const challenge = hashMobileVerifier(input.verifier);
  const config = storeConfig(env);
  let row: Handoff | undefined;
  if (config) {
    // A wrong verifier cannot consume the code. One DELETE statement claims it across instances.
    const query = new URLSearchParams({ code_hash: `eq.${hash}`, verifier_hash: `eq.${challenge}`, expires_at: `gt.${new Date(now).toISOString()}`, select: "code_hash,tenant_id,member_id,verifier_hash,expires_at" });
    const response = await dbFetch(config, `?${query}`, { method: "DELETE" });
    if (!response.ok) throw new MobileAuthStoreError("Mobile handoff exchange unavailable.");
    const rows = await response.json().catch(() => []);
    row = Array.isArray(rows) && rows.length === 1 ? rows[0] : undefined;
  } else if (memoryAllowed(env)) {
    const candidate = memoryStore().get(hash);
    if (candidate && Date.parse(candidate.expires_at) > now && safeEqual(candidate.verifier_hash, challenge)) { row = candidate; memoryStore().delete(hash); }
    else if (candidate && Date.parse(candidate.expires_at) <= now) memoryStore().delete(hash);
  } else throw new MobileAuthStoreError("Mobile handoff storage unavailable.");
  if (!row || Date.parse(row.expires_at) <= now || !safeEqual(row.verifier_hash, challenge)) return null;
  const session = await createTenantAuthSessionForMobileMember({ tenantId: row.tenant_id, memberId: row.member_id }, env, now);
  const raw = readCookie(session.sessionCookie, MOBILE_AUTH_SESSION_COOKIE);
  if (!raw) throw new MobileAuthStoreError("Mobile session creation failed.");
  return `${MOBILE_SESSION_PREFIX}${raw}`;
}

export function mobileCookieFromRequest(request: Request): string | null {
  if (request.headers.get("origin") || request.headers.get("cookie")) return null;
  const value = request.headers.get("authorization");
  if (!value?.startsWith(`Bearer ${MOBILE_SESSION_PREFIX}`)) return null;
  const token = value.slice(`Bearer ${MOBILE_SESSION_PREFIX}`.length);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? `${MOBILE_AUTH_SESSION_COOKIE}=${token}` : null;
}
export async function revokeMobileSession(request: Request, env = process.env): Promise<boolean> {
  const cookie = mobileCookieFromRequest(request);
  if (!cookie) return false;
  await revokeTenantAuthSession({ cookieHeader: cookie, source: "mobile" }, env);
  return true;
}
export function clearMobileCodesForTests() { memoryStore().clear(); }
function readCookie(header: string, name: string): string | null { return header.split(";").map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1).split("=")[0] ?? null; }
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function safeEqual(a: string, b: string): boolean { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
function memoryStore() { const globals = globalThis as Globals; return globals.__agentproofMobileCodes ??= new Map<string, Handoff>(); }
function memoryAllowed(env: NodeJS.ProcessEnv) { return env.NODE_ENV !== "production" && env.AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY === "true"; }
function storeConfig(env: NodeJS.ProcessEnv) {
  const shared = getControlPlaneSupabaseEnv(env); const url = shared.url.replace(/\/+$/, ""); const key = shared.serviceRoleKey;
  if (Boolean(url) !== Boolean(key)) throw new MobileAuthStoreError("Mobile handoff storage configuration incomplete.");
  return url && key ? { url, key } : null;
}
function dbFetch(config: { url: string; key: string }, query: string, init: RequestInit) {
  return fetch(`${config.url}/rest/v1/${CODES_TABLE}${query}`, { ...init, cache: "no-store", headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, "Content-Type": "application/json", Prefer: init.method === "DELETE" ? "return=representation" : "return=minimal" } });
}
