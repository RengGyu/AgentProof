"use client";

import { useEffect, useRef, useState } from "react";
import {
  createRepositorySelectionGate,
  githubOnboardingStartFailureMessage,
  githubRepositoryConnectionFailureMessage
} from "@/lib/github-onboarding-client";

interface Repository { id: number; fullName: string; private: boolean; }
interface ExistingInstallation { installationId: number; accountLogin: string; }
interface ConnectedRepository {
  installationId: number;
  repositoryId?: number;
  repositoryFullName: string;
  enabled: boolean;
  analysisEnabled: boolean;
  saveReportsEnabled: boolean;
  commentEnabled: boolean;
}
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
  const [activeInstallationId, setActiveInstallationId] = useState(installationId);
  const [existingInstallations, setExistingInstallations] = useState<ExistingInstallation[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [connectedRepositories, setConnectedRepositories] = useState<ConnectedRepository[]>([]);
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);
  const [repositorySelectionPending, setRepositorySelectionPending] = useState(false);
  const [commentEnabled, setCommentEnabled] = useState(false);
  const [message, setMessage] = useState("Sign in with GitHub to start.");
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const repositorySelectionGate = useRef(createRepositorySelectionGate());

  useEffect(() => {
    fetch("/api/dashboard/session", { cache: "no-store" }).then(async (response) => response.ok ? response.json() : null).then((body) => {
      setSignedIn(body?.signedIn === true);
      if (body?.signedIn) {
        setMessage("Review connected repositories or connect another repository.");
        fetch("/api/dashboard/reports", { cache: "no-store" }).then(async (result) => result.ok ? result.json() : null).then((reportsBody) => setReports(Array.isArray(reportsBody?.reports) ? reportsBody.reports : []));
        refreshConnectedRepositories();
      }
    }).catch(() => setMessage("Session status is temporarily unavailable."));
  }, []);

  useEffect(() => {
    if (!signedIn || !activeInstallationId) return;
    fetch(`/api/github/onboarding/repositories?installationId=${encodeURIComponent(activeInstallationId)}`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((body) => {
        if (Array.isArray(body?.repositories)) {
          setRepositories(body.repositories);
          setMessage("Choose a repository. Analysis reports are saved without raw diffs, logs, or tokens.");
        } else setMessage("Repository selection has expired. Start the App installation again.");
      }).catch(() => setMessage("Repositories could not be loaded."));
  }, [activeInstallationId, signedIn]);

  useEffect(() => {
    setActiveInstallationId(installationId);
  }, [installationId]);

  async function refreshConnectedRepositories() {
    try {
      const response = await fetch("/api/dashboard/repositories", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (response.ok && Array.isArray(body?.repositories)) {
        setConnectedRepositories(body.repositories);
      }
    } catch {
      setConnectedRepositories([]);
    } finally {
      setConnectionsLoaded(true);
    }
  }

  async function login() {
    const response = await fetch("/api/auth/github/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const body = await response.json().catch(() => null);
    if (typeof body?.authorizationUrl === "string") window.location.assign(body.authorizationUrl);
    else setMessage("GitHub login is not configured yet.");
  }
  async function install() {
    const existingResponse = await fetch("/api/github/onboarding/callback?existing=1", {
      headers: { "x-agentproof-csrf": "same-origin" }
    });
    const existing = await existingResponse.json().catch(() => null);
    if (existingResponse.ok && existing?.next === "select_repository" && typeof existing?.installationId === "number") {
      setExistingInstallations([]);
      repositorySelectionGate.current.reset();
      setRepositorySelectionPending(false);
      setActiveInstallationId(String(existing.installationId));
      setMessage("Loading repositories from your existing AgentProof App installation.");
      return;
    }
    if (existingResponse.ok && existing?.next === "choose_installation" && Array.isArray(existing?.installations)) {
      setExistingInstallations(existing.installations.filter((installation: unknown): installation is ExistingInstallation => {
        if (!installation || typeof installation !== "object") return false;
        const candidate = installation as ExistingInstallation;
        return Number.isSafeInteger(candidate.installationId) && candidate.installationId > 0 && typeof candidate.accountLogin === "string";
      }));
      setMessage("Choose the GitHub account or organization where AgentProof is already installed.");
      return;
    }
    if (existingResponse.status === 401) {
      setSignedIn(false);
      setMessage("Reconnect GitHub to recognize an existing App installation.");
      return;
    }
    const response = await fetch("/api/github/onboarding/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const body = await response.json().catch(() => null);
    if (typeof body?.installUrl === "string") window.location.assign(body.installUrl);
    else setMessage(githubOnboardingStartFailureMessage(body?.code));
  }
  async function activateExistingInstallation(existingInstallationId: number) {
    const response = await fetch(`/api/github/onboarding/callback?existing=1&installationId=${encodeURIComponent(existingInstallationId)}`, {
      headers: { "x-agentproof-csrf": "same-origin" }
    });
    const body = await response.json().catch(() => null);
    if (response.ok && body?.next === "select_repository" && typeof body?.installationId === "number") {
      setExistingInstallations([]);
      repositorySelectionGate.current.reset();
      setRepositorySelectionPending(false);
      setActiveInstallationId(String(body.installationId));
      setMessage("Loading repositories from your existing AgentProof App installation.");
    } else setMessage("That GitHub App installation could not be verified. Reconnect GitHub and try again.");
  }
  async function selectRepository(repository: Repository) {
    if (!repositorySelectionGate.current.tryStart()) return;
    setRepositorySelectionPending(true);
    try {
      const response = await fetch("/api/github/onboarding/repositories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ installationId: Number(activeInstallationId), repositoryId: repository.id, saveReportsEnabled: true, commentEnabled }) });
      const body = await response.json().catch(() => null);
      if (response.ok) {
        setRepositories([]);
        setActiveInstallationId(undefined);
        setConnectedRepositories((current) => mergeConnectedRepository(current, {
          installationId: Number(activeInstallationId),
          repositoryId: repository.id,
          repositoryFullName: repository.fullName,
          enabled: true,
          analysisEnabled: body?.settings?.analysisEnabled === true,
          saveReportsEnabled: body?.settings?.saveReportsEnabled === true,
          commentEnabled: body?.settings?.commentEnabled === true
        }));
        setConnectionsLoaded(true);
        setMessage(`${repository.fullName} is connected. PR events will create evidence reports; GitHub comments are ${commentEnabled ? "enabled" : "off"}.`);
        return;
      }
      repositorySelectionGate.current.reset();
      setMessage(githubRepositoryConnectionFailureMessage(body?.code));
    } catch {
      repositorySelectionGate.current.reset();
      setMessage("Repository could not be connected.");
    } finally {
      setRepositorySelectionPending(false);
    }
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
    {signedIn && <section className="card">
      <h3>Connected repositories</h3>
      {!connectionsLoaded ? <p className="muted small">Loading connected repository metadata.</p> : connectedRepositories.length > 0 ? <ul className="plain-list">{connectedRepositories.map((repository) => <li key={`${repository.installationId}:${repository.repositoryId ?? repository.repositoryFullName}`}>
        <strong>{repository.repositoryFullName}</strong><span className="muted small"> · Analysis {repository.analysisEnabled ? "on" : "off"} · Saved reports {repository.saveReportsEnabled ? "on" : "off"} · Comments {repository.commentEnabled ? "on" : "off"}</span>
      </li>)}</ul> : <p className="muted small">No repository is connected yet.</p>}
    </section>}
    {signedIn && !activeInstallationId && <button className="button primary" onClick={install}>{connectedRepositories.length > 0 ? "Connect another GitHub repository" : "Connect a GitHub repository"}</button>}
    {existingInstallations.length > 0 && <section className="card">
      <h3>Choose GitHub App installation</h3>
      <ul className="plain-list">{existingInstallations.map((installation) => <li key={installation.installationId}>
        <button className="button" onClick={() => activateExistingInstallation(installation.installationId)}>{installation.accountLogin}</button>
      </li>)}</ul>
    </section>}
    {repositories.length > 0 && <>
      <label className="checkbox-row"><input type="checkbox" checked={commentEnabled} onChange={(event) => setCommentEnabled(event.target.checked)} /> Post summary-only comments to this repository</label>
      <p className="muted small">Off by default. Comments never contain raw diffs, logs, tokens, or full report content.</p>
      <ul className="plain-list">{repositories.map((repository) => <li key={repository.id}><button className="button" disabled={repositorySelectionPending} onClick={() => selectRepository(repository)}>{repositorySelectionPending ? "Connecting repository…" : `${repository.fullName}${repository.private ? " (private)" : ""}`}</button></li>)}</ul>
    </>}
    {reports.length > 0 && <section className="card">
      <h3>Previous analysis reports</h3>
      <p className="muted small">These are saved reports from earlier PR analysis. They are separate from the connection step above.</p>
      <ul className="plain-list">{reports.map((report) => <li key={report.id}>
        <button className="button" onClick={() => openReport(report.id)}>
          {repositoryLabel(report.repositoryId, connectedRepositories)} · PR #{report.pullRequestNumber ?? "unknown"} · {formatCreatedAt(report.createdAt)} · head {headPrefix(report.headSha)} · Priority: {report.priority}
        </button>
        {report.staleAt ? <span className="muted small"> STALE (older head)</span> : null}
      </li>)}</ul>
    </section>}
    {detail?.report && <section className="card">
      <h3>{detail.staleAt ? "STALE evidence report" : "Evidence report"}</h3>
      <p>{repositoryLabel(detail.repositoryId, connectedRepositories)} · PR #{detail.pullRequestNumber ?? "unknown"} · head {headPrefix(detail.headSha)}</p>
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

function mergeConnectedRepository(current: ConnectedRepository[], next: ConnectedRepository): ConnectedRepository[] {
  const remaining = current.filter((repository) => repository.repositoryId !== next.repositoryId || repository.installationId !== next.installationId);
  return [...remaining, next];
}

function repositoryLabel(repositoryId: number | undefined, repositories: ConnectedRepository[]): string {
  return repositories.find((repository) => repository.repositoryId === repositoryId)?.repositoryFullName
    ?? `Repository #${repositoryId ?? "unknown"}`;
}
