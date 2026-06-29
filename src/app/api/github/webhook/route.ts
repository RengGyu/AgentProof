import { buildGitHubPullRequestInput } from "@/lib/github";
import {
  createGitHubInstallationAccessToken,
  forgetGitHubWebhookDelivery,
  getGitHubAppAutomationSettings,
  getGitHubAppConfigStatus,
  isGitHubAppRepoAllowed,
  markGitHubWebhookDelivery,
  normalizeGitHubWebhookEvent,
  shouldHandlePullRequestAction,
  verifyGitHubWebhookSignature
} from "@/lib/github-app";
import { noStoreJson, parseJsonSafely, utf8ByteLength } from "@/lib/http";
import { reportToGitHubComment } from "@/lib/markdown";
import { redactSecrets } from "@/lib/redact";
import { validateVerificationReport } from "@/lib/report-validation";
import { createSavedReport, getSavedReportStoreStatus, SavedReportStoreError } from "@/lib/server-report-store";
import { generateVerificationReport } from "@/lib/verifier";
import type { VerificationReport } from "@/lib/types";

const ALLOWED_EVENTS = new Set(["pull_request", "check_run", "check_suite", "status", "ping"]);
const MAX_WEBHOOK_BODY_BYTES = 400_000;
const AGENTPROOF_APP_COMMENT_MARKER = "<!-- agentproof:github-app:evidence-check:v1 -->";
const COMMENTS_PAGE_SIZE = 100;
const MAX_COMMENT_PAGES = 5;

export async function POST(request: Request) {
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET ?? "";

  if (!webhookSecret.trim()) {
    return noStoreJson({
      error: "GitHub App webhook is not configured.",
      code: "github_webhook_not_configured"
    }, { status: 501 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);

  if (contentLength > MAX_WEBHOOK_BODY_BYTES) {
    return noStoreJson({ error: "GitHub webhook payload is too large." }, { status: 413 });
  }

  const rawBody = await request.text();

  if (utf8ByteLength(rawBody) > MAX_WEBHOOK_BODY_BYTES) {
    return noStoreJson({ error: "GitHub webhook payload is too large." }, { status: 413 });
  }

  if (!verifyGitHubWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"), webhookSecret)) {
    return noStoreJson({ error: "Invalid GitHub webhook signature." }, { status: 401 });
  }

  const meta = normalizeGitHubWebhookEvent(request.headers);
  if (!ALLOWED_EVENTS.has(meta.event)) {
    return noStoreJson({
      ok: true,
      ignored: true,
      dryRun: true,
      event: safeWebhookString(meta.event),
      delivery: safeWebhookString(meta.delivery),
      automationEnabled: false,
      note: "Event ignored. Automated GitHub App actions are disabled."
    });
  }

  const payload = parseJsonSafely<Record<string, unknown>>(rawBody);

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return noStoreJson({ error: "GitHub webhook payload must be a JSON object." }, { status: 400 });
  }

  const settings = getGitHubAppAutomationSettings();
  const action = safeWebhookString(typeof payload?.action === "string" ? payload.action : undefined);
  const smokeControls = getGitHubAppSmokeControls(payload);

  if (meta.event !== "pull_request" || !settings.enabled) {
    return noStoreJson({
      ok: true,
      accepted: true,
      dryRun: true,
      event: safeWebhookString(meta.event),
      delivery: safeWebhookString(meta.delivery),
      action,
      automationEnabled: false,
      willAnalyze: false,
      willComment: false,
      summary: buildWebhookDryRunSummary(payload),
      note: "Webhook verified. Automated GitHub App actions stay disabled until automation is explicitly enabled for an allowed repository."
    });
  }

  return handlePullRequestAutomation(payload, {
    requestUrl: request.url,
    delivery: meta.delivery,
    event: meta.event,
    action,
    commentEnabled: settings.commentEnabled && !smokeControls.suppressComment,
    saveReportsEnabled: !smokeControls.suppressSavedReport,
    repoAllowed: isGitHubAppRepoAllowed(getString(getNestedRecord(payload, "repository"), "full_name"), settings)
  });
}

async function handlePullRequestAutomation(
  payload: Record<string, unknown>,
  context: {
    requestUrl: string;
    delivery: string;
    event: string;
    action: string | undefined;
    commentEnabled: boolean;
    saveReportsEnabled: boolean;
    repoAllowed: boolean;
  }
) {
  if (!shouldHandlePullRequestAction(context.action)) {
    return noStoreJson({
      ok: true,
      ignored: true,
      dryRun: false,
      event: safeWebhookString(context.event),
      delivery: safeWebhookString(context.delivery),
      action: context.action,
      automationEnabled: true,
      willAnalyze: false,
      willComment: false,
      note: "Pull request action ignored by AgentProof automation."
    });
  }

  if (!context.repoAllowed) {
    return noStoreJson({
      ok: true,
      ignored: true,
      dryRun: false,
      event: safeWebhookString(context.event),
      delivery: safeWebhookString(context.delivery),
      action: context.action,
      automationEnabled: true,
      willAnalyze: false,
      willComment: false,
      note: "Repository is not in AGENTPROOF_GITHUB_APP_ALLOWED_REPOS."
    });
  }

  const automation = parsePullRequestAutomationPayload(payload);
  if (!automation) {
    return noStoreJson({
      error: "GitHub pull_request webhook payload is missing required automation fields or has mismatched repository metadata.",
      code: "github_app_payload_invalid",
      willAnalyze: false,
      willComment: false
    }, { status: 422 });
  }

  const appStatus = getGitHubAppConfigStatus();
  if (!appStatus.ready) {
    return noStoreJson({
      error: "GitHub App automation is enabled, but App credentials are incomplete or invalid.",
      code: "github_app_not_ready",
      willAnalyze: false,
      willComment: false
    }, { status: 503 });
  }

  const idempotencyKey = [
    automation.installationId,
    automation.repositoryFullName.toLowerCase(),
    automation.pullRequestNumber,
    automation.headSha,
    context.action
  ].join(":");

  if (!markGitHubWebhookDelivery(idempotencyKey)) {
    return noStoreJson({
      ok: true,
      accepted: true,
      duplicate: true,
      dryRun: false,
      event: safeWebhookString(context.event),
      delivery: safeWebhookString(context.delivery),
      action: context.action,
      automationEnabled: true,
      willAnalyze: false,
      willComment: false,
      analysis: {
        status: "skipped",
        repository: automation.repositoryFullName,
        pullRequestNumber: automation.pullRequestNumber,
        headSha: automation.headSha,
        reason: "Duplicate delivery for this PR head SHA and action."
      }
    });
  }

  try {
    const token = await createGitHubInstallationAccessToken(automation.installationId);
    const input = await buildGitHubPullRequestInput(automation.pullRequestUrl, token, "");

    if (!input) {
      throw new Error("GitHub App PR analysis could not build a pull request input.");
    }

    input.limitations = [
      ...(input.limitations ?? []),
      "GitHub App automation v1 does not fetch linked issue/task text; requirements are extracted from the PR description unless the original request is included there."
    ];

    const report = generateVerificationReport(input);
    const validation = validateVerificationReport(report, { mode: "full" });

    if (!validation.valid) {
      throw new Error(`Generated report failed runtime validation: ${validation.errors.join("; ")}`);
    }

    const saved = context.saveReportsEnabled
      ? await maybeCreateAutomationSavedReport(report, context.requestUrl)
      : undefined;
    const comment = context.commentEnabled
      ? await postGitHubAppMarkerComment(automation, token, report)
      : undefined;

    return noStoreJson({
      ok: true,
      accepted: true,
      dryRun: false,
      event: safeWebhookString(context.event),
      delivery: safeWebhookString(context.delivery),
      action: context.action,
      automationEnabled: true,
      willAnalyze: true,
      willComment: context.commentEnabled,
      analysis: {
        status: "completed",
        repository: automation.repositoryFullName,
        pullRequestNumber: automation.pullRequestNumber,
        headSha: automation.headSha,
        priority: report.summary.priority,
        evidenceCoverage: report.summary.evidenceCoverage,
        savedReport: saved,
        comment
      }
    });
  } catch (error) {
    forgetGitHubWebhookDelivery(idempotencyKey);
    return noStoreJson({
      error: redactSecrets(error instanceof Error ? error.message : "GitHub App automation failed."),
      code: "github_app_automation_failed"
    }, { status: error instanceof SavedReportStoreError ? 503 : 502 });
  }
}

function buildWebhookDryRunSummary(payload: Record<string, unknown>) {
  const repository = getNestedRecord(payload, "repository");
  const pullRequest = getNestedRecord(payload, "pull_request");
  const checkRun = getNestedRecord(payload, "check_run");
  const statusContext = safeWebhookString(typeof payload.context === "string" ? payload.context : undefined);

  return {
    repository: getString(repository, "full_name"),
    pullRequestNumber: getNumber(pullRequest, "number"),
    pullRequestUrl: getString(pullRequest, "html_url"),
    checkRunName: getString(checkRun, "name"),
    statusContext
  };
}

function getNestedRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = parent[key];

  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function getString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];

  return safeWebhookString(typeof value === "string" ? value : undefined);
}

function getNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];

  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getGitHubAppSmokeControls(payload: Record<string, unknown>) {
  const smoke = getNestedRecord(payload, "agentproofSmoke");
  const enabled = smoke?.mode === "live-analysis";

  return {
    suppressComment: enabled && smoke.suppressComment === true,
    suppressSavedReport: enabled && smoke.suppressSavedReport === true
  };
}

function parsePullRequestAutomationPayload(payload: Record<string, unknown>) {
  const repository = getNestedRecord(payload, "repository");
  const pullRequest = getNestedRecord(payload, "pull_request");
  const installation = getNestedRecord(payload, "installation");
  const repositoryFullName = getString(repository, "full_name");
  const pullRequestNumber = getNumber(pullRequest, "number");
  const pullRequestUrl = getString(pullRequest, "html_url");
  const head = getNestedRecord(pullRequest ?? {}, "head");
  const headSha = getString(head, "sha");
  const installationId = getNumber(installation, "id");

  if (!repositoryFullName || !pullRequestNumber || !pullRequestUrl || !headSha || !installationId) {
    return null;
  }

  const parsedPrUrl = parseGitHubPullRequestUrl(pullRequestUrl);
  if (
    !parsedPrUrl ||
    parsedPrUrl.fullName.toLowerCase() !== repositoryFullName.toLowerCase() ||
    parsedPrUrl.number !== pullRequestNumber
  ) {
    return null;
  }

  return {
    repositoryFullName,
    pullRequestNumber,
    pullRequestUrl,
    headSha,
    installationId
  };
}

function parseGitHubPullRequestUrl(value: string) {
  try {
    const url = new URL(value);
    const [, owner, repo, pull, number] = url.pathname.split("/");
    const prNumber = Number(number);

    if (url.hostname !== "github.com" || !owner || !repo || pull !== "pull" || !Number.isInteger(prNumber) || prNumber <= 0) {
      return null;
    }

    return {
      fullName: `${owner}/${repo}`,
      number: prNumber
    };
  } catch {
    return null;
  }
}

async function maybeCreateAutomationSavedReport(report: VerificationReport, requestUrl: string) {
  if (!/^(1|true|yes|on)$/i.test(process.env.AGENTPROOF_GITHUB_APP_SAVE_REPORTS?.trim() ?? "")) {
    return undefined;
  }

  const status = getSavedReportStoreStatus();
  const saved = await createSavedReport(report);

  return {
    id: saved.id,
    url: new URL(`/reports/${saved.id}`, requestUrl).toString(),
    expiresAt: saved.expiresAt,
    privacy: "summary-only" as const,
    durability: status.durability
  };
}

async function postGitHubAppMarkerComment(
  automation: NonNullable<ReturnType<typeof parsePullRequestAutomationPayload>>,
  token: string,
  report: VerificationReport
) {
  const [owner, repo] = automation.repositoryFullName.split("/");
  if (!owner || !repo) {
    throw new Error("Repository full name is invalid.");
  }

  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const commentsUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${automation.pullRequestNumber}/comments`;
  const existing = await findExistingGitHubAppComment(commentsUrl, headers);
  const body = `${AGENTPROOF_APP_COMMENT_MARKER}\n${reportToGitHubComment(report, { includeMarker: false })}`;
  const response = existing
    ? await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/comments/${existing.id}`, {
        method: "PATCH",
        headers,
        cache: "no-store",
        body: JSON.stringify({ body: redactSecrets(body) })
      })
    : await fetch(commentsUrl, {
        method: "POST",
        headers,
        cache: "no-store",
        body: JSON.stringify({ body: redactSecrets(body) })
      });

  if (!response.ok) {
    throw new Error(`GitHub App could not ${existing ? "update" : "create"} the AgentProof marker comment: HTTP ${response.status}.`);
  }

  const json = (await response.json()) as { html_url?: unknown };
  return {
    action: existing ? "updated" : "created",
    url: typeof json.html_url === "string" ? redactSecrets(json.html_url) : automation.pullRequestUrl
  };
}

async function findExistingGitHubAppComment(commentsUrl: string, headers: Record<string, string>) {
  for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
    const response = await fetch(`${commentsUrl}?per_page=${COMMENTS_PAGE_SIZE}&page=${page}`, {
      headers,
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`GitHub App could not read PR comments: HTTP ${response.status}.`);
    }

    const comments = (await response.json()) as Array<{ id?: unknown; body?: unknown }>;
    const existing = comments.find((comment) =>
      typeof comment.id === "number" &&
      typeof comment.body === "string" &&
      comment.body.includes(AGENTPROOF_APP_COMMENT_MARKER)
    );

    if (existing && typeof existing.id === "number") {
      return { id: existing.id };
    }

    if (comments.length < COMMENTS_PAGE_SIZE) {
      return null;
    }
  }

  return null;
}

function safeWebhookString(value: string | undefined): string | undefined {
  return value ? redactSecrets(value).slice(0, 500) : undefined;
}
