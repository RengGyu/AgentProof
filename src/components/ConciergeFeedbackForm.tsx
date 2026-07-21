"use client";

import { useState } from "react";
import type { VerificationReport } from "@/lib/types";

export function ConciergeFeedbackForm({ tenantId, caseIdOrHash, report, preReportGapCategory }: { tenantId: string; caseIdOrHash: string; report: VerificationReport; preReportGapCategory: string }) {
  const hasTopGap = Boolean(report.decisionCard?.topGap);
  const [partnerId, setPartnerId] = useState("");
  const [sessionOrdinal, setSessionOrdinal] = useState(1);
  const [repeatOrdinal, setRepeatOrdinal] = useState(1);
  const [agreement, setAgreement] = useState("unclear");
  const [usefulness, setUsefulness] = useState(3);
  const [prSizeBucket, setPrSizeBucket] = useState("small");
  const [topGapOutcome, setTopGapOutcome] = useState(report.decisionCard?.topGap ? "not_observed" : "not_applicable_zero_gap");
  const [timeToGap, setTimeToGap] = useState("");
  const [firstInspectionAction, setFirstInspectionAction] = useState("none");
  const [repromptAction, setRepromptAction] = useState("not_used");
  const [falseBlocker, setFalseBlocker] = useState("unclear");
  const [operatorAssisted, setOperatorAssisted] = useState("no");
  const [operatorMinutesBucket, setOperatorMinutesBucket] = useState("0");
  const [reasonCategory, setReasonCategory] = useState("other");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/tenants/concierge/feedback", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "x-agentproof-csrf": "same-origin" },
      body: JSON.stringify({ tenantId, feedback: {
        schemaVersion: "concierge-feedback.v3", privacyNoticeVersion: "human-beta-privacy.v1", pseudonymousPartnerId: partnerId,
        sessionOrdinal, caseIdOrHash,
        taskSourceQuality: report.source.originalTask?.status === "available" ? report.source.originalTask.sourceType : report.source.originalTask?.status ?? "unavailable",
        prSizeBucket, preReportGapCategory, topGapOutcome,
        foundTopGapWithin30s: topGapOutcome === "found_within_30s", timeToTopGapSeconds: ["found_within_30s", "found_after_30s"].includes(topGapOutcome) && timeToGap !== "" ? Number(timeToGap) : null, topGapAgreement: agreement,
        firstInspectionAction, repromptAction: hasTopGap ? repromptAction : "not_used",
        falseBlocker: falseBlocker === "unclear" ? null : falseBlocker === "yes", usefulness,
        operatorAssisted: operatorAssisted === "yes", operatorMinutesBucket, actualRepeatUseOrdinal: repeatOrdinal,
        boundedReasonCategory: reasonCategory
      } })
      });
      const payload = await response.json().catch(() => null);
      setStatus(response.ok ? (payload?.duplicate ? "duplicate" : "saved") : "failed");
    } catch {
      setStatus("failed");
    } finally {
      setSubmitting(false);
    }
  }

  return <details className="panel concierge-feedback friendly-feedback">
    <summary><span><strong>간단한 사용성 피드백</strong><small>보고서·코드 원문 없이 선택한 답변만 저장합니다.</small></span></summary>
    <div className="feedback-body" aria-labelledby="concierge-feedback-title">
      <h2 id="concierge-feedback-title">이 보고서가 실제 검토에 도움이 되었나요?</h2>
      <p className="locked-pre-report">보고서 전 예상: <strong>{preReportLabel(preReportGapCategory)}</strong> <span>· 분석 시작 시 잠김</span></p>
      <div className="grid-two feedback-core-grid">
        <label className="field"><span>우선 검토 항목을 찾았나요?</span><select className="select" aria-label="우선 검토 항목을 찾았나요?" value={topGapOutcome} onChange={(event) => setTopGapOutcome(event.target.value)}>{hasTopGap ? <><option value="not_observed">아직 확인하지 않음</option><option value="found_within_30s">30초 안에 찾음</option><option value="found_after_30s">30초 뒤에 찾음</option><option value="not_found">찾지 못함</option></> : <option value="not_applicable_zero_gap">우선 검토 항목이 없는 보고서</option>}</select></label>
        <label className="field"><span>보고서가 꼽은 항목에 동의하나요?</span><select className="select" aria-label="보고서가 꼽은 항목에 동의하나요?" value={agreement} disabled={!hasTopGap} onChange={(event) => setAgreement(event.target.value)}><option value="agree">동의함</option><option value="partly">일부 동의함</option><option value="disagree">동의하지 않음</option><option value="unclear">판단하기 어려움</option></select></label>
        <label className="field"><span>처음 연 항목</span><select className="select" aria-label="처음 연 항목" value={firstInspectionAction} onChange={(event) => setFirstInspectionAction(event.target.value)}><option value="none">아직 열지 않음</option><option value="file">파일</option><option value="check">CI 검사</option><option value="requirement">요구사항</option></select></label>
        <label className="field"><span>후속 요청을 사용했나요?</span><select className="select" aria-label="후속 요청을 사용했나요?" value={hasTopGap ? repromptAction : "not_used"} disabled={!hasTopGap} onChange={(event) => setRepromptAction(event.target.value)}><option value="not_used">사용하지 않음</option><option value="copied">복사함</option><option value="edited">수정함</option><option value="sent">에이전트에게 보냄</option></select></label>
        <label className="field"><span>실제보다 심각한 문제처럼 보였나요?</span><select className="select" aria-label="실제보다 심각한 문제처럼 보였나요?" value={falseBlocker} onChange={(event) => setFalseBlocker(event.target.value)}><option value="unclear">판단하기 어려움</option><option value="yes">그렇다</option><option value="no">아니다</option></select></label>
        <label className="field"><span>전체적으로 도움이 된 정도</span><select className="select" aria-label="전체적으로 도움이 된 정도" value={usefulness} onChange={(event) => setUsefulness(Number(event.target.value))}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}점</option>)}</select></label>
        {["found_within_30s", "found_after_30s"].includes(topGapOutcome) ? <label className="field"><span>찾는 데 걸린 시간(초)</span><input className="input" aria-label="찾는 데 걸린 시간(초)" type="number" min={0} max={3600} value={timeToGap} onChange={(event) => setTimeToGap(event.target.value)} /></label> : null}
      </div>

      <details className="operator-feedback-details"><summary>운영자용 세부 기록</summary><div className="grid-two">
        <label className="field"><span>익명 테스터 ID</span><input className="input" aria-label="익명 테스터 ID" placeholder="partner_..." value={partnerId} onChange={(event) => setPartnerId(event.target.value)} /></label>
        <label className="field"><span>이번 테스트 세션 번호</span><input className="input" aria-label="이번 테스트 세션 번호" type="number" min={1} value={sessionOrdinal} onChange={(event) => setSessionOrdinal(Number(event.target.value))} /></label>
        <label className="field"><span>실제 사용 횟수</span><input className="input" aria-label="실제 사용 횟수" type="number" min={1} value={repeatOrdinal} onChange={(event) => setRepeatOrdinal(Number(event.target.value))} /></label>
        <label className="field"><span>PR 변경 규모</span><select className="select" value={prSizeBucket} onChange={(event) => setPrSizeBucket(event.target.value)}><option value="small">작음</option><option value="medium">보통</option><option value="large">큼</option></select></label>
        <label className="field"><span>운영자 도움이 필요했나요?</span><select className="select" value={operatorAssisted} onChange={(event) => setOperatorAssisted(event.target.value)}><option value="no">아니오</option><option value="yes">예</option></select></label>
        <label className="field"><span>도움받은 시간</span><select className="select" value={operatorMinutesBucket} onChange={(event) => setOperatorMinutesBucket(event.target.value)}><option value="0">없음</option><option value="1_5">1–5분</option><option value="6_15">6–15분</option><option value="16_plus">16분 이상</option></select></label>
        <label className="field"><span>평가 이유</span><select className="select" value={reasonCategory} onChange={(event) => setReasonCategory(event.target.value)}><option value="useful_gap">유용한 지적</option><option value="wrong_gap">잘못된 우선순위</option><option value="missing_context">맥락 부족</option><option value="navigation">탐색 어려움</option><option value="reprompt">후속 요청</option><option value="other">기타</option></select></label>
      </div></details>
      <button className="button primary feedback-submit" onClick={submit} disabled={submitting || !partnerId || (["found_within_30s", "found_after_30s"].includes(topGapOutcome) && timeToGap === "")}>{submitting ? "저장 중" : "피드백 저장"}</button>
      {status ? <p aria-live="polite">{status === "saved" ? "피드백을 저장했습니다." : status === "duplicate" ? "이미 저장된 응답입니다." : "피드백을 저장하지 못했습니다. 다시 시도하거나 운영자에게 알려 주세요."}</p> : null}
    </div>
  </details>;
}

function preReportLabel(value: string): string {
  return ({ none: "특별한 증거 공백 없음", implementation: "구현 증거 없음", targeted_test: "요구사항 대상 테스트 증거 없음", execution: "테스트·빌드 실행 증거 없음", requirement: "요구사항 확인 불가", evidence_unavailable: "증거 수집 불가", evidence_insufficient: "수집된 증거 불충분" } as Record<string, string>)[value] ?? "기록되지 않음";
}
