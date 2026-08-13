"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clipboard,
  Clock3,
  ExternalLink,
  FileCheck2,
  FolderGit2,
  Github,
  History,
  Info,
  Link2,
  Loader2,
  Settings2,
  ShieldCheck,
  XCircle
} from "lucide-react";
import type { DashboardActivityEvent } from "@/lib/dashboard-activity";
import {
  buildGitHubPullUrl,
  toRequirementCoverageLabel,
  toQuickSummary,
  toRepositoryWorkspaceRows,
  type DashboardReportDetail,
  type DashboardRepositoryGrant,
  type DashboardSavedReport
} from "@/lib/github-dashboard-view-model";
import { toDashboardRequirementViewModels } from "@/lib/dashboard-requirement-view-model";
import { RequirementEvidenceList } from "@/components/RequirementEvidenceList";
import {
  createRepositorySelectionGate,
  dashboardRepositoryLoadFailureMessage,
  githubOnboardingStartFailureMessage,
  githubRepositoryConnectionFailureMessage
} from "@/lib/github-onboarding-client";
import {
  resolveRepositorySelectionLoad,
  type RepositorySelectionLoadResult
} from "@/lib/repository-selection-state";
import { dashboardReportsToMarkdown, dashboardReportToJson, dashboardReportToMarkdown } from "@/lib/dashboard-report-export";
import { prepareCurrentDashboardDetailForCopy, prepareCurrentDashboardBundleForCopy } from "@/lib/dashboard-copy-revalidation";
import { writeDeferredTextWithBrowserFallback, writeTextWithBrowserFallback } from "@/lib/browser-clipboard";
import { isCopyEligibleReport, reportWorkspaceStatusLabel, visibleRepositoryReports } from "@/lib/dashboard-report-list";

interface Repository { id: number; fullName: string; private: boolean; }
interface ExistingInstallation { installationId: number; accountLogin: string; }
type WorkspaceScreen = "repositories" | "settings";
type RepositorySetting = "analysisEnabled" | "saveReportsEnabled" | "commentEnabled" | "hybridPlannerConsent";
const DASHBOARD_REFRESH_INTERVAL_MS = 60_000;
const DASHBOARD_REPORT_LIST_LIMIT = 5;

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
  createdAt: "2026-08-06T07:00:00.000Z",
  freshness: "current",
  copyEligible: true
}, {
  id: "preview-report-stale",
  repositoryId: 101,
  pullRequestNumber: 42,
  headSha: "1b7a6e35b3ac00d94a7e7ea9d8e4bb178d5c7bd2",
  priority: "medium",
  createdAt: "2026-08-05T20:00:00.000Z",
  staleAt: "2026-08-06T07:00:00.000Z",
  freshness: "stale",
  copyEligible: false
}];

const PREVIEW_DEMO_DETAIL: DashboardReportDetail = {
  ...PREVIEW_DEMO_REPORTS[0],
  report: {
    requirements: [{ requirementId: "req_1", requirementText: "Requirement req_1", status: "partial", evidenceRefs: ["ev_12", "ev_18"], gaps: ["Evidence gap recorded."] }],
    testing: { ciStatus: "passed", lintStatus: "unknown", typecheckStatus: "pending" },
    reviewPriority: [{ path: "src/checkout/validation.ts", priority: "medium" }],
    evidenceIndex: [{ id: "ev_12", locator: "src/checkout/validation.ts" }],
    reprompt: { prompt: "Add bounded evidence for the requirement, then rerun the relevant check." },
    semantic: {
      requirement_evidence_relations: [],
      requirement_assessments: [{ requirement_id: "req_1", requirement_summary: "Validate the submitted checkout data before processing.", evidence_support: "partial_evidence_present", summary: "The supplied evidence covers the main validation path, but does not show focused coverage for the exceptional path.", evidence_ids: ["ev_12"], uncertainty: "medium" }],
      evidence_gaps: [{ requirement_id: "req_1", gap_type: "missing_test_evidence", priority: "high", description: "A focused test for the exceptional input path is not available.", review_impact: "The reviewer cannot trace that path from the supplied evidence.", needed_evidence: "A focused test or execution reference.", evidence_ids: ["ev_12"], uncertainty: "medium" }],
      review_targets: [{ target_type: "file", target_evidence_id: "ev_12", priority: "high", reason: "This file contains the validation branch relevant to the requirement.", inspection_goal: "Confirm how exceptional input is handled.", requirement_ids: ["req_1"], evidence_ids: ["ev_12"], uncertainty: "medium" }],
      remediation_requests: [{ requirement_id: "req_1", request_type: "add_or_update_test", priority: "high", instruction: "Add or link focused evidence for the exceptional input path.", rationale: "The supplied evidence does not directly exercise that path.", expected_evidence: "A focused test and its associated execution evidence.", evidence_ids: ["ev_12"], uncertainty: "medium" }],
      uncertainties: []
    }
  }
};

const PREVIEW_DEMO_ACTIVITY: DashboardActivityEvent[] = [{
  id: "report:preview-report-current",
  kind: "report_ready",
  occurredAt: "2026-08-06T07:00:00.000Z",
  state: "Analysis ready",
  repositoryId: 101,
  pullRequestNumber: 42,
  headShaPrefix: "7cf2a98bf1d4",
  reportId: "preview-report-current"
}, {
  id: "report:preview-report-stale",
  kind: "report_stale",
  occurredAt: "2026-08-06T07:00:00.000Z",
  state: "Report stale",
  repositoryId: 101,
  pullRequestNumber: 42,
  headShaPrefix: "1b7a6e35b3ac",
  reportId: "preview-report-stale"
}];

export function PublicGitHubDashboard({ installationId, previewDemoEnabled = false }: { installationId?: string; previewDemoEnabled?: boolean }) {
  const [demoMode] = useState(previewDemoEnabled);
  const [signedIn, setSignedIn] = useState(previewDemoEnabled);
  const [activeInstallationId, setActiveInstallationId] = useState(installationId);
  const [existingInstallations, setExistingInstallations] = useState<ExistingInstallation[]>([]);
  const [repositorySelection, setRepositorySelection] = useState<RepositorySelectionLoadResult>({ status: "idle", repositories: [], message: "" });
  const [repositorySelectionReload, setRepositorySelectionReload] = useState(0);
  const [connectedRepositories, setConnectedRepositories] = useState<DashboardRepositoryGrant[]>(previewDemoEnabled ? PREVIEW_DEMO_REPOSITORIES : []);
  const [connectionsLoaded, setConnectionsLoaded] = useState(previewDemoEnabled);
  const [repositorySelectionPending, setRepositorySelectionPending] = useState(false);
  const [privateRepositoryChoice, setPrivateRepositoryChoice] = useState<Repository | null>(null);
  const [commentEnabledOnConnect, setCommentEnabledOnConnect] = useState(false);
  const [hybridPlannerConsentOnConnect, setHybridPlannerConsentOnConnect] = useState(false);
  const [message, setMessage] = useState(previewDemoEnabled ? "Preview demo: sample data only. No GitHub, database, or comment action will run." : "Sign in with GitHub to start.");
  const [reports, setReports] = useState<DashboardSavedReport[]>(previewDemoEnabled ? PREVIEW_DEMO_REPORTS : []);
  const [activity, setActivity] = useState<DashboardActivityEvent[]>(previewDemoEnabled ? PREVIEW_DEMO_ACTIVITY : []);
  const [detail, setDetail] = useState<DashboardReportDetail | null>(previewDemoEnabled ? PREVIEW_DEMO_DETAIL : null);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<number | undefined>(previewDemoEnabled ? 101 : undefined);
  const [screen, setScreen] = useState<WorkspaceScreen>("repositories");
  const [showDetailedEvidence, setShowDetailedEvidence] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxSeenAt, setInboxSeenAt] = useState<string | null>(null);
  const [settingsPending, setSettingsPending] = useState<string | null>(null);
  const [logoutPending, setLogoutPending] = useState(false);
  const [bulkCopyState, setBulkCopyState] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const [bulkCopyCount, setBulkCopyCount] = useState(0);
  const [reportListExpanded, setReportListExpanded] = useState(false);
  const repositorySelectionGate = useRef(createRepositorySelectionGate());

  const repositoryRows = useMemo(
    () => toRepositoryWorkspaceRows(connectedRepositories, reports),
    [connectedRepositories, reports]
  );
  const selectedRepository = repositoryRows.find((repository) => repository.repositoryId === selectedRepositoryId) ?? repositoryRows[0];
  const selectedReports = visibleRepositoryReports(reports, selectedRepository?.repositoryId);
  const displayedReports = reportListExpanded
    ? selectedReports
    : selectedReports.slice(0, DASHBOARD_REPORT_LIST_LIMIT);
  const copyableSelectedReports = selectedReports.filter(isCopyEligibleReport);
  const hasUnavailableSelectedReport = selectedReports.some((report) => report.availability === "unavailable");
  const selectedRepositoryName = selectedRepository?.repositoryFullName;
  const quickSummary = detail
    ? toQuickSummary({ ...detail, repositoryFullName: repositoryLabel(detail.repositoryId, connectedRepositories) })
    : null;
  const unreadActivityCount = activity.filter((event) => !inboxSeenAt || event.occurredAt > inboxSeenAt).length;

  useEffect(() => {
    setReportListExpanded(false);
  }, [selectedRepository?.repositoryId]);

  useEffect(() => {
    if (demoMode) {
      setSignedIn(true);
      setConnectedRepositories(PREVIEW_DEMO_REPOSITORIES);
      setReports(PREVIEW_DEMO_REPORTS);
      setActivity(PREVIEW_DEMO_ACTIVITY);
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
          void refreshActivity();
          void refreshConnectedRepositories();
        }
      })
      .catch(() => { if (!cancelled) setMessage("Session status is temporarily unavailable."); });
    return () => { cancelled = true; };
  }, [demoMode]);

  useEffect(() => {
    if (demoMode || !signedIn || !activeInstallationId) return;
    let cancelled = false;
    setRepositorySelection({ status: "loading", repositories: [], message: "Loading repositories from your AgentProof App installation." });
    fetch(`/api/github/onboarding/repositories?installationId=${encodeURIComponent(activeInstallationId)}`, { cache: "no-store" })
      .then(async (response) => ({
        status: response.status,
        payload: await response.json().catch(() => null)
      }))
      .then((result) => {
        if (cancelled) return;
        const next = resolveRepositorySelectionLoad(result);
        setRepositorySelection(next);
        setMessage(next.message);
      })
      .catch(() => {
        if (cancelled) return;
        const next = resolveRepositorySelectionLoad({ status: 0, payload: null });
        setRepositorySelection(next);
        setMessage(next.message);
      });
    return () => { cancelled = true; };
  }, [activeInstallationId, demoMode, repositorySelectionReload, signedIn]);

  useEffect(() => {
    setActiveInstallationId(installationId);
  }, [installationId]);

  useEffect(() => {
    const stored = window.localStorage.getItem("agentproof:inbox-seen-at");
    if (stored && !Number.isNaN(Date.parse(stored))) setInboxSeenAt(stored);
  }, []);

  useEffect(() => {
    if (demoMode || !signedIn) return;
    const refreshVisibleWorkspace = () => {
      if (document.visibilityState === "visible") {
        void refreshReports();
        void refreshActivity();
        void refreshConnectedRepositories();
      }
    };
    const intervalId = window.setInterval(refreshVisibleWorkspace, DASHBOARD_REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", refreshVisibleWorkspace);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refreshVisibleWorkspace);
    };
  }, [demoMode, signedIn]);

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

  async function refreshActivity() {
    if (demoMode) {
      setActivity(PREVIEW_DEMO_ACTIVITY);
      return;
    }
    try {
      const response = await fetch("/api/dashboard/activity", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      setActivity(response.ok && Array.isArray(body?.activity) ? body.activity : []);
    } catch {
      setActivity([]);
    }
  }

  function toggleInbox() {
    const opening = !inboxOpen;
    setInboxOpen(opening);
    if (opening) {
      const seenAt = new Date().toISOString();
      setInboxSeenAt(seenAt);
      window.localStorage.setItem("agentproof:inbox-seen-at", seenAt);
    }
  }

  async function openActivity(event: DashboardActivityEvent) {
    setInboxOpen(false);
    const repository = connectedRepositories.find((item) =>
      item.repositoryId === event.repositoryId || item.repositoryFullName === event.repositoryFullName
    );
    if (repository?.repositoryId) setSelectedRepositoryId(repository.repositoryId);
    if (event.kind === "report_stale") {
      if (event.reportId) {
        setMessage("Showing this previous result.");
        await openReport(event.reportId);
      } else {
        setMessage("This previous result is no longer available.");
      }
      return;
    }
    if (event.reportId) {
      await openReport(event.reportId);
      return;
    }
    const repositoryName = event.repositoryFullName ?? repositoryLabel(event.repositoryId, connectedRepositories) ?? "The repository";
    const failureDetail = event.failure?.summary ?? event.failure?.code;
    const failureSummary = failureDetail ? ` Analysis refresh failed: ${failureDetail}` : "";
    setMessage(`${repositoryName} PR #${event.pullRequestNumber ?? "unknown"}: ${event.state}.${failureSummary}`);
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
      } else {
        setConnectedRepositories([]);
        setMessage(dashboardRepositoryLoadFailureMessage(response.status, body?.code));
      }
    } catch {
      setConnectedRepositories([]);
      setMessage(dashboardRepositoryLoadFailureMessage(undefined, undefined));
    } finally {
      setConnectionsLoaded(true);
    }
  }

  async function login() {
    if (demoMode) return;
    const response = await fetch("/api/auth/github/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const body = await response.json().catch(() => null);
    if (body?.code === "github_oauth_callback_origin_mismatch" && typeof body?.dashboardUrl === "string") {
      setMessage("Opening the configured AgentProof address for secure GitHub sign-in.");
      window.location.assign(body.dashboardUrl);
      return;
    }
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
      setRepositorySelection({ status: "loading", repositories: [], message: "Loading repositories from your AgentProof App installation." });
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
      setRepositorySelection({ status: "loading", repositories: [], message: "Loading repositories from your AgentProof App installation." });
      setActiveInstallationId(String(body.installationId));
      setMessage("Loading repositories from your existing AgentProof App installation.");
    } else setMessage("That GitHub App installation could not be verified. Reconnect GitHub and try again.");
  }

  async function selectRepository(repository: Repository, llmAnalysisMode: "essential" | "enhanced") {
    if (!repositorySelectionGate.current.tryStart()) return;
    setRepositorySelectionPending(true);
    try {
      const response = await fetch("/api/github/onboarding/repositories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installationId: Number(activeInstallationId), repositoryId: repository.id, saveReportsEnabled: true, commentEnabled: commentEnabledOnConnect, llmAnalysisMode, hybridPlannerConsent: repository.private && hybridPlannerConsentOnConnect })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        repositorySelectionGate.current.reset();
        setMessage(githubRepositoryConnectionFailureMessage(body?.code));
        return;
      }
      setRepositorySelection({ status: "idle", repositories: [], message: "" });
      setActiveInstallationId(undefined);
      setConnectedRepositories((current) => mergeConnectedRepository(current, {
        installationId: Number(activeInstallationId),
        repositoryId: repository.id,
        repositoryFullName: repository.fullName,
        enabled: true,
         analysisEnabled: body?.settings?.analysisEnabled === true,
         saveReportsEnabled: body?.settings?.saveReportsEnabled === true,
         commentEnabled: body?.settings?.commentEnabled === true,
         llmAnalysisMode: body?.settings?.llmAnalysisMode === "enhanced" ? "enhanced" : "essential",
         hybridPlannerConsentVersion: body?.settings?.hybridPlannerConsentVersion === "2026-08-12.v1" ? "2026-08-12.v1" : null
      }));
      setSelectedRepositoryId(repository.id);
      setConnectionsLoaded(true);
       setPrivateRepositoryChoice(null);
       setHybridPlannerConsentOnConnect(false);
       setMessage(`${repository.fullName} is connected. PR events will create an evidence report.`);
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
      setDetail({ ...body, id });
      setShowDetailedEvidence(false);
      return;
    }
    setMessage("Report could not be opened.");
  }

  async function copySelectedRepositoryReports() {
    const repositoryId = selectedRepository?.repositoryId;
    if (!selectedRepository || !repositoryId || copyableSelectedReports.length === 0 || bulkCopyState === "copying") return;
    setBulkCopyState("copying");
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15_000);
    try {
      let copiedCount = 0;
      await writeDeferredTextWithBrowserFallback({
        loadText: async () => {
          const details = demoMode
            ? copyableSelectedReports.map((report) => ({ ...PREVIEW_DEMO_DETAIL, ...report, repositoryFullName: selectedRepository.repositoryFullName }))
            : await prepareCurrentDashboardBundleForCopy({
              repositoryId,
              repositoryFullName: selectedRepository.repositoryFullName,
              fetchBundle: async () => {
                const response = await fetch(`/api/dashboard/reports?repositoryId=${encodeURIComponent(String(repositoryId))}&scope=current`, { cache: "no-store", signal: controller.signal });
                if (!response.ok) throw new Error("dashboard_reports_unavailable");
                return response.json().catch(() => null);
              }
            });
          copiedCount = details.length;
          return dashboardReportsToMarkdown(details);
        }
      });
      setBulkCopyCount(copiedCount);
      setBulkCopyState("copied");
      setMessage(`Copied ${copiedCount} current report${copiedCount === 1 ? "" : "s"} from ${selectedRepository.repositoryFullName}.`);
    } catch (error) {
      setBulkCopyState("error");
      if (isBulkCopyPreparationError(error)) {
        setMessage("Current reports could not be prepared. Refresh reports and try again.");
      } else {
        setMessage("Copy is blocked in this browser. Try again after refreshing the page.");
      }
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  function isBulkCopyPreparationError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return error.name === "AbortError" || error.message === "dashboard_reports_unavailable" || error.message.startsWith("Dashboard report bundle");
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

  async function logout() {
    if (demoMode) {
      setMessage("Preview demo stays local. No session was ended.");
      return;
    }
    setLogoutPending(true);
    try {
      const response = await fetch("/api/tenants/auth/session", {
        method: "DELETE",
        headers: { "x-agentproof-csrf": "same-origin" }
      });
      if (!response.ok) {
        setMessage("Your session could not be ended. Try again.");
        return;
      }
      window.localStorage.removeItem("agentproof:inbox-seen-at");
      setSignedIn(false);
      setConnectedRepositories([]);
      setReports([]);
      setActivity([]);
      setDetail(null);
      setInboxOpen(false);
      setInboxSeenAt(null);
      setMessage("You are signed out of AgentProof.");
    } catch {
      setMessage("Your session could not be ended. Try again.");
    } finally {
      setLogoutPending(false);
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
        <div className="dashboard-top-actions"><button className="dashboard-icon-button dashboard-inbox-action" aria-label="Open Inbox" aria-expanded={inboxOpen} onClick={toggleInbox}><Bell size={18} />{unreadActivityCount > 0 ? <span className="dashboard-unread-badge">{Math.min(unreadActivityCount, 9)}</span> : null}</button><button className="dashboard-text-action dashboard-settings-action" onClick={() => setScreen(screen === "settings" ? "repositories" : "settings")}><Settings2 size={16} /> {screen === "settings" ? "Reports" : "Settings"}</button><button className="dashboard-icon-button" aria-label="Refresh reports" onClick={() => { void refreshReports(); void refreshActivity(); }}><Clock3 size={18} /></button></div>
      </header>
      <p className="dashboard-message" role="status">{message}</p>
      {demoMode ? <p className="dashboard-demo-banner"><Info size={15} /> Preview demo · sample data only · GitHub, database, and comments are disabled.</p> : null}
      {inboxOpen ? <section className="dashboard-inbox" aria-label="Inbox"><div className="dashboard-section-heading"><div><p className="dashboard-eyebrow">INBOX</p><h3>Recent activity</h3><p className="dashboard-section-copy">New analyses, pending work, and previous-result notices from your connected repositories.</p></div></div>{activity.length > 0 ? <div className="installation-list">{activity.map((event) => <button className="dashboard-list-row dashboard-activity-row" key={event.id} onClick={() => { void openActivity(event); }}>{event.kind === "report_stale" ? <span className="dashboard-activity-icon" aria-label="Previous result" title="Previous result"><History size={16} /></span> : <StatusToken label={event.state} />}<span><strong>{event.repositoryFullName ?? repositoryLabel(event.repositoryId, connectedRepositories) ?? "Connected repository"} · PR #{event.pullRequestNumber ?? "Unknown"}</strong><small>{event.kind === "report_stale" ? "Previous result · newer commit received" : `${formatCreatedAt(event.occurredAt)} · head ${event.headShaPrefix ?? "unknown"}`}</small>{event.failure?.summary ?? event.failure?.code ? <small>Analysis refresh failed · {event.failure?.summary ?? event.failure?.code}</small> : null}</span><ChevronRight size={16} /></button>)}</div> : <p className="dashboard-empty">No recent activity.</p>}</section> : null}

      {screen === "repositories" ? <>
        <section className="dashboard-section dashboard-repository-strip" aria-labelledby="connected-repositories-title">
          <div className="dashboard-section-heading"><div><p className="dashboard-eyebrow">CONNECTIONS</p><h3 id="connected-repositories-title">Connected repositories</h3></div>{signedIn && !activeInstallationId ? <button className="dashboard-text-action" onClick={install}><Link2 size={15} /> {demoMode ? "Sample repository" : "Connect repository"}</button> : null}</div>
          {!connectionsLoaded ? <p className="dashboard-empty"><Loader2 size={16} className="spin" /> Loading connected repositories</p> : repositoryRows.length > 0 ? <div className="repository-tabs">{repositoryRows.map((repository) => <button key={`${repository.installationId}:${repository.repositoryId ?? repository.repositoryFullName}`} className={repository.repositoryId === selectedRepository?.repositoryId ? "repository-tab active" : "repository-tab"} onClick={() => { setSelectedRepositoryId(repository.repositoryId); setDetail(null); setBulkCopyCount(0); setBulkCopyState("idle"); setReportListExpanded(false); }}><span>{repository.repositoryFullName}</span><small>{repository.analysisEnabled ? "Analysis on" : "Analysis off"} · {repository.commentsEnabled ? "Comments on" : "Comments off"}</small></button>)}</div> : <p className="dashboard-empty">No repository is connected yet.</p>}
        </section>

        {existingInstallations.length > 0 ? <section className="dashboard-section"><div className="dashboard-section-heading"><div><p className="dashboard-eyebrow">GITHUB APP</p><h3>Choose an installation</h3></div></div><div className="installation-list">{existingInstallations.map((installation) => <button key={installation.installationId} className="dashboard-list-row" onClick={() => { void activateExistingInstallation(installation.installationId); }}><Github size={17} /> {installation.accountLogin}<ChevronRight size={16} /></button>)}</div></section> : null}

         {repositorySelection.status !== "idle" ? <section className="dashboard-section"><div className="dashboard-section-heading"><div><p className="dashboard-eyebrow">REPOSITORY ACCESS</p><h3>Select a repository</h3></div></div>{repositorySelection.status === "loading" ? <p className="dashboard-empty"><Loader2 size={16} className="spin" /> Loading repositories</p> : null}{repositorySelection.status === "ready" ? <><label className="dashboard-toggle-row"><span><strong>Summary comments</strong><small>Off by default. Only summary-only comments are posted.</small></span><input type="checkbox" checked={commentEnabledOnConnect} onChange={(event) => setCommentEnabledOnConnect(event.target.checked)} /></label><div className="installation-list">{repositorySelection.repositories.map((repository) => <button key={repository.id} className="dashboard-list-row" disabled={repositorySelectionPending} onClick={() => { if (repository.private) setPrivateRepositoryChoice(repository); else void selectRepository(repository, "enhanced"); }}><FolderGit2 size={17} /> {repository.fullName}{repository.private ? <small>Private</small> : null}<ChevronRight size={16} /></button>)}</div></> : null}{repositorySelection.status === "empty" ? <p className="dashboard-empty">{repositorySelection.message}</p> : null}{repositorySelection.status === "error" ? <div className="dashboard-empty"><p>{repositorySelection.message}</p><button className="dashboard-secondary-action" onClick={() => setRepositorySelectionReload((current) => current + 1)}>Try again</button></div> : null}</section> : null}
         {privateRepositoryChoice ? <section className="analysis-choice-dialog" role="dialog" aria-modal="true" aria-labelledby="analysis-choice-title"><div><p className="dashboard-eyebrow">PRIVATE REPOSITORY</p><h3 id="analysis-choice-title">Choose analysis detail</h3><p>Enhanced analysis uses selected changed-code excerpts and evidence summaries to add a concise evidence reading.</p><label className="dashboard-toggle-row"><span><strong>Private enhanced planning consent</strong><small>Allow AgentProof to send bounded redacted private Issue and pull-request source spans to the configured provider for enhanced planning.</small></span><input type="checkbox" checked={hybridPlannerConsentOnConnect} onChange={(event) => setHybridPlannerConsentOnConnect(event.target.checked)} /></label></div><div className="analysis-choice-actions"><button className="dashboard-secondary-action" disabled={repositorySelectionPending} onClick={() => { void selectRepository(privateRepositoryChoice, "essential"); }}>Use essential analysis</button><button className="dashboard-primary-action" disabled={repositorySelectionPending} onClick={() => { void selectRepository(privateRepositoryChoice, "enhanced"); }}>Enable enhanced analysis</button></div></section> : null}

        <section className="dashboard-workspace">
          <div className="dashboard-section-heading"><div><p className="dashboard-eyebrow">{selectedRepositoryName ?? "SELECT A REPOSITORY"}</p><h3>Repository reports</h3><p className="dashboard-section-copy">Saved evidence reports from this connected repository.</p></div><button className="dashboard-text-action" disabled={copyableSelectedReports.length === 0 || hasUnavailableSelectedReport || bulkCopyState === "copying"} onClick={() => { void copySelectedRepositoryReports(); }}><Clipboard size={15} /> {bulkCopyState === "copying" ? "Preparing reports…" : bulkCopyState === "copied" ? `Copied ${bulkCopyCount} reports` : bulkCopyState === "error" ? "Try copy again" : "Copy all reports"}</button></div>
          {!selectedRepository ? <p className="dashboard-empty">Connect a GitHub repository to review saved evidence reports.</p> : selectedReports.length === 0 ? <p className="dashboard-empty"><FileCheck2 size={20} /> No reports yet<br /><small>New PR events will appear here after analysis.</small></p> : <div className="dashboard-report-layout">
            <div className="report-list" aria-label="Saved analysis reports">{displayedReports.map((report) => <button key={report.id} className={detail?.pullRequestNumber === report.pullRequestNumber && detail?.headSha === report.headSha ? "report-row active" : "report-row"} disabled={report.availability === "unavailable" || report.availability === "analysis_failed"} title={report.availability === "unavailable" ? "This saved report cannot be opened right now. Run the analysis again if the state does not recover." : report.availability === "analysis_failed" ? "The latest analysis failed before AgentProof could save a report." : undefined} onClick={() => { void openReport(report.id); }}><span className="report-row-icon"><FileCheck2 size={17} /></span><span><strong>{report.availability === "unavailable" ? "REPORT UNAVAILABLE" : `PR #${report.pullRequestNumber ?? "Unknown"}`}</strong><small>{formatCreatedAt(report.createdAt)} · head {headPrefix(report.headSha)}</small>{report.freshness === "refresh_failed" ? <small>Analysis refresh failed{report.failure?.summary ?? report.failure?.code ? ` · ${report.failure?.summary ?? report.failure?.code}` : "."}</small> : null}</span><span className="report-row-meta"><StatusToken label={report.availability === "unavailable" ? "REPORT UNAVAILABLE" : reportWorkspaceStatusLabel(report.freshness)} title={report.availability === "unavailable" ? "This saved report cannot be opened right now. Run the analysis again if the state does not recover." : report.availability === "analysis_failed" ? "The latest analysis failed before AgentProof could save a report." : report.copyEligible ? "Latest saved report" : report.freshness === "refresh_failed" ? "A newer analysis failed before a report was saved." : "A newer analysis is still being prepared"} /><small><strong>Priority:</strong> {report.priority}</small></span></button>)}{selectedReports.length > DASHBOARD_REPORT_LIST_LIMIT ? <button className="dashboard-secondary-action" aria-expanded={reportListExpanded} onClick={() => setReportListExpanded((current) => !current)}>{reportListExpanded ? "Show fewer reports" : `Show all ${selectedReports.length} reports`}</button> : null}</div>
            {selectedReports.some((report) => report.availability === "unavailable") ? <p className="dashboard-boundary"><Info size={15} /> This saved report cannot be opened right now. Run the analysis again if the state does not recover.</p> : null}
            {copyableSelectedReports.length === 0 ? <p className="dashboard-boundary"><Info size={15} /> Reports remain available while an update runs. Copy is enabled when a current report is ready.</p> : null}
            {detail?.report && quickSummary ? <QuickSummaryPanel detail={{ ...detail, repositoryFullName: repositoryLabel(detail.repositoryId, connectedRepositories) }} quickSummary={quickSummary} onShowDetail={() => setShowDetailedEvidence((current) => !current)} showDetailedEvidence={showDetailedEvidence} demoMode={demoMode} /> : <div className="dashboard-empty dashboard-summary-placeholder"><Info size={20} /> Select a report to open its Quick Summary.</div>}
          </div>}
        </section>
      </> : <SettingsPanel repository={selectedRepository} pending={settingsPending} onUpdate={updateRepositorySetting} onLogout={logout} logoutPending={logoutPending} />}
    </div>

  </section>;
}

function QuickSummaryPanel({ detail, quickSummary, onShowDetail, showDetailedEvidence, demoMode }: { detail: DashboardReportDetail & { repositoryFullName?: string }; quickSummary: ReturnType<typeof toQuickSummary>; onShowDetail: () => void; showDetailedEvidence: boolean; demoMode: boolean }) {
  const report = detail.report;
  const firstRequirement = report?.requirements?.find((item) => item.gaps.length > 0) ?? report?.requirements?.[0];
  const githubUrl = quickSummary.githubUrl;
  return <article className="quick-summary">
    <header className="quick-summary-header"><div><p className="dashboard-eyebrow">QUICK SUMMARY</p><h3>PR #{detail.pullRequestNumber ?? "Unknown"}</h3><p>Head <code>{headPrefix(detail.headSha)}</code> · Analyzed {detail.createdAt ? formatCreatedAt(detail.createdAt) : "unknown time"}</p></div><div className="summary-badges"><StatusToken label={quickSummary.freshness} /><StatusToken label={`Priority: ${detail.priority ?? "unknown"}`} /></div></header>
    <div className="summary-status-grid"><SummaryState label="Report state" value={quickSummary.freshness} /><SummaryState label="Check state" value={quickSummary.checkState} /><SummaryState label="Evidence" value={quickSummary.primaryEvidenceState} /><SummaryState label="Analysis" value={quickSummary.aiEvidenceState} /><SummaryState label="Inspect first" value={quickSummary.inspectFirst} mono /></div>
    <section className="summary-callout"><CircleAlert size={19} /><div><p className="dashboard-eyebrow">MOST IMPORTANT EVIDENCE GAP</p><strong>{quickSummary.primaryEvidenceState}</strong><p>{quickSummary.primaryEvidenceDetail ?? (firstRequirement ? `Requirement ${firstRequirement.requirementId} is ${toRequirementCoverageLabel(firstRequirement.status).toLowerCase()}. More proof is needed before it is fully supported.` : "No requirement evidence is available in this saved report.")}</p></div></section>
    {report?.semanticAnalysis?.status === "unavailable" ? <p className="dashboard-boundary"><Info size={15} /> Some supporting details are unavailable. Available evidence is still shown.</p> : null}
    {report?.planner ? <p className="dashboard-boundary"><Info size={15} /> Enhanced planning policy</p> : null}
    <div className="summary-actions">{githubUrl ? <a className="dashboard-secondary-action" href={githubUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open in GitHub</a> : <span className="dashboard-disabled-action">GitHub link unavailable</span>}<button className="dashboard-primary-action" onClick={onShowDetail}>{showDetailedEvidence ? "Hide detailed evidence" : "View detailed evidence"}</button></div>
    {showDetailedEvidence ? <DetailedEvidence detail={detail} demoMode={demoMode} /> : null}
    <p className="dashboard-boundary"><ShieldCheck size={15} /> This report organizes available evidence. It does not establish correctness, safety, requirement satisfaction, or merge readiness.</p>
  </article>;
}

function DetailedEvidence({ detail, demoMode }: { detail: DashboardReportDetail & { repositoryFullName?: string }; demoMode: boolean }) {
  const report = detail.report;
  const semantic = report?.semantic;
  const requirementCards = toDashboardRequirementViewModels({
    requirements: report?.requirements,
    semantic,
    semanticAnalysis: report?.semanticAnalysis,
    verificationContract: report?.verificationContract
  });
  const [copiedFormat, setCopiedFormat] = useState<"markdown" | "json" | null>(null);
  const [copyError, setCopyError] = useState(false);
  const copyUnavailable = !demoMode && !isCopyEligibleReport(detail);
  const copyUnavailableMessage = detail.freshness === "refreshing"
    ? "A newer analysis is updating. This saved report remains readable and can be copied when the update finishes."
    : "This saved report is not the current copyable version.";

  async function copyReport(format: "markdown" | "json") {
    try {
      if (demoMode) {
        await writeTextWithBrowserFallback(format === "markdown" ? dashboardReportToMarkdown(detail) : dashboardReportToJson(detail));
      } else {
        if (!detail.id || !detail.repositoryFullName) throw new Error("dashboard_report_copy_identity_missing");
        const toText = (currentDetail: DashboardReportDetail & { repositoryFullName?: string }) => format === "markdown"
          ? dashboardReportToMarkdown(currentDetail)
          : dashboardReportToJson(currentDetail);
        await writeDeferredTextWithBrowserFallback({
          fallbackText: toText({ ...detail, repositoryFullName: detail.repositoryFullName }),
          loadText: async () => toText(await prepareCurrentDashboardDetailForCopy({
            id: detail.id!,
            repositoryFullName: detail.repositoryFullName!,
            fetchDetail: fetchDashboardCopyDetail
          }))
        });
      }
      setCopyError(false);
      setCopiedFormat(format);
      window.setTimeout(() => setCopiedFormat(null), 1_600);
    } catch {
      setCopyError(true);
      setCopiedFormat(null);
    }
  }

  return <section className="detailed-evidence"><div className="dashboard-section-heading"><div><p className="dashboard-eyebrow">DETAILED EVIDENCE</p><h4>Requirement coverage and supporting evidence</h4></div><div className="detailed-evidence-actions"><button className="dashboard-secondary-action" disabled={copyUnavailable} onClick={() => { void copyReport("markdown"); }}><Clipboard size={15} /> {copiedFormat === "markdown" ? "Copied" : "Copy report"}</button><button className="dashboard-secondary-action" disabled={copyUnavailable} onClick={() => { void copyReport("json"); }}><Clipboard size={15} /> {copiedFormat === "json" ? "Copied" : "Copy JSON"}</button></div></div>{copyUnavailable ? <p className="dashboard-boundary"><Info size={15} /> {copyUnavailableMessage}</p> : null}{copyError ? <p className="dashboard-boundary"><Info size={15} /> Copy failed in this browser. Select the report text manually.</p> : null}<div className="detail-grid"><section className="requirement-evidence-section"><h5>Requirements and PR objectives</h5>{requirementCards.length > 0 ? <RequirementEvidenceList requirements={requirementCards} /> : <p className="dashboard-empty">Unavailable</p>}</section><section><h5>Checks & CI</h5><div className="detail-row"><span>CI</span><strong>{report?.testing?.ciStatus ?? "unavailable"}</strong></div><div className="detail-row"><span>Lint</span><strong>{report?.testing?.lintStatus ?? "unavailable"}</strong></div><div className="detail-row"><span>Typecheck</span><strong>{report?.testing?.typecheckStatus ?? "unavailable"}</strong></div></section><section><h5>Priority files</h5>{report?.reviewPriority?.length ? report.reviewPriority.map((item) => <div className="detail-row" key={item.path}><code>{item.path}</code><span>{item.priority}</span></div>) : <p className="dashboard-empty">Unavailable</p>}</section><section><h5>Suggested next step</h5><p className="agent-request">{report?.reprompt?.prompt ?? "Unavailable"}</p></section></div></section>;
}

async function fetchDashboardCopyDetail(id: string): Promise<DashboardReportDetail | null> {
  const response = await fetch(`/api/dashboard/reports?id=${encodeURIComponent(id)}`, { cache: "no-store" });
  const detail = await response.json().catch(() => null);
  return response.ok ? detail : null;
}

function SettingsPanel({ repository, pending, onUpdate, onLogout, logoutPending }: { repository: ReturnType<typeof toRepositoryWorkspaceRows>[number] | undefined; pending: string | null; onUpdate: (setting: RepositorySetting, nextValue: boolean) => Promise<void>; onLogout: () => Promise<void>; logoutPending: boolean }) {
  return <section className="dashboard-workspace settings-panel">{repository ? <><div className="dashboard-section-heading"><div><p className="dashboard-eyebrow">{repository.repositoryFullName}</p><h3>Repository settings</h3><p className="dashboard-section-copy">These settings apply only to this connected repository.</p></div></div><SettingToggle label="Automatic analysis" detail="Create an evidence report for supported PR events." checked={repository.analysisEnabled} pending={pending === "analysisEnabled"} onChange={(value) => onUpdate("analysisEnabled", value)} /><SettingToggle label="Saved reports" detail="Retain the bounded report fields allowed by the privacy policy." checked={repository.saveReportsEnabled} pending={pending === "saveReportsEnabled"} onChange={(value) => onUpdate("saveReportsEnabled", value)} /><SettingToggle label="Summary comments" detail={repository.commentEnabled ? "Comments are enabled for this repository." : "Comments are off by default. Enable only with repository-level consent."} checked={repository.commentEnabled} pending={pending === "commentEnabled"} onChange={(value) => onUpdate("commentEnabled", value)} />{repository.repositoryPrivate === true && repository.llmAnalysisMode === "enhanced" ? <SettingToggle label="Private enhanced planning consent" detail="Allow AgentProof to send bounded redacted private Issue and pull-request source spans to the configured provider for enhanced planning." checked={repository.hybridPlannerConsentVersion === "2026-08-12.v1"} pending={pending === "hybridPlannerConsent"} onChange={(value) => onUpdate("hybridPlannerConsent", value)} /> : null}</> : <p className="dashboard-empty">Connect and select a repository before changing repository settings.</p>}<div className="dashboard-section-heading dashboard-account-settings"><div><p className="dashboard-eyebrow">ACCOUNT</p><h3>AgentProof session</h3><p className="dashboard-section-copy">Ends this dashboard session only. Your GitHub account and App installation are unchanged.</p></div><button className="dashboard-secondary-action" disabled={logoutPending} onClick={() => { void onLogout(); }}>{logoutPending ? "Signing out…" : "Log out"}</button></div><p className="dashboard-boundary"><ShieldCheck size={15} /> Changes require your signed-in owner or admin session. GitHub comments never include raw diffs, logs, tokens, or full report content.</p></section>;
}

function SettingToggle({ label, detail, checked, pending, onChange }: { label: string; detail: string; checked: boolean; pending: boolean; onChange: (value: boolean) => void }) {
  return <label className="dashboard-toggle-row"><span><strong>{label}</strong><small>{detail}</small></span><input type="checkbox" checked={checked} disabled={pending} onChange={(event) => onChange(event.target.checked)} /></label>;
}

function SummaryState({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><p>{label}</p><strong className={mono ? "mono" : undefined}>{value}</strong></div>;
}

function StatusToken({ label, title }: { label: string; title?: string }) {
  const failed = /failed|attention/i.test(label);
  const pending = /pending|updating|refresh/i.test(label);
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
