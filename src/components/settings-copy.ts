import type { ReportLanguage } from "@/lib/tenant-report-language";

/**
 * Settings screen copy only, chosen by the selected repository's reportLanguage.
 * Korean consent text translates the same notice; consent versions and grants are unchanged.
 */
const copy = {
  en: {
    backToReports: "Back to reports",
    connectedRepositories: "Connected repositories", repositorySettings: "Repository settings", selectRepository: "Select a repository to change its settings.",
    privateNotice: "Turning on private analysis sends bounded private PR goal text and selected changed-code excerpts to the configured model provider to identify important changes and explain how those changes fit the stated purpose. Evidence reports may retain short summaries, file paths, and commit references.",
    approvePrivate: "Allow private PR analysis", privateDetails: "What is sent",
    automaticAnalysis: "Automatic analysis", automaticAnalysisDetail: "Creates a report when a PR is opened or gets new commits.",
    savedReports: "Saved reports", savedReportsDetail: "Save new reports to view later.",
    summaryComments: "Summary comments", commentsEnabled: "Comments are enabled for this repository.", commentsOff: "Comments are off by default. Enable only with repository-level consent.",
    reportLanguage: "Report language",
    enhancedConsent: "Private enhanced planning consent", enhancedConsentDetail: "Allow bounded redacted private Issue and PR source spans for enhanced planning.",
    account: "Account", deleteAccount: "Delete account", logOut: "Log out", signingOut: "Signing out…",
    saveFailed: "Repository settings could not be saved.",
    analysisOn: "Analysis on", analysisOff: "Analysis off", commentsOnChip: "Comments on", commentsOffChip: "Comments off", privateChip: "Private",
  },
  ko: {
    backToReports: "보고서로 돌아가기",
    connectedRepositories: "연결된 저장소", repositorySettings: "저장소 설정", selectRepository: "설정을 바꿀 저장소를 선택하세요.",
    privateNotice: "비공개 분석을 켜면 범위가 제한된 비공개 PR 목표 텍스트와 선택된 변경 코드 일부를 설정된 모델 제공자에게 보내, 중요한 변경을 찾고 그 변경이 명시된 목적에 어떻게 맞는지 설명합니다. 근거 보고서에는 짧은 요약, 파일 경로, 커밋 참조가 보관될 수 있습니다.",
    approvePrivate: "비공개 PR 분석 허용", privateDetails: "전송되는 내용",
    automaticAnalysis: "자동 분석", automaticAnalysisDetail: "PR을 열거나 새 커밋이 올라오면 보고서를 자동으로 만듭니다.",
    savedReports: "보고서 저장", savedReportsDetail: "새 보고서를 저장해 나중에 볼 수 있습니다.",
    summaryComments: "요약 댓글", commentsEnabled: "이 저장소에서 댓글이 켜져 있습니다.", commentsOff: "댓글은 기본적으로 꺼져 있습니다. 저장소 단위 동의가 있을 때만 켜세요.",
    reportLanguage: "보고서 언어",
    enhancedConsent: "비공개 확장 계획 동의", enhancedConsentDetail: "확장 계획에 범위가 제한되고 민감정보가 가려진 비공개 Issue·PR 원문 구간 사용을 허용합니다.",
    account: "계정", deleteAccount: "계정 삭제", logOut: "로그아웃", signingOut: "로그아웃 중…",
    saveFailed: "저장소 설정을 저장하지 못했습니다.",
    analysisOn: "분석 켜짐", analysisOff: "분석 꺼짐", commentsOnChip: "댓글 켜짐", commentsOffChip: "댓글 꺼짐", privateChip: "비공개",
  },
} as const;

export type SettingsCopy = (typeof copy)[ReportLanguage];

/** The repository's report language setting; anything else (unset, legacy) reads as English. */
export function settingsCopy(language: unknown): SettingsCopy {
  return language === "ko" ? copy.ko : copy.en;
}
