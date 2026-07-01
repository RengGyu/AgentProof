import Link from "next/link";
import { ArrowLeft, Plug, ShieldCheck } from "lucide-react";
import { TenantSetupPanel } from "@/components/TenantSetupPanel";

export default function TenantDashboardPage() {
  return (
    <main className="shared-layout">
      <header className="integration-head">
        <div>
          <h1>Tenant Dashboard</h1>
          <p>Invite-only GitHub App activation, repository grants, and setup health for evidence reports.</p>
          <p className="muted small">
            This beta surface keeps invite tokens in the current form only and exchanges repository metadata through server endpoints.
          </p>
        </div>
        <div className="integration-head-actions">
          <Link className="button" href="/">
            <ArrowLeft size={16} />
            Workspace
          </Link>
          <Link className="button" href="/integrations">
            <Plug size={16} />
            Readiness
          </Link>
        </div>
      </header>

      <TenantSetupPanel />

      <section className="card tenant-boundary-card">
        <div className="card-title-row">
          <h2>Beta Boundary</h2>
          <ShieldCheck size={18} aria-hidden="true" />
        </div>
        <ul className="plain-list">
          <li>Repository settings are limited to grant status, analysis, summary links, and marker comments.</li>
          <li>Health probes check bounded repository metadata and optional first-report readiness only after an explicit button press.</li>
          <li>This dashboard does not render PR evidence, diffs, logs, claims, report bodies, raw re-prompts, or merge decisions.</li>
        </ul>
      </section>
    </main>
  );
}
