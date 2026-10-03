"use client";

import { webWorkspaceClient, type WorkspaceClient } from "@/lib/workspace-client";
import { FileCheck2, Loader2, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { readReportHistory, type StoredReport } from "@/lib/report-history";
import type { DashboardRepositoryGrant, DashboardSavedReport, DashboardReportDetail } from "@/lib/github-dashboard-view-model";
import { validateRuntimeReportBoundary } from "@/lib/report-runtime-validation";

type PullRequest = { number: number; title: string; state: string; headSha: string };
type Commit = { sha: string; message: string; url: string };
/** Last loaded list per repository for this signed-in page, so returning to a
 * repository or from Settings shows it at once while a quiet refresh runs. */
export type PullRequestWorkspaceCache = Map<number, { pullRequests: PullRequest[]; history?: DashboardSavedReport[]; selected: number; extra?: PullRequest[] }>;
type History = { pullRequests?: PullRequest[]; commits?: Commit[]; truncated?: boolean; pullRequestUrl?: string; analysisPrUrl?: string; headSha?: string };

/** Controlled by the dashboard's single repository selection. No browser
 * history stores reports here: only the tenant's durable API is authoritative. */
export function RepositoryPullRequestWorkspace({ repositoryId, repositoryFullName, canGenerate = true, refreshKey, activeReportId, cache, onOpenReport, onGeneratedReport, onHistoryChange, runtime = webWorkspaceClient }: {
  repositoryId: number; repositoryFullName: string; canGenerate?: boolean; refreshKey?: unknown;
  cache?: PullRequestWorkspaceCache;
  /** Report currently open in the reader, marked "Viewing" on the shelf. */
  activeReportId?: string;
  onOpenReport: (id: string) => void;
  onHistoryChange?: (items: DashboardSavedReport[]) => void;
  onGeneratedReport: (detail: DashboardReportDetail) => void;
  runtime?: WorkspaceClient;
}) {
  const [reload, setReload] = useState(0);
  const cached = cache?.get(repositoryId);
  const [selected, setSelected] = useState(cached?.selected ?? 0);
  const [prState, setPrState] = useState<{ repositoryId: number; items: PullRequest[]; error?: string } | null>(cached ? { repositoryId, items: cached.pullRequests } : null);
  // `loaded` stays true through quiet refreshes so rows never flash a loading state.
  const [history, setHistory] = useState<{ repositoryId: number; items: DashboardSavedReport[]; loading: boolean; loaded?: boolean; error?: string } | null>(cached?.history ? { repositoryId, items: cached.history, loading: false, loaded: true } : null);
  const [generation, setGeneration] = useState<{ repositoryId: number; number: number; status: "busy" | "saved" | "unsaved" | "error"; message: string } | null>(null);
  // Narrow screens show one column at a time: the PR list or one PR's shelf.
  const [pane, setPane] = useState<"list" | "shelf">("list");
  // PRs opened by number/URL from outside the recent list, and a pending same-head regeneration.
  const [extraPrs, setExtraPrs] = useState<{ repositoryId: number; items: PullRequest[] } | null>(cached?.extra?.length ? { repositoryId, items: cached.extra } : null);
  const [lookup, setLookup] = useState({ value: "", error: "", busy: false });
  const [confirmRegenerate, setConfirmRegenerate] = useState(0);
  const lookupRequest = useRef(0);
  const running = useRef<AbortController | null>(null);
  const historyRequest = useRef(0);
  const selection = useRef({ repositoryId, number: cached?.selected ?? 0, version: 0 });
  // Invalidate synchronously so an old promise cannot win before effects run.
  if (selection.current.repositoryId !== repositoryId) {
    selection.current = { repositoryId, number: 0, version: selection.current.version + 1 };
  }

  useEffect(() => {
    setSelected(cache?.get(repositoryId)?.selected ?? 0);
    setPane("list");
    return () => { running.current?.abort(); running.current = null; };
  }, [repositoryId]);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++historyRequest.current;
    const valid = () => !controller.signal.aborted && selection.current.repositoryId === repositoryId;
    setHistory(previous => previous?.repositoryId === repositoryId ? { ...previous, loading: true, error: undefined } : { repositoryId, items: [], loading: true });
    void (async () => {
      try {
        const response = await runtime.request(`/api/dashboard/pull-requests?repositoryId=${repositoryId}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok || !Array.isArray(body.pullRequests)) throw new Error();
        if (valid()) setPrState({ repositoryId, items: body.pullRequests });
      } catch {
        if (valid()) setPrState(previous => ({ repositoryId, items: previous?.repositoryId === repositoryId ? previous.items : [], error: "Could not load pull requests. Check repository access and try again." }));
      }
    })();
    void (async () => {
      try {
        const items = new Map<string, DashboardSavedReport>();
        let offset = 0;
        // Fixed-size metadata pages keep every retained version reachable;
        // there is no browser-history cap or current-head-only filter.
        while (valid() && historyRequest.current === requestId) {
          const response = await runtime.request(`/api/dashboard/reports?repositoryId=${repositoryId}&scope=history&offset=${offset}`, { cache: "no-store", signal: controller.signal });
          const body = await response.json();
          if (!response.ok || !Array.isArray(body.reports)) throw new Error();
          for (const report of body.reports) if (report.repositoryId === repositoryId) items.set(report.id, report);
          if (!body.hasMore) break;
          if (!Number.isSafeInteger(body.nextOffset) || body.nextOffset <= offset) throw new Error();
          offset = body.nextOffset;
        }
        if (valid() && historyRequest.current === requestId) setHistory({ repositoryId, items: [...items.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)), loading: false, loaded: true });
      } catch {
        if (valid() && historyRequest.current === requestId) setHistory(previous => ({ repositoryId, items: previous?.repositoryId === repositoryId ? previous.items : [], loading: false, loaded: previous?.repositoryId === repositoryId && previous.loaded, error: "Saved report history could not be loaded. Try again." }));
      }
    })();
    return () => controller.abort();
  }, [repositoryId, runtime, reload, refreshKey]);

  useEffect(() => {
    if (history?.repositoryId === repositoryId && history.loaded) onHistoryChange?.(history.items);
  }, [history, repositoryId]);

  useEffect(() => {
    if (!cache || prState?.repositoryId !== repositoryId) return;
    cache.set(repositoryId, { pullRequests: prState.items, history: history?.repositoryId === repositoryId && history.loaded ? history.items : cache.get(repositoryId)?.history, selected, extra: extraPrs?.repositoryId === repositoryId ? extraPrs.items : [] });
  }, [prState, history, selected, extraPrs, repositoryId]);

  function selectPr(number: number) {
    selection.current = { repositoryId, number, version: selection.current.version + 1 };
    setSelected(number);
  }

  async function generate(pr: PullRequest) {
    if (running.current || !canGenerate) return;
    selectPr(pr.number);
    const version = selection.current.version;
    const controller = new AbortController();
    running.current = controller;
    setGeneration({ repositoryId, number: pr.number, status: "busy", message: "Generating an evidence report from the PR’s current GitHub head…" });
    const valid = () => !controller.signal.aborted && selection.current.repositoryId === repositoryId;
    try {
      const response = await runtime.request("/api/dashboard/analyze", {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", "x-agentproof-csrf": "same-origin", "x-agentproof-analysis-key": crypto.randomUUID() },
        body: JSON.stringify({ prUrl: `https://github.com/${repositoryFullName}/pull/${pr.number}` })
      });
      const body = await response.json().catch(() => null);
      if (!valid()) return;
      if (!response.ok) throw new Error(body?.error || "Report generation failed. Previous reports are unchanged. Try again.");
      const target = body?.target;
      let validReport = false;
      try {
        validReport = Boolean(body?.report && validateRuntimeReportBoundary({ boundary: "signed_summary_read", projection: "tenant", report: body.report }).valid);
      } catch { /* Malformed JSON structures must not reach report rendering. */ }
      if (target?.repositoryId !== repositoryId || target?.pullRequestNumber !== pr.number || !/^[a-f0-9]{40}$/i.test(target?.headSha ?? "") ||
          !validReport || body.report.source?.provenance?.origin !== "github_snapshot" || body.report.source.provenance.headSha !== target.headSha ||
          !["saved", "failed"].includes(body.persistence?.status) ||
          (body.persistence.status === "saved" && (typeof body.persistence.id !== "string" || !Number.isFinite(Date.parse(body.persistence.createdAt))))) {
        throw new Error("The result could not be matched to this PR. Previous reports are unchanged.");
      }
      const saved = body.persistence.status === "saved";
      const detail: DashboardReportDetail = {
        ...target, report: body.report, id: saved ? body.persistence.id : undefined,
        createdAt: saved ? body.persistence.createdAt : undefined,
        priority: body.report.summary.priority, availability: "available",
        freshness: saved ? "current" : "unknown", copyEligible: saved
      };
      setPrState(previous => previous?.repositoryId === repositoryId ? { ...previous, items: previous.items.map(item=>item.number === pr.number ? { ...item, headSha: target.headSha } : item) } : previous);
      setExtraPrs(previous => previous?.repositoryId === repositoryId ? { ...previous, items: previous.items.map(item=>item.number === pr.number ? { ...item, headSha: target.headSha } : item) } : previous);
      if (saved) {
        ++historyRequest.current;
        setHistory(previous => ({ repositoryId, loading: false, loaded: true, items: [
          { ...detail, id: detail.id!, createdAt: detail.createdAt!, priority: detail.priority! },
          ...(previous?.repositoryId === repositoryId ? previous.items.filter(item=>item.id !== detail.id).map(item=>item.pullRequestNumber === pr.number ? { ...item, staleAt: detail.createdAt, freshness: "stale" as const, copyEligible: false } : item) : [])
        ] }));
      }
      setGeneration({ repositoryId, number: pr.number, status: saved ? "saved" : "unsaved",
        message: saved ? `Saved · analyzed head ${target.headSha.slice(0,12)}` : "Report generated, but it could not be saved. Previous reports are unchanged. Try again." });
      if (selection.current.version === version) onGeneratedReport(detail);
    } catch (error) {
      if (valid()) setGeneration({ repositoryId, number: pr.number, status: "error", message: error instanceof Error ? error.message : "Report generation failed. Try again." });
    } finally {
      if (running.current === controller) running.current = null;
    }
  }

  const recent = prState?.repositoryId === repositoryId ? prState : null;
  const extras = extraPrs?.repositoryId === repositoryId ? extraPrs.items.filter(pr => !recent?.items.some(item => item.number === pr.number)) : [];
  const prs = recent ? { ...recent, items: [...recent.items, ...extras] } : null;
  const savedHistory = history?.repositoryId === repositoryId ? history : null;
  const currentGeneration = generation?.repositoryId === repositoryId ? generation : null;
  const busy = currentGeneration?.status === "busy";
  const otherReports = savedHistory?.items.filter(item => !prs?.items.some(pr=>pr.number === item.pullRequestNumber)) ?? [];
  const versionsFor = (number: number) => savedHistory?.items.filter(item=>item.pullRequestNumber === number) ?? [];
  // The shelf always belongs to one PR: the chosen one, else the newest listed PR.
  const shelfPr = prs?.items.find(pr=>pr.number === selected) ?? prs?.items[0];
  const shelfVersions = shelfPr ? versionsFor(shelfPr.number) : [];
  const shelfLatest = shelfVersions.find(item=>item.availability === "available");
  const shelfProgress = shelfPr && currentGeneration?.number === shelfPr.number ? currentGeneration : null;
  const versionLabel = (index: number) => `v${shelfVersions.length - index}`;

  function openPr(pr: PullRequest) {
    selectPr(pr.number);
    setConfirmRegenerate(0);
    setPane("shelf");
    const latest = versionsFor(pr.number).find(item=>item.availability === "available");
    if (latest) onOpenReport(latest.id);
  }

  /** Uses the existing single-PR lookup, so tenant, installation and live repository checks still apply. */
  async function lookupPr(event: { preventDefault(): void }) {
    event.preventDefault();
    if (lookup.busy) return;
    const raw = lookup.value.trim();
    const url = raw.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/([1-9]\d*)\/?(?:[?#].*)?$/i);
    if (url && url[1]!.toLowerCase() !== repositoryFullName.toLowerCase()) { setLookup({ value: raw, error: "That pull request belongs to another repository. Select that repository first.", busy: false }); return; }
    const number = url ? Number(url[2]) : /^#?[1-9]\d*$/.test(raw) ? Number(raw.replace("#", "")) : 0;
    if (!Number.isSafeInteger(number) || number < 1) { setLookup({ value: raw, error: "Enter a PR number or this repository's PR URL.", busy: false }); return; }
    const listed = prs?.items.find(pr => pr.number === number);
    if (listed) { setLookup({ value: "", error: "", busy: false }); openPr(listed); return; }
    const request = ++lookupRequest.current;
    // A late response must not change a newer lookup or a different repository's list.
    const current = () => request === lookupRequest.current && selection.current.repositoryId === repositoryId;
    setLookup({ value: raw, error: "", busy: true });
    try {
      const response = await runtime.request(`/api/dashboard/pull-requests?repositoryId=${repositoryId}&pullRequestNumber=${number}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!current()) return;
      const pr = body?.pullRequest;
      if (!response.ok || pr?.number !== number || typeof pr.title !== "string" || typeof pr.state !== "string" || !/^[a-f0-9]{40}$/i.test(pr.headSha ?? "")) throw new Error();
      const found: PullRequest = { number, title: pr.title, state: pr.state, headSha: pr.headSha };
      setExtraPrs(previous => ({ repositoryId, items: [...(previous?.repositoryId === repositoryId ? previous.items.filter(item => item.number !== number) : []), found] }));
      setLookup({ value: "", error: "", busy: false });
      openPr(found);
    } catch {
      if (current()) setLookup({ value: raw, error: "Pull request not found or not accessible with this repository connection.", busy: false });
    }
  }

  /** A saved report for the same head opens first; paid analysis for that head starts only from the explicit confirmation. */
  function requestGenerate(pr: PullRequest, latest: DashboardSavedReport | undefined, confirmed = false) {
    if (latest && latest.headSha === pr.headSha && !confirmed) { setConfirmRegenerate(pr.number); onOpenReport(latest.id); return; }
    setConfirmRegenerate(0);
    void generate(pr);
  }

  const historyPending = !savedHistory || (!savedHistory.loaded && !savedHistory.error);
  return <section className={`dashboard-section dashboard-pr-workspace pane-${pane}`} aria-label="Pull requests and reports">
    <div className="dashboard-pr-column dashboard-pr-index">
      <div className="dashboard-section-heading"><div><h3>Pull requests</h3><p className="dashboard-section-copy">최근 PR 20개</p></div><button className="dashboard-icon-button" aria-label="Refresh pull requests" title="Refresh" onClick={()=>setReload(value=>value+1)} disabled={busy}><RotateCw size={16} /></button></div>
      <form className="dashboard-pr-lookup" onSubmit={event=>{void lookupPr(event);}}><input aria-label="Pull request number or URL" placeholder="PR # or URL" value={lookup.value} disabled={lookup.busy} onChange={event=>setLookup(previous => previous.busy ? previous : { value: event.target.value, error: "", busy: false })} /><button className="dashboard-secondary-action" type="submit" disabled={lookup.busy || !lookup.value.trim()}>{lookup.busy ? <Loader2 size={15} className="spin" /> : "Open"}</button></form>
      {lookup.error ? <p role="alert" className="dashboard-inline-alert">{lookup.error}</p> : null}
      {!prs ? <p role="status" className="dashboard-shelf-note"><Loader2 className="spin" size={14} /> Loading pull requests…</p> : null}
      {prs?.error ? <p role="alert" className="dashboard-inline-alert">{prs.error}</p> : null}
      {savedHistory?.error ? <p role="alert" className="dashboard-inline-alert">{savedHistory.error}</p> : null}
      {prs && !prs.error && !prs.items.length ? <p className="dashboard-empty">No pull requests found.</p> : null}
      <ul className="dashboard-pr-list">{prs?.items.map(pr => {
        const versions = versionsFor(pr.number);
        const latest = versions.find(item=>item.availability === "available");
        const generating = currentGeneration?.number === pr.number && currentGeneration.status === "busy";
        const [tone, status] = generating ? ["wait", "Generating…"]
          : latest ? latest.headSha === pr.headSha ? ["ok", "Report available"] : ["wait", "Previous head report"]
          : historyPending ? ["none", "Loading…"] : savedHistory?.error ? ["fail", "Status unavailable"] : ["none", "No saved report"];
        return <li className={`dashboard-pr-row${shelfPr?.number === pr.number ? " selected" : ""}`} key={pr.number}>
          <button className="dashboard-pr-title" aria-label={`Select PR #${pr.number}`} aria-current={shelfPr?.number === pr.number ? "true" : undefined} onClick={()=>openPr(pr)}>
            <span className="dashboard-pr-line"><span className="dashboard-pr-number">#{pr.number}</span><strong>{pr.title}</strong></span>
            <span className="dashboard-pr-meta"><span className={`dashboard-status tone-${tone}`}>{generating ? <Loader2 size={12} className="spin" aria-hidden="true" /> : <i aria-hidden="true" />}{status}</span>{versions.length > 1 ? <span>{versions.length} versions</span> : null}<span className={`dashboard-pr-state state-${pr.state}`}>{pr.state}</span></span>
          </button>
        </li>;
      })}</ul>
      {otherReports.length ? <details className="dashboard-pr-history"><summary>Other PRs with saved reports ({otherReports.length})</summary>{otherReports.map(item=><button key={item.id} className="dashboard-list-row" aria-label={`View report version ${item.id}`} disabled={item.availability !== "available"} onClick={()=>{selectPr(item.pullRequestNumber ?? 0);onOpenReport(item.id);}}><FileCheck2 size={15} /><span>PR #{item.pullRequestNumber} · {formatVersionTime(item.createdAt)}<small>head {item.headSha?.slice(0,7) ?? "not recorded"}{item.availability !== "available" ? " · Unavailable" : ""}</small></span></button>)}</details> : null}
    </div>
    <div className="dashboard-pr-column dashboard-version-shelf" aria-label="Saved report versions">
      {shelfPr ? <>
        <button className="dashboard-back-action dashboard-shelf-back" onClick={()=>setPane("list")}>← All pull requests</button>
        <div className="dashboard-shelf-heading"><p><span className="dashboard-pr-number">PR #{shelfPr.number}</span> · {shelfVersions.length} saved</p><h4>{shelfPr.title}</h4></div>
        <button className={`${shelfLatest ? "dashboard-secondary-action" : "dashboard-primary-action"} dashboard-shelf-generate`} aria-label={`${shelfLatest ? "Regenerate" : "Generate"} report for PR #${shelfPr.number}`} title={shelfLatest ? "Saves a new version. Existing versions are kept." : undefined} disabled={busy || !canGenerate} onClick={()=>requestGenerate(shelfPr, shelfLatest)}>{shelfProgress?.status === "busy" ? <><Loader2 size={15} className="spin" /> Generating…</> : shelfLatest ? <><RotateCw size={15} /> Regenerate</> : "Generate report"}</button>
        {confirmRegenerate === shelfPr.number && shelfLatest ? <div className="dashboard-shelf-confirm" role="status"><p>Already saved for this commit ({shelfLatest.headSha?.slice(0,7)}). Regenerate only if checks or settings changed.</p><div><button className="dashboard-primary-action" aria-label={`Regenerate anyway for PR #${shelfPr.number}`} disabled={busy || !canGenerate} onClick={()=>requestGenerate(shelfPr, shelfLatest, true)}>Regenerate anyway</button><button className="dashboard-text-action" onClick={()=>setConfirmRegenerate(0)}>Cancel</button></div></div> : null}
        {!canGenerate ? <p className="dashboard-shelf-note">Analysis is off for this repository (Settings).</p> : null}
        {shelfProgress && shelfProgress.status !== "busy" ? <p role={shelfProgress.status === "error" || shelfProgress.status === "unsaved" ? "alert" : "status"} className={`dashboard-shelf-note tone-${shelfProgress.status === "saved" ? "ok" : "fail"}`}>{shelfProgress.message}</p> : null}
        {shelfVersions.length ? <ol className="dashboard-version-list">{shelfVersions.map((item, index)=>{
          const viewing = item.id === activeReportId;
          const unavailable = item.availability !== "available";
          return <li key={item.id} className={viewing ? "viewing" : undefined}>
            <button className="dashboard-version-card" aria-label={item === shelfLatest ? `View report for PR #${shelfPr.number}` : `View report version ${item.id}`} aria-current={viewing ? "true" : undefined} disabled={unavailable} onClick={()=>{selectPr(shelfPr.number);onOpenReport(item.id);}}>
              <span className="dashboard-version-badges"><span className="dashboard-version-tag">{versionLabel(index)}</span>{item === shelfLatest ? <span className="dashboard-version-latest">Latest</span> : null}{viewing ? <span className="dashboard-version-viewing">Viewing</span> : null}</span>
              <span className="dashboard-version-meta"><time dateTime={item.createdAt}>{formatVersionTime(item.createdAt)}</time><code>{item.headSha?.slice(0,7) ?? "no head"}</code></span>
              {unavailable ? <span className="dashboard-status tone-fail"><i aria-hidden="true" />Unavailable</span> : item.headSha !== shelfPr.headSha ? <span className="dashboard-status tone-wait"><i aria-hidden="true" />Previous head</span> : null}
            </button>
          </li>;
        })}</ol> : historyPending ? <p role="status" className="dashboard-shelf-note"><Loader2 className="spin" size={14} /> Loading versions…</p> : <p className="dashboard-empty">No saved report yet.</p>}
      </> : <p className="dashboard-empty">Select a pull request.</p>}
    </div>
  </section>;
}

function formatVersionTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Time not recorded";
}

export function RepositoryCommitBrowser({ repositories, runtime = webWorkspaceClient }: { repositories: DashboardRepositoryGrant[]; runtime?: WorkspaceClient }) {
  const connected = repositories.filter((repo): repo is DashboardRepositoryGrant & { repositoryId: number } => repo.enabled && typeof repo.repositoryId === "number");
  const [repositoryId, setRepositoryId] = useState(0);
  const repository = connected.find(repo => repo.repositoryId === repositoryId);
  return <section className="dashboard-section" aria-label="Browse GitHub commits">
    <div className="dashboard-section-heading"><div><h3>PRs and commits</h3><p className="dashboard-section-copy">Browse the 20 most recently updated pull requests. Open a commit on GitHub or choose to analyze the PR's current head.</p></div></div>
    <label>Connected repository <select className="select" aria-label="Repository for commit browsing" value={repository?.repositoryId ?? 0} onChange={event => setRepositoryId(Number(event.target.value))}>
      <option value={0}>Select a repository</option>
      {connected.map(repo => <option key={repo.repositoryId} value={repo.repositoryId}>{repo.repositoryFullName}</option>)}
    </select></label>
    {connected.length === 0 ? <p className="dashboard-empty">Connect a repository to browse its pull requests.</p> : null}
    {repository ? <PullRequestBrowser runtime={runtime} key={repository.repositoryId} repositoryId={repository.repositoryId} repositoryFullName={repository.repositoryFullName} /> : null}
  </section>;
}

export function PullRequestBrowser({ repositoryId, repositoryFullName = "", runtime = webWorkspaceClient }: { repositoryId: number; repositoryFullName?: string; runtime?: WorkspaceClient }) {
  const [pullRequestNumber, setPullRequestNumber] = useState(0);
  const [reload, setReload] = useState(0);
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
  const [result, setResult] = useState<{ query: string; data?: History; error?: string } | null>(null);
  const [selectedSha, setSelectedSha] = useState("");
  const [localReports, setLocalReports] = useState<StoredReport[]>([]);
  const analysisStarted = useRef(false);
  useEffect(() => { setLocalReports(readReportHistory(runtime.storage)); }, []);
  const localSummaryFor = (prUrl: string, headSha: string) => localReports.find(item =>
    item.report?.source?.url?.toLowerCase() === prUrl.toLowerCase()
    && item.report.source.provenance?.origin === "github_snapshot"
    && item.report.source.provenance.headSha?.toLowerCase() === headSha.toLowerCase()
    && Number.isFinite(Date.parse(item.savedAt)));
  const query = `/api/dashboard/pull-requests?repositoryId=${repositoryId}${pullRequestNumber ? `&pullRequestNumber=${pullRequestNumber}` : ""}`;
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setSelectedSha("");
    analysisStarted.current = false;
    void (async () => {
      try {
        const response = await runtime.request(query, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        const data: History = await response.json();
        if (controller.signal.aborted) return;
        if (data.pullRequests) setPullRequests(data.pullRequests);
        setResult({ query, data });
      } catch {
        if (!controller.signal.aborted) setResult({ query, error: "Could not load GitHub history. Check repository access and try again." });
      }
    })();
    return () => controller.abort();
  }, [query, reload]);
  // Never render a previous request's links while a new selection is loading.
  const current = result?.query === query ? result : null;
  const commits = current?.data?.commits ?? [];
  const selectedCommit = commits.find(commit => commit.sha === selectedSha);
  const selectedLocalSummary = current?.data?.analysisPrUrl && current.data.headSha
    ? localSummaryFor(current.data.analysisPrUrl, current.data.headSha) : null;
  return <div>
    <label>Recent pull request <select className="select" aria-label="Recent pull request" value={pullRequestNumber} onChange={event => { setPullRequestNumber(Number(event.target.value)); setSelectedSha(""); }}>
      <option value={0}>Select a pull request</option>
      {pullRequests.map(pr => <option key={pr.number} value={pr.number}>#{pr.number} · {pr.title} · {pr.state}{repositoryFullName && localSummaryFor(`https://github.com/${repositoryFullName}/pull/${pr.number}`, pr.headSha) ? " · Local summary" : ""}</option>)}
    </select></label>
    {!current ? <p role="status">Loading GitHub history…</p> : current.error ? <p role="alert">{current.error}</p> : !pullRequestNumber && pullRequests.length === 0 ? <p>No pull requests found.</p> : null}
    {current ? <button className="dashboard-text-action" onClick={() => setReload(value => value + 1)}>Refresh GitHub history</button> : null}
    {current?.data?.commits ? <>
      {selectedLocalSummary ? <p className="dashboard-boundary"><FileCheck2 size={16} aria-label="Local summary available" /> Local summary saved {new Date(selectedLocalSummary.savedAt).toLocaleString()} · <a href="/analyze">View in Recent</a></p> : null}
      {current.data.analysisPrUrl && /^[a-f0-9]{40}$/i.test(current.data.headSha ?? "") ? <p>
        <button type="button" className="dashboard-text-action" disabled={analysisStarted.current} onClick={() => {
          if (analysisStarted.current) return;
          try {
            const nonce = crypto.randomUUID();
            runtime.launchStorage.setItem("agentproof.pendingAnalysis.v1", JSON.stringify({ nonce, prUrl: current.data!.analysisPrUrl, listedHeadSha: current.data!.headSha }));
            analysisStarted.current = true;
            runtime.navigate(`/analyze?launch=${nonce}`);
          } catch {
            setResult({ query, error: "Could not start analysis in this browser. Open the PR URL in the analysis workspace." });
          }
        }}>Analyze current PR head</button>
        <span className="dashboard-boundary"> Analysis fetches the PR's current head; it does not analyze the selected historical commit.</span>
      </p> : null}
      {commits.length ? <label>Commit <select className="select" aria-label="Commit to open" value={selectedCommit?.sha ?? ""} onChange={event => setSelectedSha(event.target.value)}>
        <option value="">Select a commit</option>
        {commits.map(commit => <option key={commit.sha} value={commit.sha}>{commit.sha.slice(0, 12)} · {commit.message}</option>)}
      </select></label> : <p>No commits found.</p>}
      {selectedCommit ? <p><code style={{ overflowWrap: "anywhere" }}>{selectedCommit.sha}</code> <a className="dashboard-text-action" href={selectedCommit.url} target="_blank" rel="noopener noreferrer">Open exact commit on GitHub</a></p> : null}
      {current.data.truncated ? <p className="dashboard-boundary">Showing the current head and up to the first 100 PR commits. <a href={current.data.pullRequestUrl} target="_blank" rel="noopener noreferrer">View all PR commits on GitHub</a></p> : null}
    </> : null}
  </div>;
}
