"use client";

import { ArrowRight, CircleAlert, FileCheck2, FileSearch, Github, ListChecks, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ConciergeReportView } from "./ConciergeReportView";
import { ConciergeFeedbackForm } from "./ConciergeFeedbackForm";
import type { VerificationReport } from "@/lib/types";

export function ConciergeWorkspace() {
  const [started, setStarted] = useState(false);
  const [form, setForm] = useState({ repositoryFullName: "", pullRequestNumber: "" });
  const [authState, setAuthState] = useState<"checking" | "signed_out" | "ready" | "app_missing" | "no_granted_personal_repository" | "private_repository_required" | "access_changed" | "auth_unavailable">("checking");
  const [repositories, setRepositories] = useState<Array<{ fullName: string }>>([]);
  const [report, setReport] = useState<VerificationReport | null>(null);
  const [caseIdOrHash, setCaseIdOrHash] = useState("");
  const [preReportGapCategory, setPreReportGapCategory] = useState("");
  const [lockedPreReportGapCategory, setLockedPreReportGapCategory] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasDurableSession, setHasDurableSession] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);
  const authLoadInFlight = useRef(false);

  useEffect(() => {
    if (!report) return;
    const resetScroll = window.requestAnimationFrame(() => {
      reportRef.current?.focus({ preventScroll: true });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });
    return () => window.cancelAnimationFrame(resetScroll);
  }, [report]);

  useEffect(() => { void loadGitHubSession(); }, [started]);

  function resetWorkspace(message: string | null = null, returnToWelcome = false) {
    setForm({ repositoryFullName: "", pullRequestNumber: "" });
    setReport(null); setCaseIdOrHash(""); setPreReportGapCategory(""); setLockedPreReportGapCategory(""); setLoading(false); setError(message);
    setStarted(!returnToWelcome);
  }

  async function loadGitHubSession() {
    if (authLoadInFlight.current) return;
    authLoadInFlight.current = true;
    try {
      const me = await fetch("/api/auth/me", { credentials: "same-origin" });
      const profile = await me.json().catch(() => null) as { authenticated?: unknown; code?: unknown } | null;
      if (!me.ok && profile?.code === "auth_unavailable") {
        setAuthState("auth_unavailable");
        return;
      }
      if (profile?.authenticated !== true) {
        setHasDurableSession(false);
        const callbackState = new URLSearchParams(window.location.search).get("auth");
        setAuthState(callbackState === "oauth_provider_unavailable" || callbackState === "durable_store_mismatch" ? "auth_unavailable" : callbackState === "private_repository_required" ? "private_repository_required" : callbackState === "organization_installation_unsupported" || callbackState === "personal_installation_required" ? "app_missing" : callbackState === "installation_inventory_too_large" || callbackState === "repository_inventory_too_large" ? "access_changed" : "signed_out");
        return;
      }
      setHasDurableSession(true);
      const response = await fetch("/api/auth/github/repositories", { credentials: "same-origin" });
      const payload = await response.json().catch(() => null) as { repositories?: unknown; state?: unknown; code?: unknown } | null;
      if (!response.ok) { setAuthState(response.status === 401 ? "signed_out" : payload?.code === "auth_unavailable" || response.status >= 500 ? "auth_unavailable" : "access_changed"); return; }
      const list = Array.isArray(payload?.repositories) ? payload!.repositories.filter(isRepositoryOption) : [];
      setRepositories(list);
      setForm((current) => ({ ...current, repositoryFullName: list[0]?.fullName ?? "" }));
      setAuthState(payload?.state === "app_missing" ? "app_missing" : payload?.state === "private_repository_required" ? "private_repository_required" : payload?.state === "no_granted_personal_repository" ? "no_granted_personal_repository" : "ready");
    } catch { setAuthState("auth_unavailable"); }
    finally { authLoadInFlight.current = false; }
  }

  async function endSession(): Promise<boolean> {
    try {
      const response = await fetch("/api/auth/github/session", { method: "DELETE", credentials: "same-origin", headers: { "x-agentproof-csrf": "same-origin" } });
      if (!response.ok) {
        setAuthState("auth_unavailable");
        setError("auth_unavailable");
        return false;
      }
      setHasDurableSession(false);
      setRepositories([]); setAuthState("signed_out"); resetWorkspace(null, true);
      return true;
    } catch {
      setAuthState("auth_unavailable");
      setError("auth_unavailable");
      return false;
    }
  }

  async function switchGitHubAccount() {
    if (await endSession()) window.location.assign("/api/auth/github/start");
  }

  async function analyze() {
    const repositoryFullName = form.repositoryFullName;
    if (authState !== "ready" || !repositories.some((repository) => repository.fullName === repositoryFullName) || !validPullRequestNumber(form.pullRequestNumber)) {
      setError("invalid_repository_or_pr");
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
          repositoryFullName,
          pullRequestNumber: Number(form.pullRequestNumber),
          requestId: crypto.randomUUID()
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

        <div className="friendly-privacy"><strong>보고서 전문은 저장하지 않습니다.</strong><span>선택형 사용 기록은 최대 30일 보존 목표이며, 현재 삭제는 운영자가 처리합니다.</span><details><summary>개인정보 처리 자세히 보기</summary><p>분석 실행에는 GitHub 연결·저장소를 구분하는 번호, 요청 해시, 제한된 상태와 시간이 남습니다. 피드백에는 서버가 만든 익명 식별자와 선택형 응답만 추가됩니다. 이름·연락처·저장소명·PR 번호·작업·코드·보고서·로그·후속 요청 원문·비밀값은 피드백으로 받지 않습니다.</p></details></div>

        {authState === "checking" ? <p role="status" aria-live="polite">GitHub 로그인 상태를 확인하고 있습니다.</p> : null}
        {authState === "signed_out" ? <section className="friendly-session" aria-label="GitHub 로그인"><strong>GitHub 계정으로 계속하기</strong><p>개인 계정에 설치된 AgentProof 저장소만 첫 베타에서 선택할 수 있습니다.</p><a className="button primary" href="/api/auth/github/start">GitHub로 계속하기 <Github size={18} /></a></section> : null}
        {authState === "app_missing" ? <div className="intake-error" role="alert"><CircleAlert size={18} /><div className="intake-error-body"><strong>개인 GitHub App 설치가 필요합니다.</strong><span>개인 계정에 AgentProof GitHub App을 설치한 뒤 다시 로그인해 주세요. 조직 저장소는 첫 베타에서 지원하지 않습니다.</span></div></div> : null}
        {authState === "no_granted_personal_repository" ? <div className="intake-error" role="alert"><CircleAlert size={18} /><div className="intake-error-body"><strong>아직 허용된 개인 저장소가 없습니다.</strong><span>App 설치는 확인됐지만, 운영자가 수동 분석용 저장소를 아직 허용하지 않았습니다.</span></div></div> : null}
        {authState === "private_repository_required" ? <div className="intake-error" role="alert"><CircleAlert size={18} /><div className="intake-error-body"><strong>비공개 저장소가 필요합니다.</strong><span>첫 베타는 개인 계정의 비공개 저장소만 지원합니다. GitHub App에 비공개 저장소를 선택한 뒤 다시 로그인해 주세요.</span></div></div> : null}
        {authState === "access_changed" ? <div className="intake-error" role="alert"><CircleAlert size={18} /><div className="intake-error-body"><strong>GitHub 접근 권한이 변경되었습니다.</strong><span>App 설치 및 저장소 접근 상태를 확인한 뒤 다시 로그인해 주세요.</span></div></div> : null}
        {authState === "auth_unavailable" ? <div className="intake-error" role="alert"><CircleAlert size={18} /><div className="intake-error-body"><strong>GitHub 연결 상태를 지금 확인할 수 없습니다.</strong><span>로그아웃 상태로 판단하지 않았습니다. 잠시 후 다시 시도하거나, 연결이 복구된 뒤 다른 계정으로 로그인해 주세요.</span></div></div> : null}
        {authState === "ready" ? <><div className="grid-two friendly-primary-fields">
          <label className="field"><span>허용된 개인 저장소</span><select className="select" aria-label="허용된 개인 저장소" value={form.repositoryFullName} onChange={(event) => setForm((current) => ({ ...current, repositoryFullName: event.target.value }))}>{repositories.map((repository) => <option key={repository.fullName} value={repository.fullName}>{repository.fullName}</option>)}</select></label>
          <label className="field"><span>PR 번호</span><input className="input" aria-label="PR 번호" inputMode="numeric" placeholder="예: 17" value={form.pullRequestNumber} onChange={(event) => setForm((current) => ({ ...current, pullRequestNumber: event.target.value }))} /></label>
        </div><p className="minimal-input-note"><Github size={16} />연결된 GitHub App에서 원 요구사항·변경 파일·CI 결과를 가져옵니다.</p></> : null}

        {hasDurableSession ? <div className="concierge-auth-actions"><button className="button" type="button" onClick={endSession}>로그아웃</button><button className="button" type="button" onClick={switchGitHubAccount}>다른 GitHub 계정으로 로그인</button></div> : null}
        {!hasDurableSession && authState !== "checking" && authState !== "signed_out" && authState !== "ready" ? <div className="concierge-auth-actions"><a className="button" href="/api/auth/github/start">GitHub로 계속하기 <Github size={18} /></a></div> : null}

        <details className="evaluation-settings">
          <summary>평가 진행 시에만 사용</summary>
          <label className="field pre-report-field"><span>보고서를 보기 전 예상한 증거 공백</span><select className="select" aria-label="보고서 전 예상" value={preReportGapCategory} onChange={(event) => setPreReportGapCategory(event.target.value)}><option value="">기록하지 않음</option><option value="none">특별한 증거 공백 없음</option><option value="implementation">구현 증거 없음</option><option value="targeted_test">요구사항 대상 테스트 증거 없음</option><option value="execution">테스트·빌드 실행 증거 없음</option><option value="requirement">요구사항 확인 불가</option><option value="evidence_unavailable">증거 수집 불가</option><option value="evidence_insufficient">수집된 증거 불충분</option></select><small>제품 분석에는 사용하지 않으며, 선택한 경우에만 사용성 피드백을 표시합니다.</small></label>
        </details>

        {authState === "ready" ? <button className="button primary friendly-analyze" disabled={loading || !form.repositoryFullName || !validPullRequestNumber(form.pullRequestNumber)} onClick={analyze}>{loading ? "근거를 확인하는 중" : "PR 근거 확인하기"}</button> : null}
        {loading ? <div className="concierge-loading" role="status" aria-live="polite"><span className="loading-orbit" aria-hidden="true"><FileSearch size={18} /></span><div><strong>GitHub 증거를 수집하고 있습니다.</strong><p>수집한 증거로 보고서 구조를 검증한 뒤 결과를 표시합니다.</p></div></div> : null}
        {error ? <ErrorNotice code={error} /> : null}
        <p className="quiet-boundary">이 베타에서는 LLM·자동 분석·저장·공유·댓글·Slack을 사용하지 않습니다.</p>
      </section> : null}

      {report ? <div ref={reportRef} className="concierge-report-wrap" tabIndex={-1} aria-label="PR 증거 보고서"><ConciergeReportView report={report} />{error ? <ErrorNotice code={error} /> : null}{caseIdOrHash && lockedPreReportGapCategory ? <ConciergeFeedbackForm key={caseIdOrHash} caseIdOrHash={caseIdOrHash} report={report} preReportGapCategory={lockedPreReportGapCategory} /> : null}<div className="concierge-completion-actions"><button className="button" onClick={() => resetWorkspace()}>새 PR 확인하기</button><button className="button" onClick={endSession}>로그아웃</button></div></div> : null}
    </div>
  </main>;
}

function ErrorNotice({ code }: { code: string }) {
  const message = friendlyError(code);
  return <div className="intake-error" role="alert"><CircleAlert size={18} aria-hidden="true" /><div className="intake-error-body"><strong>{message.title}</strong><span>{message.help}</span></div></div>;
}

function friendlyError(code: string): { title: string; help: string } {
  const messages: Record<string, { title: string; help: string }> = {
    invalid_repository_or_pr: { title: "저장소 주소와 PR 번호를 확인해 주세요.", help: "GitHub 저장소 주소와 1 이상의 PR 번호가 필요합니다." },
    session_invalid: { title: "GitHub 로그인이 필요합니다.", help: "GitHub로 다시 로그인한 뒤 허용된 개인 저장소를 선택해 주세요." },
    session_start_failed: { title: "GitHub 로그인을 시작하지 못했습니다.", help: "GitHub App 설치와 로그인 상태를 확인해 주세요." },
    session_response_invalid: { title: "베타 로그인 응답을 확인하지 못했습니다.", help: "다시 시도해도 반복되면 운영자에게 알려 주세요." },
    auth_unavailable: { title: "로그아웃을 확인하지 못했습니다.", help: "보고서는 그대로 유지했습니다. 같은 계정으로 다시 시도해 주세요." },
    global_kill_switch: { title: "현재 PR 근거 확인이 일시 중지되었습니다.", help: "운영자가 베타 기능을 다시 열 때까지 기다려 주세요." },
    concierge_disabled: { title: "현재 비공개 베타 분석을 사용할 수 없습니다.", help: "베타 대상과 운영 설정을 확인해 주세요." },
    installation_not_active: { title: "GitHub App 연결이 활성 상태가 아닙니다.", help: "저장소의 GitHub App 설치 상태를 확인해 주세요." },
    repository_grant_missing: { title: "이 저장소는 베타 분석에 연결되지 않았습니다.", help: "GitHub App에 선택된 저장소와 베타 허용 목록을 확인해 주세요." },
    repository_grant_disabled: { title: "이 저장소의 베타 분석이 중지되었습니다.", help: "저장소 허용 상태를 운영자에게 확인해 주세요." },
    repository_grant_changed: { title: "분석하는 동안 저장소 연결 정보가 변경되었습니다.", help: "변경된 권한을 기준으로 다시 실행해 주세요." },
    repository_identity_mismatch: { title: "입력한 저장소와 베타 연결 정보가 일치하지 않습니다.", help: "GitHub 저장소 주소를 다시 확인해 주세요." },
    tenant_grant_scope_invalid: { title: "베타 저장소 연결 범위를 확인할 수 없습니다.", help: "운영자가 허용된 저장소 설정을 확인해야 합니다." },
    duplicate_request: { title: "같은 PR 버전의 보고서가 이미 생성되었습니다.", help: "PR에 새 커밋이 생긴 뒤 다시 확인하거나 기존 결과를 사용해 주세요." },
    head_changed: { title: "분석하는 동안 PR이 변경되었습니다.", help: "최신 커밋을 기준으로 다시 실행해 주세요." },
    head_unavailable: { title: "PR의 최신 커밋을 확인하지 못했습니다.", help: "PR 번호와 GitHub App 읽기 권한을 확인해 주세요." },
    evidence_unavailable: { title: "GitHub 증거를 충분히 가져오지 못했습니다.", help: "연결된 Issue, 변경 파일, CI check 접근 상태를 확인해 주세요." },
    github_evidence_unavailable: { title: "GitHub에서 PR 증거를 가져오지 못했습니다.", help: "잠시 후 다시 시도하고 반복되면 GitHub App 권한을 확인해 주세요." },
    idempotency_unavailable: { title: "중복 실행 방지 기록을 확인하지 못했습니다.", help: "안전하게 실행을 중단했습니다. 잠시 후 다시 시도해 주세요." },
    authorization_unavailable: { title: "베타 접근 권한을 확인하지 못했습니다.", help: "베타 로그인과 저장소 연결 상태를 확인해 주세요." },
    durable_store_required: { title: "베타 권한 저장소를 사용할 수 없습니다.", help: "안전하게 실행을 중단했습니다. 운영 설정을 확인해 주세요." },
    durable_store_mismatch: { title: "베타 권한 저장소 설정이 일치하지 않습니다.", help: "안전하게 실행을 중단했습니다. 운영자에게 알려 주세요." },
    tenant_mismatch: { title: "로그인 공간과 저장소 권한이 일치하지 않습니다.", help: "베타 로그인과 저장소 연결 상태를 확인해 주세요." },
    terminal_record_unavailable: { title: "분석 종료 상태를 안전하게 기록하지 못했습니다.", help: "결과는 표시하지 않았습니다. 잠시 후 다시 시도해 주세요." },
    side_effect_telemetry_invalid: { title: "베타 안전 검사를 통과하지 못했습니다.", help: "결과는 표시하지 않았습니다. 운영자에게 알려 주세요." },
    completion_record_unavailable: { title: "완료 상태를 안전하게 기록하지 못했습니다.", help: "결과는 표시하지 않았습니다. 잠시 후 다시 시도해 주세요." },
    csrf_rejected: { title: "요청 출처를 확인하지 못했습니다.", help: "페이지를 새로 연 뒤 다시 시도해 주세요." },
    invalid_request: { title: "분석 요청 형식을 확인해 주세요.", help: "저장소 주소와 PR 번호를 다시 입력해 주세요." },
    report_validation_failed: { title: "보고서 구조 검증을 통과하지 못했습니다.", help: "검증되지 않은 결과는 표시하지 않았습니다. 운영자에게 알려 주세요." },
    analysis_failed: { title: "PR 근거 확인을 완료하지 못했습니다.", help: "저장소 연결과 GitHub App 권한을 확인해 주세요." }
  };
  return messages[code] ?? { title: "PR 근거 확인을 완료하지 못했습니다.", help: "잠시 후 다시 시도하고 반복되면 운영자에게 알려 주세요." };
}

function isRepositoryOption(value: unknown): value is { fullName: string } { return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1 && Object.keys(value)[0] === "fullName" && typeof (value as { fullName?: unknown }).fullName === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test((value as { fullName: string }).fullName)); }

function validPullRequestNumber(value: string): boolean {
  const number = Number(value);
  return /^\d+$/.test(value.trim()) && Number.isSafeInteger(number) && number > 0;
}

function readErrorCode(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" && code.length <= 100 ? code : null;
}
