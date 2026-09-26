import Link from "next/link";
import { headers } from "next/headers";
import { resolveTenantAuthAccess } from "@/lib/tenant-auth";
import { ReportView } from "@/components/ReportView";
import { getSavedReport, getSavedReportStoreStatus, SavedReportStoreError } from "@/lib/server-report-store";

interface SavedReportPageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ key?: string; reportKey?: string }>;
}

export default async function SavedReportPage({ params, searchParams }: SavedReportPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const key = query?.key ?? query?.reportKey;
  let saved;

  try {
    const production = process.env.NODE_ENV === "production";
    const access = production || !key ? await resolveTenantAuthAccess({ cookieHeader: (await headers()).get("cookie") }) : null;
    const tenantId = access?.authorized ? access.tenantId : undefined;
    saved = production && !tenantId ? null : await getSavedReport(id, production ? { tenantId } : key ? { accessToken: key.slice(0, 200) } : tenantId ? { tenantId } : {});
    if (production && saved?.tenantId !== tenantId) saved = null;
  } catch (error) {
    if (error instanceof SavedReportStoreError) {
      saved = null;
    } else {
      throw error;
    }
  }

  const status = getSavedReportStoreStatus();

  if (!saved) {
    return (
      <main className="shared-layout">
        <section className="panel empty-state">
          <h1>Report unavailable</h1>
          <p>This saved report was not found, expired, or is temporarily unavailable.</p>
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
        {saved.report.authenticity?.trust === "verified_agentproof"
          ? "Server-verified AgentProof summary."
          : "Imported / unverified summary. Do not treat it as a server-verified AgentProof artifact."} {status.durabilityWarning} Expires at {saved.expiresAt}.
      </div>
      <ReportView report={saved.report} mode="summary" />
    </main>
  );
}
