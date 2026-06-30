import { createHash, createHmac, createPrivateKey, createSign, timingSafeEqual } from "crypto";
import { getTenantControlPlaneSettings, readTenantRepositoryGrants } from "./tenant-control-plane";

const GITHUB_APP_FETCH_TIMEOUT_MS = 8000;
const GITHUB_WEBHOOK_IDEMPOTENCY_TTL_MS = 30 * 60 * 1000;
const GITHUB_WEBHOOK_PROCESSING_LEASE_MS = 30 * 60 * 1000;
const GITHUB_WEBHOOK_IDEMPOTENCY_DURABLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GITHUB_WEBHOOK_IDEMPOTENCY_MAX = 500;
export const DEFAULT_GITHUB_WEBHOOK_DELIVERIES_TABLE = "agentproof_github_webhook_deliveries";

export interface GitHubAppConfigStatus {
  appIdConfigured: boolean;
  privateKeyConfigured: boolean;
  privateKeyFormatValid: boolean;
  webhookSecretConfigured: boolean;
  ready: boolean;
}

export interface GitHubAppAutomationSettings {
  enabled: boolean;
  commentEnabled: boolean;
  saveReportsEnabled: boolean;
  allowedRepos: string[];
  allowAllRepos: boolean;
}

export interface GitHubAppReadinessStatus {
  mode: "not-configured" | "dry-run" | "analysis-ready" | "analysis-and-comment-ready";
  signedIntakeReady: boolean;
  appCredentialsReady: boolean;
  automationEnabled: boolean;
  commentEnabled: boolean;
  saveReportsEnabled: boolean;
  allowedRepoCount: number;
  allowAllRepos: boolean;
  canAnalyzePullRequests: boolean;
  canPostComments: boolean;
  warnings: string[];
}

export interface PublicGitHubAppReadinessStatus {
  mode: "manual" | "signed-intake" | "event-mode";
  label: string;
  description: string;
  capabilities: string[];
  cautions: string[];
}

export interface GitHubWebhookDeliveryInput {
  key: string;
  event: string;
  delivery: string;
  installationId: number;
  repositoryFullName: string;
  pullRequestNumber: number;
  headSha: string;
  action: string;
}

export interface GitHubWebhookDeliveryReservation {
  accepted: boolean;
  store: "memory" | "supabase";
  durable: boolean;
  duplicateStatus?: GitHubWebhookDeliveryStatus;
}

export type GitHubWebhookDeliveryStatus = "processing" | "completed" | "failed_retryable";

export interface GitHubWebhookDeliveryResultSummary {
  status: "completed";
  repository: string;
  pullRequestNumber: number;
  headSha: string;
  priority: string;
  evidenceCoverage: number;
  savedReport?: {
    privacy?: string;
    durability?: string;
  };
  comment?: {
    action?: string;
  };
}

export interface GitHubWebhookIdempotencyStoreStatus {
  mode: "memory" | "supabase";
  configured: boolean;
  durable: boolean;
  table: string;
  missingEnv: string[];
}

type GlobalWithWebhookIdempotency = typeof globalThis & {
  __agentproofGitHubWebhookDeliveries?: Map<string, number>;
};

interface SupabaseWebhookDeliveryConfig {
  url: string;
  serviceRoleKey: string;
  table: string;
}

interface SupabaseWebhookDeliveryRow {
  id: string;
  status: GitHubWebhookDeliveryStatus;
  event: string;
  delivery_id: string;
  installation_id: number;
  repository_full_name: string;
  pull_request_number: number;
  head_sha: string;
  action: string;
  result_summary?: GitHubWebhookDeliveryResultSummary | null;
  error_code?: string | null;
  error_summary?: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

interface SupabaseWebhookDeliveryStatusRow {
  status?: unknown;
  updated_at?: unknown;
}

interface SupabaseWebhookDeliveryState {
  status: GitHubWebhookDeliveryStatus;
  updatedAt?: string;
}

interface SupabaseWebhookDeliveryUpdateOptions {
  currentStatus?: GitHubWebhookDeliveryStatus;
  currentUpdatedAt?: string;
  returnRepresentation?: boolean;
}

export class GitHubAppTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubAppTokenError";
  }
}

export class GitHubWebhookIdempotencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubWebhookIdempotencyError";
  }
}

export function getGitHubAppConfigStatus(env = process.env): GitHubAppConfigStatus {
  const privateKeyConfigured = Boolean(env.GITHUB_PRIVATE_KEY?.trim());
  const privateKeyFormatValid = privateKeyConfigured
    ? isGitHubPrivateKeyFormatValid(env.GITHUB_PRIVATE_KEY)
    : false;
  const status = {
    appIdConfigured: Boolean(env.GITHUB_APP_ID),
    privateKeyConfigured,
    privateKeyFormatValid,
    webhookSecretConfigured: Boolean(env.GITHUB_WEBHOOK_SECRET)
  };

  return {
    ...status,
    ready: status.appIdConfigured && status.privateKeyConfigured && status.privateKeyFormatValid && status.webhookSecretConfigured
  };
}

export function normalizeGitHubPrivateKey(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

export function isGitHubPrivateKeyFormatValid(value: string | undefined): boolean {
  if (!value?.trim()) {
    return false;
  }

  try {
    createPrivateKey(normalizeGitHubPrivateKey(value));
    return true;
  } catch {
    return false;
  }
}

export function verifyGitHubWebhookSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader?.startsWith("sha256=") || !secret) {
    return false;
  }

  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const actualBuffer = Buffer.from(signatureHeader);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function normalizeGitHubWebhookEvent(headers: Headers) {
  return {
    event: headers.get("x-github-event") ?? "unknown",
    delivery: headers.get("x-github-delivery") ?? "unknown"
  };
}

export function createGitHubAppJwt(env = process.env, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const appId = env.GITHUB_APP_ID?.trim();
  const privateKey = env.GITHUB_PRIVATE_KEY?.trim();

  if (!appId || !privateKey || !isGitHubPrivateKeyFormatValid(privateKey)) {
    throw new GitHubAppTokenError("GitHub App credentials are incomplete or invalid.");
  }

  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({
    iat: nowSeconds - 60,
    exp: nowSeconds + 9 * 60,
    iss: appId
  });
  const signer = createSign("RSA-SHA256");
  const signingInput = `${header}.${payload}`;
  signer.update(signingInput);
  signer.end();

  return `${signingInput}.${base64Url(signer.sign(normalizeGitHubPrivateKey(privateKey)))}`;
}

export async function createGitHubInstallationAccessToken(
  installationId: number,
  env = process.env
): Promise<string> {
  if (!Number.isInteger(installationId) || installationId <= 0) {
    throw new GitHubAppTokenError("GitHub App installation id is missing or invalid.");
  }

  const jwt = createGitHubAppJwt(env);
  const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "X-GitHub-Api-Version": "2022-11-28"
    },
    cache: "no-store",
    signal: AbortSignal.timeout(GITHUB_APP_FETCH_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new GitHubAppTokenError(`GitHub App installation token request failed with HTTP ${response.status}.`);
  }

  const json = (await response.json()) as { token?: unknown };
  if (typeof json.token !== "string" || !json.token.trim()) {
    throw new GitHubAppTokenError("GitHub App installation token response did not include a token.");
  }

  return json.token;
}

export function getGitHubAppAutomationSettings(env = process.env): GitHubAppAutomationSettings {
  const allowedRepos = parseAllowedRepos(env.AGENTPROOF_GITHUB_APP_ALLOWED_REPOS ?? "");

  return {
    enabled: truthy(env.AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED),
    commentEnabled: truthy(env.AGENTPROOF_GITHUB_APP_COMMENT_ENABLED),
    saveReportsEnabled: truthy(env.AGENTPROOF_GITHUB_APP_SAVE_REPORTS),
    allowedRepos: allowedRepos.filter((repo) => repo !== "*"),
    allowAllRepos: allowedRepos.includes("*")
  };
}

export function getGitHubAppReadinessStatus(env = process.env): GitHubAppReadinessStatus {
  const config = getGitHubAppConfigStatus(env);
  const settings = getGitHubAppAutomationSettings(env);
  const tenantControl = getTenantControlPlaneSettings(env);
  const tenantGrants = tenantControl.enabled ? readTenantRepositoryGrants(env) : [];
  const tenantGrantCount = Array.isArray(tenantGrants) ? tenantGrants.length : 0;
  const hasTenantGrantSource = tenantControl.enabled && tenantGrantCount > 0;
  const hasLegacyAllowedRepos = settings.allowAllRepos || settings.allowedRepos.length > 0;
  const hasAllowedRepos = tenantControl.enabled ? hasTenantGrantSource : hasLegacyAllowedRepos;
  const canAnalyzePullRequests = config.ready && settings.enabled && hasAllowedRepos && tenantGrants !== null;
  const canPostComments = canAnalyzePullRequests && settings.commentEnabled;
  const warnings: string[] = [];

  if (!config.webhookSecretConfigured) {
    warnings.push("Signed webhook intake is disabled until GITHUB_WEBHOOK_SECRET is configured.");
  }

  if (settings.enabled && !config.ready) {
    warnings.push("Automation is enabled but GitHub App credentials are incomplete or invalid.");
  }

  if (settings.enabled && !tenantControl.enabled && !hasAllowedRepos) {
    warnings.push("Automation is enabled but no allowed repositories are configured.");
  }

  if (settings.enabled && tenantControl.enabled && tenantGrants === null) {
    warnings.push("Automation is enabled but tenant repository grants are invalid.");
  }

  if (settings.enabled && tenantControl.enabled && Array.isArray(tenantGrants) && tenantGrants.length === 0) {
    warnings.push("Tenant control plane is enabled but no tenant repository grants are configured.");
  }

  if (settings.allowAllRepos && !tenantControl.enabled) {
    warnings.push("Allowed repositories is set to all installed repositories; use only for controlled testing.");
  }

  if (settings.allowAllRepos && tenantControl.enabled) {
    warnings.push("Global repository allowlist is ignored while tenant control plane authorization is enabled.");
  }

  if (settings.commentEnabled && !canAnalyzePullRequests) {
    warnings.push("Comment opt-in is enabled but PR analysis is not ready.");
  }

  const mode = !config.webhookSecretConfigured
    ? "not-configured"
    : canPostComments
      ? "analysis-and-comment-ready"
      : canAnalyzePullRequests
        ? "analysis-ready"
        : "dry-run";

  return {
    mode,
    signedIntakeReady: config.webhookSecretConfigured,
    appCredentialsReady: config.ready,
    automationEnabled: settings.enabled,
    commentEnabled: settings.commentEnabled,
    saveReportsEnabled: settings.saveReportsEnabled,
    allowedRepoCount: tenantControl.enabled ? tenantGrantCount : settings.allowedRepos.length,
    allowAllRepos: settings.allowAllRepos,
    canAnalyzePullRequests,
    canPostComments,
    warnings
  };
}

export function getPublicGitHubAppReadinessStatus(env = process.env): PublicGitHubAppReadinessStatus {
  const status = getGitHubAppReadinessStatus(env);
  const publicMode = publicStatusMode(status.mode);

  return {
    mode: publicMode,
    label: publicStatusLabel(publicMode),
    description: publicStatusDescription(publicMode),
    capabilities: [
      "Manual PR URL analysis remains available from the main workspace.",
      publicMode === "event-mode"
        ? "Signed PR events can trigger AgentProof evidence reports for configured repositories."
        : "Signed PR events are accepted as bounded metadata unless automation is explicitly enabled.",
      "Saved report links and marker comments remain separate opt-in controls."
    ],
    cautions: [
      "Public readiness status does not expose secret names, values, allowlists, or private-key validity.",
      "AgentProof produces evidence reports for human decisions; it does not auto-merge."
    ]
  };
}

function publicStatusMode(mode: GitHubAppReadinessStatus["mode"]): PublicGitHubAppReadinessStatus["mode"] {
  if (mode === "analysis-ready" || mode === "analysis-and-comment-ready") return "event-mode";
  if (mode === "dry-run") return "signed-intake";
  return "manual";
}

function publicStatusLabel(mode: PublicGitHubAppReadinessStatus["mode"]): string {
  if (mode === "event-mode") return "Event mode ready";
  if (mode === "signed-intake") return "Signed intake";
  return "Manual mode";
}

function publicStatusDescription(mode: PublicGitHubAppReadinessStatus["mode"]): string {
  if (mode === "event-mode") {
    return "GitHub App event mode can generate evidence reports for configured PR events.";
  }

  if (mode === "signed-intake") {
    return "Signed webhook events can be verified, but event analysis is not publicly reported as active.";
  }

  return "Use manual PR URL analysis until GitHub App webhook intake is configured.";
}

export function isGitHubAppRepoAllowed(fullName: string | undefined, settings: GitHubAppAutomationSettings): boolean {
  if (!fullName) return false;
  if (settings.allowAllRepos) return true;

  const normalized = fullName.toLowerCase();
  return settings.allowedRepos.some((repo) => repo.toLowerCase() === normalized);
}

export function shouldHandlePullRequestAction(action: string | undefined): boolean {
  return action === "opened" ||
    action === "reopened" ||
    action === "synchronize" ||
    action === "ready_for_review";
}

export function markGitHubWebhookDelivery(key: string, now = Date.now()): boolean {
  cleanupGitHubWebhookDeliveries(now);
  const store = githubWebhookDeliveryStore();

  if (store.has(key)) {
    return false;
  }

  store.set(key, now);
  trimGitHubWebhookDeliveryStore();
  return true;
}

export async function reserveGitHubWebhookDelivery(
  input: GitHubWebhookDeliveryInput,
  now = Date.now(),
  env = process.env
): Promise<GitHubWebhookDeliveryReservation> {
  const config = getSupabaseWebhookDeliveryConfig(env);

  if (!config) {
    return {
      accepted: markGitHubWebhookDelivery(input.key, now),
      store: "memory",
      durable: false
    };
  }

  return reserveSupabaseWebhookDelivery(config, input, now);
}

export function forgetGitHubWebhookDelivery(key: string): boolean {
  return githubWebhookDeliveryStore().delete(key);
}

export async function completeGitHubWebhookDelivery(
  input: Pick<GitHubWebhookDeliveryInput, "key">,
  resultSummary: GitHubWebhookDeliveryResultSummary,
  now = Date.now(),
  env = process.env
): Promise<boolean> {
  const config = getSupabaseWebhookDeliveryConfig(env);

  if (!config) {
    return true;
  }

  return updateSupabaseWebhookDelivery(config, input.key, {
    status: "completed",
    result_summary: resultSummary,
    error_code: null,
    error_summary: null,
    updated_at: new Date(now).toISOString()
  });
}

export async function releaseGitHubWebhookDelivery(
  input: Pick<GitHubWebhookDeliveryInput, "key">,
  env = process.env
): Promise<boolean> {
  const config = getSupabaseWebhookDeliveryConfig(env);

  if (!config) {
    return forgetGitHubWebhookDelivery(input.key);
  }

  return deleteSupabaseWebhookDelivery(config, input.key);
}

export async function failGitHubWebhookDelivery(
  input: Pick<GitHubWebhookDeliveryInput, "key">,
  error: { code: string; summary: string },
  now = Date.now(),
  env = process.env
): Promise<boolean> {
  const config = getSupabaseWebhookDeliveryConfig(env);

  if (!config) {
    return forgetGitHubWebhookDelivery(input.key);
  }

  return updateSupabaseWebhookDelivery(config, input.key, {
    status: "failed_retryable",
    error_code: safeWebhookAction(error.code),
    error_summary: error.summary.slice(0, 500),
    updated_at: new Date(now).toISOString()
  });
}

export function clearGitHubWebhookDeliveriesForTests() {
  githubWebhookDeliveryStore().clear();
}

export function getGitHubWebhookIdempotencyStoreStatus(env = process.env): GitHubWebhookIdempotencyStoreStatus {
  const read = readSupabaseWebhookDeliveryEnv(env);

  if (read.url && read.serviceRoleKey) {
    return {
      mode: "supabase",
      configured: true,
      durable: true,
      table: read.table,
      missingEnv: []
    };
  }

  const missingEnv: string[] = [];
  if (read.url || read.serviceRoleKey) {
    if (!read.url) {
      missingEnv.push("AGENTPROOF_GITHUB_WEBHOOK_SUPABASE_URL or AGENTPROOF_REPORTS_SUPABASE_URL or SUPABASE_URL");
    }

    if (!read.serviceRoleKey) {
      missingEnv.push(
        "AGENTPROOF_GITHUB_WEBHOOK_SUPABASE_SERVICE_ROLE_KEY or AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY"
      );
    }
  }

  return {
    mode: "memory",
    configured: false,
    durable: false,
    table: read.table,
    missingEnv
  };
}

function parseAllowedRepos(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 100);
}

function truthy(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function base64UrlJson(value: unknown): string {
  return base64Url(Buffer.from(JSON.stringify(value), "utf8"));
}

function base64Url(value: Buffer): string {
  return value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function cleanupGitHubWebhookDeliveries(now: number): number {
  let deleted = 0;

  for (const [key, createdAt] of githubWebhookDeliveryStore()) {
    if (now - createdAt > GITHUB_WEBHOOK_IDEMPOTENCY_TTL_MS) {
      githubWebhookDeliveryStore().delete(key);
      deleted += 1;
    }
  }

  return deleted;
}

function githubWebhookDeliveryStore() {
  const globalStore = globalThis as GlobalWithWebhookIdempotency;
  globalStore.__agentproofGitHubWebhookDeliveries ??= new Map<string, number>();

  return globalStore.__agentproofGitHubWebhookDeliveries;
}

function trimGitHubWebhookDeliveryStore() {
  const store = githubWebhookDeliveryStore();

  while (store.size > GITHUB_WEBHOOK_IDEMPOTENCY_MAX) {
    const oldest = store.keys().next().value as string | undefined;
    if (!oldest) return;
    store.delete(oldest);
  }
}

async function reserveSupabaseWebhookDelivery(
  config: SupabaseWebhookDeliveryConfig,
  input: GitHubWebhookDeliveryInput,
  now: number
): Promise<GitHubWebhookDeliveryReservation> {
  await deleteExpiredSupabaseWebhookDeliveries(config, now);

  const response = await supabaseWebhookDeliveryFetch(config, "", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(toSupabaseWebhookDeliveryRow(input, now))
  });

  if (response.status === 409) {
    const existing = await getSupabaseWebhookDeliveryState(config, input.key);

    if (existing && shouldRetrySupabaseWebhookDelivery(existing, now)) {
      const accepted = await updateSupabaseWebhookDelivery(config, input.key, {
        status: "processing",
        delivery_id: safeGitHubDeliveryId(input.delivery),
        result_summary: null,
        error_code: null,
        error_summary: null,
        updated_at: new Date(now).toISOString(),
        expires_at: new Date(now + GITHUB_WEBHOOK_IDEMPOTENCY_DURABLE_TTL_MS).toISOString()
      }, {
        currentStatus: existing.status,
        currentUpdatedAt: existing.updatedAt,
        returnRepresentation: true
      });

      if (!accepted) {
        return {
          accepted: false,
          store: "supabase",
          durable: true,
          duplicateStatus: existing.status
        };
      }

      return {
        accepted: true,
        store: "supabase",
        durable: true
      };
    }

    return {
      accepted: false,
      store: "supabase",
      durable: true,
      duplicateStatus: existing?.status
    };
  }

  if (!response.ok) {
    throw new GitHubWebhookIdempotencyError(`GitHub webhook idempotency store failed with HTTP ${response.status}.`);
  }

  return {
    accepted: true,
    store: "supabase",
    durable: true
  };
}

async function deleteExpiredSupabaseWebhookDeliveries(config: SupabaseWebhookDeliveryConfig, now: number) {
  const response = await supabaseWebhookDeliveryFetch(
    config,
    `?expires_at=lte.${encodeURIComponent(new Date(now).toISOString())}`,
    {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    }
  );

  if (!response.ok) {
    throw new GitHubWebhookIdempotencyError(`GitHub webhook idempotency cleanup failed with HTTP ${response.status}.`);
  }
}

async function getSupabaseWebhookDeliveryState(
  config: SupabaseWebhookDeliveryConfig,
  key: string
): Promise<SupabaseWebhookDeliveryState | undefined> {
  const response = await supabaseWebhookDeliveryFetch(
    config,
    `?id=eq.${encodeURIComponent(hashGitHubWebhookDeliveryKey(key))}&select=status,updated_at&limit=1`,
    { method: "GET" }
  );

  if (!response.ok) {
    throw new GitHubWebhookIdempotencyError(`GitHub webhook idempotency lookup failed with HTTP ${response.status}.`);
  }

  const rows = (await response.json().catch(() => [])) as SupabaseWebhookDeliveryStatusRow[];
  const status = Array.isArray(rows) ? rows[0]?.status : undefined;
  const updatedAt = Array.isArray(rows) ? rows[0]?.updated_at : undefined;

  return isGitHubWebhookDeliveryStatus(status)
    ? { status, updatedAt: typeof updatedAt === "string" ? updatedAt : undefined }
    : undefined;
}

async function updateSupabaseWebhookDelivery(
  config: SupabaseWebhookDeliveryConfig,
  key: string,
  patch: Partial<SupabaseWebhookDeliveryRow>,
  options: SupabaseWebhookDeliveryUpdateOptions = {}
): Promise<boolean> {
  const filters = [
    `id=eq.${encodeURIComponent(hashGitHubWebhookDeliveryKey(key))}`
  ];

  if (options.currentStatus) {
    filters.push(`status=eq.${encodeURIComponent(options.currentStatus)}`);
  }

  if (options.currentUpdatedAt) {
    filters.push(`updated_at=eq.${encodeURIComponent(options.currentUpdatedAt)}`);
  }

  const response = await supabaseWebhookDeliveryFetch(
    config,
    `?${filters.join("&")}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Prefer: options.returnRepresentation ? "return=representation" : "return=minimal"
      },
      body: JSON.stringify(patch)
    }
  );

  if (!response.ok) {
    throw new GitHubWebhookIdempotencyError(`GitHub webhook idempotency update failed with HTTP ${response.status}.`);
  }

  if (options.returnRepresentation) {
    const rows = (await response.json().catch(() => [])) as unknown;
    return Array.isArray(rows) && rows.length > 0;
  }

  return true;
}

async function deleteSupabaseWebhookDelivery(config: SupabaseWebhookDeliveryConfig, key: string): Promise<boolean> {
  const response = await supabaseWebhookDeliveryFetch(
    config,
    `?id=eq.${encodeURIComponent(hashGitHubWebhookDeliveryKey(key))}`,
    {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    }
  );

  if (!response.ok) {
    throw new GitHubWebhookIdempotencyError(`GitHub webhook idempotency release failed with HTTP ${response.status}.`);
  }

  return true;
}

function toSupabaseWebhookDeliveryRow(input: GitHubWebhookDeliveryInput, now: number): SupabaseWebhookDeliveryRow {
  const createdAt = new Date(now);

  return {
    id: hashGitHubWebhookDeliveryKey(input.key),
    status: "processing",
    event: safeWebhookAction(input.event),
    delivery_id: safeGitHubDeliveryId(input.delivery),
    installation_id: input.installationId,
    repository_full_name: safeRepositoryFullName(input.repositoryFullName),
    pull_request_number: input.pullRequestNumber,
    head_sha: safeHeadSha(input.headSha),
    action: safeWebhookAction(input.action),
    result_summary: null,
    error_code: null,
    error_summary: null,
    created_at: createdAt.toISOString(),
    updated_at: createdAt.toISOString(),
    expires_at: new Date(createdAt.getTime() + GITHUB_WEBHOOK_IDEMPOTENCY_DURABLE_TTL_MS).toISOString()
  };
}

function hashGitHubWebhookDeliveryKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

async function supabaseWebhookDeliveryFetch(config: SupabaseWebhookDeliveryConfig, query: string, init: RequestInit) {
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

function getSupabaseWebhookDeliveryConfig(env = process.env): SupabaseWebhookDeliveryConfig | null {
  const status = getGitHubWebhookIdempotencyStoreStatus(env);

  if (status.missingEnv.length > 0) {
    throw new GitHubWebhookIdempotencyError("GitHub webhook idempotency Supabase env is incomplete.");
  }

  if (status.mode !== "supabase") {
    return null;
  }

  const read = readSupabaseWebhookDeliveryEnv(env);

  return {
    url: trimTrailingSlash(read.url),
    serviceRoleKey: read.serviceRoleKey,
    table: read.table
  };
}

function readSupabaseWebhookDeliveryEnv(env = process.env) {
  return {
    url:
      env.AGENTPROOF_GITHUB_WEBHOOK_SUPABASE_URL ||
      env.AGENTPROOF_REPORTS_SUPABASE_URL ||
      env.SUPABASE_URL ||
      "",
    serviceRoleKey:
      env.AGENTPROOF_GITHUB_WEBHOOK_SUPABASE_SERVICE_ROLE_KEY ||
      env.AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY ||
      env.SUPABASE_SERVICE_ROLE_KEY ||
      "",
    table: env.AGENTPROOF_GITHUB_WEBHOOK_DELIVERIES_TABLE || DEFAULT_GITHUB_WEBHOOK_DELIVERIES_TABLE
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isGitHubWebhookDeliveryStatus(value: unknown): value is GitHubWebhookDeliveryStatus {
  return value === "processing" || value === "completed" || value === "failed_retryable";
}

function shouldRetrySupabaseWebhookDelivery(state: SupabaseWebhookDeliveryState, now: number): boolean {
  if (!state.updatedAt) {
    return false;
  }

  if (state.status === "failed_retryable") {
    return true;
  }

  const updatedAt = Date.parse(state.updatedAt);
  return state.status === "processing" && Number.isFinite(updatedAt) && now - updatedAt > GITHUB_WEBHOOK_PROCESSING_LEASE_MS;
}

function safeGitHubDeliveryId(value: string): string {
  return /^[a-f0-9-]{20,80}$/i.test(value) ? value : "unknown";
}

function safeRepositoryFullName(value: string): string {
  return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(value) ? value.slice(0, 200) : "unknown/unknown";
}

function safeHeadSha(value: string): string {
  return /^[a-f0-9]{6,64}$/i.test(value) ? value : "unknown";
}

function safeWebhookAction(value: string): string {
  return /^[a-z_]{1,40}$/i.test(value) ? value : "unknown";
}
