"use client";

import { useEffect, useState } from "react";

interface Repository { id: number; fullName: string; private: boolean; }
interface SavedReport {
  id: string;
  repositoryId?: number;
  pullRequestNumber?: number;
  headSha?: string;
  priority: string;
  createdAt: string;
  staleAt?: string;
}
interface ReportDetail {
  report?: {
    requirements?: Array<{ requirementId: string; status: string; evidenceRefs: string[]; gaps: string[] }>;
    testing?: { ciStatus: string; lintStatus: string; typecheckStatus: string };
    reviewPriority?: Array<{ path: string; priority: string }>;
    evidenceIndex?: Array<{ id: string; locator?: string }>;
    reprompt?: { prompt: string };
  };
  repositoryId?: number;
  pullRequestNumber?: number;
  headSha?: string;
  staleAt?: string;
}

export function PublicGitHubDashboard({ installationId }: { installationId?: string }) {
  const [signedIn, setSignedIn] = useState(false);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [commentEnabled, setCommentEnabled] = useState(false);
  const [message, setMessage] = useState("Sign in with GitHub to start.");
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [detail, setDetail] = useState<ReportDetail | null>(null);

  useEffect(() => {
    fetch("/api/dashboard/session", { cache: "no-store" }).then(async (response) => response.ok ? response.json() : null).then((body) => {
      setSignedIn(body?.signedIn === true);
      if (body?.signedIn) {
        setMessage("Install the AgentProof GitHub App, then select a repository.");
        fetch("/api/dashboard/reports", { cache: "no-store" }).then(async (result) => result.ok ? result.json() : null).then((reportsBody) => setReports(Array.isArray(reportsBody?.reports) ? reportsBody.reports : []));
      }
    }).catch(() => setMessage("Session status is temporarily unavailable."));
  }, []);

  useEffect(() => {
    if (!signedIn || !installationId) return;
    fetch(`/api/github/onboarding/repositories?installationId=${encodeURIComponent(installationId)}`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((body) => {
        if (Array.isArray(body?.repositories)) {
          setRepositories(body.repositories);
          setMessage("Choose a repository. Analysis reports are saved without raw diffs, logs, or tokens.");
        } else setMessage("Repository selection has expired. Start the App installation again.");
      }).catch(() => setMessage("Repositories could not be loaded."));
  }, [installationId, signedIn]);

  async function login() {
    const response = await fetch("/api/auth/github/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const body = await response.json().catch(() => null);
    if (typeof body?.authorizationUrl === "string") window.location.assign(body.authorizationUrl);
    else setMessage("GitHub login is not configured yet.");
  }
  async function install() {
    const response = await fetch("/api/github/onboarding/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const body = await response.json().catch(() => null);
    if (typeof body?.installUrl === "string") window.location.assign(body.installUrl);
    else setMessage("GitHub App installation could not start.");
  }
  async function selectRepository(repository: Repository) {
    const response = await fetch("/api/github/onboarding/repositories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ installationId: Number(installationId), repositoryId: repository.id, saveReportsEnabled: true, commentEnabled }) });
    if (response.ok) {
      setRepositories([]);
      setMessage(`${repository.fullName} is connected. PR events will create evidence reports; GitHub comments are ${commentEnabled ? "enabled" : "off"}.`);
    } else setMessage("Repository could not be connected.");
  }

  async function openReport(id: string) {
    const response = await fetch(`/api/dashboard/reports?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (response.ok) setDetail(body);
    else setMessage("Report could not be opened.");
  }

  return <section className="card tenant-boundary-card">
    <h2>GitHub evidence reports</h2>
    <p>{message}</p>
    {!signedIn && <button className="button primary" onClick={login}>Continue with GitHub</button>}
    {signedIn && !installationId && <button className="button primary" onClick={install}>Install AgentProof GitHub App</button>}
    {repositories.length > 0 && <>
      <label className="checkbox-row"><input type="checkbox" checked={commentEnabled} onChange={(event) => setCommentEnabled(event.target.checked)} /> Post summary-only comments to this repository</label>
      <p className="muted small">Off by default. Comments never contain raw diffs, logs, tokens, or full report content.</p>
      <ul className="plain-list">{repositories.map((repository) => <li key={repository.id}><button className="button" onClick={() => selectRepository(repository)}>{repository.fullName}{repository.private ? " (private)" : ""}</button></li>)}</ul>
    </>}
    {reports.length > 0 && <section className="card">
      <h3>Saved evidence reports</h3>
      <ul className="plain-list">{reports.map((report) => <li key={report.id}>
        <button className="button" onClick={() => openReport(report.id)}>
          Repository #{report.repositoryId ?? "unknown"} · PR #{report.pullRequestNumber ?? "unknown"} · {formatCreatedAt(report.createdAt)} · head {headPrefix(report.headSha)} · Priority: {report.priority}
        </button>
        {report.staleAt ? <span className="muted small"> STALE (older head)</span> : null}
      </li>)}</ul>
    </section>}
    {detail?.report && <section className="card">
      <h3>{detail.staleAt ? "STALE evidence report" : "Evidence report"}</h3>
      <p>Repository #{detail.repositoryId ?? "unknown"} · PR #{detail.pullRequestNumber ?? "unknown"} · head {headPrefix(detail.headSha)}</p>
      <p>Checks: CI {detail.report.testing?.ciStatus}, lint {detail.report.testing?.lintStatus}, typecheck {detail.report.testing?.typecheckStatus}</p>
      <p>Requirements: {detail.report.requirements?.map((item) => `${item.requirementId}: ${item.status}; evidence ${item.evidenceRefs.join(", ") || "none"}; gaps ${item.gaps.join(", ") || "none"}`).join(" | ")}</p>
      <p>Evidence locations: {detail.report.evidenceIndex?.map((item) => `${item.id}: ${item.locator ?? "no safe location"}`).join(", ")}</p>
      <p>Priority files: {detail.report.reviewPriority?.map((item) => `${item.path} (${item.priority})`).join(", ")}</p>
      <p className="muted small">Repair prompt: {detail.report.reprompt?.prompt}</p>
    </section>}
  </section>;
}

function headPrefix(headSha?: string): string {
  return headSha?.slice(0, 8) || "unknown";
}

function formatCreatedAt(createdAt: string): string {
  const value = new Date(createdAt);
  return Number.isNaN(value.getTime()) ? "unknown time" : value.toLocaleString();
}
