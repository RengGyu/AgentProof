import { createHmac, createPrivateKey, createSign, timingSafeEqual } from "crypto";

const GITHUB_APP_FETCH_TIMEOUT_MS = 8000;
const GITHUB_WEBHOOK_IDEMPOTENCY_TTL_MS = 30 * 60 * 1000;
const GITHUB_WEBHOOK_IDEMPOTENCY_MAX = 500;

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

type GlobalWithWebhookIdempotency = typeof globalThis & {
  __agentproofGitHubWebhookDeliveries?: Map<string, number>;
};

export class GitHubAppTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubAppTokenError";
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
    allowedRepos: allowedRepos.filter((repo) => repo !== "*"),
    allowAllRepos: allowedRepos.includes("*")
  };
}

export function getGitHubAppReadinessStatus(env = process.env): GitHubAppReadinessStatus {
  const config = getGitHubAppConfigStatus(env);
  const settings = getGitHubAppAutomationSettings(env);
  const saveReportsEnabled = truthy(env.AGENTPROOF_GITHUB_APP_SAVE_REPORTS);
  const hasAllowedRepos = settings.allowAllRepos || settings.allowedRepos.length > 0;
  const canAnalyzePullRequests = config.ready && settings.enabled && hasAllowedRepos;
  const canPostComments = canAnalyzePullRequests && settings.commentEnabled;
  const warnings: string[] = [];

  if (!config.webhookSecretConfigured) {
    warnings.push("Signed webhook intake is disabled until GITHUB_WEBHOOK_SECRET is configured.");
  }

  if (settings.enabled && !config.ready) {
    warnings.push("Automation is enabled but GitHub App credentials are incomplete or invalid.");
  }

  if (settings.enabled && !hasAllowedRepos) {
    warnings.push("Automation is enabled but no allowed repositories are configured.");
  }

  if (settings.allowAllRepos) {
    warnings.push("Allowed repositories is set to all installed repositories; use only for controlled testing.");
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
    saveReportsEnabled,
    allowedRepoCount: settings.allowedRepos.length,
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

export function forgetGitHubWebhookDelivery(key: string): boolean {
  return githubWebhookDeliveryStore().delete(key);
}

export function clearGitHubWebhookDeliveriesForTests() {
  githubWebhookDeliveryStore().clear();
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
