import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { PublicGitHubDashboard } from "@/components/PublicGitHubDashboard";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ installation?: string }> }) {
  const params = await searchParams;
  return <main className="shared-layout">
    <header className="integration-head"><div><h1>AgentProof Dashboard</h1><p>Connect a GitHub repository and review grounded PR evidence reports.</p></div><Link className="button" href="/"><ArrowLeft size={16} /> Workspace</Link></header>
    <PublicGitHubDashboard installationId={params.installation} />
    <section className="card tenant-boundary-card"><h2>Privacy boundary</h2><p className="muted small">AgentProof retains refined report fields needed for verification, not OAuth tokens, raw diffs, full logs, or raw GitHub API responses. Only the signed-in repository owner can open its reports.</p><ShieldCheck size={18} aria-hidden="true" /></section>
  </main>;
}
