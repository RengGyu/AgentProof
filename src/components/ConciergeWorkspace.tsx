"use client";

import { useRef, useState } from "react";
import { ReportView } from "./ReportView";
import { ConciergeFeedbackForm } from "./ConciergeFeedbackForm";
import type { VerificationReport } from "@/lib/types";

export function ConciergeWorkspace() {
  const [form, setForm] = useState({ tenantId: "", installationId: "", repositoryId: "", repositoryFullName: "", pullRequestNumber: "", explicitTask: "" });
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [caseIdOrHash, setCaseIdOrHash] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  function resetWorkspace(message: string | null = null) {
    setForm({ tenantId: "", installationId: "", repositoryId: "", repositoryFullName: "", pullRequestNumber: "", explicitTask: "" });
    setReport(null); setCaseIdOrHash(""); setCollapsed(false); setLoading(false); setError(message);
  }

  async function endSession() {
    try {
      const response = await fetch("/api/tenants/auth/session", { method: "DELETE", credentials: "same-origin", headers: { "x-agentproof-csrf": "same-origin" } });
      const payload = await response.json().catch(() => null) as { code?: string } | null;
      resetWorkspace(response.ok ? null : payload?.code ?? "session_revoke_unconfirmed");
    } catch {
      resetWorkspace("session_revoke_unconfirmed");
    }
  }

  async function analyze() {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/tenants/concierge/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agentproof-csrf": "same-origin" },
        credentials: "same-origin",
        body: JSON.stringify({
          tenantId: form.tenantId,
          installationId: Number(form.installationId),
          repositoryId: Number(form.repositoryId),
          repositoryFullName: form.repositoryFullName,
          pullRequestNumber: Number(form.pullRequestNumber),
          requestId: crypto.randomUUID(),
          ...(form.explicitTask.trim() ? { explicitTask: form.explicitTask } : {})
        })
      });
      const json = await response.json() as { report?: VerificationReport; caseIdOrHash?: string; error?: string; code?: string };
      if (!response.ok || !json.report) throw new Error(json.code ?? json.error ?? "analysis_failed");
      setReport(json.report); setCaseIdOrHash(json.caseIdOrHash ?? ""); setCollapsed(true);
      window.requestAnimationFrame(() => { reportRef.current?.focus(); reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "analysis_failed"); }
    finally { setLoading(false); }
  }

  return <main className="app-shell concierge-shell">
    <header className="topbar"><div className="brand-copy"><span>AgentProof Concierge</span><small>운영자 동행형 private-repo evidence report</small></div></header>
    <div className={report ? "concierge-layout has-report" : "concierge-layout"}>
      <section className={collapsed ? "panel concierge-intake collapsed" : "panel concierge-intake"}>
        <div className="card-title-row"><div><p className="eyebrow">Manual only</p><h1>Private PR analysis</h1></div>
          {report ? <div className="concierge-session-actions"><button className="button compact" onClick={() => setCollapsed((value) => !value)}>{collapsed ? "입력 펼치기" : "입력 접기"}</button><button className="button compact" onClick={() => resetWorkspace()}>새 테스트 시작</button><button className="button compact" onClick={endSession}>세션 종료</button></div> : null}
        </div>
        {!collapsed ? <>
          <p className="muted small">Durable session(영속 세션), active installation(활성 설치), explicit repository grant(명시적 저장소 허용)가 모두 필요합니다.</p>
          <div className="notice"><strong>Privacy notice — human-beta-privacy.v1</strong><p className="muted small">분석 결과 전문은 저장하지 않습니다. 분석 실행에는 tenant·installation·repository 숫자 ID, request hash, 제한된 상태/사유, Decision Card 상태와 시간이 metadata-only 행으로 남습니다. 피드백을 저장하면 같은 tenant에 결속된 opaque case/participant ID, 운영자가 지정한 cohort, 선택형 응답과 측정 시간이 추가됩니다. 베타 보존 목표는 30일이지만 삭제는 현재 운영자 수동 절차이며 자동화되지 않았습니다. 이름·연락처·저장소명·PR 번호·task/code/report/log/re-prompt 원문·비밀값은 피드백에 입력하지 마세요.</p></div>
          <div className="grid-two">
            {(["tenantId", "installationId", "repositoryId", "repositoryFullName", "pullRequestNumber"] as const).map((key) => <label className="field" key={key}><span>{key}</span><input className="input" value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} /></label>)}
          </div>
          <label className="field"><span>명시적 original task (선택, 없으면 linked issue 1개만 사용)</span><textarea className="textarea" value={form.explicitTask} onChange={(event) => setForm((current) => ({ ...current, explicitTask: event.target.value }))} /></label>
          <button className="button primary" disabled={loading} onClick={analyze}>{loading ? "검증 중" : "수동 분석 실행"}</button>
          {error ? <p className="intake-error" role="alert">{error}</p> : null}
          <p className="muted small">LLM, webhook 자동 분석, 저장, 공개 share, comment, Slack은 이 경로에서 모두 OFF입니다.</p>
        </> : null}
      </section>
      {report ? <div ref={reportRef} tabIndex={-1} aria-label="Concierge evidence report"><ReportView report={report} surface="concierge" />{caseIdOrHash ? <ConciergeFeedbackForm key={caseIdOrHash} tenantId={form.tenantId} caseIdOrHash={caseIdOrHash} report={report} /> : null}</div> : null}
    </div>
  </main>;
}
