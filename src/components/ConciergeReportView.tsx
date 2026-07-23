"use client";

import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  CircleHelp,
  ChevronRight,
  Clipboard,
  Clock3,
  ExternalLink,
  FileCode2,
  FileSearch,
  FlaskConical,
  GitCommitHorizontal,
  GitPullRequest,
  Info,
  ListChecks,
  Search
} from "lucide-react";
import { useMemo, useState } from "react";
import { getExecutionEvidenceItems } from "@/lib/execution-evidence";
import type { CheckStatus, ProofGapKind, RequirementProofNode, RequirementStatus, VerificationReport } from "@/lib/types";

type ConciergeView = "summary" | "requirements" | "checks" | "evidence";

export function ConciergeReportView({ report }: { report: VerificationReport }) {
  const [view, setView] = useState<ConciergeView>("summary");
  const [copied, setCopied] = useState(false);
  const evidenceById = useMemo(
    () => new Map(report.evidenceIndex.map((item) => [item.id, item])),
    [report.evidenceIndex]
  );
  const executionEvidence = useMemo(() => getExecutionEvidenceItems(report.evidenceIndex), [report.evidenceIndex]);
  const topGap = report.decisionCard?.topGap ?? null;
  const task = describeTaskSource(report);
  const gap = describeGap(topGap?.kind);
  const headSha = report.source.provenance?.headSha;
  const pullRequestUrl = safeGitHubPullRequestUrl(report.source.url);

  async function copyReprompt() {
    const prompt = report.decisionCard?.reprompt?.prompt;
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function selectView(next: ConciergeView) {
    setView(next);
    window.requestAnimationFrame(() => document.getElementById(`concierge-panel-${next}`)?.focus());
  }

  return (
    <section className="concierge-report">
      <header className="concierge-report-header">
        <div className="concierge-report-heading">
          <p className="eyebrow">분석 대상</p>
          <div className="github-pr-heading"><GitPullRequest size={20} aria-hidden="true" /><h1 id="concierge-report-title">{report.source.title}</h1></div>
          <div className="report-source-boundaries">
            <span className={`friendly-chip task-${task.tone}`}><FileCode2 size={14} aria-hidden="true" />{task.label}</span>
            {headSha ? <span className="head-boundary"><GitCommitHorizontal size={14} aria-hidden="true" /><span>분석 커밋</span><code aria-label={`분석 커밋 전체 SHA ${headSha}`}>{headSha.slice(0, 12)}</code><span>기준</span></span> : null}
            {pullRequestUrl ? <a className="source-pr-link" href={pullRequestUrl} target="_blank" rel="noreferrer">PR 원문 열기 <ExternalLink size={14} aria-hidden="true" /></a> : null}
          </div>
        </div>
      </header>

      {view === "summary" ? <div className="report-step-strip"><span>검토 요약</span><p>가장 중요한 항목만 먼저 확인합니다.</p></div> : <div className="detail-page-navigation">
        <button className="detail-back" type="button" onClick={() => selectView("summary")}><ArrowLeft size={17} />검토 요약으로</button>
        <div className="detail-page-title"><p className="eyebrow">상세 근거</p><strong>필요한 증거를 항목별로 확인하세요.</strong></div>
        <span className="detail-truth-label"><Info size={14} />근거 보고서 · 병합/정확성 판정 아님</span>
        <nav className="concierge-view-tabs detail-tabs" aria-label="상세 보고서 항목">
          {([
            ["requirements", "요구사항", ListChecks],
            ["checks", "테스트·CI", FlaskConical],
            ["evidence", "증거 출처·제한사항", FileSearch]
          ] as const).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              className={view === value ? "active" : ""}
              aria-current={view === value ? "page" : undefined}
              onClick={() => selectView(value)}
            >
              <Icon size={16} />{label}
            </button>
          ))}
        </nav>
      </div>}

      {view === "summary" ? (
        <div id="concierge-panel-summary" className="concierge-view-panel" tabIndex={-1} role="region" aria-label="검토 요약">
          <div className={`friendly-brief gap-${gap.tone}`}>
            <div className="friendly-brief-kicker"><Search size={16} aria-hidden="true" />우선 검토 항목</div>
            <h2>{topGap ? gap.headline : "우선 확인할 증거 공백을 찾지 못했습니다"}</h2>
            {topGap ? <p className="friendly-brief-source-label">보고서 근거 설명 · 원문</p> : null}
            <p className="friendly-brief-summary">
              {topGap?.summary ?? "수집된 증거 범위에서 우선 검토할 공백을 찾지 못했습니다. 이것이 구현의 정확성이나 완전성을 증명하지는 않습니다."}
            </p>
            {topGap ? <p className="friendly-brief-help">{gap.help}</p> : null}
            {topGap?.evidenceRefs.length ? (
              <button type="button" className="evidence-count" onClick={() => selectView("evidence")}><FileSearch size={14} />증거 출처 화면 열기 · {topGap.evidenceRefs.length}개 연결</button>
            ) : null}
          </div>

          <div className="summary-status-row" aria-label="테스트와 CI 요약">
            <StatusBox label="CI 결과" value={report.testing.ciStatus} />
            <p><strong>상태는 수집된 실행 증거를 그대로 표시합니다.</strong><span>확인 불가와 진행 중은 통과로 해석하지 않습니다.</span></p>
          </div>

          <div className="friendly-action-grid">
            <section className="friendly-action-card inspect-card">
              <p className="eyebrow">첫 확인 위치</p>
              {report.decisionCard?.firstInspectionPoints.length ? (
                <ul className="friendly-link-list">
                  {report.decisionCard.firstInspectionPoints.slice(0, 2).map((point) => (
                    <li key={point.href}>
                      <a href={point.href} target="_blank" rel="noreferrer">
                        <span>{point.kind === "check" ? "CI check" : "파일"}</span>
                        <strong><code>{point.label}</code></strong>
                        <ExternalLink size={15} />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted small">연결할 수 있는 GitHub 파일 또는 CI 검사 링크가 없습니다.</p>}
            </section>

            {report.decisionCard?.reprompt ? (
              <section className="friendly-action-card reprompt-card">
                <div className="friendly-card-head">
                  <div><p className="eyebrow">권장 후속 작업</p><h3>에이전트에게 보낼 후속 요청</h3></div>
                  <button className="button friendly-copy" type="button" onClick={copyReprompt} aria-label="후속 요청 복사">
                    {copied ? <CheckCircle2 size={16} /> : <Clipboard size={16} />}{copied ? "복사됨" : "복사"}
                  </button>
                </div>
                <details>
                  <summary>요청 내용 미리 보기</summary>
                  <pre className="github-code-panel">{report.decisionCard.reprompt.prompt}</pre>
                </details>
              </section>
            ) : (
              <section className="friendly-action-card neutral-card">
                <p className="eyebrow">권장 후속 작업</p>
                <p>우선 검토 항목이 없어 후속 요청을 생성하지 않았습니다.</p>
              </section>
            )}
          </div>

          <div className="truth-boundary-note">
            <Info size={17} />
            <div><strong>사람의 검토를 돕는 보고서입니다.</strong><p>증거 부족은 구현 실패를 뜻하지 않습니다. 이 보고서는 병합 여부를 결정하거나 구현이 맞다고 보증하지 않습니다.</p></div>
          </div>

          <section className="detail-gateway" aria-labelledby="detail-gateway-title">
            <div className="detail-gateway-heading"><p className="eyebrow">더 확인하려면</p><h2 id="detail-gateway-title">상세 근거를 항목별로 열어보세요</h2></div>
            <div className="detail-gateway-grid">
              <button type="button" onClick={() => selectView("requirements")}><ListChecks size={20} /><span><strong>요구사항</strong><small>{report.requirements.length}개 항목의 구현 근거</small></span><ChevronRight size={18} /></button>
              <button type="button" onClick={() => selectView("checks")}><FlaskConical size={20} /><span><strong>테스트·CI</strong><small>실행 결과와 누락 테스트</small></span><ChevronRight size={18} /></button>
              <button type="button" onClick={() => selectView("evidence")}><FileSearch size={20} /><span><strong>증거 출처·제한사항</strong><small>참조한 근거와 확인 범위</small></span><ChevronRight size={18} /></button>
            </div>
          </section>
        </div>
      ) : null}

      {view === "requirements" ? (
        <div id="concierge-panel-requirements" className="concierge-view-panel detail-panel" tabIndex={-1} role="region" aria-label="요구사항 상세 근거">
          <div className="detail-heading"><div><p className="eyebrow">요구사항</p><h2>요구사항별 확인 근거</h2></div><span>{report.requirements.length}개</span></div>
          <div className="friendly-requirements">
            {report.requirements.map((requirement) => {
              const node = report.proofGraph.nodes.find((candidate) => candidate.requirementId === requirement.requirementId);
              const headingId = `concierge-requirement-${requirement.requirementId}`;
              return <article key={requirement.requirementId} aria-labelledby={headingId}>
                <div className="requirement-card-head"><code>{requirement.requirementId}</code><span className={`friendly-chip requirement-${requirement.status}`}>{requirementStatusLabel(requirement.status)}</span></div>
                <p className="source-label">원 요구사항</p>
                <h3 id={headingId} className="source-title">{requirement.requirementText}</h3>
                {node ? <EvidenceTrail status={requirement.status} requirementEvidenceRefs={requirement.evidenceRefs} node={node} evidenceById={evidenceById} /> : null}
                <p className="source-label">보고서 근거 설명</p>
                <p className="report-evidence-copy">{requirement.reviewerNote}</p>
                {requirement.gaps.length ? <><h4>확인 필요 항목 원문</h4><ul className="source-text">{requirement.gaps.map((item) => <li key={item}>{item}</li>)}</ul></> : null}
                <EvidenceDisclosure refs={requirement.evidenceRefs} evidenceById={evidenceById} />
              </article>;
            })}
          </div>
        </div>
      ) : null}

      {view === "checks" ? (
        <div id="concierge-panel-checks" className="concierge-view-panel detail-panel" tabIndex={-1} role="region" aria-label="테스트와 CI 상세 근거">
          <div className="detail-heading"><div><p className="eyebrow">실행 결과</p><h2>테스트와 CI</h2></div></div>
          <div className="check-summary-grid">
            <StatusBox label="CI 실행" value={report.testing.ciStatus} />
            <StatusBox label="Lint" value={report.testing.lintStatus} />
            <StatusBox label="Typecheck" value={report.testing.typecheckStatus} />
          </div>
          <section className="friendly-detail-section">
            <h3>직접 확인이 필요한 테스트</h3>
            {report.testing.missingTests.length ? <ul>{report.testing.missingTests.map((item) => <li key={item.path}><code>{item.path}</code><p>{item.why}</p></li>)}</ul> : <p className="bounded-empty">수집된 증거 범위에서 별도의 누락 테스트 신호를 찾지 못했습니다.</p>}
          </section>
          <section className="friendly-detail-section">
            <h3>실행 근거</h3>
            {executionEvidence.length ? <ul className="github-evidence-list">{executionEvidence.map((item) => <li key={item.id}><span className={`check-text-${item.status}`}>{statusLabel(item.status)}</span><code className="status-token" aria-hidden="true">{item.status}</code><code className="github-locator">{item.locator ?? item.label}</code><p>{item.displaySummary}</p></li>)}</ul> : <p className="bounded-empty">수집한 CI 실행 결과가 없습니다.</p>}
          </section>
        </div>
      ) : null}

      {view === "evidence" ? (
        <div id="concierge-panel-evidence" className="concierge-view-panel detail-panel" tabIndex={-1} role="region" aria-label="증거 출처와 제한사항 상세 근거">
          <div className="detail-heading"><div><p className="eyebrow">출처와 경계</p><h2>증거 출처·제한사항</h2></div><span>증거 출처 {report.evidenceIndex.length}개</span></div>
          <section className="friendly-detail-section">
            <h3>요구사항 출처</h3>
            <p><span className={`friendly-chip task-${task.tone}`}><FileCode2 size={14} aria-hidden="true" />{task.label}</span></p>
          </section>
          <section className="friendly-detail-section">
            <h3>보고서가 참조한 근거</h3>
            <ul className="github-evidence-list">
              {report.evidenceIndex.map((item) => <li key={item.id}><span>{evidenceKindLabel(item.kind)}</span><code>{item.locator ?? item.label}</code><p>{item.summary}</p></li>)}
            </ul>
          </section>
          <section className="friendly-detail-section limitation-section">
            <h3>확인하지 못한 범위</h3>
            {report.limitations.length ? <ul>{report.limitations.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="bounded-empty">명시적으로 기록된 추가 한계는 없습니다. 이것이 완전성이나 정확성을 증명하지는 않습니다.</p>}
          </section>
        </div>
      ) : null}

      {copied ? <p className="sr-status" role="status">후속 요청을 클립보드에 복사했습니다.</p> : null}
    </section>
  );
}

function EvidenceDisclosure({ refs, evidenceById }: { refs: string[]; evidenceById: Map<string, VerificationReport["evidenceIndex"][number]> }) {
  if (!refs.length) return <p className="bounded-empty">연결된 근거 항목이 없습니다.</p>;
  return <details className="friendly-evidence-disclosure"><summary>이 항목에 연결된 근거 {refs.length}개</summary><ul className="github-evidence-list">{refs.map((ref) => {
    const item = evidenceById.get(ref);
    return <li key={ref}><span>{item ? evidenceKindLabel(item.kind) : "근거"}</span><code>{item?.locator ?? item?.label ?? "위치 불명"}</code><p>{item?.summary ?? "보고서에서 이 근거 항목을 찾지 못했습니다."}</p></li>;
  })}</ul></details>;
}

function StatusBox({ label, value }: { label: string; value: CheckStatus }) {
  const Icon = value === "passed" ? CheckCircle2 : value === "failed" ? CircleAlert : value === "pending" ? Clock3 : CircleHelp;
  return <div className={`friendly-status-box check-${value}`} aria-label={`${label}: ${statusLabel(value)}`}><span>{label}</span><strong><Icon size={17} aria-hidden="true" />{statusLabel(value)}</strong><code className="status-token" aria-hidden="true">{value}</code></div>;
}

function EvidenceTrail({ status, requirementEvidenceRefs, node, evidenceById }: { status: RequirementStatus; requirementEvidenceRefs: string[]; node: RequirementProofNode; evidenceById: Map<string, VerificationReport["evidenceIndex"][number]> }) {
  const requirementEvidence = new Set(requirementEvidenceRefs);
  const implementationRefs = node.implementationEvidenceRefs.filter((ref) => requirementEvidence.has(ref));
  const targetedTestRefs = node.targetedTestEvidenceRefs.filter((ref) => requirementEvidence.has(ref));
  const executionRefs = node.executionEvidenceRefs.filter((ref) => requirementEvidence.has(ref));
  return <div className="evidence-trail" aria-label="요구사항에서 실행 근거까지의 연결">
    <EvidenceTrailStep label="요구사항" value={requirementStatusLabel(status)} />
    <EvidenceTrailStep label="변경 파일" refs={implementationRefs} evidenceById={evidenceById} />
    <EvidenceTrailStep label="대상 테스트" refs={targetedTestRefs} evidenceById={evidenceById} />
    <EvidenceTrailStep label="실행·CI" refs={executionRefs} evidenceById={evidenceById} />
  </div>;
}

function EvidenceTrailStep({ label, value, refs, evidenceById }: { label: string; value?: string; refs?: string[]; evidenceById?: Map<string, VerificationReport["evidenceIndex"][number]> }) {
  const labels = refs?.map((ref) => evidenceById?.get(ref)?.locator ?? evidenceById?.get(ref)?.label ?? "위치 불명") ?? [];
  return <div className="evidence-trail-step"><span>{label}</span>{value ? <strong>{value}</strong> : labels.length ? <>{labels.slice(0, 2).map((item) => <code key={item}>{item}</code>)}{labels.length > 2 ? <small>외 {labels.length - 2}개</small> : null}</> : <strong className="trail-empty">연결된 근거 없음</strong>}</div>;
}

function describeTaskSource(report: VerificationReport): { label: string; tone: "known" | "unclear" } {
  const task = report.source.originalTask;
  if (!task) return { label: "요구사항 확인 불가: 출처 정보 없음", tone: "unclear" };
  if (task.status !== "available") {
    const reasonLabels = {
      not_linked: "연결된 GitHub Issue 없음",
      multiple_linked_issues: "연결된 GitHub Issue가 여러 개",
      linked_issue_inaccessible: "연결된 GitHub Issue 접근 불가",
      linked_issue_outside_selected_repository: "선택한 저장소 밖의 GitHub Issue는 사용하지 않음",
      linked_issue_deleted_or_empty: "연결된 GitHub Issue 내용 없음",
      linked_reference_is_pull_request: "연결 참조가 Issue가 아닌 PR",
      none: "출처 상태 확인 불가"
    } as const;
    return { label: `요구사항 확인 불가: ${reasonLabels[task.reason]}`, tone: "unclear" };
  }
  if (task.sourceType === "explicit_task") return { label: "직접 입력한 요구사항", tone: "known" };
  const issue = task.sourceRef?.match(/(?:github_issue:|#)(\d+)/)?.[1];
  return { label: issue ? `요구사항 GitHub Issue #${issue}` : "연결된 GitHub Issue 사용", tone: "known" };
}

function describeGap(kind?: ProofGapKind): { headline: string; help: string; tone: string } {
  const labels: Record<ProofGapKind, { headline: string; help: string; tone: string }> = {
    missing_implementation: { headline: "구현 증거 없음", help: "요구사항을 구현한 파일 또는 변경 흔적을 확인해 주세요.", tone: "warning" },
    missing_targeted_test: { headline: "요구사항 대상 테스트 증거 없음", help: "이 요구사항에 연결된 테스트 파일 증거와 실행 결과를 확인해 주세요.", tone: "warning" },
    missing_execution: { headline: "테스트·빌드 실행 증거 없음", help: "실행 대상과 관찰 가능한 테스트·빌드 결과를 확인해 주세요.", tone: "unclear" },
    failed_execution: { headline: "테스트·빌드 실행 실패", help: "실패한 check와 파일 위치를 확인해 원인을 검토해 주세요.", tone: "danger" },
    ambiguous_requirement: { headline: "요구사항 확인 불가", help: "구현 판단 전에 원래 요청 또는 승인 조건을 확인해 주세요.", tone: "unclear" },
    self_reported_test_gap: { headline: "PR 설명에서 테스트 공백 언급", help: "PR 설명의 테스트 관련 한계와 실제 테스트 증거가 일치하는지 확인해 주세요.", tone: "warning" },
    evidence_unavailable: { headline: "증거 수집 불가", help: "GitHub 권한, 연결된 GitHub Issue, CI check 제공 여부를 확인해 주세요.", tone: "unclear" },
    evidence_insufficient: { headline: "수집된 증거 불충분", help: "수집한 증거 범위와 추가로 필요한 확인 항목을 검토해 주세요.", tone: "unclear" },
    visual_proof_missing: { headline: "화면 검증 증거 없음", help: "스크린샷 또는 재현 가능한 시각 검증 결과를 확인해 주세요.", tone: "warning" }
  };
  return kind ? labels[kind] : { headline: "현재 증거 요약", help: "", tone: "neutral" };
}

function statusLabel(status: CheckStatus): string {
  return ({ passed: "통과", failed: "실패", pending: "진행 중", unknown: "확인 불가" } as const)[status];
}

function requirementStatusLabel(status: RequirementStatus): string {
  return ({ met: "구현 증거 있음", partial: "요구사항 증거 일부 있음", missing: "구현 증거 없음", unclear: "요구사항 확인 불가" } as const)[status];
}

function evidenceKindLabel(kind: VerificationReport["evidenceIndex"][number]["kind"]): string {
  return ({ task: "원 요구사항", pr_description: "PR 설명", diff: "변경 내용", changed_file: "변경 파일", check: "CI 검사", log: "실행 로그", test: "테스트", inference: "추론 신호" } as const)[kind];
}

function safeGitHubPullRequestUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const path = url.pathname.split("/").filter(Boolean);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.port || path.length !== 4 || path[2] !== "pull" || !/^[1-9]\d*$/.test(path[3])) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
