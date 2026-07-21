"use client";

import { ArrowRight, FileCheck2, FileSearch, Github, ListChecks, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ConciergeReportView } from "./ConciergeReportView";
import { ConciergeFeedbackForm } from "./ConciergeFeedbackForm";
import type { VerificationReport } from "@/lib/types";

export function ConciergeWorkspace() {
  const [started, setStarted] = useState(false);
  const [form, setForm] = useState({ tenantId: "", installationId: "", repositoryId: "", repositoryFullName: "", pullRequestNumber: "", explicitTask: "" });
  const [sessionMemberId, setSessionMemberId] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [caseIdOrHash, setCaseIdOrHash] = useState("");
  const [preReportGapCategory, setPreReportGapCategory] = useState("");
  const [lockedPreReportGapCategory, setLockedPreReportGapCategory] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);
  const sessionStartInFlight = useRef(false);

  useEffect(() => {
    if (!report) return;
    const resetScroll = window.requestAnimationFrame(() => {
      reportRef.current?.focus({ preventScroll: true });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });
    return () => window.cancelAnimationFrame(resetScroll);
  }, [report]);

  function resetWorkspace(message: string | null = null, returnToWelcome = false) {
    setForm({ tenantId: "", installationId: "", repositoryId: "", repositoryFullName: "", pullRequestNumber: "", explicitTask: "" });
    setSessionMemberId(""); setBootstrapToken("");
    setReport(null); setCaseIdOrHash(""); setPreReportGapCategory(""); setLockedPreReportGapCategory(""); setLoading(false); setError(message);
    setStarted(!returnToWelcome);
  }

  async function startSession() {
    if (sessionStartInFlight.current) return;
    sessionStartInFlight.current = true;
    setSessionLoading(true); setError(null);
    try {
      const cleanup = await revokeBrowserSession();
      if (!cleanup.ok) throw new Error(cleanup.code);
      const response = await fetch("/api/tenants/auth/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "x-agentproof-csrf": "same-origin", "x-agentproof-tenant-auth-token": bootstrapToken },
        body: JSON.stringify({ tenantId: form.tenantId, memberId: sessionMemberId })
      });
      const payload = await response.json().catch(() => null) as unknown;
      if (!response.ok) throw new Error(readErrorCode(payload) ?? "session_start_failed");
      if (!isTenantSessionStartResponse(payload, form.tenantId, sessionMemberId)) {
        const revoke = await revokeBrowserSession();
        throw new Error(revoke.ok ? "session_response_invalid" : revoke.code);
      }
      setSessionActive(true); setSessionMemberId("");
    } catch (cause) {
      setSessionActive(false); setError(cause instanceof Error ? cause.message : "session_start_failed");
    } finally {
      setBootstrapToken(""); setSessionLoading(false); sessionStartInFlight.current = false;
    }
  }

  async function endSession() {
    try {
      const revoke = await revokeBrowserSession();
      setSessionActive(false); resetWorkspace(revoke.ok ? null : revoke.code, true);
    } catch {
      setSessionActive(false); resetWorkspace("session_revoke_unconfirmed", true);
    }
  }

  async function analyze() {
    if (!preReportGapCategory) {
      setError("pre_report_judgment_required");
      return;
    }
    const frozenPreReportGapCategory = preReportGapCategory;
    setLockedPreReportGapCategory(frozenPreReportGapCategory);
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
      setReport(json.report); setCaseIdOrHash(json.caseIdOrHash ?? "");
    } catch (cause) { setLockedPreReportGapCategory(""); setError(cause instanceof Error ? cause.message : "analysis_failed"); }
    finally { setLoading(false); }
  }

  return <main className="app-shell concierge-shell">
    <header className="topbar concierge-topbar">
      <div className="brand-copy"><span>AgentProof</span><small>비공개 PR 근거 확인</small></div>
      <div className="concierge-header-meta"><span className="page-indicator">{report ? "검토 결과" : started ? "PR 설정" : "시작"}</span><span className="beta-pill">비공개 베타</span></div>
    </header>
    <div className={report ? "concierge-layout has-report" : started ? "concierge-layout is-setup" : "concierge-layout is-welcome"}>
      {!started && !report ? <section className="concierge-welcome" aria-labelledby="concierge-welcome-title">
        <div className="welcome-copy">
          <span className="welcome-badge"><Sparkles size={15} />AI agent PR 검토 안내</span>
          <h1 id="concierge-welcome-title">PR을 읽기 전에, <em>확인할 증거</em>부터 찾아보세요.</h1>
          <p>AgentProof는 원래 요구사항과 변경·테스트 증거를 연결해 개발자가 먼저 확인할 위치를 정리합니다.</p>
          <div className="welcome-actions">
            <button className="button primary welcome-start" type="button" onClick={() => setStarted(true)}>PR 검토 시작 <ArrowRight size={18} /></button>
            <span>LLM 없이 결정론적 증거만 사용</span>
          </div>
        </div>
        <div className="welcome-scene" aria-hidden="true">
          <span className="buddy-speech">어디부터 볼까요?</span>
          <div className="proof-buddy hero"><span className="proof-buddy-eye left" /><span className="proof-buddy-eye right" /><span className="proof-buddy-glass"><FileSearch size={28} /></span></div>
          <span className="orbit-card orbit-task"><ListChecks size={18} />요구사항</span>
          <span className="orbit-card orbit-code"><Github size={18} />변경 파일</span>
          <span className="orbit-card orbit-check"><FileCheck2 size={18} />CI 결과</span>
        </div>
        <div className="welcome-guide" aria-label="AgentProof가 정리하는 세 가지">
          <article><span>01</span><div><strong>요구사항 확인</strong><p>PR이 충족해야 할 기준을 먼저 찾습니다.</p></div></article>
          <article><span>02</span><div><strong>증거 공백 분류</strong><p>구현·테스트·CI 중 빠진 근거를 구분합니다.</p></div></article>
          <article><span>03</span><div><strong>첫 확인 위치</strong><p>파일 또는 CI check 링크를 바로 제시합니다.</p></div></article>
        </div>
        <p className="welcome-boundary">병합 여부나 구현의 정확성을 판정하지 않습니다. 사람의 검토 순서를 돕는 근거 보고서입니다.</p>
      </section> : null}

      {started && !report ? <section className="panel concierge-intake friendly-intake">
        <button className="text-back-button" type="button" onClick={() => setStarted(false)}>← 소개로 돌아가기</button>
        <div className="friendly-intro"><div className="proof-buddy mini" aria-hidden="true"><span className="proof-buddy-eye left" /><span className="proof-buddy-eye right" /></div><div><p className="eyebrow">PR 설정 · 1단계</p><h1>검토할 PR을 선택하세요</h1><p>요구사항과 변경 증거를 연결해 우선 검토 위치를 정리합니다.</p></div></div>

        <div className="friendly-privacy"><strong>보고서 전문은 저장하지 않습니다.</strong><span>선택형 사용 기록은 최대 30일 보존 목표이며, 현재 삭제는 운영자가 처리합니다.</span><details><summary>개인정보 처리 자세히 보기</summary><p>분석 실행에는 테스트 공간·GitHub 연결·저장소를 구분하는 번호, 익명 요청값, 제한된 상태와 시간이 남습니다. 피드백에는 익명 테스터 ID와 선택형 응답만 추가됩니다. 이름·연락처·저장소명·PR 번호·작업·코드·보고서·로그·후속 요청 원문·비밀값은 피드백으로 받지 않습니다.</p></details></div>

        <div className="grid-two friendly-primary-fields">
          <label className="field"><span>저장소</span><input className="input" aria-label="저장소" placeholder="owner/repository" value={form.repositoryFullName} onChange={(event) => setForm((current) => ({ ...current, repositoryFullName: event.target.value }))} /></label>
          <label className="field"><span>PR 번호</span><input className="input" aria-label="PR 번호" inputMode="numeric" placeholder="예: 17" value={form.pullRequestNumber} onChange={(event) => setForm((current) => ({ ...current, pullRequestNumber: event.target.value }))} /></label>
        </div>

        <label className="field"><span>PR이 충족해야 할 작업 설명 <small>선택</small></span><textarea className="textarea" aria-label="PR이 충족해야 할 작업 설명" placeholder="비워 두면 연결된 GitHub 이슈 1개를 사용합니다." value={form.explicitTask} onChange={(event) => setForm((current) => ({ ...current, explicitTask: event.target.value }))} /></label>

        <label className="field pre-report-field"><span>보고서 전 예상한 우선 검토 항목</span><select className="select" aria-label="보고서 전 예상" value={preReportGapCategory} onChange={(event) => setPreReportGapCategory(event.target.value)}><option value="">하나를 선택해 주세요</option><option value="none">특별한 증거 공백 없음</option><option value="implementation">구현 증거 없음</option><option value="targeted_test">요구사항 대상 테스트 증거 없음</option><option value="execution">테스트·빌드 실행 증거 없음</option><option value="requirement">요구사항 확인 불가</option><option value="evidence_unavailable">증거 수집 불가</option><option value="evidence_insufficient">수집된 증거 불충분</option></select><small>분석을 시작하면 이 선택은 잠기며, 보고서의 영향을 받지 않습니다.</small></label>

        <details className="operator-settings">
          <summary>운영자 설정</summary>
          <p>서버에서 확인된 테스트 로그인, 연결된 GitHub App, 테스트가 허용된 저장소가 필요합니다.</p>
          <div className="grid-two">
            <label className="field"><span>테스트 공간 ID</span><input className="input" aria-label="테스트 공간 ID (tenantId)" value={form.tenantId} onChange={(event) => setForm((current) => ({ ...current, tenantId: event.target.value }))} /></label>
            <label className="field"><span>GitHub App 설치 ID</span><input className="input" aria-label="GitHub App 설치 ID (installationId)" value={form.installationId} onChange={(event) => setForm((current) => ({ ...current, installationId: event.target.value }))} /></label>
            <label className="field"><span>저장소 ID</span><input className="input" aria-label="저장소 ID (repositoryId)" value={form.repositoryId} onChange={(event) => setForm((current) => ({ ...current, repositoryId: event.target.value }))} /></label>
          </div>
          <section className="friendly-session" aria-labelledby="concierge-session-title">
            <strong id="concierge-session-title">테스트 로그인</strong><p>테스터 계정 ID와 일회용 세션 시작 코드는 브라우저 메모리에서만 사용합니다. 코드는 성공·실패 후 즉시 지웁니다.</p>
            <div className="grid-two"><label className="field"><span>테스터 계정 ID</span><input className="input" aria-label="테스터 계정 ID (memberId)" value={sessionMemberId} onChange={(event) => setSessionMemberId(event.target.value)} autoComplete="off" /></label><label className="field"><span>일회용 세션 시작 코드</span><input className="input" aria-label="일회용 세션 시작 코드" type="password" value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} autoComplete="off" /></label></div>
            <div className="concierge-session-actions"><button className="button compact" disabled={sessionLoading || sessionActive || !form.tenantId.trim() || !sessionMemberId.trim() || !bootstrapToken.trim()} onClick={startSession}>{sessionLoading ? "로그인 확인 중" : sessionActive ? "테스트 로그인됨" : "테스트 로그인"}</button>{sessionActive ? <button className="button compact" onClick={endSession}>세션 종료</button> : null}</div>
          </section>
        </details>

        <button className="button primary friendly-analyze" disabled={loading || !preReportGapCategory} onClick={analyze}>{loading ? "근거를 확인하는 중" : "PR 근거 확인하기"}</button>
        {loading ? <div className="concierge-loading" role="status" aria-live="polite"><span className="loading-orbit" aria-hidden="true"><FileSearch size={18} /></span><div><strong>GitHub 증거를 수집하고 있습니다.</strong><p>수집한 증거로 보고서 구조를 검증한 뒤 결과를 표시합니다.</p></div></div> : null}
        {error ? <p className="intake-error" role="alert">{friendlyError(error)}</p> : null}
        <p className="quiet-boundary">이 베타에서는 LLM·자동 분석·저장·공유·댓글·Slack을 사용하지 않습니다.</p>
      </section> : null}

      {report ? <div ref={reportRef} className="concierge-report-wrap" tabIndex={-1} aria-label="PR 증거 보고서"><ConciergeReportView report={report} />{caseIdOrHash ? <ConciergeFeedbackForm key={caseIdOrHash} tenantId={form.tenantId} caseIdOrHash={caseIdOrHash} report={report} preReportGapCategory={lockedPreReportGapCategory} /> : null}<div className="concierge-completion-actions"><button className="button" onClick={() => resetWorkspace()}>새 PR 확인하기</button><button className="button" onClick={endSession}>세션 종료</button></div></div> : null}
    </div>
  </main>;
}

function friendlyError(code: string): string {
  const messages: Record<string, string> = {
    pre_report_judgment_required: "분석 전에 예상한 확인 항목을 선택해 주세요.",
    session_start_failed: "테스트 로그인을 시작하지 못했습니다. 운영자에게 권한과 만료 여부를 확인해 주세요.",
    session_response_invalid: "테스트 로그인 응답을 확인하지 못했습니다. 운영자에게 알려 주세요.",
    session_revoke_unconfirmed: "세션 종료를 확인하지 못했습니다. 이 환경을 다시 사용하지 말고 운영자에게 알려 주세요.",
    analysis_failed: "PR 근거 확인을 완료하지 못했습니다. 저장소 연결과 권한을 확인해 주세요."
  };
  return messages[code] ?? "요청을 완료하지 못했습니다. 운영자에게 기술 정보와 함께 알려 주세요.";
}

function readErrorCode(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" && code.length <= 100 ? code : null;
}

function isTenantSessionStartResponse(value: unknown, tenantId: string, memberId: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expectedKeys = ["expiresAt", "memberId", "next", "ok", "privacy", "role", "tenantId"].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) return false;
  const expiresAt = typeof record.expiresAt === "string" ? Date.parse(record.expiresAt) : Number.NaN;
  return record.ok === true
    && record.tenantId === tenantId
    && record.memberId === memberId
    && (record.role === "owner" || record.role === "admin" || record.role === "member")
    && Number.isFinite(expiresAt)
    && expiresAt > Date.now()
    && record.privacy === "tenant-auth-session-cookie-only"
    && record.next === "use_session_cookie";
}

async function revokeBrowserSession(): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    const response = await fetch("/api/tenants/auth/session", { method: "DELETE", credentials: "same-origin", headers: { "x-agentproof-csrf": "same-origin" } });
    const payload = await response.json().catch(() => null) as unknown;
    if (response.ok && isTenantSessionDeleteResponse(payload)) return { ok: true };
    return { ok: false, code: readErrorCode(payload) ?? "session_revoke_unconfirmed" };
  } catch {
    return { ok: false, code: "session_revoke_unconfirmed" };
  }
}

function isTenantSessionDeleteResponse(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expectedKeys = ["deleted", "ok", "privacy"].sort();
  return keys.length === expectedKeys.length
    && keys.every((key, index) => key === expectedKeys[index])
    && record.ok === true
    && record.deleted === true
    && record.privacy === "tenant-auth-session-cookie-only";
}
