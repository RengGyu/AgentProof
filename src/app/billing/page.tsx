import Link from "next/link";
import { CreditCard, FileCheck2, GitBranch, LockKeyhole, ShieldCheck, SlidersHorizontal } from "lucide-react";

const planPackages = [
  {
    name: "Free/demo",
    scope: "Public PR analysis, demo scenarios, and limited saved summary links.",
    boundary: "No private repository automation or billing provider state."
  },
  {
    name: "Team",
    scope: "Private repository verification, GitHub App installation, summary history, Slack summaries, marker comments, and monthly PR-analysis quota.",
    boundary: "Feature access is gated by tenant grant, plan, quota, billing beta status, and side-effect audit."
  },
  {
    name: "Pro/Org",
    scope: "Higher quota, more connected repositories, audit export, retention controls for summary-only reports, priority support, and stronger admin controls.",
    boundary: "Advanced controls stay summary-only and must not expose provider, payment, or raw evidence data."
  }
] as const;

const billingSignals = [
  {
    label: "Plan label",
    detail: "Shown as a coarse package label such as free, team, or pro. It is not treated as billing truth by itself."
  },
  {
    label: "Subscription status",
    detail: "Shown as a coarse billing beta state such as active, trialing, past due, canceled, paused, incomplete, or unknown."
  },
  {
    label: "Quota summary",
    detail: "Shows monthly PR-analysis limit, used count, remaining count, configured state, and whether quota is enforced."
  },
  {
    label: "Feature gates",
    detail: "Shows whether evidence reports, connected repositories, saved summaries, marker comments, Slack summaries, and structured verifier access are enabled."
  },
  {
    label: "Portal boundary",
    detail: "Can say that a server redirect is required when the provider-backed portal boundary is available. This page does not create portal sessions."
  },
  {
    label: "Webhook idempotency",
    detail: "Can show whether provider webhook idempotency is configured without exposing provider event identifiers or raw webhook payloads."
  }
] as const;

const blockedBeforeWork = [
  "GitHub installation token fetch",
  "PR evidence fetch",
  "OpenAI verifier calls",
  "summary report saves",
  "marker comments",
  "Slack summaries"
] as const;

const privateBillingData = [
  "provider customer ids",
  "provider subscription ids",
  "price ids",
  "invoice ids",
  "payment method data",
  "card fields",
  "provider event ids",
  "raw provider responses",
  "raw webhook bodies",
  "service-role keys"
] as const;

export default function BillingPage() {
  return (
    <main className="shared-layout">
      <header className="integration-head">
        <div>
          <h1>Billing Beta Boundary</h1>
          <p>
            Plan, quota, and billing beta status for evidence report access without exposing provider or payment data.
          </p>
          <p className="muted small">
            This is a product boundary page. It does not create subscriptions, collect payment method data, open provider portal sessions, or publish pricing claims.
          </p>
        </div>
        <div className="integration-head-actions">
          <Link className="button" href="/tenant">
            <SlidersHorizontal size={16} />
            Tenant
          </Link>
          <Link className="button" href="/status">
            <FileCheck2 size={16} />
            Status
          </Link>
          <Link className="button" href="/">
            Back
          </Link>
        </div>
      </header>

      <section className="card status-boundary-card">
        <div className="card-title-row">
          <div>
            <h2>Customer-Facing Billing Shape</h2>
            <p className="muted">
              Billing surfaces should show bounded plan and usage summaries. If billing evidence cannot be collected, say unavailable or not configured instead of inferring state from account labels, quota rows, or repository grants.
            </p>
          </div>
          <CreditCard size={18} aria-hidden="true" />
        </div>
      </section>

      <section className="integration-grid">
        {planPackages.map((plan) => (
          <article className="card" key={plan.name}>
            <div className="card-title-row">
              <h2>{plan.name}</h2>
              <ShieldCheck size={18} aria-hidden="true" />
            </div>
            <p className="muted">{plan.scope}</p>
            <div className="notice">
              <p>{plan.boundary}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="integration-grid">
        <article className="card">
          <div className="card-title-row">
            <h2>Allowed Signals</h2>
            <GitBranch size={18} aria-hidden="true" />
          </div>
          <div className="mode-map">
            {billingSignals.map((item) => (
              <div className="mode-card" key={item.label}>
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <div className="card-title-row">
            <h2>Blocked Before Provider Work</h2>
            <LockKeyhole size={18} aria-hidden="true" />
          </div>
          <p className="muted">
            When billing beta or quota gates block a tenant, automation should stop before expensive evidence collection or side effects.
          </p>
          <ul className="status-token-list" aria-label="Billing and quota pre-work blocks">
            {blockedBeforeWork.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="card status-boundary-card">
        <div className="card-title-row">
          <div>
            <h2>Never Show In Customer Surfaces</h2>
            <p className="muted">
              Billing data stays separate from report evidence data. Customer-facing APIs, dashboards, comments, Slack summaries, saved reports, audit exports, and support screenshots must avoid these values.
            </p>
          </div>
          <LockKeyhole size={18} aria-hidden="true" />
        </div>
        <ul className="status-token-list" aria-label="Billing private data exclusions">
          {privateBillingData.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="card status-boundary-card">
        <div className="card-title-row">
          <div>
            <h2>Still Separate Launch Work</h2>
            <p className="muted">
              Public self-serve signup, provider checkout, customer portal session creation, durable payment pages, seat billing, provider webhook signature parsing, billing retention execution, and URL-backed market claims remain separate work.
            </p>
          </div>
          <FileCheck2 size={18} aria-hidden="true" />
        </div>
      </section>
    </main>
  );
}
