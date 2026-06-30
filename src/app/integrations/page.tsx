import Link from "next/link";
import { Bell, Bot, Database, FileCheck2, GitPullRequest, KeyRound, ShieldCheck, SlidersHorizontal, Wrench } from "lucide-react";
import { getPublicGitHubAppReadinessStatus } from "@/lib/github-app";

const rows = [
  {
    name: "GitHub App webhook",
    icon: GitPullRequest,
    purpose: "Verify signed GitHub events. PR webhook analysis is available only after explicit repo allowlist opt-in; automatic comments stay separately opt-in.",
    requiredEnv: ["GITHUB_WEBHOOK_SECRET"],
    optionalEnv: [
      "GITHUB_APP_ID",
      "GITHUB_PRIVATE_KEY",
      "AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED",
      "AGENTPROOF_GITHUB_APP_ALLOWED_REPOS",
      "AGENTPROOF_GITHUB_APP_SAVE_REPORTS",
      "AGENTPROOF_GITHUB_APP_COMMENT_ENABLED",
      "AGENTPROOF_GITHUB_WEBHOOK_DELIVERIES_TABLE",
      "AGENTPROOF_GITHUB_WEBHOOK_SUPABASE_URL",
      "AGENTPROOF_GITHUB_WEBHOOK_SUPABASE_SERVICE_ROLE_KEY",
      "AGENTPROOF_GITHUB_INSTALLATIONS_TABLE",
      "AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_URL",
      "AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_SERVICE_ROLE_KEY"
    ]
  },
  {
    name: "Slack notifications",
    icon: Bell,
    purpose: "Send summary-only evidence cards to a trusted Slack incoming webhook.",
    requiredEnv: ["SLACK_WEBHOOK_URL", "AGENTPROOF_NOTIFY_TOKEN"]
  },
  {
    name: "OpenAI verifier",
    icon: Bot,
    purpose: "Run an optional structured-output verifier after the deterministic report.",
    requiredEnv: ["OPENAI_API_KEY", "AGENTPROOF_LLM_TOKEN"],
    optionalEnv: ["OPENAI_MODEL"]
  },
  {
    name: "Server saved reports",
    icon: Database,
    purpose: "Summary-only saved report API. Uses in-memory demo storage by default, or Supabase REST when server credentials are configured.",
    requiredEnv: ["None for demo mode"],
    optionalEnv: [
      "AGENTPROOF_REPORTS_SUPABASE_URL or SUPABASE_URL",
      "AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY",
      "AGENTPROOF_REPORTS_TABLE"
    ]
  },
  {
    name: "Analysis job queue",
    icon: FileCheck2,
    purpose: "Optional metadata-only queue boundary for GitHub App PR analysis. Operator-gated worker endpoints can preflight, run one due job, drain a small bounded batch, or run through the token-gated Vercel Cron route.",
    requiredEnv: ["None when queue mode is disabled"],
    optionalEnv: [
      "AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED",
      "AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL or SUPABASE_URL",
      "AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY",
      "AGENTPROOF_ANALYSIS_JOBS_TABLE"
    ]
  }
];

const modeCards = [
  {
    mode: "manual",
    title: "Manual mode",
    body: "Reviewers use PR URLs, pasted evidence, or demo scenarios. Signed webhook automation is not publicly reported as ready."
  },
  {
    mode: "signed-intake",
    title: "Signed intake",
    body: "GitHub webhook signatures can be verified, but PR events remain bounded intake unless automation is explicitly enabled."
  },
  {
    mode: "event-mode",
    title: "Event mode",
    body: "Allowlisted PR events can generate evidence reports. Comments, saved links, and Slack delivery remain separate opt-ins."
  }
] as const;

const safetyChecks = [
  "Use a one-repository allowlist before event-mode testing.",
  "Keep automatic comments and saved reports off for live smoke checks.",
  "Use durable queue storage before moving webhook analysis off the request path.",
  "Use durable GitHub installation metadata storage before beta onboarding.",
  "Store only hashed duplicate keys and bounded metadata for webhook deliveries.",
  "Restore signed-intake after controlled production checks."
];

const operatorDiagnostics = [
  { label: "Endpoint", value: "/api/ops/github-app/status" },
  { label: "Required env", value: "AGENTPROOF_OPS_TOKEN" },
  { label: "Header", value: "x-agentproof-ops-token" },
  { label: "Returned data", value: "status enums only" }
];

export default function IntegrationsPage() {
  const githubApp = getPublicGitHubAppReadinessStatus();

  return (
    <main className="shared-layout">
      <header className="integration-head">
        <div>
          <h1>Integration Readiness</h1>
          <p>Live credentials are intentionally disabled unless the required environment variables are present.</p>
          <p className="muted small">
            This page shows coarse runtime status only. Dated smoke evidence is recorded separately and is not treated as live readiness.
          </p>
        </div>
        <div className="integration-head-actions">
          <Link className="button" href="/ops">
            <Wrench size={16} />
            Ops
          </Link>
          <Link className="button" href="/tenant">
            <SlidersHorizontal size={16} />
            Tenant Dashboard
          </Link>
          <Link className="button" href="/">
            Back
          </Link>
        </div>
      </header>

      <section className="integration-grid">
        <article className="card integration-status-card">
          <div className="card-title-row">
            <h2>GitHub App Status</h2>
            <span className="status-chip">{githubApp.label}</span>
          </div>
          <p className="muted">{githubApp.description}</p>
          <ul className="plain-list compact-list">
            {githubApp.capabilities.map((capability) => (
              <li key={capability}>{capability}</li>
            ))}
          </ul>
          <div className="notice integration-warning">
            {githubApp.cautions.map((caution) => (
              <p key={caution}>{caution}</p>
            ))}
          </div>
        </article>

        <article className="card integration-status-card">
          <div className="card-title-row">
            <h2>Mode Map</h2>
            <ShieldCheck size={18} aria-hidden="true" />
          </div>
          <div className="mode-map" aria-label="GitHub App operating modes">
            {modeCards.map((item) => (
              <div className={item.mode === githubApp.mode ? "mode-card active" : "mode-card"} key={item.mode}>
                <strong>{item.title}</strong>
                <span>{item.body}</span>
              </div>
            ))}
          </div>
        </article>

        {rows.map((row) => (
          <article className="card" key={row.name}>
            <div className="card-title-row">
              <h2>{row.name}</h2>
              <row.icon size={18} aria-hidden="true" />
            </div>
            <p className="muted">{row.purpose}</p>
            <h3>Required env</h3>
            <ul className="plain-list">
              {row.requiredEnv.map((envName) => (
                <li key={envName}>{envName}</li>
              ))}
            </ul>
            {"optionalEnv" in row && row.optionalEnv ? (
              <>
                <h3>Optional env</h3>
                <ul className="plain-list">
                  {row.optionalEnv.map((envName) => (
                    <li key={envName}>{envName}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </article>
        ))}
      </section>

      <section className="integration-grid">
        <article className="card">
          <div className="card-title-row">
            <h2>Operational Guardrails</h2>
            <KeyRound size={18} aria-hidden="true" />
          </div>
          <p className="muted">
            Public readiness pages do not expose live secret configuration. The webhook endpoint verifies signatures and returns bounded metadata only.
          </p>
          <ul className="plain-list">
            {safetyChecks.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="card">
          <div className="card-title-row">
            <h2>Operator Diagnostics</h2>
            <FileCheck2 size={18} aria-hidden="true" />
          </div>
          <p className="muted">
            Detailed readiness is token-gated for operators. It reports bounded status values without repository names, table names, tokens, or raw GitHub data.
          </p>
          <div className="proof-grid">
            {operatorDiagnostics.map((item) => (
              <div className="proof-item" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
