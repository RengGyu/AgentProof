import Link from "next/link";

const rows = [
  {
    name: "GitHub App webhook",
    purpose: "Dry-run only: verify signed GitHub pull_request/check/status events before future automated analysis. No automatic comments or analysis are triggered.",
    requiredEnv: ["GITHUB_WEBHOOK_SECRET"],
    optionalEnv: ["GITHUB_APP_ID", "GITHUB_PRIVATE_KEY"]
  },
  {
    name: "Slack notifications",
    purpose: "Send summary-only evidence cards to a trusted Slack incoming webhook.",
    requiredEnv: ["SLACK_WEBHOOK_URL", "AGENTPROOF_NOTIFY_TOKEN"]
  },
  {
    name: "OpenAI verifier",
    purpose: "Run an optional structured-output verifier after the deterministic report.",
    requiredEnv: ["OPENAI_API_KEY", "AGENTPROOF_LLM_TOKEN"],
    optionalEnv: ["OPENAI_MODEL"]
  },
  {
    name: "Server saved reports",
    purpose: "Summary-only saved report API. Uses in-memory demo storage by default, or Supabase REST when server credentials are configured.",
    requiredEnv: ["None for demo mode"],
    optionalEnv: [
      "AGENTPROOF_REPORTS_SUPABASE_URL or SUPABASE_URL",
      "AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY",
      "AGENTPROOF_REPORTS_TABLE"
    ]
  }
];

export default function IntegrationsPage() {
  return (
    <main className="shared-layout">
      <header className="integration-head">
        <div>
          <h1>Integration Readiness</h1>
          <p>Live credentials are intentionally disabled unless the required environment variables are present.</p>
          <p className="muted small">
            Last production smoke: 2026-06-29. Supabase, OpenAI, Slack, signed webhook, and explicit GitHub comment paths were verified without exposing secret values.
          </p>
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

      <section className="card">
        <h2>GitHub App Boundary</h2>
        <p className="muted">
          Public readiness pages do not expose live secret configuration. The webhook endpoint verifies signatures and returns bounded metadata only.
        </p>
        <ul className="plain-list">
          <li>Signed intake requires <code>GITHUB_WEBHOOK_SECRET</code>.</li>
          <li>
            Future App automation additionally requires <code>GITHUB_APP_ID</code> and a valid{" "}
            <code>GITHUB_PRIVATE_KEY</code>.
          </li>
          <li>Automation ready: no</li>
          <li>Automatic comments and analysis remain disabled.</li>
        </ul>
      </section>
    </main>
  );
}
