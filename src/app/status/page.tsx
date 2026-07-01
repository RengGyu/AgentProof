import Link from "next/link";
import { Activity, AlertTriangle, CreditCard, FileCheck2, HelpCircle, MessageSquareWarning, ShieldCheck } from "lucide-react";

const statusAreas = [
  {
    area: "GitHub App setup",
    state: "bounded-status",
    detail: "Use tenant setup and repository health to confirm installation access, grant state, first-report readiness, rate limits, large PR caps, and unavailable checks."
  },
  {
    area: "Evidence reports",
    state: "evidence-aware",
    detail: "Reports should keep missing CI, unavailable checks, weak proof, missing tests, and scope creep visible instead of treating unavailable evidence as verified."
  },
  {
    area: "Summary links and audit export",
    state: "summary-only",
    detail: "Saved reports and audit exports are bounded metadata surfaces. Raw diffs, logs, evidence indexes, claims, and raw re-prompt text are not recovered from durable storage."
  },
  {
    area: "Slack summaries",
    state: "opt-in-gated",
    detail: "Slack delivery requires tenant grant, repo opt-in, plan, quota, billing beta, server configuration, and durable audit gates."
  }
] as const;

const supportRoutes = [
  {
    label: "Setup blocker",
    code: "setup_blocker",
    evidence: "Visible setup status, repository health, first-report readiness, queue, quota, and billing beta summaries."
  },
  {
    label: "Report usefulness",
    code: "report_usefulness",
    evidence: "Summary-only report id or link plus the confusing requirement, missing proof, missing test, scope signal, or re-prompt."
  },
  {
    label: "Privacy or retention",
    code: "privacy_or_retention",
    evidence: "Tenant label and whether the question concerns saved summaries, audit metadata, deletion preview, or guarded deletion execution."
  },
  {
    label: "Incident or status",
    code: "incident_or_status",
    evidence: "Customer-visible symptom, timestamp window, affected product area, and any public status note."
  }
] as const;

const incidentStates = [
  {
    state: "watch",
    meaning: "One product area has degraded metadata or delayed evidence collection, but reports can still complete with clear unavailable evidence labels."
  },
  {
    state: "degraded",
    meaning: "A design partner cannot reliably generate first reports, summary links, Slack summaries, or audit exports."
  },
  {
    state: "incident",
    meaning: "Multiple tenants or a launch-critical path is blocked, privacy scanner fails, production smoke repeatedly fails, or deletion/restore evidence contradicts launch readiness."
  }
] as const;

const forbiddenSupportData = [
  "raw diffs",
  "full logs",
  "webhook payloads",
  "report bodies",
  "tokens",
  "provider ids",
  "payment method data",
  "table names",
  "environment variable names",
  "service internals"
] as const;

export default function StatusPage() {
  return (
    <main className="shared-layout">
      <header className="integration-head">
        <div>
          <h1>Status And Support</h1>
          <p>
            A summary-only support entry point for setup blockers, report usefulness feedback, privacy questions, and incident updates.
          </p>
          <p className="muted small">
            This page is a public support boundary. It does not expose live tenant data, repository names, raw errors, provider ids, table names, tokens, or service configuration.
          </p>
        </div>
        <div className="integration-head-actions">
          <Link className="button" href="/billing">
            <CreditCard size={16} />
            Billing
          </Link>
          <Link className="button" href="/integrations">
            <Activity size={16} />
            Integrations
          </Link>
          <Link className="button" href="/">
            Back
          </Link>
        </div>
      </header>

      <section className="card status-boundary-card">
        <div className="card-title-row">
          <div>
            <h2>Current Public Boundary</h2>
            <p className="muted">
              AgentProof support is evidence-based. When proof is missing, unavailable, or incomplete, the customer-facing answer should say `unclear`.
            </p>
          </div>
          <ShieldCheck size={18} aria-hidden="true" />
        </div>
        <div className="status-support-strip" aria-label="Public support boundary">
          <span>evidence reports</span>
          <span>verification</span>
          <span>requirement coverage</span>
          <span>missing proof</span>
          <span>scope creep</span>
          <span>re-prompt</span>
          <span>grounded findings</span>
        </div>
      </section>

      <section className="integration-grid">
        {statusAreas.map((item) => (
          <article className="card" key={item.area}>
            <div className="card-title-row">
              <h2>{item.area}</h2>
              <span className="status-chip">{item.state}</span>
            </div>
            <p className="muted">{item.detail}</p>
          </article>
        ))}
      </section>

      <section className="integration-grid">
        <article className="card">
          <div className="card-title-row">
            <h2>Support Intake</h2>
            <HelpCircle size={18} aria-hidden="true" />
          </div>
          <p className="muted">
            Route customer messages by bounded support tags and customer-visible evidence. Do not ask customers to lower privacy boundaries to speed up support.
          </p>
          <div className="mode-map">
            {supportRoutes.map((route) => (
              <div className="mode-card" key={route.code}>
                <strong>{route.label}</strong>
                <span>{route.code}</span>
                <span>{route.evidence}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <div className="card-title-row">
            <h2>Incident States</h2>
            <MessageSquareWarning size={18} aria-hidden="true" />
          </div>
          <p className="muted">
            Use severity for routing only. Public updates should describe affected product area, coarse impact, current state, workaround, and next update.
          </p>
          <div className="mode-map">
            {incidentStates.map((item) => (
              <div className="mode-card" key={item.state}>
                <strong>{item.state}</strong>
                <span>{item.meaning}</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="card status-boundary-card">
        <div className="card-title-row">
          <div>
            <h2>Do Not Send Through Support</h2>
            <p className="muted">
              Support should work from bounded metadata, documentation anchors, customer-visible status, and explicit unavailable evidence statements.
            </p>
          </div>
          <AlertTriangle size={18} aria-hidden="true" />
        </div>
        <ul className="status-token-list" aria-label="Support intake exclusions">
          {forbiddenSupportData.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="card status-boundary-card">
        <div className="card-title-row">
          <div>
            <h2>Pre-Public Gaps</h2>
            <p className="muted">
              This is a bounded public support surface. Hosted status automation, customer support tooling, public billing pages, service-level commitments, and URL-backed market claims remain separate launch work.
            </p>
          </div>
          <FileCheck2 size={18} aria-hidden="true" />
        </div>
      </section>
    </main>
  );
}
