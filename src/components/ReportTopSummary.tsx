import { presentEvidenceLimitation } from "@/lib/tenant-report-language";
import type { DashboardReportDetail } from "@/lib/github-dashboard-view-model";
import type { PrEvidenceReview } from "@/lib/pr-evidence-review";

/** A reading aid over recorded evidence, never a new verification verdict. */
export function ReportTopSummary({ report, review }: { report: DashboardReportDetail["report"]; review?: PrEvidenceReview }) {
  const checks = [["CI", report?.testing?.ciStatus], ["Lint", report?.testing?.lintStatus], ["Typecheck", report?.testing?.typecheckStatus]];
  const recorded = checks.filter(([, state]) => state === "passed" || state === "failed" || state === "pending");
  const failed = checks.find(([, state]) => state === "failed");
  const pending = checks.find(([, state]) => state === "pending");
  const tone = (state?: string) => state === "passed" ? "ok" : state === "failed" ? "fail" : state === "pending" ? "wait" : "none";
  const checkChips = recorded.length
    ? <ul className="report-check-chips">{recorded.map(([name, state]) => <li key={name} className={`dashboard-status tone-${tone(state)}`}><i aria-hidden="true" />{`${name} ${state}`}</li>)}{recorded.length < checks.length ? <li className="dashboard-status tone-none"><i aria-hidden="true" />Other checks not recorded</li> : null}</ul>
    : <span className="dashboard-status tone-none"><i aria-hidden="true" />Checks not recorded</span>;
  const gap = report?.requirements?.find(item => item.gaps.length > 0);
  const first = review?.objectives.flatMap(objective => [objective.firstInspection, ...objective.code, ...objective.tests]).find(Boolean);
  const path = first?.label;
  const contractInvalid = report?.verificationContract?.state === "invalid";
  const blocked = report?.generalPrAssessmentSummary?.overallConclusion === "collection_blocked";
  const next = failed ? `Review the failing ${failed[0]} check.`
    : blocked ? (path ? `Inspect ${path}${first?.line ? ` at line ${first.line}` : ""}; resolve unverified requirements.` : "Inspect the linked source and code for unresolved requirements.")
    : contractInvalid ? "Review the invalid verification contract."
    : pending ? `Wait for ${pending[0]}, then refresh.`
    : gap ? gap.gaps[0]
    : !recorded.length ? "Collect execution results for this commit."
    : path ? `Inspect ${path}${first?.line ? ` at line ${first.line}` : ""}.`
    : "Review the referenced evidence.";
  const presentedNext = presentEvidenceLimitation(next);
  const briefNext = presentedNext.length > 130 ? `${presentedNext.slice(0, 127).trimEnd()}…` : presentedNext;
  const nextTone = failed || blocked || contractInvalid ? "fail" : pending ? "wait" : "focus";
  return <section className="report-top-summary" aria-label="Report summary">
    <dl>
      <div><dt>Checks</dt><dd>{checkChips}</dd></div>
      <div><dt>Inspect first</dt><dd className={`report-next tone-${nextTone}`}>{briefNext}</dd></div>
    </dl>
  </section>;
}
