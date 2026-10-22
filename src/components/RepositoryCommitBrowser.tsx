"use client";

import {startAnalysisClientDiagnostic,analysisClientErrorKind} from '@/lib/analysis-client-diagnostics';

import { webWorkspaceClient, type WorkspaceClient } from "@/lib/workspace-client";
import { FileCheck2, Loader2, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { readReportHistory, type StoredReport } from "@/lib/report-history";
import { dashboardAnalysisFailureMessage, isDashboardAnalysisJob, type DashboardAnalysisJob } from "@/lib/github-dashboard-view-model";
import type { DashboardRepositoryGrant, DashboardSavedReport, DashboardReportDetail } from "@/lib/github-dashboard-view-model";
import { validateRuntimeReportBoundary } from "@/lib/report-runtime-validation";

type PullRequest = { number: number; title: string; state: string; headSha: string };
type Generation = {
  repositoryId: number; number: number; status: "busy" | "queued" | "running" | "checking" | "saved" | "unsaved" | "error"; message: string;
  requestKey: string; startedAt: number; headSha: string; knownReportIds: string[]; historyRecoveryAllowed: boolean; transportFailure?: boolean; job?: DashboardAnalysisJob; jobChecking?: boolean; selectionVersion?: number;
};
type Commit = { sha: string; message: string; url: string };
/** Last loaded list per repository for this signed-in page, so returning to a
 * repository or from Settings shows it at once while a quiet refresh runs. */
export type PullRequestWorkspaceCache = Map<number, { pullRequests: PullRequest[]; history?: DashboardSavedReport[]; selected: number; extra?: PullRequest[] }>;
type History = { pullRequests?: PullRequest[]; commits?: Commit[]; truncated?: boolean; pullRequestUrl?: string; analysisPrUrl?: string; headSha?: string };

/** Controlled by the dashboard's single repository selection. No browser
 * history stores reports here: only the tenant's durable API is authoritative. */
export function RepositoryPullRequestWorkspace({ repositoryId, repositoryFullName, canGenerate = true, reportLanguage = "en", refreshKey, resumeKey, activeReportId, cache, onOpenReport, onGeneratedReport, onHistoryChange, runtime = webWorkspaceClient }: {
  repositoryId: number; repositoryFullName: string; canGenerate?: boolean; reportLanguage?: "en" | "ko"; refreshKey?: unknown; resumeKey?: number;
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
  const [generations, setGenerations] = useState<Record<string, Generation>>({});
  // Narrow screens show one column at a time: the PR list or one PR's shelf.
  const [pane, setPane] = useState<"list" | "shelf">("list");
  // The selected PR's saved versions open in place under its row; closed by default.
  const [versionsOpenFor, setVersionsOpenFor] = useState(0);
  // PRs opened by number/URL from outside the recent list, and a pending same-head regeneration.
  const [extraPrs, setExtraPrs] = useState<{ repositoryId: number; items: PullRequest[] } | null>(cached?.extra?.length ? { repositoryId, items: cached.extra } : null);
  const [lookup, setLookup] = useState({ value: "", error: "", busy: false });
  const [confirmRegenerate, setConfirmRegenerate] = useState(0);
  const regenerateButton = useRef<HTMLButtonElement>(null);
  const lookupRequest = useRef(0);
  const running = useRef(new Map<string, AbortController>());
  const generationKey = (number: number) => `${repositoryId}:${number}`;
  const historyRequest = useRef(0);
  // Immediate handler guard; values identify the history read that owns each lock.
  const checkingHistory = useRef(new Map<string, number>());
  const jobReads = useRef(new Map<string, AbortController>());
  const jobBackoff = useRef(new Map<string, {failures:number;next:number}>());
  const forceJobChecks = useRef(new Set<string>());
  const selection = useRef({ repositoryId, number: cached?.selected ?? 0, version: 0 });
  // Invalidate synchronously so an old promise cannot win before effects run.
  if (selection.current.repositoryId !== repositoryId) {
    selection.current = { repositoryId, number: 0, version: selection.current.version + 1 };
  }

  useEffect(() => {
    setSelected(cache?.get(repositoryId)?.selected ?? 0);
    setPane("list");
    setGenerations(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => key.startsWith(`${repositoryId}:`))));
    return () => {
      for (const [key, controller] of running.current) {
        if (key.startsWith(`${repositoryId}:`)) { controller.abort(); running.current.delete(key); }
      }
      for (const key of checkingHistory.current.keys()) if (key.startsWith(`${repositoryId}:`)) checkingHistory.current.delete(key);
      for(const [key,controller] of jobReads.current)if(key.startsWith(`${repositoryId}:`)){controller.abort();jobReads.current.delete(key);jobBackoff.current.delete(key);forceJobChecks.current.delete(key);}
    };
  }, [repositoryId]);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++historyRequest.current;
    const failedRequests = new Map(Object.entries(generations)
      .filter(([, g]) => g.repositoryId === repositoryId && ["error", "checking"].includes(g.status) && g.transportFailure)
      .map(([key, g]) => [key, g.requestKey]));
    const valid = () => !controller.signal.aborted && selection.current.repositoryId === repositoryId;
    // A suspended page checks once when visible again, using the dashboard's existing resume event.
    if (failedRequests.size && !runtime.subscribeResume && typeof document !== "undefined" && document.visibilityState === "hidden") return () => controller.abort();
    for (const key of failedRequests.keys()) if (!running.current.has(key)) checkingHistory.current.set(key, requestId);
    setGenerations(previous => {
      let next = previous;
      for (const [key, requestKey] of failedRequests) {
        const failed = previous[key];
        if (failed?.requestKey === requestKey && failed.transportFailure && !running.current.has(key))
          next = { ...next, [key]: { ...failed, status: "checking", message: "Checking saved reports. Server completion is not yet confirmed." } };
      }
      return next;
    });
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
        const activeJobs:DashboardAnalysisJob[]=[];
        let offset = 0;
        let jobsUnavailable=false;
        // Fixed-size metadata pages keep every retained version reachable;
        // there is no browser-history cap or current-head-only filter.
        while (valid() && historyRequest.current === requestId) {
          const response = await runtime.request(`/api/dashboard/reports?repositoryId=${repositoryId}&scope=history&offset=${offset}`, { cache: "no-store", signal: controller.signal });
          const body = await response.json();
          if (!response.ok || !Array.isArray(body.reports)) throw new Error();
          if(body.jobsUnavailable===true)jobsUnavailable=true;
          if(offset===0&&Array.isArray(body.jobs))for(const job of body.jobs)if(isDashboardAnalysisJob(job)&&job.repositoryId===repositoryId&&['queued','running'].includes(job.status))activeJobs.push(job);
          for (const report of body.reports) if (report.repositoryId === repositoryId) items.set(report.id, report);
          if (!body.hasMore) break;
          if (!Number.isSafeInteger(body.nextOffset) || body.nextOffset <= offset) throw new Error();
          offset = body.nextOffset;
        }
        if (valid() && historyRequest.current === requestId) {
          const savedReports = [...items.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
          setHistory({ repositoryId, items: savedReports, loading: false, loaded: true, ...(jobsUnavailable?{error:'Analysis status could not be checked. Saved reports remain available.'}:{}) });
          setGenerations(previous => {
            let next = previous;
            for (const [key, requestKey] of failedRequests) {
              const failed = previous[key];
              if (!failed || failed.requestKey !== requestKey || !["error", "checking"].includes(failed.status) || !failed.transportFailure || running.current.has(key)) continue;
              const found = failed.historyRecoveryAllowed && savedReports.some(report => report.repositoryId === failed.repositoryId && report.pullRequestNumber === failed.number &&
                report.headSha === failed.headSha && report.availability === "available" && report.freshness === "current" && !report.staleAt &&
                typeof report.id === "string" && report.id.length > 0 && !failed.knownReportIds.includes(report.id) &&
                Number.isFinite(Date.parse(report.createdAt)) && Date.parse(report.createdAt) >= failed.startedAt);
              // A saved version confirms availability, not delivery of the failed POST.
              if (found) next = { ...next, [key]: { ...failed, status: "saved", transportFailure: false,
                message: "A new saved report was found. The earlier response was not confirmed." } };
              else next = { ...next, [key]: { ...failed, status: "error", message: "Response not received. Server completion is unknown. Check saved reports before generating again." } };
            }
            for(const job of activeJobs){
              const key=generationKey(job.pullRequestNumber),previous=next[key];
              if(previous?.status==='busy'||previous?.job?.id===job.id&&previous.job.revision===job.revision||previous&&Date.parse(job.updatedAt)<previous.startedAt)continue;
              next={...next,[key]:{repositoryId,number:job.pullRequestNumber,headSha:job.headSha,requestKey:`job:${job.id}:${job.revision}`,startedAt:Date.parse(job.updatedAt),knownReportIds:savedReports.filter(r=>r.pullRequestNumber===job.pullRequestNumber).map(r=>r.id),historyRecoveryAllowed:false,status:job.status==='running'?'running':'queued',job,message:jobMessage(job.status)}};
            }
            return next;
          });
        }
      } catch {
        if (valid() && historyRequest.current === requestId) {
          setHistory(previous => ({ repositoryId, items: previous?.repositoryId === repositoryId ? previous.items : [], loading: false, loaded: previous?.repositoryId === repositoryId && previous.loaded, error: "Saved report history could not be loaded. Try again." }));
          setGenerations(previous => {
            let next = previous;
            for (const [key, requestKey] of failedRequests) {
              const failed = previous[key];
              if (failed?.requestKey === requestKey && failed.status === "checking" && failed.transportFailure && !running.current.has(key))
                next = { ...next, [key]: { ...failed, status: "error", message: "Response not received. Server completion is unknown. Check saved reports before generating again." } };
            }
            return next;
          });
        }
      } finally {
        for (const key of failedRequests.keys()) if (checkingHistory.current.get(key) === requestId) checkingHistory.current.delete(key);
      }
    })();
    return () => {
      controller.abort();
      for (const key of failedRequests.keys()) if (checkingHistory.current.get(key) === requestId) checkingHistory.current.delete(key);
    };
  }, [repositoryId, runtime, reload, refreshKey, resumeKey]);

  const activeJobSignature=Object.entries(generations).filter(([,g])=>g.repositoryId===repositoryId&&g.job&&['queued','running','checking'].includes(g.status)).map(([key,g])=>`${key}:${g.requestKey}`).sort().join('|');
  const lastJobResume=useRef(resumeKey);
  useEffect(()=>{
    const returned=lastJobResume.current!==resumeKey;lastJobResume.current=resumeKey;
    const controllers:Array<[string,AbortController]>=[];
    if(!runtime.subscribeResume&&typeof document!=='undefined'&&document.visibilityState==='hidden')return;
    for(const [key,g] of Object.entries(generations)){
      if(g.repositoryId!==repositoryId||!g.job||!['queued','running','checking'].includes(g.status))continue;
      const forced=forceJobChecks.current.delete(key)||returned,backoff=jobBackoff.current.get(key);
      if(!forced&&backoff&&(backoff.failures>=3||Date.now()<backoff.next))continue;
      const controller=new AbortController();controllers.push([key,controller]);jobReads.current.set(key,controller);
      const current=()=>!controller.signal.aborted&&selection.current.repositoryId===repositoryId&&jobReads.current.get(key)===controller;
      const update=(change:Partial<Generation>)=>{if(current())setGenerations(previous=>previous[key]?.requestKey===g.requestKey?{...previous,[key]:{...previous[key]!,...change}}:previous);};
      update({jobChecking:true});
      void(async()=>{
        try{
          const response=await runtime.request(`/api/dashboard/analyze?jobId=${encodeURIComponent(g.job!.id)}&repositoryId=${repositoryId}&revision=${g.job!.revision}`,{cache:'no-store',signal:controller.signal});
          if(!current())return;
          if(response.status===401||response.status===403){update({status:'error',message:response.status===401?'Sign in again to use this workspace.':'Open repository settings to continue.'});return;}
          const body=await response.json();const job=body?.job;
          if(!response.ok||!isDashboardAnalysisJob(job)||job.id!==g.job!.id||job.repositoryId!==repositoryId||job.pullRequestNumber!==g.number||job.headSha!==g.headSha)throw new Error('job_status_unavailable');
          if(!current())return;
          if(job.status==='superseded'||job.revision!==g.job!.revision){update({status:'error',message:'Another analysis replaced this request. Check saved reports.'});return;}
          if(job.status==='saved'){
            if(!job.reportId)throw new Error('job_saved_ack_missing');
            const detailResponse=await runtime.request(`/api/dashboard/reports?id=${encodeURIComponent(job.reportId)}`,{cache:'no-store',signal:controller.signal});
            const detail=await detailResponse.json();
            if(!current())return;
            // Persisted tenant summaries omit source provenance. Their signed purpose
            // review retains the snapshot SHA; require every available anchor to agree.
            const sourceHead=detail.report?.source?.provenance?.headSha;
            const reviewHead=detail.report?.purposeReview?.headSha;
            const boundHead=(sourceHead===g.headSha||reviewHead===g.headSha)&&
              (sourceHead===undefined||sourceHead===g.headSha)&&(reviewHead===undefined||reviewHead===g.headSha);
            if(!detailResponse.ok||detail.id!==job.reportId||detail.repositoryId!==repositoryId||detail.pullRequestNumber!==g.number||detail.headSha!==g.headSha||detail.availability!=='available'||!Number.isFinite(Date.parse(detail.createdAt))||!validateRuntimeReportBoundary({boundary:'signed_summary_read',projection:'tenant',report:detail.report}).valid||!boundHead)throw new Error('job_saved_result_invalid');
            update({status:'saved',transportFailure:false,message:`Saved · analyzed head ${g.headSha.slice(0,12)}`});
            ++historyRequest.current;
            setHistory(previous=>({repositoryId,items:[{...detail},...(previous?.repositoryId===repositoryId?previous.items.filter(r=>r.id!==detail.id):[])].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),loading:false,loaded:true}));
            if(selection.current.number===g.number&&selection.current.version===g.selectionVersion)onGeneratedReport(detail);
          }else if(job.status==='failed')update({status:'error',message:dashboardAnalysisFailureMessage(),transportFailure:false});
          else if(job.status==='unknown')update({status:'error',job,message:reportLanguage==='ko'?'분석은 종료됐지만 저장된 결과를 확인하지 못했습니다. 저장된 보고서를 확인하세요.':'Analysis ended without a confirmed saved result. Check saved reports.',transportFailure:false});
          else update({status:job.status==='running'?'running':job.status==='queued'?'queued':'checking',message:jobMessage(job.status)});
          jobBackoff.current.delete(key);
        }catch{
          if(current()){
            const failures=(jobBackoff.current.get(key)?.failures??0)+1;
            jobBackoff.current.set(key,{failures,next:Date.now()+Math.min(60_000,5_000*2**(failures-1))});
            update({status:'checking',message:reportLanguage==='ko'?'상태를 확인하지 못했습니다. 저장된 보고서를 다시 확인하세요.':'Status could not be checked. Check saved reports again.'});
          }
        }finally{update({jobChecking:false});if(jobReads.current.get(key)===controller)jobReads.current.delete(key);}
      })();
    }
    return()=>{for(const[key,controller]of controllers){controller.abort();if(jobReads.current.get(key)===controller)jobReads.current.delete(key);}};
  },[repositoryId,runtime,reload,refreshKey,resumeKey,activeJobSignature]);

  function jobMessage(status:string){return status==='running'?(reportLanguage==='ko'?'서버에서 분석 중…':'Analyzing on the server…'):status==='queued'?(reportLanguage==='ko'?'분석 대기 중…':'Analysis queued…'):(reportLanguage==='ko'?'완료 여부가 아직 확인되지 않았습니다.':'Completion is not yet confirmed.');}

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
    const key = generationKey(pr.number);
    if (running.current.has(key) || checkingHistory.current.has(key) || ["checking","queued","running"].includes(generations[key]?.status??"") || !canGenerate) return;
    selectPr(pr.number);
    const version = selection.current.version;
    const controller = new AbortController();
    const attempt = { repositoryId, number: pr.number, requestKey: crypto.randomUUID(), startedAt: Date.now(), headSha: pr.headSha,
      // History has no origin request ID: overlapping unknown deliveries cannot be attributed safely.
      selectionVersion:version,
      historyRecoveryAllowed: generations[key]?.historyRecoveryAllowed !== false && !generations[key]?.transportFailure,
      knownReportIds: history?.repositoryId === repositoryId ? history.items.filter(r => r.pullRequestNumber === pr.number).map(r => r.id) : [] };
    let diagnostic:ReturnType<typeof startAnalysisClientDiagnostic>;
    const recordAbort=()=>diagnostic?.record('abort');
    running.current.set(key, controller);
    setGenerations(previous => ({ ...previous, [key]: { ...attempt, status: "busy", message: "Generating an evidence report from the PR’s current GitHub head…" } }));
    const valid = () => !controller.signal.aborted && running.current.get(key) === controller && selection.current.repositoryId === repositoryId;
    let failureMessage = dashboardAnalysisFailureMessage();
    let responseStatus:number|undefined;let receivePhase:'transport'|'body'|'validation'|'display'='transport';
    try {
      const clientRequestId=attempt.requestKey;
      diagnostic=startAnalysisClientDiagnostic(clientRequestId,version);
      if(diagnostic)controller.signal.addEventListener('abort',recordAbort,{once:true});
      const response = await runtime.request("/api/dashboard/analyze", {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", "x-agentproof-csrf": "same-origin", "x-agentproof-analysis-key": clientRequestId },
        body: JSON.stringify({ prUrl: `https://github.com/${repositoryFullName}/pull/${pr.number}` })
      });
      responseStatus=response.status;receivePhase='body';
      diagnostic?.headers(response);
      const body = await response.json().catch(error => {
        diagnostic?.record('body_failed');
        // A known HTTP failure stays a failure; a lost successful body leaves delivery unknown.
        if (response.ok && error instanceof TypeError) throw error;
        return null;
      });
      if(body!==null)diagnostic?.record('body_parsed');
      receivePhase='validation';
      if (!valid()) {diagnostic?.record('view_ignored');return;}
      if (!response.ok) diagnostic?.record('http_error',{status:response.status});
      if (!response.ok) {
        failureMessage = dashboardAnalysisFailureMessage({ code: response.status === 401 ? "workspace_session_changed" : body?.code });
        throw new Error("analysis_http_failure");
      }
      if(response.status===202){
        const job=body?.job;
        if(!isDashboardAnalysisJob(job)||job.repositoryId!==repositoryId||job.pullRequestNumber!==pr.number)throw new Error('analysis_receipt_invalid');
        setGenerations(previous=>({...previous,[key]:{...attempt,headSha:job.headSha,status:job.status==='running'?'running':'queued',message:jobMessage(job.status),job}}));
        setPrState(previous=>previous?.repositoryId===repositoryId?{...previous,items:previous.items.map(p=>p.number===pr.number?{...p,headSha:job.headSha}:p)}:previous);
        setReload(value=>value+1);
        return;
      }
      const target = body?.target;
      let validReport = false;
      try {
        validReport = Boolean(body?.report && validateRuntimeReportBoundary({ boundary: "signed_summary_read", projection: "tenant", report: body.report }).valid);
      } catch { /* Malformed JSON structures must not reach report rendering. */ }
      if (target?.repositoryId !== repositoryId || target?.pullRequestNumber !== pr.number || !/^[a-f0-9]{40}$/i.test(target?.headSha ?? "") ||
          !validReport || body.report.source?.provenance?.origin !== "github_snapshot" || body.report.source.provenance.headSha !== target.headSha ||
          !["saved", "failed"].includes(body.persistence?.status) ||
          (body.persistence.status === "saved" && (typeof body.persistence.id !== "string" || !Number.isFinite(Date.parse(body.persistence.createdAt))))) {
        failureMessage = "The result could not be matched to this PR. Previous reports are unchanged.";
        throw new Error("analysis_result_invalid");
      }
      const saved = body.persistence.status === "saved";
      if(saved)diagnostic?.saved(body.persistence.id,body.persistence.createdAt);
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
      setGenerations(previous => ({ ...previous, [key]: { ...attempt, status: saved ? "saved" : "unsaved",
        message: saved ? `Saved · analyzed head ${target.headSha.slice(0,12)}` : "Report generated, but it could not be saved. Previous reports are unchanged. Try again." } }));
      receivePhase='display';
      diagnostic?.record(selection.current.version===version?'view_selected':'view_ignored',{version:selection.current.version});
      if (selection.current.version === version) onGeneratedReport(detail);
    } catch (error) {
      diagnostic?.record(controller.signal.aborted?'abort':responseStatus&&responseStatus>=400?'http_error':receivePhase==='transport'?'network_error':receivePhase==='display'?'view_error':'validation_error',{errorKind:analysisClientErrorKind(error),aborted:controller.signal.aborted});
      const transportFailure = (receivePhase === 'transport' || receivePhase === 'body') && !controller.signal.aborted && error instanceof TypeError;
      if (valid()) {
        setGenerations(previous => ({ ...previous, [key]: { ...attempt, status: transportFailure ? "checking" : "error", transportFailure,
          message: transportFailure ? "Checking saved reports. Server completion is not yet confirmed." : failureMessage } }));
        // Metadata GET only, once; no POST retry and no polling loop.
        if (transportFailure) setReload(value => value + 1);
      }
    } finally {
      if(diagnostic)controller.signal.removeEventListener('abort',recordAbort);
      if (running.current.get(key) === controller) running.current.delete(key);
    }
  }

  const recent = prState?.repositoryId === repositoryId ? prState : null;
  const extras = extraPrs?.repositoryId === repositoryId ? extraPrs.items.filter(pr => !recent?.items.some(item => item.number === pr.number)) : [];
  const prs = recent ? { ...recent, items: [...recent.items, ...extras] } : null;
  const savedHistory = history?.repositoryId === repositoryId ? history : null;
  const busy = Object.values(generations).some(g => g.repositoryId === repositoryId && g.status === "busy");
  const otherReports = savedHistory?.items.filter(item => !prs?.items.some(pr=>pr.number === item.pullRequestNumber)) ?? [];
  const versionsFor = (number: number) => savedHistory?.items.filter(item=>item.pullRequestNumber === number) ?? [];
  // The shelf always belongs to one PR: the chosen one, else the newest listed PR.
  const shelfPr = prs?.items.find(pr=>pr.number === selected) ?? prs?.items[0];
  const shelfVersions = shelfPr ? versionsFor(shelfPr.number) : [];
  const shelfLatest = shelfVersions.find(item=>item.availability === "available");
  const shelfProgress = shelfPr ? generations[generationKey(shelfPr.number)] : undefined;
  const shelfBusy = ['busy','checking','queued','running'].includes(shelfProgress?.status??'');
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

  function checkSavedReports(number: number) {
    const key = generationKey(number), failed = generations[key];
    if(failed?.job&&(['queued','running','checking'].includes(failed.status)||failed.job.status==='unknown')){
      if(jobReads.current.has(key)||forceJobChecks.current.has(key))return;
      forceJobChecks.current.add(key);setGenerations(previous=>previous[key]?.requestKey===failed.requestKey?{...previous,[key]:{...previous[key]!,status:'checking'}}:previous);setReload(value=>value+1);return;
    }
    if (checkingHistory.current.has(key) || failed?.status !== "error" || !failed.transportFailure) return;
    checkingHistory.current.set(key, -1);
    setGenerations(previous => previous[key]?.requestKey === failed.requestKey
      ? { ...previous, [key]: { ...previous[key]!, status: "checking" } } : previous);
    setReload(value => value + 1);
  }

  /** Confirm an unchanged-head analysis in place; opening a version is a separate action. */
  function requestGenerate(pr: PullRequest, latest: DashboardSavedReport | undefined, confirmed = false) {
    const key = generationKey(pr.number);
    if (running.current.has(key) || checkingHistory.current.has(key) || ["checking","queued","running"].includes(generations[key]?.status??"") || !canGenerate) return;
    if (latest && latest.headSha === pr.headSha && !confirmed) { setConfirmRegenerate(pr.number); return; }
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
        const generating = ['busy','queued','running','checking'].includes(generations[generationKey(pr.number)]?.status??'');
        const [tone, status] = generating ? ["wait", "Generating…"]
          : latest ? latest.headSha === pr.headSha ? ["ok", "Report available"] : ["wait", "Previous head report"]
          : historyPending ? ["none", "Loading…"] : savedHistory?.error ? ["fail", "Status unavailable"] : ["none", "No saved report"];
        return <li className={`dashboard-pr-row${shelfPr?.number === pr.number ? " selected" : ""}`} key={pr.number}>
          <button className="dashboard-pr-title" aria-label={`Select PR #${pr.number}`} aria-current={shelfPr?.number === pr.number ? "true" : undefined} onClick={()=>openPr(pr)}>
            <span className="dashboard-pr-line"><span className="dashboard-pr-number">#{pr.number}</span><strong>{pr.title}</strong></span>
            <span className="dashboard-pr-meta"><span className={`dashboard-status tone-${tone}`}>{generating ? <Loader2 size={12} className="spin" aria-hidden="true" /> : <i aria-hidden="true" />}{status}</span>{versions.length > 1 ? <span>{versions.length} versions</span> : null}<span className={`dashboard-pr-state state-${pr.state}`}>{pr.state}</span></span>
          </button>
          {shelfPr?.number === pr.number ? <div className="dashboard-pr-shelf">
            {/* Kept visible in the selected PR area: no-report generation, same-head confirmation, progress and errors. */}
          {!canGenerate ? <p className="dashboard-shelf-note">Analysis is off for this repository (Settings).</p> : null}
          {shelfProgress && shelfProgress.status !== "busy" ? <p role={(shelfProgress.status === "error" && !shelfProgress.transportFailure) || shelfProgress.status === "unsaved" ? "alert" : "status"} className={`dashboard-shelf-note${shelfProgress.status === "saved" ? " tone-ok" : shelfProgress.status === "error" && !shelfProgress.transportFailure || shelfProgress.status === "unsaved" ? " tone-fail" : ""}`} aria-busy={shelfProgress.jobChecking || shelfProgress.status === "checking" && !shelfProgress.job && savedHistory?.loading || undefined}>{shelfProgress.jobChecking || shelfProgress.status === "checking" && !shelfProgress.job && savedHistory?.loading ? <><Loader2 size={14} className="spin" aria-hidden={true} />{reportLanguage === "ko" ? "결과 확인 중…" : "Checking results…"}</> : shelfProgress.message}</p> : null}
          {shelfProgress && (shelfProgress.status === "error" && shelfProgress.transportFailure || shelfProgress.job && (['queued','running','checking'].includes(shelfProgress.status)||shelfProgress.job.status==='unknown')) ? <button className="dashboard-text-action" aria-label={`Check saved reports for PR #${shelfPr.number}`} disabled={shelfProgress.job ? shelfProgress.jobChecking : savedHistory?.loading} onClick={() => checkSavedReports(shelfPr.number)}>{reportLanguage === "ko" ? "저장된 보고서 확인" : "Check saved reports"}</button> : null}
            {shelfVersions.length ? <details className="dashboard-pr-versions" open={versionsOpenFor === pr.number} onToggle={event => { const open = event.currentTarget.open; setVersionsOpenFor(current => open ? pr.number : current === pr.number ? 0 : current); }}>
              <summary>Saved versions · {(() => { const viewing = shelfVersions.findIndex(item => item.id === activeReportId); return viewing >= 0 ? `${versionLabel(viewing)} / ${shelfVersions.length}` : shelfVersions.length; })()}</summary>
          <div className="dashboard-shelf-heading"><p><span className="dashboard-pr-number">PR #{shelfPr.number}</span> · {shelfVersions.length} saved</p><h4>{shelfPr.title}</h4></div>
          <button ref={regenerateButton} className={`${shelfLatest ? "dashboard-secondary-action" : "dashboard-primary-action"} dashboard-shelf-generate`} aria-label={`${shelfLatest ? "Regenerate" : "Generate"} report for PR #${shelfPr.number}`} title={shelfLatest ? "Saves a new version. Existing versions are kept." : undefined} disabled={shelfBusy || !canGenerate} onClick={()=>requestGenerate(shelfPr, shelfLatest)}>{shelfProgress?.status === "busy" ? <><Loader2 size={15} className="spin" /> Generating…</> : shelfLatest ? <><RotateCw size={15} /> Regenerate</> : "Generate report"}</button>
          {confirmRegenerate === shelfPr.number && shelfLatest ? <div className="dashboard-shelf-confirm" role="status"><p>Already saved for this commit ({shelfLatest.headSha?.slice(0,7)}). Regenerate only if checks or settings changed.</p><div><button className="dashboard-primary-action" aria-label={`Regenerate anyway for PR #${shelfPr.number}`} disabled={shelfBusy || !canGenerate} onClick={()=>requestGenerate(shelfPr, shelfLatest, true)}>Regenerate anyway</button><button className="dashboard-text-action" onClick={()=>{setConfirmRegenerate(0);regenerateButton.current?.focus({preventScroll:true});}}>Cancel</button></div></div> : null}
              <ol className="dashboard-version-list">{shelfVersions.map((item, index)=>{
          const viewing = item.id === activeReportId;
          const unavailable = item.availability !== "available";
          return <li key={item.id} className={viewing ? "viewing" : undefined}>
            <button className="dashboard-version-card" aria-label={item === shelfLatest ? `View report for PR #${shelfPr.number}` : `View report version ${item.id}`} aria-current={viewing ? "true" : undefined} disabled={unavailable} onClick={()=>{selectPr(shelfPr.number);onOpenReport(item.id);}}>
              <span className="dashboard-version-badges"><span className="dashboard-version-tag">{versionLabel(index)}</span>{item === shelfLatest ? <span className="dashboard-version-latest">Latest</span> : null}{viewing ? <span className="dashboard-version-viewing">Viewing</span> : null}</span>
              <span className="dashboard-version-meta"><time dateTime={item.createdAt}>{formatVersionTime(item.createdAt)}</time><code>{item.headSha?.slice(0,7) ?? "no head"}</code></span>
              {unavailable ? <span className="dashboard-status tone-fail"><i aria-hidden="true" />Unavailable</span> : item.headSha !== shelfPr.headSha ? <span className="dashboard-status tone-wait"><i aria-hidden="true" />Previous head</span> : null}
            </button>
          </li>;
        })}</ol>
            </details> : <><button className={`${shelfLatest ? "dashboard-secondary-action" : "dashboard-primary-action"} dashboard-shelf-generate`} aria-label={`${shelfLatest ? "Regenerate" : "Generate"} report for PR #${shelfPr.number}`} title={shelfLatest ? "Saves a new version. Existing versions are kept." : undefined} disabled={shelfBusy || !canGenerate} onClick={()=>requestGenerate(shelfPr, shelfLatest)}>{shelfProgress?.status === "busy" ? <><Loader2 size={15} className="spin" /> Generating…</> : shelfLatest ? <><RotateCw size={15} /> Regenerate</> : "Generate report"}</button>{historyPending ? <p role="status" className="dashboard-shelf-note"><Loader2 className="spin" size={14} /> Loading versions…</p> : <p className="dashboard-empty">No saved report yet.</p>}</>}
          </div> : null}
        </li>;
      })}</ul>
      {otherReports.length ? <details className="dashboard-pr-history"><summary>Other PRs with saved reports ({otherReports.length})</summary>{otherReports.map(item=><button key={item.id} className="dashboard-list-row" aria-label={`View report version ${item.id}`} disabled={item.availability !== "available"} onClick={()=>{selectPr(item.pullRequestNumber ?? 0);onOpenReport(item.id);}}><FileCheck2 size={15} /><span>PR #{item.pullRequestNumber} · {formatVersionTime(item.createdAt)}<small>head {item.headSha?.slice(0,7) ?? "not recorded"}{item.availability !== "available" ? " · Unavailable" : ""}</small></span></button>)}</details> : null}
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
