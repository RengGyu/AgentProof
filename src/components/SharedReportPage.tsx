"use client";

import { AlertTriangle, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { ReportView } from "@/components/ReportView";
import { decodeSharedReport } from "@/lib/report-share";
import type { VerificationReport } from "@/lib/types";

export function SharedReportPage() {
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const payload = params.get("report");

      if (!payload) {
        setError("Shared report payload was not found.");
        return;
      }

      setReport(decodeSharedReport(payload));
    } catch {
      setError("Shared report payload could not be opened.");
    }
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <ShieldCheck size={18} />
          </div>
          <span>AgentProof</span>
        </div>
      </header>
      <div className="shared-layout">
        {report ? (
          <>
            <div className="notice" role="status">
              Imported / unverified portable summary. It is not a server-verified AgentProof artifact and omits raw evidence.
            </div>
            <ReportView report={report} mode="summary" />
          </>
        ) : (
          <section className="panel empty-state">
            <div>
              <AlertTriangle size={36} />
              <h1>Shared report unavailable</h1>
              <p>{error ?? "Opening shared report."}</p>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
