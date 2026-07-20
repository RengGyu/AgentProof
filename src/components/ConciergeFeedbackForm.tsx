"use client";

import { useState } from "react";
import type { VerificationReport } from "@/lib/types";

export function ConciergeFeedbackForm({ tenantId, caseIdOrHash, report }: { tenantId: string; caseIdOrHash: string; report: VerificationReport }) {
  const hasTopGap = Boolean(report.decisionCard?.topGap);
  const [partnerId, setPartnerId] = useState("");
  const [sessionOrdinal, setSessionOrdinal] = useState(1);
  const [repeatOrdinal, setRepeatOrdinal] = useState(1);
  const [agreement, setAgreement] = useState("unclear");
  const [usefulness, setUsefulness] = useState(3);
  const [prSizeBucket, setPrSizeBucket] = useState("small");
  const [preReportGapCategory, setPreReportGapCategory] = useState("none");
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
      setStatus(response.ok ? (payload?.duplicate ? "metadata_already_recorded" : "metadata_saved") : "metadata_not_saved");
    } catch {
      setStatus("metadata_not_saved");
    } finally {
      setSubmitting(false);
    }
  }

  return <section className="panel concierge-feedback" aria-labelledby="concierge-feedback-title">
    <h2 id="concierge-feedback-title">Metadata-only feedback</h2>
    <p className="muted small">Repository, account, contact, code, report, log, task, and re-prompt text are not accepted.</p>
    <div className="notice"><strong>Privacy notice — human-beta-privacy.v1</strong><p className="muted small">The analysis run stores tenant/install/repository numeric IDs, a request hash, bounded state/reason, Decision Card state, and timestamps. Feedback adds tenant-bound opaque case/participant IDs, the operator-assigned cohort, selected categories, timing, actions, and rating. The beta target retention is 30 days, but cleanup is operator-managed and not automatic. It does not accept names, contact details, repository names, PR numbers, task/code/report/log/re-prompt text, or secrets. Ask the operator to remove the metadata earlier.</p></div>
    <div className="grid-two">
      <p className="muted small">Participant cohort is assigned by the operator from the isolated beta tenant; the browser cannot self-declare it.</p>
      <label className="field"><span>Operator-issued opaque partner ID</span><input className="input" value={partnerId} onChange={(event) => setPartnerId(event.target.value)} /></label>
      <label className="field"><span>Session ordinal</span><input className="input" type="number" min={1} value={sessionOrdinal} onChange={(event) => setSessionOrdinal(Number(event.target.value))} /></label>
      <label className="field"><span>Actual repeat-use ordinal</span><input className="input" type="number" min={1} value={repeatOrdinal} onChange={(event) => setRepeatOrdinal(Number(event.target.value))} /></label>
      <label className="field"><span>Top-gap agreement</span><select className="select" value={agreement} onChange={(event) => setAgreement(event.target.value)}><option value="agree">Agree</option><option value="partly">Partly</option><option value="disagree">Disagree</option><option value="unclear">Unclear</option></select></label>
      <label className="field"><span>Usefulness (1–5)</span><input className="input" type="number" min={1} max={5} value={usefulness} onChange={(event) => setUsefulness(Number(event.target.value))} /></label>
      <label className="field"><span>PR size bucket</span><select className="select" value={prSizeBucket} onChange={(event) => setPrSizeBucket(event.target.value)}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
      <label className="field"><span>Pre-report gap category (record the prior judgment)</span><select className="select" value={preReportGapCategory} onChange={(event) => setPreReportGapCategory(event.target.value)}><option value="none">No gap expected</option><option value="implementation">Implementation proof</option><option value="targeted_test">Targeted test proof</option><option value="execution">Execution proof</option><option value="requirement">Requirement clarity</option><option value="evidence_unavailable">Evidence collection unavailable</option><option value="evidence_insufficient">Collected evidence insufficient</option></select></label>
      <label className="field"><span>Top-gap outcome</span><select className="select" value={topGapOutcome} onChange={(event) => setTopGapOutcome(event.target.value)}>{hasTopGap ? <><option value="not_observed">Not observed</option><option value="found_within_30s">Found within 30 seconds</option><option value="found_after_30s">Found after 30 seconds</option><option value="not_found">Not found</option></> : <option value="not_applicable_zero_gap">Not applicable — zero-gap report</option>}</select></label>
      <label className="field"><span>Observed seconds (blank if unavailable)</span><input className="input" type="number" min={0} max={3600} value={timeToGap} onChange={(event) => setTimeToGap(event.target.value)} /></label>
      <label className="field"><span>First inspection action</span><select className="select" value={firstInspectionAction} onChange={(event) => setFirstInspectionAction(event.target.value)}>{["none", "file", "check", "requirement"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="field"><span>Re-prompt action</span><select className="select" value={hasTopGap ? repromptAction : "not_used"} disabled={!hasTopGap} onChange={(event) => setRepromptAction(event.target.value)}>{["not_used", "copied", "edited", "sent"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="field"><span>False blocker?</span><select className="select" value={falseBlocker} onChange={(event) => setFalseBlocker(event.target.value)}><option value="unclear">Unclear</option><option value="yes">Yes</option><option value="no">No</option></select></label>
      <label className="field"><span>Operator assisted?</span><select className="select" value={operatorAssisted} onChange={(event) => setOperatorAssisted(event.target.value)}><option value="no">No</option><option value="yes">Yes</option></select></label>
      <label className="field"><span>Operator minutes</span><select className="select" value={operatorMinutesBucket} onChange={(event) => setOperatorMinutesBucket(event.target.value)}>{["0", "1_5", "6_15", "16_plus"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="field"><span>Reason category</span><select className="select" value={reasonCategory} onChange={(event) => setReasonCategory(event.target.value)}>{["useful_gap", "wrong_gap", "missing_context", "navigation", "reprompt", "other"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
    </div>
    <button className="button" onClick={submit} disabled={submitting || !partnerId || (["found_within_30s", "found_after_30s"].includes(topGapOutcome) && timeToGap === "")}>Save bounded feedback</button>
    {status ? <p aria-live="polite">{status}</p> : null}
  </section>;
}
