import { PublicGitHubDashboard } from "@/components/PublicGitHubDashboard";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ installation?: string }> }) {
  const params = await searchParams;
  return <PublicGitHubDashboard installationId={params.installation} />;
}
