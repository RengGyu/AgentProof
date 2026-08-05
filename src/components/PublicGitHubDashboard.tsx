"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  FileCheck2,
  FolderGit2,
  Github,
  Info,
  Link2,
  Loader2,
  Settings2,
  ShieldCheck,
  XCircle
} from "lucide-react";
import {
  buildGitHubPullUrl,
  toRequirementCoverageLabel,
  toQuickSummary,
  toRepositoryWorkspaceRows,
  type DashboardReportDetail,
  type DashboardRepositoryGrant,
  type DashboardSavedReport
} from "@/lib/github-dashboard-view-model";
import {
  createRepositorySelectionGate,
  githubOnboardingStartFailureMessage,
  githubRepositoryConnectionFailureMessage
} from "@/lib/github-onboarding-client";

interface Repository { id: number; fullName: string; private: boolean; }
interface ExistingInstallation { installationId: number; accountLogin: string; }
type WorkspaceScreen = "repositories" | "settings";
type RepositorySetting = "analysisEnabled" | "saveReportsEnabled" | "commentEnabled";

const PREVIEW_DEMO_REPOSITORIES: DashboardRepositoryGrant[] = [{
  installationId: 999,
  repositoryId: 101,
  repositoryFullName: "sample-org/checkout-service",
  enabled: true,
  analysisEnabled: true,
  saveReportsEnabled: true,
  commentEnabled: false
}];

const PREVIEW_DEMO_REPORTS: DashboardSavedReport[] = [{
  id: "preview-report-current",
  repositoryId: 101,
  pullRequestNumber: 42,
  headSha: "7cf2a98bf1d4c2508a0668da80c45151fca856d1",
  priority: "medium",
  createdAt: "2026-08-06T07:00:00.000Z"
}, {
  id: "preview-report-stale",
  repositoryId: 101,
  pullRequestNumber: 42,
  headSha: "1b7a6e35b3ac00d94a7e7ea9d8e4bb178d5c7bd2",
  priority: "medium",
  createdAt: "2026-08-05T20:00:00.000Z",
  staleAt: "2026-08-06T07:00:00.000Z"
}];

const PREVIEW_DEMO_DETAIL: DashboardReportDetail = {
  ...PREVIEW_DEMO_REPORTS[0],
  report: {
    requirements: [{ requirementId: "req_1", status: "partial", evidenceRefs: ["ev_12", "ev_18"], gaps: ["Evidence gap recorded."] }],
    testing: { ciStatus: "passed", lintStatus: "unknown", typecheckStatus: "pending" },
    reviewPriority: [{ path: "src/checkout/validation.ts", priority: "medium" }],
    evidenceIndex: [{ id: "ev_12", locator: "src/checkout/validation.ts" }],
    reprompt: { prompt: "Add bounded evidence for the requirement, then rerun the relevant check." }
  }
};

export function PublicGitHubDashboard({ installationId, previewDemoEnabled = false }: { installationId?: string; previewDemoEnabled?: boolean }) {
  const [demoMode] = useState(previewDemoEnabled);
  const [signedIn, setSignedIn] = useState(previewDemoEnabled);
  const [activeInstallationId, setActiveInstallationId] = useState(installationId);
  const [existingInstallations, setExistingInstallations] = useState<ExistingInstallation[]>([]);
  const [availableRepositories, setAvailableRepositories] = useState<Repository[]>([]);
  const [connectedRepositories, setConnectedRepositories] = useState<DashboardRepositoryGrant[]>(previewDemoEnabled ? PREVIEW_DEMO_REPOSITORIES : []);
  const [connectionsLoaded, setConnectionsLoaded] = useState(previewDemoEnabled);
  const [repositorySelectionPending, setRepositorySelectionPending] = useState(false);
  const [commentEnabledOnConnect, setCommentEnabledOnConnect] = useState(false);
  const [message, setMessage] = useState(previewDemoEnabled ? "Preview demo: sample data only. No GitHub, database, or comment action will run." : "Sign in with GitHub to start.");
  const [reports, setReports] = useState<DashboardSavedReport[]>(previewDemoEnabled ? PREVIEW_DEMO_REPORTS : []);
  const [detail, setDetail] = useState<DashboardReportDetail | null>(previewDemoEnabled ? PREVIEW_DEMO_DETAIL : null);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<number | undefined>(previewDemoEnabled ? 101 : undefined);
  const [screen, setScreen] = useState<WorkspaceScreen>("repositories");
  const [showDetailedEvidence, setShowDetailedEvidence] = useState(false);
  const [settingsPending, setSettingsPending] = useState<string | null>(null);
  const repositorySelectionGate = useRef(createRepositorySelectionGate());

  const repositoryRows = useMemo(
    () => toRepositoryWorkspaceRows(connectedRepositories, reports),
    [connectedRepositories, reports]
  );
  const selectedRepository = repositoryRows.find((repository) => repository.repositoryId === selectedRepositoryId) ?? repositoryRows[0];
  const selectedReports = reports
    .filter((report) => report.repositoryId === selectedRepository?.repositoryId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const selectedRepositoryName = selectedRepository?.repositoryFullName;
  const quickSummary = detail
    ? toQuickSummary({ ...detail, repositoryFullName: repositoryLabel(detail.repositoryId, connectedRepositories) })
    : null;

  useEffect(() => {
    if (demoMode) {
      setSignedIn(true);
      setConnectedRepositories(PREVIEW_DEMO_REPOSITORIES);
      setReports(PREVIEW_DEMO_REPORTS);
      setDetail(PREVIEW_DEMO_DETAIL);
      setSelectedRepositoryId(101);
      setConnectionsLoaded(true);
      setMessage("Preview demo: sample data only. No GitHub, database, or comment action will run.");
      return;
    }
    let cancelled = false;
    fetch("/api/dashboard/session", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((body) => {
        if (cancelled) return;
        setSignedIn(body?.signedIn === true);
        if (body?.signedIn) {
          setMessage("Review connected repositories or connect another repository.");
          void refreshReports();
          void refreshConnectedRepositories();
        }
      })
      .catch(() => { if (!cancelled) setMessage("Session status is temporarily unavailable."); });
    return () => { cancelled = true; };
  }, [demoMode]);

  useEffect(() => {
    if (demoMode || !signedIn || !activeInstallationId) return;
    fetch(`/api/github/onboarding/repositories?installationId=${encodeURIComponent(activeInstallationId)}`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((body) => {
        if (Array.isArray(body?.repositories)) {
          setAvailableRepositories(body.repositories);
          setMessage("Choose a repository. Reports retain no raw diffs, logs, or tokens.");
        } else setMessage("Repository selection has expired. Start the App installation again.");
      })
      .catch(() => setMessage("Repositories could not be loaded."));
  }, [activeInstallationId, demoMode, signedIn]);

  useEffect(() => {
    setActiveInstallationId(installationId);
  }, [installationId]);

  async function refreshReports() {
    if (demoMode) {
      setReports(PREVIEW_DEMO_REPORTS);
      return;
    }
    try {
      const response = await fetch("/api/dashboard/reports", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      setReports(response.ok && Array.isArray(body?.reports) ? body.reports : []);
    } catch {
      setReports([]);
    }
  }

  async function refreshConnectedRepositories() {
    if (demoMode) {
      setConnectedRepositories(PREVIEW_DEMO_REPOSITORIES);
      setSelectedRepositoryId(101);
      setConnectionsLoaded(true);
      return;
    }
    try {
      const response = await fetch("/api/dashboard/repositories", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (response.ok && Array.isArray(body?.repositories)) {
        setConnectedRepositories(body.repositories);
        setSelectedRepositoryId((current) => current ?? body.repositories[0]?.repositoryId);
      }
    } catch {
      setConnectedRepositories([]);
    } finally {
      setConnectionsLoaded(true);
    }
  }

  async function login() {
    if (demoMode) return;
    const response = await fetch("/api/auth/github/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const body = await response.json().catch(() => null);
    if (typeof body?.authorizationUrl === "string") window.location.assign(body.authorizationUrl);
    else setMessage("GitHub sign-in is temporarily unavailable.");
  }

  async function install() {
    if (demoMode) {
      setMessage("Preview demo already includes a sample connected repository.");
      return;
    }
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
      setExistingInstallations(existing.installations.filter(isExistingInstallation));
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
      const response = await fetch("/api/github/onboarding/repositories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installationId: Number(activeInstallationId), repositoryId: repository.id, saveReportsEnabled: true, commentEnabled: commentEnabledOnConnect })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        repositorySelectionGate.current.reset();
        setMessage(githubRepositoryConnectionFailureMessage(body?.code));
        return;
      }
      setAvailableRepositories([]);
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
      setSelectedRepositoryId(repository.id);
      setConnectionsLoaded(true);
      setMessage(`${repository.fullName} is connected. PR events create evidence reports; GitHub comments are ${commentEnabledOnConnect ? "enabled" : "off"}.`);
    } catch {
      repositorySelectionGate.current.reset();
      setMessage("Repository could not be connected.");
    } finally {
      setRepositorySelectionPending(false);
    }
  }

  async function openReport(id: string) {
    if (demoMode) {
      const report = PREVIEW_DEMO_REPORTS.find((item) => item.id === id);
      if (!report) return;
      setDetail(report.id === "preview-report-current" ? PREVIEW_DEMO_DETAIL : { ...PREVIEW_DEMO_DETAIL, ...report });
      setShowDetailedEvidence(false);
      return;
    }
    const response = await fetch(`/api/dashboard/reports?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (response.ok) {
      setDetail(body);
      setShowDetailedEvidence(false);
      return;
    }
    setMessage("Report could not be opened.");
  }

  async function updateRepositorySetting(setting: RepositorySetting, nextValue: boolean) {
    if (!selectedRepository?.repositoryId) return;
    if (demoMode) {
      setConnectedRepositories((current) => current.map((repository) => repository.repositoryId === selectedRepository.repositoryId && repository.installationId === selectedRepository.installationId
        ? { ...repository, [setting]: nextValue }
        : repository));
      setMessage("Preview demo setting updated locally. No GitHub or database change was made.");
      return;
    }
    setSettingsPending(setting);
    try {
      const response = await fetch("/api/tenants/repositories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-agentproof-csrf": "same-origin" },
        body: JSON.stringify({
          installationId: selectedRepository.installationId,
          repositoryId: selectedRepository.repositoryId,
          settings: { [setting]: nextValue }
        })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.repository) {
        setMessage("Repository settings could not be saved.");
        return;
      }
      setConnectedRepositories((current) => current.map((repository) => repository.repositoryId === selectedRepository.repositoryId && repository.installationId === selectedRepository.installationId
        ? { ...repository, ...body.repository }
        : repository));
      setMessage("Repository settings saved.");
    } catch {
      setMessage("Repository settings could not be saved.");
    } finally {
      setSettingsPending(null);
    }
  }

  if (!signedIn) return <section className="github-dashboard github-sign-in">
    <div className="github-sign-in-mark"><ShieldCheck size={28} /></div>
    <p className="dashboard-eyebrow">EVIDENCE-FIRST REVIEW</p>
    <h2>Review the evidence behind a pull request.</h2>
    <p>{message}</p>
    <button className="dashboard-primary-action" onClick={login}><Github size={18} /> Continue with GitHub</button>
    <p className="dashboard-boundary">AgentProof organizes available evidence. It does not establish correctness, safety, requirement satisfaction, or merge readiness.</p>
  </section>;

  return <section className="github-dashboard">
    <aside className="dashboard-sidebar">
      <div className="dashboard-brand"><span className="dashboard-brand-mark"><ShieldCheck size={18} /></span><span>AgentProof<small>Evidence workspace</small></span></div>
      <p className="dashboard-sidebar-boundary"><ShieldCheck size={14} /> Evidence report only. Human review remains required.</p>
    </aside>

    <div className="dashboard-canvas">
      <header className="dashboard-topbar">
        <div><p className="dashboard-eyebrow">{screen === "settings" ? "SETTINGS" : "REPOSITORIES"}</p><h2>{screen === "settings" ? "Repository settings" : "Evidence workspace"}</h2></div>
        <div className="dashboard-top-actions"><button className="dashboard-text-action dashboard-settings-action" onClick={() => setScreen(screen === "settings" ? "repositories" : "settings")}><Settings2 size={16} /> {screen === "settings" ? "Reports" : "Settings"}</button><button className="dashboard-icon-button" aria-label="Refresh reports" onClick={() => { void refreshReports(); }}><Clock3 size={18} /></button></div>
      </header>
      <p className="dashboard-message" role="status">{message}</p>
      {demoMode ? <p className="dashboard-demo-banner"><Info size={15} /> Preview demo · sample data only · GitHub, database, and comments are disabled.</p> : null}

      {screen === "repositories" ? <>
        <section className="dashboard-section dashboard-repository-strip" aria-labelledby="connected-repositories-title">
          <div className="dashboard-section-heading"><div><p className="dashboard-eyebrow">CONNECTIONS</p><h3 id="connected-repositories-title">Connected repositories</h3></div>{signedIn && !activeInstallationId ? <button className="dashboard-text-action" onClick={install}><Link2 size={15} /> {demoMode ? "Sample repository" : "Connect repository"}</button> : null}</div>
          {!connectionsLoaded ? <p className="dashboard-empty"><Loader2 size={16} className="spin" /> Loading connected repositories</p> : repositoryRows.length > 0 ? <div className="repository-tabs">{repositoryRows.map((repository) => <button key={`${repository.installationId}:${repository.repositoryId ?? repository.repositoryFullName}`} className={repository.repositoryId === selectedRepository?.repositoryId ? "repository-tab active" : "repository-tab"} onClick={() => { setSelectedRepositoryId(repository.repositoryId); setDetail(null); }}><span>{repository.repositoryFullName}</span><small>{repository.analysisEnabled ? "Analysis on" : "Analysis off"} · {repository.commentsEnabled ? "Comments on" : "Comments off"}</small></button>)}</div> : <p className="dashboard-empty">No repository is connected yet.</p>}
        </section>

        {existingInstallations.length > 0 ? <section className="dashboard-section"><div className="dashboard-section-heading"><div><p className="dashboard-eyebrow">GITHUB APP</p><h3>Choose an installation</h3></div></div><div className="installation-list">{existingInstallations.map((installation) => <button key={installation.installationId} className="dashboard-list-row" onClick={() => { void activateExistingInstallation(installation.installationId); }}><Github size={17} /> {installation.accountLogin}<ChevronRight size={16} /></button>)}</div></section> : null}

        {availableRepositories.length > 0 ? <section className="dashboard-section"><div className="dashboard-section-heading"><div><p className="dashboard-eyebrow">REPOSITORY ACCESS</p><h3>Select a repository</h3></div></div><label className="dashboard-toggle-row"><span><strong>Summary comments</strong><small>Off by default. Only summary-only comments are posted.</small></span><input type="checkbox" checked={commentEnabledOnConnect} onChange={(event) => setCommentEnabledOnConnect(event.target.checked)} /></label><div className="installation-list">{availableRepositories.map((repository) => <button key={repository.id} className="dashboard-list-row" disabled={repositorySelectionPending} onClick={() => { void selectRepository(repository); }}><FolderGit2 size={17} /> {repository.fullName}{repository.private ? <small>Private</small> : null}<ChevronRight size={16} /></button>)}</div></section> : null}

        <section className="dashboard-workspace">
          <div className="dashboard-section-heading"><div><p className="dashboard-eyebrow">{selectedRepositoryName ?? "SELECT A REPOSITORY"}</p><h3>Repository reports</h3><p className="dashboard-section-copy">Saved evidence reports only. Issue grouping and inbox are unavailable until authoritative product data exists.</p></div></div>
          {!selectedRepository ? <p className="dashboard-empty">Connect a GitHub repository to review saved evidence reports.</p> : selectedReports.length === 0 ? <p className="dashboard-empty"><FileCheck2 size={20} /> No reports yet<br /><small>New PR events will appear here after analysis.</small></p> : <div className="dashboard-report-layout">
            <div className="report-list" aria-label="Previous analysis reports">{selectedReports.map((report) => <button key={report.id} className={detail?.pullRequestNumber === report.pullRequestNumber && detail?.headSha === report.headSha ? "report-row active" : "report-row"} onClick={() => { void openReport(report.id); }}><span className="report-row-icon">{report.staleAt ? <Clock3 size={17} /> : <FileCheck2 size={17} />}</span><span><strong>PR #{report.pullRequestNumber ?? "Unknown"}</strong><small>{formatCreatedAt(report.createdAt)} · head {headPrefix(report.headSha)}</small></span><span className="report-row-meta"><StatusToken label={report.staleAt ? "STALE" : "CURRENT"} title={report.staleAt ? "STALE (older head)" : "Current report"} /><small><strong>Priority:</strong> {report.priority}</small></span></button>)}</div>
            {detail?.report && quickSummary ? <QuickSummaryPanel detail={detail} quickSummary={quickSummary} onShowDetail={() => setShowDetailedEvidence((current) => !current)} showDetailedEvidence={showDetailedEvidence} /> : <div className="dashboard-empty dashboard-summary-placeholder"><Info size={20} /> Select a report to open its Quick Summary.</div>}
          </div>}
        </section>
      </> : <SettingsPanel repository={selectedRepository} pending={settingsPending} onUpdate={updateRepositorySetting} />}
    </div>

  </section>;
}

function QuickSummaryPanel({ detail, quickSummary, onShowDetail, showDetailedEvidence }: { detail: DashboardReportDetail; quickSummary: ReturnType<typeof toQuickSummary>; onShowDetail: () => void; showDetailedEvidence: boolean }) {
  const report = detail.report;
  const firstRequirement = report?.requirements?.find((item) => item.gaps.length > 0) ?? report?.requirements?.[0];
  const githubUrl = quickSummary.githubUrl;
  return <article className="quick-summary">
    <header className="quick-summary-header"><div><p className="dashboard-eyebrow">QUICK SUMMARY</p><h3>PR #{detail.pullRequestNumber ?? "Unknown"}</h3><p>Head <code>{headPrefix(detail.headSha)}</code> · Analyzed {detail.createdAt ? formatCreatedAt(detail.createdAt) : "unknown time"}</p></div><div className="summary-badges"><StatusToken label={quickSummary.freshness} /><StatusToken label={`Priority: ${detail.priority ?? "unknown"}`} /></div></header>
    <div className="summary-status-grid"><SummaryState label="Report state" value={quickSummary.freshness} /><SummaryState label="Check state" value={quickSummary.checkState} /><SummaryState label="Evidence" value={quickSummary.primaryEvidenceState} /><SummaryState label="Inspect first" value={quickSummary.inspectFirst} mono /></div>
    <section className="summary-callout"><CircleAlert size={19} /><div><p className="dashboard-eyebrow">MOST IMPORTANT EVIDENCE GAP</p><strong>{quickSummary.primaryEvidenceState}</strong><p>{firstRequirement ? `Requirement ${firstRequirement.requirementId} is ${toRequirementCoverageLabel(firstRequirement.status).toLowerCase()}. More proof is needed before it is fully supported.` : "No requirement evidence is available in this saved report."}</p></div></section>
    <div className="summary-actions">{githubUrl ? <a className="dashboard-secondary-action" href={githubUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open in GitHub</a> : <span className="dashboard-disabled-action">GitHub link unavailable</span>}<button className="dashboard-primary-action" onClick={onShowDetail}>{showDetailedEvidence ? "Hide detailed evidence" : "View detailed evidence"}</button></div>
    {showDetailedEvidence ? <DetailedEvidence detail={detail} /> : null}
    <p className="dashboard-boundary"><ShieldCheck size={15} /> This report organizes available evidence. It does not establish correctness, safety, requirement satisfaction, or merge readiness.</p>
  </article>;
}

function DetailedEvidence({ detail }: { detail: DashboardReportDetail }) {
  const report = detail.report;
  return <section className="detailed-evidence"><div className="dashboard-section-heading"><div><p className="dashboard-eyebrow">DETAILED EVIDENCE</p><h4>Requirements, checks, and review targets</h4></div></div><div className="detail-grid"><section><h5>Requirements</h5>{report?.requirements?.length ? report.requirements.map((item) => <div className="detail-row" key={item.requirementId}><strong>{item.requirementId} · {toRequirementCoverageLabel(item.status)}</strong><span>{item.evidenceRefs.length > 0 ? `${item.evidenceRefs.length} evidence reference${item.evidenceRefs.length === 1 ? "" : "s"} available` : "No evidence reference available"}</span><span>Reference IDs: {item.evidenceRefs.join(", ") || "Unavailable"}</span><span>{item.gaps.length > 0 ? "Needs: more proof before this requirement is fully supported." : "No evidence gap recorded."}</span></div>) : <p className="dashboard-empty">Unavailable</p>}</section><section><h5>Checks & CI</h5><div className="detail-row"><span>CI</span><strong>{report?.testing?.ciStatus ?? "unavailable"}</strong></div><div className="detail-row"><span>Lint</span><strong>{report?.testing?.lintStatus ?? "unavailable"}</strong></div><div className="detail-row"><span>Typecheck</span><strong>{report?.testing?.typecheckStatus ?? "unavailable"}</strong></div></section><section><h5>Priority files</h5>{report?.reviewPriority?.length ? report.reviewPriority.map((item) => <div className="detail-row" key={item.path}><code>{item.path}</code><span>{item.priority}</span></div>) : <p className="dashboard-empty">Unavailable</p>}</section><section><h5>Agent request</h5><p className="agent-request">{report?.reprompt?.prompt ?? "Unavailable"}</p></section><section><h5>Limitations</h5><p className="agent-request">Saved reports retain refined verification fields. Raw diffs, full logs, OAuth tokens, and raw GitHub responses are not displayed.</p></section></div></section>;
}

function SettingsPanel({ repository, pending, onUpdate }: { repository: ReturnType<typeof toRepositoryWorkspaceRows>[number] | undefined; pending: string | null; onUpdate: (setting: RepositorySetting, nextValue: boolean) => Promise<void> }) {
  if (!repository) return <section className="dashboard-workspace"><p className="dashboard-empty">Connect and select a repository before changing its settings.</p></section>;
  return <section className="dashboard-workspace settings-panel"><div className="dashboard-section-heading"><div><p className="dashboard-eyebrow">{repository.repositoryFullName}</p><h3>Repository settings</h3><p className="dashboard-section-copy">These settings apply only to this connected repository.</p></div></div><SettingToggle label="Automatic analysis" detail="Create an evidence report for supported PR events." checked={repository.analysisEnabled} pending={pending === "analysisEnabled"} onChange={(value) => onUpdate("analysisEnabled", value)} /><SettingToggle label="Saved reports" detail="Retain the bounded report fields allowed by the privacy policy." checked={repository.saveReportsEnabled} pending={pending === "saveReportsEnabled"} onChange={(value) => onUpdate("saveReportsEnabled", value)} /><SettingToggle label="Summary comments" detail={repository.commentEnabled ? "Comments are enabled for this repository." : "Comments are off by default. Enable only with repository-level consent."} checked={repository.commentEnabled} pending={pending === "commentEnabled"} onChange={(value) => onUpdate("commentEnabled", value)} /><p className="dashboard-boundary"><ShieldCheck size={15} /> Changes require your signed-in owner or admin session. GitHub comments never include raw diffs, logs, tokens, or full report content.</p></section>;
}

function SettingToggle({ label, detail, checked, pending, onChange }: { label: string; detail: string; checked: boolean; pending: boolean; onChange: (value: boolean) => void }) {
  return <label className="dashboard-toggle-row"><span><strong>{label}</strong><small>{detail}</small></span><input type="checkbox" checked={checked} disabled={pending} onChange={(event) => onChange(event.target.checked)} /></label>;
}

function SummaryState({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><p>{label}</p><strong className={mono ? "mono" : undefined}>{value}</strong></div>;
}

function StatusToken({ label, title }: { label: string; title?: string }) {
  const failed = /failed/i.test(label);
  const pending = /pending/i.test(label);
  const stale = /stale/i.test(label);
  const unknown = /unknown|unavailable/i.test(label);
  const Icon = failed ? XCircle : pending || stale ? Clock3 : unknown ? Info : CheckCircle2;
  const tone = failed ? "failed" : pending || stale ? "pending" : unknown ? "unknown" : "success";
  return <span className={`status-token ${tone}`} title={title}><Icon size={13} /> {label}</span>;
}

function isExistingInstallation(value: unknown): value is ExistingInstallation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as ExistingInstallation;
  return Number.isSafeInteger(candidate.installationId) && candidate.installationId > 0 && typeof candidate.accountLogin === "string";
}

function headPrefix(headSha?: string): string {
  return headSha?.slice(0, 8) || "unknown";
}

function formatCreatedAt(createdAt: string): string {
  const value = new Date(createdAt);
  return Number.isNaN(value.getTime()) ? "unknown time" : value.toLocaleString();
}

function mergeConnectedRepository(current: DashboardRepositoryGrant[], next: DashboardRepositoryGrant): DashboardRepositoryGrant[] {
  const remaining = current.filter((repository) => repository.repositoryId !== next.repositoryId || repository.installationId !== next.installationId);
  return [...remaining, next];
}

function repositoryLabel(repositoryId: number | undefined, repositories: DashboardRepositoryGrant[]): string | undefined {
  return repositories.find((repository) => repository.repositoryId === repositoryId)?.repositoryFullName ?? (repositoryId ? `Repository #${repositoryId}` : undefined);
}
