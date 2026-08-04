import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "crypto";

export const GITHUB_OAUTH_STATE_COOKIE = "agentproof_github_oauth_state";
export const GITHUB_OAUTH_INSTALL_COOKIE = "agentproof_github_oauth_install";

const OAUTH_TTL_MS = 15 * 60 * 1000;
const OAUTH_CALLBACK_PATH = "/api/auth/github/callback";
// This temporary credential is set by the OAuth callback and consumed by the
// installation callback. `/api` is their narrowest shared path prefix, which
// browsers accept for a Set-Cookie response from the OAuth callback.
const INSTALL_CALLBACK_PATH = "/api";

interface OAuthState {
  state: string;
  verifier: string;
  expiresAt: number;
}

interface InstallAuthorization {
  accessToken: string;
  githubUserId: string;
  tenantId: string;
  expiresAt: number;
}

export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  secret: string;
}

export interface GitHubOAuthStart {
  authorizationUrl: string;
  stateCookie: string;
}

export interface GitHubOAuthIdentity {
  githubUserId: string;
  installCookie: string;
}

export interface GitHubInstallationAccess {
  installationId: number;
  accountId: number;
  accountLogin: string;
  accountType: "User" | "Organization";
}

export class GitHubOAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubOAuthError";
  }
}

export function getGitHubOAuthConfig(env = process.env): GitHubOAuthConfig | null {
  const clientId = env.AGENTPROOF_GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = env.AGENTPROOF_GITHUB_APP_CLIENT_SECRET?.trim();
  const callbackUrl = env.AGENTPROOF_GITHUB_APP_OAUTH_CALLBACK_URL?.trim();
  const secret = env.AGENTPROOF_PUBLIC_AUTH_SECRET?.trim();
  if (!clientId && !clientSecret && !callbackUrl && !secret) return null;
  if (!clientId || !clientSecret || !callbackUrl || !secret || secret.length < 32) {
    throw new GitHubOAuthError("GitHub public OAuth configuration is incomplete.");
  }
  try {
    const parsed = new URL(callbackUrl);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") throw new Error();
  } catch {
    throw new GitHubOAuthError("GitHub OAuth callback URL is invalid.");
  }
  return { clientId, clientSecret, callbackUrl, secret };
}

export function beginGitHubOAuth(config: GitHubOAuthConfig, now = Date.now()): GitHubOAuthStart {
  const state: OAuthState = {
    state: randomBytes(32).toString("base64url"),
    verifier: randomBytes(48).toString("base64url"),
    expiresAt: now + OAUTH_TTL_MS
  };
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.callbackUrl);
  url.searchParams.set("state", state.state);
  url.searchParams.set("code_challenge", base64Url(createHash("sha256").update(state.verifier).digest()));
  url.searchParams.set("code_challenge_method", "S256");
  return { authorizationUrl: url.toString(), stateCookie: sealCookie(GITHUB_OAUTH_STATE_COOKIE, state, config.secret, state.expiresAt, now, OAUTH_CALLBACK_PATH) };
}

export async function finishGitHubOAuth(
  input: { code?: string | null; state?: string | null; cookieHeader?: string | null; tenantId: string },
  config: GitHubOAuthConfig,
  fetchImpl: typeof fetch = fetch,
  now = Date.now()
): Promise<GitHubOAuthIdentity> {
  const saved = openCookie<OAuthState>(input.cookieHeader, GITHUB_OAUTH_STATE_COOKIE, config.secret, now);
  if (!input.code || !input.state || !saved || !safeEqual(saved.state, input.state) || !saved.verifier) {
    throw new GitHubOAuthError("GitHub OAuth state is invalid or expired.");
  }
  const tokenResponse = await fetchImpl("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: input.code,
      redirect_uri: config.callbackUrl,
      code_verifier: saved.verifier
    })
  });
  const tokenBody = await tokenResponse.json().catch(() => null) as { access_token?: unknown } | null;
  const accessToken = typeof tokenBody?.access_token === "string" ? tokenBody.access_token : "";
  if (!tokenResponse.ok || !accessToken) throw new GitHubOAuthError("GitHub OAuth token exchange failed.");

  const userResponse = await fetchImpl("https://api.github.com/user", {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${accessToken}`, "X-GitHub-Api-Version": "2022-11-28" },
    cache: "no-store"
  });
  const user = await userResponse.json().catch(() => null) as { id?: unknown } | null;
  const githubUserId = normalizeGitHubUserId(user?.id);
  if (!userResponse.ok || !githubUserId) throw new GitHubOAuthError("GitHub OAuth identity verification failed.");

  const expiresAt = now + OAUTH_TTL_MS;
  return {
    githubUserId,
    installCookie: sealCookie(GITHUB_OAUTH_INSTALL_COOKIE, { accessToken, githubUserId, tenantId: input.tenantId, expiresAt }, config.secret, expiresAt, now, INSTALL_CALLBACK_PATH)
  };
}

export async function verifyGitHubInstallationAccess(
  input: { cookieHeader?: string | null; tenantId: string; installationId: number },
  config: GitHubOAuthConfig,
  fetchImpl: typeof fetch = fetch,
  now = Date.now()
): Promise<boolean> {
  const authorization = openCookie<InstallAuthorization>(input.cookieHeader, GITHUB_OAUTH_INSTALL_COOKIE, config.secret, now);
  if (!authorization || authorization.tenantId !== input.tenantId) return false;
  const response = await fetchImpl("https://api.github.com/user/installations?per_page=100", {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${authorization.accessToken}`, "X-GitHub-Api-Version": "2022-11-28" },
    cache: "no-store"
  });
  const body = await response.json().catch(() => null) as { installations?: Array<{ id?: unknown }> } | null;
  return Boolean(response.ok && body?.installations?.some((item) => item.id === input.installationId));
}

/**
 * Returns only installation ids for this App that the signed-in GitHub user
 * can currently access. The GitHub response and OAuth token stay transient.
 */
export async function findGitHubInstallationAccess(
  input: { cookieHeader?: string | null; tenantId: string; appId: number },
  config: GitHubOAuthConfig,
  fetchImpl: typeof fetch = fetch,
  now = Date.now()
): Promise<GitHubInstallationAccess[] | null> {
  const authorization = openCookie<InstallAuthorization>(input.cookieHeader, GITHUB_OAUTH_INSTALL_COOKIE, config.secret, now);
  if (!authorization || authorization.tenantId !== input.tenantId || !Number.isSafeInteger(input.appId) || input.appId <= 0) return null;
  const response = await fetchImpl("https://api.github.com/user/installations?per_page=100", {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${authorization.accessToken}`, "X-GitHub-Api-Version": "2022-11-28" },
    cache: "no-store"
  });
  const body = await response.json().catch(() => null) as {
    installations?: Array<{
      id?: unknown;
      app_id?: unknown;
      account?: { id?: unknown; login?: unknown; type?: unknown };
    }>;
  } | null;
  if (!response.ok || !Array.isArray(body?.installations)) return null;
  const installations = new Map<number, GitHubInstallationAccess>();
  for (const installation of body.installations) {
    const accountId = normalizeGitHubAccountId(installation.account?.id);
    const accountType = normalizeGitHubAccountType(installation.account?.type);
    if (installation.app_id !== input.appId || !isInstallationId(installation.id) || !accountId || !accountType) continue;
    installations.set(installation.id, {
      installationId: installation.id,
      accountId,
      accountLogin: normalizeGitHubAccountLogin(installation.account?.login),
      accountType
    });
  }
  return Array.from(installations.values()).sort((left, right) => left.installationId - right.installationId);
}

/** Returns only the verified numeric identity bound to the transient install cookie. */
export function getGitHubInstallationAuthorizationIdentity(
  input: { cookieHeader?: string | null; tenantId: string },
  config: GitHubOAuthConfig,
  now = Date.now()
): string | null {
  const authorization = openCookie<InstallAuthorization>(input.cookieHeader, GITHUB_OAUTH_INSTALL_COOKIE, config.secret, now);
  if (!authorization || authorization.tenantId !== input.tenantId) return null;
  return normalizeGitHubUserId(authorization.githubUserId);
}

/** Rebinds the transient, encrypted install credential after tenant creation. */
export function bindGitHubInstallationAuthorization(
  input: { cookieHeader?: string | null; tenantId: string },
  config: GitHubOAuthConfig,
  now = Date.now()
): string | null {
  const authorization = openCookie<InstallAuthorization>(input.cookieHeader, GITHUB_OAUTH_INSTALL_COOKIE, config.secret, now);
  if (!authorization || authorization.tenantId !== "pending") return null;
  return sealCookie(GITHUB_OAUTH_INSTALL_COOKIE, { ...authorization, tenantId: input.tenantId }, config.secret, authorization.expiresAt, now, INSTALL_CALLBACK_PATH);
}

export function clearGitHubOAuthStateCookie(now = Date.now()): string {
  return expiredCookie(GITHUB_OAUTH_STATE_COOKIE, OAUTH_CALLBACK_PATH, now);
}

export function clearGitHubOAuthInstallCookie(now = Date.now()): string {
  return expiredCookie(GITHUB_OAUTH_INSTALL_COOKIE, INSTALL_CALLBACK_PATH, now);
}

function sealCookie(name: string, value: object, secret: string, expiresAt: number, now: number, path: string): string {
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const packed = `${base64Url(iv)}.${base64Url(cipher.getAuthTag())}.${base64Url(ciphertext)}`;
  return cookie(name, packed, expiresAt, now, path);
}

function openCookie<T extends { expiresAt?: unknown }>(header: string | null | undefined, name: string, secret: string, now: number): T | null {
  const packed = readCookie(header, name);
  if (!packed) return null;
  const parts = packed.split(".");
  if (parts.length !== 3) return null;
  try {
    const key = createHash("sha256").update(secret).digest();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[0], "base64url"));
    decipher.setAuthTag(Buffer.from(parts[1], "base64url"));
    const value = JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[2], "base64url")), decipher.final()]).toString("utf8")) as T;
    return typeof value.expiresAt === "number" && value.expiresAt > now ? value : null;
  } catch {
    return null;
  }
}

function cookie(name: string, value: string, expiresAt: number, now: number, path: string): string {
  return [`${name}=${value}`, `Path=${path}`, "HttpOnly", "Secure", "SameSite=Lax", `Max-Age=${Math.max(0, Math.floor((expiresAt - now) / 1000))}`, `Expires=${new Date(expiresAt).toUTCString()}`].join("; ");
}

function expiredCookie(name: string, path: string, now: number): string { return cookie(name, "deleted", now, now, path); }
function readCookie(header: string | null | undefined, name: string): string | null { return header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? null; }
function normalizeGitHubUserId(value: unknown): string | null { return (typeof value === "number" || typeof value === "string") && /^\d{1,20}$/.test(String(value)) ? String(value) : null; }
function isInstallationId(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function normalizeGitHubAccountId(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null; }
function normalizeGitHubAccountLogin(value: unknown): string { return typeof value === "string" && /^[A-Za-z0-9-]{1,39}$/.test(value) ? value : "GitHub account"; }
function normalizeGitHubAccountType(value: unknown): "User" | "Organization" | null { return value === "User" || value === "Organization" ? value : null; }
function base64Url(value: Buffer): string { return value.toString("base64url"); }
function safeEqual(a: string, b: string): boolean { const left = Buffer.from(a); const right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
