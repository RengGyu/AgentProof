import { AnalyzeWorkspace } from "@/components/AnalyzeWorkspace";
import { demoScenarios } from "@/lib/sample-data";
import { generateVerificationReport } from "@/lib/verifier";

export default function Home() {
  const initialReport = generateVerificationReport(demoScenarios["scope-creep"]);

  return <AnalyzeWorkspace initialReport={initialReport} />;
}
