import { AnalyzeWorkspace } from "@/components/AnalyzeWorkspace";

export default async function AnalyzePage({ searchParams }: { searchParams: Promise<{ launch?: string }> }) {
  const params = await searchParams;
  const launchNonce = typeof params.launch === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(params.launch)
    ? params.launch : undefined;
  return <AnalyzeWorkspace key={launchNonce ?? "manual"} launchNonce={launchNonce} />;
}
