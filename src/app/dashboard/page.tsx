import { isPreviewDemoEnabled } from "@/lib/github-dashboard-view-model";
import { PublicGitHubDashboard } from "@/components/PublicGitHubDashboard";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ installation?: string; demo?: string }> }) {
  const params = await searchParams;
  return <PublicGitHubDashboard installationId={params.installation} previewDemoEnabled={isPreviewDemoEnabled(process.env.VERCEL_ENV === "preview", params.demo)} />;
}
