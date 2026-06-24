import Link from "next/link";
import { getGitHubAppConfigStatus } from "@/lib/github-app";

const rows = [
  {
    name: "GitHub App webhook",
    purpose: "Verify signed GitHub pull_request/check/status events before future automated analysis.",
    requiredEnv: ["GITHUB_APP_ID", "GITHUB_PRIVATE_KEY", "GITHUB_WEBHOOK_SECRET"]
  },
  {
    name: "Slack notifications",
    purpose: "Send summary-only evidence cards to a trusted Slack incoming webhook.",
    requiredEnv: ["SLACK_WEBHOOK_URL", "AGENTPROOF_NOTIFY_TOKEN"]
  },
  {
    name: "OpenAI verifier",
    purpose: "Run an optional structured-output verifier after the deterministic report.",
    requiredEnv: ["OPENAI_API_KEY", "AGENTPROOF_LLM_TOKEN", "OPENAI_MODEL"]
  },
  {
    name: "Server saved reports",
    purpose: "Short-lived summary-only saved report API. Durable production storage still needs a database.",
    requiredEnv: ["DATABASE_URL or Supabase credentials for production"]
  }
];

export default function IntegrationsPage() {
  const github = getGitHubAppConfigStatus();

  return (
    <main className="shared-layout">
      <header className="integration-head">
        <div>
          <h1>Integration Readiness</h1>
          <p>Live credentials are intentionally disabled unless the required environment variables are present.</p>
        </div>
        <Link className="button" href="/">
          Back
        </Link>
      </header>

      <section className="integration-grid">
        {rows.map((row) => (
          <article className="card" key={row.name}>
            <h2>{row.name}</h2>
            <p className="muted">{row.purpose}</p>
            <h3>Required env</h3>
            <ul className="plain-list">
              {row.requiredEnv.map((envName) => (
                <li key={envName}>{envName}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section className="card">
        <h2>Current GitHub App Config</h2>
        <ul className="plain-list">
          <li>App ID: {github.appIdConfigured ? "configured" : "missing"}</li>
          <li>Private key: {github.privateKeyConfigured ? "configured" : "missing"}</li>
          <li>Webhook secret: {github.webhookSecretConfigured ? "configured" : "missing"}</li>
          <li>Ready: {github.ready ? "yes" : "no"}</li>
        </ul>
      </section>
    </main>
  );
}
