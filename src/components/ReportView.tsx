"use client";

import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clipboard,
  ClipboardList,
  Download,
  ExternalLink,
  FileText,
  FileWarning,
  Gauge,
  GitCommitVertical,
  Link2,
  ListChecks,
  LockKeyhole,
  MessageSquareText,
  Send,
  ShieldAlert,
  TestTube2
} from "lucide-react";
import { useMemo, useState } from "react";
import { getExecutionEvidenceItems } from "@/lib/execution-evidence";
import { reportToGitHubComment, reportToMarkdown } from "@/lib/markdown";
import { buildShareUrl } from "@/lib/report-share";
import type { CheckStatus, PriorityLevel, RequirementStatus, VerificationReport } from "@/lib/types";

interface ReportViewProps {
  report: VerificationReport;
  mode?: "full" | "summary";
}

export function ReportView({ report, mode = "full" }: ReportViewProps) {
  const isSummaryMode = mode === "summary";
  const markdown = useMemo(() => reportToMarkdown(report), [report]);
  const githubComment = useMemo(() => reportToGitHubComment(report), [report]);
  const evidenceById = useMemo(
    () => new Map(report.evidenceIndex.map((item) => [item.id, item])),
    [report.evidenceIndex]
  );
  const executionEvidence = useMemo(() => getExecutionEvidenceItems(report.evidenceIndex), [report.evidenceIndex]);
  const [copiedAction, setCopiedAction] = useState<"report" | "comment" | "reprompt" | "share" | null>(null);
  const [actionMessage, setActionMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [commentToken, setCommentToken] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [postedCommentUrl, setPostedCommentUrl] = useState<string | null>(null);
  const requirementStats = useMemo(() => {
    const counts: Record<RequirementStatus, number> = {
      met: 0,
      partial: 0,
      missing: 0,
      unclear: 0
    };

    for (const requirement of report.requirements) {
      counts[requirement.status] += 1;
    }

    return counts;
  }, [report.requirements]);
  const verificationAnswer = useMemo(
    () => getVerificationAnswer(report.summary.priority, report.summary.evidenceCoverage, report.testing.ciStatus),
    [report.summary.evidenceCoverage, report.summary.priority, report.testing.ciStatus]
  );

  async function copyText(text: string, action: "report" | "comment" | "reprompt" | "share") {
    try {
      await writeClipboardText(text);
      setCopiedAction(action);
      setActionMessage({ tone: "success", text: "Copied to clipboard." });
      window.setTimeout(() => {
        setCopiedAction(null);
        setActionMessage(null);
      }, 1800);
    } catch {
      setActionMessage({ tone: "error", text: "Copy failed in this browser. Use Download or select the text manually." });
    }
  }

  function downloadMarkdown() {
    try {
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "agentproof-report.md";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setActionMessage({ tone: "success", text: "Download started." });
      window.setTimeout(() => setActionMessage(null), 1800);
    } catch {
      setActionMessage({ tone: "error", text: "Download failed in this browser. Use Copy Report instead." });
    }
  }

  async function copyShareLink() {
    try {
      const url = buildShareUrl(report, window.location.origin);
      await copyText(url, "share");
      setActionMessage({ tone: "success", text: "Summary share link copied." });
    } catch (error) {
      setActionMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Share link could not be created."
      });
    }
  }

  async function postGitHubComment() {
    if (!report.source.url || !commentToken.trim()) {
      setActionMessage({ tone: "error", text: "PR URL and write token are required." });
      return;
    }

    setPostingComment(true);
    setActionMessage(null);

    try {
      const response = await fetch("/api/github/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prUrl: report.source.url,
          githubToken: commentToken,
          report
        })
      });
      const json = await response.json();

      if (!response.ok) {
        throw new Error(json.error ?? "GitHub comment post failed");
      }

      setPostedCommentUrl(json.url);
      setCommentToken("");
      setActionMessage({
        tone: "success",
        text: json.warning ? `GitHub comment ${json.action}. ${json.warning}` : `GitHub comment ${json.action}.`
      });
    } catch (error) {
      setActionMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "GitHub comment post failed."
      });
    } finally {
      setPostingComment(false);
    }
  }

  return (
    <section className="report">
      <div className="panel summary-card decision-card">
        <div className="summary-head">
          <div className="summary-title">
            <p className="eyebrow">Verification report</p>
            <h1>{report.source.title}</h1>
            <p>{report.summary.oneLine}</p>
          </div>
          <PriorityChip priority={report.summary.priority} />
        </div>

        {isSummaryMode ? (
          <div className="notice summary-mode-notice">
            <AlertCircle size={15} />
            <span>
              Summary-only view: raw evidence, patch/log excerpts, agent claims, evidence references, and re-prompt text are omitted.
            </span>
          </div>
        ) : null}

        <div className="decision-strip">
          <div className="decision-copy">
            <span>
              <ShieldAlert size={15} />
              Evidence answer
            </span>
            <strong>{verificationAnswer.title}</strong>
            <p>{verificationAnswer.body}</p>
          </div>
          <div className="risk-strip">
            <span className="risk-strip-title">Inspect first</span>
            <ul>
              {report.summary.topRisks.slice(0, 3).map((risk) => (
                <li key={risk}>{risk}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="metric-grid">
          <Metric
            label="Requirements"
            value={`${requirementStats.met}/${report.requirements.length}`}
            icon={<ListChecks size={17} />}
          />
          <Metric label="Coverage" value={`${report.summary.evidenceCoverage}%`} icon={<Gauge size={17} />} />
          <Metric
            label="Test/Build"
            value={formatStatus(report.testing.ciStatus)}
            icon={<GitCommitVertical size={17} />}
            tone={statusClass(report.testing.ciStatus)}
          />
          <Metric label="Missing Tests" value={String(report.testing.missingTests.length)} icon={<TestTube2 size={17} />} />
        </div>

        <div className="action-dock">
          <div className="action-dock-copy">
            <span>
              <LockKeyhole size={14} />
              Human handoff
            </span>
            <small>Share surfaces stay summary-only; full export is explicit.</small>
          </div>
          <div className="report-actions" aria-label="Report export actions">
            {!isSummaryMode ? (
              <>
                <button className="button compact" onClick={() => copyText(markdown, "report")}>
                  {copiedAction === "report" ? <CheckCircle2 size={15} /> : <Clipboard size={15} />}
                  {copiedAction === "report" ? "Copied" : "Copy Report"}
                </button>
                <button className="button compact" onClick={() => copyText(githubComment, "comment")}>
                  {copiedAction === "comment" ? <CheckCircle2 size={15} /> : <MessageSquareText size={15} />}
                  {copiedAction === "comment" ? "Copied" : "Copy PR Comment"}
                </button>
              </>
            ) : null}
            <button className="button compact" onClick={copyShareLink}>
              {copiedAction === "share" ? <CheckCircle2 size={15} /> : <Link2 size={15} />}
              {copiedAction === "share" ? "Copied" : "Copy Share Link"}
            </button>
            {!isSummaryMode ? (
              <button className="button compact" onClick={downloadMarkdown}>
                <Download size={15} />
                Download
              </button>
            ) : null}
          </div>
        </div>
        {actionMessage ? <p className={`action-feedback ${actionMessage.tone}`}>{actionMessage.text}</p> : null}
      </div>

      <div className="report-body">
        <div className="stack report-main">
          <div className="card section-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Coverage</p>
                <h2>Requirement Evidence</h2>
              </div>
              <span className="muted small">
                {requirementStats.partial + requirementStats.missing + requirementStats.unclear} need review
              </span>
            </div>
            {report.requirements.map((requirement) => (
              <div className="requirement" key={requirement.requirementId}>
                <div className="requirement-status">
                  <StatusChip status={requirement.status} />
                  <span>{Math.round(requirement.confidence * 100)}% confidence</span>
                </div>
                <div className="requirement-body">
                  <p>{requirement.requirementText}</p>
                  <p className="muted small requirement-note">
                    <span>Evidence note:</span> {requirement.reviewerNote}
                  </p>
                  {requirement.gaps.length > 0 ? (
                    <ul className="plain-list">
                      {requirement.gaps.map((gap) => (
                        <li key={gap}>{gap}</li>
                      ))}
                    </ul>
                  ) : null}
                  {!isSummaryMode && requirement.evidenceRefs.length > 0 ? (
                    <EvidenceRefDetails refs={requirement.evidenceRefs} evidenceById={evidenceById} />
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="card section-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Human verification</p>
                <h2>Verification Priority</h2>
              </div>
            </div>
            <ul className="plain-list">
              {report.reviewPriority.length > 0 ? (
                report.reviewPriority.map((item) => (
                  <li key={`${item.path}-${item.reason}`}>
                    <span className={`evidence-label priority-${item.priority}`}>
                      {formatPriorityLabel(item.priority)} - {item.path}
                    </span>
                    {item.reason}
                    {!isSummaryMode ? <EvidenceRefDetails refs={item.evidenceRefs} evidenceById={evidenceById} /> : null}
                  </li>
                ))
              ) : (
                <li>No priority files detected from available evidence.</li>
              )}
            </ul>
          </div>

          {!isSummaryMode ? (
            <details className="card disclosure-card">
              <summary>
                <span>
                  <FileText size={15} />
                  Agent Claims
                </span>
                <small>{report.claims.length} extracted</small>
              </summary>
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
            </details>
          ) : null}

          {!isSummaryMode ? (
            <details className="card disclosure-card">
              <summary>
                <span>
                  <ClipboardList size={15} />
                  Evidence Index
                </span>
                <small>{report.evidenceIndex.length} items</small>
              </summary>
              <ul className="evidence-list">
                {report.evidenceIndex.slice(0, 12).map((item) => (
                  <li key={item.id}>
                    <span className="evidence-label">
                      {item.id} - {item.kind} - {item.locator ?? item.label} - {Math.round(item.confidence * 100)}%
                    </span>
                    {item.summary}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        <aside className="stack report-rail">
          <div className="card section-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Risk</p>
                <h2>Risks & Scope</h2>
              </div>
            </div>
            <ul className="plain-list">
              {report.summary.topRisks.map((risk) => (
                <li key={risk}>
                  <AlertCircle size={14} /> {risk}
                </li>
              ))}
              {report.scope.suspected ? (
                report.scope.reasons.map((reason) => (
                  <li key={reason}>
                    <FileWarning size={14} /> {reason}
                  </li>
                ))
              ) : (
                <li>No out-of-scope file cluster found from available evidence.</li>
              )}
            </ul>
            {!isSummaryMode && report.scope.evidenceRefs && report.scope.evidenceRefs.length > 0 ? (
              <EvidenceRefDetails refs={report.scope.evidenceRefs} evidenceById={evidenceById} />
            ) : null}
          </div>

          <div className="card section-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Execution</p>
                <h2>Testing Evidence</h2>
              </div>
            </div>
            <ul className="plain-list">
              <li>Test/build: {formatStatus(report.testing.ciStatus)}</li>
              <li>Lint: {formatStatus(report.testing.lintStatus)}</li>
              <li>Typecheck: {formatStatus(report.testing.typecheckStatus)}</li>
              {report.testing.missingTests.length > 0 ? (
                report.testing.missingTests.map((item) => (
                  <li key={item.path}>
                    <span className="evidence-label">{item.path}</span>
                    {item.why}
                    {!isSummaryMode ? <EvidenceRefDetails refs={item.evidenceRefs} evidenceById={evidenceById} /> : null}
                  </li>
                ))
              ) : (
                <li>No missing test evidence detected.</li>
              )}
            </ul>
          </div>

          {!isSummaryMode ? (
            <details className="card disclosure-card">
              <summary>
                <span>
                  <GitCommitVertical size={15} />
                  Execution Evidence
                </span>
                <small>{executionEvidence.length} items</small>
              </summary>
              {executionEvidence.length > 0 ? (
                <ul className="evidence-list">
                  {executionEvidence.map((item) => (
                    <li key={item.id}>
                      <span className={`evidence-label status-${item.status}`}>
                        {item.status.toUpperCase()} - {item.id} - {item.kind} - {item.locator ?? item.label} -{" "}
                        {Math.round(item.confidence * 100)}%
                      </span>
                      {item.displaySummary}
                      <FailureLocationLine locations={item.failureLocations} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">No test/build check or log evidence was available.</p>
              )}
            </details>
          ) : null}

          {!isSummaryMode && report.source.url ? (
            <div className="card section-card">
              <div className="card-title-row">
                <div>
                  <p className="eyebrow">Handoff</p>
                  <h2>GitHub PR Comment</h2>
                </div>
                {postedCommentUrl ? (
                  <a className="icon-link" href={postedCommentUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={15} />
                  </a>
                ) : null}
              </div>
              <pre className="comment-preview">{githubComment}</pre>
              <div className="field compact-field">
                <label htmlFor="commentToken">Write token</label>
                <input
                  id="commentToken"
                  className="input"
                  value={commentToken}
                  onChange={(event) => setCommentToken(event.target.value)}
                  type="password"
                  placeholder="Fine-grained token"
                />
              </div>
              <button className="button primary" onClick={postGitHubComment} disabled={postingComment || !commentToken.trim()}>
                <Send size={16} />
                {postingComment ? "Posting" : "Post Comment"}
              </button>
            </div>
          ) : null}

          {!isSummaryMode ? (
            <div className="card section-card">
              <div className="card-title-row">
                <div>
                  <p className="eyebrow">Next agent task</p>
                  <h2>Agent Re-prompt</h2>
                </div>
                <button className="button compact" onClick={() => copyText(report.reprompt.prompt, "reprompt")}>
                  {copiedAction === "reprompt" ? <CheckCircle2 size={15} /> : <Bot size={15} />}
                  {copiedAction === "reprompt" ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="reprompt">{report.reprompt.prompt}</pre>
            </div>
          ) : null}

          <div className="card section-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Boundary</p>
                <h2>Limitations</h2>
              </div>
            </div>
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
        </aside>
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
  return <span className={`priority-chip priority-${priority}`}>{formatPriorityLabel(priority)}</span>;
}

function StatusChip({ status }: { status: RequirementStatus }) {
  return (
    <span className={`priority-chip status-${status}`}>
      <ClipboardList size={14} />
      {status.toUpperCase()}
    </span>
  );
}

function EvidenceRefDetails({
  refs,
  evidenceById
}: {
  refs?: string[];
  evidenceById: Map<string, VerificationReport["evidenceIndex"][number]>;
}) {
  if (!refs || refs.length === 0) return null;

  return (
    <details className="evidence-details">
      <summary>Cited evidence ({refs.length})</summary>
      <EvidenceRefs refs={refs} evidenceById={evidenceById} compact />
    </details>
  );
}

function EvidenceRefs({
  refs,
  evidenceById,
  compact = false
}: {
  refs?: string[];
  evidenceById: Map<string, VerificationReport["evidenceIndex"][number]>;
  compact?: boolean;
}) {
  if (!refs || refs.length === 0) return null;

  return (
    <div className="evidence-ref-block">
      <span className="evidence-label">Cited evidence</span>
      <ul className={`evidence-list${compact ? " compact-list" : ""}`}>
        {refs.map((ref) => {
          const evidence = evidenceById.get(ref);

          return (
            <li key={ref}>
              <span className="evidence-label">
                {ref}
                {evidence
                  ? ` - ${evidence.kind} - ${evidence.locator ?? evidence.label} - ${Math.round(evidence.confidence * 100)}%`
                  : ""}
              </span>
              {evidence?.summary ?? "Evidence item was not found in this report."}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FailureLocationLine({
  locations
}: {
  locations: ReturnType<typeof getExecutionEvidenceItems>[number]["failureLocations"];
}) {
  if (locations.length === 0) return null;

  const shown = locations.slice(0, 3);
  const hiddenCount = Math.max(0, locations.length - shown.length);

  return (
    <p className="muted small requirement-note">
      <span>Failure locations:</span>{" "}
      {shown.map((location, index) => {
        const locator = location.line ? `${location.path}:${location.line}` : location.path;

        return (
          <span key={`${location.level}-${locator}`}>
            {index > 0 ? ", " : ""}
            <code>{locator}</code>
          </span>
        );
      })}
      {hiddenCount > 0 ? `, +${hiddenCount} more` : ""}
    </p>
  );
}

function statusClass(status: CheckStatus): string {
  return `status-${status}`;
}

function formatStatus(status: CheckStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatPriorityLabel(priority: PriorityLevel): string {
  if (priority === "blocker") return "Critical evidence gap";
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

function getVerificationAnswer(priority: PriorityLevel, evidenceCoverage: number, ciStatus: CheckStatus) {
  if (priority === "blocker") {
    return {
      title: "Not enough evidence yet",
      body: "A critical evidence gap or failed execution signal needs human verification before this PR has enough evidence."
    };
  }

  if (priority === "high") {
    return {
      title: "Evidence is weak in key areas",
      body: "Start with the priority files and test/build proof before deciding whether the request is satisfied."
    };
  }

  if (priority === "medium") {
    return {
      title: "Partially supported",
      body: `Coverage is ${evidenceCoverage}% with ${formatStatus(ciStatus).toLowerCase()} test/build evidence. Check the listed gaps first.`
    };
  }

  return {
    title: "Mostly supported by available evidence",
    body: "The report found aligned proof, but this remains a human review handoff rather than an approval."
  };
}

async function writeClipboardText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Clipboard fallback failed");
  }
}
