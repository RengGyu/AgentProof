"use client";
import {reportCopy} from "./report-copy";
import { webWorkspaceClient, type WorkspaceClient } from "@/lib/workspace-client";
import { presentOrdinaryDocumentationSummary } from "@/lib/general-pr-documentation-presentation";
import { presentOrdinaryStaticSummary } from "@/lib/general-pr-static-types-presentation";

import { useEffect, useMemo, useRef, useState } from "react";
import { RepositoryCommitBrowser, RepositoryPullRequestWorkspace, type PullRequestWorkspaceCache } from "./RepositoryCommitBrowser";
import { ReportTopSummary, type CodeOrigin } from "./ReportTopSummary";
import { DiffEvidenceMark } from "./DiffEvidenceMark";
import { settingsCopy, type SettingsCopy } from "./settings-copy";
import { WorkspaceSignIn } from "./WorkspaceSignIn";
import { ReportCodeViewer, clearReportCodeCache } from "./ReportCodeViewer";
import { citedPurposeReferences, PurposeCodeEvidence, readablePurposeReferenceIds, type CodeSelection } from "./PurposeCodeEvidence";
import {
  ArrowLeft,
  Bell,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  Clock3,
  ExternalLink,
  FileCheck2,
  FileText,
  FolderGit2,
  Github,
  History,
  Info,
  Link2,
  Loader2,
  RotateCw,
  Settings,
  X,
  XCircle
} from "lucide-react";
import type { DashboardActivityEvent } from "@/lib/dashboard-activity";
import {
  isActiveRepositoryGrant,
  dashboardAnalysisFailureMessage,
  observedCheckResults,
  toQuickSummary,
  toRepositoryWorkspaceRows,
  type DashboardReportDetail,
  type DashboardRepositoryGrant,
  type DashboardSavedReport
} from "@/lib/github-dashboard-view-model";
import { toDashboardRequirementViewModels } from "@/lib/dashboard-requirement-view-model";
import { presentGeneralPrAssessmentSummary } from "@/lib/general-pr-assessment-presentation";
import { RequirementEvidenceList } from "@/components/RequirementEvidenceList";
import { PrEvidenceReview } from "@/components/PrEvidenceReview";
import { buildDashboardPrEvidenceReview, buildDashboardCodeItems } from "@/lib/pr-evidence-review";
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
import type { ReportLanguage } from "@/lib/tenant-report-language";
import { dashboardReportToJson, dashboardReportToMarkdown, selectedReportToText } from "@/lib/dashboard-report-export";
import { prepareCurrentDashboardDetailForCopy } from "@/lib/dashboard-copy-revalidation";
import { writeDeferredTextWithBrowserFallback, writeTextWithBrowserFallback } from "@/lib/browser-clipboard";
import { isCopyEligibleReport, partitionVisibleRepositoryReports, reportWorkspaceStatusLabel } from "@/lib/dashboard-report-list";

interface Repository { id: number; fullName: string; private: boolean; }
interface ExistingInstallation { installationId: number; accountLogin: string; }
type WorkspaceScreen = "repositories" | "settings";
type RepositorySetting = "analysisEnabled" | "saveReportsEnabled" | "commentEnabled" | "hybridPlannerConsent" | "reportLanguage";
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
  copyEligible: true,
  verificationOutcome: "partial"
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

export function PublicGitHubDashboard({ installationId, previewDemoEnabled = false, runtime = webWorkspaceClient, initialReportId }: { installationId?: string; previewDemoEnabled?: boolean; runtime?: WorkspaceClient; initialReportId?: string }) {
  const [demoMode] = useState(previewDemoEnabled);
  const [signedIn, setSignedIn] = useState(previewDemoEnabled);
  const [sessionStatus, setSessionStatus] = useState<"checking" | "ready" | "error">(previewDemoEnabled ? "ready" : "checking");
  const [activeInstallationId, setActiveInstallationId] = useState(installationId);
  const [existingInstallations, setExistingInstallations] = useState<ExistingInstallation[]>([]);
  const [repositorySelection, setRepositorySelection] = useState<RepositorySelectionLoadResult>({ status: "idle", repositories: [], message: "" });
  const [repositorySelectionReload, setRepositorySelectionReload] = useState(0);
  const [connectedRepositories, setConnectedRepositories] = useState<DashboardRepositoryGrant[]>(previewDemoEnabled ? PREVIEW_DEMO_REPOSITORIES : []);
  const [repositoriesLoading, setRepositoriesLoading] = useState(!previewDemoEnabled);
  const [reportsLoading, setReportsLoading] = useState(!previewDemoEnabled);
  const [activityLoading, setActivityLoading] = useState(!previewDemoEnabled);
  const [repositoriesError, setRepositoriesError] = useState("");
  const [inboxActionError, setInboxActionError] = useState("");
  const [repositorySelectionPending, setRepositorySelectionPending] = useState(false);
  const [privateRepositoryChoice, setPrivateRepositoryChoice] = useState<Repository | null>(null);
  const privateChoiceRef = useRef<HTMLElement>(null);
  // An aria-modal choice takes focus when it opens, which also brings it into view.
  useEffect(() => { if (privateRepositoryChoice) privateChoiceRef.current?.focus(); }, [privateRepositoryChoice?.id]);
  const [commentEnabledOnConnect, setCommentEnabledOnConnect] = useState(false);
  const [hybridPlannerConsentOnConnect, setHybridPlannerConsentOnConnect] = useState(false);
  const [privateAnalysisConsentOnConnect, setPrivateAnalysisConsentOnConnect] = useState(false);
  const [message, setMessage] = useState("");
  const [reportsError, setReportsError] = useState("");
  const [activityError, setActivityError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<DashboardActivityEvent | null>(null);
  const repositoriesRequest = useRef(0);
  const reportsRequest = useRef(0);
  const activityRequest = useRef(0);
  const detailRequest = useRef(0);
  const accountEpoch = useRef(0);
  const clearingInbox = useRef(false);
  const inboxCutoff = useRef<string | null>(null);
  const [inboxClearPending, setInboxClearPending] = useState(false);
  const [reportLoad, setReportLoad] = useState<{ id: string; state: "loading" | "unavailable" } | null>(null);
  const [reports, setReports] = useState<DashboardSavedReport[]>(previewDemoEnabled ? PREVIEW_DEMO_REPORTS : []);
  const [activity, setActivity] = useState<DashboardActivityEvent[]>(previewDemoEnabled ? PREVIEW_DEMO_ACTIVITY : []);
  const [loadedDetail, setDetail] = useState<DashboardReportDetail | null>(previewDemoEnabled ? PREVIEW_DEMO_DETAIL : null);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<number | undefined>(previewDemoEnabled ? 101 : undefined);
  const [screen, setScreen] = useState<WorkspaceScreen>("repositories");
  const [showDetailedEvidence, setShowDetailedEvidence] = useState(false);
  const [reportPickerOpen, setReportPickerOpen] = useState(false);
  const [repositoryPickerOpen, setRepositoryPickerOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [readActivityIds, setReadActivityIds] = useState<string[]>([]);
  const [githubReauthRequired, setGithubReauthRequired] = useState(false);
  const [settingsPending, setSettingsPending] = useState<string | null>(null);
  const [logoutPending, setLogoutPending] = useState(false);
  const [reportListExpanded, setReportListExpanded] = useState(false);
  const [unavailableHistoryExpanded, setUnavailableHistoryExpanded] = useState(false);
  const repositorySelectionGate = useRef(createRepositorySelectionGate());
  // Load the per-browser read set after mount so server and first client render match.
  useEffect(() => { setReadActivityIds(readStoredActivityIds()); }, []);
  const selectedReportRef = useRef<HTMLElement>(null);
  const focusSelectedReport = useRef(false);
  const prListRef = useRef<HTMLDivElement>(null);
  const focusPrList = useRef(false);
  const [prHistory, setPrHistory] = useState<DashboardSavedReport[]>([]);
  // In-memory only, for this signed-in page: reopening a PR list or report is instant.
  const prWorkspaceCache = useRef<PullRequestWorkspaceCache>(new Map());
  const reportDetailCache = useRef(new Map<string, DashboardReportDetail>());
  const repositorySelectionCache = useRef<{ installationId: string; reload: number; result: RepositorySelectionLoadResult } | null>(null);
  const [repositoryFilter, setRepositoryFilter] = useState("");
  const [wideLayout, setWideLayout] = useState(false);

  const repositoryRows = useMemo(
    () => toRepositoryWorkspaceRows(connectedRepositories, reports),
    [connectedRepositories, reports]
  );
  const activeRepositoryRows = repositoryRows.filter(isActiveRepositoryGrant);
  const workspaceRepositoryRows = runtime.inPlacePrReports ? repositoryRows.filter(repository => repository.enabled) : activeRepositoryRows;
  const visibleRepositoryRows = screen === "settings" ? repositoryRows : workspaceRepositoryRows;
  const selectedRepository = visibleRepositoryRows.find((repository) => repository.repositoryId === selectedRepositoryId)
    ?? ((loadedDetail?.repositoryId === selectedRepositoryId || selectedActivity?.repositoryId === selectedRepositoryId)
      ? repositoryRows.find((repository) => repository.repositoryId === selectedRepositoryId) : undefined)
    ?? (loadedDetail?.repositoryId === selectedRepositoryId && loadedDetail ? undefined : visibleRepositoryRows[0]);
  const detail = loadedDetail && (loadedDetail.repositoryId === selectedRepositoryId || loadedDetail.repositoryId === selectedRepository?.repositoryId) ? loadedDetail : null;
  const readingReport = Boolean(detail || reportLoad) && !reportPickerOpen;
  const reportPartitions = partitionVisibleRepositoryReports(reports, detail?.repositoryId ?? selectedRepository?.repositoryId);
  const selectedReports = reportPartitions.primary;
  const unavailableHistoryReports = reportPartitions.unavailableHistory;
  const displayedReports = reportListExpanded
    ? selectedReports
    : selectedReports.slice(0, DASHBOARD_REPORT_LIST_LIMIT);
  const selectedRepositoryName = selectedRepository?.repositoryFullName ?? (detail?.repositoryId ? `Repository #${detail.repositoryId}` : undefined);
  const [workspaceResumeKey, setWorkspaceResumeKey] = useState(0);
  // Polling returns new arrays; only changed report metadata should reload PRs/history.
  const reportsRefreshKey = JSON.stringify(reports
    .filter(report => report.repositoryId === selectedRepository?.repositoryId)
    .sort((a, b) => a.id.localeCompare(b.id)));
  const quickSummary = detail
    ? toQuickSummary({ ...detail, repositoryFullName: repositoryLabel(detail.repositoryId, connectedRepositories) })
    : null;
  const unreadActivityCount = activity.filter((event) => !readActivityIds.includes(event.id)).length;
  const failedReads = [["repositories", repositoriesError], ["reports", reportsError], ["activity", activityError]].filter(([, error]) => error);
  const sessionExpiredMessage = dashboardRepositoryLoadFailureMessage(401, undefined);
  const workspaceSessionExpired = failedReads.some(([, error]) => error === sessionExpiredMessage);
  const accessDeniedMessage = dashboardRepositoryLoadFailureMessage(403, undefined);
  const workspaceAccessDenied = failedReads.some(([, error]) => error === accessDeniedMessage);
  const repositoryPlaceholder = repositoriesError ? "Connected repositories are unavailable." : "Loading connected repositories…";
  const reportsPlaceholder = reportsError ? "Saved reports are unavailable." : "Loading saved reports…";

  // Wide screens keep the PR list, version shelf and report side by side.
  const splitReader = Boolean(runtime.inPlacePrReports && !demoMode && wideLayout);
  // First connection: signed in, a successful read, and no repository yet. The guide replaces the empty PR area.
  const showConnectGuide = Boolean(signedIn && !demoMode && !repositoriesLoading && !repositoriesError && failedReads.length === 0 && connectedRepositories.length === 0 && workspaceRepositoryRows.length === 0);
  // Description + code: the PR navigation is hidden (kept mounted) so the report gets both reading areas.
  const codeWorkspaceOpen = Boolean(runtime.inPlacePrReports && !demoMode && showDetailedEvidence && detail?.report?.purposeReview);
  const detailVersions = detail?.id ? prHistory.filter(item => item.repositoryId === detail.repositoryId && item.pullRequestNumber === detail.pullRequestNumber) : [];
  const detailVersionIndex = detailVersions.findIndex(item => item.id === detail?.id);
  const latestDetailVersion = detailVersions.find(item => item.availability === "available");

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(min-width: 1180px)");
    const update = () => setWideLayout(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    setReportListExpanded(false);
    setUnavailableHistoryExpanded(false);
  }, [selectedRepository?.repositoryId]);

  useEffect(() => {
    if (demoMode) {
      setSignedIn(true);
      setSessionStatus("ready");
      setConnectedRepositories(PREVIEW_DEMO_REPOSITORIES);
      setReports(PREVIEW_DEMO_REPORTS);
      setActivity(PREVIEW_DEMO_ACTIVITY);
      setDetail(PREVIEW_DEMO_DETAIL);
      setSelectedRepositoryId(101);
      setRepositoriesLoading(false);
      setMessage("");
      return;
    }
    let cancelled = false;
    runtime.request("/api/dashboard/session", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("session_unavailable");
        return response.json();
      })
      .then((body) => {
        if (cancelled) return;
        setSignedIn(body?.signedIn === true);
        setSessionStatus("ready");
        if (body?.signedIn) {
          setMessage("");
          void refreshReports();
          void refreshActivity();
          void refreshConnectedRepositories();
        }
      })
      .catch(() => { if (!cancelled) setSessionStatus("error"); });
    return () => { cancelled = true; ++repositoriesRequest.current; ++reportsRequest.current; ++activityRequest.current; };
  }, [demoMode]);

  useEffect(() => {
    if (demoMode || !signedIn || !activeInstallationId) return;
    const cachedSelection = repositorySelectionCache.current;
    if (cachedSelection?.installationId === activeInstallationId && cachedSelection.reload === repositorySelectionReload) {
      setRepositorySelection(cachedSelection.result);
      return;
    }
    let cancelled = false;
    setRepositorySelection({ status: "loading", repositories: [], message: "Loading repositories from your AgentProof App installation." });
    runtime.request(`/api/github/onboarding/repositories?installationId=${encodeURIComponent(activeInstallationId)}`, { cache: "no-store" })
      .then(async (response) => ({
        status: response.status,
        payload: await response.json().catch(() => null)
      }))
      .then((result) => {
        if (cancelled) return;
        const next = resolveRepositorySelectionLoad(result);
        if (next.status === "ready") repositorySelectionCache.current = { installationId: activeInstallationId, reload: repositorySelectionReload, result: next };
        setRepositorySelection(next);
        setMessage(next.status === "error" ? next.message : "");
      })
      .catch(() => {
        if (cancelled) return;
        const next = resolveRepositorySelectionLoad({ status: 0, payload: null });
        setRepositorySelection(next);
        setMessage(next.status === "error" ? next.message : "");
      });
    return () => { cancelled = true; };
  }, [activeInstallationId, demoMode, repositorySelectionReload, signedIn]);

  useEffect(() => {
    setActiveInstallationId(installationId);
  }, [installationId]);

  useEffect(() => {
    if (demoMode || !signedIn) return;
    const refreshVisibleWorkspace = () => {
      if (document.visibilityState === "visible") {
        void refreshReports();
        void refreshActivity();
        void refreshConnectedRepositories();
      }
    };
    const stopNativeResume = runtime.subscribeResume?.(() => {
      setWorkspaceResumeKey(value => value + 1);
      void refreshReports(); void refreshActivity(); void refreshConnectedRepositories();
    });
    const intervalId = window.setInterval(refreshVisibleWorkspace, DASHBOARD_REFRESH_INTERVAL_MS);
    let wasHidden = document.visibilityState !== "visible";
    const refreshReturnedWorkspace = () => {
      if (document.visibilityState !== "visible") { wasHidden = true; return; }
      if (wasHidden) { wasHidden = false; setWorkspaceResumeKey(value => value + 1); }
      refreshVisibleWorkspace();
    };
    document.addEventListener("visibilitychange", refreshReturnedWorkspace);
    return () => {
      stopNativeResume?.();
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refreshReturnedWorkspace);
    };
  }, [demoMode, signedIn, runtime]);

  useEffect(() => {
    if (signedIn && initialReportId && /^[A-Za-z0-9_-]{1,200}$/.test(initialReportId)) void openReport(initialReportId);
  }, [signedIn, initialReportId]);

  function clearWorkspaceCaches() {
    prWorkspaceCache.current.clear();
    reportDetailCache.current.clear();
    repositorySelectionCache.current = null;
    clearReportCodeCache();
  }

  function closeRepositorySelection() {
    setRepositorySelection({ status: "idle", repositories: [], message: "" });
    setActiveInstallationId(undefined);
    setExistingInstallations([]);
    setPrivateRepositoryChoice(null);
    setRepositoryFilter("");
  }

  async function refreshReports() {
    const request = ++reportsRequest.current;
    setReportsLoading(true);
    if (demoMode) { setReports(PREVIEW_DEMO_REPORTS); setReportsLoading(false); return; }
    try {
      const response = await runtime.request("/api/dashboard/reports", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (request !== reportsRequest.current) return;
      if (response.status === 401 || response.status === 403) { ++detailRequest.current; clearWorkspaceCaches(); setReports([]); setDetail(null); setReportLoad(null); }
      if (response.status === 401 || response.status === 403) { setReportsError(dashboardRepositoryLoadFailureMessage(response.status, undefined)); return; }
      if (!response.ok || !Array.isArray(body?.reports)) throw new Error("reports_unavailable");
      if (request === reportsRequest.current) { setReports(body.reports); setReportsError(""); }
    } catch {
      if (request === reportsRequest.current) setReportsError("Reports could not be refreshed. Try again.");
    } finally {
      if (request === reportsRequest.current) setReportsLoading(false);
    }
  }

  async function refreshActivity() {
    const request = ++activityRequest.current;
    setActivityLoading(true);
    if (demoMode) { setActivity(PREVIEW_DEMO_ACTIVITY); setActivityLoading(false); return; }
    try {
      const response = await runtime.request("/api/dashboard/activity", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (request !== activityRequest.current) return;
      if (response.status === 401 || response.status === 403) { setActivity([]); setSelectedActivity(null); setActivityError(dashboardRepositoryLoadFailureMessage(response.status, undefined)); return; }
      if (!response.ok || !Array.isArray(body?.activity)) throw new Error("activity_unavailable");
      if (request === activityRequest.current) {
        if (typeof body.dismissedThrough === "string" && Number.isFinite(Date.parse(body.dismissedThrough)) && (!inboxCutoff.current || Date.parse(body.dismissedThrough) > Date.parse(inboxCutoff.current))) inboxCutoff.current = body.dismissedThrough;
        setActivity(body.activity.filter((event: DashboardActivityEvent) => !inboxCutoff.current || Date.parse(event.occurredAt) > Date.parse(inboxCutoff.current)));
        setSelectedActivity(current => body.activity.find((event: DashboardActivityEvent) => event.id === current?.id) ?? null);
        setActivityError("");
      }
    } catch {
      if (request === activityRequest.current) setActivityError("Activity could not be refreshed. Try again.");
    } finally {
      if (request === activityRequest.current) setActivityLoading(false);
    }
  }

  async function refreshWorkspace() {
    setRefreshing(true);
    try { await Promise.all([refreshConnectedRepositories(), refreshReports(), refreshActivity()]); }
    finally { setRefreshing(false); }
  }

  async function clearInbox() {
    if (clearingInbox.current) return;
    clearingInbox.current = true;
    setInboxClearPending(true);
    const epoch = accountEpoch.current;
    ++activityRequest.current;
    setActivityLoading(false);
    try {
      const response = demoMode ? null : await runtime.request("/api/dashboard/activity", {
        method: "POST", headers: { "Content-Type": "application/json", "x-agentproof-csrf": "same-origin" }, body: "{}"
      });
      const body = demoMode ? { ok: true, dismissedThrough: new Date().toISOString() } : await response!.json().catch(() => null);
      if (epoch !== accountEpoch.current) return;
      if ((!demoMode && !response!.ok) || body?.ok !== true || typeof body.dismissedThrough !== "string" || !Number.isFinite(Date.parse(body.dismissedThrough))) throw new Error();
      ++activityRequest.current;
      setActivityLoading(false);
      inboxCutoff.current = body.dismissedThrough;
      setActivity(current => current.filter(event => Date.parse(event.occurredAt) > Date.parse(body.dismissedThrough)));
      setInboxActionError("");
    } catch {
      if (epoch === accountEpoch.current) setInboxActionError("Inbox could not be cleared. Your notifications are unchanged. Try again.");
    } finally {
      if (epoch === accountEpoch.current) { clearingInbox.current = false; setInboxClearPending(false); }
    }
  }

  function toggleInbox() {
    const opening = !inboxOpen;
    setInboxOpen(opening);
  }

  /** Only opening a specific notification marks it read; the read set survives refresh in this browser. */
  function markActivityRead(id: string) {
    if (readActivityIds.includes(id)) return;
    const next = [...readActivityIds, id].slice(-300);
    setReadActivityIds(next);
    try { window.localStorage.setItem(READ_ACTIVITY_KEY, JSON.stringify(next)); } catch { /* storage unavailable: state still updates */ }
  }

  async function openActivity(event: DashboardActivityEvent) {
    markActivityRead(event.id);
    ++detailRequest.current;
    setInboxOpen(false);
    setScreen("repositories");
    setDetail(null);
    setReportLoad(null);
    setMessage("");
    setSelectedActivity(null);
    const repository = connectedRepositories.find((item) =>
      item.repositoryId === event.repositoryId || item.repositoryFullName === event.repositoryFullName
    );
    if (repository?.repositoryId) setSelectedRepositoryId(repository.repositoryId);
    if (event.reportId) {
      await openReport(event.reportId);
      return;
    }
    setSelectedActivity(event);
  }

  async function refreshConnectedRepositories() {
    const request = ++repositoriesRequest.current;
    setRepositoriesLoading(true);
    if (demoMode) {
      setConnectedRepositories(PREVIEW_DEMO_REPOSITORIES);
      setSelectedRepositoryId(101);
      setRepositoriesLoading(false);
      return;
    }
    try {
      const response = await runtime.request("/api/dashboard/repositories", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (request !== repositoriesRequest.current) return;
      if (response.ok && Array.isArray(body?.repositories)) {
        setConnectedRepositories(body.repositories);
        setSelectedRepositoryId((current) => current ?? body.repositories[0]?.repositoryId);
        setRepositoriesError("");
      } else {
        if (response.status === 401 || response.status === 403) {
          ++detailRequest.current; clearWorkspaceCaches(); setConnectedRepositories([]); setDetail(null); setReportLoad(null);
        }
        setRepositoriesError(dashboardRepositoryLoadFailureMessage(response.status, body?.code));
      }
    } catch {
      if (request === repositoriesRequest.current) setRepositoriesError(dashboardRepositoryLoadFailureMessage(undefined, undefined));
    } finally {
      if (request === repositoriesRequest.current) setRepositoriesLoading(false);
    }
  }

  async function login() {
    if (runtime.signIn) { await runtime.signIn(); return; }
    if (demoMode) return;
    const response = await runtime.request("/api/auth/github/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const body = await response.json().catch(() => null);
    if (body?.code === "github_oauth_callback_origin_mismatch" && typeof body?.dashboardUrl === "string") {
      setMessage("Opening the configured DiffEvidence address for secure GitHub sign-in.");
      runtime.navigate(body.dashboardUrl);
      return;
    }
    if (typeof body?.authorizationUrl === "string") runtime.navigate(body.authorizationUrl);
    else setMessage("GitHub sign-in is temporarily unavailable.");
  }

  async function install() {
    if (runtime.connectRepository) {
      try { await runtime.connectRepository(); } catch { setMessage("Repository setup could not be opened. Try again."); }
      return;
    }
    if (demoMode) {
      setMessage("");
      return;
    }
    const existingResponse = await runtime.request("/api/github/onboarding/callback?existing=1", {
      headers: { "x-agentproof-csrf": "same-origin" }
    });
    const existing = await existingResponse.json().catch(() => null);
    if (existingResponse.ok && existing?.next === "select_repository" && typeof existing?.installationId === "number") {
      setExistingInstallations([]);
      repositorySelectionGate.current.reset();
      setRepositorySelectionPending(false);
      if (repositorySelectionCache.current?.installationId !== String(existing.installationId)) setRepositorySelection({ status: "loading", repositories: [], message: "Loading repositories from your AgentProof App installation." });
      setActiveInstallationId(String(existing.installationId));
      setMessage("");
      return;
    }
    if (existingResponse.ok && existing?.next === "choose_installation" && Array.isArray(existing?.installations)) {
      setExistingInstallations(existing.installations.filter(isExistingInstallation));
      setMessage("");
      return;
    }
    if (existingResponse.status === 401) {
      // The AgentProof session is still valid; only GitHub's short-lived installation access expired.
      setGithubReauthRequired(true);
      setMessage("");
      return;
    }
    setGithubReauthRequired(false);
    const response = await runtime.request("/api/github/onboarding/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const body = await response.json().catch(() => null);
    if (typeof body?.installUrl === "string") runtime.navigate(body.installUrl);
    else setMessage(githubOnboardingStartFailureMessage(body?.code));
  }

  async function activateExistingInstallation(existingInstallationId: number) {
    const response = await runtime.request(`/api/github/onboarding/callback?existing=1&installationId=${encodeURIComponent(existingInstallationId)}`, {
      headers: { "x-agentproof-csrf": "same-origin" }
    });
    const body = await response.json().catch(() => null);
    if (response.ok && body?.next === "select_repository" && typeof body?.installationId === "number") {
      setExistingInstallations([]);
      repositorySelectionGate.current.reset();
      setRepositorySelectionPending(false);
      if (repositorySelectionCache.current?.installationId !== String(body.installationId)) setRepositorySelection({ status: "loading", repositories: [], message: "Loading repositories from your AgentProof App installation." });
      setActiveInstallationId(String(body.installationId));
      setMessage("");
    } else setMessage("That GitHub App installation could not be verified. Reconnect GitHub and try again.");
  }

  async function selectRepository(repository: Repository, llmAnalysisMode: "essential" | "enhanced", privateAnalysisConsent = false) {
    if (!repositorySelectionGate.current.tryStart()) return;
    setRepositorySelectionPending(true);
    try {
      const response = await runtime.request("/api/github/onboarding/repositories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installationId: Number(activeInstallationId), repositoryId: repository.id, saveReportsEnabled: true, commentEnabled: commentEnabledOnConnect, llmAnalysisMode, hybridPlannerConsent: repository.private && hybridPlannerConsentOnConnect, privateAnalysisConsent: repository.private && privateAnalysisConsent })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        repositorySelectionGate.current.reset();
        setMessage(githubRepositoryConnectionFailureMessage(body?.code));
        return;
      }
      repositorySelectionGate.current.reset();
      setConnectedRepositories((current) => mergeConnectedRepository(current, {
        installationId: Number(activeInstallationId),
        repositoryId: repository.id,
        repositoryFullName: repository.fullName,
        enabled: true,
         analysisEnabled: body?.settings?.analysisEnabled === true,
         saveReportsEnabled: body?.settings?.saveReportsEnabled === true,
         commentEnabled: body?.settings?.commentEnabled === true,
         llmAnalysisMode: body?.settings?.llmAnalysisMode === "enhanced" ? "enhanced" : "essential",
         hybridPlannerConsentVersion: body?.settings?.hybridPlannerConsentVersion === "2026-08-12.v1" ? "2026-08-12.v1" : null,
         privateAnalysisConsentVersion: body?.settings?.privateAnalysisConsentVersion === "2026-09-24.v1" ? "2026-09-24.v1" : null,
         repositoryPrivate: repository.private
      }));
      setSelectedRepositoryId(repository.id);
      setRepositoriesLoading(false);
       setPrivateRepositoryChoice(null);
       setHybridPlannerConsentOnConnect(false);
       setPrivateAnalysisConsentOnConnect(false);
       setMessage("");
    } catch {
      repositorySelectionGate.current.reset();
      setMessage("Repository could not be connected.");
    } finally {
      setRepositorySelectionPending(false);
    }
  }

  useEffect(() => {
    if (focusPrList.current && reportPickerOpen) {
      prListRef.current?.focus({ preventScroll: true });
      prListRef.current?.scrollIntoView({ block: "start" });
      focusPrList.current = false;
    }
    if ((detail || reportLoad) && focusSelectedReport.current) {
      selectedReportRef.current?.focus({ preventScroll: true });
      selectedReportRef.current?.scrollIntoView({ block: "start" });
      focusSelectedReport.current = false;
    }
  }, [detail, reportLoad, reportPickerOpen]);

  function returnToPrList() {
    ++detailRequest.current;
    focusSelectedReport.current = false;
    focusPrList.current = true;
    setReportPickerOpen(true);
    setReportLoad(null);
  }

  /** Brand/home: leave the selected PR, report and panels without reloading the session or page. */
  function goHome() {
    setInboxOpen(false);
    setScreen("repositories");
    setSelectedActivity(null);
    setShowDetailedEvidence(false);
    setDetail(null);
    returnToPrList();
  }

  function toggleReportEvidence() {
    setShowDetailedEvidence(current => !current);
    if (showDetailedEvidence) selectedReportRef.current?.querySelector<HTMLButtonElement>('[aria-controls="report-evidence-detail"]')?.focus();
  }

  async function openReport(id: string) {
    const request = ++detailRequest.current;
    focusSelectedReport.current = true;
    setInboxOpen(false);
    setScreen("repositories");
    setSelectedActivity(null);
    setMessage("");
    setReportPickerOpen(false);
    // A report read earlier on this page opens at once; the server is still
    // asked quietly so a report that became unavailable is not kept on screen.
    const cachedDetail = reportDetailCache.current.get(id);
    if (cachedDetail) {
      setDetail(cachedDetail);
      setReportLoad(null);
      if (typeof cachedDetail.repositoryId === "number") setSelectedRepositoryId(cachedDetail.repositoryId);
      setShowDetailedEvidence(false);
    } else {
      setDetail(null);
      setReportLoad({ id, state: "loading" });
    }
    if (demoMode) {
      const report = PREVIEW_DEMO_REPORTS.find((item) => item.id === id);
      if (!report) { setReportLoad({ id, state: "unavailable" }); return; }
      setDetail(report.id === "preview-report-current" ? PREVIEW_DEMO_DETAIL : { ...PREVIEW_DEMO_DETAIL, ...report });
      setReportLoad(null);
      setShowDetailedEvidence(false);
      return;
    }
    try {
      const response = await runtime.request(`/api/dashboard/reports?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (request !== detailRequest.current) return;
      if (!response.ok || !body?.report || body.availability === "unavailable") throw new Error("report_unavailable");
      const nextDetail = { ...body, id };
      reportDetailCache.current.set(id, nextDetail);
      if (cachedDetail) {
        // Quiet revalidation must update status without resetting evidence or focus.
        if (JSON.stringify(cachedDetail) !== JSON.stringify(nextDetail)) setDetail(nextDetail);
        return;
      }
      focusSelectedReport.current = true;
      setDetail(nextDetail);
      setReportLoad(null);
      if (typeof body.repositoryId === "number") setSelectedRepositoryId(body.repositoryId);
      setShowDetailedEvidence(false);
    } catch {
      reportDetailCache.current.delete(id);
      if (request === detailRequest.current) { focusSelectedReport.current = true; setDetail(null); setReportLoad({ id, state: "unavailable" }); }
    }
  }

  function chooseWorkspaceRepository(repositoryId: number | undefined) {
    ++detailRequest.current;
    setSelectedRepositoryId(repositoryId);
    setSelectedActivity(null);
    setDetail(null);
    setReportLoad(null);
    setReportListExpanded(false);
    setRepositoryPickerOpen(false);
  }

  function showGeneratedReport(report: DashboardReportDetail) {
    ++detailRequest.current;
    for (const [id, cached] of reportDetailCache.current) if (cached.repositoryId === report.repositoryId && cached.pullRequestNumber === report.pullRequestNumber) reportDetailCache.current.delete(id);
    if (report.id) reportDetailCache.current.set(report.id, report);
    setSelectedActivity(null);
    setDetail(report);
    setReportLoad(null);
    setReportPickerOpen(false);
    setShowDetailedEvidence(false);
    focusSelectedReport.current = true;
    void refreshReports();
    void refreshActivity();
  }

  async function updateRepositorySetting(setting: RepositorySetting, nextValue: boolean | ReportLanguage, privateAnalysisConsent = false) {
    if (!selectedRepository?.repositoryId) return;
    if (demoMode) {
      setConnectedRepositories((current) => current.map((repository) => repository.repositoryId === selectedRepository.repositoryId && repository.installationId === selectedRepository.installationId
        ? { ...repository, [setting]: nextValue }
        : repository));
      setMessage("");
      return;
    }
    setSettingsPending(setting);
    try {
      const response = await runtime.request("/api/tenants/repositories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-agentproof-csrf": "same-origin" },
        body: JSON.stringify({
          installationId: selectedRepository.installationId,
          repositoryId: selectedRepository.repositoryId,
          settings: { [setting]: nextValue, ...(setting === "analysisEnabled" && nextValue && privateAnalysisConsent ? { privateAnalysisConsent: true } : {}) }
        })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.repository) {
        setMessage(settingsCopy(selectedRepository.reportLanguage).saveFailed);
        return;
      }
      setConnectedRepositories((current) => current.map((repository) => repository.repositoryId === selectedRepository.repositoryId && repository.installationId === selectedRepository.installationId
        ? { ...repository, ...body.repository }
        : repository));
      setMessage("");
    } catch {
      setMessage(settingsCopy(selectedRepository.reportLanguage).saveFailed);
    } finally {
      setSettingsPending(null);
    }
  }

  async function logout() {
    if (demoMode) {
      setMessage("");
      return;
    }
    setLogoutPending(true);
    try {
      const response = await runtime.request("/api/tenants/auth/session", {
        method: "DELETE",
        headers: { "x-agentproof-csrf": "same-origin" }
      });
      if (!response.ok) {
        setMessage("Your session could not be ended. Try again.");
        return;
      }
      ++detailRequest.current;
      ++repositoriesRequest.current;
      ++reportsRequest.current;
      ++activityRequest.current;
      ++accountEpoch.current;
      clearWorkspaceCaches();
      clearingInbox.current = false;
      inboxCutoff.current = null;
      setInboxClearPending(false);
      setReportLoad(null);
      setSignedIn(false);
      setConnectedRepositories([]);
      setReports([]);
      setActivity([]);
      setDetail(null);
      setInboxOpen(false);
      setGithubReauthRequired(false);
      setMessage("You are signed out of DiffEvidence.");
    } catch {
      setMessage("Your session could not be ended. Try again.");
    } finally {
      setLogoutPending(false);
    }
  }

  if (sessionStatus === "checking") return <section className="github-dashboard github-session-loading" role="status"><Loader2 size={22} className="spin" aria-hidden="true" /><p>Opening your workspace…</p></section>;
  if (sessionStatus === "error") return <section className="github-dashboard github-session-loading" role="alert"><p>We couldn’t load your session.</p><button className="dashboard-secondary-action" onClick={() => window.location.reload()}>Try again</button></section>;

  if (!signedIn) return <WorkspaceSignIn message={message} onSignIn={login} />;
  const reportBackAction = runtime.inPlacePrReports && !splitReader ? <button className="dashboard-back-action" data-report-action="back" aria-label={reportCopy(detail?.report?.purposeReview?.locale).backToPrList} onClick={returnToPrList}>← {reportCopy(detail?.report?.purposeReview?.locale).backToPrList}</button> : null;

  return <section className="github-dashboard" onClickCapture={(event) => {
    if (inboxOpen && !(event.target as HTMLElement).closest(".dashboard-inbox, .dashboard-inbox-action")) setInboxOpen(false);
  }}>
    <a className="dashboard-skip-link" href={runtime.inPlacePrReports && !readingReport && !splitReader ? "#dashboard-pr-list" : "#dashboard-reports"}>Skip to reports</a>
    <main className="dashboard-canvas">
      <header className="dashboard-topbar">
        <a className="dashboard-brand" href="/dashboard" aria-label="DiffEvidence home" title="DiffEvidence" onClick={(event) => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); goHome(); }}><span className="dashboard-brand-mark"><DiffEvidenceMark /></span></a>
        {/* Repository choice sits in the one compact topbar; the existing disclosure and its picker are unchanged. */}
        <details className="dashboard-section dashboard-repository-strip" hidden={screen !== "repositories"} open={repositoryPickerOpen || (!selectedRepository && !repositoriesError && !repositoriesLoading && workspaceRepositoryRows.length > 0)} onToggle={(event) => { if (selectedRepository) setRepositoryPickerOpen(event.currentTarget.open); }}><summary><span>Repository</span><strong>{selectedRepositoryName ?? (repositoriesError ? "Repositories unavailable" : repositoriesLoading ? "Loading repositories…" : "Add a repository")}</strong><ChevronRight size={16} /></summary>
          <div className="dashboard-section-heading"><div><h3 id="connected-repositories-title">Connected repositories</h3></div><div className="dashboard-heading-actions">{signedIn && !activeInstallationId && (!repositoriesError && !repositoriesLoading || connectedRepositories.length > 0) ? <button className="dashboard-text-action" onClick={install}><Link2 size={15} /> {demoMode ? "Sample repository" : "Add repositories"}</button> : null}{selectedRepository ? <button className="dashboard-icon-button" aria-label="Close repository list" onClick={() => setRepositoryPickerOpen(false)}><X size={17} /></button> : null}</div></div>
          {workspaceRepositoryRows.length > 0 ? <div className="repository-tabs">{workspaceRepositoryRows.map((repository) => <button key={`${repository.installationId}:${repository.repositoryId ?? repository.repositoryFullName}`} aria-pressed={repository.repositoryId === selectedRepository?.repositoryId} className={repository.repositoryId === selectedRepository?.repositoryId ? "repository-tab active" : "repository-tab"} onClick={() => chooseWorkspaceRepository(repository.repositoryId)}><span className="repository-tab-name">{repository.repositoryFullName}</span><RepositoryMeta analysisOn={isActiveRepositoryGrant(repository)} commentsOn={repository.commentsEnabled} privateRepository={repository.repositoryPrivate === true} /></button>)}</div> : repositoriesLoading || repositoriesError ? <p className="dashboard-empty">{repositoryPlaceholder}</p> : <p className="dashboard-empty">No active repository. Open Settings to enable analysis, or connect a repository.</p>}
        </details>
        <div className="dashboard-top-actions"><button className="dashboard-icon-button dashboard-inbox-action" aria-label="Open Inbox" title="Inbox" aria-expanded={inboxOpen} onClick={toggleInbox}><Bell size={18} />{unreadActivityCount > 0 ? <span className="dashboard-unread-badge">{Math.min(unreadActivityCount, 9)}</span> : null}</button><button className="dashboard-icon-button dashboard-settings-action" aria-label={screen === "settings" ? "Show reports" : "Open settings"} title={screen === "settings" ? "Show reports" : "Open settings"} aria-pressed={screen === "settings"} onClick={() => setScreen(screen === "settings" ? "repositories" : "settings")}>{screen === "settings" ? <FileText size={18} aria-hidden="true" /> : <Settings size={18} aria-hidden="true" />}</button><button className="dashboard-icon-button" aria-label="Refresh reports and activity" title="Refresh reports and activity" disabled={refreshing} aria-busy={refreshing} onClick={refreshWorkspace}><RotateCw size={18} /></button></div>
      </header>
      {!demoMode && message ? <p className="dashboard-message" role="alert">{message}</p> : null}
      {failedReads.length > 0 ? <div className="dashboard-message" role="status" aria-label="Workspace refresh status"><p>{workspaceSessionExpired ? sessionExpiredMessage : workspaceAccessDenied ? accessDeniedMessage : `Some workspace data could not be refreshed: ${failedReads.map(([name]) => name).join(", ")}. Previously loaded data is unchanged.`}</p>{workspaceSessionExpired ? <button className="dashboard-secondary-action" onClick={() => { void login(); }}>Continue with GitHub</button> : <button className="dashboard-secondary-action" aria-label="Retry workspace loading" disabled={refreshing} onClick={() => { void refreshWorkspace(); }}>Try again</button>}</div> : null}
      {githubReauthRequired && !showConnectGuide ? <p className="dashboard-reauth" role="status">GitHub needs to confirm your App installation access before adding repositories. You are still signed in. <button className="dashboard-text-action" onClick={() => { void login(); }}>Confirm with GitHub</button></p> : null}
      {demoMode ? <p className="dashboard-demo-banner"><Info size={15} /> Preview demo · sample data only · GitHub, database, and comments are disabled.</p> : null}
      {inboxOpen ? <section className="dashboard-inbox" aria-label="Inbox">{inboxActionError ? <p role="alert">{inboxActionError}</p> : null}<div className="dashboard-section-heading"><div><p className="dashboard-eyebrow">INBOX</p><h3>Recent activity</h3></div><button className="dashboard-text-action" aria-label="Clear inbox" disabled={inboxClearPending || activity.length === 0} onClick={() => { void clearInbox(); }}>{inboxClearPending ? "Clearing…" : "Clear inbox"}</button></div>{activity.length > 0 ? <div className="installation-list">{activity.map((event) => <button className={`dashboard-list-row dashboard-activity-row ${readActivityIds.includes(event.id) ? "is-read" : "is-unread"}`} key={event.id} onClick={() => { void openActivity(event); }}>{event.kind === "report_stale" ? <span className="dashboard-activity-icon" aria-label="Previous result" title="Previous result"><History size={16} /></span> : <StatusToken label={event.state} />}<span><strong>{readActivityIds.includes(event.id) ? null : <span className="sr-only">Unread · </span>}{event.repositoryFullName ?? repositoryLabel(event.repositoryId, connectedRepositories) ?? "Connected repository"} · {formatPrNumber(event.pullRequestNumber)}</strong><small>{event.kind === "report_stale" ? "Previous result · newer commit received" : `${formatCreatedAt(event.occurredAt)} · head ${event.headShaPrefix ?? "not recorded"}`}</small>{event.kind === "analysis_completed" && !event.reportId ? <small>No report in recent saved reports</small> : null}{event.failure ? <small>Analysis refresh failed · {dashboardAnalysisFailureMessage(event.failure)}</small> : null}</span><ChevronRight size={16} /></button>)}</div> : <p className="dashboard-empty">{activityError ? "Activity is unavailable." : activityLoading ? "Loading activity…" : "No recent activity."}</p>}</section> : null}

      <div className="dashboard-repositories-view" hidden={screen !== "repositories"}>

        {showConnectGuide ? <ConnectRepositoryGuide stage={githubReauthRequired ? "reauth" : existingInstallations.length > 0 ? "installation" : repositorySelection.status !== "idle" ? "repository" : "install"} onInstall={() => { void install(); }} onConfirm={() => { void login(); }} /> : null}
        {existingInstallations.length > 0 ? <section className="dashboard-section dashboard-repository-picker"><div className="dashboard-section-heading"><div><h3>Choose an installation</h3></div><button className="dashboard-icon-button" aria-label="Close installation choice" onClick={closeRepositorySelection}><X size={17} /></button></div><div className="installation-list">{existingInstallations.map((installation) => <button key={installation.installationId} className="dashboard-list-row" onClick={() => { void activateExistingInstallation(installation.installationId); }}><Github size={17} /> {installation.accountLogin}<ChevronRight size={16} /></button>)}</div></section> : null}

         {repositorySelection.status !== "idle" ? <section className="dashboard-section dashboard-repository-picker" aria-label="Add repositories"><div className="dashboard-section-heading"><div><h3>Select a repository</h3></div><div className="dashboard-heading-actions">{repositorySelection.status === "ready" ? <button className="dashboard-icon-button" aria-label="Reload repository list" title="Reload list" disabled={repositorySelectionPending} onClick={() => setRepositorySelectionReload((current) => current + 1)}><RotateCw size={16} /></button> : null}<button className="dashboard-icon-button" aria-label="Close repository selection" onClick={closeRepositorySelection}><X size={17} /></button></div></div>{repositorySelection.status === "loading" ? <p className="dashboard-shelf-note"><Loader2 size={14} className="spin" /> Loading repositories…</p> : null}{repositorySelection.status === "ready" ? (() => {
           const filter = repositoryFilter.trim().toLowerCase();
           const shown = filter ? repositorySelection.repositories.filter((repository) => repository.fullName.toLowerCase().includes(filter)) : repositorySelection.repositories;
           return <><div className="dashboard-picker-tools">{repositorySelection.repositories.length > 6 ? <input className="dashboard-picker-search" type="search" aria-label="Filter repositories" placeholder="Filter repositories" value={repositoryFilter} onChange={(event) => setRepositoryFilter(event.target.value)} /> : null}<label className="dashboard-inline-toggle" title="Off by default. Posts a summary-only comment on new PR reports."><input type="checkbox" checked={commentEnabledOnConnect} onChange={(event) => setCommentEnabledOnConnect(event.target.checked)} /> Summary comments</label></div><div className="installation-list">{shown.map((repository) => {
             const connected = connectedRepositories.some((item) => item.repositoryId === repository.id && item.enabled);
             return <button key={repository.id} className="dashboard-list-row" disabled={repositorySelectionPending || connected} onClick={() => { if (repository.private) setPrivateRepositoryChoice(repository); else void selectRepository(repository, "enhanced"); }}><FolderGit2 size={17} /><span className="repository-tab-name">{repository.fullName}</span>{repository.private ? <span className="dashboard-chip">Private</span> : null}{connected ? <span className="dashboard-status tone-ok"><i aria-hidden="true" />Connected</span> : <span className="dashboard-picker-add">Connect</span>}</button>;
           })}</div>{shown.length === 0 ? <p className="dashboard-empty">No matching repository.</p> : null}</>;
         })() : null}{repositorySelection.status === "empty" ? <p className="dashboard-empty">{repositorySelection.message}</p> : null}{repositorySelection.status === "error" ? <div className="dashboard-empty"><p>{repositorySelection.message}</p><button className="dashboard-secondary-action" onClick={() => setRepositorySelectionReload((current) => current + 1)}>Try again</button></div> : null}</section> : null}
         {privateRepositoryChoice ? <section ref={privateChoiceRef} tabIndex={-1} className="analysis-choice-dialog" role="dialog" aria-modal="true" aria-labelledby="analysis-choice-title"><div><p className="dashboard-eyebrow">PRIVATE REPOSITORY</p><h3 id="analysis-choice-title">Choose private analysis</h3><p>With analysis ON, AgentProof sends bounded private PR goal text and selected changed-code excerpts to the configured model provider to identify important changes and explain how those changes fit the stated purpose. Evidence reports may retain short summaries, file paths, and commit references. With analysis OFF, PR events do not run model analysis and this repository stays out of the active list.</p><label className="dashboard-toggle-row"><span><strong>I approve private PR analysis</strong><small>Required to turn analysis ON for this repository.</small></span><input type="checkbox" checked={privateAnalysisConsentOnConnect} onChange={(event) => setPrivateAnalysisConsentOnConnect(event.target.checked)} /></label><label className="dashboard-toggle-row"><span><strong>Private enhanced planning consent</strong><small>Separately allow bounded redacted private Issue and PR source spans for enhanced planning.</small></span><input type="checkbox" checked={hybridPlannerConsentOnConnect} onChange={(event) => setHybridPlannerConsentOnConnect(event.target.checked)} /></label></div><div className="analysis-choice-actions"><button className="dashboard-text-action" disabled={repositorySelectionPending} onClick={() => setPrivateRepositoryChoice(null)}>Cancel</button><button className="dashboard-secondary-action" disabled={repositorySelectionPending} onClick={() => { void selectRepository(privateRepositoryChoice, "essential"); }}>Connect with analysis OFF</button><button className="dashboard-primary-action" disabled={repositorySelectionPending || !privateAnalysisConsentOnConnect} onClick={() => { void selectRepository(privateRepositoryChoice, "enhanced", true); }}>Connect with analysis ON</button></div></section> : null}

        {showConnectGuide ? null : <>
        <div className={`dashboard-history-layout${splitReader ? " is-split" : ""}${codeWorkspaceOpen ? " is-code-open" : ""}`}>
        {!demoMode ? runtime.inPlacePrReports
          ? <div id="dashboard-pr-list" className="dashboard-pr-browser" ref={prListRef} tabIndex={-1} aria-label="Pull request list" hidden={(readingReport && !splitReader) || codeWorkspaceOpen}>{selectedRepository?.repositoryId ? <RepositoryPullRequestWorkspace key={selectedRepository.repositoryId} runtime={runtime} repositoryId={selectedRepository.repositoryId} repositoryFullName={selectedRepository.repositoryFullName} canGenerate={isActiveRepositoryGrant(selectedRepository)} reportLanguage={selectedRepository.reportLanguage} refreshKey={reportsRefreshKey} resumeKey={workspaceResumeKey} activeReportId={detail?.id ?? reportLoad?.id} cache={prWorkspaceCache.current} onOpenReport={id=>{void openReport(id);}} onGeneratedReport={showGeneratedReport} onHistoryChange={setPrHistory} /> : <p className="dashboard-empty">{repositoriesLoading || repositoriesError ? repositoryPlaceholder : "Connect a repository to view pull requests."}</p>}</div>
          : <RepositoryCommitBrowser runtime={runtime} repositories={connectedRepositories} /> : null}

        <section className={`dashboard-workspace${runtime.inPlacePrReports ? " dashboard-report-reader" : ""}`} id="dashboard-reports" aria-label="Report reader" tabIndex={-1} hidden={Boolean(runtime.inPlacePrReports && !demoMode && !readingReport && !selectedActivity && !splitReader)}>
          {!runtime.inPlacePrReports ? <div className="dashboard-section-heading"><div><h3>Repository reports</h3></div></div> : null}
          {selectedActivity ? <p className="dashboard-boundary" role="status">{formatPrNumber(selectedActivity.pullRequestNumber)} · {selectedActivity.state}{selectedActivity.kind === "analysis_completed" ? " · No report in recent saved reports" : ""}{selectedActivity.failure ? ` · ${dashboardAnalysisFailureMessage(selectedActivity.failure)}` : ""}</p> : null}
          {!selectedRepository && !detail && !reportLoad ? <p className="dashboard-empty">{repositoriesLoading || repositoriesError ? repositoryPlaceholder : reportsLoading || reportsError ? reportsPlaceholder : "Connect a GitHub repository to review saved evidence reports."}</p> : selectedReports.length === 0 && unavailableHistoryReports.length === 0 && !detail && !reportLoad ? <p className="dashboard-empty"><FileCheck2 size={20} /> {reportsLoading || reportsError ? reportsPlaceholder : runtime.inPlacePrReports ? "Select a saved version to read it here." : "No current saved reports in this list."}</p> : <div className="dashboard-report-layout">
            <div className="dashboard-report-navigation" hidden={Boolean(runtime.inPlacePrReports && !demoMode)}>{detail ? <button className="dashboard-report-picker" aria-expanded={reportPickerOpen} aria-controls="dashboard-report-list" onClick={() => setReportPickerOpen((current) => !current)}><span>{formatPrNumber(detail.pullRequestNumber)}</span><span>{reportPickerOpen ? "Hide list" : "Change report"} <ChevronRight size={14} /></span></button> : null}
            <div id="dashboard-report-list" className={`report-list${!reportPickerOpen && detail ? " mobile-collapsed" : ""}`} aria-label="Saved analysis reports">{displayedReports.map((report) => <button key={report.id} aria-current={detail?.id === report.id ? "true" : undefined} className={detail?.pullRequestNumber === report.pullRequestNumber && detail?.headSha === report.headSha ? "report-row active" : "report-row"} disabled={report.availability === "unavailable" || report.availability === "analysis_failed"} title={report.availability === "unavailable" ? "This saved report cannot be opened right now. Run the analysis again if the state does not recover." : report.availability === "analysis_failed" ? "The latest analysis did not finish. Existing saved reports are unchanged." : undefined} onClick={() => { setReportPickerOpen(false); void openReport(report.id); }}><span className="report-row-icon"><FileCheck2 size={17} /></span><span><strong>{report.availability === "unavailable" ? "REPORT UNAVAILABLE" : formatPrNumber(report.pullRequestNumber)}</strong><small>{formatCreatedAt(report.createdAt)} · head {headPrefix(report.headSha)}</small>{report.freshness === "refresh_failed" ? <small>Analysis refresh failed{report.failure ? ` · ${dashboardAnalysisFailureMessage(report.failure)}` : "."}</small> : null}</span><span className="report-row-meta"><small><strong>Report:</strong> {report.availability === "unavailable" ? "Unavailable" : report.availability === "analysis_failed" ? "Not saved" : "Saved"}</small><StatusToken label={report.availability === "unavailable" ? "REPORT UNAVAILABLE" : reportWorkspaceStatusLabel(report.freshness)} title={report.availability === "unavailable" ? "This saved report cannot be opened right now. Run the analysis again if the state does not recover." : report.availability === "analysis_failed" ? "The latest analysis did not finish. Existing saved reports are unchanged." : report.copyEligible ? "Latest saved report" : report.freshness === "refresh_failed" ? "A newer analysis did not finish. This saved report remains available." : "A newer analysis is still being prepared"} /></span></button>)}{selectedReports.length > DASHBOARD_REPORT_LIST_LIMIT ? <button className="dashboard-secondary-action" aria-expanded={reportListExpanded} onClick={() => setReportListExpanded((current) => !current)}>{reportListExpanded ? "Show fewer reports" : `Show all ${selectedReports.length} reports`}</button> : null}</div>
            {unavailableHistoryReports.length > 0 ? <section className="dashboard-boundary" aria-label="Previous unavailable reports"><button className="dashboard-secondary-action" aria-expanded={unavailableHistoryExpanded} onClick={() => setUnavailableHistoryExpanded((current) => !current)}>{unavailableHistoryExpanded ? "Hide previous unavailable reports" : `Previous unavailable reports (${unavailableHistoryReports.length})`}</button>{unavailableHistoryExpanded ? <><div className="report-list">{unavailableHistoryReports.map((report) => <button key={report.id} className="report-row" disabled title="This saved report cannot be opened right now. Run the analysis again if the state does not recover."><span className="report-row-icon"><FileCheck2 size={17} /></span><span><strong>REPORT UNAVAILABLE</strong><small>{formatCreatedAt(report.createdAt)} · head {headPrefix(report.headSha)}</small></span><span className="report-row-meta"><small><strong>Report:</strong> Unavailable</small><StatusToken label="REPORT UNAVAILABLE" title="This saved report cannot be opened right now. Run the analysis again if the state does not recover." /></span></button>)}</div><p><Info size={15} /> This saved report cannot be opened right now. Run the analysis again if the state does not recover.</p></> : null}</section> : null}
            </div>
            {reportLoad ? <section ref={selectedReportRef} className="dashboard-selected-report dashboard-report-load" tabIndex={-1} aria-label="Selected report" role={reportLoad.state === "loading" ? "status" : "alert"}>{reportBackAction}{reportLoad.state === "loading" ? <p><Loader2 size={18} className="spin" /> Opening report…</p> : <><h3>Report unavailable</h3><p>This saved report is missing, inaccessible or temporarily unavailable.</p><button className="dashboard-secondary-action" onClick={() => { void openReport(reportLoad.id); }}>Try again</button></>}</section> : detail?.report && quickSummary ? <section ref={selectedReportRef} className="dashboard-selected-report" tabIndex={-1} aria-label="Selected report">{reportBackAction}<QuickSummaryPanel runtime={runtime} detail={{ ...detail, repositoryFullName: repositoryLabel(detail.repositoryId, connectedRepositories) }} quickSummary={quickSummary} onShowDetail={toggleReportEvidence} showDetailedEvidence={showDetailedEvidence} demoMode={demoMode} versionContext={detailVersionIndex >= 0 ? <><span className="dashboard-version-tag">v{detailVersions.length - detailVersionIndex}</span>{latestDetailVersion && latestDetailVersion.id !== detail.id ? <span className="dashboard-version-banner" role="status"><span>Earlier version</span><button className="dashboard-text-action" onClick={() => { void openReport(latestDetailVersion.id); }}>Open latest v{detailVersions.length - detailVersions.indexOf(latestDetailVersion)}</button></span> : null}</> : null} onPrList={runtime.inPlacePrReports ? () => { setShowDetailedEvidence(false); returnToPrList(); } : undefined} /></section> : <div className="dashboard-empty dashboard-summary-placeholder"><Info size={20} /> {runtime.inPlacePrReports ? "Select a saved version to read it here." : "Select a report to open its Quick Summary."}</div>}
          </div>}
        </section>
        </div>
        </>}
      </div>
      {screen === "settings" ? <SettingsPanel onBack={() => setScreen("repositories")} repositories={repositoryRows} repository={selectedRepository} onSelectRepository={chooseWorkspaceRepository} pending={settingsPending} onUpdate={updateRepositorySetting} onLogout={logout} logoutPending={logoutPending} /> : null}
    </main>

  </section>;
}

/**
 * versionContext: saved version/earlier-version controls from the dashboard, shown in the one context row.
 * onPrList: return to the PR list (wide workspace); the dashboard owns the selected-PR focus.
 */
export function QuickSummaryPanel({ detail, quickSummary, onShowDetail, showDetailedEvidence, demoMode, runtime = webWorkspaceClient, versionContext, onPrList }: { runtime?: WorkspaceClient; detail: DashboardReportDetail & { repositoryFullName?: string }; quickSummary: ReturnType<typeof toQuickSummary>; onShowDetail: () => void; showDetailedEvidence: boolean; demoMode: boolean; versionContext?: React.ReactNode; onPrList?: () => void }) {
  const report = detail.report;
  const ordinaryPrReview = buildDashboardPrEvidenceReview(detail);
  const githubUrl = quickSummary.githubUrl;
  const summaryRef = useRef<HTMLDivElement>(null);
  // Web purpose reports read as one workspace: description, then one code pane opened from a cited location.
  // Native/legacy reports keep the existing evidence toggle below the summary.
  const workspace = Boolean(report?.purposeReview && runtime.inPlacePrReports && !demoMode);
  const codeOpen = workspace && showDetailedEvidence;
  const mainRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLElement>(null);
  const codeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const restoreRef = useRef<{ scrollY: number; readerTop: number } | null>(null);
  const focusAfterRender = useRef<"pane" | "trigger" | null>(null);
  // Selection belongs to this saved report; origin is the clicked description (clause + original array kind/index), if any.
  const [codeRef, setCodeRef] = useState<{ detailId?: string; id: string; origin?: CodeOrigin } | null>(null);
  const selected = codeRef && codeRef.detailId === detail.id ? codeRef : null;
  const codeSelection: CodeSelection = { id: selected?.id, onSelect: id => setCodeRef({ detailId: detail.id, id }) };
  const readableRefs = readablePurposeReferenceIds(ordinaryPrReview, Boolean(detail.id && !demoMode));
  const firstReadable = ordinaryPrReview ? citedPurposeReferences(ordinaryPrReview).find(ref => readableRefs.has(ref.id))?.id : undefined;
  const reader = () => mainRef.current?.closest<HTMLElement>(".dashboard-report-reader") ?? null;
  function openCode(id: string, origin?: CodeOrigin, trigger?: HTMLElement | null) {
    triggerRef.current = trigger ?? null;
    setCodeRef({ detailId: detail.id, id, origin });
    focusAfterRender.current = "pane";
    if (!showDetailedEvidence) { restoreRef.current = { scrollY: window.scrollY, readerTop: reader()?.scrollTop ?? 0 }; onShowDetail(); }
  }
  function closeCode() { focusAfterRender.current = "trigger"; onShowDetail(); }
  useEffect(() => {
    const next = focusAfterRender.current;
    if (next === "pane" && codeOpen && paneRef.current) {
      focusAfterRender.current = null;
      paneRef.current.focus({ preventScroll: true });
      // Narrow view replaces the description with the code; start the code view at its top.
      if (mainRef.current && getComputedStyle(mainRef.current).display === "none") paneRef.current.scrollIntoView({ block: "start" });
    } else if (next === "trigger" && !codeOpen) {
      focusAfterRender.current = null;
      const saved = restoreRef.current, pane = reader();
      if (saved) { window.scrollTo({ top: saved.scrollY }); if (pane) pane.scrollTop = saved.readerTop; restoreRef.current = null; }
      const target = triggerRef.current?.isConnected ? triggerRef.current : codeButtonRef.current;
      target?.focus({ preventScroll: true });
    }
  });
  const readCode = workspace && readableRefs.size ? { readable: readableRefs, selected: codeOpen && selected ? { id: selected.id, origin: selected.origin } : undefined, onRead: (id: string, origin?: CodeOrigin, trigger?: HTMLElement) => openCode(id, origin, trigger) } : undefined;
  const originText = (() => {
    const origin = codeOpen ? selected?.origin : undefined, clause = origin && report?.purposeReview?.clauses.find(c => c.clauseId === origin.clauseId);
    if (!origin || !clause) return undefined;
    const list = origin.kind === "change" ? clause.changeDescriptions : origin.kind === "test" ? clause.testDescriptions : origin.kind === "scope" ? clause.scopeNotes ?? [] : [];
    return list[origin.index]?.text;
  })();
  const [copyFeedback, setCopyFeedback] = useState<{ detail: typeof detail; state: "copied" | "failed" } | null>(null);
  const [copying, setCopying] = useState(false);
  async function copySelectedReport() {
    setCopying(true);
    try {
      await writeTextWithBrowserFallback(selectedReportToText(detail, report?.purposeReview ? undefined : summaryRef.current?.innerText));
      setCopyFeedback({ detail, state: "copied" });
    } catch {
      setCopyFeedback({ detail, state: "failed" });
    } finally {
      setCopying(false);
    }
  }
  const t = reportCopy(report?.purposeReview?.locale);
  const reportActions = <div className="summary-actions"><button className="dashboard-primary-action" aria-expanded={showDetailedEvidence} aria-controls="report-evidence-detail" onClick={onShowDetail}>{showDetailedEvidence ? t.hideEvidence : t.evidenceAndCode}</button><button className="dashboard-secondary-action" aria-label={t.copySelected} disabled={copying} onClick={copySelectedReport}><Clipboard size={15} />{t.copyReport}</button>{githubUrl ? <a className="dashboard-secondary-action dashboard-github-link" href={githubUrl} target="_blank" rel="noreferrer">GitHub <ExternalLink size={14} aria-hidden="true" /></a> : null}</div>;
  const workspaceActions = <div className="summary-actions report-toolbar">{firstReadable ? <button ref={codeButtonRef} className="dashboard-primary-action" aria-controls="report-code-pane" aria-expanded={codeOpen} onClick={() => { if (codeOpen) paneRef.current?.focus(); else openCode(firstReadable, undefined, codeButtonRef.current); }}>{t.viewCode}</button> : null}<button className="dashboard-secondary-action" aria-label={t.copySelected} disabled={copying} onClick={copySelectedReport}><Clipboard size={15} />{t.copyReport}</button>{githubUrl ? <a className="dashboard-secondary-action dashboard-github-link" href={githubUrl} target="_blank" rel="noreferrer">GitHub <ExternalLink size={14} aria-hidden="true" /></a> : null}</div>;
  const statusSummary = <div className="summary-status-grid">{detail.createdAt ? <SummaryState label="Analyzed" value={formatCreatedAt(detail.createdAt)} /> : null}{quickSummary.aiEvidenceState !== "Not requested" ? <SummaryState label="Analysis" value={quickSummary.aiEvidenceState} /> : null}</div>;
  return <article className={`quick-summary compact-report${workspace ? " report-workspace" : ""}${codeOpen ? " is-code-open" : ""}`} aria-label={`${formatPrNumber(detail.pullRequestNumber)} evidence report`}>
    <header className="quick-summary-header report-context"><h2>{formatPrNumber(detail.pullRequestNumber)}</h2>{versionContext ?? null}{workspace && detail.createdAt ? <time className="report-context-time" dateTime={detail.createdAt}>{formatCreatedAt(detail.createdAt)}</time> : null}<div className="summary-badges"><StatusToken label={quickSummary.freshness} /></div></header>
    {detail.freshness === "refresh_failed" ? <p className="dashboard-boundary dashboard-notice" role="status">Analysis refresh failed. {dashboardAnalysisFailureMessage(detail.failure)}</p> : null}
    <div className="report-workspace-main" ref={workspace ? mainRef : undefined}>
      <div ref={summaryRef}><ReportTopSummary report={report} review={ordinaryPrReview} stored actions={report?.purposeReview ? (workspace ? workspaceActions : reportActions) : undefined} readCode={readCode} /></div>
      {!report?.purposeReview ? reportActions : null}
      {copyFeedback?.detail === detail ? <p role={copyFeedback.state === "failed" ? "alert" : "status"}>{copyFeedback.state === "copied" ? t.reportCopied : t.copyFailed}</p> : null}
      {workspace
        ? <details className="report-materials"><summary>{t.materials}</summary><DetailedEvidence runtime={runtime} detail={detail} demoMode={demoMode} leadInSummary externalCodePane /></details>
        : <div id="report-evidence-detail" hidden={!showDetailedEvidence}>{showDetailedEvidence ? <><DetailedEvidence runtime={runtime} detail={detail} demoMode={demoMode} leadInSummary codeSelection={codeSelection} /><button className="dashboard-text-action dashboard-close-evidence" onClick={onShowDetail}>{t.hideEvidence}</button></> : null}</div>}
      <details className="dashboard-supporting-details"><summary>{t.reportStatus}</summary>{statusSummary}</details>
      {report?.semanticAnalysis?.status === "unavailable" ? <p className="dashboard-boundary"><Info size={15} /> Some evidence is unavailable.</p> : null}
    </div>
    {codeOpen && ordinaryPrReview ? <section id="report-code-pane" className="report-code-pane" ref={paneRef} tabIndex={-1} aria-label={t.citedCode} lang={report?.purposeReview?.locale === "ko" ? "ko" : undefined}>
      <div className="report-code-pane-bar">
        <button type="button" className="dashboard-secondary-action report-code-close" onClick={closeCode}><span className="report-when-narrow"><ArrowLeft size={16} aria-hidden="true" />{t.backToReport}</span><span className="report-when-wide">{t.closeCode}</span></button>
        {onPrList ? <button type="button" className="dashboard-text-action report-code-prlist" onClick={onPrList}>{t.backToPrList}</button> : null}
      </div>
      {originText ? <blockquote className="report-code-origin"><p className="report-code-origin-label">{t.selectedDescription}</p><p>{originText}</p></blockquote> : null}
      <PurposeCodeEvidence review={ordinaryPrReview} reportId={detail.id && !demoMode ? detail.id : undefined} runtime={runtime} selection={codeSelection} paneOwned />
    </section> : null}
  </article>;
}

export function DetailedEvidence({ detail, demoMode, runtime = webWorkspaceClient, leadInSummary = false, codeSelection, externalCodePane = false }: { runtime?: WorkspaceClient; detail: DashboardReportDetail & { repositoryFullName?: string }; demoMode: boolean; leadInSummary?: boolean; codeSelection?: CodeSelection; externalCodePane?: boolean }) {
  const ordinaryPrReview = buildDashboardPrEvidenceReview(detail);
  const codeContext = detail.id && !demoMode ? { reportId: detail.id, runtime } : undefined;
  const contractCode = !ordinaryPrReview && codeContext ? buildDashboardCodeItems(detail) : [];
  const report = ordinaryPrReview && detail.report
    ? { ...detail.report, reprompt: { prompt: ordinaryPrReview.nextInspection } }
    : detail.report;
  const ordinaryPrAssessment = report?.generalPrAssessmentSummary
    ? presentGeneralPrAssessmentSummary(report.generalPrAssessmentSummary)
    : undefined;
  const semantic = report?.semantic;
  const requirementCards = toDashboardRequirementViewModels({
    report,
    requirements: report?.requirements,
    semantic,
    semanticAnalysis: report?.semanticAnalysis,
    verificationContract: report?.verificationContract
  });
  const t = reportCopy(report?.purposeReview?.locale);
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
            fetchDetail: id => fetchDashboardCopyDetail(id, runtime)
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

  const checkResults = observedCheckResults(report?.testing);
  return <section className={`detailed-evidence${ordinaryPrReview ? " evidence-overview" : ""}`}>{copyUnavailable ? <p className="dashboard-boundary"><Info size={15} /> {copyUnavailableMessage}</p> : null}{copyError ? <p className="dashboard-boundary"><Info size={15} /> {t.copyFailed}</p> : null}{ordinaryPrReview ? <PrEvidenceReview review={ordinaryPrReview} compact codeContext={codeContext} leadInSummary={leadInSummary} codeSelection={codeSelection} externalCodePane={externalCodePane} /> : null}{contractCode.length && codeContext ? <details className="pr-evidence-context"><summary>Referenced code</summary>{contractCode.map(item => <div key={item.evidenceId}><code>{item.label}</code><ReportCodeViewer item={item} {...codeContext} /></div>)}</details> : null}{!ordinaryPrReview || report?.ordinaryDocumentationSummary || report?.ordinaryStaticSummary ? <details className="dashboard-supporting-details" ><summary>Supporting evidence &amp; checks</summary><div className="detail-grid">{report?.ordinaryDocumentationSummary ? <section aria-label="Scoped documentation evidence"><h5>Documentation predicate evidence</h5>{presentOrdinaryDocumentationSummary(report.ordinaryDocumentationSummary).map((line, index) => <p key={index}>{line}</p>)}</section> : null}{report?.ordinaryStaticSummary ? <section aria-label="Scoped static evidence"><h5>Static predicate evidence</h5>{presentOrdinaryStaticSummary(report.ordinaryStaticSummary).map((line, index) => <p key={index}>{line}</p>)}</section> : null}{!ordinaryPrReview ? <>{ordinaryPrAssessment ? <section><h5>{ordinaryPrAssessment.heading}</h5><div className="detail-row"><span>Result</span><strong>{ordinaryPrAssessment.conclusionLabel}</strong></div><div className="detail-row"><span>Source</span><strong>{ordinaryPrAssessment.sourceLabel}</strong></div><div className="detail-row"><span>Counts</span><strong>{ordinaryPrAssessment.countsLabel}</strong></div>{ordinaryPrAssessment.reasonLabels.map((reason) => <div className="detail-row" key={reason}><span>Why</span><strong>{reason}</strong></div>)}</section> : null}<section className="requirement-evidence-section"><h5>Requirements and PR objectives</h5>{requirementCards.length > 0 ? <RequirementEvidenceList requirements={requirementCards} /> : <p className="dashboard-empty">Unavailable</p>}</section></> : null}{!ordinaryPrReview ? <section><h5>Checks & CI</h5>{checkResults.length ? checkResults.map((item) => <div className="detail-row" key={item.label}><span>{item.label}</span><strong>{item.status}</strong></div>) : <p className="dashboard-empty">No check results collected.</p>}</section> : null}{!ordinaryPrReview ? <><section><h5>Priority files</h5>{report?.reviewPriority?.length ? report.reviewPriority.map((item) => <div className="detail-row" key={item.path}><code>{item.path}</code><span>{item.priority}</span></div>) : <p className="dashboard-empty">Unavailable</p>}</section><section><h5>Suggested next step</h5><p className="agent-request">{report?.reprompt?.prompt ?? "Unavailable"}</p></section></> : null}</div></details> : null}<details className="dashboard-report-export"><summary>{t.exportReport}</summary><div className="dashboard-section-heading"><div className="detailed-evidence-actions"><button className="dashboard-secondary-action" disabled={copyUnavailable} onClick={() => { void copyReport("markdown"); }}><Clipboard size={15} /> {copiedFormat === "markdown" ? t.copied : t.copyReport}</button><button className="dashboard-secondary-action" disabled={copyUnavailable} onClick={() => { void copyReport("json"); }}><Clipboard size={15} /> {copiedFormat === "json" ? t.copied : t.copyJson}</button></div></div></details></section>;
}

async function fetchDashboardCopyDetail(id: string, runtime: WorkspaceClient): Promise<DashboardReportDetail | null> {
  const response = await runtime.request(`/api/dashboard/reports?id=${encodeURIComponent(id)}`, { cache: "no-store" });
  const detail = await response.json().catch(() => null);
  return response.ok ? detail : null;
}

function SettingsPanel({ onBack, repositories, repository, onSelectRepository, pending, onUpdate, onLogout, logoutPending }: { onBack: () => void; repositories: ReturnType<typeof toRepositoryWorkspaceRows>; repository: ReturnType<typeof toRepositoryWorkspaceRows>[number] | undefined; onSelectRepository: (repositoryId: number | undefined) => void; pending: string | null; onUpdate: (setting: RepositorySetting, nextValue: boolean | ReportLanguage, privateAnalysisConsent?: boolean) => Promise<void>; onLogout: () => Promise<void>; logoutPending: boolean }) {
  const [privateConsentAccepted, setPrivateConsentAccepted] = useState(false);
  const needsPrivateConsent = repository?.repositoryPrivate === true && repository.privateAnalysisConsentVersion !== "2026-09-24.v1";
  const c = settingsCopy(repository?.reportLanguage);
  return <section className="dashboard-workspace settings-panel" lang={repository?.reportLanguage === "ko" ? "ko" : undefined}>
    <button type="button" className="dashboard-icon-button settings-back" aria-label={c.backToReports} title={c.backToReports} onClick={onBack}><ArrowLeft size={18} aria-hidden="true" /></button>
    {repositories.length > 0 ? <div className="dashboard-section"><div className="dashboard-section-heading"><div><h3>{c.connectedRepositories}</h3></div></div><div className="repository-tabs">{repositories.map((item) => <button key={`${item.installationId}:${item.repositoryId}`} className={item.repositoryId === repository?.repositoryId ? "repository-tab active" : "repository-tab"} aria-pressed={item.repositoryId === repository?.repositoryId} onClick={() => { setPrivateConsentAccepted(false); onSelectRepository(item.repositoryId); }}><span className="repository-tab-name">{item.repositoryFullName}</span><RepositoryMeta analysisOn={isActiveRepositoryGrant(item)} commentsOn={item.commentEnabled} privateRepository={item.repositoryPrivate === true} copy={c} /></button>)}</div></div> : null}
    {repository ? <><div className="dashboard-section-heading"><div><p className="dashboard-eyebrow">{repository.repositoryFullName}</p><h3>{c.repositorySettings}</h3></div></div>
      {/* Private repositories: the consent notice stays in one disclosure, open while consent is still needed; no always-on helper. */}
      {repository.repositoryPrivate === true ? <div className="settings-private">{needsPrivateConsent ? <label className="dashboard-toggle-row"><span><strong>{c.approvePrivate}</strong></span><input type="checkbox" checked={privateConsentAccepted} onChange={(event) => setPrivateConsentAccepted(event.target.checked)} /></label> : null}<details className="settings-private-details" open={needsPrivateConsent}><summary>{c.privateDetails}</summary><p>{c.privateNotice}</p></details></div> : null}
      <SettingToggle label={c.automaticAnalysis} detail={c.automaticAnalysisDetail} checked={isActiveRepositoryGrant(repository)} pending={pending === "analysisEnabled"} disabled={needsPrivateConsent && !privateConsentAccepted} onChange={(value) => { void onUpdate("analysisEnabled", value, value && needsPrivateConsent && privateConsentAccepted); }} />
      <SettingToggle label={c.savedReports} detail={c.savedReportsDetail} checked={repository.saveReportsEnabled} pending={pending === "saveReportsEnabled"} onChange={(value) => { void onUpdate("saveReportsEnabled", value); }} />
      <SettingToggle label={c.summaryComments} detail={repository.commentEnabled ? c.commentsEnabled : c.commentsOff} checked={repository.commentEnabled} pending={pending === "commentEnabled"} onChange={(value) => { void onUpdate("commentEnabled", value); }} />
      <ReportLanguageSetting copy={c} value={repository.reportLanguage ?? "en"} pending={pending === "reportLanguage"} onChange={(value) => { void onUpdate("reportLanguage", value); }} />
      {repository.repositoryPrivate === true && repository.llmAnalysisMode === "enhanced" ? <SettingToggle label={c.enhancedConsent} detail={c.enhancedConsentDetail} checked={repository.hybridPlannerConsentVersion === "2026-08-12.v1"} pending={pending === "hybridPlannerConsent"} onChange={(value) => { void onUpdate("hybridPlannerConsent", value); }} /> : null}
    </> : <p className="dashboard-empty">{c.selectRepository}</p>}
    <div className="dashboard-section-heading dashboard-account-settings"><h3>{c.account}</h3><a href="/account/delete">{c.deleteAccount}</a><button className="dashboard-secondary-action" disabled={logoutPending} onClick={() => { void onLogout(); }}>{logoutPending ? c.signingOut : c.logOut}</button></div>
  </section>;
}

/** First-connection guide: the same three steps as the home page, with the current step's real action. */
export function ConnectRepositoryGuide({ stage, onInstall, onConfirm }: { stage: "install" | "reauth" | "installation" | "repository"; onInstall: () => void; onConfirm: () => void }) {
  const current = stage === "reauth"
    ? { title: "Confirm GitHub access", body: "GitHub needs to confirm your App installation access before adding repositories. You are still signed in." }
    : stage === "installation"
    ? { title: "Choose a GitHub installation", body: "More than one GitHub account or organization has the app installed. Choose the one to use below." }
    : stage === "repository"
      ? { title: "Choose the repository to read", body: "Your GitHub App installation is connected. Pick a repository below; private repositories ask for consent first." }
      : { title: "Install the app and choose repositories", body: "GitHub opens the app installation page. Choose all or only selected repositories, then install. For an organization, an owner may need to approve the request. GitHub then returns you here." };
  return <section className="dashboard-connect-guide" aria-labelledby="connect-guide-title">
    <p className="dashboard-eyebrow">Set up</p>
    <h2 id="connect-guide-title">Connect a repository</h2>
    <ol className="connect-steps">
      <li className="is-done"><span className="connect-step-mark" aria-hidden="true"><CheckCircle2 size={18} /></span><div><h3>Signed in with GitHub</h3><p>Your workspace is linked to your GitHub account.</p></div></li>
      <li className="is-current" aria-current="step"><span className="connect-step-mark" aria-hidden="true">2</span><div><h3>{current.title}</h3><p>{current.body}</p>{stage === "install" ? <button type="button" className="dashboard-primary-action" onClick={onInstall}><Github size={17} aria-hidden="true" /> Add repositories</button> : stage === "reauth" ? <p className="connect-step-action" role="status"><button type="button" className="dashboard-primary-action" onClick={onConfirm}><Github size={17} aria-hidden="true" />Confirm with GitHub</button></p> : null}</div></li>
      <li><span className="connect-step-mark" aria-hidden="true">3</span><div><h3>Open a pull request report</h3><p>Choose a pull request and generate its report.</p></div></li>
    </ol>
  </section>;
}

/** One label scale for repository state wherever repositories are listed. */
function RepositoryMeta({ analysisOn, commentsOn, privateRepository, copy = settingsCopy("en") }: { analysisOn: boolean; commentsOn?: boolean; privateRepository?: boolean; copy?: SettingsCopy }) {
  return <span className="repository-meta"><span className={`dashboard-status tone-${analysisOn ? "ok" : "none"}`}><i aria-hidden="true" />{analysisOn ? copy.analysisOn : copy.analysisOff}</span><span className="dashboard-chip">{commentsOn ? copy.commentsOnChip : copy.commentsOffChip}</span>{privateRepository ? <span className="dashboard-chip">{copy.privateChip}</span> : null}</span>;
}

/** Saved per repository; the server freezes it into each new report, so existing reports keep their language. */
function ReportLanguageSetting({ copy, value, pending, onChange }: { copy: SettingsCopy; value: ReportLanguage; pending: boolean; onChange: (value: ReportLanguage) => void }) {
  return <fieldset className="dashboard-language-setting" disabled={pending} aria-busy={pending}>
    <legend><strong>{copy.reportLanguage}</strong></legend>
    <div className="dashboard-language-options">{([["en", "English"], ["ko", "한국어"]] as const).map(([code, label]) => <label key={code} className="dashboard-language-option"><input type="radio" name="report-language" value={code} checked={value === code} onChange={() => onChange(code)} /><span lang={code}>{label}</span></label>)}</div>
  </fieldset>;
}

function SettingToggle({ label, detail, checked, pending, disabled = false, onChange }: { label: string; detail: string; checked: boolean; pending: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return <label className="dashboard-toggle-row"><span><strong>{label}</strong><small>{detail}</small></span><input type="checkbox" checked={checked} disabled={pending || disabled} onChange={(event) => onChange(event.target.checked)} /></label>;
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
  return headSha?.slice(0, 8) || "not recorded";
}

function formatPrNumber(pullRequestNumber?: number | null): string {
  return pullRequestNumber && Number.isSafeInteger(pullRequestNumber) ? `PR #${pullRequestNumber}` : "PR number not recorded";
}

function formatCreatedAt(createdAt: string): string {
  const value = new Date(createdAt);
  return Number.isNaN(value.getTime()) ? "Date not recorded" : value.toLocaleString();
}

function mergeConnectedRepository(current: DashboardRepositoryGrant[], next: DashboardRepositoryGrant): DashboardRepositoryGrant[] {
  const remaining = current.filter((repository) => repository.repositoryId !== next.repositoryId || repository.installationId !== next.installationId);
  return [...remaining, next];
}

function repositoryLabel(repositoryId: number | undefined, repositories: DashboardRepositoryGrant[]): string | undefined {
  return repositories.find((repository) => repository.repositoryId === repositoryId)?.repositoryFullName ?? (repositoryId ? `Repository #${repositoryId}` : undefined);
}

export { WorkspaceSignIn };

const READ_ACTIVITY_KEY = "agentproof.inbox.read.v1";
/** Activity IDs are per report/job, so the stored set never marks another account's events. */
function readStoredActivityIds(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(READ_ACTIVITY_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(-300) : [];
  } catch { return []; }
}
