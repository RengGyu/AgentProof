import Link from "next/link";
import { ReportView } from "@/components/ReportView";
import { getSavedReport, SAVED_REPORT_DURABILITY_WARNING } from "@/lib/server-report-store";

interface SavedReportPageProps {
  params: Promise<{ id: string }>;
}

export default async function SavedReportPage({ params }: SavedReportPageProps) {
  const { id } = await params;
  const saved = getSavedReport(id);

  if (!saved) {
    return (
      <main className="shared-layout">
        <section className="panel empty-state">
          <h1>Report unavailable</h1>
          <p>This saved report was not found, expired, or belongs to another serverless instance.</p>
          <Link className="button primary" href="/">
            Open AgentProof
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="shared-layout">
      <div className="notice">
        {SAVED_REPORT_DURABILITY_WARNING} Expires at {saved.expiresAt}.
      </div>
      <ReportView report={saved.report} mode="summary" />
    </main>
  );
}
