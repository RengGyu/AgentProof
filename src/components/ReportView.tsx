"use client";

import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clipboard,
  ClipboardList,
  Download,
  ExternalLink,
  FileWarning,
  Gauge,
  GitCommitVertical,
  Link2,
  MessageSquareText,
  Send,
  TestTube2
} from "lucide-react";
import { useMemo, useState } from "react";
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
  const [copiedAction, setCopiedAction] = useState<"report" | "comment" | "reprompt" | "share" | null>(null);
  const [actionMessage, setActionMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [commentToken, setCommentToken] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [postedCommentUrl, setPostedCommentUrl] = useState<string | null>(null);

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
      <div className="panel summary-card">
        <div className="summary-head">
          <div className="summary-title">
            <h1>{report.source.title}</h1>
            <p>{report.summary.oneLine}</p>
          </div>
          <PriorityChip priority={report.summary.priority} />
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
        {actionMessage ? <p className={`action-feedback ${actionMessage.tone}`}>{actionMessage.text}</p> : null}

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
                    <EvidenceRefs refs={requirement.evidenceRefs} evidenceById={evidenceById} />
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          {!isSummaryMode ? (
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
          ) : null}

          <div className="card">
            <h2>Review Priority</h2>
            <ul className="plain-list">
              {report.reviewPriority.map((item) => (
                <li key={`${item.path}-${item.reason}`}>
                  <span className={`evidence-label priority-${item.priority}`}>{item.priority.toUpperCase()} - {item.path}</span>
                  {item.reason}
                  <EvidenceRefs refs={item.evidenceRefs} evidenceById={evidenceById} compact />
                </li>
              ))}
            </ul>
          </div>

          {!isSummaryMode ? (
            <div className="card">
              <h2>Evidence Index</h2>
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
            </div>
          ) : null}
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
                {report.scope.evidenceRefs && report.scope.evidenceRefs.length > 0 ? (
                  <li>
                    <EvidenceRefs refs={report.scope.evidenceRefs} evidenceById={evidenceById} compact />
                  </li>
                ) : null}
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
                <li key={item.path}>
                  {item.path}: {item.why}
                  <EvidenceRefs refs={item.evidenceRefs} evidenceById={evidenceById} compact />
                </li>
              ))}
            </ul>
          </div>

          {!isSummaryMode && report.source.url ? (
            <div className="card">
              <div className="card-title-row">
                <h2>GitHub PR Comment</h2>
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
            <div className="card">
              <div className="card-title-row">
                <h2>Agent Re-prompt</h2>
                <button className="button compact" onClick={() => copyText(report.reprompt.prompt, "reprompt")}>
                  {copiedAction === "reprompt" ? <CheckCircle2 size={15} /> : <Bot size={15} />}
                  {copiedAction === "reprompt" ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="reprompt">{report.reprompt.prompt}</pre>
            </div>
          ) : null}

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

function statusClass(status: CheckStatus): string {
  return `status-${status}`;
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
