import type { ReportLanguage } from "@/lib/tenant-report-language";

/**
 * Fixed labels for the report reading area only, chosen by the report's stored locale.
 * Model-written purposes and descriptions are shown as generated, never translated here.
 */
const copy = {
  en: {
    viewCode: "View code", backToReport: "Back to report", materials: "Collected material & export", selectedDescription: "Selected description",
    closeCode: "Close code", retryCode: "Retry", loadingCode: "Loading referenced code…", sourcesAndScope: "Sources & search scope", codeAction: (open:boolean,label:string)=>`${open?"Close":"Read"} code for ${label}`, evidenceAndCode: "Evidence & code", hideEvidence: "Hide evidence", copyReport: "Copy report", copySelected: "Copy selected report", copied: "Copied", reportCopied: "Report copied.", copyFailed: "Copy failed. Select the report text manually.", exportReport: "Export report", copyJson: "Copy JSON", reportStatus: "Report status", backToPrList: "Back to PR list", download: "Download", copyPrComment: "Copy PR Comment", copiedClipboard: "Copied to clipboard.", downloadStarted: "Download started.", downloadFailed: "Download failed in this browser. Use Copy Report instead.", copyDownloadFailed: "Copy failed in this browser. Use Download or select the text manually.", exportActions: "Report export actions", handoff: "Human handoff", handoffNote: "Copy or download only when you intend to move this report outside DiffEvidence.", summary: "Report summary", conclusion: "Conclusion", why: "Why", evidence: "Evidence", checks: "Checks",
    fit: { supports: "Fits", contradicts: "Conflicts", unknown: "Insufficient evidence", located: "Selected changes" },
    fitSentence: { supports: "Changed material fits this purpose item.", contradicts: "Changed material conflicts with this purpose item.", unknown: "Not confirmed from the selected changed source.", located: "Selected source locations; purpose fit was not interpreted." },
    note: "Fit labels and explanations are model interpretations, not verified behavior or test execution.",
    boundaryMore: "About this boundary",
    boundary: "These interpretations cover cited changed source. Source reading and static tests do not verify behavior or test execution; source quotations were not retained.",
    testMeaning: "Test meaning", testMeaningPrefix: "Test meaning: ",
    conditions: "Conditions", exceptions: "Exceptions", moreInterpretations: "More interpretations", source: "Source",
    authorClaim: "Author claim", requirementSource: "Selected requirement source",
    morePurposes: (n: number) => `Show ${n} more ${n === 1 ? "purpose" : "purposes"}`,
    revisions: "Show full revisions", head: "Head (after change)", base: "Base (before change)", beforeChange: "before change",
    openLines: "open referenced lines on GitHub", cites: "Cites",
    checkState: { passed: "passed", failed: "failed", pending: "pending" }, otherChecks: "Other checks not recorded", noChecks: "Checks not recorded",
    checksNote: "Recorded by the server; does not show which tests ran.",
    purposeEvidence: "Purpose evidence", collectedChanges: "Collected changes", changes: "Changes", modelInterpretation: "Model interpretation: ", referencedSource: "Referenced source",
    // Three-level report layout: overview -> claims with their own evidence -> details.
    changeSummary: "Change summary", fromIntent: "From the stated intent", fitLabel: "Model interpretation", summaryEvidence: "Summary evidence",
    executionRecords: "Execution records", receiptNotRetained: "Individual test execution lists are not retained in this saved report.",
    details: "Details", scopeLabel: "Scope", whatChanged: "What changed", relatedTests: "Static tests",
    intentConditions: "Conditions in the stated intent", intentExceptions: "Exceptions in the stated intent",
    locatedOnly: "Selected change locations", selectedLocations: "Selected locations", counterEvidence: "Counterevidence",
    intentDetails: "Stated intent details", pathsAndRevisions: "Full paths and revisions", fullPath: "Path", lines: "lines", afterChange: "after change", openOnGitHub: "open on GitHub",
    citedCode: "Cited code", readCode: "Read code", codeOnGitHubOnly: "This location can't be read here. Open it on GitHub.", noCitedCode: "No cited code locations in this report.",
    freshnessHelp: "What this status means", freshnessExplained: "Freshness of this saved report, based on its analysis job state. It is not a fresh GitHub check, a latest-revision guarantee or a correctness guarantee.",
  },
  ko: {
    viewCode: "근거 코드", backToReport: "설명으로", materials: "수집된 자료·내보내기", selectedDescription: "선택한 설명",
    closeCode: "코드 닫기", retryCode: "다시 읽기", loadingCode: "참조 코드를 읽는 중…", sourcesAndScope: "출처와 탐색 범위", codeAction: (open:boolean,label:string)=>`${label} 코드 ${open?"닫기":"보기"}`, evidenceAndCode: "근거 코드", hideEvidence: "근거 닫기", copyReport: "보고서 복사", copySelected: "선택한 보고서 복사", copied: "복사됨", reportCopied: "보고서를 복사했습니다.", copyFailed: "복사하지 못했습니다. 보고서 텍스트를 직접 선택해 주세요.", exportReport: "보고서 내보내기", copyJson: "JSON 복사", reportStatus: "보고서 상태", backToPrList: "PR 목록으로", download: "다운로드", copyPrComment: "PR 댓글 복사", copiedClipboard: "클립보드에 복사했습니다.", downloadStarted: "다운로드를 시작했습니다.", downloadFailed: "다운로드하지 못했습니다. 보고서 복사를 이용해 주세요.", copyDownloadFailed: "복사하지 못했습니다. 다운로드하거나 텍스트를 직접 선택해 주세요.", exportActions: "보고서 내보내기", handoff: "보고서 전달", handoffNote: "DiffEvidence 밖으로 전달할 때만 복사하거나 다운로드하세요.", summary: "보고서 요약", conclusion: "결론", why: "이유", evidence: "근거", checks: "검사 기록",
    fit: { supports: "적합", contradicts: "불일치", unknown: "근거 부족", located: "선택한 변경 위치" },
    fitSentence: { supports: "변경 내용이 이 목적과 맞는 것으로 해석했습니다.", contradicts: "변경 내용이 이 목적과 어긋나는 것으로 해석했습니다.", unknown: "선택한 변경 소스만으로는 판단하지 못했습니다.", located: "선택한 소스 위치이며, 목적에 맞는지는 해석하지 않았습니다." },
    note: "판정과 설명은 모델 해석이며 실행이나 동작을 검증한 결과가 아닙니다.",
    boundaryMore: "이 해석의 범위",
    boundary: "이 해석은 인용된 변경 소스만 다룹니다. 소스 읽기와 정적 테스트는 동작이나 테스트 실행을 검증하지 않으며, 소스 인용문은 보관하지 않았습니다.",
    testMeaning: "테스트 의미", testMeaningPrefix: "테스트 의미: ",
    conditions: "조건", exceptions: "예외", moreInterpretations: "추가 해석", source: "출처",
    authorClaim: "작성자 주장", requirementSource: "선택된 요구사항 출처",
    morePurposes: (n: number) => `목적 ${n}개 더 보기`,
    revisions: "전체 리비전 보기", head: "head(변경 후)", base: "base(변경 전)", beforeChange: "변경 전",
    openLines: "GitHub에서 참조 줄 열기", cites: "인용",
    checkState: { passed: "통과", failed: "실패", pending: "대기 중" }, otherChecks: "다른 검사 기록 없음", noChecks: "검사 기록 없음",
    checksNote: "서버에 기록된 결과이며, 어떤 테스트가 실행됐는지는 보여 주지 않습니다.",
    purposeEvidence: "목적 근거", collectedChanges: "수집된 변경", changes: "변경", modelInterpretation: "모델 해석: ", referencedSource: "참조한 소스",
    changeSummary: "변경 요약", fromIntent: "작성자 의도 기준", fitLabel: "모델 해석", summaryEvidence: "요약 근거",
    executionRecords: "실행 기록", receiptNotRetained: "개별 테스트 실행 목록은 이 저장 보고서에 보관되지 않습니다.",
    details: "상세", scopeLabel: "범위", whatChanged: "무엇이 바뀌었나", relatedTests: "정적 테스트",
    intentConditions: "의도의 조건", intentExceptions: "의도의 예외",
    locatedOnly: "선택한 변경 위치", selectedLocations: "선택한 위치", counterEvidence: "반대 근거",
    intentDetails: "작성자 의도 상세", pathsAndRevisions: "전체 경로·리비전", fullPath: "경로", lines: "줄", afterChange: "변경 후", openOnGitHub: "GitHub에서 열기",
    citedCode: "인용된 코드", readCode: "코드 보기", codeOnGitHubOnly: "이 위치는 여기서 읽을 수 없습니다. GitHub에서 여세요.", noCitedCode: "이 보고서에는 인용된 코드 위치가 없습니다.",
    freshnessHelp: "이 상태의 의미", freshnessExplained: "저장된 보고서의 분석 작업 상태를 기준으로 한 표시입니다. GitHub를 새로 확인한 결과, 최신 리비전 보장이나 정확성 보증이 아닙니다.",
  },
} as const;

export type ReportCopy = (typeof copy)[ReportLanguage];

/** Stored locale only; a missing or unknown value (legacy reports) reads as English. */
export function reportCopy(locale: unknown): ReportCopy {
  return locale === "ko" ? copy.ko : copy.en;
}
