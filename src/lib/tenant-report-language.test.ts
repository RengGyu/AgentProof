import { describe, expect, it } from "vitest";
import {resolveReportLanguage} from "./tenant-report-language";
import {isPurposeReview} from "./purpose-summary";
import { tenantGapKind, tenantGapText, tenantRemediationText, tenantReportAnalysisContext } from "./tenant-report-language";
import { generateVerificationReport } from "./verifier";

describe("tenant report language", () => {
  it("uses an actionable privacy-safe fallback when no specific gap kind is available", () => {
    expect(tenantRemediationText([])).toBe(
      "Review the linked evidence."
    );
  });

  it("round-trips the additive forbidden-implementation gap without changing legacy fallback", () => {
    const text = tenantGapText("forbidden_implementation_present");
    expect(text).toContain("forbids implementation changes");
    expect(tenantGapKind(text)).toBe("forbidden_implementation_present");
    expect(tenantGapKind("Legacy unknown gap text.")).toBe("evidence_unavailable");
  });

  it("keeps a no-objective unlinked PR in PR-objective context", () => {
    const report = generateVerificationReport({
      title: "Improve background processing",
      taskText: "",
      description: "Improve background processing.",
      changedFiles: [{ path: "src/jobs/label.js", status: "modified", patch: "+ export const label = 'background';" }],
      checks: [],
      logs: []
    });

    expect(report.requirements).toEqual([]);
    expect(tenantReportAnalysisContext(report)).toBe("unlinked_pr");
  });

  it("keeps an authoritative Issue context even when the PR description adds author claims", () => {
    const report = generateVerificationReport({
      title: "Persist notification preference",
      taskText: "Users must be able to save whether notifications are enabled.",
      taskSource: "issue",
      description: "Implemented the preference storage and tests.",
      changedFiles: [{ path: "src/notifications/preference.js", status: "modified", patch: "+ savePreference(enabled);" }],
      checks: [],
      logs: []
    });

    expect(report.requirements).not.toHaveLength(0);
    expect(tenantReportAnalysisContext(report)).toBe("linked_issue");
  });
});

it('reads legacy report locale as en and accepts a safe Korean reviewer DTO without translating source locations',()=>{
 const review={version:1,flow:'explore_final_v1',locale:'ko',headSha:'a'.repeat(40),baseSha:'b'.repeat(40),clauses:[{clauseId:'pc_'+'1'.repeat(24),goalId:'pg_'+'2'.repeat(24),purpose:'대기 중인 작업 유지',implementation:'supports',changeDescriptions:[{text:'변경된 소스는 대기 중인 작업을 유지합니다.',evidenceRefs:['pe_'+'3'.repeat(24)]}],testDescriptions:[],evidenceRefs:['pe_'+'3'.repeat(24)],counterEvidenceRefs:[]}],references:[{id:'pe_'+'3'.repeat(24),path:'src/queue.py',side:'head',revision:'a'.repeat(40),startLine:1,endLine:1}]};
 expect(isPurposeReview(review)).toBe(true);const legacy={...review};delete (legacy as any).locale;expect(isPurposeReview(legacy)).toBe(true);expect(resolveReportLanguage((legacy as any).locale)).toBe('en');expect(resolveReportLanguage(review.locale)).toBe('ko');expect(()=>resolveReportLanguage('ja')).toThrow('report_language_invalid');
});
