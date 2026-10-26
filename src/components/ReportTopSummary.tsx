import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { presentEvidenceLimitation } from '@/lib/tenant-report-language';
import type { DashboardReportDetail } from '@/lib/github-dashboard-view-model';
import type { ExecutionEvidenceItem } from '@/lib/execution-evidence';
import {purposeClauseReferences, purposeClauseHasInterpretation, purposeVisibleClauses} from '@/lib/purpose-summary';
import {purposeClauseDisplay, purposeReferenceLabel, purposeUnboundReferences,purposeReviewSections} from '@/lib/shared-report-copy';
import {purposeReferenceUrl, type PrEvidenceReview} from '@/lib/pr-evidence-review';
import {reportCopy, type ReportCopy} from './report-copy';
type PurposeReview = NonNullable<NonNullable<DashboardReportDetail['report']>['purposeReview']>;
type PurposeClause = PurposeReview['clauses'][number];
type PurposeReference = PurposeReview['references'][number];
export function purposeFitLabel(clause: PurposeClause, t: ReportCopy): ['fit'|'conflict'|'none',string] {
  if (!purposeClauseHasInterpretation(clause)) return ['none', clause.intentMembers&&!purposeClauseReferences(clause).length?t.fit.unknown:t.locatedOnly];
  return clause.implementation==='supports'?['fit',t.fit.supports]:clause.implementation==='contradicts'?['conflict',t.fit.contradicts]:['none',t.fit.unknown];
}
/** Which description (clause + original array kind/index) a code request came from; UI state only, never stored. */
export type CodeOrigin = {clauseId:string;kind:'change'|'test'|'scope'|'summary'|'unbound'|'counter';index:number};
export const sameCodeOrigin=(a?:CodeOrigin,b?:CodeOrigin)=>Boolean(a&&b&&a.clauseId===b.clauseId&&a.kind===b.kind&&a.index===b.index);
/** readCode: the dashboard's cited-code reader; offered only for references whose exact-revision file the existing code API can read. */
type ReadCode = {readable:Set<string>;onRead:(id:string,origin?:CodeOrigin,trigger?:HTMLElement)=>void;selected?:{id:string;origin?:CodeOrigin}};
export function PurposeReferences({ids,saved,review,t,readCode,origin}: {ids:string[];saved:PurposeReview;review?:PrEvidenceReview;t:ReportCopy;readCode?:ReadCode;origin?:CodeOrigin}) {
  return <ul className="report-cited-refs">{ids.map(id=>{
    const ref=saved.references.find(e=>e.id===id);if(!ref)return null;
    const url=review?purposeReferenceUrl(review,ref):undefined;
    const side=ref.side==='base'?t.beforeChange:t.afterChange;
    const ambiguous=saved.references.some(e=>e.id!==ref.id&&e.path===ref.path&&e.side===ref.side&&e.startLine===ref.startLine&&e.endLine===ref.endLine&&e.revision!==ref.revision);
    const marker=(ref.side==='base'?t.beforeChange:'')+(ambiguous?(ref.side==='base'?' · ':'')+ref.revision.slice(0,7):'');
    const label=<><code translate="no">{purposeReferenceLabel(ref,saved.references)}</code>{marker?<span className="report-ref-side">{marker}</span>:null}</>;
    const github=`${ref.path}, ${side}, ${t.lines} ${ref.startLine}-${ref.endLine}, ${t.openOnGitHub}`;
    // A readable location's file:line label opens the in-app reader; the exact GitHub link stays a separate control.
    const readable=readCode?.readable.has(id),pressed=Boolean(readable&&readCode?.selected?.id===id&&sameCodeOrigin(readCode.selected.origin,origin));
    return <li key={id} data-reference-id={id}>{readable?<button type="button" className="report-ref-read" aria-pressed={pressed} aria-label={`${t.viewCode}: ${ref.path}, ${side}, ${t.lines} ${ref.startLine}-${ref.endLine}`} onClick={event=>readCode!.onRead(id,origin,event.currentTarget)}>{label}</button>:url?<a className="report-purpose-ref-link" href={url} target="_blank" rel="noreferrer" aria-label={github}>{label}<ExternalLink size={13} aria-hidden="true"/></a>:<span className="report-ref-location">{label}</span>}
      {readable&&url?<a className="report-ref-github" href={url} target="_blank" rel="noreferrer" aria-label={github} title="GitHub"><ExternalLink size={15} aria-hidden="true"/></a>:null}
      <details className="report-ref-full"><summary>{t.fullPath}</summary><code translate="no">{ref.path}</code></details></li>;
  })}</ul>;
}
/** One renderer owns overview, every claim with its refs, and optional source details. */
export function ReportTopSummary({report,review,executionItems=[],actions,readCode}: {report:DashboardReportDetail['report'];review?:PrEvidenceReview;stored?:boolean;executionItems?:ExecutionEvidenceItem[];actions?:ReactNode;readCode?:ReadCode}) {
  const saved=report?.purposeReview;
  if(!saved?.clauses.length)return <LegacySummary report={report} review={review}/>;
  const t=reportCopy(saved.locale),visible=purposeVisibleClauses(saved),{primary,details}=purposeReviewSections(saved);
  const refs=(ids:string[],origin?:CodeOrigin)=><PurposeReferences ids={ids} saved={saved} review={review} t={t} readCode={readCode} origin={origin}/>;
  const originIndex=(c:PurposeClause,kind:'change'|'test'|'scope',item:{text:string;evidenceRefs:string[]})=>(kind==='change'?c.changeDescriptions:kind==='test'?c.testDescriptions:c.scopeNotes??[]).indexOf(item);
  const checks=[['CI',report?.testing?.ciStatus],['Lint',report?.testing?.lintStatus],['Typecheck',report?.testing?.typecheckStatus]];
  const recorded=checks.filter(([,s])=>s==='passed'||s==='failed'||s==='pending');
  // origin uses the item's index in the original clause array, never the index in a filtered display list.
  const description=(c:PurposeClause,item:{text:string;evidenceRefs:string[]},kind:'change'|'test'|'scope',index:number)=>{const origin:CodeOrigin={clauseId:c.clauseId,kind,index:originIndex(c,kind,item)};return <div className={`report-claim${readCode?.selected&&sameCodeOrigin(readCode.selected.origin,origin)?' is-code-origin':''}`} data-claim={kind} key={index}><p>{item.text}</p>{refs(item.evidenceRefs,origin)}</div>;};
  const main=(c:PurposeClause,lead=false)=>{const d=purposeClauseDisplay(c),[tone,label]=purposeFitLabel(c,t),unbound=purposeUnboundReferences(c);return <>
    <div className="report-overview-head"><h3>{d.title}</h3></div>
    {lead?actions??null:null}
    {d.primaryDescriptions.length?<section className="report-primary-changes"><h4>{d.primaryKind==='change'?t.changes:t.relatedTests}</h4>{d.primaryDescriptions.map((item,i)=>description(c,item,d.primaryKind,i))}</section>:null}
    {d.primaryTests.length?<section className="report-primary-changes"><h4>{t.relatedTests}</h4>{d.primaryTests.map((item,i)=>description(c,item,'test',i))}</section>:null}
    {d.summaryRefs.length?<div className="report-summary-evidence" aria-label={t.summaryEvidence}>{refs(d.summaryRefs,{clauseId:c.clauseId,kind:'summary',index:0})}</div>:null}
    {unbound.length?<section className="report-primary-changes"><h4>{t.selectedLocations}</h4>{refs(unbound,{clauseId:c.clauseId,kind:'unbound',index:0})}</section>:null}
    {c.counterEvidenceRefs?.length?<section className="report-primary-changes"><h4>{t.counterEvidence}</h4>{refs(c.counterEvidenceRefs,{clauseId:c.clauseId,kind:'counter',index:0})}</section>:null}
    <span className={`dashboard-status report-fit-status tone-${tone}`}><i aria-hidden="true"/>{label}</span>
  </>;};
  return <section className="report-top-summary report-hierarchy" aria-label={t.summary} lang={saved.locale==='ko'?'ko':undefined}>
    <div className="report-overview">
      <p className="report-section-label">{t.changeSummary} · {t.fitLabel}</p>
      {primary.map((c,i)=><section className="report-overview-purpose" key={c.clauseId} data-purpose-clause={c.clauseId}>{main(c,i===0)}</section>)}
      <section className="report-execution-records"><h4>{t.executionRecords}</h4>
        {recorded.length?<ul className="report-check-chips">{recorded.map(([name,state])=><li key={name} className={`dashboard-status tone-${state==='passed'?'ok':state==='failed'?'fail':'wait'}`}><i aria-hidden="true"/>{name} {t.checkState[state as 'passed'|'failed'|'pending']}</li>)}</ul>:<p>{t.noChecks}</p>}
        {executionItems.length?<ul>{executionItems.map(e=><li key={e.id}>{e.label}: {e.status} — {e.displaySummary}</li>)}</ul>:null}
      </section>
    </div>
    {primary.length?null:actions??null}
    {details.length?<details className="report-purpose-details"><summary>{t.details}</summary><div className="report-claims">{details.map(c=>{
      const d=purposeClauseDisplay(c);return <section className="report-purpose-body" key={c.clauseId}>
        {!primary.includes(c)?main(c):visible.length>1?<h3>{d.title}</h3>:null}
        {d.scopeNotes.length?<section className="report-scope-notes"><h4>{t.scopeLabel}</h4>{d.scopeNotes.map((item,i)=>description(c,item,'scope',i))}</section>:null}
        {d.intentDetails.map((member,index)=><div key={index}>{member.purpose?<h4>{member.purpose}</h4>:null}{member.conditions.length||member.exceptions.length?<dl className="report-intent-scope">{member.conditions.length?<div><dt>{t.conditions}</dt><dd><ul>{member.conditions.map((v,i)=><li key={i}>{v}</li>)}</ul></dd></div>:null}{member.exceptions.length?<div><dt>{t.exceptions}</dt><dd><ul>{member.exceptions.map((v,i)=><li key={i}>{v}</li>)}</ul></dd></div>:null}</dl>:null}</div>)}
        {d.detailTests.length?<section><h4>{t.relatedTests}</h4>{d.detailTests.map((item,i)=>description(c,item,'test',i))}</section>:null}
      </section>;
    })}</div></details>:null}
  </section>;
}

function LegacySummary({report,review}: {report:DashboardReportDetail['report'];review?:PrEvidenceReview}) {
  const t=reportCopy(report?.purposeReview?.locale);
  const checks = [["CI", report?.testing?.ciStatus], ["Lint", report?.testing?.lintStatus], ["Typecheck", report?.testing?.typecheckStatus]];
  const recorded = checks.filter(([, state]) => state === "passed" || state === "failed" || state === "pending");
  const failed = checks.find(([, state]) => state === "failed");
  const pending = checks.find(([, state]) => state === "pending");
  const tone = (state?: string) => state === "passed" ? "ok" : state === "failed" ? "fail" : state === "pending" ? "wait" : "none";
  const checkChips = recorded.length
    ? <ul className="report-check-chips">{recorded.map(([name, state]) => <li key={name} className={`dashboard-status tone-${tone(state)}`}><i aria-hidden="true" />{`${name} ${t.checkState[state as "passed" | "failed" | "pending"]}`}</li>)}{recorded.length < checks.length ? <li className="dashboard-status tone-none"><i aria-hidden="true" />{t.otherChecks}</li> : null}</ul>
    : <span className="dashboard-status tone-none"><i aria-hidden="true" />{t.noChecks}</span>;
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
  return <section className="report-top-summary" aria-label={t.summary}><dl><div><dt>Inspect first</dt><dd className={`report-next tone-${nextTone}`}>{briefNext}</dd></div><div><dt>{t.checks}</dt><dd>{checkChips}</dd></div></dl></section>;
}
