"use client";

import { AlertCircle, CheckCircle2, Clipboard, ClipboardList, Download, FileWarning, Gauge, GitCommitVertical, TestTube2 } from "lucide-react";
import { useMemo, useState } from "react";
import { reportToMarkdown } from "@/lib/markdown";
import type { CheckStatus, PriorityLevel, RequirementStatus, VerificationReport } from "@/lib/types";

interface ReportViewProps {
  report: VerificationReport;
}

export function ReportView({ report }: ReportViewProps) {
  const markdown = useMemo(() => reportToMarkdown(report), [report]);
  const evidenceById = useMemo(
    () => new Map(report.evidenceIndex.map((item) => [item.id, item])),
    [report.evidenceIndex]
  );
  const [copied, setCopied] = useState(false);

  async function copyMarkdown() {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function downloadMarkdown() {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "agentproof-report.md";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="report">
      <div className="panel summary-card">
        <div className="summary-head">
          <div className="summary-title">
            <h1>{report.source.title}</h1>
            <p>{report.summary.oneLine}</p>
          </div>
          <PriorityChip priority={report.summary.priority} />
        </div>

        <div className="report-actions" aria-label="Report export actions">
          <button className="button compact" onClick={copyMarkdown}>
            {copied ? <CheckCircle2 size={15} /> : <Clipboard size={15} />}
            {copied ? "Copied" : "Copy Markdown"}
          </button>
          <button className="button compact" onClick={downloadMarkdown}>
            <Download size={15} />
            Download
          </button>
        </div>

        <div className="metric-grid">
          <Metric label="Coverage" value={`${report.summary.evidenceCoverage}%`} icon={<Gauge size={17} />} />
          <Metric label="Confidence" value={`${Math.round(report.summary.confidence * 100)}%`} icon={<CheckCircle2 size={17} />} />
          <Metric label="CI" value={report.testing.ciStatus} icon={<GitCommitVertical size={17} />} tone={statusClass(report.testing.ciStatus)} />
          <Metric label="Missing Tests" value={String(report.testing.missingTests.length)} icon={<TestTube2 size={17} />} />
        </div>
      </div>

      <div className="grid-two">
        <div className="stack">
          <div className="card">
            <h2>Requirement Coverage</h2>
            {report.requirements.map((requirement) => (
              <div className="requirement" key={requirement.requirementId}>
                <StatusChip status={requirement.status} />
                <div className="requirement-body">
                  <p>{requirement.requirementText}</p>
                  <p className="muted small">{requirement.reviewerNote}</p>
                  {requirement.gaps.length > 0 ? (
                    <ul className="plain-list">
                      {requirement.gaps.map((gap) => (
                        <li key={gap}>{gap}</li>
                      ))}
                    </ul>
                  ) : null}
                  {requirement.evidenceRefs.length > 0 ? (
                    <div className="evidence-ref-block">
                      <span className="evidence-label">Cited evidence</span>
                      <ul className="evidence-list compact-list">
                        {requirement.evidenceRefs.map((ref) => {
                          const evidence = evidenceById.get(ref);

                          return (
                            <li key={ref}>
                              <span className="evidence-label">
                                {ref}
                                {evidence ? ` - ${evidence.kind} - ${evidence.label}` : ""}
                              </span>
                              {evidence?.summary ?? "Evidence item was not found in this report."}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <h2>Agent Claims</h2>
            {report.claims.length > 0 ? (
              <ul className="plain-list">
                {report.claims.map((claim) => (
                  <li key={claim.id}>
                    <span className={claim.supported ? "evidence-label status-met" : "evidence-label status-unclear"}>
                      {claim.supported ? "SUPPORTED" : "UNPROVEN"} - {claim.id}
                    </span>
                    {claim.text}
                    {claim.evidenceRefs.length > 0 ? (
                      <span className="muted small"> Evidence: {claim.evidenceRefs.join(", ")}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">No explicit implementation claims were found in the PR description.</p>
            )}
          </div>

          <div className="card">
            <h2>Review Priority</h2>
            <ul className="plain-list">
              {report.reviewPriority.map((item) => (
                <li key={`${item.path}-${item.reason}`}>
                  <span className={`evidence-label priority-${item.priority}`}>{item.priority.toUpperCase()} - {item.path}</span>
                  {item.reason}
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <h2>Evidence Index</h2>
            <ul className="evidence-list">
              {report.evidenceIndex.slice(0, 12).map((item) => (
                <li key={item.id}>
                  <span className="evidence-label">
                    {item.id} - {item.kind} - {item.label}
                  </span>
                  {item.summary}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <h2>Top Risks</h2>
            <ul className="plain-list">
              {report.summary.topRisks.map((risk) => (
                <li key={risk}>
                  <AlertCircle size={14} /> {risk}
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <h2>Scope</h2>
            {report.scope.suspected ? (
              <ul className="plain-list">
                {report.scope.reasons.map((reason) => (
                  <li key={reason}>
                    <FileWarning size={14} /> {reason}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">No out-of-scope file cluster found from available evidence.</p>
            )}
          </div>

          <div className="card">
            <h2>Testing</h2>
            <ul className="plain-list">
              <li>CI: {report.testing.ciStatus}</li>
              <li>Lint: {report.testing.lintStatus}</li>
              <li>Typecheck: {report.testing.typecheckStatus}</li>
              {report.testing.missingTests.map((item) => (
                <li key={item.path}>{item.path}: {item.why}</li>
              ))}
            </ul>
          </div>

          <div className="card">
            <h2>Agent Re-prompt</h2>
            <pre className="reprompt">{report.reprompt.prompt}</pre>
          </div>

          <div className="card">
            <h2>Limitations</h2>
            {report.limitations.length > 0 ? (
              <ul className="plain-list">
                {report.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            ) : (
              <p className="muted small">No major data limitations detected.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  icon,
  tone
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="metric">
      <span>{icon} {label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function PriorityChip({ priority }: { priority: PriorityLevel }) {
  return <span className={`priority-chip priority-${priority}`}>{priority.toUpperCase()}</span>;
}

function StatusChip({ status }: { status: RequirementStatus }) {
  return (
    <span className={`priority-chip status-${status}`}>
      <ClipboardList size={14} />
      {status.toUpperCase()}
    </span>
  );
}

function statusClass(status: CheckStatus): string {
  return `status-${status}`;
}
