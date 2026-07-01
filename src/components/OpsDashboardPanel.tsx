"use client";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  GitPullRequest,
  KeyRound,
  Loader2,
  RefreshCcw,
  ShieldCheck
} from "lucide-react";
import { useState } from "react";
import {
  opsDeadLetterUrl,
  opsGitHubAppStatusUrl,
  opsTenantDeletionPlanUrl,
  opsTokenHeaders
} from "@/lib/ops-dashboard-client";

interface OpsGitHubAppStatus {
  mode: string;
  signedIntake: string;
  appCredentials: string;
  automation: string;
  repoScope: string;
  commentOptIn: string;
  savedReportOptIn: string;
  idempotency: string;
  installationMetadata: string;
  analysisQueue: string;
  analysisQueueSummary?: {
    privacy: "analysis-job-queue-summary-only";
    sampled: number;
    truncated: boolean;
    counts: {
      queued: number;
      processing: number;
      completed: number;
      failed_retryable: number;
      failed_terminal: number;
    };
    due: number;
    delayedRetry: number;
    staleProcessing: number;
    oldestQueuedAgeSeconds?: number;
    oldestRetryAgeSeconds?: number;
  };
  analysisQueueAlertBasis?: "sampled_rows";
  analysisQueueAlerts?: Array<{
    code: string;
    severity: "info" | "warning";
    metric: string;
    count: number;
    threshold: number;
  }>;
  cautions?: string[];
}

interface OpsStatusResponse {
  githubApp?: OpsGitHubAppStatus;
  error?: string;
  code?: string;
}

interface DeadLetterResponse {
  ok?: true;
  privacy?: "analysis-job-dead-letter-summary-only";
  status?: "disabled" | "ready";
  reason?: string;
  summary?: {
    privacy: "analysis-job-dead-letter-summary-only";
    basis: "failed_terminal_recent_sample";
    sampled: number;
    truncated: boolean;
    sampledTerminalCount: number;
    topErrorCodes: Array<{
      errorCode: string;
      count: number;
    }>;
    oldestTerminalAgeSeconds?: number;
  };
  opsStatus?: {
    privacy: "analysis-job-dead-letter-ops-status-summary-only";
    basis: "failed_terminal_recent_sample";
    state: "clear" | "needs_attention" | "incident";
    alerts: Array<{
      code: string;
      severity: "info" | "warning";
      metric: string;
      count: number;
      threshold: number;
      nextAction: string;
    }>;
    nextActions: string[];
  };
  error?: string;
  code?: string;
}

interface TenantDeletionExecutionPlan {
  ok: true;
  privacy: "tenant-deletion-execution-plan-metadata-only";
  mode: "internal-execution-plan";
  destructiveDataDeletion: false;
  actions: Array<{
    key: string;
    status: string;
    reason: string;
    count?: number;
    counts?: {
      activeJobs?: number;
      queuedJobs?: number;
      processingJobs?: number;
      retryingJobs?: number;
      deletedJobs?: number;
      deletedReports?: number;
    };
  }>;
  totals: {
    knownCount: number;
    unavailableCategories: number;
  };
  guardrails: {
    returnsMetadataOnly: true;
    requiresNewWorkBlockedBeforePurge: true;
    requiresDeletionStateBeforePurge: true;
    requiresActiveJobsDrainedBeforePurge: true;
    requiresRetentionPolicyReview: true;
  };
  next: string;
}

type OpsMode = "idle" | "loading-status" | "loading-dead-letter" | "loading-deletion-plan";

export function OpsDashboardPanel() {
  const [opsToken, setOpsToken] = useState("");
  const [deletionTenantId, setDeletionTenantId] = useState("");
  const [status, setStatus] = useState<OpsGitHubAppStatus | null>(null);
  const [deadLetter, setDeadLetter] = useState<DeadLetterResponse | null>(null);
  const [deletionPlan, setDeletionPlan] = useState<TenantDeletionExecutionPlan | null>(null);
  const [mode, setMode] = useState<OpsMode>("idle");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string; code?: string } | null>(null);

  const busy = mode !== "idle";
  const canLoad = opsToken.trim().length > 0;
  const canLoadDeletionPlan = canLoad && deletionTenantId.trim().length > 0;

  async function loadStatus() {
    setMode("loading-status");
    setMessage(null);

    try {
      const json = await requestJson<OpsStatusResponse>(opsGitHubAppStatusUrl(), {
        headers: opsTokenHeaders(opsToken)
      });

      if (!json.githubApp) {
        throw new OpsPanelRequestError("Operator status response did not include GitHub App metadata.");
      }

      setStatus(json.githubApp);
      setMessage({ kind: "ok", text: "Operator status loaded as bounded metadata." });
    } catch (error) {
      setMessage(errorMessage(error, "Operator status could not be loaded."));
    } finally {
      setMode("idle");
    }
  }

  async function loadDeadLetter() {
    setMode("loading-dead-letter");
    setMessage(null);

    try {
      const json = await requestJson<DeadLetterResponse>(opsDeadLetterUrl(25), {
        headers: opsTokenHeaders(opsToken)
      });

      if (json.privacy !== "analysis-job-dead-letter-summary-only") {
        throw new OpsPanelRequestError("Dead-letter response did not match the summary-only boundary.");
      }

      setDeadLetter(json);
      setMessage({ kind: "ok", text: "Dead-letter summary loaded without job rows." });
    } catch (error) {
      setMessage(errorMessage(error, "Dead-letter summary could not be loaded."));
    } finally {
      setMode("idle");
    }
  }

  async function loadDeletionPlan() {
    setMode("loading-deletion-plan");
    setMessage(null);

    try {
      const json = await requestJson<TenantDeletionExecutionPlan>(opsTenantDeletionPlanUrl(deletionTenantId), {
        headers: opsTokenHeaders(opsToken)
      });

      if (
        json.privacy !== "tenant-deletion-execution-plan-metadata-only" ||
        json.destructiveDataDeletion !== false
      ) {
        throw new OpsPanelRequestError("Deletion plan response did not match the metadata-only boundary.");
      }

      setDeletionPlan(json);
      setMessage({ kind: "ok", text: "Deletion plan loaded as metadata only." });
    } catch (error) {
      setMessage(errorMessage(error, "Deletion plan could not be loaded."));
    } finally {
      setMode("idle");
    }
  }

  return (
    <section className="ops-dashboard" aria-labelledby="ops-dashboard-title">
      <div className="card ops-access-card">
        <div className="card-title-row">
          <div>
            <h2 id="ops-dashboard-title">Operator Access</h2>
            <p className="muted small">Use the operator header for read-only metadata checks.</p>
          </div>
          <KeyRound size={18} aria-hidden="true" />
        </div>

        <div className="ops-form">
          <div className="field">
            <label htmlFor="opsToken">Operator token</label>
            <input
              id="opsToken"
              className="input"
              value={opsToken}
              onChange={(event) => setOpsToken(event.target.value)}
              placeholder="AGENTPROOF_OPS_TOKEN value"
              type="password"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="deletionTenantId">Deletion plan tenant</label>
            <input
              id="deletionTenantId"
              className="input"
              value={deletionTenantId}
              onChange={(event) => setDeletionTenantId(event.target.value)}
              placeholder="tenant_demo"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="ops-actions">
          <button className="button primary" type="button" onClick={loadStatus} disabled={!canLoad || busy}>
            {mode === "loading-status" ? <Loader2 size={16} className="spin" /> : <RefreshCcw size={16} />}
            Load Status
          </button>
          <button className="button" type="button" onClick={loadDeadLetter} disabled={!canLoad || busy}>
            {mode === "loading-dead-letter" ? <Loader2 size={16} className="spin" /> : <Activity size={16} />}
            Dead Letter
          </button>
          <button className="button" type="button" onClick={loadDeletionPlan} disabled={!canLoadDeletionPlan || busy}>
            {mode === "loading-deletion-plan" ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />}
            Deletion Plan
          </button>
        </div>

        {message ? (
          <div className={message.kind === "ok" ? "setup-message ok" : "setup-message error"} role="status">
            {message.kind === "ok" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            <span>{message.text}{message.code ? ` (${message.code})` : ""}</span>
          </div>
        ) : null}
      </div>

      <div className="ops-grid">
        <article className="card">
          <div className="card-title-row">
            <h2>GitHub App Ops</h2>
            <GitPullRequest size={18} aria-hidden="true" />
          </div>
          {status ? (
            <>
              <div className="proof-grid ops-status-grid">
                <StatusItem label="Mode" value={status.mode} />
                <StatusItem label="Signed intake" value={status.signedIntake} />
                <StatusItem label="App credentials" value={status.appCredentials} />
                <StatusItem label="Automation" value={status.automation} />
                <StatusItem label="Repo scope" value={status.repoScope} />
                <StatusItem label="Comments" value={status.commentOptIn} />
                <StatusItem label="Saved links" value={status.savedReportOptIn} />
                <StatusItem label="Idempotency" value={status.idempotency} />
                <StatusItem label="Install metadata" value={status.installationMetadata} />
                <StatusItem label="Analysis queue" value={status.analysisQueue} />
              </div>
              {status.cautions?.length ? (
                <ul className="ops-alert-list" aria-label="Operator cautions">
                  {status.cautions.map((caution) => (
                    <li key={caution}>{caution}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">No operator cautions reported.</p>
              )}
            </>
          ) : (
            <p className="muted small">Load status to inspect bounded operator readiness.</p>
          )}
        </article>

        <article className="card">
          <div className="card-title-row">
            <h2>Queue Summary</h2>
            <ShieldCheck size={18} aria-hidden="true" />
          </div>
          {status?.analysisQueueSummary ? (
            <>
              <div className="tenant-rollup-row">
                <span>Sampled {status.analysisQueueSummary.sampled}</span>
                <span>Due {status.analysisQueueSummary.due}</span>
                <span>Retry {status.analysisQueueSummary.delayedRetry}</span>
                <span>Stale {status.analysisQueueSummary.staleProcessing}</span>
              </div>
              <div className="proof-grid ops-status-grid">
                {Object.entries(status.analysisQueueSummary.counts).map(([key, value]) => (
                  <StatusItem key={key} label={queueLabel(key)} value={String(value)} />
                ))}
              </div>
              {status.analysisQueueAlerts?.length ? (
                <ul className="ops-alert-list" aria-label="Queue alerts">
                  {status.analysisQueueAlerts.map((alert) => (
                    <li key={`${alert.code}:${alert.metric}`}>
                      <strong>{alert.severity}</strong>
                      <span>{alert.code} · {alert.metric} {alert.count}/{alert.threshold}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">No aggregate queue alert reported.</p>
              )}
            </>
          ) : (
            <p className="muted small">Queue summary appears only when queue storage is enabled and configured.</p>
          )}
        </article>

        <article className="card ops-wide-card">
          <div className="card-title-row">
            <h2>Dead Letter Summary</h2>
            <Activity size={18} aria-hidden="true" />
          </div>
          {deadLetter ? (
            deadLetter.status === "disabled" ? (
              <p className="muted small">Analysis queue is disabled.</p>
            ) : deadLetter.summary ? (
              <>
                <div className="tenant-rollup-row">
                  <span>Sampled {deadLetter.summary.sampled}</span>
                  <span>Terminal {deadLetter.summary.sampledTerminalCount}</span>
                  {deadLetter.opsStatus ? <span>Status {deadLetter.opsStatus.state}</span> : null}
                  <span>{deadLetter.summary.truncated ? "Truncated" : "Complete sample"}</span>
                </div>
                {deadLetter.opsStatus?.alerts.length ? (
                  <ul className="ops-alert-list" aria-label="Dead-letter ops alerts">
                    {deadLetter.opsStatus.alerts.map((alert) => (
                      <li key={`${alert.code}:${alert.metric}`}>
                        <strong>{alert.severity}</strong>
                        <span>{alert.code} · {alert.metric} {alert.count}/{alert.threshold}</span>
                        <span>{alert.nextAction}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {deadLetter.summary.topErrorCodes.length > 0 ? (
                  <ul className="ops-alert-list" aria-label="Dead-letter error codes">
                    {deadLetter.summary.topErrorCodes.map((item) => (
                      <li key={item.errorCode}>
                        <strong>{item.errorCode}</strong>
                        <span>{item.count}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">No terminal failures in the recent sample.</p>
                )}
              </>
            ) : (
              <p className="muted small">Dead-letter summary is not ready.</p>
            )
          ) : (
            <p className="muted small">Load the dead-letter summary to see aggregate terminal failure codes.</p>
          )}
        </article>

        <article className="card ops-wide-card">
          <div className="card-title-row">
            <h2>Tenant Deletion Plan</h2>
            <ShieldCheck size={18} aria-hidden="true" />
          </div>
          {deletionPlan ? (
            <>
              <div className="tenant-rollup-row">
                <span>Known {deletionPlan.totals.knownCount}</span>
                <span>Unavailable {deletionPlan.totals.unavailableCategories}</span>
                <span>Next {deletionPlan.next}</span>
              </div>
              <ul className="tenant-deletion-list">
                {deletionPlan.actions.map((action) => (
                  <li key={action.key}>
                    <div>
                      <strong>{action.key}</strong>
                      <span>{action.reason}</span>
                      {action.counts ? (
                        <span>
                          Active {action.counts.activeJobs ?? 0} · Queued {action.counts.queuedJobs ?? 0} · Retry {action.counts.retryingJobs ?? 0}
                        </span>
                      ) : null}
                    </div>
                    <span className={`tenant-deletion-status status-${action.status}`}>
                      {action.status}{typeof action.count === "number" ? ` · ${action.count}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="muted small">This panel does not expose purge controls. It renders the internal execution plan only.</p>
            </>
          ) : (
            <p className="muted small">Enter a tenant id and load the metadata-only deletion plan.</p>
          )}
        </article>
      </div>
    </section>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="proof-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    cache: "no-store"
  });
  const json = await response.json() as T & { error?: string; code?: string };

  if (!response.ok) {
    throw new OpsPanelRequestError(json.error ?? "Request failed.", json.code);
  }

  return json as T;
}

function errorMessage(error: unknown, fallback: string): { kind: "error"; text: string; code?: string } {
  if (error instanceof OpsPanelRequestError) {
    return { kind: "error", text: error.message, code: error.code };
  }

  return { kind: "error", text: error instanceof Error ? error.message : fallback };
}

function queueLabel(value: string): string {
  return value.replace(/_/g, " ");
}

class OpsPanelRequestError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "OpsPanelRequestError";
  }
}
