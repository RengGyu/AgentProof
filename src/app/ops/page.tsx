import Link from "next/link";
import { ArrowLeft, Plug, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { OpsDashboardPanel } from "@/components/OpsDashboardPanel";

export default function OpsDashboardPage() {
  return (
    <main className="shared-layout">
      <header className="integration-head">
        <div>
          <h1>Operator Dashboard</h1>
          <p>Token-gated readiness, queue, and dead-letter summaries for AgentProof automation.</p>
          <p className="muted small">
            This surface renders bounded metadata only and keeps the operator token in the current form state.
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
          <Link className="button" href="/tenant">
            <SlidersHorizontal size={16} />
            Tenant
          </Link>
        </div>
      </header>

      <OpsDashboardPanel />

      <section className="card tenant-boundary-card">
        <div className="card-title-row">
          <h2>Operator Boundary</h2>
          <ShieldCheck size={18} aria-hidden="true" />
        </div>
        <ul className="plain-list">
          <li>Use this page for setup diagnosis and aggregate queue health, not PR review.</li>
          <li>It does not render repository names, tenant ids, job rows, reports, diffs, logs, claims, or comment bodies.</li>
          <li>Side-effecting worker, Slack, and deletion actions remain separate operator endpoints.</li>
        </ul>
      </section>
    </main>
  );
}
